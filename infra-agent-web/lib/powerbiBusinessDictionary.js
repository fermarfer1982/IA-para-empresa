import fs from "fs/promises";
import path from "path";
import { getPowerBiModel } from "./powerbiModels";
import { getPowerBiBusinessCatalog } from "./powerbiCatalogImport";

const BUSINESS_DICTIONARY_ROOT = path.join(
  process.cwd(),
  "data",
  "powerbi-business-dictionaries"
);

const TECHNICAL_TABLE_PATTERNS = [/^datetabletemplate_/i, /^localdatetable_/i, /^relacioncodigos$/i];
const BUSINESS_NAME_OVERRIDES = new Map([
  ["articulos", "articulo"],
  ["cabecerafactura", "factura"],
  ["clientes", "cliente"],
  ["especies", "especie"],
  ["familias", "familia"],
  ["histlotes", "historial_lotes"],
  ["linealote", "linea_lote"],
  ["lineasfactura", "linea_factura"],
  ["productos", "producto"],
  ["paises", "pais"],
  ["relacioncodigos", "relacion_codigos"],
  ["representantes", "representante"],
  ["sufijosarticulos", "sufijo_articulo"],
  ["tipos", "tipo"]
]);
function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeModelKey(modelKey) {
  const key = normalizeText(modelKey).toLowerCase();
  return key && /^[a-z0-9_-]+$/.test(key) ? key : "";
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function uniqueList(values) {
  return [...new Set(normalizeList(values))];
}

function stripAccents(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toWords(value) {
  return stripAccents(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function titleFromName(value) {
  return toWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function businessSlugFromName(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  if (BUSINESS_NAME_OVERRIDES.has(normalized)) {
    return BUSINESS_NAME_OVERRIDES.get(normalized);
  }
  return toWords(normalized).join("_");
}

function singularize(value) {
  const text = normalizeText(value).toLowerCase();
  if (text.endsWith("es") && text.length > 3) {
    return text.slice(0, -2);
  }
  if (text.endsWith("s") && text.length > 3) {
    return text.slice(0, -1);
  }
  return text;
}

function pluralize(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) {
    return text;
  }
  if (text.endsWith("s")) {
    return text;
  }
  return `${text}s`;
}

function synonymSet(label, extra = []) {
  const base = normalizeText(label).toLowerCase();
  const words = toWords(label).join(" ");
  return uniqueList(
    [
      base,
      words,
      stripAccents(words),
      singularize(base),
      pluralize(base),
      ...extra
    ].filter(Boolean)
  );
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(dirPath, 0o700);
  } catch {
    // Best effort.
  }
}

async function ensureRoot() {
  await ensureDir(BUSINESS_DICTIONARY_ROOT);
}

function isTechnicalTable(table) {
  const tableName = normalizeText(table?.name).toLowerCase();
  if (!tableName) {
    return false;
  }
  return TECHNICAL_TABLE_PATTERNS.some((pattern) => pattern.test(tableName));
}

function columnList(table) {
  return Array.isArray(table?.columns) ? table.columns : [];
}

function visibleColumnList(table) {
  return columnList(table).filter((column) => !column?.hidden);
}

function isDateColumn(column) {
  const name = normalizeText(column?.name).toLowerCase();
  const dataType = normalizeText(column?.dataType).toLowerCase();
  return (
    dataType.includes("date") ||
    /(^|_|-)(fecha|date|year|month|quarter|trim|dia|día|week|weeknum|semana)(_|-|$)/i.test(name) ||
    ["date", "fecha", "anio", "año", "mes", "trimestre", "semana", "day", "year"].includes(name)
  );
}

function isNumericColumn(column) {
  const dataType = normalizeText(column?.dataType).toLowerCase();
  return ["int64", "decimal", "double", "int32", "int16", "number", "currency"].some((item) =>
    dataType.includes(item)
  );
}

function isTextColumn(column) {
  const dataType = normalizeText(column?.dataType).toLowerCase();
  return !dataType || dataType.includes("string") || dataType.includes("text");
}

function chooseKeyColumn(table) {
  const columns = visibleColumnList(table);
  const preference = columns.find((column) =>
    /(^id$|codigo|code|key|serieNumero|numero|nro)/i.test(normalizeText(column?.name))
  );
  if (preference) {
    return preference;
  }
  return columns.find((column) => isTextColumn(column)) || columns[0] || null;
}

function chooseDisplayColumn(table) {
  const columns = visibleColumnList(table);
  const tableName = normalizeText(table?.name).toLowerCase();
  const byName = (names) =>
    columns.find((column) => names.some((name) => normalizeText(column?.name).toLowerCase() === name));
  const explicit =
    byName(["nombre", "descripcion", "descripción"]) ||
    (tableName === "especies" ? byName(["nombreespecie"]) : null) ||
    (tableName === "tipos" ? byName(["nombretipo", "nombreespecie"]) : null) ||
    (tableName === "productos" ? byName(["nombreseedtek"]) : null);
  if (explicit) {
    return explicit;
  }

  const displayText = columns.find((column) =>
    isTextColumn(column) &&
    /nombre|descripcion|descripci[oó]n|denominaci[oó]n|representante|cliente|producto|articulo|tipo|especie|familia|pais/i.test(
      normalizeText(column?.name)
    ) &&
    !/(^id$|codigo|c[oó]digo|^cod$|code|key|clave|fecha|date|year|mes|numero|n[uú]m|orden|index)/i.test(
      normalizeText(column?.name)
    )
  );
  if (displayText) {
    return displayText;
  }
  return columns.find((column) =>
    isTextColumn(column) &&
    !/(^id$|codigo|c[oó]digo|^cod$|code|key|clave|fecha|date|year|mes|numero|n[uú]m|orden|index)/i.test(
      normalizeText(column?.name)
    )
  ) || columns.find((column) => isTextColumn(column)) || columns[0] || null;
}

function buildEntityFromTable(table) {
  const name = normalizeText(table?.name);
  if (!name || isTechnicalTable(table)) {
    return null;
  }

  const keyColumn = chooseKeyColumn(table);
  const displayColumn = chooseDisplayColumn(table);
  if (!keyColumn && !displayColumn) {
    return null;
  }

  const businessName = businessSlugFromName(name);
  return {
    name: businessName,
    synonyms: synonymSet(businessName, [name, titleFromName(name)]),
    table: name,
    keyColumn: keyColumn ? keyColumn.name : null,
    displayColumn: displayColumn ? displayColumn.name : null,
    allowed: true,
    draft: true
  };
}

function buildDimensionFromTable(table, entity) {
  const name = normalizeText(entity?.name || businessSlugFromName(table?.name || ""));
  if (!name || isTechnicalTable(table)) {
    return null;
  }

  return {
    name,
    synonyms: uniqueList([
      ...synonymSet(name),
      normalizeText(table?.name).toLowerCase()
    ]),
    table: normalizeText(table?.name),
    column: chooseDisplayColumn(table)?.name || chooseKeyColumn(table)?.name || null,
    allowed: true,
    draft: true
  };
}

function buildMetricFromMeasure(measure) {
  const name = normalizeText(measure?.name);
  if (!name) {
    return null;
  }

  const measureLabel = businessSlugFromName(name.replace(/€/g, " eur")) || name.toLowerCase();
  const synonyms = synonymSet(measureLabel, [name, name.replace(/€/g, " eur")]);
  return {
    name: measureLabel,
    synonyms,
    type: "measure",
    official: true,
    measure: name,
    table: normalizeText(measure?.tableName) || null,
    column: null,
    aggregation: null,
    format: normalizeText(measure?.formatString) || "currency",
    allowed: true,
    draft: true
  };
}

function buildAggregationMetric(table, column, aggregation) {
  const tableName = normalizeText(table?.name);
  const columnName = normalizeText(column?.name);
  if (!tableName || !columnName || !aggregation) {
    return null;
  }

  const metricName = `${aggregation}_${businessSlugFromName(columnName) || toWords(columnName).join("_")}`;
  return {
    name: metricName,
    synonyms: synonymSet(metricName, [columnName, `${aggregation} ${columnName}`]),
    type: "aggregation",
    official: false,
    measure: null,
    table: tableName,
    column: columnName,
    aggregation,
    format: isNumericColumn(column) && /importe|ventas|precio|coste|currency|€/i.test(columnName)
      ? "currency"
      : "number",
    allowed: true,
    draft: true
  };
}

function buildTimeDimension(table, column, options = {}) {
  const tableName = normalizeText(table?.name);
  const columnName = normalizeText(column?.name);
  if (!tableName || !columnName) {
    return null;
  }

  const name = normalizeText(options.name || columnName).toLowerCase();
  return {
    name,
    synonyms: synonymSet(name, options.synonyms || []),
    table: tableName,
    column: columnName,
    granularity: uniqueList(options.granularity || []),
    allowed: true,
    draft: true
  };
}

function buildTechnicalObject({ type, table, column, reason, hidden = false }) {
  return {
    type,
    table: normalizeText(table || null) || null,
    column: normalizeText(column || null) || null,
    reason: normalizeText(reason) || null,
    hidden: Boolean(hidden),
    allowed: false,
    draft: true
  };
}

function collectCatalogTables(catalog) {
  return Array.isArray(catalog?.tables) ? catalog.tables : [];
}

function collectCatalogMeasures(catalog) {
  return Array.isArray(catalog?.measures) ? catalog.measures : [];
}

function collectCatalogWarnings(catalog) {
  return uniqueList([...(Array.isArray(catalog?.warnings) ? catalog.warnings : [])]);
}

function classifyCatalog(catalog) {
  const tables = collectCatalogTables(catalog);
  const measures = collectCatalogMeasures(catalog);
  const warnings = collectCatalogWarnings(catalog);

  const entities = [];
  const dimensions = [];
  const timeDimensions = [];
  const hiddenObjects = [];
  const technicalObjects = [];
  const synonyms = [];
  const metrics = [];
  const numericColumns = [];
  const classifiedColumns = new Set();

  for (const table of tables) {
    const tableName = normalizeText(table?.name);
    if (!tableName) {
      continue;
    }

    const entity = buildEntityFromTable(table);
    if (entity) {
      entities.push(entity);
      if (entity.synonyms?.length) {
        synonyms.push({
          targetType: "entity",
          target: entity.name,
          synonyms: entity.synonyms
        });
      }
    }

    const dimension = buildDimensionFromTable(table, entity);
    if (dimension) {
      dimensions.push(dimension);
      if (dimension.synonyms?.length) {
        synonyms.push({
          targetType: "dimension",
          target: dimension.name,
          synonyms: dimension.synonyms
        });
      }
    }

    if (isTechnicalTable(table) || table?.hidden) {
      technicalObjects.push(
        buildTechnicalObject({
          type: "table",
          table: tableName,
          reason: table?.hidden
            ? "Tabla técnica oculta del modelo semántico."
            : "Tabla técnica auxiliar del modelo semántico.",
          hidden: Boolean(table?.hidden)
        })
      );
      if (table?.hidden) {
        hiddenObjects.push(
          buildTechnicalObject({
            type: "table",
            table: tableName,
            reason: "Tabla oculta del modelo semántico.",
            hidden: true
          })
        );
      }
    }

    for (const column of columnList(table)) {
      const columnName = normalizeText(column?.name);
      if (!columnName) {
        continue;
      }

      if (isNumericColumn(column)) {
        numericColumns.push({
          table: tableName,
          column: columnName,
          hidden: Boolean(column?.hidden)
        });
      }

      if (column?.hidden) {
        hiddenObjects.push(
          buildTechnicalObject({
            type: "column",
            table: tableName,
            column: columnName,
            reason: "Columna oculta en el catálogo técnico.",
            hidden: true
          })
        );
      }

      if (isDateColumn(column)) {
        if (isTechnicalTable(table) || table?.hidden) {
          continue;
        }
        const timeDimensionName =
          tableName.toLowerCase().includes("factura") && columnName.toLowerCase() === "fecha"
            ? "fecha_factura"
            : columnName.toLowerCase();
        const timeDimension = buildTimeDimension(table, column, {
          name: timeDimensionName,
          granularity: ["day", "month", "quarter", "year"],
          synonyms: [
            columnName,
            titleFromName(columnName),
            tableName,
            `${tableName} ${columnName}`
          ]
        });
        if (timeDimension) {
          timeDimensions.push(timeDimension);
          synonyms.push({
            targetType: "timeDimension",
            target: timeDimension.name,
            synonyms: timeDimension.synonyms
          });
        }
      }

      if (column?.hidden || isTechnicalTable(table)) {
        classifiedColumns.add(`${tableName}:${columnName}`);
      }
    }
  }

  for (const measure of measures) {
    const metric = buildMetricFromMeasure(measure);
    if (!metric) {
      continue;
    }
    metrics.push(metric);
    if (Array.isArray(metric.synonyms) && metric.synonyms.length) {
      synonyms.push({
        targetType: "metric",
        target: metric.name,
        synonyms: metric.synonyms
      });
    }
    classifiedColumns.add(
      `${normalizeText(measure?.tableName)}:${normalizeText(measure?.name)}`
    );
  }

  const tableByName = new Map(
    tables.map((table) => [normalizeText(table?.name).toLowerCase(), table]).filter(([key]) => key)
  );

  const preferredAggregations = [
    ["lineasFactura", "importe", "sum"],
    ["lineasFactura", "cantidadFacturadaUMS", "sum"],
    ["lineasFactura", "precioUnitario", "avg"],
    ["histLotes", "cantidadFacturadaUMS", "sum"]
  ];

  for (const [tableName, columnName, aggregation] of preferredAggregations) {
    const table = tableByName.get(tableName.toLowerCase());
    const column = table?.columns?.find(
      (item) => normalizeText(item?.name).toLowerCase() === columnName.toLowerCase()
    );
    const metric = buildAggregationMetric(table, column, aggregation);
    if (metric) {
      metrics.push({ ...metric, draftSuggested: true });
      if (Array.isArray(metric.synonyms) && metric.synonyms.length) {
        synonyms.push({
          targetType: "metric",
          target: metric.name,
          synonyms: metric.synonyms
        });
      }
      classifiedColumns.add(`${normalizeText(table?.name)}:${normalizeText(column?.name)}`);
    }
  }

  const defaultDateTableCandidate =
    tables.find((table) =>
      normalizeText(table?.name).toLowerCase() === "cabecerafactura"
    ) ||
    tables.find((table) =>
      visibleColumnList(table).some((column) => normalizeText(column?.name).toLowerCase() === "fecha")
    ) ||
    tables.find((table) => /date/i.test(normalizeText(table?.name)));

  const defaultDateColumnCandidate = defaultDateTableCandidate
    ? visibleColumnList(defaultDateTableCandidate).find(
        (column) => normalizeText(column?.name).toLowerCase() === "fecha"
      ) ||
      visibleColumnList(defaultDateTableCandidate).find((column) => isDateColumn(column))
    : null;

  const businessDescription = [
    "Diccionario piloto de negocio para Power BI.",
    "Modelo orientado a ventas, clientes, productos, facturación y seguimiento operativo."
  ].join(" ");

  const dictionary = {
    modelKey: normalizeText(catalog?.modelKey || ""),
    displayName: normalizeText(catalog?.model?.displayName || catalog?.displayName || ""),
    businessDescription,
    defaultDateTable: defaultDateTableCandidate?.name || null,
    defaultDateColumn: defaultDateColumnCandidate?.name || null,
    defaultCurrency: "EUR",
    entities: sortByName(entities),
    metrics: sortByName(metrics),
    dimensions: sortByName(uniqueByName(dimensions)),
    timeDimensions: sortByName(uniqueByName(timeDimensions)),
    synonyms: sortSynonyms(synonyms),
    hiddenObjects,
    technicalObjects,
    warnings: uniqueList([...warnings]),
    draft: true,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceCatalog: {
      source: normalizeText(catalog?.source || "tmdl") || "tmdl",
      imported_at: catalog?.imported_at || null,
      updated_at: catalog?.updated_at || null,
      file_count: Number(catalog?.file_count || 0)
    }
  };

  dictionary.warnings = uniqueList([
    ...dictionary.warnings,
    ...buildDraftWarnings({
      dictionary,
      tables,
      measures,
      numericColumns
    })
  ]);

  const quality = buildBusinessDictionaryQuality(dictionary, { catalog, numericColumns });
  return { dictionary, quality };
}

function uniqueByName(items) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = `${normalizeText(item?.name).toLowerCase()}::${normalizeText(item?.table).toLowerCase()}::${normalizeText(item?.column).toLowerCase()}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    list.push(item);
  }
  return list;
}

function sortByName(items) {
  return [...uniqueByName(items)].sort((a, b) =>
    normalizeText(a?.name).localeCompare(normalizeText(b?.name), "es")
  );
}

function sortSynonyms(items) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = {
      targetType: normalizeText(item?.targetType).toLowerCase() || "object",
      target: normalizeText(item?.target).toLowerCase(),
      synonyms: uniqueList(item?.synonyms || [])
    };
    const key = `${normalized.targetType}:${normalized.target}`;
    if (!normalized.target || seen.has(key)) {
      continue;
    }
    seen.add(key);
    list.push(normalized);
  }
  return list.sort((a, b) =>
    `${a.targetType}:${a.target}`.localeCompare(`${b.targetType}:${b.target}`, "es")
  );
}

function buildDraftWarnings({ dictionary, tables, measures, numericColumns }) {
  const warnings = [];
  if (!dictionary?.defaultDateColumn) {
    warnings.push("No hay defaultDateColumn detectada.");
  }
  if (!measures?.length) {
    warnings.push("No hay métricas oficiales detectadas.");
  } else if (measures.length < 3) {
    warnings.push("Hay pocas medidas oficiales; puede convenir crear más medidas en Power BI.");
  }
  const tableWithoutDescription = (tables || []).filter((table) => !normalizeText(table?.description)).length;
  if (tableWithoutDescription) {
    warnings.push(`${tableWithoutDescription} tabla(s) sin descripción técnica o de negocio.`);
  }
  const unclassifiedNumeric = (numericColumns || []).length;
  if (unclassifiedNumeric) {
    warnings.push(`${unclassifiedNumeric} columna(s) numérica(s) sin clasificar todavía.`);
  }
  const exposedTechnicalNames = (tables || [])
    .filter((table) => isTechnicalTable(table) || table?.hidden)
    .map((table) => normalizeText(table?.name))
    .filter(Boolean);
  if (exposedTechnicalNames.length) {
    warnings.push(
      `Hay objetos técnicos u ocultos en el modelo: ${exposedTechnicalNames.slice(0, 4).join(", ")}${
        exposedTechnicalNames.length > 4 ? "..." : ""
      }`
    );
  }
  return uniqueList(warnings);
}

function buildBusinessDictionaryQuality(dictionary, context = {}) {
  const tables = Array.isArray(context?.catalog?.tables) ? context.catalog.tables : [];
  const measures = Array.isArray(context?.catalog?.measures) ? context.catalog.measures : [];
  const numericColumns = Array.isArray(context?.numericColumns) ? context.numericColumns : [];

  const issues = [];
  const recommendations = [];
  let score = 100;

  if (!dictionary?.defaultDateTable || !dictionary?.defaultDateColumn) {
    score -= 20;
    issues.push("No hay tabla/columna de fecha principal.");
    recommendations.push("Define una fecha principal clara en el diccionario.");
  }

  if (!Array.isArray(dictionary?.metrics) || dictionary.metrics.length === 0) {
    score -= 30;
    issues.push("No hay métricas principales.");
    recommendations.push("Crea al menos una métrica principal para el piloto.");
  }

  const officialMetrics = Array.isArray(dictionary?.metrics)
    ? dictionary.metrics.filter((metric) => metric?.official !== false && metric?.draftSuggested !== true)
    : [];
  if (officialMetrics.length < 3) {
    score -= 8;
    issues.push("Solo hay unas pocas métricas oficiales principales.");
  }

  const measuresWithoutSynonyms = (dictionary?.metrics || []).filter(
    (metric) => !Array.isArray(metric?.synonyms) || metric.synonyms.length === 0
  ).length;
  if (measuresWithoutSynonyms) {
    score -= Math.min(15, measuresWithoutSynonyms * 3);
    issues.push(`${measuresWithoutSynonyms} métrica(s) sin sinónimos.`);
  }

  const tablesWithoutDescriptions = mapCatalogMissingDescriptions(
    { tables },
    dictionary
  ).length;
  if (tablesWithoutDescriptions) {
    score -= Math.min(12, tablesWithoutDescriptions);
    issues.push(`${tablesWithoutDescriptions} tabla(s) sin descripción.`);
  }

  const unclassifiedNumeric = numericColumns.length;
  if (unclassifiedNumeric) {
    score -= Math.min(20, unclassifiedNumeric * 2);
    issues.push(`${unclassifiedNumeric} columna(s) numérica(s) siguen sin clasificar.`);
    recommendations.push("Revisa si conviene crear más medidas o dimensiones en Power BI.");
  }

  const technicalObjects = Array.isArray(dictionary?.technicalObjects)
    ? dictionary.technicalObjects
    : [];
  if (technicalObjects.length) {
    score -= Math.min(10, technicalObjects.length);
    issues.push(`${technicalObjects.length} objeto(s) técnicos documentados.`);
  }

  const hiddenObjects = Array.isArray(dictionary?.hiddenObjects) ? dictionary.hiddenObjects : [];
  if (hiddenObjects.length) {
    score -= Math.min(6, hiddenObjects.length);
    issues.push(`${hiddenObjects.length} objeto(s) oculto(s) documentados.`);
  }

  const measureCount = measures.length;
  if (measureCount < 3) {
    recommendations.push("El modelo tiene pocas medidas oficiales; Power BI podría beneficiarse de más medidas base.");
  }

  score = Math.max(0, Math.min(100, score));

  let status = "needs_review";
  if (score >= 80 && issues.length === 0) {
    status = "ready";
  } else if (score >= 50) {
    status = "incomplete";
  }

  return {
    score,
    status,
    issues: uniqueList(issues),
    recommendations: uniqueList(recommendations),
    counts: {
      entities: Array.isArray(dictionary?.entities) ? dictionary.entities.length : 0,
      metrics: Array.isArray(dictionary?.metrics) ? dictionary.metrics.length : 0,
      dimensions: Array.isArray(dictionary?.dimensions) ? dictionary.dimensions.length : 0,
      timeDimensions: Array.isArray(dictionary?.timeDimensions) ? dictionary.timeDimensions.length : 0,
      synonyms: Array.isArray(dictionary?.synonyms)
        ? dictionary.synonyms.reduce(
            (total, item) => total + (Array.isArray(item?.synonyms) ? item.synonyms.length : 0),
            0
          )
        : 0,
      warnings: Array.isArray(dictionary?.warnings) ? dictionary.warnings.length : 0
    }
  };
}

function buildBusinessDictionarySummary(dictionary, quality) {
  return {
    entities: quality?.counts?.entities || 0,
    metrics: quality?.counts?.metrics || 0,
    dimensions: quality?.counts?.dimensions || 0,
    dates: quality?.counts?.timeDimensions || 0,
    synonyms: quality?.counts?.synonyms || 0,
    warnings: quality?.counts?.warnings || 0
  };
}

function catalogTableMap(catalog) {
  return new Map(
    (Array.isArray(catalog?.tables) ? catalog.tables : [])
      .map((table) => [normalizeText(table?.name).toLowerCase(), table])
      .filter(([key]) => key)
  );
}

function findCatalogTable(catalog, tableName) {
  return catalogTableMap(catalog).get(normalizeText(tableName).toLowerCase()) || null;
}

function findCatalogColumn(catalog, tableName, columnName) {
  const table = findCatalogTable(catalog, tableName);
  return visibleColumnList(table).find(
    (column) => normalizeText(column?.name).toLowerCase() === normalizeText(columnName).toLowerCase()
  ) || null;
}

function isTechnicalDimensionColumn(columnName) {
  const name = stripAccents(columnName).toLowerCase();
  return /(^id$|codigo|^cod$|code|key|clave|fecha|date|year|mes|numero|num|orden|index)/i.test(name);
}

function isDisplayDimensionColumn(columnName) {
  const name = stripAccents(columnName).toLowerCase();
  return /nombre|descripcion|descrip|denominacion|representante|cliente|producto|articulo|tipo|especie|familia|pais/i.test(name) &&
    !isTechnicalDimensionColumn(name);
}

function chooseCatalogDisplayColumn(catalog, tableName) {
  const table = findCatalogTable(catalog, tableName);
  return chooseDisplayColumn(table);
}

function repairDimensionColumnsFromCatalog(dimensions, catalog, warnings) {
  return (Array.isArray(dimensions) ? dimensions : []).map((dimension) => {
    const name = normalizeText(dimension?.name).toLowerCase();
    const table = normalizeText(dimension?.table);
    const column = normalizeText(dimension?.column);
    const current = findCatalogColumn(catalog, table, column);
    const preferred = chooseCatalogDisplayColumn(catalog, table);
    if (
      !preferred ||
      normalizeText(preferred?.name).toLowerCase() === column.toLowerCase() ||
      (current && isDisplayDimensionColumn(column) && isTextColumn(current))
    ) {
      return dimension;
    }

    if (["articulo", "producto", "familia", "tipo", "especie"].includes(name)) {
      warnings.push(
        `Dimensión ${name}: se usa columna de visualización ${table}[${preferred.name}] en lugar de ${column || "columna vacía"}.`
      );
      return {
        ...dimension,
        column: preferred.name,
        displayColumn: preferred.name,
        originalColumn: column || null
      };
    }
    return dimension;
  });
}

function ensureFunctionalDimensions(dimensions, catalog, warnings) {
  const next = Array.isArray(dimensions) ? [...dimensions] : [];
  const ensure = ({ name, table, column, synonyms, reason }) => {
    if (!findCatalogColumn(catalog, table, column)) {
      return;
    }
    const key = normalizeText(name).toLowerCase();
    const exists = next.some((dimension) => normalizeText(dimension?.name).toLowerCase() === key);
    if (exists) {
      return;
    }
    warnings.push(reason);
    next.push({
      name,
      synonyms: uniqueList(synonyms),
      table,
      column,
      allowed: true,
      draft: true,
      functionalDictionary: true
    });
  };

  ensure({
    name: "pais",
    table: "clientes",
    column: "pais",
    synonyms: ["pais", "país", "paises", "países", "country"],
    reason: "Dimensión funcional pais: se usa clientes[pais] según las páginas PAISES del informe."
  });

  return next;
}

function attachCatalogMetadata(dictionary, catalog) {
  if (!dictionary || !catalog) {
    return dictionary;
  }
  const tables = (Array.isArray(catalog?.tables) ? catalog.tables : []).map((table) => ({
    name: normalizeText(table?.name),
    columns: visibleColumnList(table).map((column) => ({
      name: normalizeText(column?.name),
      dataType: normalizeText(column?.dataType),
      hidden: Boolean(column?.hidden)
    }))
  })).filter((table) => table.name);
  Object.defineProperty(dictionary, "__catalogTables", {
    value: tables,
    enumerable: false,
    configurable: true
  });
  return dictionary;
}

function normalizeSavedDictionary(dictionary, model, sourceCatalog = null) {
  const catalog = sourceCatalog || {};
  const warnings = uniqueList(Array.isArray(dictionary?.warnings) ? dictionary.warnings : []);
  const normalized = {
    modelKey: normalizeText(dictionary?.modelKey || model?.key || ""),
    displayName: normalizeText(dictionary?.displayName || model?.displayName || ""),
    businessDescription:
      normalizeText(dictionary?.businessDescription) ||
      "Diccionario piloto de negocio para Power BI.",
    defaultDateTable: normalizeText(dictionary?.defaultDateTable) || null,
    defaultDateColumn: normalizeText(dictionary?.defaultDateColumn) || null,
    defaultCurrency: normalizeText(dictionary?.defaultCurrency) || "EUR",
    entities: sortByName(Array.isArray(dictionary?.entities) ? dictionary.entities : []),
    metrics: sortByName(Array.isArray(dictionary?.metrics) ? dictionary.metrics : []),
    dimensions: sortByName(
      ensureFunctionalDimensions(
        repairDimensionColumnsFromCatalog(
          Array.isArray(dictionary?.dimensions) ? dictionary.dimensions : [],
          catalog,
          warnings
        ),
        catalog,
        warnings
      )
    ),
    timeDimensions: sortByName(
      Array.isArray(dictionary?.timeDimensions) ? dictionary.timeDimensions : []
    ),
    synonyms: sortSynonyms(Array.isArray(dictionary?.synonyms) ? dictionary.synonyms : []),
    hiddenObjects: Array.isArray(dictionary?.hiddenObjects) ? dictionary.hiddenObjects : [],
    technicalObjects: Array.isArray(dictionary?.technicalObjects)
      ? dictionary.technicalObjects
      : [],
    warnings,
    draft: Boolean(dictionary?.draft ?? true),
    generatedAt: normalizeText(dictionary?.generatedAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceCatalog: {
      source: normalizeText(dictionary?.sourceCatalog?.source || catalog?.source || "tmdl") || "tmdl",
      imported_at: normalizeText(dictionary?.sourceCatalog?.imported_at || catalog?.imported_at || null) || null,
      updated_at: normalizeText(dictionary?.sourceCatalog?.updated_at || catalog?.updated_at || null) || null,
      file_count: Number(
        dictionary?.sourceCatalog?.file_count ??
          catalog?.file_count ??
          0
      )
    }
  };
  return attachCatalogMetadata(normalized, catalog);
}

function normalizeObjectName(value) {
  return businessSlugFromName(normalizeText(value));
}

function normalizePatchString(value) {
  const text = normalizeText(value);
  return text || null;
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeText(keyFn(item)).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeBooleanOrNull(value) {
  if (value === true || value === false) {
    return value;
  }
  return null;
}

function cloneDictionary(dictionary) {
  return JSON.parse(JSON.stringify(dictionary || {}));
}

function normalizeReviewSynonyms(synonyms, extra = []) {
  return uniqueList([...(Array.isArray(synonyms) ? synonyms : []), ...(Array.isArray(extra) ? extra : [])]);
}

function mapCatalogNumericColumns(catalog) {
  const rows = [];
  for (const table of Array.isArray(catalog?.tables) ? catalog.tables : []) {
    const tableName = normalizeText(table?.name);
    for (const column of Array.isArray(table?.columns) ? table.columns : []) {
      if (!tableName || !column?.name || column?.hidden || !isNumericColumn(column)) {
        continue;
      }
      rows.push({
        table: tableName,
        column: normalizeText(column.name),
        dataType: normalizeText(column.dataType) || null
      });
    }
  }
  return rows;
}

function mapCatalogDateColumns(catalog) {
  const rows = [];
  for (const table of Array.isArray(catalog?.tables) ? catalog.tables : []) {
    const tableName = normalizeText(table?.name);
    for (const column of Array.isArray(table?.columns) ? table.columns : []) {
      if (!tableName || !column?.name || column?.hidden || !isDateColumn(column)) {
        continue;
      }
      rows.push({
        table: tableName,
        column: normalizeText(column.name),
        dataType: normalizeText(column.dataType) || null
      });
    }
  }
  return rows;
}

function buildDictionaryTableDescriptionIndex(dictionary) {
  const index = new Map();
  const collect = (items, keyField = "table") => {
    for (const item of Array.isArray(items) ? items : []) {
      const table = normalizeText(item?.[keyField] || item?.table || item?.tableName).toLowerCase();
      const description = normalizeText(item?.description || item?.reason);
      if (!table || !description) {
        continue;
      }
      if (!index.has(table)) {
        index.set(table, description);
      }
    }
  };

  collect(dictionary?.entities);
  collect(dictionary?.dimensions);
  collect(dictionary?.timeDimensions);
  collect(dictionary?.metrics);
  collect(dictionary?.hiddenObjects);
  collect(dictionary?.technicalObjects);
  return index;
}

function mapCatalogMissingDescriptions(catalog, dictionary) {
  const dictionaryDescriptions = buildDictionaryTableDescriptionIndex(dictionary);
  return (Array.isArray(catalog?.tables) ? catalog.tables : [])
    .filter((table) => {
      const tableName = normalizeText(table?.name).toLowerCase();
      return !normalizeText(table?.description) && !dictionaryDescriptions.has(tableName);
    })
    .map((table) => ({
      table: normalizeText(table?.name) || null,
      hidden: Boolean(table?.hidden),
      sourceFile: normalizeText(table?.sourceFile) || null
    }));
}

function mapBusinessObjectsForReview(items, kind) {
  return uniqueByKey(items, (item) => {
    const base = normalizeObjectName(item?.name);
    if (base) {
      return `${kind}:name:${base}`;
    }
    return `${kind}:${normalizeText(item?.type).toLowerCase()}:${normalizeText(item?.table).toLowerCase()}:${normalizeText(item?.column).toLowerCase()}:${normalizeText(item?.measure).toLowerCase()}`;
  }).map((item) => ({
    name: normalizeText(item?.name) || null,
    table: normalizeText(item?.table) || null,
    column: normalizeText(item?.column) || null,
    measure: normalizeText(item?.measure) || null,
    description: normalizeText(item?.description) || null,
    synonyms: normalizeList(item?.synonyms),
    allowed: item?.allowed ?? true,
    hidden: item?.hidden ?? false,
    technical: item?.technical ?? false,
    primary: item?.primary ?? false,
    draft: item?.draft ?? true,
    type: normalizeText(item?.type) || null
  }));
}

function detectSynonymConflicts(dictionary) {
  const index = new Map();
  const targetTableMap = new Map();
  const collect = (targetType, target, synonyms) => {
    const targetKey = `${targetType}:${normalizeObjectName(target)}`;
    const tableName = normalizeText(
      (Array.isArray(dictionary?.entities) ? dictionary.entities : []).find(
        (item) => normalizeObjectName(item?.name) === normalizeObjectName(target)
      )?.table ||
        (Array.isArray(dictionary?.dimensions) ? dictionary.dimensions : []).find(
          (item) => normalizeObjectName(item?.name) === normalizeObjectName(target)
        )?.table ||
        (Array.isArray(dictionary?.timeDimensions) ? dictionary.timeDimensions : []).find(
          (item) => normalizeObjectName(item?.name) === normalizeObjectName(target)
        )?.table ||
        (Array.isArray(dictionary?.metrics) ? dictionary.metrics : []).find(
          (item) => normalizeObjectName(item?.name) === normalizeObjectName(target)
        )?.table ||
        ""
    ).toLowerCase();

    if (targetKey) {
      targetTableMap.set(targetKey, tableName);
    }

    for (const synonym of uniqueList(synonyms || [])) {
      const key = stripAccents(synonym).toLowerCase();
      if (!key) {
        continue;
      }
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push({ targetType, target });
    }
  };

  for (const entity of Array.isArray(dictionary?.entities) ? dictionary.entities : []) {
    collect("entity", entity?.name, entity?.synonyms);
  }
  for (const dimension of Array.isArray(dictionary?.dimensions) ? dictionary.dimensions : []) {
    collect("dimension", dimension?.name, dimension?.synonyms);
  }
  for (const metric of Array.isArray(dictionary?.metrics) ? dictionary.metrics : []) {
    collect("metric", metric?.name, metric?.synonyms);
  }
  for (const timeDimension of Array.isArray(dictionary?.timeDimensions)
    ? dictionary.timeDimensions
    : []) {
    collect("timeDimension", timeDimension?.name, timeDimension?.synonyms);
  }

  const conflicts = [];
  for (const [synonym, targets] of index.entries()) {
    const uniqueTargets = uniqueList(targets.map((target) => `${target.targetType}:${target.target}`));
    if (uniqueTargets.length > 1) {
      const tables = uniqueList(
        uniqueTargets.map((entry) => targetTableMap.get(entry) || "")
      ).filter(Boolean);
      if (tables.length <= 1) {
        continue;
      }
      conflicts.push({
        synonym,
        targets: uniqueTargets.map((entry) => {
          const [targetType, target] = entry.split(":");
          return { targetType, target };
        }),
        kind: "shared_synonym"
      });
    }
  }

  return conflicts.sort((a, b) => a.synonym.localeCompare(b.synonym, "es"));
}

function buildBusinessDictionaryRecommendations(dictionary, catalog, quality) {
  const recommendations = [...(quality?.recommendations || [])];
  const officialMeasures = Array.isArray(dictionary?.metrics)
    ? dictionary.metrics.filter((metric) => metric?.official !== false && metric?.draftSuggested !== true)
    : [];

  if (officialMeasures.length < 3) {
    recommendations.push(
      "Crear más medidas oficiales en Power BI Desktop para reducir dependencias de métricas derivadas."
    );
  }

  if (!dictionary?.defaultDateTable || !dictionary?.defaultDateColumn) {
    const dateCandidates = mapCatalogDateColumns(catalog);
    if (dateCandidates.length) {
      recommendations.push(
        `Seleccionar ${dateCandidates[0].table}.${dateCandidates[0].column} como fecha por defecto o validar si es la mejor fecha de negocio.`
      );
    }
  }

  const missingDescriptions = mapCatalogMissingDescriptions(catalog, dictionary);
  if (missingDescriptions.length) {
    recommendations.push(
      `Añadir descripciones a ${missingDescriptions.length} tabla(s) para mejorar el diccionario.`
    );
  }

  const unclassifiedNumeric = mapCatalogNumericColumns(catalog);
  if (unclassifiedNumeric.length) {
    recommendations.push(
      "Ocultar o clasificar columnas numéricas auxiliares que no deban verse en el diccionario."
    );
  }

  const synonymConflicts = detectSynonymConflicts(dictionary);
  if (synonymConflicts.length) {
    recommendations.push("Revisar sinónimos repetidos entre entidades, dimensiones y métricas.");
  }

  return uniqueList(recommendations);
}

function buildBusinessDictionaryReview(dictionary, catalog, quality) {
  const officialMeasures = (Array.isArray(dictionary?.metrics) ? dictionary.metrics : [])
    .filter((metric) => metric?.official !== false && metric?.draftSuggested !== true)
    .map((metric) => ({
      name: normalizeText(metric?.name) || null,
      measure: normalizeText(metric?.measure) || null,
      table: normalizeText(metric?.table) || null,
      format: normalizeText(metric?.format) || null,
      description: normalizeText(metric?.description) || null,
      synonyms: normalizeList(metric?.synonyms),
      primary: metric?.primary ?? true
    }));

  const aggregationMetrics = (Array.isArray(dictionary?.metrics) ? dictionary.metrics : [])
    .filter((metric) => metric?.type === "aggregation" || metric?.draftSuggested === true)
    .map((metric) => ({
      name: normalizeText(metric?.name) || null,
      table: normalizeText(metric?.table) || null,
      column: normalizeText(metric?.column) || null,
      aggregation: normalizeText(metric?.aggregation) || null,
      format: normalizeText(metric?.format) || null,
      description: normalizeText(metric?.description) || null,
      synonyms: normalizeList(metric?.synonyms),
      allowed: metric?.allowed ?? true,
      primary: metric?.primary ?? false
    }));

  const missingDescriptions = mapCatalogMissingDescriptions(catalog, dictionary);
  const unclassifiedNumericColumns = mapCatalogNumericColumns(catalog).filter((column) => {
    const columnKey = `${normalizeText(column.table).toLowerCase()}:${normalizeText(column.column).toLowerCase()}`;
    const coveredByMetric = (Array.isArray(dictionary?.metrics) ? dictionary.metrics : []).some((metric) => {
      const metricKey = `${normalizeText(metric?.table).toLowerCase()}:${normalizeText(metric?.column).toLowerCase()}`;
      return metricKey && metricKey === columnKey;
    });
    return !coveredByMetric;
  });

  const dateCandidates = mapCatalogDateColumns(catalog).map((candidate) => ({
    ...candidate,
    currentDefault:
      normalizeText(dictionary?.defaultDateTable).toLowerCase() === normalizeText(candidate.table).toLowerCase() &&
      normalizeText(dictionary?.defaultDateColumn).toLowerCase() === normalizeText(candidate.column).toLowerCase()
  }));

  const hiddenObjects = mapBusinessObjectsForReview(dictionary?.hiddenObjects, "hidden");
  const technicalObjects = mapBusinessObjectsForReview(dictionary?.technicalObjects, "technical");
  const synonymConflicts = detectSynonymConflicts(dictionary);
  const recommendations = buildBusinessDictionaryRecommendations(dictionary, catalog, quality);
  const score = Number(quality?.score || 0);

  return {
    modelKey: normalizeText(dictionary?.modelKey || catalog?.modelKey || ""),
    quality: quality || null,
    score,
    summary: buildBusinessDictionarySummary(dictionary || {}, quality || {}),
    officialMeasures,
    aggregationMetrics,
    missingDescriptions,
    unclassifiedNumericColumns,
    dateCandidates,
    hiddenObjects,
    technicalObjects,
    synonymConflicts,
    recommendations,
    generatedAt: new Date().toISOString()
  };
}

async function getBusinessDictionaryReviewPath(modelKey) {
  const { model, filePath } = await getBusinessDictionaryPath(modelKey);
  const reviewFilePath = filePath.replace(/\.json$/i, ".review.json");
  return { model, filePath, reviewFilePath };
}

function normalizePatchObjectList(list, kind, existingList) {
  const existing = Array.isArray(existingList) ? existingList : [];
  const result = existing.map((item) => ({ ...item }));
  const index = new Map(result.map((item, idx) => [normalizeObjectName(item?.name), idx]));
  const patches = new Map();
  const allowedFields = new Set([
    "name",
    "description",
    "synonyms",
    "allowed",
    "technical",
    "hidden",
    "primary"
  ]);

  for (const patch of Array.isArray(list) ? list : []) {
    if (!patch || typeof patch !== "object") {
      throw new Error(`El parche de ${kind} debe ser un objeto.`);
    }

    const keys = Object.keys(patch);
    const invalidKeys = keys.filter((key) => !allowedFields.has(key));
    if (invalidKeys.length) {
      throw new Error(`El parche de ${kind} contiene campos no permitidos: ${invalidKeys.join(", ")}.`);
    }

    const name = normalizeObjectName(patch.name);
    if (!name) {
      throw new Error(`El parche de ${kind} necesita un campo name válido.`);
    }

    const currentIndex = index.get(name);
    if (currentIndex === undefined) {
      throw new Error(`No existe un objeto de ${kind} llamado ${patch.name}.`);
    }
    patches.set(name, patch);
  }

  for (const [name, patch] of patches.entries()) {
    const currentIndex = index.get(name);
    const current = result[currentIndex];
    const next = { ...current };
    if (typeof patch.description === "string") {
      next.description = normalizePatchString(patch.description);
    }
    if (Array.isArray(patch.synonyms)) {
      next.synonyms = normalizeReviewSynonyms(next.synonyms, patch.synonyms);
    }
    if (patch.allowed !== undefined) {
      next.allowed = Boolean(patch.allowed);
    }
    if (patch.technical !== undefined) {
      next.technical = Boolean(patch.technical);
    }
    if (patch.hidden !== undefined) {
      next.hidden = Boolean(patch.hidden);
    }
    if (patch.primary !== undefined && kind === "metric") {
      next.primary = Boolean(patch.primary);
    }
    result[currentIndex] = next;
  }

  return result;
}

function normalizePatchTechnicalObjectList(list, kind, existingList) {
  const existing = Array.isArray(existingList) ? existingList : [];
  const index = new Map(
    existing.map((item, idx) => [normalizeText(item?.type).toLowerCase() + "::" + normalizeText(item?.table).toLowerCase() + "::" + normalizeText(item?.column).toLowerCase(), idx])
  );
  const allowedFields = new Set(["type", "table", "column", "reason", "description", "allowed", "technical", "hidden"]);

  for (const patch of Array.isArray(list) ? list : []) {
    if (!patch || typeof patch !== "object") {
      throw new Error(`El parche de ${kind} debe ser un objeto.`);
    }

    const keys = Object.keys(patch);
    const invalidKeys = keys.filter((key) => !allowedFields.has(key));
    if (invalidKeys.length) {
      throw new Error(`El parche de ${kind} contiene campos no permitidos: ${invalidKeys.join(", ")}.`);
    }

    const key = `${normalizeText(patch.type).toLowerCase()}::${normalizeText(patch.table).toLowerCase()}::${normalizeText(patch.column).toLowerCase()}`;
    if (!key.replace(/:/g, "")) {
      throw new Error(`El parche de ${kind} necesita type y table válidos.`);
    }
    if (!index.has(key)) {
      throw new Error(`No existe un objeto de ${kind} con type=${patch.type}, table=${patch.table} y column=${patch.column || ""}.`);
    }
  }

  const patches = new Map(
    (Array.isArray(list) ? list : []).map((patch) => {
      const key = `${normalizeText(patch.type).toLowerCase()}::${normalizeText(patch.table).toLowerCase()}::${normalizeText(patch.column).toLowerCase()}`;
      return [key, patch];
    })
  );

  return existing.map((item) => {
    const key = `${normalizeText(item?.type).toLowerCase()}::${normalizeText(item?.table).toLowerCase()}::${normalizeText(item?.column).toLowerCase()}`;
    const patch = patches.get(key);
    if (!patch) {
      return { ...item };
    }

    const next = { ...item };
    if (typeof patch.description === "string") {
      next.reason = normalizePatchString(patch.description);
    }
    if (typeof patch.reason === "string") {
      next.reason = normalizePatchString(patch.reason);
    }
    if (patch.allowed !== undefined) {
      next.allowed = Boolean(patch.allowed);
    }
    if (patch.technical !== undefined) {
      next.technical = Boolean(patch.technical);
    }
    if (patch.hidden !== undefined) {
      next.hidden = Boolean(patch.hidden);
    }
    return next;
  });
}

function normalizeBusinessDictionaryPatch(patch) {
  if (!patch || typeof patch !== "object") {
    throw new Error("El parche del diccionario debe ser un objeto.");
  }

  const allowedTopLevelKeys = new Set([
    "businessDescription",
    "defaultDateTable",
    "defaultDateColumn",
    "defaultCurrency",
    "selectPrimaryMetrics",
    "entities",
    "dimensions",
    "metrics",
    "hiddenObjects",
    "technicalObjects"
  ]);
  const invalidKeys = Object.keys(patch).filter((key) => !allowedTopLevelKeys.has(key));
  if (invalidKeys.length) {
    throw new Error(`El parche contiene campos no permitidos: ${invalidKeys.join(", ")}.`);
  }

  return {
    businessDescription:
      typeof patch.businessDescription === "string"
        ? normalizePatchString(patch.businessDescription)
        : undefined,
    defaultDateTable:
      typeof patch.defaultDateTable === "string" ? normalizePatchString(patch.defaultDateTable) : undefined,
    defaultDateColumn:
      typeof patch.defaultDateColumn === "string"
        ? normalizePatchString(patch.defaultDateColumn)
        : undefined,
    defaultCurrency:
      typeof patch.defaultCurrency === "string" ? normalizePatchString(patch.defaultCurrency) : undefined,
    selectPrimaryMetrics: Array.isArray(patch.selectPrimaryMetrics)
      ? patch.selectPrimaryMetrics.map((item) => normalizeObjectName(item)).filter(Boolean)
      : undefined,
    entities: Array.isArray(patch.entities) ? patch.entities : undefined,
    dimensions: Array.isArray(patch.dimensions) ? patch.dimensions : undefined,
    metrics: Array.isArray(patch.metrics) ? patch.metrics : undefined,
    hiddenObjects: Array.isArray(patch.hiddenObjects) ? patch.hiddenObjects : undefined,
    technicalObjects: Array.isArray(patch.technicalObjects) ? patch.technicalObjects : undefined
  };
}

function applyBusinessDictionaryPatchToDictionary(dictionary, patch) {
  const next = cloneDictionary(dictionary);
  const safePatch = normalizeBusinessDictionaryPatch(patch);

  if (safePatch.businessDescription !== undefined) {
    next.businessDescription = safePatch.businessDescription;
  }
  if (safePatch.defaultDateTable !== undefined) {
    next.defaultDateTable = safePatch.defaultDateTable;
  }
  if (safePatch.defaultDateColumn !== undefined) {
    next.defaultDateColumn = safePatch.defaultDateColumn;
  }
  if (safePatch.defaultCurrency !== undefined) {
    next.defaultCurrency = safePatch.defaultCurrency;
  }

  if (safePatch.entities) {
    next.entities = normalizePatchObjectList(safePatch.entities, "entity", next.entities);
  }
  if (safePatch.dimensions) {
    next.dimensions = normalizePatchObjectList(safePatch.dimensions, "dimension", next.dimensions);
  }
  if (safePatch.metrics) {
    next.metrics = normalizePatchObjectList(safePatch.metrics, "metric", next.metrics);
  }
  if (safePatch.hiddenObjects) {
    next.hiddenObjects = normalizePatchTechnicalObjectList(safePatch.hiddenObjects, "hidden object", next.hiddenObjects);
  }
  if (safePatch.technicalObjects) {
    next.technicalObjects = normalizePatchTechnicalObjectList(
      safePatch.technicalObjects,
      "technical object",
      next.technicalObjects
    );
  }

  if (Array.isArray(safePatch.selectPrimaryMetrics)) {
    const primarySet = new Set(safePatch.selectPrimaryMetrics);
    next.metrics = (Array.isArray(next.metrics) ? next.metrics : []).map((metric) => ({
      ...metric,
      primary: primarySet.size ? primarySet.has(normalizeObjectName(metric?.name)) : Boolean(metric?.primary)
    }));
  }

  next.warnings = uniqueList(Array.isArray(next.warnings) ? next.warnings : []);
  next.updatedAt = new Date().toISOString();
  next.draft = true;
  return next;
}

export async function getPowerBiBusinessDictionaryReview(modelKey) {
  const key = normalizeModelKey(modelKey);
  if (!key) {
    return { ok: false, error: "modelKey inválido." };
  }

  const model = getPowerBiModel(key);
  if (!model) {
    return { ok: false, error: "Modelo Power BI no encontrado." };
  }

  const payload = await getPowerBiBusinessDictionary(key);
  if (!payload?.ok) {
    return payload;
  }

  const review = buildBusinessDictionaryReview(payload.dictionary, await getPowerBiBusinessCatalog(key), payload.quality);
  const { reviewFilePath } = await getBusinessDictionaryReviewPath(key);
  await writeJson(reviewFilePath, {
    modelKey: key,
    displayName: model.displayName,
    generatedAt: review.generatedAt,
    review,
    proposedPatch: {
      businessDescription: payload.dictionary?.businessDescription || "",
      defaultDateTable: payload.dictionary?.defaultDateTable || "",
      defaultDateColumn: payload.dictionary?.defaultDateColumn || "",
      defaultCurrency: payload.dictionary?.defaultCurrency || "EUR",
      selectPrimaryMetrics: review.officialMeasures.map((metric) => metric.name)
    }
  });

  return {
    ok: true,
    model: payload.model,
    ...review
  };
}

export async function applyPowerBiBusinessDictionaryPatch(modelKey, patch) {
  const key = normalizeModelKey(modelKey);
  if (!key) {
    return { ok: false, error: "modelKey inválido." };
  }

  const model = getPowerBiModel(key);
  if (!model) {
    return { ok: false, error: "Modelo Power BI no encontrado." };
  }

  const payload = await getPowerBiBusinessDictionary(key);
  if (!payload?.ok) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: payload?.error || "No hay diccionario importado para aplicar el parche."
    };
  }

  const catalog = await getPowerBiBusinessCatalog(key);
  const nextDictionary = applyBusinessDictionaryPatchToDictionary(payload.dictionary, patch);
  const quality = buildBusinessDictionaryQuality(nextDictionary, {
    catalog,
    numericColumns: collectNumericColumns(catalog)
  });
  nextDictionary.warnings = uniqueList([
    ...(Array.isArray(nextDictionary.warnings) ? nextDictionary.warnings : []),
    ...(quality?.issues || [])
  ]);

  const { filePath, reviewFilePath } = await getBusinessDictionaryReviewPath(key);
  await writeJson(filePath, nextDictionary);
  const review = buildBusinessDictionaryReview(nextDictionary, catalog, quality);
  await writeJson(reviewFilePath, {
    modelKey: key,
    displayName: model.displayName,
    generatedAt: review.generatedAt,
    review,
    proposedPatch: {
      businessDescription: nextDictionary.businessDescription || "",
      defaultDateTable: nextDictionary.defaultDateTable || "",
      defaultDateColumn: nextDictionary.defaultDateColumn || "",
      defaultCurrency: nextDictionary.defaultCurrency || "EUR",
      selectPrimaryMetrics: (Array.isArray(nextDictionary.metrics) ? nextDictionary.metrics : [])
        .filter((metric) => metric?.primary)
        .map((metric) => metric.name)
    }
  });

  return {
    ok: true,
    model: {
      key: model.key,
      displayName: model.displayName,
      area: model.area,
      enabled: model.enabled,
      description: model.description || null
    },
    dictionary: nextDictionary,
    quality,
    review,
    saved: true
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Best effort.
  }
}

async function getBusinessDictionaryPath(modelKey) {
  const key = normalizeModelKey(modelKey);
  if (!key) {
    throw new Error("modelKey inválido.");
  }
  const model = getPowerBiModel(key);
  if (!model) {
    throw new Error("Modelo Power BI no encontrado.");
  }
  const root = path.resolve(BUSINESS_DICTIONARY_ROOT);
  const target = path.resolve(path.join(root, `${key}.json`));
  if (!target.startsWith(`${root}${path.sep}`) && target !== `${root}`) {
    throw new Error("Ruta de diccionario inválida.");
  }
  await ensureRoot();
  return { model, filePath: target };
}

export async function getPowerBiBusinessDictionary(modelKey) {
  const key = normalizeModelKey(modelKey);
  if (!key) {
    return { ok: false, error: "modelKey inválido." };
  }

  const model = getPowerBiModel(key);
  if (!model) {
    return { ok: false, error: "Modelo Power BI no encontrado." };
  }

  const catalog = await getPowerBiBusinessCatalog(key);
  if (!catalog?.ok) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: catalog?.error || "No hay catálogo importado para generar el diccionario."
    };
  }

  const { filePath } = await getBusinessDictionaryPath(key);
  const saved = await readJsonIfExists(filePath);

  if (saved) {
    const normalized = normalizeSavedDictionary(saved, model, catalog);
    const quality = buildBusinessDictionaryQuality(normalized, {
      catalog,
      numericColumns: collectNumericColumns(catalog)
    });
    return {
      ok: true,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      dictionary: normalized,
      quality,
      saved: true,
      generated: false
    };
  }

  const draft = await generateBusinessDictionaryDraft(key, { persist: false });
  return draft.ok
    ? {
        ok: true,
        model: {
          key: model.key,
          displayName: model.displayName,
          area: model.area,
          enabled: model.enabled,
          description: model.description || null
        },
        dictionary: draft.dictionary,
        quality: draft.quality,
        saved: false,
        generated: true
      }
    : draft;
}

function collectNumericColumns(catalog) {
  const rows = [];
  for (const table of Array.isArray(catalog?.tables) ? catalog.tables : []) {
    for (const column of Array.isArray(table?.columns) ? table.columns : []) {
      if (column?.hidden) {
        continue;
      }
      if (isNumericColumn(column)) {
        rows.push({
          table: normalizeText(table?.name),
          column: normalizeText(column?.name)
        });
      }
    }
  }
  return rows;
}

export async function generateBusinessDictionaryDraft(modelKey, options = {}) {
  const key = normalizeModelKey(modelKey);
  if (!key) {
    return { ok: false, error: "modelKey inválido." };
  }

  const model = getPowerBiModel(key);
  if (!model) {
    return { ok: false, error: "Modelo Power BI no encontrado." };
  }

  const catalog = await getPowerBiBusinessCatalog(key);
  if (!catalog?.ok) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: catalog?.error || "No hay catálogo importado para generar el diccionario."
    };
  }

  const { dictionary, quality } = classifyCatalog({
    ...catalog,
    model
  });
  const normalized = normalizeSavedDictionary(dictionary, model, catalog);
  const finalQuality = buildBusinessDictionaryQuality(normalized, {
    catalog,
    numericColumns: collectNumericColumns(catalog)
  });
  normalized.warnings = uniqueList([
    ...(Array.isArray(normalized.warnings) ? normalized.warnings : []),
    ...(finalQuality?.issues || [])
  ]);

  if (options?.persist !== false) {
    const { filePath } = await getBusinessDictionaryPath(key);
    await writeJson(filePath, normalized);
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
    dictionary: normalized,
    quality: finalQuality,
    saved: options?.persist !== false,
    generated: true
  };
}

export async function savePowerBiBusinessDictionary(modelKey, dictionary) {
  const key = normalizeModelKey(modelKey);
  if (!key) {
    return { ok: false, error: "modelKey inválido." };
  }

  const model = getPowerBiModel(key);
  if (!model) {
    return { ok: false, error: "Modelo Power BI no encontrado." };
  }

  const catalog = await getPowerBiBusinessCatalog(key);
  if (!catalog?.ok) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: catalog?.error || "No hay catálogo importado para guardar el diccionario."
    };
  }

  const normalized = normalizeSavedDictionary(dictionary || {}, model, catalog);
  const quality = buildBusinessDictionaryQuality(normalized, {
    catalog,
    numericColumns: collectNumericColumns(catalog)
  });
  normalized.warnings = uniqueList([...(normalized.warnings || []), ...(quality.issues || [])]);

  const { filePath } = await getBusinessDictionaryPath(key);
  await writeJson(filePath, normalized);

  return {
    ok: true,
    model: {
      key: model.key,
      displayName: model.displayName,
      area: model.area,
      enabled: model.enabled,
      description: model.description || null
    },
    dictionary: normalized,
    quality,
    saved: true
  };
}

export async function getPowerBiBusinessDictionaryQuality(modelKey) {
  const payload = await getPowerBiBusinessDictionary(modelKey);
  if (!payload?.ok) {
    return payload;
  }

  const dictionary = payload.dictionary || null;
  const quality = payload.quality || buildBusinessDictionaryQuality(dictionary || {}, {
    catalog: {},
    numericColumns: []
  });
  return {
    ok: true,
    model: payload.model,
    saved: Boolean(payload.saved),
    generated: Boolean(payload.generated),
    dictionaryAvailable: Boolean(dictionary),
    quality,
    summary: buildBusinessDictionarySummary(dictionary || {}, quality),
    dictionary: dictionary || null
  };
}

export async function listPowerBiBusinessDictionaryFiles() {
  await ensureRoot();
  const entries = await fs.readdir(BUSINESS_DICTIONARY_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "es"));
}

export function getPowerBiBusinessDictionaryRoot() {
  return BUSINESS_DICTIONARY_ROOT;
}
