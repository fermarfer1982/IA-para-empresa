import { prepareCommunicationEmailSend } from "../../../lib/graphMail";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const draftId = req.body?.draft_id || req.body?.draftId;
    if (!draftId) {
      return res.status(400).json({ error: "draft_id es obligatorio." });
    }

    const result = await prepareCommunicationEmailSend(draftId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo preparar el envío."
    });
  }
}
