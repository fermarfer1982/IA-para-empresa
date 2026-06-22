import { executeDatasetQuery } from "./powerbiClient";
import { getPowerBiBusinessDictionary } from "./powerbiBusinessDictionary";
import { getPowerBiModel } from "./powerbiModels";

const ALLOWED_MODEL_KEY = "administracion_ventas";
const ALLOWED_METRICS = new Set(["ventas_eur", "unidades"]);
const ALLOWED_DIMENSIONS = new Set([
  "cliente",
  "articulo",
  "producto",
  "familia",
  "representante",
  "pais",
  "tipo",
  "especie"
]);
const ALLOWED_INTENTS = new Set([
  "total_metric",
  "metric_by_dimension",
  "top_dimension_by_metric",
  "metric_by_month",
  "metric_by_year",
  "comparison_metric"
]);
const ALLOWED_TIME_RANGES = new Set([
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
]);
const DEFAULT_TOP_N = 10;
const MAX_TOP_N = 20;
const MAX_ROW_LIMIT = 50;
const DEFAULT_ROW_LIMIT = 50;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeObjectName(value) {
  return normalizeText(value).toLowerCase();
}

function sanitizeModelKey(modelKey) {
  const text = normalizeText(modelKey).toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : "";
}

function safeInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function strictBoundedInt(value, fallback, min, max, label) {
  const hasExplicitValue = value !== undefined && value !== null && String(value).trim() !== "";
  const parsed = Number.parseInt(String(hasExplicitValue ? value : fallback), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} no válido para el laboratorio DAX.`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${label} debe estar entre ${min} y ${max}.`);
  }
  return parsed;
}

function friendlyError(message) {
  if (message && typeof message === "object") {
    return friendlyError(
      message?.error?.message ||
        message?.message ||
        message?.error_description ||
        message?.error ||
        JSON.stringify(message)
    );
  }
  return normalizeText(message) || "Error desconocido del laboratorio DAX.";
}

function normalizeDax(text) {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .trim();
}

function getDictionaryContext(dictionaryPayload) {
  const dictionary = dictionaryPayload?.dictionary || dictionaryPayload || {};
  const metrics = new Map(
    (Array.isArray(dictionary.metrics) ? dictionary.metrics : []).map((metric) => [
      normalizeText(metric?.name).toLowerCase(),
      metric
    ])
  );
  const dimensions = new Map(
    (Array.isArray(dictionary.dimensions) ? dictionary.dimensions : []).map((dimension) => [
      normalizeText(dimension?.name).toLowerCase(),
      dimension
    ])
  );
  const catalogTables = Array.isArray(dictionary?.__catalogTables) ? dictionary.__catalogTables : [];
  return { dictionary, metrics, dimensions, catalogTables };
}

function resolveMetric(metricName, context) {
  const key = normalizeObjectName(metricName);
  if (!ALLOWED_METRICS.has(key)) {
    return null;
  }
  const metric = context.metrics.get(key);
  if (!metric) {
    return null;
  }
  const measureName = normalizeText(metric.measure || metric.name);
  if (!measureName) {
    return null;
  }
  return {
    name: metric.name,
    measure: measureName,
    type: metric.type || "measure",
    table: normalizeText(metric.table) || null,
    column: normalizeText(metric.column) || null,
    aggregation: normalizeText(metric.aggregation) || null,
    format: normalizeText(metric.format) || null
  };
}

function catalogTable(context, tableName) {
  const key = normalizeText(tableName).toLowerCase();
  return (Array.isArray(context?.catalogTables) ? context.catalogTables : []).find(
    (table) => normalizeText(table?.name).toLowerCase() === key
  ) || null;
}

function catalogColumn(context, tableName, columnName) {
  const key = normalizeText(columnName).toLowerCase();
  const table = catalogTable(context, tableName);
  return (Array.isArray(table?.columns) ? table.columns : []).find(
    (column) => normalizeText(column?.name).toLowerCase() === key
  ) || null;
}

