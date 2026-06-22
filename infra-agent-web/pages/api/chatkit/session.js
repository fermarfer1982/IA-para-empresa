import crypto from "crypto";
import https from "https";

const OPENAI_CHATKIT_SESSIONS_URL = "https://api.openai.com/v1/chatkit/sessions";
const COOKIE_NAME = "infra_agent_uid";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, pair) => {
    const index = pair.indexOf("=");
    if (index === -1) {
      return cookies;
    }
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

function createAnonymousUserId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function sanitizeUserId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._:-]/g, "")
    .slice(0, 96);
}

function setSessionCookie(res, userId) {
  const cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(userId)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (process.env.NODE_ENV === "production") {
    cookie.push("Secure");
  }

  res.setHeader("Set-Cookie", cookie.join("; "));
}

function postJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 30000
      },
      (response) => {
        let raw = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { error: { message: "Respuesta no JSON desde OpenAI." } };
          }
          resolve({ statusCode: response.statusCode || 500, body: parsed });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Timeout creando sesión ChatKit."));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const workflowId = process.env.OPENAI_WORKFLOW_ID;

  if (!apiKey || !workflowId) {
    return res.status(500).json({
      error: "Faltan OPENAI_API_KEY u OPENAI_WORKFLOW_ID en el backend."
    });
  }

  const cookies = parseCookies(req.headers.cookie);
  let userId = sanitizeUserId(cookies[COOKIE_NAME]);

  if (!userId) {
    userId = createAnonymousUserId();
    setSessionCookie(res, userId);
  }

  const payload = {
    workflow: {
      id: workflowId
    },
    user: `infra-agent-web:${userId}`
  };

  try {
    const openaiResponse = await postJson(
      OPENAI_CHATKIT_SESSIONS_URL,
      {
        "Content-Type": "application/json",
        "OpenAI-Beta": "chatkit_beta=v1",
        Authorization: `Bearer ${apiKey}`
      },
      payload
    );

    if (openaiResponse.statusCode < 200 || openaiResponse.statusCode >= 300) {
      const requestId =
        openaiResponse.body?.request_id || openaiResponse.body?.error?.request_id;
      return res.status(502).json({
        error: "OpenAI no pudo crear la sesión ChatKit.",
        request_id: requestId || undefined
      });
    }

    if (!openaiResponse.body?.client_secret) {
      return res.status(502).json({
        error: "OpenAI no devolvió client_secret para ChatKit."
      });
    }

    return res.status(200).json({
      client_secret: openaiResponse.body.client_secret
    });
  } catch (error) {
    return res.status(502).json({
      error: error?.message || "Error conectando con OpenAI."
    });
  }
}
