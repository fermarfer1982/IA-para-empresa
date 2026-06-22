import { getPowerBiModel } from "./powerbiModels";
import {
  closeXmlaSession,
  createXmlaConnection,
  detectXmlaCatalogSupport,
  executeXmlaDiscover,
  getWorkspaceDetailsById
} from "./powerbiXmlaClient";
import {
  getPowerBiCatalogCache,
  getPowerBiCatalogCacheSummary,
  upsertPowerBiCatalogCache
} from "./reportsDb";
import { listPowerBiModels } from "./powerbiModels";
import { getWorkspaceDataset } from "./powerbiClient";

const XMLA_ROWSET_TABLES = "TMSCHEMA_TABLES";
const XMLA_ROWSET_COLUMNS = "TMSCHEMA_COLUMNS";
const XMLA_ROWSET_MEASURES = "TMSCHEMA_MEASURES";
const XMLA_ROWSET_RELATIONSHIPS = "TMSCHEMA_RELATIONSHIPS";
const XMLA_ROWSET_HIERARCHIES = "TMSCHEMA_HIERARCHIES";
const XMLA_ROWSET_LEVELS = "TMSCHEMA_LEVELS";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
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

  return normalizeText(message) || "Error desconocido de Power BI XMLA.";
}

function getEnv() {
  const enabled = normalizeBoolean(process.env.POWERBI_XMLA_ENABLED);
  const cacheEnabled = normalizeBoolean(process.env.POWERBI_CATALOG_CACHE_ENABLED);
  const ttlSeconds = Math.max(
    60,
    Math.min(Number(process.env.POWERBI_CATALOG_CACHE_TTL_SECONDS) || 3600, 86400)
  );

  return {
    enabled,
    configured:
      Boolean(process.env.POWERBI_TENANT_ID) &&
      Boolean(process.env.POWERBI_CLIENT_ID) &&
      Boolean(process.env.POWERBI_CLIENT_SECRET) &&
      Boolean(process.env.POWERBI_XMLA_SERVER_PREFIX),
    mode: normalizeText(process.env.POWERBI_XMLA_MODE) || "readonly",
    serverPrefix:
      normalizeText(process.env.POWERBI_XMLA_SERVER_PREFIX) ||
      "powerbi://api.powerbi.com/v1.0/myorg",
    cacheEnabled,
    cacheTtlSeconds: ttlSeconds
  };
}

function getField(row, candidates) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const normalizedCandidate = String(candidate || "").toLowerCase();
    const match = keys.find((key) => String(key || "").toLowerCase() === normalizedCandidate);
    if (match !== undefined) {
      const value = row[match];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
  }

  return null;
}

function normalizeListValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  const text = normalizeText(value);
  return text ? [text] : [];
}

function buildTableMap(rows) {
  const tableMap = new Map();
  for (const row of rows) {
    const id = getField(row, ["ID", "Id", "TableID", "TableId"]);
    const name = getField(row, ["Name", "NAME"]);
    if (!id || !name) {
      continue;
    }
    tableMap.set(String(id), {
      id: String(id),
      name: normalizeText(name),
      description: normalizeText(getField(row, ["Description", "DESCRIPTION"])) || null,
      hidden: normalizeBoolean(getField(row, ["IsHidden", "IS_HIDDEN", "Hidden"])),
      displayFolder: normalizeText(getField(row, ["DisplayFolder", "DISPLAY_FOLDER"])) || null
    });
  }
  return tableMap;
}

function buildHierarchyMap(rows, tableMap) {
  return rows
    .map((row) => {
      const id = getField(row, ["ID", "Id", "HierarchyID", "HierarchyId"]);
      const tableId = getField(row, ["TableID", "TableId"]);
      const name = getField(row, ["Name", "NAME"]);
      if (!id || !name) {
        return null;
      }
      return {
        id: String(id),
        tableId: tableId ? String(tableId) : null,
        tableName: tableId && tableMap.get(String(tableId)) ? tableMap.get(String(tableId)).name : null,
        name: normalizeText(name),
        description: normalizeText(getField(row, ["Description", "DESCRIPTION"])) || null,
        hidden: normalizeBoolean(getField(row, ["IsHidden", "IS_HIDDEN", "Hidden"])),
        levels: []
      };
    })
    .filter(Boolean);
}

