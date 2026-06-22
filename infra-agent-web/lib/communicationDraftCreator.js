import { buildCommunicationDraftFromTemplate } from "./communicationTemplates";
import { createCommunicationDraft, getCommunicationDraft, getCommunicationDraftSummary } from "./reportsDb";
import {
  extractCommunicationEmail,
  resolveCommunicationRecipient
} from "./communicationRecipientResolver";

function text(value) {
  return String(value || "").trim();
}

function extractEmailAddress(value) {
  const raw = text(value);
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function recipientDomain(email) {
  const normalized = extractEmailAddress(email);
  const parts = normalized.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : "";
}

function allowedDomains() {
  return text(process.env.EMAIL_ALLOWED_DOMAINS)
    .split(",")
    .map((domain) => domain.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function assertRecipientAllowed(email) {
  const normalizedEmail = extractEmailAddress(email);
  if (!normalizedEmail) {
    throw new Error("recipient_email es obligatorio y debe ser válido.");
  }

  const domain = recipientDomain(normalizedEmail);
  const domains = allowedDomains();
  if (domains.length && !domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) {
    throw new Error("El dominio del destinatario no está permitido.");
  }

  return {
    recipient_email: normalizedEmail,
    recipient_domain: domain
  };
}

function validateRecipientIfPresent(email) {
  const normalizedEmail = extractEmailAddress(email);
  if (!normalizedEmail) {
    return {
      recipient_email: "",
      recipient_domain: ""
    };
  }
  return assertRecipientAllowed(normalizedEmail);
}

function draftViewUrl(draft) {
  const draftId = text(draft?.id);
  return draftId ? `/communications/drafts/${encodeURIComponent(draftId)}` : "";
}

async function getDraftTotal() {
  const summary = await getCommunicationDraftSummary();
  return Number(summary?.total || 0);
}

export async function createCommunicationDraftFromIncident({
  incidentId,
  recipientEmail,
  recipientName,
  incidentTitle = "",
  subject = "",
  body = "",
  action = "prepare_creator_email"
} = {}) {
  const normalizedIncidentId = text(incidentId);
  if (!normalizedIncidentId) {
    throw new Error("source_incident_id es obligatorio para preparar email al creador.");
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
    intent: action || "prepare_creator_email",
    defaultRecipientName: "Creador de la incidencia"
  });
  const resolvedEmail = extractCommunicationEmail(recipient.recipient_email || recipientEmail);
  const validation = validateRecipientIfPresent(resolvedEmail);
  const recipientLabel = text(
    validation.recipient_email
      ? recipient.recipient_name || recipientName
      : recipientName || recipient.recipient_name
  ) || "Creador de la incidencia";
  const totalBefore = await getDraftTotal();

  console.info("[communications] create communication draft", {
    action: "create_communication_draft",
    intent: action,
    recipient_source: recipient.recipient_source || recipient.source || "unknown",
    recipient_confidence: recipient.recipient_confidence ?? recipient.confidence ?? "none",
    has_recipient_name: Boolean(recipientLabel),
    has_recipient_email: Boolean(validation.recipient_email),
    recipient_domain: validation.recipient_domain,
    source_incident_id: normalizedIncidentId
  });

  console.info("[communications] create incident draft requested", {
    action,
    incident_id: normalizedIncidentId,
    has_creator_email: Boolean(validation.recipient_email),
    recipient_domain: validation.recipient_domain,
    recipient_source: recipient.source || "unknown"
  });
  console.info("[communications] voice draft final recipient", {
    action: "voice_draft_final_recipient",
    intent: action,
    has_resolved_recipient: Boolean(recipientLabel || validation.recipient_email),
    recipient_source: recipient.recipient_source || recipient.source || "unknown",
    recipient_name: recipientLabel,
    has_recipient_email: Boolean(validation.recipient_email),
    recipient_domain: validation.recipient_domain,
    source_incident_id: normalizedIncidentId
  });

  try {
    const { draft } = buildCommunicationDraftFromTemplate("seguimiento_incidencia", {
      recipient_label: recipientLabel,
      recipient_email: validation.recipient_email,
      source_type: "incident",
      source_incident_id: normalizedIncidentId,
      subject: text(subject),
      custom_context: {
        incident_id: normalizedIncidentId,
        incident_title: text(incidentTitle),
        creator_name: recipientLabel,
        creator_email: validation.recipient_email,
        recipient_resolution_source: recipient.source || "",
        recipient_resolution_confidence: recipient.confidence || "",
        summary: text(body)
      }
    });

    const savedDraft = await createCommunicationDraft(draft);
    if (!savedDraft?.id) {
      throw new Error("No se recibió draft_id tras insertar el borrador.");
    }

    const verifiedDraft = await getCommunicationDraft(savedDraft.id);
    if (!verifiedDraft?.id) {
      throw new Error("El borrador se insertó pero no se pudo verificar por ID.");
    }

    const totalAfter = await getDraftTotal();
    const viewUrl = draftViewUrl(verifiedDraft);

    console.info("[communications] create incident draft completed", {
      action,
      incident_id: normalizedIncidentId,
      has_creator_email: Boolean(validation.recipient_email),
      recipient_domain: validation.recipient_domain,
      recipient_source: recipient.source || "unknown",
      draft_created: true,
      draft_id: verifiedDraft.id,
      total_before: totalBefore,
      total_after: totalAfter
    });

    return {
      ok: true,
      draft_id: verifiedDraft.id,
      draft: verifiedDraft,
      view_url: viewUrl,
      recipient_name: verifiedDraft.recipient_name || verifiedDraft.recipient_label,
      recipient_email: verifiedDraft.recipient_email,
      subject: verifiedDraft.subject,
      status: verifiedDraft.status,
      source_incident_id: verifiedDraft.source_incident_id,
      total_before: totalBefore,
      total_after: totalAfter
    };
  } catch (error) {
    console.info("[communications] create incident draft failed", {
      action,
      incident_id: normalizedIncidentId,
      has_creator_email: Boolean(validation.recipient_email),
      recipient_domain: validation.recipient_domain,
      recipient_source: recipient.source || "unknown",
      draft_created: false,
      error: error?.message || "No se pudo crear el borrador."
    });
    throw error;
  }
}
