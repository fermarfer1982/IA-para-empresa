import { getPowerBiModelDataset } from "../../../../../lib/powerbiCatalog";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const dataset = await getPowerBiModelDataset(req.query.modelKey);
    return res.status(200).json(dataset);
  } catch (error) {
    return res.status(error?.statusCode === 404 ? 404 : 400).json({
      ok: false,
      error: error?.message || "No se pudo consultar el dataset del modelo."
    });
  }
}