function normalizeCatalogFromRows({ tables = [], columns = [], measures = [], relationships = [], hierarchies = [], levels = [] }) {
  const tableMap = buildTableMap(tables);
  const hierarchyMap = buildHierarchyMap(hierarchies, tableMap);
  const hierarchyLookup = new Map(hierarchyMap.map((item) => [item.id, item]));

  for (const levelRow of levels) {
    const hierarchyId = getField(levelRow, ["HierarchyID", "HierarchyId"]);
    const hierarchy = hierarchyLookup.get(hierarchyId ? String(hierarchyId) : "");
    if (!hierarchy) {
      continue;
    }
    hierarchy.levels.push({
      id: String(getField(levelRow, ["ID", "Id", "LevelID", "LevelId"]) || ""),
      name: normalizeText(getField(levelRow, ["Name", "NAME"])),
      ordinal: Number(getField(levelRow, ["Ordinal", "ORDINAL"]) || 0),
      hidden: normalizeBoolean(getField(levelRow, ["IsHidden", "IS_HIDDEN", "Hidden"]))
    });
  }

  const normalizedTables = [...tableMap.values()].map((table) => ({
    ...table,
    columns: [],
    measures: [],
    hierarchies: []
  }));

  const tableLookup = new Map(normalizedTables.map((table) => [table.id, table]));

  const normalizedColumns = columns
    .map((row) => {
      const id = getField(row, ["ID", "Id", "ColumnID", "ColumnId"]);
      const tableId = getField(row, ["TableID", "TableId"]);
      const name = getField(row, ["Name", "NAME"]);
      if (!id || !tableId || !name) {
        return null;
      }
      const normalized = {
        id: String(id),
        tableId: String(tableId),
        tableName: tableLookup.get(String(tableId))?.name || null,
        name: normalizeText(name),
        dataType: normalizeText(getField(row, ["DataType", "DATATYPE"])) || null,
        hidden: normalizeBoolean(getField(row, ["IsHidden", "IS_HIDDEN", "Hidden"])),
        description: normalizeText(getField(row, ["Description", "DESCRIPTION"])) || null
      };
      const table = tableLookup.get(String(tableId));
      if (table) {
        table.columns.push(normalized);
      }
      return normalized;
    })
    .filter(Boolean);

  const normalizedMeasures = measures
    .map((row) => {
      const id = getField(row, ["ID", "Id", "MeasureID", "MeasureId"]);
      const tableId = getField(row, ["TableID", "TableId"]);
      const name = getField(row, ["Name", "NAME"]);
      if (!id || !tableId || !name) {
        return null;
      }
      const normalized = {
        id: String(id),
        tableId: String(tableId),
        tableName: tableLookup.get(String(tableId))?.name || null,
        name: normalizeText(name),
        formatString: normalizeText(getField(row, ["FormatString", "FORMATSTRING"])) || null,
        hidden: normalizeBoolean(getField(row, ["IsHidden", "IS_HIDDEN", "Hidden"])),
        description: normalizeText(getField(row, ["Description", "DESCRIPTION"])) || null
      };
      const table = tableLookup.get(String(tableId));
      if (table) {
        table.measures.push(normalized);
      }
      return normalized;
    })
    .filter(Boolean);

  const normalizedHierarchies = hierarchyMap
    .map((hierarchy) => {
      const table = hierarchy.tableId ? tableLookup.get(String(hierarchy.tableId)) : null;
      const normalized = {
        ...hierarchy,
        tableName: table?.name || hierarchy.tableName || null
      };
      if (table) {
        table.hierarchies.push(normalized);
      }
      return normalized;
    })
    .filter(Boolean);

  const normalizedRelationships = relationships
    .map((row) => {
      const id = getField(row, ["ID", "Id", "RelationshipID", "RelationshipId"]);
      if (!id) {
        return null;
      }
      const fromTableId = getField(row, ["FromTableID", "FromTableId"]);
      const toTableId = getField(row, ["ToTableID", "ToTableId"]);
      const fromColumnId = getField(row, ["FromColumnID", "FromColumnId"]);
      const toColumnId = getField(row, ["ToColumnID", "ToColumnId"]);
      return {
        id: String(id),
        fromTableId: fromTableId ? String(fromTableId) : null,
        fromTableName: fromTableId ? tableLookup.get(String(fromTableId))?.name || null : null,
        fromColumnId: fromColumnId ? String(fromColumnId) : null,
        fromColumnName: null,
        toTableId: toTableId ? String(toTableId) : null,
        toTableName: toTableId ? tableLookup.get(String(toTableId))?.name || null : null,
        toColumnId: toColumnId ? String(toColumnId) : null,
        toColumnName: null,
        isActive: normalizeBoolean(getField(row, ["IsActive", "ISACTIVE"])),
        cardinality: normalizeText(getField(row, ["Cardinality", "CARDINALITY"])) || null,
        crossFilteringBehavior:
          normalizeText(getField(row, ["CrossFilteringBehavior", "CROSSFILTERINGBEHAVIOR"])) ||
          null,
        securityFilteringBehavior:
          normalizeText(getField(row, ["SecurityFilteringBehavior", "SECURITYFILTERINGBEHAVIOR"])) ||
          null
      };
    })
    .filter(Boolean);

  const columnLookup = new Map(normalizedColumns.map((column) => [column.id, column]));
  for (const relationship of normalizedRelationships) {
    relationship.fromColumnName = relationship.fromColumnId
      ? columnLookup.get(String(relationship.fromColumnId))?.name || null
      : null;
    relationship.toColumnName = relationship.toColumnId
      ? columnLookup.get(String(relationship.toColumnId))?.name || null
      : null;
  }

  return {
    tables: normalizedTables,
    columns: normalizedColumns,
    measures: normalizedMeasures,
    relationships: normalizedRelationships,
    hierarchies: normalizedHierarchies,
    counts: {
      tables: normalizedTables.length,
      columns: normalizedColumns.length,
      measures: normalizedMeasures.length,
      relationships: normalizedRelationships.length,
      hierarchies: normalizedHierarchies.length
    }
  };
}

