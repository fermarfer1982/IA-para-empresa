import {
  getPowerBiStatus,
  getPowerBiModelCatalog,
  getPowerBiModelStatus
} from "./powerbiCatalog";
import { getPowerBiBusinessDictionary, getPowerBiBusinessDictionaryQuality } from "./powerbiBusinessDictionary";
import { getPowerBiDaxLabStatus } from "./powerbiDaxLab";
import { getPowerBiModel, listEnabledPowerBiModels } from "./powerbiModels";
import { POWERBI_ASK_MODEL_KEY } from "./powerbiNlqInterpreter";

const REQUEST_TIMEOUT_MS = 3500;

function normalizeText(value) {
  return String(value || "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function withTimeout(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), REQUEST_TIMEOUT_MS);
    })
  ]);
}

function pickModel() {
  const enabledModels = listEnabledPowerBiModels();
  if (enabledModels.length) {
    return enabledModels.find((model) => model.key === POWERBI_ASK_MODEL_KEY) || enabledModels[0];
  }
  return getPowerBiModel(POWERBI_ASK_MODEL_KEY) || null;
}

function formatInteger(value, fallback = "—") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return new Intl.NumberFormat("es-ES").format(parsed);
}

function buildKpi(label, value, detail) {
  return {
    label,
    value: value === null || value === undefined || value === "" ? "—" : String(value),
    detail: detail || ""
  };
}

function getModelText(model) {
  return normalizeText(model?.displayName || model?.key || "Power BI");
}

function buildSuggestedQuestionsForModel(model) {
  const modelName = getModelText(model);
  const isSalesModel = /venta|ventas|comercial|sales/i.test(`${model?.key || ""} ${modelName}`);

  return (isSalesModel
    ? ["Ventas por mes", "Top variedades", "Clientes principales", "Comparativa por periodo"]
    : [
        "¿Qué métricas están disponibles?",
        "¿Qué dimensiones puedo usar?",
        "¿Qué informes están asociados?",
        "¿Qué comparativas son posibles?"
      ]
  ).slice(0, 4);
}

function buildCatalogSummary(modelCatalog) {
  const summary = modelCatalog?.summary || {};
  const tables = Number.isFinite(summary.tables) ? summary.tables : safeArray(modelCatalog?.tables).length;
  const columns = Number.isFinite(summary.columns) ? summary.columns : safeArray(modelCatalog?.columns).length;
  const measures = Number.isFinite(summary.measures) ? summary.measures : safeArray(modelCatalog?.measures).length;
  const relationships = Number.isFinite(summary.relationships)
    ? summary.relationships
    : safeArray(modelCatalog?.relationships).length;
  const hierarchies = Number.isFinite(summary.hierarchies) ? summary.hierarchies : safeArray(modelCatalog?.hierarchies).length;

  return {
    ...summary,
    tables,
    columns,
    measures,
    relationships,
    hierarchies
  };
}

