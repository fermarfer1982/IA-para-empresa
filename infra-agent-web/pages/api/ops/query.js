import { handleOpsVoiceCommand, routeOpsChatQuestion } from "../../../lib/opsIntentRouter";
import { createCommunicationDraftFromIncident } from "../../../lib/communicationDraftCreator";
import { withPermission } from "../../../lib/security/apiAuth";
import { auditEvent } from "../../../lib/security/auditLogger";

function firstIncidentFromResult(result) {
  const visual = result?.visualResult || null;
  if (visual?.item) {
    return visual.item;
  }
  if (Array.isArray(visual?.items) && visual.items.length) {
    return visual.items[0];
  }
  return null;
}

async function maybeCreateCreatorDraft(result) {
  const visual = result?.visualResult || null;
  if (
    result?.unsupported ||
    visual?.action !== "prepare_creator_email" ||
    result?.draft_id ||
    visual?.draft_id
  ) {
    return result;
  }

  const incident = firstIncidentFromResult(result);
  const incidentId = String(incident?.id || incident?.incidentId || "").trim();
  const creatorEmail = String(
    visual?.creator_email || incident?.creator_email || incident?.created_by_email || ""
  ).trim();
  const creatorName = String(
    visual?.creator_name || incident?.creator_name || incident?.created_by_name || incident?.requester || ""
  ).trim();

  if (!incidentId) {
    return result;
  }

  const draftResult = await createCommunicationDraftFromIncident({
    incidentId,
    recipientEmail: creatorEmail,
    recipientName: creatorName,
    incidentTitle: incident?.title || "",
    action: "prepare_creator_email"
  });
  const message = `Borrador #${draftResult.draft_id} creado. No se ha enviado nada. Abriendo la revisión del borrador.`;

  return {
    ...result,
    spokenResponse: message,
    draft_id: draftResult.draft_id,
    draft: draftResult.draft,
    view_url: draftResult.view_url,
    recipient_email: draftResult.recipient_email,
    subject: draftResult.subject,
    status: draftResult.status,
    source_incident_id: draftResult.source_incident_id,
    total_before: draftResult.total_before,
    total_after: draftResult.total_after,
    visualResult: {
      ...visual,
      summary: message,
      draft_id: draftResult.draft_id,
      view_url: draftResult.view_url,
      draft_status: draftResult.status
    }
  };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método no permitido." });
  }

  const question = String(req.body?.question || "").trim();
  const mode = String(req.body?.mode || "chat").trim().toLowerCase();
  const context = req.body?.context || null;
  const source = String(req.body?.source || mode || "chat").trim().toLowerCase();
  const securityContext = req.security?.user
    ? {
        userId: req.security.user.userId || req.security.user.id || null,
        displayName: req.security.user.displayName || req.security.user.username || null,
        roles: req.security.user.roles || [],
        permissions: req.security.user.permissions || []
      }
    : null;
  try {
    const result =
      mode === "voice"
        ? await handleOpsVoiceCommand(question, {
            currentIncidentContext: { ...(context || {}), source },
            source,
            securityContext
          })
        : await routeOpsChatQuestion(question, {
            currentIncidentContext: { ...(context || {}), source },
            source,
            securityContext
          });
    const finalResult = await maybeCreateCreatorDraft(result);
    auditEvent({
      req,
      user: req.security?.user,
      action: "agent_query",
      resource: "ops:query",
      allowed: true,
      details: {
        mode,
        source,
        questionLength: question.length,
        kind: finalResult?.kind || finalResult?.type || finalResult?.visualResult?.kind || null,
        handled: Boolean(finalResult?.handled || finalResult?.routed)
      }
    });
    return res.status(200).json(finalResult);
  } catch (error) {
    auditEvent({
      req,
      user: req.security?.user,
      action: "agent_query",
      resource: "ops:query",
      allowed: false,
      details: { mode, source, questionLength: question.length, reason: "exception" }
    });
    return res.status(500).json({
      ok: false,
      error: error?.message || "No se pudo resolver la consulta operativa."
    });
  }
}

export default withPermission(handler, "agent:ask", {
  action: "agent_query_permission",
  resource: "ops:query"
});