function stripAccents(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isTechnicalColumnName(columnName) {
  const name = stripAccents(columnName).toLowerCase();
  return /(^id$|codigo|^cod$|code|key|clave|fecha|date|year|mes|numero|num|orden|index)/i.test(name);
}

function isDisplayColumnName(columnName) {
  const name = stripAccents(columnName).toLowerCase();
  return /nombre|descripcion|descrip|denominacion|cliente|producto|articulo|familia|tipo|especie|representante/i.test(name) &&
    !isTechnicalColumnName(name);
}

function makeDimensionCandidate(dimensionName, table, column, reason, context) {
  const tableName = normalizeText(table);
  const columnName = normalizeText(column);
  if (!tableName || !columnName) {
    return null;
  }
  const catalogMeta = catalogColumn(context, tableName, columnName);
  if (Array.isArray(context?.catalogTables) && context.catalogTables.length && !catalogMeta) {
    return null;
  }
  return {
    name: normalizeObjectName(dimensionName),
    table: tableName,
    column: columnName,
    reason: normalizeText(reason) || "diccionario",
    isDisplayColumn: isDisplayColumnName(columnName),
    isTechnicalColumn: isTechnicalColumnName(columnName),
    dataType: normalizeText(catalogMeta?.dataType) || null
  };
}

function addDimensionCandidate(candidates, candidate) {
  if (!candidate?.table || !candidate?.column) {
    return;
  }
  const key = `${normalizeText(candidate.table).toLowerCase()}::${normalizeText(candidate.column).toLowerCase()}`;
  if (candidates.some((item) => `${normalizeText(item.table).toLowerCase()}::${normalizeText(item.column).toLowerCase()}` === key)) {
    return;
  }
  candidates.push(candidate);
}

function questionRequestsVarietyName(question) {
  const text = stripAccents(question).toLowerCase();
  return /\bvariedad(?:es)?\b|\bclases?\b/.test(text);
}

function questionRequestsDisplayName(question) {
  const text = stripAccents(question).toLowerCase();
  return /\bnombres?\b|\bvariedad(?:es)?\b|\bclases?\b/.test(text);
}

function resolveDimensionCandidates(dimensionName, context, options = {}) {
  const key = normalizeObjectName(dimensionName);
  if (!ALLOWED_DIMENSIONS.has(key)) {
    return [];
  }
  const candidates = [];
  const requestedVariety = questionRequestsVarietyName(options.question);
  const add = (table, column, reason) =>
    addDimensionCandidate(candidates, makeDimensionCandidate(key, table, column, reason, context));

  if (requestedVariety && key === "especie") {
    add("articulos", "nombre", "variedad solicitada: columna de nombre de artículo relacionada con ventas");
    add("especies", "nombreEspecie", "nombre de especie del catálogo");
    add("tipos", "nombreEspecie", "nombre de especie en tipos");
    add("productos", "nombreSeedTek", "nombre de producto como alternativa de variedad");
    add("familias", "nombre", "familia como alternativa de variedad");
  } else if (key === "producto") {
    add("articulos", "nombre", "producto relacionado con ventas desde artículos");
    add("productos", "nombreSeedTek", "nombre de producto del catálogo");
    add("lineasFactura", "articulo", "código de artículo en líneas de factura");
  } else if (key === "articulo") {
    add("articulos", "nombre", "nombre de artículo");
    add("lineasFactura", "articulo", "código de artículo en líneas de factura");
  } else if (key === "especie") {
    add("especies", "nombreEspecie", "nombre de especie");
    add("tipos", "nombreEspecie", "nombre de especie en tipos");
    add("articulos", "especie", "especie en artículos relacionada con ventas");
  } else if (key === "tipo") {
    add("tipos", "nombreTipo", "nombre de tipo");
    add("articulos", "tipo", "tipo en artículos relacionado con ventas");
    add("productos", "tipoSeedTek", "tipo de producto");
  } else if (key === "familia") {
    add("familias", "nombre", "nombre de familia");
  } else if (key === "pais") {
    add("clientes", "pais", "país desde clientes relacionado con ventas");
  }

  const dimension = context.dimensions.get(key);
  if (dimension) {
    addDimensionCandidate(
      candidates,
      makeDimensionCandidate(key, dimension.table, dimension.column, "diccionario de negocio", context)
    );
  }
  return candidates;
}

function resolveDimension(dimensionName, context, options = {}) {
  return resolveDimensionCandidates(dimensionName, context, options)[0] || null;
}

function resolveFilterDimension(dimensionName, context) {
  const key = normalizeObjectName(dimensionName);
  const preferred = {
    cliente: [["clientes", "nombre", "filtro por nombre de cliente"]],
    representante: [["representantes", "representante", "filtro por representante"]],
    pais: [["clientes", "pais", "filtro por país del cliente"]],
    producto: [["articulos", "nombre", "filtro por nombre de producto/artículo"]],
    articulo: [["articulos", "nombre", "filtro por nombre de artículo"]],
    especie: [["articulos", "especie", "filtro por especie relacionada con ventas"]],
    tipo: [["articulos", "tipo", "filtro por tipo relacionado con ventas"]],
    familia: [["familias", "nombre", "filtro por familia"]]
  };
  for (const [table, column, reason] of preferred[key] || []) {
    const candidate = makeDimensionCandidate(key, table, column, reason, context);
    if (candidate) {
      return candidate;
    }
  }
  return resolveDimension(key, context);
}

function getDefaultDate(context) {
  const table = normalizeText(context.dictionary.defaultDateTable);
  const column = normalizeText(context.dictionary.defaultDateColumn);
  if (!table || !column) {
    return null;
  }
  return { table, column };
}

function buildMetricExpression(metric) {
  if (metric.name === "ventas_eur" || metric.measure === "Ventas €") {
    return "[Ventas €]";
  }
  if (metric.name === "unidades" || metric.measure === "Unidades") {
    return "[Unidades]";
  }
  return `[${metric.measure}]`;
}

function buildDimensionReference(dimension) {
  return `'${dimension.table}'[${dimension.column}]`;
}

function buildDateReference(dateRef) {
  if (!dateRef?.table || !dateRef?.column) {
    return "";
  }
  return `'${dateRef.table}'[${dateRef.column}]`;
}

function daxString(value) {
  return `"${normalizeText(value).replace(/"/g, '""')}"`;
}

function monthStartExpression(month, yearExpr) {
  return `DATE(${yearExpr}, ${Number(month)}, 1)`;
}

function monthEndExpression(month, yearExpr) {
  const safeMonth = Number(month);
  if (safeMonth >= 12) {
    return `DATE(${yearExpr} + 1, 1, 1)`;
  }
  return `DATE(${yearExpr}, ${safeMonth + 1}, 1)`;
}

function quarterStartMonth(quarter) {
  return 1 + (Number(quarter || 1) - 1) * 3;
}

function buildTimeFilterExpression(dateRef, timeRange, dateRange) {
  const safeTimeRange = normalizeText(timeRange || "all_time").toLowerCase();
  const range = dateRange && typeof dateRange === "object" ? dateRange : null;
  const rangeType = normalizeText(range?.type || safeTimeRange || "all_time").toLowerCase();
  if (safeTimeRange === "all_time" && (!rangeType || rangeType === "all_time")) {
    return "";
  }

  const dateColumnRef = buildDateReference(dateRef);
  if (!dateColumnRef) {
    throw new Error("No hay fecha de negocio por defecto disponible para aplicar el filtro temporal.");
  }

  const month = Number(range?.month || 0);
  const fromMonth = Number(range?.fromMonth || 0);
  const toMonth = Number(range?.toMonth || 0);
  const quarter = Number(range?.quarter || 0);
  const year = Number(range?.year || 0);
  const amount = Number(range?.amount || 0);
  const yearExpr = year && range?.yearMode !== "current" ? String(year) : "YEAR(TODAY())";

  const rangeExpressions = {
    current_year: [
      "DATE(YEAR(TODAY()), 1, 1)",
      "DATE(YEAR(TODAY()) + 1, 1, 1)"
    ],
    current_month: [
      "DATE(YEAR(TODAY()), MONTH(TODAY()), 1)",
      "EDATE(DATE(YEAR(TODAY()), MONTH(TODAY()), 1), 1)"
    ],
    current_quarter: [
      "DATE(YEAR(TODAY()), 1 + 3 * INT((MONTH(TODAY()) - 1) / 3), 1)",
      "EDATE(DATE(YEAR(TODAY()), 1 + 3 * INT((MONTH(TODAY()) - 1) / 3), 1), 3)"
    ],
    previous_quarter: [
      "EDATE(DATE(YEAR(TODAY()), 1 + 3 * INT((MONTH(TODAY()) - 1) / 3), 1), -3)",
      "DATE(YEAR(TODAY()), 1 + 3 * INT((MONTH(TODAY()) - 1) / 3), 1)"
    ],
    current_week: [
      "TODAY() - WEEKDAY(TODAY(), 2) + 1",
      "TODAY() - WEEKDAY(TODAY(), 2) + 8"
    ],
    previous_week: [
      "TODAY() - WEEKDAY(TODAY(), 2) - 6",
      "TODAY() - WEEKDAY(TODAY(), 2) + 1"
    ],
    last_12_months: [
      "EDATE(TODAY(), -12)",
      "TODAY() + 1"
    ],
    last_3_months: [
      "EDATE(TODAY(), -3)",
      "TODAY() + 1"
    ],
    last_30_days: [
      "TODAY() - 29",
      "TODAY() + 1"
    ],
    last_7_days: [
      "TODAY() - 6",
      "TODAY() + 1"
    ],
    previous_year: [
      "DATE(YEAR(TODAY()) - 1, 1, 1)",
      "DATE(YEAR(TODAY()), 1, 1)"
    ],
    previous_month: [
      "EDATE(DATE(YEAR(TODAY()), MONTH(TODAY()), 1), -1)",
      "DATE(YEAR(TODAY()), MONTH(TODAY()), 1)"
    ],
    today: [
      "TODAY()",
      "TODAY() + 1"
    ],
    yesterday: [
      "TODAY() - 1",
      "TODAY()"
    ]
  };

  if (rangeType === "last_n_days" && amount) {
    rangeExpressions[rangeType] = [`TODAY() - ${amount - 1}`, "TODAY() + 1"];
  }
  if (rangeType === "last_n_months" && amount) {
    rangeExpressions[rangeType] = [`EDATE(TODAY(), -${amount})`, "TODAY() + 1"];
  }
  if ((rangeType === "month_current_year" || rangeType === "month_specific_year") && month) {
    rangeExpressions[rangeType] = [monthStartExpression(month, yearExpr), monthEndExpression(month, yearExpr)];
  }
  if (rangeType === "month_range_current_year" && fromMonth && toMonth) {
    rangeExpressions[rangeType] = [
      monthStartExpression(fromMonth, "YEAR(TODAY())"),
      monthEndExpression(toMonth, "YEAR(TODAY())")
    ];
  }
  if (rangeType === "quarter_current_year" && quarter) {
    const startMonth = quarterStartMonth(quarter);
    rangeExpressions[rangeType] = [
      monthStartExpression(startMonth, "YEAR(TODAY())"),
      monthEndExpression(startMonth + 2, "YEAR(TODAY())")
    ];
  }
  if (rangeType === "year_specific" && year) {
    rangeExpressions[rangeType] = [`DATE(${year}, 1, 1)`, `DATE(${year + 1}, 1, 1)`];
  }

  const bounds = rangeExpressions[rangeType] || rangeExpressions[safeTimeRange];
  if (!bounds) {
    throw new Error("Filtro temporal no permitido para el laboratorio DAX.");
  }

  return normalizeDax(`
    FILTER(
      ALL(${dateColumnRef}),
      ${dateColumnRef} >= ${bounds[0]} &&
      ${dateColumnRef} < ${bounds[1]}
    )
  `);
}

function buildMetricWithFilterExpressions(metricExpr, filterExpressions) {
  const filters = (Array.isArray(filterExpressions) ? filterExpressions : []).filter(Boolean);
  if (!filters.length) {
    return metricExpr;
  }
  return `CALCULATE(${metricExpr}, ${filters.join(", ")})`;
}

function buildValueFilterExpression(filter, context) {
  if (!filter || typeof filter !== "object") {
    return "";
  }
  const dimension = resolveFilterDimension(filter.dimension, context);
  const value = normalizeText(filter.value).toLowerCase();
  if (!dimension || !value) {
    return "";
  }
  const dimensionRef = buildDimensionReference(dimension);
  return normalizeDax(`
    FILTER(
      ALL(${dimensionRef}),
      CONTAINSSTRING(LOWER(${dimensionRef}), ${daxString(value)})
    )
  `);
}

function buildValueFilterExpressions(filters, context) {
  return (Array.isArray(filters) ? filters : [])
    .map((filter) => buildValueFilterExpression(filter, context))
    .filter(Boolean);
}

function buildComparisonPeriods(comparison) {
  const periods = Array.isArray(comparison?.periods) ? comparison.periods : [];
  return periods
    .map((period) => ({
      label: normalizeText(period?.label),
      dateRange: period?.dateRange || null
    }))
    .filter((period) => period.label && period.dateRange);
}

function buildControlledDax({
  modelKey,
  question,
  intent,
  metric,
  dimension,
  dimensions,
  filters,
  dateRange,
  timeRange,
  ranking,
  comparison,
  granularity,
  topN,
  dictionary,
  dimensionCandidate
}) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (sanitizedKey !== ALLOWED_MODEL_KEY) {
    throw new Error("v0.17.5 solo permite administracion_ventas.");
  }

  const context = getDictionaryContext(dictionary || {});
  const safeMetric = resolveMetric(metric, context);
  const dimensionName = normalizeText(dimension || (Array.isArray(dimensions) ? dimensions[0] : "")).toLowerCase();
  const safeDimension = dimensionCandidate || resolveDimension(dimensionName, context, { question });
  const safeIntent = normalizeText(intent).toLowerCase();
  const safeTimeRange = normalizeText(timeRange || "all_time").toLowerCase();
  const safeTopN = strictBoundedInt(topN, DEFAULT_TOP_N, 1, MAX_TOP_N, "topN");
  const safeRanking = ranking && typeof ranking === "object" ? ranking : null;
  const isBottomRanking = normalizeText(safeRanking?.order || "desc").toLowerCase() === "asc";
  const rankingOrder = isBottomRanking ? "ASC" : "DESC";

  if (!ALLOWED_INTENTS.has(safeIntent)) {
    throw new Error("Intent no permitido para el laboratorio DAX.");
  }
  if (!ALLOWED_TIME_RANGES.has(safeTimeRange) && !dateRange) {
    throw new Error("Filtro temporal no permitido para el laboratorio DAX.");
  }
  if (!safeMetric) {
    throw new Error("Métrica no permitida para el laboratorio DAX.");
  }
  if (
    safeIntent !== "total_metric" &&
    safeIntent !== "metric_by_month" &&
    safeIntent !== "metric_by_year" &&
    safeIntent !== "comparison_metric" &&
    !safeDimension
  ) {
    throw new Error("Dimensión no permitida para el laboratorio DAX.");
  }

  const metricExpr = buildMetricExpression(safeMetric);
  const dateRef = getDefaultDate(context);
  const dimensionRef = safeDimension ? buildDimensionReference(safeDimension) : null;
  const timeFilterExpression = buildTimeFilterExpression(dateRef, safeTimeRange, dateRange);
  const valueFilterExpressions = buildValueFilterExpressions(filters, context);
  const filterExpressions = [timeFilterExpression, ...valueFilterExpressions].filter(Boolean);
  const metricExprWithFilters = buildMetricWithFilterExpressions(metricExpr, filterExpressions);

  if (safeIntent === "total_metric") {
    return normalizeDax(`
      EVALUATE
      ROW("metric", ${metricExprWithFilters})
    `);
  }

  if (safeIntent === "metric_by_dimension" || safeIntent === "top_dimension_by_metric") {
    const filterArgument = filterExpressions.length ? `${filterExpressions.join(", ")},` : "";
    const groupedExpression = normalizeDax(`
      SUMMARIZECOLUMNS(
        ${dimensionRef},
        ${filterArgument}
        "metric", ${metricExpr}
      )
    `);
    const rankedTableExpression = isBottomRanking
      ? normalizeDax(`
        FILTER(
          ${groupedExpression},
          NOT ISBLANK([metric]) && [metric] > 0
        )
      `)
      : groupedExpression;
    return normalizeDax(`
      EVALUATE
      TOPN(
        ${safeTopN},
        ${rankedTableExpression},
        [metric], ${rankingOrder},
        ${dimensionRef}, ASC
      )
    `);
  }

  if (safeIntent === "metric_by_month") {
    if (!dateRef) {
      throw new Error("No hay fecha de negocio por defecto disponible.");
    }
    const dateColumnRef = buildDateReference(dateRef);
    const dateTableExpression = timeFilterExpression || `ALL(${dateColumnRef})`;
    const metricExprForPeriod = buildMetricWithFilterExpressions(metricExpr, valueFilterExpressions);
    const safeMonthTopN = Math.max(12, safeTopN);
    return normalizeDax(`
      EVALUATE
      VAR __base =
        ADDCOLUMNS(
          ${dateTableExpression},
          "MonthStart", DATE(YEAR(${dateColumnRef}), MONTH(${dateColumnRef}), 1),
          "MetricValue", ${metricExprForPeriod}
        )
      VAR __grouped =
        GROUPBY(
          __base,
          [MonthStart],
          "metric", SUMX(CURRENTGROUP(), [MetricValue])
        )
      RETURN
        TOPN(
          ${safeMonthTopN},
          __grouped,
          [MonthStart], ASC
        )
    `);
  }

  if (safeIntent === "metric_by_year") {
    if (!dateRef) {
      throw new Error("No hay fecha de negocio por defecto disponible.");
    }
    const dateColumnRef = buildDateReference(dateRef);
    const dateTableExpression = timeFilterExpression || `ALL(${dateColumnRef})`;
    const metricExprForPeriod = buildMetricWithFilterExpressions(metricExpr, valueFilterExpressions);
    return normalizeDax(`
      EVALUATE
      VAR __base =
        ADDCOLUMNS(
          ${dateTableExpression},
          "YearValue", YEAR(${dateColumnRef}),
          "MetricValue", ${metricExprForPeriod}
        )
      VAR __grouped =
        GROUPBY(
          __base,
          [YearValue],
          "metric", SUMX(CURRENTGROUP(), [MetricValue])
        )
      RETURN
        TOPN(
          ${safeTopN},
          __grouped,
          [YearValue], DESC
        )
    `);
  }

  if (safeIntent === "comparison_metric") {
    const periods = buildComparisonPeriods(comparison);
    if (periods.length < 2) {
      throw new Error("La comparación no tiene periodos suficientes.");
    }
    const rows = periods.map((period) => {
      const periodFilter = buildTimeFilterExpression(dateRef, period.dateRange?.type || "all_time", period.dateRange);
      const periodMetricExpr = buildMetricWithFilterExpressions(metricExpr, [periodFilter, ...valueFilterExpressions]);
      return `ROW("periodo", ${daxString(period.label)}, "metric", ${periodMetricExpr})`;
    });
    return normalizeDax(`
      EVALUATE
      UNION(
        ${rows.join(", ")}
      )
    `);
  }

  throw new Error("Intent no soportado.");
}

