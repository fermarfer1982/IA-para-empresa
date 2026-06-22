import {
  getPowerBiAuthStatus,
  getPowerBiEnvironment,
  getPowerBiAccessToken
} from "./powerbiAuth";
import {
  executeDatasetQuery,
  getWorkspaceDataset,
  listWorkspaceReports
} from "./powerbiClient";
import {
  getPowerBiCatalogModelList,
  getPowerBiCatalogStatus as getPowerBiSemanticCatalogStatus,
  getPowerBiModelCatalog as getPowerBiSemanticModelCatalog,
  refreshPowerBiModelCatalog as refreshPowerBiSemanticModelCatalog
} from "./powerbiXmlaCatalog";
import {
  getPowerBiModel,
  getPowerBiModelSummary,
  getPowerBiPublicModelList,
  listEnabledPowerBiModels
} from "./powerbiModels";
import {
  getPowerBiBusinessCatalog,
  getPowerBiCatalogImportStatus,
  getPowerBiCatalogImportsStatus,
  importPowerBiCatalogForModel
} from "./powerbiCatalogImport";

function normalizeText(value) {
  return String(value || "").trim();
}

function sanitizeModel(model) {
  if (!model) {
    return null;
  }

  return {
    key: model.key,
    displayName: model.displayName,
    area: model.area,
    enabled: Boolean(model.enabled),
    description: model.description || null
  };
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

  return normalizeText(message) || "Error desconocido de Power BI.";
}

function resolveModelOrThrow(modelKey) {
  const model = getPowerBiModel(modelKey);
  if (!model) {
    const error = new Error("Modelo Power BI no encontrado.");
    error.statusCode = 404;
    throw error;
  }
  return model;
}

