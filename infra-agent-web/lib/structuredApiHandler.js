import { generateStructuredReport } from "./structuredReports";

export function createStructuredHandler(kind) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Método no permitido." });
    }

    try {
      const result = await generateStructuredReport(kind);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(502).json({
        error: error?.message || "No se pudo generar el informe estructurado."
      });
    }
  };
}
