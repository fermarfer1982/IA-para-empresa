import { getPowerBiStatus } from "../../../lib/powerbiCatalog";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const status = await getPowerBiStatus();
    return res.status(200).json({ ok: true, status });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo consultar el estado de Power BI."
    });
  }
}
