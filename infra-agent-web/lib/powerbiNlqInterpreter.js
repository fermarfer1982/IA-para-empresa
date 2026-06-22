const ALLOWED_MODEL_KEY = "administracion_ventas";
const MAX_QUESTION_LENGTH = 260;
const DEFAULT_TOP_N = 10;
const MAX_TOP_N = 20;

const CURRENT_YEAR = new Date().getFullYear();

const MONTHS = [
  { name: "enero", month: 1 },
  { name: "febrero", month: 2 },
  { name: "marzo", month: 3 },
  { name: "abril", month: 4 },
  { name: "mayo", month: 5 },
  { name: "junio", month: 6 },
  { name: "julio", month: 7 },
  { name: "agosto", month: 8 },
  { name: "septiembre", month: 9 },
  { name: "setiembre", month: 9 },
  { name: "octubre", month: 10 },
  { name: "noviembre", month: 11 },
  { name: "diciembre", month: 12 }
];

const QUARTERS = [
  { pattern: /\bprimer\s+trimestre\b/i, quarter: 1, label: "primer trimestre" },
  { pattern: /\bsegundo\s+trimestre\b/i, quarter: 2, label: "segundo trimestre" },
  { pattern: /\btercer\s+trimestre\b/i, quarter: 3, label: "tercer trimestre" },
  { pattern: /\bcuarto\s+trimestre\b/i, quarter: 4, label: "cuarto trimestre" }
];

const ALLOWED_METRICS = {
  ventas_eur: {
    metric: "ventas_eur",
    aggregation: "sum",
    label: "Ventas",
    patterns: [
      /\bventas?\b/i,
      /\bvendid[oa]s?\b/i,
      /\bfacturaci[oó]n\b/i,
      /\bimporte(s)?\b/i,
      /\bingresos?\b/i,
      /\brecaudaci[oó]n\b/i,
      /\beuros?\s+vendidos?\b/i,
      /\b€\s*vendid[oa]s?\b/i
    ],
    matchedTerms: ["ventas", "vendido", "facturación", "importe", "ingresos"]
  },
  unidades: {
    metric: "unidades",
    aggregation: "sum",
    label: "Unidades",
    patterns: [
      /\bunidades?\b/i,
      /\bunidad(?:es)?\b/i,
      /\buds?\b/i,
      /\bcantidad(?:es)?\b/i,
      /\bpiezas?\b/i,
      /\bart[ií]culos?\s+vendidos?\b/i,
      /\bcu[aá]ntas?\s+unidades?\b/i,
      /\bkilos?\b/i,
      /\bkg\b/i
    ],
    matchedTerms: ["unidades", "cantidad", "piezas", "artículos vendidos"]
  }
};

const ALLOWED_DIMENSIONS = {
  cliente: {
    dimension: "cliente",
    label: "Cliente",
    patterns: [/\bclientes?\b/i, /\bcompradores?\b/i],
    matchedTerms: ["cliente", "comprador"]
  },
  articulo: {
    dimension: "articulo",
    label: "Artículo",
    patterns: [/\bart[ií]culos?\b/i, /\breferencias?\b/i, /\bsku\b/i],
    matchedTerms: ["artículo", "referencia", "SKU"]
  },
  producto: {
    dimension: "producto",
    label: "Producto",
    patterns: [
      /\bproductos?\b/i,
      /\bvariedad(?:es)?\b/i,
      /\bclases?\b/i,
      /\bnombres?\s+de\s+(?:variedad|producto)s?\b/i
    ],
    matchedTerms: ["producto", "variedad", "nombre"]
  },
  familia: {
    dimension: "familia",
    label: "Familia",
    patterns: [/\bfamilias?\b/i, /\bcategor[ií]as?\b/i, /\bgrupos?\b/i],
    matchedTerms: ["familia", "categoría", "grupo"]
  },
  representante: {
    dimension: "representante",
    label: "Representante",
    patterns: [/\brepresentantes?\b/i, /\bcomerciales?\b/i, /\bvendedores?\b/i],
    matchedTerms: ["representante", "comercial", "vendedor"]
  },
  tipo: {
    dimension: "tipo",
    label: "Tipo",
    patterns: [/\btipos?\b/i],
    matchedTerms: ["tipo"]
  },
  especie: {
    dimension: "especie",
    label: "Especie",
    patterns: [/\bespecies?\b/i],
    matchedTerms: ["especie"]
  },
  pais: {
    dimension: "pais",
    label: "País",
    patterns: [/\bpa[ií]ses?\b/i, /\bpais\b/i, /\bpa[ií]s\b/i],
    matchedTerms: ["país", "países"]
  }
};

const DIMENSION_ORDER = [
  "cliente",
  "articulo",
  "producto",
  "familia",
  "representante",
  "pais",
  "tipo",
  "especie"
];

const UNKNOWN_DIMENSION_PATTERNS = [
  { pattern: /\bpor\s+provincias?\b/i, dimension: "provincia" },
  { pattern: /\bpor\s+zonas?\b/i, dimension: "zona" },
  { pattern: /\bpor\s+municipios?\b/i, dimension: "municipio" }
];

const FUNCTIONAL_PAGE_RULES = [
  {
    page: "PRODUCTOS €",
    dimension: "producto",
    metric: "ventas_eur",
    pattern: /\bproductos?\s+(?:euros?|importe|ventas?|facturaci[oó]n|€)\b/i
  },
  {
    page: "PRODUCTOS UDS",
    dimension: "producto",
    metric: "unidades",
    pattern: /\bproductos?\s+(?:unidades?|uds?|cantidad)\b/i
  },
  {
    page: "CLIENTES €",
    dimension: "cliente",
    metric: "ventas_eur",
    pattern: /\bclientes?\s+(?:euros?|importe|ventas?|facturaci[oó]n|€)\b/i
  },
  {
    page: "CLIENTES UNDS",
    dimension: "cliente",
    metric: "unidades",
    pattern: /\bclientes?\s+(?:unidades?|uds?|cantidad)\b/i
  },
  {
    page: "REPRESENTANTES €",
    dimension: "representante",
    metric: "ventas_eur",
    pattern: /\brepresentantes?\s+(?:euros?|importe|ventas?|facturaci[oó]n|€)\b/i
  },
  {
    page: "REPRESENTANTES UDS",
    dimension: "representante",
    metric: "unidades",
    pattern: /\brepresentantes?\s+(?:unidades?|uds?|cantidad)\b/i
  },
  {
    page: "PAISES €",
    dimension: "pais",
    metric: "ventas_eur",
    pattern: /\bpa[ií]ses?\s+(?:euros?|importe|ventas?|facturaci[oó]n|€)\b/i
  },
  {
    page: "PAISES UDS",
    dimension: "pais",
    metric: "unidades",
    pattern: /\bpa[ií]ses?\s+(?:unidades?|uds?|cantidad)\b/i
  }
];