function dictionaryWithDimensionCandidate(dictionary, candidate) {
  if (!candidate?.name || !candidate?.table || !candidate?.column) {
    return dictionary;
  }
  const next = {
    ...(dictionary || {}),
    dimensions: Array.isArray(dictionary?.dimensions) ? [...dictionary.dimensions] : []
  };
  const index = next.dimensions.findIndex(
    (dimension) => normalizeText(dimension?.name).toLowerCase() === normalizeText(candidate.name).toLowerCase()
  );
  const entry = {
    ...(index >= 0 ? next.dimensions[index] : {}),
    name: candidate.name,
    table: candidate.table,
    column: candidate.column
  };
  if (index >= 0) {
    next.dimensions[index] = entry;
  } else {
    next.dimensions.push(entry);
  }
  if (Array.isArray(dictionary?.__catalogTables)) {
    Object.defineProperty(next, "__catalogTables", {
      value: dictionary.__catalogTables,
      enumerable: false,
      configurable: true
    });
  }
  return next;
}

function findMetricValue(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const metricKey = Object.keys(row).find((key) => /\[metric\]$|^metric$/i.test(key));
  if (metricKey) {
    const value = Number(row[metricKey]);
    return Number.isFinite(value) ? value : null;
  }
  for (const value of Object.values(row)) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function findDimensionValue(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  const key = Object.keys(row).find((item) => !/\[metric\]$|^metric$/i.test(item));
  return normalizeText(row[key]);
}

function isDateLikeDimensionValue(value) {
  const text = normalizeText(value);
  return (
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s*\d{1,2}:\d{2})?\b/.test(text) ||
    /\b(?:1899|1900|1901|0001)[-/]\d{1,2}[-/]\d{1,2}\b/.test(text)
  );
}

