import fs from "fs";
import path from "path";

const POWERBI_MODELS_PATH = path.join(process.cwd(), "config", "powerbi-models.json");

let cachedModels = null;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function normalizeModel(model) {
  const key = normalizeText(model?.key).toLowerCase();
  const displayName = normalizeText(model?.displayName);
  const area = normalizeText(model?.area);
  const workspaceId = normalizeText(model?.workspaceId);
  const datasetId = normalizeText(model?.datasetId);
  const description = normalizeText(model?.description);

  if (!key || !displayName || !area || !workspaceId || !datasetId) {
    return null;
  }

  return {
    key,
    displayName,
    area,
    workspaceId,
    datasetId,
    enabled: normalizeBoolean(model?.enabled),
    description: description || null
  };
}

function loadPowerBiModelsFromDisk() {
  try {
    const raw = fs.readFileSync(POWERBI_MODELS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeModel).filter(Boolean);
  } catch {
    return [];
  }
}

export function listPowerBiModels() {
  if (!cachedModels) {
    cachedModels = loadPowerBiModelsFromDisk();
  }
  return [...cachedModels];
}

export function listEnabledPowerBiModels() {
  return listPowerBiModels().filter((model) => model.enabled);
}

export function getPowerBiModel(modelKey) {
  const key = normalizeText(modelKey).toLowerCase();
  if (!key) {
    return null;
  }
  return listPowerBiModels().find((model) => model.key === key) || null;
}

export function getPowerBiModelSummary() {
  const models = listPowerBiModels();
  const enabledModels = models.filter((model) => model.enabled);
  return {
    total: models.length,
    enabled: enabledModels.length,
    disabled: Math.max(0, models.length - enabledModels.length)
  };
}

export function getPowerBiPublicModelList() {
  return listPowerBiModels().map((model) => ({
    key: model.key,
    displayName: model.displayName,
    area: model.area,
    enabled: model.enabled,
    description: model.description
  }));
}