const BUSINESS_VALUE_HINTS = [
  { dimension: "especie", value: "ALCACHOFA", pattern: /\balcachofa\b/i },
  { dimension: "especie", value: "PIMIENTO", pattern: /\bpimiento\b/i },
  { dimension: "cliente", value: "HORTISEMILLAS", pattern: /\bhortisemillas\b/i },
  { dimension: "representante", value: "AGRICOMAR", pattern: /\bagricomar\b/i },
  { dimension: "pais", value: "PT", pattern: /\bportugal\b/i },
  { dimension: "pais", value: "ES", pattern: /\bespa[nñ]a\b/i },
  { dimension: "pais", value: "ES", pattern: /\bventas?\s+de\s+es\b|\bde\s+es\s+por\b|\bpa[ií]s\s+es\b/i }
];

const UNSUPPORTED_PATTERNS = [
  /\bmargen\b/i,
  /\bbeneficio\b/i,
  /\brentabil/i,
  /\bprevisi[oó]n\b/i,
  /\bforecast\b/i,
  /\bpron[oó]stico\b/i,
  /\bdetalle de factura\b/i,
  /\bfactura concreta\b/i,
  /\bdatos personales\b/i,
  /\bdame todos los clientes\b/i,
  /\blistado completo\b/i,
  /\bexportaci[oó]n masiva\b/i,
  /\btodo el listado\b/i,
  /\bejecuta este dax\b/i,
  /\bevaluate\b/i,
  /\bdefine\b/i,
  /\binfo\b/i,
  /\bdmv\b/i
];

function normalizeText(value) {
  return String(value || "").trim();
}

function stripAccents(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuestion(value) {
  const text = stripAccents(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s€]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text
    .replace(/\bcuanto\s+se\s+vendio\b/g, "cuanto se ha vendido")
    .replace(/\bcuanto\s+se\s+ha\s+vendido\b/g, "cuanto se ha vendido")
    .replace(/\bcuanto\s+hemos\s+vendido\b/g, "cuanto se ha vendido")
    .replace(/\bcuanto\s+hemos\s+vendio\b/g, "cuanto se ha vendido")
    .replace(/\bse\s+vendio\b/g, "se ha vendido")
    .replace(/\bhemos\s+vendio\b/g, "hemos vendido")
    .replace(/\bvendio\b/g, "vendido")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => normalizeText(item)).filter(Boolean))];
}

function hasAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function safeInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function numberWordToInt(value) {
  const key = stripAccents(value).toLowerCase();
  const map = new Map([
    ["un", 1],
    ["una", 1],
    ["uno", 1],
    ["dos", 2],
    ["tres", 3],
    ["cuatro", 4],
    ["cinco", 5],
    ["seis", 6],
    ["siete", 7],
    ["ocho", 8],
    ["nueve", 9],
    ["diez", 10],
    ["veinte", 20]
  ]);
  return map.get(key) || null;
}

function monthName(month) {
  return MONTHS.find((item) => item.month === Number(month))?.name || "";
}

function monthRegex() {
  return MONTHS.map((item) => item.name).join("|");
}

function detectQuestionLengthIssue(question) {
  const text = normalizeText(question);
  if (!text) {
    return "La pregunta está vacía. Escribe una pregunta corta sobre ventas o unidades.";
  }
  if (text.length > MAX_QUESTION_LENGTH) {
    return "La pregunta es demasiado larga. Escribe una pregunta más corta sobre ventas o unidades.";
  }
  return null;
}

function detectUnsupportedQuestion(text) {
  if (!text) {
    return null;
  }
  if (hasAnyPattern(text, UNSUPPORTED_PATTERNS)) {
    return "No puedo responder eso todavía con el modelo actual. Puedo consultar ventas o unidades por cliente, producto, país, familia, representante, tipo, especie o mes.";
  }
  return null;
}

function findMonth(text) {
  return MONTHS.find((item) => new RegExp(`\\b${item.name}\\b`, "i").test(text)) || null;
}

function findAllMonths(text) {
  return MONTHS.filter((item) => new RegExp(`\\b${item.name}\\b`, "i").test(text));
}

function detectFunctionalPageHint(text) {
  const rule = FUNCTIONAL_PAGE_RULES.find((item) => item.pattern.test(text));
  if (!rule) {
    return null;
  }
  return {
    logicalPage: rule.page,
    metric: rule.metric,
    dimension: rule.dimension,
    sourceText: rule.pattern.toString()
  };
}

function inferLogicalPage(metric, dimension, pageHint = null) {
  if (pageHint?.logicalPage) {
    return pageHint.logicalPage;
  }
  const metricKey = normalizeText(metric).toLowerCase();
  const dimensionKey = normalizeText(dimension).toLowerCase();
  if (!metricKey || !dimensionKey) {
    return null;
  }
  const suffix = metricKey === "unidades" ? "UDS" : "€";
  if (["producto", "articulo", "especie", "tipo", "familia"].includes(dimensionKey)) {
    return `PRODUCTOS ${suffix}`;
  }
  if (dimensionKey === "cliente") {
    return `CLIENTES ${metricKey === "unidades" ? "UNDS" : "€"}`;
  }
  if (dimensionKey === "representante") {
    return `REPRESENTANTES ${suffix}`;
  }
  if (dimensionKey === "pais") {
    return `PAISES ${suffix}`;
  }
  return null;
}

