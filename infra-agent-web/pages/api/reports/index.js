import { createReport, searchReports } from "../../../lib/reportsDb";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const reports = await searchReports({
        limit: req.query.limit || 10,
        type: req.query.type,
        query: req.query.query,
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        today: req.query.today,
        days: req.query.days
      });
      return res.status(200).json({ reports });
    }

    if (req.method === "POST") {
      const report = await createReport(req.body || {});
      return res.status(201).json({ report });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método no permitido." });
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo procesar el informe."
    });
  }
}
