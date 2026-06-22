import { refreshPowerBiModelCatalog } from "../../../../../../lib/powerbiCatalog";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const { modelKey } = req.query;

  try {
    const payload = await refreshPowerBiModelCatalog(modelKey);
    return res.status(200).json(payload);
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error?.message || "No se pudo refrescar el catálogo del modelo." });
  }
}