function buildDateRange(type, label, sourceText, extra = {}) {
  return {
    type,
    label,
    sourceText: sourceText || label,
    ...extra
  };
}

function detectDateRange(text) {
  if (!text) {
    return {
      timeRange: "all_time",
      dateRange: buildDateRange("all_time", "Sin filtro de fecha", ""),
      matchedTerm: "",
      issue: null
    };
  }

  const monthPattern = monthRegex();
  const monthRangeMatch = text.match(new RegExp(`\\bde\\s+(${monthPattern})\\s+a\\s+(${monthPattern})\\b`, "i"));
  if (monthRangeMatch) {
    const fromMonth = MONTHS.find((item) => item.name === monthRangeMatch[1])?.month;
    const toMonth = MONTHS.find((item) => item.name === monthRangeMatch[2])?.month;
    if (fromMonth && toMonth && fromMonth <= toMonth) {
      return {
        timeRange: "month_range_current_year",
        dateRange: buildDateRange(
          "month_range_current_year",
          `${monthName(fromMonth)}-${monthName(toMonth)} ${CURRENT_YEAR}`,
          monthRangeMatch[0],
          { fromMonth, toMonth, yearMode: "current", year: CURRENT_YEAR }
        ),
        matchedTerm: monthRangeMatch[0],
        issue: null
      };
    }
  }

  const monthSpecificYearMatch = text.match(new RegExp(`\\b(${monthPattern})(?:\\s+de)?\\s+(20\\d{2})\\b`, "i"));
  if (monthSpecificYearMatch) {
    const month = MONTHS.find((item) => item.name === monthSpecificYearMatch[1])?.month;
    const year = safeInt(monthSpecificYearMatch[2], CURRENT_YEAR, 2000, 2100);
    return {
      timeRange: "month_specific_year",
      dateRange: buildDateRange("month_specific_year", `${monthName(month)} ${year}`, monthSpecificYearMatch[0], {
        month,
        year
      }),
      matchedTerm: monthSpecificYearMatch[0],
      issue: null
    };
  }

  const month = findMonth(text);
  const hasCurrentYear = /\beste a[nñ]o\b|\ba[nñ]o actual\b|\bejercicio actual\b/i.test(text);
  if (month && (hasCurrentYear || /\ben\s+/.test(text))) {
    return {
      timeRange: "month_current_year",
      dateRange: buildDateRange("month_current_year", `${month.name} ${CURRENT_YEAR}`, month.name, {
        month: month.month,
        yearMode: "current",
        year: CURRENT_YEAR
      }),
      matchedTerm: hasCurrentYear ? `este año en ${month.name}` : month.name,
      issue: null
    };
  }

  const yearMatch = text.match(/\b(?:a[nñ]o\s+|en\s+|del\s+)?(20\d{2})\b/i);
  if (yearMatch) {
    const year = safeInt(yearMatch[1], CURRENT_YEAR, 2000, 2100);
    return {
      timeRange: "year_specific",
      dateRange: buildDateRange("year_specific", `año ${year}`, yearMatch[0], { year }),
      matchedTerm: yearMatch[0],
      issue: null
    };
  }

  for (const quarter of QUARTERS) {
    if (quarter.pattern.test(text)) {
      return {
        timeRange: "quarter_current_year",
        dateRange: buildDateRange("quarter_current_year", `${quarter.label} ${CURRENT_YEAR}`, quarter.label, {
          quarter: quarter.quarter,
          yearMode: "current",
          year: CURRENT_YEAR
        }),
        matchedTerm: quarter.label,
        issue: null
      };
    }
  }

  const lastDaysMatch = text.match(/\b[uú]ltim[oa]s?\s+(\d{1,3})\s+d[ií]as\b/i);
  if (lastDaysMatch) {
    const days = safeInt(lastDaysMatch[1], 7, 1, 120);
    return {
      timeRange: `last_${days}_days`,
      dateRange: buildDateRange("last_n_days", `últimos ${days} días`, lastDaysMatch[0], { amount: days, unit: "day" }),
      matchedTerm: lastDaysMatch[0],
      issue: null
    };
  }

  const lastMonthsMatch = text.match(/\b[uú]ltim[oa]s?\s+(\d{1,2})\s+meses\b/i);
  if (lastMonthsMatch) {
    const months = safeInt(lastMonthsMatch[1], 12, 1, 24);
    return {
      timeRange: `last_${months}_months`,
      dateRange: buildDateRange("last_n_months", `últimos ${months} meses`, lastMonthsMatch[0], {
        amount: months,
        unit: "month"
      }),
      matchedTerm: lastMonthsMatch[0],
      issue: null
    };
  }

  const ranges = [
    {
      pattern: /\bhoy\b/i,
      timeRange: "today",
      dateRange: buildDateRange("today", "hoy", "hoy")
    },
    {
      pattern: /\bayer\b/i,
      timeRange: "yesterday",
      dateRange: buildDateRange("yesterday", "ayer", "ayer")
    },
    {
      pattern: /\besta\s+semana\b/i,
      timeRange: "current_week",
      dateRange: buildDateRange("current_week", "esta semana", "esta semana")
    },
    {
      pattern: /\bsemana\s+pasada\b/i,
      timeRange: "previous_week",
      dateRange: buildDateRange("previous_week", "semana pasada", "semana pasada")
    },
    {
      pattern: /\beste\s+mes\b|\bmes\s+actual\b/i,
      timeRange: "current_month",
      dateRange: buildDateRange("current_month", "este mes", "este mes")
    },
    {
      pattern: /\bmes\s+pasado\b|\bmes\s+anterior\b/i,
      timeRange: "previous_month",
      dateRange: buildDateRange("previous_month", "mes pasado", "mes pasado")
    },
    {
      pattern: /\beste\s+trimestre\b|\btrimestre\s+actual\b/i,
      timeRange: "current_quarter",
      dateRange: buildDateRange("current_quarter", "este trimestre", "este trimestre")
    },
    {
      pattern: /\btrimestre\s+pasado\b|\btrimestre\s+anterior\b/i,
      timeRange: "previous_quarter",
      dateRange: buildDateRange("previous_quarter", "trimestre pasado", "trimestre pasado")
    },
    {
      pattern: /\beste\s+a[nñ]o\b|\ba[nñ]o\s+actual\b|\bejercicio\s+actual\b/i,
      timeRange: "current_year",
      dateRange: buildDateRange("current_year", `año ${CURRENT_YEAR}`, "este año", {
        yearMode: "current",
        year: CURRENT_YEAR
      })
    },
    {
      pattern: /\ba[nñ]o\s+pasado\b|\bejercicio\s+anterior\b/i,
      timeRange: "previous_year",
      dateRange: buildDateRange("previous_year", `año ${CURRENT_YEAR - 1}`, "año pasado", {
        yearMode: "previous",
        year: CURRENT_YEAR - 1
      })
    }
  ];

  const range = ranges.find((item) => item.pattern.test(text));
  if (range) {
    return {
      timeRange: range.timeRange,
      dateRange: range.dateRange,
      matchedTerm: range.dateRange.sourceText,
      issue: null
    };
  }

  return {
    timeRange: "all_time",
    dateRange: buildDateRange("all_time", "Sin filtro de fecha", ""),
    matchedTerm: "",
    issue: null
  };
}