async function getModelDatasetSnapshot(model) {
  try {
    const dataset = await getWorkspaceDataset(model.workspaceId, model.datasetId);
    return {
      ok: true,
      dataset: {
        id: dataset?.id || model.datasetId,
        name: dataset?.name || null,
        description: dataset?.description || null,
        configuredBy: dataset?.configuredBy || null,
        isEffectiveIdentityRequired: dataset?.isEffectiveIdentityRequired ?? null,
        isEffectiveIdentityRolesRequired: dataset?.isEffectiveIdentityRolesRequired ?? null,
        isOnPremGatewayRequired: dataset?.isOnPremGatewayRequired ?? null,
        isRefreshable: dataset?.isRefreshable ?? null,
        targetStorageMode: dataset?.targetStorageMode || null,
        webUrl: dataset?.webUrl || null
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: friendlyError(error?.message)
    };
  }
}

async function getModelReportsSnapshot(model) {
  try {
    const reports = await listWorkspaceReports(model.workspaceId);
    const items = Array.isArray(reports?.value) ? reports.value : [];
    return {
      ok: true,
      reports: items.map((report) => ({
        id: report?.id || null,
        name: report?.name || null,
        datasetId: report?.datasetId || null,
        reportType: report?.reportType || null,
        format: report?.format || null,
        webUrl: report?.webUrl || null
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: friendlyError(error?.message)
    };
  }
}

export async function getPowerBiStatus() {
  const environment = getPowerBiEnvironment();
  const summary = getPowerBiModelSummary();
  const authStatus = getPowerBiAuthStatus();
  let tokenOk = false;
  let tokenError = null;

  if (environment.enabled && environment.configured) {
    try {
      await getPowerBiAccessToken();
      tokenOk = true;
    } catch (error) {
      tokenError = friendlyError(error?.message);
    }
  } else if (!environment.enabled) {
    tokenError = "POWERBI_ENABLED=false.";
  } else {
    tokenError =
      "Power BI no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID y POWERBI_CLIENT_SECRET.";
  }

  return {
    ok: Boolean(environment.enabled && environment.configured && tokenOk),
    enabled: environment.enabled,
    configured: environment.configured,
    token_ok: tokenOk,
    token_error: tokenError,
    models_total: summary.total,
    models_enabled: summary.enabled,
    models_disabled: summary.disabled,
    token_cached: authStatus.tokenCached
  };
}

export async function listPowerBiCatalog() {
  return getPowerBiPublicModelList();
}

export async function getPowerBiCatalogStatus() {
  const semantic = await getPowerBiSemanticCatalogStatus();
  const imports = await getPowerBiCatalogImportsStatus();
  return {
    ...semantic,
    imports_total: imports.imports_total,
    imports_updated_at: imports.updated_at,
    import_source_counts: imports.source_counts
  };
}

export async function getPowerBiModelCatalog(modelKey) {
  const businessCatalog = await getPowerBiBusinessCatalog(modelKey);
  if (businessCatalog?.ok && businessCatalog?.catalogAvailable) {
    return {
      ok: true,
      ...businessCatalog,
      source: businessCatalog.source || "json",
      catalogSource: businessCatalog.source || "json"
    };
  }

  const semanticCatalog = await getPowerBiSemanticModelCatalog(modelKey);
  return {
    ...semanticCatalog,
    catalogSource: semanticCatalog?.source || semanticCatalog?.catalogSource || "rest"
  };
}

export async function refreshPowerBiModelCatalog(modelKey) {
  const importStatus = await getPowerBiCatalogImportStatus(modelKey);
  if (importStatus?.ok && Number(importStatus.file_count || 0) > 0) {
    return importPowerBiCatalogForModel(modelKey);
  }

  return refreshPowerBiSemanticModelCatalog(modelKey);
}

export async function listPowerBiCatalogModels() {
  return getPowerBiCatalogModelList();
}

export async function getPowerBiModelCatalogImportStatus(modelKey) {
  return getPowerBiCatalogImportStatus(modelKey);
}

export async function importPowerBiModelCatalog(modelKey) {
  return importPowerBiCatalogForModel(modelKey);
}

export async function getPowerBiCatalogImportsStatusWrapper() {
  return getPowerBiCatalogImportsStatus();
}

export async function getPowerBiModelStatus(modelKey) {
  const model = resolveModelOrThrow(modelKey);
  const safeModel = sanitizeModel(model);

  if (!model.enabled) {
    return {
      ok: false,
      model: safeModel,
      error: "El modelo está deshabilitado en el catálogo interno."
    };
  }

  const environment = getPowerBiEnvironment();
  if (!environment.enabled || !environment.configured) {
    return {
      ok: false,
      model: safeModel,
      error:
        !environment.enabled
          ? "POWERBI_ENABLED=false. Activa POWERBI_ENABLED para consultar Power BI."
          : "Power BI no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID y POWERBI_CLIENT_SECRET."
    };
  }

  const [datasetSnapshot, reportsSnapshot] = await Promise.all([
    getModelDatasetSnapshot(model),
    getModelReportsSnapshot(model)
  ]);

  return {
    ok: Boolean(datasetSnapshot.ok && reportsSnapshot.ok),
    model: safeModel,
    workspace: {
      ok: Boolean(datasetSnapshot.ok || reportsSnapshot.ok),
      workspaceId: model.workspaceId
    },
    dataset: datasetSnapshot.ok
      ? datasetSnapshot.dataset
      : {
          id: model.datasetId,
          name: null,
          description: null,
          configuredBy: null,
          isEffectiveIdentityRequired: null,
          isEffectiveIdentityRolesRequired: null,
          isOnPremGatewayRequired: null,
          isRefreshable: null,
          targetStorageMode: null,
          webUrl: null,
          error: datasetSnapshot.error
        },
    reports: reportsSnapshot.ok
      ? reportsSnapshot.reports
      : [],
    reportsDetected: reportsSnapshot.ok ? reportsSnapshot.reports.length : 0,
    datasetAccessible: Boolean(datasetSnapshot.ok),
    reportsAccessible: Boolean(reportsSnapshot.ok),
    error: !datasetSnapshot.ok
      ? datasetSnapshot.error
      : !reportsSnapshot.ok
        ? reportsSnapshot.error
        : null
  };
}

export async function getPowerBiModelDataset(modelKey) {
  const model = resolveModelOrThrow(modelKey);
  const safeModel = sanitizeModel(model);
  if (!model.enabled) {
    return {
      ok: false,
      model: safeModel,
      error: "El modelo está deshabilitado en el catálogo interno."
    };
  }

  const environment = getPowerBiEnvironment();
  if (!environment.enabled || !environment.configured) {
    return {
      ok: false,
      model: safeModel,
      error:
        !environment.enabled
          ? "POWERBI_ENABLED=false. Activa POWERBI_ENABLED para consultar Power BI."
          : "Power BI no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID y POWERBI_CLIENT_SECRET."
    };
  }

  const snapshot = await getModelDatasetSnapshot(model);
  return snapshot.ok
    ? { ok: true, model: safeModel, dataset: snapshot.dataset }
    : { ok: false, model: safeModel, error: snapshot.error };
}

export async function getPowerBiModelReports(modelKey) {
  const model = resolveModelOrThrow(modelKey);
  const safeModel = sanitizeModel(model);
  if (!model.enabled) {
    return {
      ok: false,
      model: safeModel,
      error: "El modelo está deshabilitado en el catálogo interno."
    };
  }

  const environment = getPowerBiEnvironment();
  if (!environment.enabled || !environment.configured) {
    return {
      ok: false,
      model: safeModel,
      error:
        !environment.enabled
          ? "POWERBI_ENABLED=false. Activa POWERBI_ENABLED para consultar Power BI."
          : "Power BI no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID y POWERBI_CLIENT_SECRET."
    };
  }

  const snapshot = await getModelReportsSnapshot(model);
  return snapshot.ok
    ? { ok: true, model: safeModel, reports: snapshot.reports }
    : { ok: false, model: safeModel, error: snapshot.error };
}

export async function getPowerBiModelSchema(modelKey) {
  const model = resolveModelOrThrow(modelKey);
  const safeModel = sanitizeModel(model);

  if (!model.enabled) {
    return {
      ok: false,
      model: safeModel,
      schemaAvailable: false,
      reason: "El modelo está deshabilitado en el catálogo interno."
    };
  }

  const datasetSnapshot = await getModelDatasetSnapshot(model);
  if (!datasetSnapshot.ok) {
    return {
      ok: false,
      model: safeModel,
      schemaAvailable: false,
      reason: datasetSnapshot.error
    };
  }

  return {
    ok: true,
    model: safeModel,
    schemaAvailable: false,
    reason:
      "REST metadata is limited; XMLA or another metadata path required.",
    dataset: datasetSnapshot.dataset,
    nextStep: "Preparar catálogo avanzado con XMLA en v0.17.1."
  };
}

export async function testPowerBiModelQuery(modelKey) {
  const model = resolveModelOrThrow(modelKey);
  const safeModel = sanitizeModel(model);

  if (!model.enabled) {
    return {
      ok: false,
      model: safeModel,
      error: "El modelo está deshabilitado en el catálogo interno."
    };
  }

  const environment = getPowerBiEnvironment();
  if (!environment.enabled || !environment.configured) {
    return {
      ok: false,
      model: safeModel,
      error:
        !environment.enabled
          ? "POWERBI_ENABLED=false. Activa POWERBI_ENABLED para consultar Power BI."
          : "Power BI no está configurado. Revisa POWERBI_TENANT_ID, POWERBI_CLIENT_ID y POWERBI_CLIENT_SECRET."
    };
  }

  try {
    const result = await executeDatasetQuery(
      model.workspaceId,
      model.datasetId,
      'EVALUATE ROW("ok", 1)'
    );
    const firstResult = Array.isArray(result?.results) ? result.results[0] : null;
    const firstTable = Array.isArray(firstResult?.tables) ? firstResult.tables[0] : null;
    const rows = Array.isArray(firstTable?.rows) ? firstTable.rows : [];

    if (rows.length !== 1) {
      return {
        ok: false,
        model: safeModel,
        error: "La consulta mínima no devolvió exactamente una fila.",
        rows: rows.length
      };
    }

    const firstRow = rows[0] || {};
    const value = firstRow.ok ?? firstRow["[ok]"] ?? firstRow["ok"];

    return {
      ok: true,
      model: safeModel,
      query: 'EVALUATE ROW("ok", 1)',
      rows: 1,
      tables: 1,
      value: Number(value ?? 1)
    };
  } catch (error) {
    return {
      ok: false,
      model: safeModel,
      query: 'EVALUATE ROW("ok", 1)',
      error: friendlyError(error?.message)
    };
  }
}
