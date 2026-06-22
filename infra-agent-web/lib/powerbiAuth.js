const POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const POWERBI_TOKEN_URL_BASE = "https://login.microsoftonline.com";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function normalizeText(value) {
  return String(value || "").trim();
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  })
    .then(async (response) => {
      const bodyText = await response.text();
      let body = null;
      if (bodyText) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = { error: bodyText.slice(0, 1000) };
        }
      }
      return { ok: response.ok, status: response.status, body };
    })
    .finally(() => clearTimeout(timer));
}

export function getPowerBiEnvironment() {
  const enabled = parseBooleanFlag(process.env.POWERBI_ENABLED ?? "false");
  const tenantId = normalizeText(process.env.POWERBI_TENANT_ID);
  const clientId = normalizeText(process.env.POWERBI_CLIENT_ID);
  const clientSecret = normalizeText(process.env.POWERBI_CLIENT_SECRET);

  return {
    enabled,
    tenantId,
    clientId,
    clientSecret,
    configured: Boolean(enabled && tenantId && clientId && clientSecret),
    tenantIdConfigured: Boolean(tenantId),
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret)
  };
}

export function getPowerBiAuthStatus() {
  const env = getPowerBiEnvironment();
  return {
    enabled: env.enabled,
    configured: env.configured,
    tenantIdConfigured: env.tenantIdConfigured,
    clientIdConfigured: env.clientIdConfigured,
    clientSecretConfigured: env.clientSecretConfigured,
    tokenCached: Boolean(cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60000),
    tokenExpiresAt: cachedAccessTokenExpiresAt || null
  };
}

export function clearPowerBiAccessTokenCache() {
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
}

export async function getPowerBiAccessToken() {
  const env = getPowerBiEnvironment();
  if (!env.enabled) {
    throw new Error("POWERBI_ENABLED=false. Activa POWERBI_ENABLED para usar Power BI.");
  }
  if (!env.tenantId || !env.clientId || !env.clientSecret) {
    throw new Error(
      "Power BI no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID y POWERBI_CLIENT_SECRET."
    );
  }

  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60000) {
    return cachedAccessToken;
  }

  const tokenUrl = `${POWERBI_TOKEN_URL_BASE}/${encodeURIComponent(env.tenantId)}/oauth2/v2.0/token`;
  const payload = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "client_credentials",
    scope: POWERBI_SCOPE
  });

  const response = await fetchJsonWithTimeout(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload
    },
    30000
  );

  if (!response.ok || !response.body?.access_token) {
    const detail =
      response.body?.error_description || response.body?.error || `HTTP ${response.status}`;
    throw new Error(
      `No se pudo obtener token de Power BI. Revisa la app de Entra y los permisos read-only. Detalle: ${detail}`
    );
  }

  const expiresIn = Number(response.body?.expires_in || 3600);
  cachedAccessToken = response.body.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(300, expiresIn - 60) * 1000;
  return cachedAccessToken;
}