function detectMetricMatches(text) {
  const matches = [];
  for (const [key, config] of Object.entries(ALLOWED_METRICS)) {
    if (hasAnyPattern(text, config.patterns)) {
      matches.push({
        metric: key,
        aggregation: config.aggregation,
        label: config.label,
        terms: config.matchedTerms
      });
    }
  }
  return matches;
}

function resolveMetricMatches(text, metricMatches) {
  const matches = Array.isArray(metricMatches) ? metricMatches : [];
  const wantsUnits = /\bc[uú]antas?\s+unidades?\b|\bunidades?\b|\buds?\b|\bpiezas?\b|\bcantidad(?:es)?\b|\bkilos?\b|\bkg\b/i.test(text);
  const wantsSales = /\bc[uú]ant[ao]s?\s+ventas?\b|\bc[uú]anto\s+(?:se\s+ha\s+vendido|hemos\s+vendido)\b|\bse\s+ha\s+vendido\b|\bhemos\s+vendido\b|\bvendid[oa]s?\b|\bventas?\b|\bfacturaci[oó]n\b|\bimporte\b|\beuros?\b|€/i.test(text);

  if (wantsUnits && !/\bventas?\b/i.test(text.replace(/\bunidades?\b|\buds?\b|\bpiezas?\b|\bcantidad(?:es)?\b|\bkilos?\b|\bkg\b/i, " "))) {
    return matches.filter((item) => item.metric === "unidades");
  }
  if (wantsSales && !/\bunidades?\b|\buds?\b|\bpiezas?\b|\bcantidad(?:es)?\b|\bkilos?\b|\bkg\b/i.test(text)) {
    return matches.filter((item) => item.metric === "ventas_eur");
  }
  if (matches.length <= 1) {
    return matches;
  }
  if (wantsUnits) {
    return matches.filter((item) => item.metric === "unidades");
  }
  if (wantsSales) {
    return matches.filter((item) => item.metric === "ventas_eur");
  }
  return matches;
}

function detectDimensionMatches(text) {
  const matches = [];
  for (const [key, config] of Object.entries(ALLOWED_DIMENSIONS)) {
    if (hasAnyPattern(text, config.patterns)) {
      matches.push({
        dimension: key,
        label: config.label,
        terms: config.matchedTerms
      });
    }
  }

  const missingDimension = UNKNOWN_DIMENSION_PATTERNS.find((item) => item.pattern.test(text))?.dimension || null;
  const productLikeDimensions = new Set(["articulo", "producto"]);
  const articleProductConflict =
    matches.some((item) => item.dimension === "articulo") &&
    matches.some((item) => item.dimension === "producto");

  if (articleProductConflict && matches.every((item) => productLikeDimensions.has(item.dimension))) {
    return {
      matches: [{
        dimension: "producto",
        label: ALLOWED_DIMENSIONS.producto.label,
        terms: ["producto", "artículo", "nombre"]
      }],
      missingDimension,
      ambiguous: false,
      clarificationQuestion: null
    };
  }

  if (matches.length > 1) {
    return {
      matches,
      missingDimension,
      ambiguous: true,
      clarificationQuestion: "Hay más de una dimensión posible. ¿Quieres cliente, producto, familia, representante, país, tipo o especie?"
    };
  }

  return {
    matches,
    missingDimension,
    ambiguous: false,
    clarificationQuestion: null
  };
}

function detectGranularity(text) {
  if (/\bpor\s+a[nñ]os?\b|\banual(?:es)?\b|\ba[nñ]o\s+a\s+a[nñ]o\b/i.test(text)) {
    return "year";
  }
  if (/\bpor\s+mes(?:es)?\b|\bmensual(?:es)?\b|\bmes\s+a\s+mes\b|\bevoluci[oó]n\b/i.test(text)) {
    return "month";
  }
  return null;
}