function buildBusinessSummary({
  model,
  status,
  modelCatalog,
  modelStatus,
  dictionary,
  quality
}) {
  const catalogSummary = buildCatalogSummary(modelCatalog);
  const dictionarySummary = quality?.summary || {};
  const modelName = getModelText(model);
  const summaryPieces = [];

  if (status === "connected") {
    summaryPieces.push(`Modelo conectado: ${modelName}.`);
    summaryPieces.push("Modelo semántico disponible para consultas comerciales.");
  } else if (status === "fallback") {
    summaryPieces.push(`Modelo parcialmente disponible: ${modelName}.`);
    summaryPieces.push("Se muestran metadatos reales mientras termina la conexión completa.");
  } else {
    summaryPieces.push("Resumen ejecutivo de Power BI pendiente de conexión completa.");
  }

  if (catalogSummary.tables || catalogSummary.measures || catalogSummary.relationships) {
    summaryPieces.push(
      `Tablas detectadas: ${formatInteger(catalogSummary.tables)} · Medidas detectadas: ${formatInteger(
        catalogSummary.measures
      )} · Relaciones detectadas: ${formatInteger(catalogSummary.relationships)}.`
    );
  }

  if (modelStatus?.reportsDetected || safeArray(modelStatus?.reports).length) {
    summaryPieces.push(
      `Informes asociados: ${formatInteger(modelStatus?.reportsDetected ?? safeArray(modelStatus?.reports).length)}.`
    );
  }

  if (dictionarySummary.metrics || dictionarySummary.dimensions || dictionarySummary.dates) {
    summaryPieces.push(
      `Diccionario funcional: ${formatInteger(dictionarySummary.metrics)} métricas, ${formatInteger(
        dictionarySummary.dimensions
      )} dimensiones y ${formatInteger(dictionarySummary.dates)} de fecha.`
    );
  }

  const highlights = [];
  if (catalogSummary.tables) highlights.push(`Tablas: ${formatInteger(catalogSummary.tables)}`);
  if (catalogSummary.measures) highlights.push(`Medidas: ${formatInteger(catalogSummary.measures)}`);
  if (catalogSummary.relationships) highlights.push(`Relaciones: ${formatInteger(catalogSummary.relationships)}`);
  if (modelStatus?.reportsDetected ?? safeArray(modelStatus?.reports).length) {
    highlights.push(`Informes: ${formatInteger(modelStatus?.reportsDetected ?? safeArray(modelStatus?.reports).length)}`);
  }
  if (dictionarySummary.metrics) highlights.push(`Métricas funcionales: ${formatInteger(dictionarySummary.metrics)}`);

  const watchItems = uniqueTexts([
    ...(Array.isArray(quality?.issues) ? quality.issues : []),
    ...(Array.isArray(dictionary?.warnings) ? dictionary.warnings : [])
  ]).slice(0, 3);

  return {
    title: status === "connected" ? "Lectura ejecutiva" : "Lectura ejecutiva pendiente",
    summary: summaryPieces.join(" ").trim(),
    highlights,
    watchItems,
    suggestedQuestions: buildSuggestedQuestionsForModel(model)
  };
}

function buildFallbackSummary({
  generatedAt,
  status = "not_connected",
  source = "fallback",
  modelKey = null,
  modelName = null,
  headline = "Power BI pendiente de conexión",
  message = "Power BI pendiente de conexion en esta pantalla"
}) {
  return {
    status,
    source,
    modelKey,
    modelName,
    headline,
    message,
    kpis: [],
    insights: [],
    updatedAt: generatedAt,
    businessSummary: {
      title: "Lectura ejecutiva pendiente",
      summary: message,
      highlights: [],
      watchItems: [],
      suggestedQuestions: []
    }
  };
}

function uniqueTexts(values) {
  return [...new Set(safeArray(values).map((item) => normalizeText(item)).filter(Boolean))];
}

