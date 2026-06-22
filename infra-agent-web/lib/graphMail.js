import crypto from "crypto";

import { getCommunicationDraft, updateCommunicationDraft } from "./reportsDb";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const GRAPH_TOKEN_URL_BASE = "https://login.microsoftonline.com";
const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const confirmationSessions = new Map();
const confirmationTokenByDraftId = new Map();

function normalizeText(value) {
  return String(value || "").trim();
}

function extractEmailAddress(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  const mailtoMatch = text.match(/mailto:([^)\s>]+)/i);
  if (mailtoMatch?.[1]) {
    const candidate = normalizeText(mailtoMatch[1]).replace(/^mailto:/i, "");
    return candidate.toLowerCase();
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0].toLowerCase() : "";
}

function parseAllowedDomains(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[,\s;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .map((domain) => domain.replace(/^@/, ""))
    )
  );
}

function normalizeDraftId(value) {
  return String(value || "").trim();
}

export function getGraphMailConfig() {
  const tenantId = normalizeText(process.env.GRAPH_TENANT_ID);
  const clientId = normalizeText(process.env.GRAPH_CLIENT_ID);
  const clientSecret = normalizeText(process.env.GRAPH_CLIENT_SECRET);
  const fromUser = extractEmailAddress(process.env.GRAPH_MAIL_FROM_USER);
  const allowedDomains = parseAllowedDomains(process.env.EMAIL_ALLOWED_DOMAINS);

  if (!tenantId || !clientId || !clientSecret || !fromUser || !allowedDomains.length) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    fromUser,
    allowedDomains
  };
}

function companyMailError(message) {
  return new Error(message);
}

function sanitizeSensitiveText(value) {
  return String(value || "")
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]")
    .replace(/access_token["']?\s*[:=]\s*["'][^"']+["']/gi, 'access_token="[redacted]"')
    .replace(/GRAPH_CLIENT_SECRET\s*[:=]\s*[^\s]+/gi, "GRAPH_CLIENT_SECRET=[redacted]");
}

function getRecipientDomain(email) {
  const normalized = extractEmailAddress(email);
  if (!normalized.includes("@")) {
    return "";
  }
  return normalized.split("@").pop() || "";
}

function isRecipientAllowed(email, allowedDomains = []) {
  const recipientDomain = getRecipientDomain(email);
  if (!recipientDomain) {
    return false;
  }
  return allowedDomains.some((domain) => recipientDomain === domain || recipientDomain.endsWith(`.${domain}`));
}

function purgeExpiredConfirmationSessions(now = Date.now()) {
  for (const [token, session] of confirmationSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      confirmationSessions.delete(token);
      const draftId = normalizeDraftId(session?.draft_id);
      if (draftId && confirmationTokenByDraftId.get(draftId) === token) {
        confirmationTokenByDraftId.delete(draftId);
      }
    }
  }
}

function invalidateConfirmationTokenForDraft(draftId) {
  const normalizedDraftId = normalizeDraftId(draftId);
  if (!normalizedDraftId) {
    return;
  }

  const token = confirmationTokenByDraftId.get(normalizedDraftId);
  if (token) {
    confirmationSessions.delete(token);
    confirmationTokenByDraftId.delete(normalizedDraftId);
  }
}

function createConfirmationToken(session) {
  purgeExpiredConfirmationSessions();
  const draftId = normalizeDraftId(session?.draft_id);
  if (draftId) {
    invalidateConfirmationTokenForDraft(draftId);
  }
  const token = crypto.randomBytes(24).toString("hex");
  confirmationSessions.set(token, session);
  if (draftId) {
    confirmationTokenByDraftId.set(draftId, token);
  }
  return token;
}

