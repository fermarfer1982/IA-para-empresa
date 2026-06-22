import { getPowerBiModelCatalog } from "../../../../../../lib/powerbiCatalog";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const { modelKey } = req.query;

  try {
    const payload = await getPowerBiModelCatalog(modelKey);
    return res.status(payload.ok === false && !payload.catalogAvailable ? 200 : 200).json(payload);
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error?.message || "No se pudo consultar el catálogo del modelo." });
  }
}
