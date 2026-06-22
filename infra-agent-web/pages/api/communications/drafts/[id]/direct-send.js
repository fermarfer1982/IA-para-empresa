import { directSendCommunicationDraftFromIncident } from "../../../../../lib/communicationDirectSend";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  try {
    const draftId = req.query?.id || req.body?.draft_id || req.body?.draftId;
    const result = await directSendCommunicationDraftFromIncident({
      draft_id: draftId,
      draftId,
      source: req.body?.source || "voice",
      sent_by: req.body?.sent_by || req.body?.sentBy || "infra-agent-web",
      sentBy: req.body?.sent_by || req.body?.sentBy || "infra-agent-web",
      confirm_direct_send: req.body?.confirm_direct_send === true,
      confirmDirectSend: req.body?.confirm_direct_send === true
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo enviar directamente el borrador."
    });
  }
}
