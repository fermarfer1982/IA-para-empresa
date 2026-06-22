import { applyPowerBiBusinessDictionaryPatch } from "../../../../../../lib/powerbiBusinessDictionary";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const { modelKey } = req.query;

  try {
    const payload = await applyPowerBiBusinessDictionaryPatch(modelKey, req.body?.patch || req.body);
    return res.status(payload.ok ? 200 : 400).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "No se pudo aplicar el parche del diccionario."
    });
  }
}