function detectTopN(text) {
  const explicit = text.match(
    /\b(?:top|primeros?|primeras?|principales?|mejores?|peores?|bottom)\s*(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|\d{1,3})\b/i
  );
  if (explicit) {
    const value = Number.parseInt(explicit[1], 10);
    const parsedValue = Number.isFinite(value) ? value : numberWordToInt(explicit[1]);
    return {
      found: true,
      value: parsedValue || DEFAULT_TOP_N,
      explicit: true,
      order: /\bpeores?|bottom|menos\b/i.test(text) ? "asc" : "desc",
      label: `${/\bpeores?|bottom|menos\b/i.test(text) ? "bottom" : "top"} ${parsedValue || DEFAULT_TOP_N}`
    };
  }

  const wordNumber = text.match(
    /\b(?:los|las|el|la)?\s*(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|\d{1,3})\s+(?:clientes?|productos?|art[ií]culos?|familias?|tipos?|especies?|variedad(?:es)?|clases?|representantes?|pa[ií]ses?)\b/i
  );
  if (wordNumber) {
    const parsed = Number.parseInt(wordNumber[1], 10);
    const value = Number.isFinite(parsed) ? parsed : numberWordToInt(wordNumber[1]);
    if (value) {
      return {
        found: true,
        value,
        explicit: true,
        order: /\bpeores?|bottom|menos\b/i.test(text) ? "asc" : "desc",
        label: `${/\bpeores?|bottom|menos|menor(?:es)?\b/i.test(text) ? "bottom" : "top"} ${value}`
      };
    }
  }

  const mostSoldPattern =
    /\bm[aá]s\s+vendid[oa]s?\b|\bvendid[oa]s?\s+m[aá]s\b|\bm[aá]s\s+ventas?\b|\bm[aá]s\s+unidades?\b|\btiene\s+m[aá]s\s+ventas?\b|\bcon\s+m[aá]s\s+ventas?\b|\bcon\s+m[aá]s\s+unidades?\b|\bm[aá]s\s+compraron\b|\bque\s+m[aá]s\s+compraron\b|\bm[aá]s\s+factur|\bfactura\s+m[aá]s/i;
  const asksForSingleBest =
    /\b(?:que|cual|cu[aá]l)\b.+\b(?:m[aá]s\s+vendid[oa]s?|vendid[oa]s?\s+m[aá]s)\b/i.test(text) ||
    /\b(?:que|cual|cu[aá]l)\b.+\b(?:m[aá]s\s+factur|factura\s+m[aá]s|m[aá]s\s+ventas?|m[aá]s\s+unidades?)\b/i.test(text) ||
    /\b(?:cliente|producto|articulo|art[ií]culo|familia|tipo|especie|variedad|clase|representante|pa[ií]s)\s+m[aá]s\s+vendid[oa]\b/i.test(text);

  if (mostSoldPattern.test(text)) {
    const value = asksForSingleBest ? 1 : DEFAULT_TOP_N;
    return {
      found: true,
      value,
      explicit: false,
      order: "desc",
      label: `top ${value}`
    };
  }

  if (/\btop\b|\bprimeros?\b|\bprimeras?\b|\bprincipales?\b|\bmejores?\b/i.test(text)) {
    return {
      found: true,
      value: DEFAULT_TOP_N,
      explicit: false,
      order: "desc",
      label: "top 10"
    };
  }

  if (
    /\bpeores?\b|\bpeor(?:es)?\s+(?:clientes?|productos?|art[ií]culos?|representantes?|pa[ií]ses?)\b|\bbottom\b|\b[uú]ltimos?\s+por\s+(?:ventas?|unidades?)\b|\bmenos\s+vendid[oa]s?\b|\bcon\s+menos\s+ventas?\b|\bcon\s+menos\s+unidades?\b|\bmenor(?:es)?\s+ventas?\b|\bmenor(?:es)?\s+facturaci[oó]n\b|\bmenor(?:es)?\s+importe\b/i.test(text)
  ) {
    return {
      found: true,
      value: DEFAULT_TOP_N,
      explicit: false,
      order: "asc",
      label: "bottom 10"
    };
  }

  return {
    found: false,
    value: DEFAULT_TOP_N,
    explicit: false,
    order: "desc",
    label: ""
  };
}

function detectComparison(text) {
  const hasComparison =
    /\bvs\b|\bversus\b|\bcompar(a|ar|ativa)\b|\bdiferencia\b|\brespecto\b|\bcrecimiento\b/i.test(text);
  if (!hasComparison) {
    return null;
  }

  const yearComparisonMatch = text.match(
    /\b(20\d{2})\s+(?:contra|vs|versus|respecto\s+a|frente\s+a|comparad[oa]\s+con)\s+(20\d{2})\b/i
  );
  if (yearComparisonMatch) {
    const currentYear = safeInt(yearComparisonMatch[1], CURRENT_YEAR, 2000, 2100);
    const previousYear = safeInt(yearComparisonMatch[2], CURRENT_YEAR - 1, 2000, 2100);
    return {
      type: "year_vs_year",
      label: `${currentYear} vs ${previousYear}`,
      periods: [
        {
          label: `Año ${currentYear}`,
          dateRange: buildDateRange("year_specific", `año ${currentYear}`, String(currentYear), {
            year: currentYear
          })
        },
        {
          label: `Año ${previousYear}`,
          dateRange: buildDateRange("year_specific", `año ${previousYear}`, String(previousYear), {
            year: previousYear
          })
        }
      ]
    };
  }

  const yearBetweenMatch = text.match(/\bentre\s+(20\d{2})\s+y\s+(20\d{2})\b/i);
  if (yearBetweenMatch) {
    const firstYear = safeInt(yearBetweenMatch[1], CURRENT_YEAR - 1, 2000, 2100);
    const secondYear = safeInt(yearBetweenMatch[2], CURRENT_YEAR, 2000, 2100);
    return {
      type: "year_vs_year",
      label: `${secondYear} vs ${firstYear}`,
      periods: [
        {
          label: `Año ${secondYear}`,
          dateRange: buildDateRange("year_specific", `año ${secondYear}`, String(secondYear), {
            year: secondYear
          })
        },
        {
          label: `Año ${firstYear}`,
          dateRange: buildDateRange("year_specific", `año ${firstYear}`, String(firstYear), {
            year: firstYear
          })
        }
      ]
    };
  }

  if (/\beste\s+mes\b/i.test(text) && /\bmes\s+pasado\b|\bmes\s+anterior\b/i.test(text)) {
    return {
      type: "current_month_vs_previous_month",
      label: "este mes vs mes pasado",
      periods: [
        { label: "Este mes", dateRange: buildDateRange("current_month", "este mes", "este mes") },
        { label: "Mes pasado", dateRange: buildDateRange("previous_month", "mes pasado", "mes pasado") }
      ]
    };
  }

  if (/\beste\s+a[nñ]o\b/i.test(text) && /\ba[nñ]o\s+pasado\b|\bejercicio\s+anterior\b/i.test(text)) {
    return {
      type: "current_year_vs_previous_year",
      label: "este año vs año pasado",
      periods: [
        { label: `Año ${CURRENT_YEAR}`, dateRange: buildDateRange("current_year", `año ${CURRENT_YEAR}`, "este año") },
        { label: `Año ${CURRENT_YEAR - 1}`, dateRange: buildDateRange("previous_year", `año ${CURRENT_YEAR - 1}`, "año pasado") }
      ]
    };
  }

  const months = findAllMonths(text);
  if (months.length >= 2) {
    const first = months[0];
    const second = months[1];
    return {
      type: "month_vs_month_current_year",
      label: `${first.name} vs ${second.name} ${CURRENT_YEAR}`,
      periods: [
        {
          label: `${first.name} ${CURRENT_YEAR}`,
          dateRange: buildDateRange("month_current_year", `${first.name} ${CURRENT_YEAR}`, first.name, {
            month: first.month,
            yearMode: "current",
            year: CURRENT_YEAR
          })
        },
        {
          label: `${second.name} ${CURRENT_YEAR}`,
          dateRange: buildDateRange("month_current_year", `${second.name} ${CURRENT_YEAR}`, second.name, {
            month: second.month,
            yearMode: "current",
            year: CURRENT_YEAR
          })
        }
      ]
    };
  }

  return {
    type: "unsupported_comparison",
    label: "comparativa no soportada",
    issue:
      "Puedo comparar este mes vs mes pasado, este año vs año pasado o dos meses concretos. Reformula la comparación con uno de esos patrones."
  };
}

