import { sendPreparedCommunicationEmail } from "../../../lib/graphMail";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const draftId = req.body?.draft_id || req.body?.draftId;
    const confirmationToken =
      req.body?.confirmation_token || req.body?.confirmationToken || req.body?.token || "";
    const confirm = req.body?.confirm === true || req.body?.confirm === "true";

    if (!draftId) {
      return res.status(400).json({ error: "draft_id es obligatorio." });
    }
    if (!confirmationToken) {
      return res.status(400).json({ error: "confirmation_token es obligatorio." });
    }

    const result = await sendPreparedCommunicationEmail(draftId, confirmationToken, confirm);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo enviar el correo."
    });
  }
}
