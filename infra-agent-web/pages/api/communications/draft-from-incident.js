import { createCommunicationDraftFromIncident } from "../../../lib/communicationDraftCreator";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const result = await createCommunicationDraftFromIncident({
      incidentId: req.body?.incident_id || req.body?.incidentId || req.body?.source_incident_id,
      recipientEmail: req.body?.recipient_email || req.body?.recipientEmail,
      recipientName: req.body?.recipient_name || req.body?.recipientName || req.body?.recipient_label,
      incidentTitle: req.body?.incident_title || req.body?.incidentTitle || req.body?.title,
      subject: req.body?.subject,
      body: req.body?.body || req.body?.summary,
      action: req.body?.action || "prepare_creator_email"
    });

    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo crear el borrador desde la incidencia."
    });
  }
}