function isNumericOnlyDimensionValue(value) {
  const text = normalizeText(value);
  return /^[-+]?\d+(?:[.,]\d+)?$/.test(text);
}

function validateDimensionResult(result, candidate, payload) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const values = rows.map(findDimensionValue).filter(Boolean);
  const metrics = rows.map(findMetricValue).filter((value) => Number.isFinite(value));
  const requiresDisplay = questionRequestsDisplayName(payload?.question) || candidate?.isDisplayColumn;
  const suspiciousValues = values.filter((value) =>
    isDateLikeDimensionValue(value) ||
    ((requiresDisplay || candidate?.isTechnicalColumn) && isNumericOnlyDimensionValue(value))
  );
  const roundedMetricValues = metrics.map((value) => Number(value).toFixed(4));
  const uniqueMetrics = new Set(roundedMetricValues);
  const sameMetricAllRows = metrics.length >= 2 && uniqueMetrics.size === 1;
  const issues = [];

  if (!rows.length) {
    issues.push("dimension_no_rows");
  }
  if (!values.length) {
    issues.push("dimension_no_values");
  }
  if (candidate?.isTechnicalColumn) {
    issues.push("dimension_technical_column");
  }
  if (suspiciousValues.length) {
    issues.push("dimension_suspicious_values");
  }
  if (sameMetricAllRows) {
    issues.push("suspicious_same_metric_all_rows");
  }

  return {
    ok: issues.length === 0,
    status: issues.length ? issues[0] : "ok",
    issues,
    candidate: {
      dimensionKey: candidate?.name || null,
      table: candidate?.table || null,
      column: candidate?.column || null,
      label: candidate?.column || candidate?.name || null,
      confidence: candidate?.isDisplayColumn && !candidate?.isTechnicalColumn ? 0.9 : 0.55,
      reason: candidate?.reason || null,
      isDisplayColumn: Boolean(candidate?.isDisplayColumn),
      isTechnicalColumn: Boolean(candidate?.isTechnicalColumn),
      validationStatus: issues.length ? issues[0] : "ok"
    },
    sampleValues: values.slice(0, 5),
    sameMetricAllRows
  };
}

