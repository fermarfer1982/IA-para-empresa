import { buildAnalyticsSummary } from "../../../lib/analytics";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const summary = await buildAnalyticsSummary({ days: req.query.days || 14 });
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "No se pudo generar el resumen analítico."
    });
  }
}