function detectValueFilters(text, dimensionMatches) {
  const filters = [];
  const configs = [
    { dimension: "cliente", pattern: /\b(?:del|de la|de|para el|para la)\s+cliente\s+(.+?)(?=\s+\b(?:en|este|esta|a[nñ]o|mes|trimestre|por|top|vs|$)\b|$)/i },
    { dimension: "articulo", pattern: /\b(?:del|de la|de)\s+art[ií]culo\s+(.+?)(?=\s+\b(?:en|este|esta|a[nñ]o|mes|trimestre|por|top|vs|$)\b|$)/i },
    { dimension: "producto", pattern: /\b(?:del|de la|de)\s+producto\s+(.+?)(?=\s+\b(?:en|este|esta|a[nñ]o|mes|trimestre|por|top|vs|$)\b|$)/i },
    { dimension: "familia", pattern: /\b(?:de la|de)\s+familia\s+(.+?)(?=\s+\b(?:en|este|esta|a[nñ]o|mes|trimestre|por|top|vs|$)\b|$)/i },
    { dimension: "representante", pattern: /\b(?:del|de la|de)\s+(?:representante|comercial|vendedor)\s+(.+?)(?=\s+\b(?:en|este|esta|a[nñ]o|mes|trimestre|por|top|vs|$)\b|$)/i },
    { dimension: "pais", pattern: /\b(?:del|de la|de|para el|para la)\s+pa[ií]s\s+(.+?)(?=\s+\b(?:en|este|esta|a[nñ]o|mes|trimestre|por|top|vs|$)\b|$)/i }
  ];

  for (const config of configs) {
    const match = text.match(config.pattern);
    const value = normalizeText(match?.[1] || "").replace(/\b(del|de|la|el)$/i, "").trim();
    const invalidValue = /^(por|en|este|esta|a[nñ]o|mes|trimestre|ventas?|unidades?|uds?|cantidad|importe|euros?)\b/i.test(value);
    if (value && !invalidValue && value.length >= 2 && value.length <= 80) {
      filters.push({
        dimension: config.dimension,
        operator: "contains",
        value,
        sourceText: match[0]
      });
    }
  }

  for (const hint of BUSINESS_VALUE_HINTS) {
    if (!hint.pattern.test(text)) {
      continue;
    }
    const exists = filters.some(
      (filter) =>
        filter.dimension === hint.dimension &&
        stripAccents(filter.value).toLowerCase() === stripAccents(hint.value).toLowerCase()
    );
    if (!exists) {
      filters.push({
        dimension: hint.dimension,
        operator: "contains",
        value: hint.value,
        sourceText: hint.value,
        source: "functional_dictionary"
      });
    }
  }

  const detectedDimension = dimensionMatches.matches[0]?.dimension || null;
  return filters.filter((filter) => filter.dimension !== detectedDimension || !/^por\s+/i.test(filter.sourceText));
}

function hasExplicitGroupingRequest(text) {
  return /\bpor\s+(clientes?|compradores?|art[ií]culos?|referencias?|sku|productos?|familias?|categor[ií]as?|grupos?|representantes?|comerciales?|vendedores?|pa[ií]ses?|tipos?|especies?|variedad(?:es)?|clases?)\b/i.test(text);
}

function detectIntent({ text, metricMatches, dimensionMatches, topNInfo, granularity, comparison }) {
  if (comparison?.type && comparison.type !== "unsupported_comparison") {
    return "comparison_metric";
  }
  if (granularity === "year") {
    return "metric_by_year";
  }
  if (granularity === "month") {
    return "metric_by_month";
  }
  if (topNInfo.found && dimensionMatches.matches.length > 0) {
    return "top_dimension_by_metric";
  }
  if (dimensionMatches.matches.length > 0) {
    return "metric_by_dimension";
  }
  if (metricMatches.length > 0 || /\bventas?\b|\bvendido\b|\bfacturaci[oó]n\b|\bunidades?\b/i.test(text)) {
    return "total_metric";
  }
  return null;
}

function chooseMetric(metricMatches, text, intent) {
  if (/\bc[uú]antas?\s+unidades?\b|\bunidades?\b|\buds?\b|\bpiezas?\b|\bcantidad(?:es)?\b|\bkilos?\b|\bkg\b/i.test(text)) {
    return "unidades";
  }
  if (/\bc[uú]ant[ao]s?\s+ventas?\b|\bc[uú]anto\s+(?:se\s+ha\s+vendido|hemos\s+vendido)\b|\bse\s+ha\s+vendido\b|\bhemos\s+vendido\b|\bvendid[oa]s?\b|\bventas?\b|\bfacturaci[oó]n\b|\bimporte\b|\beuros?\b|€/i.test(text)) {
    return "ventas_eur";
  }
  if (metricMatches.length === 1) {
    return metricMatches[0].metric;
  }
  if (metricMatches.length > 1) {
    return null;
  }
  if (
    intent === "metric_by_month" ||
    intent === "metric_by_year" ||
    intent === "metric_by_dimension" ||
    intent === "top_dimension_by_metric" ||
    intent === "comparison_metric"
  ) {
    return "ventas_eur";
  }
  return null;
}

