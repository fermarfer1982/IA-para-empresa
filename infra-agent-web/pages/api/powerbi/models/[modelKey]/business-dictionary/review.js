import { getPowerBiBusinessDictionaryReview } from "../../../../../../lib/powerbiBusinessDictionary";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const { modelKey } = req.query;

  try {
    const payload = await getPowerBiBusinessDictionaryReview(modelKey);
    return res.status(payload.ok ? 200 : 400).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "No se pudo revisar el diccionario de negocio."
    });
  }
}