async function selectValidatedDimensionCandidate(payload, contextPayload) {
  const context = contextPayload.context;
  const dictionary = contextPayload.dictionary;
  const dimensionName = normalizeText(payload?.dimension || (Array.isArray(payload?.dimensions) ? payload.dimensions[0] : "")).toLowerCase();
  const safeIntent = normalizeText(payload?.intent).toLowerCase();
  if (
    safeIntent !== "metric_by_dimension" &&
    safeIntent !== "top_dimension_by_metric"
  ) {
    return { candidate: null, validation: null, candidates: [] };
  }

  const candidates = resolveDimensionCandidates(dimensionName, context, { question: payload?.question });
  const diagnostics = [];
  for (const candidate of candidates) {
    const candidateDictionary = dictionaryWithDimensionCandidate(dictionary, candidate);
    const sampleDax = buildControlledDax({
      ...payload,
      topN: Math.min(MAX_TOP_N, Math.max(10, safeInt(payload?.topN, DEFAULT_TOP_N, 1, MAX_TOP_N))),
      dictionary: candidateDictionary,
      dimensionCandidate: candidate
    });
    const validation = validateControlledDax(sampleDax, getDictionaryContext(candidateDictionary));
    if (!validation.ok) {
      diagnostics.push({
        candidate,
        status: "dax_validation_failed",
        issues: validation.issues || []
      });
      continue;
    }
    const sampleResult = await executeControlledDax({
      modelKey: payload?.modelKey,
      dax: sampleDax,
      rowLimit: Math.min(MAX_ROW_LIMIT, Math.max(10, safeInt(payload?.topN, DEFAULT_TOP_N, 1, MAX_TOP_N)))
    });
    const dimensionValidation = validateDimensionResult(sampleResult, candidate, payload);
    diagnostics.push(dimensionValidation);
    if (dimensionValidation.ok) {
      return {
        candidate,
        validation: {
          ...dimensionValidation,
          candidates: diagnostics
        },
        candidates: diagnostics
      };
    }
  }

  return {
    candidate: null,
    validation: {
      ok: false,
      status: "dimension_validation_failed",
      issues: ["dimension_validation_failed"],
      candidates: diagnostics
    },
    candidates: diagnostics
  };
}

function getAllowlistedIdentifiers(context) {
  const metricIdentifiers = [];
  for (const metric of context.metrics.values()) {
    if (ALLOWED_METRICS.has(normalizeText(metric?.name).toLowerCase())) {
      metricIdentifiers.push(normalizeText(metric.measure || metric.name));
    }
  }
  const dimensionIdentifiers = [];
  for (const dimension of context.dimensions.values()) {
    if (ALLOWED_DIMENSIONS.has(normalizeText(dimension?.name).toLowerCase())) {
      dimensionIdentifiers.push(`'${normalizeText(dimension.table)}'[${normalizeText(dimension.column)}]`);
    }
  }
  for (const [table, column] of [
    ["articulos", "nombre"],
    ["articulos", "especie"],
    ["articulos", "tipo"],
    ["clientes", "nombre"],
    ["clientes", "pais"],
    ["representantes", "representante"],
    ["familias", "nombre"]
  ]) {
    if (catalogColumn(context, table, column)) {
      dimensionIdentifiers.push(`'${table}'[${column}]`);
    }
  }
  const dateRef = getDefaultDate(context);
  return {
    metrics: metricIdentifiers.filter(Boolean),
    dimensions: dimensionIdentifiers.filter(Boolean),
    defaultDate: dateRef ? `'${dateRef.table}'[${dateRef.column}]` : null
  };
}

