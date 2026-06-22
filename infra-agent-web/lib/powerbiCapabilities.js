const ALLOWED_MODEL_KEY = "administracion_ventas";
const ALLOWED_METRICS = ["ventas_eur", "unidades"];
const ALLOWED_DIMENSIONS = [
  "cliente",
  "articulo",
  "producto",
  "familia",
  "representante",
  "pais",
  "tipo",
  "especie"
];
const ALLOWED_INTENTS = [
  "total_metric",
  "metric_by_dimension",
  "top_dimension_by_metric",
  "metric_by_month",
  "metric_by_year",
  "comparison_metric"
];
const ALLOWED_TIME_RANGES = [
  "all_time",
  "current_year",
  "current_month",
  "current_quarter",
  "current_week",
  "last_12_months",
  "last_3_months",
  "last_30_days",
  "last_7_days",
  "previous_year",
  "previous_month",
  "previous_quarter",
  "previous_week",
  "month_current_year",
  "month_specific_year",
  "month_range_current_year",
  "quarter_current_year",
  "year_specific",
  "today",
  "yesterday"
];
const LIMITS = {
  topNMax: 20,
  rowLimitMax: 50,
  defaultTopN: 10,
  defaultRowLimit: 50,
  defaultTimeRange: "all_time"
};

const DIMENSION_QUESTION_LABELS = {
  cliente: { singular: "cliente", plural: "clientes" },
  articulo: { singular: "artículo", plural: "artículos" },
  producto: { singular: "producto", plural: "productos" },
  familia: { singular: "familia", plural: "familias" },
  representante: { singular: "representante", plural: "representantes" },
  pais: { singular: "país", plural: "países" },
  tipo: { singular: "tipo", plural: "tipos" },
  especie: { singular: "especie", plural: "especies" },
  mes: { singular: "mes", plural: "meses" },
  año: { singular: "año", plural: "años" }
};

function normalizeText(value) {
  return String(value || "").trim();
}

function titleFromSlug(value) {
  return normalizeText(value)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getDimensionQuestionLabel(value, plural = false) {
  const key = normalizeText(value).toLowerCase();
  if (DIMENSION_QUESTION_LABELS[key]) {
    return plural ? DIMENSION_QUESTION_LABELS[key].plural : DIMENSION_QUESTION_LABELS[key].singular;
  }
  const fallback = titleFromSlug(key).toLowerCase();
  return plural ? `${fallback}s` : fallback;
}

function uniqueList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => normalizeText(item)).filter(Boolean))];
}

const SUPPORTED_QUESTION_GROUPS = [
  {
    intent: "total_metric",
    metric: "ventas_eur",
    questions: [
      "Cuánto hemos vendido",
      "Total de ventas",
      "Ventas totales",
      "Cuánto hemos facturado",
      "Cuánto hemos vendido este año",
      "Ventas este año",
      "Cuánto hemos vendido este año en enero"
    ]
  },
  {
    intent: "total_metric",
    metric: "unidades",
    questions: [
      "Cuántas unidades hemos vendido",
      "Total de unidades",
      "Unidades totales",
      "Cuántas unidades hemos vendido este año",
      "Unidades este año",
      "Cuántas unidades hemos vendido en enero"
    ]
  }
];

  for (const metric of ALLOWED_METRICS) {
    for (const dimension of ALLOWED_DIMENSIONS) {
      SUPPORTED_QUESTION_GROUPS.push({
        intent: "metric_by_dimension",
        metric,
        dimension,
      questions: [`${metric === "ventas_eur" ? "Ventas" : "Unidades"} por ${getDimensionQuestionLabel(dimension)}`]
      });

      SUPPORTED_QUESTION_GROUPS.push({
        intent: "top_dimension_by_metric",
        metric,
        dimension,
        topN: 10,
      questions: [`Top 10 ${getDimensionQuestionLabel(dimension, true)} por ${metric === "ventas_eur" ? "ventas" : "unidades"}`]
      });
    }
  }

SUPPORTED_QUESTION_GROUPS.push(
  {
    intent: "metric_by_month",
    metric: "ventas_eur",
    dimension: "mes",
    questions: ["Ventas por mes"]
  },
  {
    intent: "metric_by_month",
    metric: "unidades",
    dimension: "mes",
    questions: ["Unidades por mes"]
  },
  {
    intent: "metric_by_year",
    metric: "ventas_eur",
    dimension: "año",
    questions: ["Ventas por año"]
  },
  {
    intent: "comparison_metric",
    metric: "ventas_eur",
    questions: [
      "Ventas este mes vs mes pasado",
      "Ventas este año vs año pasado",
      "Comparar ventas 2025 contra 2024",
      "Comparar unidades 2025 contra 2024"
    ]
  }
);

