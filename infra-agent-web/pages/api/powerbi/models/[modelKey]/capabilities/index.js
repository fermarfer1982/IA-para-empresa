import { getPowerBiBusinessDictionary } from "../../../../../../lib/powerbiBusinessDictionary";
import { getPowerBiDaxLabStatus } from "../../../../../../lib/powerbiDaxLab";
import { getPowerBiModel } from "../../../../../../lib/powerbiModels";
import { buildPowerBiCapabilities } from "../../../../../../lib/powerbiCapabilities";

function normalizeModelKey(value) {
  const text = String(value || "").trim().toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : "";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const modelKey = normalizeModelKey(req.query?.modelKey);
  if (modelKey !== "administracion_ventas") {
    return res.status(400).json({
      ok: false,
      error: "v0.17.7.2 solo permite administracion_ventas."
    });
  }

  const model = getPowerBiModel(modelKey);
  if (!model) {
    return res.status(404).json({ ok: false, error: "Modelo Power BI no encontrado." });
  }

  try {
    const [dictionaryPayload, daxLabStatus] = await Promise.all([
      getPowerBiBusinessDictionary(modelKey),
      getPowerBiDaxLabStatus(modelKey)
    ]);

    const capabilities = buildPowerBiCapabilities({
      model,
      dictionary: dictionaryPayload?.dictionary || null,
      daxLabStatus: daxLabStatus || null
    });

    return res.status(200).json({
      ok: true,
      ...capabilities
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "No se pudieron construir las capacidades de Power BI."
    });
  }
}