function buildInsights({
  model,
  modelCatalog,
  modelStatus,
  dictionary,
  quality,
  daxLabStatus,
  powerbiStatus
}) {
  const insights = [];
  const catalogSummary = buildCatalogSummary(modelCatalog);
  const dictionarySummary = quality?.summary || {};
  const reports = safeArray(modelStatus?.reports);
  const reportNames = reports.map((report) => normalizeText(report?.name || report?.title)).filter(Boolean);

  if (model?.displayName && (catalogSummary.tables || catalogSummary.measures || catalogSummary.relationships)) {
    insights.push(
      `${model.displayName}: ${formatInteger(catalogSummary.tables)} tablas, ${formatInteger(catalogSummary.measures)} medidas y ${formatInteger(catalogSummary.relationships)} relaciones catalogadas.`
    );
  }

  if (dictionarySummary.dimensions || dictionarySummary.metrics || dictionarySummary.dates) {
    insights.push(
      `Diccionario funcional: ${formatInteger(dictionarySummary.metrics)} métricas, ${formatInteger(dictionarySummary.dimensions)} dimensiones y ${formatInteger(dictionarySummary.dates)} dimensiones de fecha.`
    );
  }

  if (reports.length) {
    const reportLabel = reportNames.slice(0, 2).join(", ");
    insights.push(
      `Informes detectados: ${formatInteger(reports.length)}${reportLabel ? ` · ${reportLabel}` : ""}.`
    );
  }

  if (Array.isArray(quality?.issues) && quality.issues.length) {
    insights.push(quality.issues[0]);
  } else if (Array.isArray(dictionary?.warnings) && dictionary.warnings.length) {
    insights.push(dictionary.warnings[0]);
  }

  if (Array.isArray(daxLabStatus?.supportedMetrics) && daxLabStatus.supportedMetrics.length) {
    insights.push(
      `Laboratorio DAX: ${formatInteger(daxLabStatus.supportedMetrics.length)} métricas soportadas y ${formatInteger(
        safeArray(daxLabStatus?.supportedDimensions).length
      )} dimensiones.`
    );
  }

  if (powerbiStatus?.token_cached) {
    insights.push("Token Power BI disponible en caché segura.");
  }

  return uniqueTexts(insights).slice(0, 4);
}

function buildMessage({ status, model, modelCatalog, modelStatus, quality, powerbiStatus }) {
  if (status === "connected") {
    const reportCount = formatInteger(modelStatus?.reportsDetected ?? safeArray(modelStatus?.reports).length);
    const catalogSummary = buildCatalogSummary(modelCatalog);
    return model?.displayName
      ? `Modelo conectado: ${model.displayName}. ${formatInteger(catalogSummary.tables)} tablas, ${formatInteger(catalogSummary.measures)} medidas y ${reportCount} informe(s) asociados.`
      : "Modelo semántico conectado y listo para consultas comerciales.";
  }

  if (status === "fallback") {
    return model?.displayName
      ? `${model.displayName} parcialmente disponible. Se muestran metadatos reales mientras termina la conexión completa.`
      : "Power BI parcialmente disponible. Se muestran metadatos reales mientras termina la conexión completa.";
  }

  if (status === "error") {
    return "Power BI tiene un error temporal, pero la pantalla mantiene un fallback seguro.";
  }

  if (!powerbiStatus?.enabled) {
    return "Power BI está deshabilitado en el entorno actual.";
  }

  if (!powerbiStatus?.configured) {
    return "Power BI aún no está configurado en este entorno.";
  }

  const warnings = Array.isArray(quality?.issues) ? quality.issues : [];
  if (warnings.length) {
    return warnings[0];
  }

  if (modelCatalog?.catalogAvailable) {
    return "El catálogo Power BI está disponible, pero no se ha confirmado la conexión completa.";
  }

  return "Power BI pendiente de conexión.";
}

function deriveStatus({ powerbiStatus, model, modelCatalog, modelStatus, dictionary, quality }) {
  const powerbiConfigured = Boolean(powerbiStatus?.enabled && powerbiStatus?.configured);
  const catalogAvailable = Boolean(modelCatalog?.ok && modelCatalog?.catalogAvailable);
  const liveAvailable = Boolean(modelStatus?.ok && (modelStatus?.datasetAccessible || modelStatus?.reportsAccessible));
  const dictionaryAvailable = Boolean(dictionary?.ok && dictionary?.dictionary);
  const qualityIssues = Array.isArray(quality?.issues) ? quality.issues : [];
  const dictionaryWarnings = Array.isArray(dictionary?.warnings) ? dictionary.warnings : [];
  const hasUsefulData = catalogAvailable || liveAvailable || dictionaryAvailable || qualityIssues.length > 0 || dictionaryWarnings.length > 0;

  if (powerbiConfigured && (catalogAvailable || liveAvailable)) {
    return "connected";
  }

  if (hasUsefulData) {
    return "fallback";
  }

  if (!powerbiConfigured) {
    return "not_connected";
  }

  return "error";
}