const REJECTED_QUESTION_GROUPS = [
  { question: "margen por cliente", reason: "La métrica margen todavía no está soportada." },
  { question: "rentabilidad por producto", reason: "La métrica rentabilidad todavía no está soportada." },
  { question: "beneficio", reason: "La métrica beneficio todavía no está soportada." },
  { question: "coste", reason: "La métrica coste todavía no está soportada." },
  { question: "previsión", reason: "La previsión todavía no está soportada." },
  { question: "clientes inactivos", reason: "Todavía no se soporta esa pregunta de segmentación." },
  { question: "dame todos los clientes", reason: "Todavía no se soportan listados completos o exportaciones masivas." },
  { question: "exporta todos los datos", reason: "Todavía no se soportan exportaciones masivas." },
  { question: "ejecuta este DAX", reason: "No se permite DAX libre." },
  { question: "detalle de una factura concreta", reason: "Todavía no se soporta detalle transaccional de factura concreta." },
  { question: "filtros arbitrarios por fecha", reason: "Todavía no se soportan filtros temporales arbitrarios." },
  { question: "filtros por cliente concreto", reason: "Todavía no se soportan filtros arbitrarios por cliente." }
];

function getPowerBiVoiceHelp() {
  return "Ahora puedo consultar ventas o unidades por cliente, producto, país, familia, representante, tipo, especie o mes.";
}

function getPowerBiSupportedUtterances() {
  return uniqueList(
    SUPPORTED_QUESTION_GROUPS.flatMap((group) => Array.isArray(group.questions) ? group.questions : [])
  );
}

function getPowerBiRejectedUtterances() {
  return REJECTED_QUESTION_GROUPS.map((item) => item.question);
}

function resolveDictionaryMetrics(dictionary) {
  const metrics = Array.isArray(dictionary?.metrics) ? dictionary.metrics : [];
  const byName = new Map(
    metrics.map((metric) => [normalizeText(metric?.name).toLowerCase(), metric]).filter(([key]) => key)
  );
  return ALLOWED_METRICS.map((metricKey) => {
    const metric = byName.get(metricKey) || null;
    return {
      name: metricKey,
      label: metric?.measure || (metricKey === "ventas_eur" ? "Ventas €" : "Unidades"),
      type: metric?.type || "measure",
      measure: metric?.measure || (metricKey === "ventas_eur" ? "Ventas €" : "Unidades"),
      format: metric?.format || (metricKey === "ventas_eur" ? "currency" : "number"),
      table: metric?.table || null,
      allowed: true
    };
  });
}

function resolveDictionaryDimensions(dictionary) {
  const dimensions = Array.isArray(dictionary?.dimensions) ? dictionary.dimensions : [];
  const byName = new Map(
    dimensions.map((dimension) => [normalizeText(dimension?.name).toLowerCase(), dimension]).filter(([key]) => key)
  );
  return ALLOWED_DIMENSIONS.map((dimensionKey) => {
    const dimension = byName.get(dimensionKey) || null;
    return {
      name: dimensionKey,
      label: dimension?.name || titleFromSlug(dimensionKey),
      type: dimension?.type || "dimension",
      table: dimension?.table || null,
      column: dimension?.column || null,
      allowed: true
    };
  });
}

function buildSupportedQuestions() {
  return SUPPORTED_QUESTION_GROUPS.map((group) => ({
    intent: group.intent,
    metric: group.metric,
    dimension: group.dimension || null,
    topN: Number(group.topN || 0) || null,
    questions: Array.isArray(group.questions) ? [...group.questions] : [],
    supported: true
  }));
}

function buildRejectedQuestions() {
  return REJECTED_QUESTION_GROUPS.map((item) => ({
    question: item.question,
    reason: item.reason,
    supported: false
  }));
}

function buildExamples() {
  const supportedExamples = SUPPORTED_QUESTION_GROUPS.slice(0, 12).flatMap((group) =>
    (Array.isArray(group.questions) ? group.questions.slice(0, 1) : []).map((question) => ({
      question,
      intent: group.intent,
      metric: group.metric,
      dimension: group.dimension || null,
      supported: true,
      reason: null
    }))
  );
  const rejectedExamples = REJECTED_QUESTION_GROUPS.slice(0, 8).map((item) => ({
    question: item.question,
    intent: null,
    metric: null,
    dimension: null,
    supported: false,
    reason: item.reason
  }));
  return [...supportedExamples, ...rejectedExamples];
}

