import { buildCommunicationDraftFromTemplate } from "../../../lib/communicationTemplates";
import { createCommunicationDraft } from "../../../lib/reportsDb";

function draftViewUrl(draft) {
  const draftId = String(draft?.id || "").trim();
  return draftId ? `/communications/drafts/${encodeURIComponent(draftId)}` : "";
}

function safeText(value) {
  return String(value || "").trim();
}

function normalizedText(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function containsCreatorIncidentIntent(input = {}) {
  const joined = [
    input.action,
    input.intent,
    input.voice_intent,
    input.communication_action,
    input.template_key,
    input.template_id,
    input.source_type,
    input.source_incident_id,
    input.incident_id,
    input.recipient_label,
    input.recipient_query,
    input.subject,
    input.message,
    input.custom_context?.summary,
    input.custom_context?.message,
    input.custom_context?.creator_name,
    input.custom_context?.creator_email,
    input.custom_context?.incident_title
  ].join(" ");
  const text = normalizedText(joined);
  return (
    text.includes("creador") ||
    text.includes("creator") ||
    text.includes("correo de esta incidencia") ||
    text.includes("email de esta incidencia") ||
    text.includes("correo al creador") ||
    text.includes("email al creador") ||
    text.includes("avisa al creador") ||
    text.includes("avisar al creador")
  );
}

function isInvalidVoiceIncidentCreatorRoute(templateId, input = {}) {
  const source = normalizedText(input.source);
  const action = normalizedText(input.action || input.voice_intent || input.communication_action);
  const sourceType = normalizedText(input.source_type);
  const hasSourceIncidentId = Boolean(safeText(input.source_incident_id || input.incident_id));
  const hasRecipientEmail = safeText(
    input.recipient_email || input.custom_context?.creator_email
  ).includes("@");
  const templateKey = normalizedText(input.template_key || templateId);
  const isVoice = source.includes("voice");
  const isCreator = containsCreatorIncidentIntent(input);
  const isExplicitCreatorAction =
    action.includes("prepare_creator_email") ||
    action.includes("send_creator_email") ||
    action.includes("direct_send_creator_email") ||
    action.includes("email_to_incident_creator");
  const isIncidentTemplate =
    templateKey === "seguimiento_incidencia" ||
    sourceType === "incident" ||
    hasSourceIncidentId;

  return Boolean(
    (isVoice || isExplicitCreatorAction) &&
      (isCreator ||
        isExplicitCreatorAction ||
        action.includes("creator") ||
        action.includes("creador") ||
        (isIncidentTemplate && hasRecipientEmail))
  );
}

function isVoiceTemplateRoute(input = {}) {
  const source = normalizedText(input.source || input.event_source);
  const action = normalizedText(input.action || input.voice_intent || input.communication_action);
  return Boolean(
    input.requestedByVoice === true ||
      input.requested_by_voice === true ||
      source === "voice" ||
      source.includes("voice") ||
      action.includes("voice")
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const { template_id: templateId, ...input } = req.body || {};
    console.info("[communications] draft-from-template requested", {
      endpoint: "draft-from-template",
      source: safeText(input.source).slice(0, 40),
      action: safeText(input.action || input.voice_intent || input.communication_action).slice(0, 80),
      template_key: safeText(input.template_key || templateId).slice(0, 80),
      has_source_incident_id: Boolean(safeText(input.source_incident_id || input.incident_id)),
      has_recipient_email: Boolean(safeText(input.recipient_email || input.custom_context?.creator_email)),
      user_agent_hint: safeText(req.headers["user-agent"]).slice(0, 80)
    });
    if (isInvalidVoiceIncidentCreatorRoute(templateId, input)) {
      console.info("[communications] draft-from-template blocked", {
        endpoint: "draft-from-template",
        error_code: "voice_must_use_voice_draft_endpoint",
        source: safeText(input.source).slice(0, 40),
        action: safeText(input.action || input.voice_intent || input.communication_action).slice(0, 80),
        template_key: safeText(input.template_key || templateId).slice(0, 80),
        has_source_incident_id: Boolean(safeText(input.source_incident_id || input.incident_id)),
        has_recipient_email: Boolean(safeText(input.recipient_email || input.custom_context?.creator_email))
      });
      return res.status(400).json({
        ok: false,
        error: "voice_must_use_voice_draft_endpoint",
        expected_endpoint: "/api/communications/voice-draft"
      });
    }
    if (isVoiceTemplateRoute(input)) {
      console.info("[communications] draft-from-template blocked", {
        endpoint: "draft-from-template",
        error_code: "voice_must_use_voice_draft_endpoint",
        source: safeText(input.source).slice(0, 40),
        action: safeText(input.action || input.voice_intent || input.communication_action).slice(0, 80),
        template_key: safeText(input.template_key || templateId).slice(0, 80),
        has_source_incident_id: Boolean(safeText(input.source_incident_id || input.incident_id)),
        has_recipient_email: Boolean(safeText(input.recipient_email || input.custom_context?.creator_email))
      });
      return res.status(409).json({
        ok: false,
        error: "voice_must_use_voice_draft_endpoint",
        expected_endpoint: "/api/communications/voice-draft"
      });
    }
    if (!templateId) {
      return res.status(400).json({ error: "template_id es obligatorio." });
    }

    const { template, draft } = buildCommunicationDraftFromTemplate(templateId, input);
    const savedDraft = await createCommunicationDraft(draft);

    return res.status(201).json({
      ok: true,
      draft_id: savedDraft.id,
      template,
      draft: savedDraft,
      view_url: draftViewUrl(savedDraft)
    });
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo crear el borrador desde plantilla."
    });
  }
}
