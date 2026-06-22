import { directSendCommunicationDraftFromIncident } from "../../../lib/communicationDirectSend";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const result = await directSendCommunicationDraftFromIncident({
      incident_id: req.body?.incident_id || req.body?.incidentId || req.body?.source_incident_id,
      incidentId: req.body?.incident_id || req.body?.incidentId || req.body?.source_incident_id,
      draft_id: req.body?.draft_id || req.body?.draftId,
      draftId: req.body?.draft_id || req.body?.draftId,
      recipient_email: req.body?.recipient_email || req.body?.recipientEmail,
      recipientEmail: req.body?.recipient_email || req.body?.recipientEmail,
      recipient_name: req.body?.recipient_name || req.body?.recipientName || req.body?.recipient_label,
      recipientName: req.body?.recipient_name || req.body?.recipientName || req.body?.recipient_label,
      incident_title: req.body?.incident_title || req.body?.incidentTitle || req.body?.title,
      incidentTitle: req.body?.incident_title || req.body?.incidentTitle || req.body?.title,
      subject: req.body?.subject,
      body: req.body?.body || req.body?.summary,
      source: req.body?.source || "chat",
      sent_by: req.body?.sent_by || req.body?.sentBy,
      sentBy: req.body?.sent_by || req.body?.sentBy,
      confirm_direct_send: req.body?.confirm_direct_send === true,
      confirmDirectSend: req.body?.confirm_direct_send === true
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo enviar directamente el correo."
    });
  }
}

