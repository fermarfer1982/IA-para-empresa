import { generateBusinessDictionaryDraft } from "../../../../../../lib/powerbiBusinessDictionary";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const { modelKey } = req.query;

  try {
    const payload = await generateBusinessDictionaryDraft(modelKey);
    return res.status(payload.ok ? 200 : 400).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "No se pudo generar el borrador del diccionario."
    });
  }
}