function buildPowerBiCapabilities({ model, dictionary, daxLabStatus }) {
  const modelKey = normalizeText(model?.key || dictionary?.modelKey || ALLOWED_MODEL_KEY).toLowerCase();
  const displayName = normalizeText(model?.displayName || dictionary?.displayName || "administracion_ventas");
  const allowedMetrics = new Set(
    Array.isArray(daxLabStatus?.allowedMetrics) && daxLabStatus.allowedMetrics.length
      ? daxLabStatus.allowedMetrics.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
      : ALLOWED_METRICS
  );
  const allowedDimensions = new Set(
    Array.isArray(daxLabStatus?.allowedDimensions) && daxLabStatus.allowedDimensions.length
      ? daxLabStatus.allowedDimensions.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
      : ALLOWED_DIMENSIONS
  );
  const supportedMetrics = resolveDictionaryMetrics(dictionary).filter((metric) => allowedMetrics.has(metric.name));
  const supportedDimensions = [
    ...resolveDictionaryDimensions(dictionary).filter((dimension) => allowedDimensions.has(dimension.name)),
    {
      name: "mes",
      label: "mes",
      type: "timeDimension",
      table: normalizeText(dictionary?.defaultDateTable || null) || null,
      column: normalizeText(dictionary?.defaultDateColumn || null) || null,
      granularity: ["month"],
      allowed: true
    }
  ];
  const supportedIntents = Array.isArray(daxLabStatus?.allowedIntents) && daxLabStatus.allowedIntents.length
    ? daxLabStatus.allowedIntents
    : ALLOWED_INTENTS;
  const supportedTimeRanges = Array.isArray(daxLabStatus?.allowedTimeRanges) && daxLabStatus.allowedTimeRanges.length
    ? daxLabStatus.allowedTimeRanges
    : ALLOWED_TIME_RANGES;

  const warnings = uniqueList([
    ...(Array.isArray(dictionary?.warnings) ? dictionary.warnings : []),
    ...(Array.isArray(daxLabStatus?.quality?.issues) ? daxLabStatus.quality.issues : []),
    supportedTimeRanges.length === 1 ? "Solo se soporta all_time por ahora." : "",
    supportedMetrics.length < ALLOWED_METRICS.length ? "No se detectan todas las métricas esperadas en el diccionario." : "",
    supportedDimensions.length < ALLOWED_DIMENSIONS.length + 1
      ? "No se detectan todas las dimensiones esperadas en el diccionario."
      : ""
  ]);

  return {
    ok: true,
    modelKey,
    displayName,
    supportedMetrics,
    supportedDimensions,
    supportedIntents,
    supportedTimeRanges,
    limits: { ...LIMITS },
    supportedQuestions: buildSupportedQuestions(),
    rejectedQuestions: buildRejectedQuestions(),
    examples: buildExamples(),
    warnings,
    voiceHelp: getPowerBiVoiceHelp(),
    supportedUtterances: getPowerBiSupportedUtterances(),
    rejectedUtterances: getPowerBiRejectedUtterances()
  };
}

function buildPowerBiCapabilityExamples(capabilities) {
  const examples = Array.isArray(capabilities?.examples) ? capabilities.examples : [];
  return {
    ok: Boolean(capabilities?.ok),
    modelKey: normalizeText(capabilities?.modelKey || ALLOWED_MODEL_KEY).toLowerCase(),
    displayName: normalizeText(capabilities?.displayName || "administracion_ventas"),
    voiceHelp: capabilities?.voiceHelp || getPowerBiVoiceHelp(),
    supportedUtterances: Array.isArray(capabilities?.supportedUtterances)
      ? capabilities.supportedUtterances
      : getPowerBiSupportedUtterances(),
    examples,
    warnings: Array.isArray(capabilities?.warnings) ? capabilities.warnings : []
  };
}

export {
  ALLOWED_MODEL_KEY as POWERBI_CAPABILITIES_MODEL_KEY,
  ALLOWED_METRICS as POWERBI_CAPABILITIES_METRICS,
  ALLOWED_DIMENSIONS as POWERBI_CAPABILITIES_DIMENSIONS,
  ALLOWED_INTENTS as POWERBI_CAPABILITIES_INTENTS,
  ALLOWED_TIME_RANGES as POWERBI_CAPABILITIES_TIME_RANGES,
  LIMITS as POWERBI_CAPABILITIES_LIMITS,
  buildPowerBiCapabilities,
  buildPowerBiCapabilityExamples,
  getPowerBiRejectedUtterances,
  getPowerBiSupportedUtterances,
  getPowerBiVoiceHelp
};
