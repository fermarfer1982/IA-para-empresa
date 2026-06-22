export function createVoiceGetHandler(getPayload) {
  return async function handler(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Método no permitido." });
    }

    try {
      const payload = await getPayload(req);
      return res.status(200).json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message || "No se pudo generar la respuesta semántica."
      });
    }
  };
}
