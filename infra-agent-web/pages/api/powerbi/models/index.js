import { listPowerBiCatalog } from "../../../../lib/powerbiCatalog";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const models = await listPowerBiCatalog();
    return res.status(200).json({ ok: true, models, total: models.length });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo listar los modelos de Power BI."
    });
  }
}