function consumeConfirmationToken(token) {
  purgeExpiredConfirmationSessions();
  const session = confirmationSessions.get(token);
  if (!session) {
    return null;
  }
  const draftId = normalizeDraftId(session?.draft_id);
  if (draftId && confirmationTokenByDraftId.get(draftId) !== token) {
    confirmationSessions.delete(token);
    return null;
  }
  confirmationSessions.delete(token);
  if (draftId && confirmationTokenByDraftId.get(draftId) === token) {
    confirmationTokenByDraftId.delete(draftId);
  }
  return session;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    const bodyText = await response.text();
    let body = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = { error: bodyText.slice(0, 500) };
      }
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getGraphAccessToken(config) {
  const tokenUrl = `${GRAPH_TOKEN_URL_BASE}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const payload = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
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
    throw companyMailError(
      `No se pudo obtener token de Microsoft Graph para el envío de correo. Detalle: ${detail}`
    );
  }

  return response.body.access_token;
}

function buildMailPayload(draft) {
  return {
    message: {
      subject: draft.subject,
      body: {
        contentType: "Text",
        content: draft.body_text || draft.body_markdown || ""
      },
      toRecipients: [
        {
          emailAddress: {
            address: draft.recipient_email
          }
        }
      ]
    },
    saveToSentItems: true
  };
}

function validateDraftForMailSend(draft, config) {
  if (!draft) {
    throw companyMailError("Borrador no encontrado.");
  }
  if (draft.type !== "email") {
    throw companyMailError("Solo se pueden enviar borradores de tipo email.");
  }
  if (draft.status !== "reviewed") {
    throw companyMailError("Solo se pueden enviar borradores revisados.");
  }
  if (draft.send_status === "sent" || draft.sent_at) {
    throw companyMailError(
      "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
    );
  }
  if (draft.send_status === "sending") {
    throw companyMailError("El envío de este borrador está en curso.");
  }
  if (!normalizeText(draft.recipient_email)) {
    throw companyMailError("recipient_email es obligatorio para enviar correo.");
  }
  if (!normalizeText(draft.subject)) {
    throw companyMailError("subject es obligatorio para enviar correo.");
  }
  if (!normalizeText(draft.body_text || draft.body_markdown)) {
    throw companyMailError("body_text o body_markdown es obligatorio para enviar correo.");
  }

  const recipientEmail = extractEmailAddress(draft.recipient_email);
  if (!recipientEmail) {
    throw companyMailError("recipient_email no es válido.");
  }
  if (!isRecipientAllowed(recipientEmail, config.allowedDomains)) {
    throw companyMailError(
      `El dominio del destinatario no está permitido. Dominios permitidos: ${config.allowedDomains.join(", ")}.`
    );
  }

  return {
    recipientEmail,
    recipientDomain: getRecipientDomain(recipientEmail)
  };
}

export async function prepareCommunicationEmailSend(draftId) {
  const config = getGraphMailConfig();
  if (!config) {
    throw companyMailError(
      "Microsoft Graph Mail no está configurado. Revisa GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_MAIL_FROM_USER y EMAIL_ALLOWED_DOMAINS."
    );
  }

  const draft = await getCommunicationDraft(draftId);
  const validation = validateDraftForMailSend(draft, config);
  const preparedAt = new Date().toISOString();

  const updatedDraft = await updateCommunicationDraft(draft.id, {
    send_status: "prepared",
    send_prepared_at: preparedAt,
    send_attempt_at: null,
    sent_at: null,
    sent_by: null,
    from_user: config.fromUser,
    send_error: null,
    last_action_at: preparedAt
  });

  const confirmationToken = createConfirmationToken({
    draft_id: draft.id,
    draft_snapshot: {
      type: draft.type,
      status: draft.status,
      recipient_email: validation.recipientEmail,
      subject: normalizeText(draft.subject),
      body_text: normalizeText(draft.body_text),
      body_markdown: normalizeText(draft.body_markdown)
    },
    from_user: config.fromUser,
    createdAt: preparedAt,
    expiresAt: Date.now() + CONFIRMATION_TTL_MS
  });

  return {
    draft: updatedDraft,
    confirmation_token: confirmationToken,
    confirmation_required: true,
    from_user: config.fromUser,
    sent_by: null,
    allowed_domains: config.allowedDomains,
    recipient_domain: validation.recipientDomain,
    prepared_at: preparedAt
  };
}

export async function sendPreparedCommunicationEmail(draftId, confirmationToken, confirm = false) {
  if (!confirm) {
    throw companyMailError("Debes confirmar visualmente el envío antes de continuar.");
  }

  const config = getGraphMailConfig();
  if (!config) {
    throw companyMailError(
      "Microsoft Graph Mail no está configurado. Revisa GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_MAIL_FROM_USER y EMAIL_ALLOWED_DOMAINS."
    );
  }

  const draft = await getCommunicationDraft(draftId);
  const validation = validateDraftForMailSend(draft, config);
  const session = consumeConfirmationToken(confirmationToken);

  if (!session || session.draft_id !== draft.id) {
    throw companyMailError("La confirmación visual ya no es válida. Prepara el envío de nuevo.");
  }
  if (
    session.draft_snapshot?.recipient_email !== validation.recipientEmail ||
    session.draft_snapshot?.subject !== normalizeText(draft.subject) ||
    session.draft_snapshot?.body_text !== normalizeText(draft.body_text) ||
    session.draft_snapshot?.type !== draft.type ||
    session.draft_snapshot?.status !== draft.status
  ) {
    throw companyMailError("El borrador cambió tras la preparación. Vuelve a preparar el envío.");
  }

  const sendingAt = new Date().toISOString();
  await updateCommunicationDraft(draft.id, {
    send_status: "sending",
    send_prepared_at: draft.send_prepared_at || sendingAt,
    send_attempt_at: sendingAt,
    send_error: null,
    sent_by: "infra-agent-web",
    from_user: config.fromUser,
    last_action_at: sendingAt
  });

  const accessToken = await getGraphAccessToken(config);
  const response = await fetchJsonWithTimeout(
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(config.fromUser)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildMailPayload({
        ...draft,
        recipient_email: validation.recipientEmail
      }))
    },
    30000
  );

  if (!response.ok) {
    const detail =
      response.body?.error?.message ||
      response.body?.error_description ||
      response.body?.error ||
      `HTTP ${response.status}`;
    const failedAt = new Date().toISOString();
    await updateCommunicationDraft(draft.id, {
      send_status: "failed",
      send_attempt_at: sendingAt,
      send_error: sanitizeSensitiveText(detail),
      sent_by: "infra-agent-web",
      from_user: config.fromUser,
      last_action_at: failedAt
    });
    throw companyMailError(
      `Microsoft Graph no pudo enviar el correo. Detalle: ${sanitizeSensitiveText(detail)}`
    );
  }

  const sentAt = new Date().toISOString();
  const updatedDraft = await updateCommunicationDraft(draft.id, {
    send_status: "sent",
    send_attempt_at: sendingAt,
    sent_at: sentAt,
    send_error: null,
    sent_by: "infra-agent-web",
    from_user: config.fromUser,
    last_action_at: sentAt
  });

  return {
    draft: updatedDraft,
    from_user: config.fromUser,
    sent_by: "infra-agent-web",
    recipient_domain: validation.recipientDomain,
    sent_at: sentAt,
    graph_status: response.status
  };
}