function validateControlledDax(dax, context) {
  const text = normalizeDax(dax);
  const issues = [];
  const warnings = [];
  const upper = text.toUpperCase();
  const allowedFunctions = ["EVALUATE", "ROW", "SUMMARIZECOLUMNS", "TOPN", "SELECTCOLUMNS", "GROUPBY", "ADDCOLUMNS", "ALL", "YEAR", "MONTH", "DATE", "SUMX", "CURRENTGROUP"];
  const bannedTokens = [
    "INFO",
    "DMV",
    "DEFINE",
    "MEASURE",
    "EVALUATE ROWS",
    "ORDER BY",
    "REMOVEFILTERS",
    "CALCULATETABLE",
    "CROSSFILTER",
    "TREATAS"
  ];
  const identifiers = getAllowlistedIdentifiers(context);

  if (!upper.startsWith("EVALUATE")) {
    issues.push("La consulta debe comenzar por EVALUATE.");
  }

  if (!allowedFunctions.some((fn) => upper.includes(fn))) {
    issues.push("La consulta no usa funciones permitidas del laboratorio.");
  }

  for (const token of bannedTokens) {
    if (upper.includes(token)) {
      issues.push(`La consulta contiene el token no permitido ${token}.`);
    }
  }

  for (const badTable of ["DATETABLETEMPLATE_", "LOCALDATETABLE_", "RELACIONCODIGOS"]) {
    if (upper.includes(badTable)) {
      issues.push(`La consulta referencia una tabla técnica bloqueada: ${badTable}.`);
    }
  }

  if (context.dictionary.defaultDateTable) {
    const dateTable = normalizeText(context.dictionary.defaultDateTable).toUpperCase();
    const dateColumn = normalizeText(context.dictionary.defaultDateColumn).toUpperCase();
    if (!upper.includes(dateTable.toUpperCase()) || !upper.includes(dateColumn.toUpperCase())) {
      warnings.push("La consulta no usa la fecha por defecto del diccionario.");
    }
  }

  const allowedNames = new Set([
    ...(identifiers.metrics || []),
    ...(identifiers.dimensions || []),
    ...(identifiers.defaultDate ? [identifiers.defaultDate] : [])
  ].map((value) => normalizeText(value).toUpperCase()));

  const referencedQuotedNames = Array.from(text.matchAll(/'([^']+)'\s*\[([^\]]+)\]/g)).map(
    ([, table, column]) => `'${table}'[${column}]`
  );
  for (const ref of referencedQuotedNames) {
    if (!allowedNames.has(normalizeText(ref).toUpperCase())) {
      issues.push(`La consulta referencia un objeto no permitido: ${ref}.`);
    }
  }

  if (/\bSELECTCOLUMNS\s*\(/i.test(text) && !/\bSUMMARIZECOLUMNS\s*\(/i.test(text)) {
    warnings.push("SELECTCOLUMNS debería usarse solo como proyección sobre una tabla controlada.");
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    dax: text
  };
}

async function getControlledDaxContext(modelKey) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (sanitizedKey !== ALLOWED_MODEL_KEY) {
    throw new Error("v0.17.5 solo permite administracion_ventas.");
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    throw new Error("Modelo Power BI no encontrado.");
  }

  const dictionaryPayload = await getPowerBiBusinessDictionary(sanitizedKey);
  if (!dictionaryPayload?.ok) {
    throw new Error(dictionaryPayload?.error || "No hay diccionario de negocio disponible.");
  }

  const context = getDictionaryContext(dictionaryPayload);
  return {
    model,
    dictionary: dictionaryPayload.dictionary,
    quality: dictionaryPayload.quality || null,
    context
  };
}

async function executeControlledDax({ modelKey, dax, rowLimit }) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (sanitizedKey !== ALLOWED_MODEL_KEY) {
    throw new Error("v0.17.5 solo permite administracion_ventas.");
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    throw new Error("Modelo Power BI no encontrado.");
  }

  const limit = strictBoundedInt(rowLimit, DEFAULT_ROW_LIMIT, 1, MAX_ROW_LIMIT, "rowLimit");
  const result = await executeDatasetQuery(model.workspaceId, model.datasetId, dax);
  const firstResult = Array.isArray(result?.results) ? result.results[0] : null;
  const firstTable = Array.isArray(firstResult?.tables) ? firstResult.tables[0] : null;
  const rows = Array.isArray(firstTable?.rows) ? firstTable.rows.slice(0, limit) : [];
  const rowCount = Array.isArray(firstTable?.rows) ? firstTable.rows.length : rows.length;
  const columns = Array.isArray(firstTable?.columns)
    ? firstTable.columns.map((column) => ({
        name: normalizeText(column?.name) || null,
        dataType: normalizeText(column?.dataType) || null
      }))
    : [];

  return {
    ok: true,
    model: {
      key: model.key,
      displayName: model.displayName,
      area: model.area,
      enabled: model.enabled,
      description: model.description || null
    },
    rowLimit: limit,
    rowCount,
    truncated: rowCount > limit,
    rows,
    columns,
    resultSummary: {
      resultCount: Array.isArray(result?.results) ? result.results.length : 0,
      tableCount: Array.isArray(firstResult?.tables) ? firstResult.tables.length : 0
    }
  };
}

function summarizeLabResult(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const columns = Array.isArray(result?.columns) ? result.columns : [];
  const sample = rows.slice(0, 3).map((row) => ({ ...row }));
  return {
    rowCount: Number(result?.rowCount || rows.length || 0),
    truncated: Boolean(result?.truncated),
    columnCount: columns.length,
    columns: columns.map((column) => column.name).filter(Boolean),
    sampleRows: sample,
    resultSummary: result?.resultSummary || null
  };
}

function sortRowsByMetric(rows, order = "desc") {
  const direction = normalizeText(order).toLowerCase() === "asc" ? 1 : -1;
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const a = findMetricValue(left);
    const b = findMetricValue(right);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return (a - b) * direction;
  });
}

function findMonthStartValue(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const key = Object.keys(row).find((item) => /monthstart|month start|\[monthstart\]/i.test(item));
  if (!key) {
    return null;
  }
  const timestamp = Date.parse(row[key]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortRowsByMonthStart(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const a = findMonthStartValue(left);
    const b = findMonthStartValue(right);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return a - b;
  });
}

function findPeriodValue(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  const key = Object.keys(row).find((item) => /periodo/i.test(item));
  return normalizeText(key ? row[key] : "");
}

function cleanComparisonPeriodLabel(value) {
  return normalizeText(value).replace(/^año\s+/i, "");
}

function summarizeComparisonRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (sourceRows.length < 2) {
    return sourceRows;
  }
  const current = sourceRows[0];
  const previous = sourceRows[1];
  const currentValue = findMetricValue(current);
  const previousValue = findMetricValue(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return sourceRows;
  }
  const difference = currentValue - previousValue;
  const percent = previousValue === 0 ? null : (difference / previousValue) * 100;
  return [{
    periodo_actual: cleanComparisonPeriodLabel(findPeriodValue(current)) || "Periodo actual",
    valor_actual: currentValue,
    periodo_anterior: cleanComparisonPeriodLabel(findPeriodValue(previous)) || "Periodo anterior",
    valor_anterior: previousValue,
    diferencia_absoluta: difference,
    diferencia_porcentual: percent
  }];
}

function buildDimensionValidationError(validation) {
  const candidates = Array.isArray(validation?.candidates) ? validation.candidates : [];
  const sameMetricCandidate = candidates.find((candidate) => candidate?.sameMetricAllRows || candidate?.issues?.includes("suspicious_same_metric_all_rows"));
  const technicalCandidate = candidates.find((candidate) => candidate?.issues?.includes("dimension_technical_column"));
  const suspiciousCandidate = candidates.find((candidate) => candidate?.issues?.includes("dimension_suspicious_values"));
  const selected = sameMetricCandidate || technicalCandidate || suspiciousCandidate || candidates[0] || {};
  const table = selected?.candidate?.table || selected?.candidate?.dimensionKey || "la columna candidata";
  const column = selected?.candidate?.column || "";
  if (sameMetricCandidate) {
    return `La columna candidata ${table}${column ? `[${column}]` : ""} no parece estar relacionada con ventas; devuelve el total repetido en todos los grupos.`;
  }
  if (technicalCandidate || suspiciousCandidate) {
    return `La columna candidata ${table}${column ? `[${column}]` : ""} parece técnica o no legible para una dimensión de negocio.`;
  }
  return "No he encontrado una columna de dimensión fiable para esa consulta. Puedo probar otra agrupación como especie, artículo, producto, tipo o cliente.";
}

export async function getPowerBiDaxLabStatus(modelKey) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (sanitizedKey !== ALLOWED_MODEL_KEY) {
    return { ok: false, error: "v0.17.5 solo permite administracion_ventas." };
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    return { ok: false, error: "Modelo Power BI no encontrado." };
  }

  const envOk = true;
  const dictionaryPayload = await getPowerBiBusinessDictionary(sanitizedKey);
  if (!dictionaryPayload?.ok) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: dictionaryPayload?.error || "No hay diccionario disponible.",
      allowedIntents: Array.from(ALLOWED_INTENTS),
      allowedMetrics: Array.from(ALLOWED_METRICS),
      allowedDimensions: Array.from(ALLOWED_DIMENSIONS),
      allowedTimeRanges: Array.from(ALLOWED_TIME_RANGES),
      rowLimit: MAX_ROW_LIMIT
    };
  }

  return {
    ok: true,
    model: {
      key: model.key,
      displayName: model.displayName,
      area: model.area,
      enabled: model.enabled,
      description: model.description || null
    },
    enabled: envOk,
    allowedModelKey: ALLOWED_MODEL_KEY,
    allowedIntents: Array.from(ALLOWED_INTENTS),
    allowedMetrics: Array.from(ALLOWED_METRICS),
    allowedDimensions: Array.from(ALLOWED_DIMENSIONS),
    allowedTimeRanges: Array.from(ALLOWED_TIME_RANGES),
    defaultMetric: "ventas_eur",
    defaultDimension: "cliente",
    defaultTimeRange: "all_time",
    rowLimit: MAX_ROW_LIMIT,
    available: Boolean(dictionaryPayload?.dictionary),
    quality: dictionaryPayload?.quality || null,
    dictionarySummary: {
      entities: Array.isArray(dictionaryPayload?.dictionary?.entities) ? dictionaryPayload.dictionary.entities.length : 0,
      metrics: Array.isArray(dictionaryPayload?.dictionary?.metrics) ? dictionaryPayload.dictionary.metrics.length : 0,
      dimensions: Array.isArray(dictionaryPayload?.dictionary?.dimensions) ? dictionaryPayload.dictionary.dimensions.length : 0,
      timeDimensions: Array.isArray(dictionaryPayload?.dictionary?.timeDimensions)
        ? dictionaryPayload.dictionary.timeDimensions.length
        : 0
    }
  };
}

export async function buildPowerBiControlledDax(payload) {
  const context = await getControlledDaxContext(payload?.modelKey);
  const dax = buildControlledDax({
    modelKey: payload?.modelKey,
    question: payload?.question,
    intent: payload?.intent,
    metric: payload?.metric,
    dimension: payload?.dimension,
    dimensions: payload?.dimensions,
    filters: payload?.filters,
    dateRange: payload?.dateRange,
    timeRange: payload?.timeRange,
    ranking: payload?.ranking,
    comparison: payload?.comparison,
    granularity: payload?.granularity,
    topN: payload?.topN,
    dictionary: context.dictionary
  });
  const dateRef = getDefaultDate(context.context);
  const dimensionName = normalizeText(payload?.dimension || (Array.isArray(payload?.dimensions) ? payload.dimensions[0] : "")).toLowerCase();
  const dimensionCandidate = resolveDimension(dimensionName, context.context, { question: payload?.question });
  return {
    ok: true,
    model: {
      key: context.model.key,
      displayName: context.model.displayName,
      area: context.model.area,
      enabled: context.model.enabled,
      description: context.model.description || null
    },
    intent: normalizeText(payload?.intent).toLowerCase(),
    metric: normalizeText(payload?.metric).toLowerCase(),
    dimension: normalizeText(payload?.dimension).toLowerCase(),
    dimensions: Array.isArray(payload?.dimensions) ? payload.dimensions : [],
    filters: Array.isArray(payload?.filters) ? payload.filters : [],
    dateRange: payload?.dateRange || null,
    timeRange: normalizeText(payload?.timeRange || "all_time").toLowerCase(),
    ranking: payload?.ranking || null,
    comparison: payload?.comparison || null,
    granularity: normalizeText(payload?.granularity).toLowerCase() || null,
    logicalPage: normalizeText(payload?.logicalPage) || null,
    topN: strictBoundedInt(payload?.topN, DEFAULT_TOP_N, 1, MAX_TOP_N, "topN"),
    dateField: dateRef ? `'${dateRef.table}'[${dateRef.column}]` : null,
    dimensionField: dimensionCandidate ? `'${dimensionCandidate.table}'[${dimensionCandidate.column}]` : null,
    dimensionValidation: dimensionCandidate
      ? {
          ok: null,
          status: "metadata_only",
          candidate: {
            dimensionKey: dimensionCandidate.name,
            table: dimensionCandidate.table,
            column: dimensionCandidate.column,
            label: dimensionCandidate.column,
            confidence: dimensionCandidate.isDisplayColumn && !dimensionCandidate.isTechnicalColumn ? 0.9 : 0.55,
            reason: dimensionCandidate.reason,
            isDisplayColumn: Boolean(dimensionCandidate.isDisplayColumn),
            isTechnicalColumn: Boolean(dimensionCandidate.isTechnicalColumn),
            validationStatus: "metadata_only"
          }
        }
      : null,
    dax
  };
}

