import { buildAnalyticsReports } from "../../../lib/analytics";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const reports = await buildAnalyticsReports({ days: req.query.days || 7 });
    return res.status(200).json(reports);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "No se pudo generar el resumen de informes."
    });
  }
}