async function discoverXmlaRows(connection, requestType) {
  const session = await createXmlaConnection({
    workspaceId: connection.workspaceId,
    workspaceName: connection.workspaceName,
    datasetName: connection.catalog
  });
  try {
    const openSession = await openXmlaSession(session);
    try {
      return await executeXmlaDiscover(openSession, requestType, {});
    } finally {
      await closeXmlaSession(openSession);
    }
  } catch (error) {
    throw error;
  }
}

function buildCatalogPayload(model, xmlaAvailable, source, warnings, rows) {
  const normalized = normalizeCatalogFromRows(rows);
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    modelKey: model.key,
    displayName: model.displayName,
    area: model.area,
    catalogAvailable: Boolean(xmlaAvailable && normalized.counts.tables >= 0),
    xmlaAvailable: Boolean(xmlaAvailable),
    source,
    generatedAt,
    tables: normalized.tables,
    columns: normalized.columns,
    measures: normalized.measures,
    relationships: normalized.relationships,
    hierarchies: normalized.hierarchies,
    warnings: Array.isArray(warnings) ? warnings.filter(Boolean) : [],
    summary: {
      tables: normalized.counts.tables,
      columns: normalized.counts.columns,
      measures: normalized.counts.measures,
      relationships: normalized.counts.relationships,
      hierarchies: normalized.counts.hierarchies
    }
  };
}

function buildUnavailableCatalog(model, reason, warnings = []) {
  const generatedAt = new Date().toISOString();
  return {
    ok: false,
    modelKey: model.key,
    displayName: model.displayName,
    area: model.area,
    catalogAvailable: false,
    xmlaAvailable: false,
    source: "rest",
    generatedAt,
    tables: [],
    columns: [],
    measures: [],
    relationships: [],
    hierarchies: [],
    warnings: [...warnings.filter(Boolean), reason].filter(Boolean),
    summary: {
      tables: 0,
      columns: 0,
      measures: 0,
      relationships: 0,
      hierarchies: 0
    },
    reason
  };
}

function cacheExpired(cachedRow, ttlSeconds) {
  if (!cachedRow?.updated_at) {
    return true;
  }

  const updatedAt = new Date(cachedRow.updated_at);
  if (Number.isNaN(updatedAt.getTime())) {
    return true;
  }

  const ageMs = Date.now() - updatedAt.getTime();
  return ageMs > ttlSeconds * 1000;
}