export async function buildAgentDisplayPowerbiSummary() {
  const generatedAt = new Date().toISOString();
  try {
    const model = pickModel();

    if (!model) {
      return buildFallbackSummary({
        generatedAt,
        status: "not_connected",
        source: "mock",
        headline: "Resumen Power BI",
        message: "Power BI pendiente de configuración en este entorno."
      });
    }

    const [powerbiStatus, modelCatalog, modelStatus, dictionary, quality, daxLabStatus] = await Promise.all([
      withTimeout(getPowerBiStatus(), null),
      withTimeout(getPowerBiModelCatalog(model.key), null),
      withTimeout(getPowerBiModelStatus(model.key), null),
      withTimeout(getPowerBiBusinessDictionary(model.key), null),
      withTimeout(getPowerBiBusinessDictionaryQuality(model.key), null),
      withTimeout(getPowerBiDaxLabStatus(model.key), null)
    ]);

    const status = deriveStatus({
      powerbiStatus,
      model,
      modelCatalog,
      modelStatus,
      dictionary,
      quality,
      daxLabStatus
    });
    const source =
      status === "connected"
        ? "real"
        : modelCatalog?.ok || modelStatus?.ok || dictionary?.ok || quality?.ok
          ? "fallback"
          : "mock";
    const catalogSummary = buildCatalogSummary(modelCatalog);
    const dictionarySummary = quality?.summary || {};
    const reports = safeArray(modelStatus?.reports);
    const kpis = [
      buildKpi("Modelo", model.displayName, model.area || "Power BI"),
      buildKpi("Tablas", formatInteger(catalogSummary.tables), "Catálogo semántico"),
      buildKpi("Medidas", formatInteger(catalogSummary.measures), "Definidas en el modelo"),
      buildKpi("Informes", formatInteger(modelStatus?.reportsDetected ?? reports.length), "Asociados al dataset")
    ];

    if (dictionarySummary.dimensions || dictionarySummary.metrics) {
      kpis.push(
        buildKpi(
          "Diccionario",
          `${formatInteger(dictionarySummary.metrics)} / ${formatInteger(dictionarySummary.dimensions)}`,
          "Métricas / dimensiones"
        )
      );
    }

    const insights = buildInsights({
      model,
      modelCatalog,
      modelStatus,
      dictionary,
      quality,
      daxLabStatus,
      powerbiStatus
    });

    const headline =
      status === "connected"
        ? "Resumen Power BI"
        : status === "fallback"
          ? "Power BI parcialmente disponible"
          : "Power BI pendiente de conexión";

    const message = buildMessage({
      status,
      model,
      modelCatalog,
      modelStatus,
      quality,
      powerbiStatus
    });
    const businessSummary = buildBusinessSummary({
      model,
      status,
      modelCatalog,
      modelStatus,
      dictionary,
      quality
    });

    return {
      status,
      source,
      modelKey: model.key,
      modelName: model.displayName,
      headline,
      message,
      kpis: kpis.slice(0, 4),
      insights,
      updatedAt: modelCatalog?.generatedAt || modelStatus?.generatedAt || generatedAt,
      catalog: catalogSummary,
      reportsDetected: modelStatus?.reportsDetected ?? reports.length,
      datasetName: modelStatus?.dataset?.name || null,
      quality: quality?.quality || null,
      businessSummary
    };
  } catch {
    return buildFallbackSummary({
      generatedAt,
      status: "error",
      source: "fallback",
      headline: "Power BI con aviso",
      message: "Power BI tiene un error temporal, pero la pantalla mantiene un fallback seguro."
    });
  }
}

export function getAgentDisplayPowerbiSuggestedQuestions(modelKey = POWERBI_ASK_MODEL_KEY) {
  const model = getPowerBiModel(modelKey) || pickModel();
  if (!model) {
    return [];
  }
  return buildSuggestedQuestionsForModel(model);
}