function buildClarificationQuestion({ questionIssue, unsupportedIssue, comparison, missingDimension, dimensionMatches, metricMatches, intent }) {
  if (questionIssue) {
    return questionIssue;
  }
  if (unsupportedIssue) {
    return unsupportedIssue;
  }
  if (comparison?.issue) {
    return comparison.issue;
  }
  if (missingDimension) {
    return `No encuentro la dimensión ${missingDimension} en el modelo. Puedo agrupar por cliente, producto, país, familia, representante, tipo o especie.`;
  }
  if (metricMatches.length > 1) {
    return "¿Quieres consultar importe vendido, unidades vendidas o número de operaciones?";
  }
  if (dimensionMatches.ambiguous) {
    return dimensionMatches.clarificationQuestion || "Hay más de una dimensión posible.";
  }
  if (!intent) {
    return "No entiendo la pregunta. Puedo consultar ventas o unidades por cliente, producto, país, familia, representante, tipo, especie, mes o año.";
  }
  return null;
}

export function interpretPowerBiQuestion(question, options = {}) {
  const modelKey = normalizeText(options.modelKey || ALLOWED_MODEL_KEY).toLowerCase();
  const normalizedModelKey = modelKey === ALLOWED_MODEL_KEY ? ALLOWED_MODEL_KEY : ALLOWED_MODEL_KEY;
  const rawQuestion = normalizeText(question);
  const normalizedQuestion = normalizeQuestion(rawQuestion);
  const questionIssue = detectQuestionLengthIssue(rawQuestion);
  const unsupportedIssue = questionIssue ? null : detectUnsupportedQuestion(normalizedQuestion);
  const pageHint = questionIssue || unsupportedIssue ? null : detectFunctionalPageHint(normalizedQuestion);
  const dateDetection = questionIssue || unsupportedIssue ? {
    timeRange: "all_time",
    dateRange: buildDateRange("all_time", "Sin filtro de fecha", ""),
    matchedTerm: "",
    issue: null
  } : detectDateRange(normalizedQuestion);
  const metricMatchesRaw = questionIssue || unsupportedIssue ? [] : detectMetricMatches(normalizedQuestion);
  const metricMatches = resolveMetricMatches(normalizedQuestion, metricMatchesRaw);
  const dimensionMatches = questionIssue || unsupportedIssue
    ? { matches: [], missingDimension: null, ambiguous: false, clarificationQuestion: null }
    : detectDimensionMatches(normalizedQuestion);
  if (pageHint?.dimension && !dimensionMatches.matches.some((item) => item.dimension === pageHint.dimension)) {
    dimensionMatches.matches.push({
      dimension: pageHint.dimension,
      label: ALLOWED_DIMENSIONS[pageHint.dimension]?.label || pageHint.dimension,
      terms: [pageHint.dimension]
    });
  }
  const topNInfo = questionIssue || unsupportedIssue ? { found: false, value: DEFAULT_TOP_N, explicit: false, order: "desc", label: "" } : detectTopN(normalizedQuestion);
  const granularity = questionIssue || unsupportedIssue ? null : detectGranularity(normalizedQuestion);
  const comparison = questionIssue || unsupportedIssue ? null : detectComparison(normalizedQuestion);
  const filters = questionIssue || unsupportedIssue ? [] : detectValueFilters(normalizedQuestion, dimensionMatches);
  const effectiveDimensionMatches = filters.length && !topNInfo.found && !hasExplicitGroupingRequest(normalizedQuestion)
    ? { ...dimensionMatches, matches: [] }
    : dimensionMatches;

  const warnings = [];
  const matchedTerms = [];
  const ambiguity = [];
  const missingInfo = [];

  if (questionIssue) {
    warnings.push(questionIssue);
    missingInfo.push("question");
  }
  if (unsupportedIssue) {
    warnings.push(unsupportedIssue);
  }
  if (comparison?.issue) {
    warnings.push(comparison.issue);
  }
  if (effectiveDimensionMatches.missingDimension) {
    warnings.push(`Dimensión no encontrada: ${effectiveDimensionMatches.missingDimension}.`);
    missingInfo.push("dimension");
  }
  if (topNInfo.found && topNInfo.value > MAX_TOP_N) {
    warnings.push(`topN debe estar entre 1 y ${MAX_TOP_N}.`);
    missingInfo.push("topN");
  }

  const intent = questionIssue || unsupportedIssue || comparison?.issue || effectiveDimensionMatches.missingDimension
    ? null
    : detectIntent({
        text: normalizedQuestion,
        metricMatches,
        dimensionMatches: effectiveDimensionMatches,
        topNInfo,
        granularity,
        comparison
      });
  let metric = questionIssue || unsupportedIssue ? null : chooseMetric(metricMatches, normalizedQuestion, intent);
  let dimension = questionIssue || unsupportedIssue ? null : (effectiveDimensionMatches.matches[0]?.dimension || null);
  let topN = topNInfo.value;

  if (metricMatches.length > 1 && !metric) {
    ambiguity.push("metric");
    warnings.push("Solo puedo interpretar una métrica por pregunta.");
  }
  if (effectiveDimensionMatches.ambiguous) {
    dimension = null;
    ambiguity.push("dimension");
    warnings.push("La pregunta tiene más de una dimensión posible.");
  }
  if (topNInfo.found && topN > MAX_TOP_N) {
    topN = MAX_TOP_N;
  }

  if (intent === "metric_by_dimension" || intent === "top_dimension_by_metric") {
    const ordered = DIMENSION_ORDER.find((item) => item === dimension) || dimension;
    dimension = ordered || null;
  }

  if (/\bvariedad(?:es)?\b|\bclases?\b/i.test(normalizedQuestion) && dimension === "producto") {
    warnings.push("He interpretado variedad como nombre de producto/artículo.");
  }

  if (intent === "metric_by_month" || intent === "metric_by_year" || intent === "comparison_metric") {
    dimension = null;
  }

  if (!metric && intent) {
    metric = pageHint?.metric || "ventas_eur";
  }
  if (pageHint?.metric && intent) {
    metric = pageHint.metric;
  }

  if (/\bc[uú]ant[ao]s?\s+ventas?\b/i.test(normalizedQuestion) && metric === "ventas_eur") {
    warnings.push("He interpretado ventas como importe vendido.");
  }

  const logicalPage = inferLogicalPage(metric, dimension, pageHint);

  for (const metricMatch of metricMatches) {
    matchedTerms.push(...(metricMatch.terms || []));
  }
  for (const dimensionMatch of effectiveDimensionMatches.matches) {
    matchedTerms.push(...(dimensionMatch.terms || []));
  }
  if (dateDetection.matchedTerm) {
    matchedTerms.push(dateDetection.matchedTerm);
  }
  if (topNInfo.found) {
    matchedTerms.push(topNInfo.label || `top ${topN}`);
  }
  if (granularity) {
    matchedTerms.push(`por ${granularity === "year" ? "año" : "mes"}`);
  }
  if (logicalPage) {
    matchedTerms.push(logicalPage);
  }

  const hasSupport =
    !questionIssue &&
    !unsupportedIssue &&
    !comparison?.issue &&
    !effectiveDimensionMatches.missingDimension &&
    Boolean(intent) &&
    Boolean(metric) &&
    (intent === "total_metric" ||
      intent === "metric_by_month" ||
      intent === "metric_by_year" ||
      intent === "comparison_metric" ||
      Boolean(dimension));

  let confidence = 0;
  if (hasSupport) {
    confidence = 0.35;
    if (metric) confidence += 0.25;
    if (dimension) confidence += 0.2;
    if (intent === "total_metric") confidence += 0.15;
    if (intent === "top_dimension_by_metric") confidence += 0.15;
    if (intent === "metric_by_month" || intent === "metric_by_year") confidence += 0.15;
    if (intent === "comparison_metric") confidence += 0.18;
    if (topNInfo.explicit) confidence += 0.05;
    if (dateDetection.timeRange !== "all_time") confidence += 0.08;
    if (filters.length) confidence += 0.04;
    confidence = Math.min(0.99, confidence);
  } else if (!questionIssue && !unsupportedIssue && (metricMatches.length || effectiveDimensionMatches.matches.length)) {
    confidence = 0.4;
  }
  if (ambiguity.length || missingInfo.length) {
    confidence = Math.min(confidence, 0.6);
  }

  const needsClarification = Boolean(
    questionIssue ||
      unsupportedIssue ||
      comparison?.issue ||
      effectiveDimensionMatches.missingDimension ||
      ambiguity.length ||
      !hasSupport
  );

  const clarificationQuestion = buildClarificationQuestion({
    questionIssue,
    unsupportedIssue,
    comparison,
    missingDimension: effectiveDimensionMatches.missingDimension,
    dimensionMatches: effectiveDimensionMatches,
    metricMatches,
    intent
  });

  const ranking = topNInfo.found
    ? {
        limit: topN,
        order: topNInfo.order,
        label: topNInfo.order === "asc" ? `Bottom ${topN}` : `Top ${topN}`
      }
    : null;

  const plan = {
    intent: intent || null,
    metric: metric || null,
    aggregation: metric ? ALLOWED_METRICS[metric]?.aggregation || "sum" : null,
    dimensions: dimension ? [dimension] : [],
    filters,
    dateRange: dateDetection.dateRange,
    ranking,
    comparison: comparison?.issue ? null : comparison,
    granularity: granularity || null,
    logicalPage,
    ambiguity,
    missingInfo,
    confidence: confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low"
  };

  const finalWarnings = uniqueList(warnings);

  return {
    modelKey: normalizedModelKey,
    normalizedQuestion,
    intent: intent || null,
    metric: metric || null,
    aggregation: plan.aggregation,
    dimension: dimension || null,
    dimensions: plan.dimensions,
    filters,
    dateRange: dateDetection.dateRange,
    timeRange: dateDetection.timeRange || "all_time",
    ranking,
    comparison: plan.comparison,
    granularity: granularity || null,
    logicalPage,
    topN: topNInfo.found ? topN : DEFAULT_TOP_N,
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel: plan.confidence,
    ambiguity,
    missingInfo,
    needsClarification,
    clarificationQuestion: clarificationQuestion || null,
    matchedTerms: uniqueList(matchedTerms),
    warnings: finalWarnings,
    plan
  };
}

export function buildPowerBiAskLabPayload(question, options = {}) {
  const interpretation = interpretPowerBiQuestion(question, options);
  if (!interpretation.intent || !interpretation.metric) {
    return {
      interpretation,
      payload: null
    };
  }

  const payload = {
    question: normalizeText(question),
    modelKey: ALLOWED_MODEL_KEY,
    intent: interpretation.intent,
    metric: interpretation.metric,
    aggregation: interpretation.aggregation || "sum",
    dimension: interpretation.dimension || undefined,
    dimensions: interpretation.dimensions || [],
    filters: interpretation.filters || [],
    dateRange: interpretation.dateRange || null,
    timeRange: interpretation.timeRange || "all_time",
    ranking: interpretation.ranking || null,
    comparison: interpretation.comparison || null,
    granularity: interpretation.granularity || null,
    logicalPage: interpretation.logicalPage || null,
    topN: interpretation.topN || DEFAULT_TOP_N,
    semanticPlan: interpretation.plan || null
  };

  return {
    interpretation,
    payload
  };
}

export { ALLOWED_MODEL_KEY as POWERBI_ASK_MODEL_KEY, MAX_TOP_N as POWERBI_ASK_MAX_TOP_N };
