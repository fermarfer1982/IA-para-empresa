import { buildCommunicationDraftFromTemplate } from "../../../lib/communicationTemplates";
import { createCommunicationDraftFromIncident } from "../../../lib/communicationDraftCreator";
import { directSendCommunicationDraftFromIncident } from "../../../lib/communicationDirectSend";
import {
  createCommunicationDraft,
  getCommunicationDraft,
  getCommunicationDraftSummary
} from "../../../lib/reportsDb";
import {
  isCreatorRecipientIntent,
  resolveCommunicationRecipient
} from "../../../lib/communicationRecipientResolver";

function text(value) {
  return String(value || "").trim();
}

function normalized(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesAny(source, terms) {
  const haystack = normalized(source);
  return terms.some((term) => haystack.includes(normalized(term)));
}

function draftViewUrl(draftId) {
  const normalizedDraftId = text(draftId);
  return normalizedDraftId ? `/communications/drafts/${encodeURIComponent(normalizedDraftId)}` : "";
}

function isDirectSendRequest(transcript, requestedAction, directSendRequested) {
  const source = [transcript, requestedAction].join(" ");
  return Boolean(
    directSendRequested ||
      includesAny(source, [
        "envia directamente",
        "envía directamente",
        "manda directamente",
        "sin revisar",
        "envialo ya",
        "envíalo ya",
        "mandalo ya",
        "mándalo ya",
        "direct_send_creator_email",
        "send_creator_email",
        "communication_direct_send_request"
      ])
  );
}

function recipientDomain(email) {
  const parts = text(email).toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function extractEmail(value) {
  const match = text(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function canonicalResolvedRecipient(value = {}) {
  const source = value || {};
  const recipientEmail = extractEmail(
    source.recipient_email ||
      source.recipientEmail ||
      source.mail ||
      source.email ||
      source.userPrincipalName ||
      source.user_principal_name ||
      source.toEmail ||
      source.targetEmail
  );
  const recipientName = text(
    source.recipient_name ||
      source.recipientName ||
      source.recipient_label ||
      source.recipientLabel ||
      source.displayName ||
      source.display_name ||
      source.name ||
      source.mail ||
      source.email ||
      source.userPrincipalName ||
      source.user_principal_name
  );
  if (!recipientName && !recipientEmail) {
    return null;
  }
  return {
    recipient_name: recipientName || (recipientEmail ? recipientEmail.split("@")[0] : ""),
    recipient_email: recipientEmail,
    recipient_source: source.recipient_source || source.source || (recipientEmail ? "directory_unique_match" : "generic"),
    recipient_confidence: source.recipient_confidence ?? source.confidence ?? (recipientEmail ? 0.95 : 0)
  };
}

function finalRecipientLog({ recipient = {}, sourceIncidentId = "", intent = "" } = {}) {
  const recipientEmail = text(recipient.recipient_email);
  return {
    action: "voice_draft_final_recipient",
    intent: intent || "voice_prepare_communication_draft",
    has_resolved_recipient: Boolean(recipient.recipient_name || recipientEmail),
    recipient_source: recipient.recipient_source || recipient.source || "generic",
    recipient_name: text(recipient.recipient_name),
    has_recipient_email: Boolean(recipientEmail),
    recipient_domain: recipientDomain(recipientEmail),
    source_incident_id: text(sourceIncidentId)
  };
}

function isCreatorIncidentEmailRequest(transcript, requestedAction) {
  const source = [transcript, requestedAction].join(" ");
  return includesAny(source, [
    "email al creador",
    "correo al creador",
    "email del creador",
    "correo del creador",
    "email de esta incidencia",
    "correo de esta incidencia",
    "email de la incidencia",
    "correo de la incidencia",
    "avisa al creador",
    "avisar al creador",
    "manda correo al creador",
    "manda email al creador",
    "envia correo al creador",
    "envía correo al creador",
    "envia email al creador",
    "envía email al creador",
    "prepare_creator_email",
    "email_to_incident_creator",
    "direct_send_creator_email"
  ]);
}

function inferTemplateId(transcript, requestedAction) {
  const source = [transcript, requestedAction].join(" ");
  if (includesAny(source, ["proveedor", "provider"])) {
    return "proveedor";
  }
  if (includesAny(source, ["usuario final", "usuario", "user"])) {
    return "usuario_final";
  }
  if (includesAny(source, ["matriz", "correlacion", "correlación"])) {
    return "matriz_correlacion";
  }
  if (includesAny(source, ["riesgo critico", "riesgo crítico", "aviso critico", "aviso crítico"])) {
    return "aviso_riesgo_critico";
  }
  if (includesAny(source, ["tecnico", "técnico", "sistemas", "soporte"])) {
    return "tecnico_sistemas";
  }
  if (includesAny(source, ["incidencia", "seguimiento"])) {
    return "seguimiento_incidencia";
  }
  if (includesAny(source, ["ejecutivo", "direccion", "dirección", "directivo"])) {
    return "executive_direccion";
  }
  return "informe_diario";
}

function defaultRecipientForTemplate(templateId) {
  if (templateId === "executive_direccion") {
    return "Dirección";
  }
  if (templateId === "tecnico_sistemas" || templateId === "aviso_riesgo_critico") {
    return "Sistemas";
  }
  if (templateId === "proveedor") {
    return "Proveedor";
  }
  if (templateId === "usuario_final") {
    return "Usuario final";
  }
  return "Equipo interno";
}

async function createGenericVoiceDraft({ transcript, requestedAction, recipient = {} }) {
  const templateId = inferTemplateId(transcript, requestedAction);
  const summary = text(transcript) || "Borrador solicitado por voz.";
  const recipientName = text(recipient.recipient_name) || defaultRecipientForTemplate(templateId);
  const recipientEmail = text(recipient.recipient_email);
  const totalBefore = Number((await getCommunicationDraftSummary())?.total || 0);
  console.info("[communications] create communication draft", {
    action: "create_communication_draft",
    intent: requestedAction || templateId,
    recipient_source: recipient.recipient_source || recipient.source || "generic",
    recipient_confidence: recipient.recipient_confidence ?? recipient.confidence ?? "none",
    has_recipient_name: Boolean(recipientName),
    has_recipient_email: Boolean(recipientEmail),
    recipient_domain: recipientDomain(recipientEmail),
    source_incident_id: ""
  });
  console.info("[communications] voice draft final recipient", finalRecipientLog({
    recipient: {
      ...recipient,
      recipient_name: recipientName,
      recipient_email: recipientEmail
    },
    intent: requestedAction || templateId
  }));
  const { template, draft } = buildCommunicationDraftFromTemplate(templateId, {
    recipient_label: recipientName,
    recipient_email: recipientEmail,
    source_type: templateId === "seguimiento_incidencia" ? "incident" : "manual",
    custom_context: {
      summary,
      message: summary,
      recipient_query: recipient.query || "",
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_resolution_source: recipient.recipient_source || recipient.source || "generic",
      recipient_resolution_confidence: recipient.recipient_confidence ?? recipient.confidence ?? "none",
      report_date: new Date().toISOString(),
      voice_requested: true
    }
  });
  const saved = await createCommunicationDraft(draft);
  if (!saved?.id) {
    throw new Error("No se recibió draft_id tras insertar el borrador de voz.");
  }
  const verified = await getCommunicationDraft(saved.id);
  if (!verified?.id) {
    throw new Error("El borrador de voz se insertó pero no se pudo verificar por ID.");
  }
  const totalAfter = Number((await getCommunicationDraftSummary())?.total || 0);
  return {
    ok: true,
    action: "communication_draft_created",
    draft_id: verified.id,
    draft: verified,
    template,
    view_url: draftViewUrl(verified.id),
    recipient_email: verified.recipient_email,
    recipient_name: verified.recipient_name || verified.recipient_label,
    recipient_source: recipient.recipient_source || recipient.source || "generic",
    recipient_confidence: recipient.recipient_confidence ?? 0,
    recipient_resolution_source: recipient.recipient_source || recipient.source || "generic",
    recipient_resolution_confidence: recipient.recipient_confidence ?? recipient.confidence ?? "none",
    subject: verified.subject,
    status: verified.status,
    source_incident_id: verified.source_incident_id,
    total_before: totalBefore,
    total_after: totalAfter
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  const transcript = text(req.body?.transcript || req.body?.question || req.body?.message);
  const requestedAction = text(req.body?.requestedAction || req.body?.action || req.body?.intent);
  const requestedRecipientName = text(
    req.body?.requestedRecipientName ||
      req.body?.recipient_name ||
      req.body?.recipientName ||
      req.body?.recipient_label ||
      req.body?.recipientLabel ||
      req.body?.recipient_query ||
      req.body?.toName ||
      req.body?.to
  );
  const requestResolvedRecipient = canonicalResolvedRecipient(
    req.body?.resolvedRecipient ||
      req.body?.matchedContact ||
      req.body?.directoryRecipient ||
      req.body?.contact ||
      req.body?.person ||
      {
        recipient_name:
          req.body?.recipient_name ||
          req.body?.recipientName ||
          req.body?.recipient_label ||
          req.body?.recipientLabel ||
          req.body?.toName ||
          req.body?.to,
        recipient_email:
          req.body?.recipient_email ||
          req.body?.recipientEmail ||
          req.body?.toEmail ||
          req.body?.targetEmail,
        recipient_source: req.body?.recipient_source,
        recipient_confidence: req.body?.recipient_confidence
      }
  );
  const source = text(req.body?.source) || "voice";
  const deferDirectSendConfirmation =
    req.body?.deferDirectSendConfirmation === true ||
    req.body?.requireVoiceSendConfirmation === true;
  const directSendRequested = deferDirectSendConfirmation
    ? false
    : isDirectSendRequest(
        transcript,
        requestedAction,
        req.body?.directSendRequested === true || req.body?.confirm_direct_send === true
      );

  try {
    const creatorRequest =
      isCreatorIncidentEmailRequest(transcript, requestedAction) ||
      isCreatorRecipientIntent(transcript, requestedAction);
    console.info("[communications] voice-draft requested", {
      endpoint: "voice-draft",
      source,
      requested_action: requestedAction || "n/a",
      direct_send_requested: directSendRequested,
      creator_request: creatorRequest,
      has_current_incident_context: Boolean(req.body?.currentIncidentContext),
      transcript_length: transcript.length
    });

    if (creatorRequest || directSendRequested) {
      if (!creatorRequest && directSendRequested) {
        const recipient = await resolveCommunicationRecipient({
          transcript,
          requestedRecipientName,
          resolvedRecipient: requestResolvedRecipient,
          intent: requestedAction,
          currentIncidentContext: req.body?.currentIncidentContext,
          defaultRecipientName: defaultRecipientForTemplate(inferTemplateId(transcript, requestedAction))
        });
        if (recipient.needs_clarification) {
          return res.status(409).json({
            ok: false,
            error: `${recipient.error} Opciones: ${recipient.candidates
              .map((candidate) => [candidate.name, candidate.email].filter(Boolean).join(" <"))
              .filter(Boolean)
              .join(", ")}`
          });
        }
        if (!recipient.recipient_email) {
          return res.status(400).json({
            ok: false,
            error: recipient.query
              ? `No puedo enviarlo porque no tengo email para ${recipient.query}.`
              : "No puedo enviarlo directamente porque falta email destinatario."
          });
        }
        const created = await createGenericVoiceDraft({ transcript, requestedAction, recipient });
        const sent = await directSendCommunicationDraftFromIncident({
          draft_id: created.draft_id,
          source: "voice",
          confirm_direct_send: true,
          sentBy: "infra-agent-web"
        });
        return res.status(200).json({
          ...sent,
          ok: true,
          action: "communication_direct_sent",
          view_url: sent.view_url || draftViewUrl(sent.draft_id),
          recipient_name: sent.recipient_name || sent.draft?.recipient_label || "",
          recipient_email: sent.recipient_email,
          subject: sent.draft?.subject || "",
          status: sent.send_status || sent.draft?.status || "sent",
          source_incident_id: sent.source_incident_id || ""
        });
      }

      const recipient = await resolveCommunicationRecipient({
        transcript,
        requestedRecipientName,
        resolvedRecipient: requestResolvedRecipient,
        intent: requestedAction || "prepare_creator_email",
        currentIncidentContext: req.body?.currentIncidentContext,
        defaultRecipientName: "Creador de la incidencia"
      });
      const incident = recipient.incident || null;
      if (!recipient.source_incident_id) {
        return res.status(400).json({
          ok: false,
          error: recipient.error || "Necesito saber qué incidencia usar antes de preparar el correo."
        });
      }

      const creatorEmail = text(recipient.recipient_email);
      const creatorName = text(recipient.recipient_name || "Creador de la incidencia");

      if (directSendRequested) {
        if (!creatorEmail || !creatorEmail.includes("@")) {
          return res.status(400).json({
            ok: false,
            error: recipient.error || "No puedo enviarlo directamente porque falta email del creador."
          });
        }
        const sent = await directSendCommunicationDraftFromIncident({
          incidentId: recipient.source_incident_id,
          recipientEmail: creatorEmail,
          recipientName: creatorName,
          incidentTitle: incident.title || "",
          source: "voice",
          confirm_direct_send: true,
          sentBy: "infra-agent-web"
        });
        return res.status(200).json({
          ...sent,
          ok: true,
          action: "communication_direct_sent",
          view_url: sent.view_url || draftViewUrl(sent.draft_id),
          recipient_name: sent.recipient_name || sent.draft?.recipient_label || "",
          recipient_email: sent.recipient_email,
          subject: sent.draft?.subject || "",
          status: sent.send_status || sent.draft?.status || "sent",
          source_incident_id: sent.source_incident_id || String(recipient.source_incident_id || "")
        });
      }

      const created = await createCommunicationDraftFromIncident({
        incidentId: recipient.source_incident_id,
        recipientEmail: creatorEmail,
        recipientName: creatorName,
        incidentTitle: incident.title || "",
        action: "prepare_creator_email"
      });
      return res.status(201).json({
        ...created,
        ok: true,
        action: "communication_draft_created",
        view_url: created.view_url || draftViewUrl(created.draft_id),
        source_incident_id: created.source_incident_id || String(recipient.source_incident_id || ""),
        recipient_name: created.recipient_name || creatorName,
        recipient_email: created.recipient_email || creatorEmail,
        recipient_source: recipient.recipient_source || recipient.source,
        recipient_confidence: recipient.recipient_confidence ?? 0,
        recipient_resolution_source: recipient.recipient_source || recipient.source,
        recipient_resolution_confidence: recipient.recipient_confidence ?? 0
      });
    }

    const recipient = await resolveCommunicationRecipient({
      transcript,
      requestedRecipientName,
      resolvedRecipient: requestResolvedRecipient,
      intent: requestedAction,
      currentIncidentContext: req.body?.currentIncidentContext,
      defaultRecipientName: defaultRecipientForTemplate(inferTemplateId(transcript, requestedAction))
    });
    if (recipient.needs_clarification) {
      return res.status(409).json({
        ok: false,
        error: `${recipient.error} Opciones: ${recipient.candidates
          .map((candidate) => [candidate.name, candidate.email].filter(Boolean).join(" <"))
          .filter(Boolean)
          .join(", ")}`
      });
    }
    const created = await createGenericVoiceDraft({ transcript, requestedAction, recipient });
    return res.status(201).json(created);
  } catch (error) {
    console.info("[communications] voice-draft failed", {
      endpoint: "voice-draft",
      source,
      requested_action: requestedAction || "n/a",
      direct_send_requested: directSendRequested,
      error: error?.message || "No se pudo crear el borrador de voz."
    });
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo crear el borrador de voz."
    });
  }
}