export async function validatePowerBiControlledDax(payload) {
  const context = await getControlledDaxContext(payload?.modelKey);
  const generatedDax = buildControlledDax({
    modelKey: payload?.modelKey,
    question: payload?.question,
    intent: payload?.intent,
    metric: payload?.metric,
    dimension: payload?.dimension,
    dimensions: payload?.dimensions,
    filters: payload?.filters,
    dateRange: payload?.dateRange,
    timeRange: payload?.timeRange,
    ranking: payload?.ranking,
    comparison: payload?.comparison,
    granularity: payload?.granularity,
    topN: payload?.topN,
    dictionary: context.dictionary
  });
  const providedDax = payload?.dax ? normalizeDax(payload.dax) : null;
  if (providedDax && providedDax !== generatedDax) {
    return {
      ok: false,
      model: {
        key: context.model.key,
        displayName: context.model.displayName,
        area: context.model.area,
        enabled: context.model.enabled,
        description: context.model.description || null
      },
      dax: generatedDax,
      validation: {
        ok: false,
        issues: ["El laboratorio solo valida DAX generado internamente."]
      }
    };
  }
  return {
    ok: true,
    model: {
      key: context.model.key,
      displayName: context.model.displayName,
      area: context.model.area,
      enabled: context.model.enabled,
      description: context.model.description || null
    },
    validation: validateControlledDax(generatedDax, context.context),
    dax: generatedDax
  };
}

export async function runPowerBiControlledDaxLab(payload) {
  if (payload?.dax) {
    throw new Error("El laboratorio DAX no acepta DAX manual en execute.");
  }
  const context = await getControlledDaxContext(payload?.modelKey);
  const dateRef = getDefaultDate(context.context);
  const selection = await selectValidatedDimensionCandidate(payload, context);
  if (selection.validation && !selection.validation.ok) {
    return {
      ok: false,
      type: "dimension_validation_failed",
      model: {
        key: context.model.key,
        displayName: context.model.displayName,
        area: context.model.area,
        enabled: context.model.enabled,
        description: context.model.description || null
      },
      dimensionValidation: selection.validation,
      candidates: selection.candidates,
      error: buildDimensionValidationError(selection.validation)
    };
  }
  const candidateDictionary = selection.candidate
    ? dictionaryWithDimensionCandidate(context.dictionary, selection.candidate)
    : context.dictionary;
  const candidateContext = getDictionaryContext(candidateDictionary);
  const dax = buildControlledDax({
    modelKey: payload?.modelKey,
    question: payload?.question,
    intent: payload?.intent,
    metric: payload?.metric,
    dimension: payload?.dimension,
    dimensions: payload?.dimensions,
    filters: payload?.filters,
    dateRange: payload?.dateRange,
    timeRange: payload?.timeRange,
    ranking: payload?.ranking,
    comparison: payload?.comparison,
    granularity: payload?.granularity,
    topN: payload?.topN,
    dictionary: candidateDictionary,
    dimensionCandidate: selection.candidate || undefined
  });
  const validation = validateControlledDax(dax, candidateContext);
  if (!validation.ok) {
    return {
      ok: false,
      model: {
        key: context.model.key,
        displayName: context.model.displayName,
        area: context.model.area,
        enabled: context.model.enabled,
        description: context.model.description || null
      },
      dax,
      validation,
      error: "La consulta DAX controlada no pasó la validación."
    };
  }

  const result = await executeControlledDax({
    modelKey: payload?.modelKey,
    dax,
    rowLimit: payload?.rowLimit
  });
  const rankingOrder = normalizeText(payload?.ranking?.order || "desc").toLowerCase();
  const safeIntent = normalizeText(payload?.intent).toLowerCase();
  const rows = safeIntent === "top_dimension_by_metric"
    ? sortRowsByMetric(result.rows, rankingOrder)
    : safeIntent === "metric_by_month"
      ? sortRowsByMonthStart(result.rows)
    : safeIntent === "comparison_metric"
      ? summarizeComparisonRows(result.rows)
      : result.rows;
  return {
    ok: true,
    model: result.model,
    intent: safeIntent,
    metric: normalizeText(payload?.metric).toLowerCase(),
    dimension: normalizeText(payload?.dimension).toLowerCase(),
    dimensions: Array.isArray(payload?.dimensions) ? payload.dimensions : [],
    filters: Array.isArray(payload?.filters) ? payload.filters : [],
    dateRange: payload?.dateRange || null,
    timeRange: normalizeText(payload?.timeRange || "all_time").toLowerCase(),
    ranking: payload?.ranking || null,
    comparison: payload?.comparison || null,
    granularity: normalizeText(payload?.granularity).toLowerCase() || null,
    logicalPage: normalizeText(payload?.logicalPage) || null,
    topN: strictBoundedInt(payload?.topN, DEFAULT_TOP_N, 1, MAX_TOP_N, "topN"),
    dateField: dateRef ? `'${dateRef.table}'[${dateRef.column}]` : null,
    dimensionField: selection.candidate ? `'${selection.candidate.table}'[${selection.candidate.column}]` : null,
    dimensionValidation: selection.validation || null,
    dax,
    validation,
    rowLimit: result.rowLimit,
    rowCount: rows.length,
    truncated: result.truncated,
    rows,
    summary: summarizeLabResult({ ...result, rows })
  };
}

export {
  buildControlledDax,
  validateControlledDax,
  executeControlledDax,
  summarizeLabResult
};
