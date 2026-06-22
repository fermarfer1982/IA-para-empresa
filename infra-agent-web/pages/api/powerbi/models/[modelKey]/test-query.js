import { testPowerBiModelQuery } from "../../../../../lib/powerbiCatalog";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const result = await testPowerBiModelQuery(req.query.modelKey);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error?.statusCode === 404 ? 404 : 400).json({
      ok: false,
      error: error?.message || "No se pudo ejecutar la consulta mínima del modelo."
    });
  }
}
