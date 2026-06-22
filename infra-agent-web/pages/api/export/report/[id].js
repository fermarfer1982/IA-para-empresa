import { buildReportExport, sendExport } from "../../../../lib/exportReports";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const result = await buildReportExport(req.query.id, req.query);
    if (!result) {
      return res.status(404).json({ error: "Informe no encontrado." });
    }
    return sendExport(res, result);
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo exportar el informe."
    });
  }
}
