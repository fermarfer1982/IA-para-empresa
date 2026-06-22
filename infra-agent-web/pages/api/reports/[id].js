import { getReport } from "../../../lib/reportsDb";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const report = await getReport(req.query.id);

  if (!report) {
    return res.status(404).json({ error: "Informe no encontrado." });
  }

  return res.status(200).json({ report });
}
