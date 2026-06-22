import {
  getCommunicationDraft,
  getCommunicationDraftSummary,
  updateCommunicationDraft
} from "./reportsDb";
import { createCommunicationDraftFromIncident } from "./communicationDraftCreator";
import {
  extractCommunicationEmail,
  resolveCommunicationRecipient
} from "./communicationRecipientResolver";
import {
  prepareCommunicationEmailSend,
  sendPreparedCommunicationEmail
} from "./graphMail";

function text(value) {
  return String(value || "").trim();
}

function extractEmailDomain(email) {
  const normalized = text(email).toLowerCase();
  const parts = normalized.split("@");
  return parts.length === 2 ? parts[1] : "";
}

function isAllowedDomain(email) {
  const domains = text(process.env.EMAIL_ALLOWED_DOMAINS)
    .split(/[,\s;]+/)
    .map((domain) => domain.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  if (!domains.length) {
    return false;
  }

  const domain = extractEmailDomain(email);
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function communicationDraftViewUrl(draftId) {
  const normalized = text(draftId);
  return normalized ? `/communications/drafts/${encodeURIComponent(normalized)}` : "";
}

function safeAuditLog(prefix, payload) {
  console.info(prefix, payload);
}

async function getDraftTotal() {
  const summary = await getCommunicationDraftSummary();
  return Number(summary?.total || 0);
}

async function directSendDraftById({
  draftId,
  source = "chat",
  confirmDirectSend = true,
  sentBy = "infra-agent-web"
} = {}) {
  const normalizedDraftId = text(draftId);
  if (!normalizedDraftId) {
    throw new Error("draft_id es obligatorio para enviar directamente.");
  }
  if (confirmDirectSend !== true) {
    throw new Error("confirm_direct_send debe ser true para enviar directamente.");
  }

  const draft = await getCommunicationDraft(normalizedDraftId);
  if (!draft) {
    throw new Error("Borrador no encontrado.");
  }
  if (draft.send_status === "sent" || draft.sent_at) {
    throw new Error(
      "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
    );
  }
  if (!text(draft.recipient_email)) {
    throw new Error("recipient_email es obligatorio para enviar correo.");
  }
  if (!text(draft.subject)) {
    throw new Error("subject es obligatorio para enviar correo.");
  }
  if (!text(draft.body_text || draft.body_markdown)) {
    throw new Error("body_text o body_markdown es obligatorio para enviar correo.");
  }
  if (!isAllowedDomain(draft.recipient_email)) {
    throw new Error("El dominio del destinatario no está permitido.");
  }

  const now = new Date().toISOString();
  const totalBefore = await getDraftTotal();
  safeAuditLog("[communications] direct send requested", {
    direct_send_requested: true,
    direct_send_source: source,
    direct_send_requested_at: now,
    sent_by: sentBy,
    from_user: process.env.GRAPH_MAIL_FROM_USER ? "configured" : "unconfigured",
    recipient_email: draft.recipient_email,
    source_incident_id: draft.source_incident_id || ""
  });

  try {
    await updateCommunicationDraft(draft.id, {
      status: "reviewed",
      reviewed_at: now,
      reviewed_by: sentBy,
      last_action_at: now,
      direct_send_requested: 1,
      direct_send_source: source,
      direct_send_requested_at: now,
      direct_send_from_user: sentBy,
      direct_send_recipient_email: draft.recipient_email,
      direct_send_source_incident_id: draft.source_incident_id || "",
      direct_send_send_status: "requested",
      direct_send_send_attempt_at: null,
      direct_send_sent_at: null,
      direct_send_sent_by: sentBy,
      direct_send_send_error: null
    });

    const prepared = await prepareCommunicationEmailSend(draft.id);
    await updateCommunicationDraft(draft.id, {
      direct_send_requested: 1,
      direct_send_source: source,
      direct_send_requested_at: now,
      direct_send_from_user: sentBy,
      direct_send_recipient_email: draft.recipient_email,
      direct_send_source_incident_id: draft.source_incident_id || "",
      direct_send_send_status: "prepared",
      direct_send_send_attempt_at: now,
      direct_send_sent_by: sentBy,
      direct_send_send_error: null,
      last_action_at: now
    });

    const sent = await sendPreparedCommunicationEmail(
      draft.id,
      prepared.confirmation_token,
      true
    );

    const sentAt = sent?.sent_at || new Date().toISOString();
    const finalDraft = await updateCommunicationDraft(draft.id, {
      direct_send_requested: 1,
      direct_send_source: source,
      direct_send_requested_at: now,
      direct_send_from_user: sentBy,
      direct_send_recipient_email: draft.recipient_email,
      direct_send_source_incident_id: draft.source_incident_id || "",
      direct_send_send_status: "sent",
      direct_send_send_attempt_at: now,
      direct_send_sent_at: sentAt,
      direct_send_sent_by: sentBy,
      direct_send_send_error: null,
      last_action_at: sentAt
    });

    const totalAfter = await getDraftTotal();
    const viewUrl = communicationDraftViewUrl(finalDraft.id);

    safeAuditLog("[communications] direct send completed", {
      direct_send_requested: true,
      direct_send_source: source,
      direct_send_requested_at: now,
      sent_by: sentBy,
      recipient_email: finalDraft.recipient_email,
      source_incident_id: finalDraft.source_incident_id || "",
      draft_id: finalDraft.id,
      send_status: finalDraft.send_status,
      sent_at: finalDraft.sent_at || sentAt,
      total_before: totalBefore,
      total_after: totalAfter
    });

    return {
      ok: true,
      action: "communication_direct_sent",
      draft_id: finalDraft.id,
      draft: finalDraft,
      send_status: finalDraft.send_status || "sent",
      sent_at: finalDraft.sent_at || sentAt,
      recipient_name: finalDraft.recipient_label,
      recipient_email: finalDraft.recipient_email,
      source_incident_id: finalDraft.source_incident_id,
      view_url: viewUrl,
      total_before: totalBefore,
      total_after: totalAfter,
      direct_send_requested: true,
      direct_send_source: source
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    try {
      await updateCommunicationDraft(draft.id, {
        direct_send_requested: 1,
        direct_send_source: source,
        direct_send_requested_at: now,
        direct_send_from_user: sentBy,
        direct_send_recipient_email: draft.recipient_email,
        direct_send_source_incident_id: draft.source_incident_id || "",
        direct_send_send_status: "failed",
        direct_send_send_attempt_at: now,
        direct_send_sent_at: null,
        direct_send_sent_by: sentBy,
        direct_send_send_error: String(error?.message || "No se pudo enviar directamente.").slice(0, 4000),
        last_action_at: failedAt
      });
    } catch {
      // Best effort audit update.
    }

    safeAuditLog("[communications] direct send failed", {
      direct_send_requested: true,
      direct_send_source: source,
      direct_send_requested_at: now,
      sent_by: sentBy,
      recipient_email: draft.recipient_email,
      source_incident_id: draft.source_incident_id || "",
      draft_id: draft.id,
      error: error?.message || "No se pudo enviar directamente."
    });
    throw error;
  }
}

async function directSendDraftFromIncident({
  incidentId,
  recipientEmail,
  recipientName,
  incidentTitle = "",
  subject = "",
  body = "",
  source = "chat",
  sentBy = "infra-agent-web"
} = {}) {
  const normalizedIncidentId = text(incidentId);
  if (!normalizedIncidentId) {
    throw new Error("source_incident_id es obligatorio para enviar directamente.");
  }
  const recipient = await resolveCommunicationRecipient({
    transcript: [recipientName, recipientEmail, subject, body].filter(Boolean).join(" "),
    requestedRecipientName: recipientName,
    currentIncidentContext: {
      incidentId: normalizedIncidentId,
      title: incidentTitle,
      creator_name: recipientName,
      creator_email: recipientEmail
    },
    intent: "direct_send_creator_email",
    defaultRecipientName: "Creador de la incidencia"
  });
  const resolvedRecipientEmail = extractCommunicationEmail(recipientEmail || recipient.recipient_email);
  const resolvedRecipientName = text(recipientName || recipient.recipient_name) || "Creador de la incidencia";
  if (!resolvedRecipientEmail) {
    throw new Error(recipient.error || "recipient_email es obligatorio para enviar correo.");
  }

  const totalBefore = await getDraftTotal();
  safeAuditLog("[communications] direct send requested", {
    direct_send_requested: true,
    direct_send_source: source,
    incident_id: normalizedIncidentId,
    has_creator_email: Boolean(resolvedRecipientEmail),
    recipient_domain: extractEmailDomain(resolvedRecipientEmail),
    recipient_source: recipient.source || "unknown"
  });

  const created = await createCommunicationDraftFromIncident({
    incidentId: normalizedIncidentId,
    recipientEmail: resolvedRecipientEmail,
    recipientName: resolvedRecipientName,
    incidentTitle,
    subject,
    body,
    action: "direct_send_creator_email"
  });

  const sent = await directSendDraftById({
    draftId: created.draft_id,
    source,
    confirmDirectSend: true,
    sentBy
  });

  return {
    ...sent,
    total_before: totalBefore,
    total_after: sent.total_after
  };
}

export async function directSendCommunicationDraftFromIncident(payload = {}) {
  if (payload?.draftId || payload?.draft_id) {
    return directSendDraftById({
      draftId: payload.draftId || payload.draft_id,
      source: payload.source || "chat",
      confirmDirectSend: payload.confirm_direct_send !== false,
      sentBy: payload.sent_by || payload.sentBy || "infra-agent-web"
    });
  }

  return directSendDraftFromIncident({
    incidentId: payload?.incidentId || payload?.incident_id || payload?.source_incident_id,
    recipientEmail: payload?.recipientEmail || payload?.recipient_email,
    recipientName: payload?.recipientName || payload?.recipient_name || payload?.recipient_label,
    incidentTitle: payload?.incidentTitle || payload?.incident_title || payload?.title || "",
    subject: payload?.subject || "",
    body: payload?.body || payload?.summary || "",
    source: payload?.source || "chat",
    sentBy: payload?.sent_by || payload?.sentBy || "infra-agent-web"
  });
}