async function getModelWorkspaceDetails(model) {
  const workspace = await getWorkspaceDetailsById(model.workspaceId);
  const dataset = await getWorkspaceDataset(model.workspaceId, model.datasetId);
  return {
    id: workspace?.id || model.workspaceId,
    name: workspace?.name || null,
    capacityUri: workspace?.capacityUri || null,
    capacityObjectId: workspace?.capacityObjectId || null,
    datasetName: dataset?.name || null
  };
}

async function getXmlaSupport(model) {
  const workspace = await getModelWorkspaceDetails(model);
  if (!workspace.name) {
    return {
      ok: false,
      available: false,
      reason: "No se pudo leer el nombre del workspace para XMLA."
    };
  }
  if (!workspace.datasetName) {
    return {
      ok: false,
      available: false,
      reason: "No se pudo leer el nombre del semantic model para XMLA."
    };
  }
  if (!workspace.capacityUri) {
    return {
      ok: false,
      available: false,
      reason: "Workspace is not in Premium/Fabric/PPU capacity or XMLA endpoint is not enabled"
    };
  }

  const support = await detectXmlaCatalogSupport({
    workspaceId: model.workspaceId,
    workspaceName: workspace.name,
    datasetName: model.datasetId
  });
  if (!support.ok || !support.available) {
    return {
      ok: false,
      available: false,
      reason: support.error || "Workspace is not in Premium/Fabric/PPU capacity or XMLA endpoint is not enabled"
    };
  }

  return {
    ok: true,
    available: true,
    workspaceName: workspace.name,
    workspace
  };
}

async function generateModelCatalog(model, env, { refresh = false } = {}) {
  const warnings = [];
  const xmlaSupport = await getXmlaSupport(model);

  if (!xmlaSupport.available) {
    return buildUnavailableCatalog(model, xmlaSupport.reason, warnings);
  }

  let session = null;
  try {
    session = await createXmlaConnection({
      workspaceId: model.workspaceId,
      workspaceName: xmlaSupport.workspaceName,
      datasetName: xmlaSupport.workspace.datasetName
    });
    session = await openXmlaSession(session);

    const [tables, columns, measures, relationships, hierarchies, levels] = await Promise.all([
      executeXmlaDiscover(session, XMLA_ROWSET_TABLES, {}).catch((error) => {
        warnings.push(`tables: ${friendlyError(error?.message || error)}`);
        return [];
      }),
      executeXmlaDiscover(session, XMLA_ROWSET_COLUMNS, {}).catch((error) => {
        warnings.push(`columns: ${friendlyError(error?.message || error)}`);
        return [];
      }),
      executeXmlaDiscover(session, XMLA_ROWSET_MEASURES, {}).catch((error) => {
        warnings.push(`measures: ${friendlyError(error?.message || error)}`);
        return [];
      }),
      executeXmlaDiscover(session, XMLA_ROWSET_RELATIONSHIPS, {}).catch((error) => {
        warnings.push(`relationships: ${friendlyError(error?.message || error)}`);
        return [];
      }),
      executeXmlaDiscover(session, XMLA_ROWSET_HIERARCHIES, {}).catch((error) => {
        warnings.push(`hierarchies: ${friendlyError(error?.message || error)}`);
        return [];
      }),
      executeXmlaDiscover(session, XMLA_ROWSET_LEVELS, {}).catch((error) => {
        warnings.push(`levels: ${friendlyError(error?.message || error)}`);
        return [];
      })
    ]);

    const payload = buildCatalogPayload(
      model,
      true,
      refresh ? "xmla-refresh" : "xmla",
      warnings,
      { tables, columns, measures, relationships, hierarchies, levels }
    );

    if (env.cacheEnabled) {
      await upsertPowerBiCatalogCache({
        model_key: model.key,
        display_name: model.displayName,
        catalog_available: payload.catalogAvailable,
        xmla_available: payload.xmlaAvailable,
        status: "ok",
        source: payload.source,
        generated_at: payload.generatedAt,
        updated_at: payload.generatedAt,
        warnings: payload.warnings,
        catalog: payload
      });
    }

    return payload;
  } catch (error) {
    const reason = friendlyError(error?.message || error);
    const payload = buildUnavailableCatalog(model, reason, warnings);
    if (env.cacheEnabled) {
      await upsertPowerBiCatalogCache({
        model_key: model.key,
        display_name: model.displayName,
        catalog_available: payload.catalogAvailable,
        xmla_available: payload.xmlaAvailable,
        status: "failed",
        source: "xmla",
        generated_at: payload.generatedAt,
        updated_at: payload.generatedAt,
        error: reason,
        warnings: payload.warnings,
        catalog: payload
      });
    }
    return payload;
  } finally {
    if (session) {
      await closeXmlaSession(session);
    }
  }
}

