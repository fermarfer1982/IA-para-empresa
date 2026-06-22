import { interpretPowerBiQuestion, POWERBI_ASK_MODEL_KEY } from "../../../../../../lib/powerbiNlqInterpreter";

function normalizeModelKey(value) {
  const text = String(value || "").trim().toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const modelKey = normalizeModelKey(req.query?.modelKey);
  if (modelKey !== POWERBI_ASK_MODEL_KEY) {
    return res.status(400).json({
      ok: false,
      error: "v0.17.6 solo permite administracion_ventas."
    });
  }

  const question = String(req.body?.question || "").trim();
  return res.status(200).json(interpretPowerBiQuestion(question, { modelKey }));
}