export async function getPowerBiCatalogStatus() {
  const env = getEnv();
  const models = listPowerBiModels();
  const cacheSummary = await getPowerBiCatalogCacheSummary();

  return {
    ok: true,
    enabled: env.enabled,
    configured: env.configured,
    mode: env.mode,
    xmla_enabled: env.enabled,
    cache_enabled: env.cacheEnabled,
    cache_ttl_seconds: env.cacheTtlSeconds,
    models_total: models.length,
    models_enabled: models.filter((model) => model.enabled).length,
    cache_total: cacheSummary.total,
    cache_updated_at: cacheSummary.updated_at,
    cache_status_counts: cacheSummary.status_counts
  };
}

export async function getPowerBiModelCatalog(modelKey, options = {}) {
  const model = getPowerBiModel(modelKey);
  if (!model) {
    return {
      ok: false,
      error: "Modelo Power BI no encontrado."
    };
  }
  if (!model.enabled) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: "El modelo está deshabilitado en el catálogo interno."
    };
  }

  const env = getEnv();
  const cached = env.cacheEnabled ? await getPowerBiCatalogCache(model.key) : null;
  const cacheIsFresh = cached && !options.refresh && !cacheExpired(cached, env.cacheTtlSeconds);

  if (cacheIsFresh && cached?.catalog) {
    return {
      ok: true,
      ...cached.catalog,
      cache: {
        available: true,
        fresh: true,
        updatedAt: cached.updated_at
      }
    };
  }

  if (!env.enabled || !env.configured) {
    const reason = !env.enabled
      ? "POWERBI_XMLA_ENABLED=false."
      : "Power BI XMLA no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET y POWERBI_XMLA_SERVER_PREFIX.";
    return cached?.catalog
      ? {
          ok: true,
          ...cached.catalog,
          cache: {
            available: true,
            fresh: false,
            updatedAt: cached.updated_at
          },
          warnings: [...(cached.catalog.warnings || []), reason]
        }
      : {
          ok: false,
          model: {
            key: model.key,
            displayName: model.displayName,
            area: model.area,
            enabled: model.enabled,
            description: model.description || null
          },
          ...buildUnavailableCatalog(model, reason)
        };
  }

  const payload = await generateModelCatalog(model, env, options);
  if (!payload.ok && cached?.catalog) {
    return {
      ok: true,
      ...cached.catalog,
      cache: {
        available: true,
        fresh: false,
        updatedAt: cached.updated_at
      },
      warnings: [...(cached.catalog.warnings || []), payload.reason || payload.error].filter(Boolean)
    };
  }

  return {
    ok: Boolean(payload.catalogAvailable),
    ...payload
  };
}

export async function refreshPowerBiModelCatalog(modelKey) {
  return getPowerBiModelCatalog(modelKey, { refresh: true });
}

export async function getPowerBiCatalogModelList() {
  const models = listPowerBiModels();
  const env = getEnv();
  const cacheSummary = await getPowerBiCatalogCacheSummary();
  return {
    ok: true,
    enabled: env.enabled,
    configured: env.configured,
    xmla_enabled: env.enabled,
    cache_enabled: env.cacheEnabled,
    cache_ttl_seconds: env.cacheTtlSeconds,
    models: models.map((model) => ({
      key: model.key,
      displayName: model.displayName,
      area: model.area,
      enabled: model.enabled,
      description: model.description || null
    })),
    cache_total: cacheSummary.total,
    cache_updated_at: cacheSummary.updated_at
  };
}
