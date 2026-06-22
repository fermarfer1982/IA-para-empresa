import fs from "fs/promises";
import path from "path";
import { getPowerBiModel, listPowerBiModels } from "./powerbiModels";
import {
  getPowerBiCatalogImport,
  getPowerBiCatalogImportsSummary,
  listPowerBiCatalogImports,
  upsertPowerBiCatalogImport
} from "./reportsDb";
import {
  normalizePowerBiCatalogImport,
  parsePowerBiCatalogSource
} from "./powerbiTmdlParser";

const IMPORT_ROOT = path.join(process.cwd(), "data", "powerbi-catalog-imports");
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function normalizeText(value) {
  return String(value || "").trim();
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

  return normalizeText(message) || "Error desconocido de importación Power BI.";
}

function sanitizeModelKey(modelKey) {
  const text = normalizeText(modelKey).toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : "";
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(dirPath, 0o700);
  } catch {
    // Best effort.
  }
}

export async function ensurePowerBiCatalogImportRoot() {
  await ensureDir(IMPORT_ROOT);
}

export function getPowerBiCatalogImportRoot() {
  return IMPORT_ROOT;
}

export async function getPowerBiCatalogImportPath(modelKey) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (!sanitizedKey) {
    throw new Error("modelKey inválido.");
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    throw new Error("Modelo Power BI no encontrado.");
  }

  const root = path.resolve(IMPORT_ROOT);
  const target = path.resolve(path.join(root, sanitizedKey));
  if (!target.startsWith(`${root}${path.sep}`) && target !== `${root}`) {
    throw new Error("Ruta de importación inválida.");
  }

  await ensurePowerBiCatalogImportRoot();
  await ensureDir(target);
  return target;
}

async function listFilesRecursive(rootDir) {
  const entries = [];
  async function visit(currentDir) {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const absolutePath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }
      const stat = await fs.stat(absolutePath);
      entries.push({
        absolutePath,
        relativePath: path.relative(rootDir, absolutePath).split(path.sep).join("/"),
        size: stat.size,
        ext: path.extname(dirent.name).toLowerCase()
      });
    }
  }

  try {
    await visit(rootDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries;
}

function getImportSourceFromFiles(files) {
  const hasTmdl = files.some((file) => file.ext === ".tmdl");
  const hasPbip = files.some(
    (file) =>
      file.ext === ".pbip" ||
      /(^|\/)definition\//i.test(file.relativePath) ||
      /semanticmodel/i.test(file.relativePath)
  );

  if (hasTmdl) {
    return "tmdl";
  }
  if (hasPbip) {
    return "pbip";
  }
  if (files.some((file) => file.ext === ".json")) {
    return "json";
  }
  return null;
}

async function readFileIfSmall(filePath, size) {
  if (size > MAX_FILE_SIZE) {
    throw new Error(`El archivo ${path.basename(filePath)} supera el tamaño permitido.`);
  }
  return fs.readFile(filePath, "utf8");
}

function normalizeJsonCandidate(value, context) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const normalized = normalizePowerBiCatalogImport(value, context);
  const hasData =
    normalized.tables.length ||
    normalized.columns.length ||
    normalized.measures.length ||
    normalized.relationships.length ||
    normalized.hierarchies.length;
  return hasData ? normalized : null;
}

async function parseJsonImport(files, context) {
  for (const file of files.filter((item) => item.ext === ".json").sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const content = await readFileIfSmall(file.absolutePath, file.size);
    try {
      const parsed = JSON.parse(content);
      const normalized = normalizeJsonCandidate(parsed.catalog || parsed, context);
      if (normalized) {
        normalized.source = "json";
        normalized.generatedAt = new Date().toISOString();
        return {
          catalog: normalized,
          warnings: [],
          manifest: files.map((entry) => ({
            path: entry.relativePath,
            size: entry.size,
            ext: entry.ext
          }))
        };
      }
    } catch {
      // Continue to next candidate.
    }
  }
  return null;
}

async function parseTmdlImport(files, context) {
  const tmdlFiles = files
    .filter((item) => item.ext === ".tmdl")
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const catalogParts = [];
  const warnings = [];

  for (const file of tmdlFiles) {
    const content = await readFileIfSmall(file.absolutePath, file.size);
    const parsed = parsePowerBiCatalogSource(content, {
      modelKey: context.modelKey,
      filePath: file.relativePath
    });
    if (parsed) {
      catalogParts.push(parsed);
    } else {
      warnings.push(`No se pudo interpretar ${file.relativePath}.`);
    }
  }

  if (!catalogParts.length) {
    return null;
  }

  const merged = {
    modelKey: context.modelKey,
    source: context.source,
    generatedAt: new Date().toISOString(),
    tables: [],
    columns: [],
    measures: [],
    relationships: [],
    hierarchies: [],
    warnings
  };
  const tableMap = new Map();
  const columnMap = new Map();
  const measureMap = new Map();
  const hierarchyMap = new Map();
  const relationshipMap = new Map();

  for (const part of catalogParts) {
    merged.warnings.push(...(part.warnings || []));

    for (const table of part.tables || []) {
      const key = normalizeText(table?.name).toLowerCase();
      if (!key) {
        continue;
      }
      if (!tableMap.has(key)) {
        const nextTable = {
          ...table,
          columns: [],
          measures: [],
          hierarchies: []
        };
        tableMap.set(key, nextTable);
        merged.tables.push(nextTable);
      }
    }

    for (const column of part.columns || []) {
      const key = `${normalizeText(column?.tableName).toLowerCase()}::${normalizeText(column?.name).toLowerCase()}`;
      if (!key.trim()) {
        continue;
      }
      if (!columnMap.has(key)) {
        columnMap.set(key, column);
        merged.columns.push(column);
        const table = tableMap.get(normalizeText(column?.tableName).toLowerCase());
        if (table) {
          table.columns.push(column);
        }
      }
    }

    for (const measure of part.measures || []) {
      const key = `${normalizeText(measure?.tableName).toLowerCase()}::${normalizeText(measure?.name).toLowerCase()}`;
      if (!key.trim()) {
        continue;
      }
      if (!measureMap.has(key)) {
        measureMap.set(key, measure);
        merged.measures.push(measure);
        const table = tableMap.get(normalizeText(measure?.tableName).toLowerCase());
        if (table) {
          table.measures.push(measure);
        }
      }
    }

    for (const hierarchy of part.hierarchies || []) {
      const key = `${normalizeText(hierarchy?.tableName).toLowerCase()}::${normalizeText(hierarchy?.name).toLowerCase()}`;
      if (!key.trim()) {
        continue;
      }
      if (!hierarchyMap.has(key)) {
        hierarchyMap.set(key, hierarchy);
        merged.hierarchies.push(hierarchy);
        const table = tableMap.get(normalizeText(hierarchy?.tableName).toLowerCase());
        if (table) {
          table.hierarchies.push(hierarchy);
        }
      }
    }

    for (const relationship of part.relationships || []) {
      const key = [
        relationship?.fromTable,
        relationship?.fromColumn,
        relationship?.toTable,
        relationship?.toColumn
      ]
        .map((partValue) => normalizeText(partValue).toLowerCase())
        .join("::");
      if (!key.trim()) {
        continue;
      }
      if (!relationshipMap.has(key)) {
        relationshipMap.set(key, relationship);
        merged.relationships.push(relationship);
      }
    }
  }

  return {
    catalog: merged,
    warnings: [...new Set(merged.warnings.map((warning) => normalizeText(warning)).filter(Boolean))],
    manifest: files.map((entry) => ({
      path: entry.relativePath,
      size: entry.size,
      ext: entry.ext
    }))
  };
}

function buildEmptyImportStatus(model, files, existingImport) {
  const tmdlFiles = files.filter((file) => file.ext === ".tmdl").length;
  const jsonFiles = files.filter((file) => file.ext === ".json").length;
  const pbipFiles = files.filter(
    (file) =>
      file.ext === ".pbip" ||
      /(^|\/)definition\//i.test(file.relativePath) ||
      /semanticmodel/i.test(file.relativePath)
  ).length;

  return {
    ok: false,
    model: {
      key: model.key,
      displayName: model.displayName,
      area: model.area,
      enabled: model.enabled,
      description: model.description || null
    },
    folder: path.relative(process.cwd(), path.join(IMPORT_ROOT, model.key)),
    folder_exists: true,
    file_count: files.length,
    tmdl_files: tmdlFiles,
    json_files: jsonFiles,
    pbip_files: pbipFiles,
    source_candidate: getImportSourceFromFiles(files),
    imported: Boolean(existingImport?.catalog),
    imported_at: existingImport?.imported_at || null,
    updated_at: existingImport?.updated_at || null,
    warnings: files.length ? [] : ["No hay archivos de catálogo en la carpeta de importación."],
    error: files.length ? null : "No hay archivos de catálogo en la carpeta de importación."
  };
}

export async function getPowerBiCatalogImportStatus(modelKey) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (!sanitizedKey) {
    return {
      ok: false,
      error: "modelKey inválido."
    };
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    return {
      ok: false,
      error: "Modelo Power BI no encontrado."
    };
  }

  const modelDir = await getPowerBiCatalogImportPath(sanitizedKey);
  const files = await listFilesRecursive(modelDir);
  const existingImport = await getPowerBiCatalogImport(sanitizedKey);
  if (!files.length) {
    return buildEmptyImportStatus(model, files, existingImport);
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
    folder: path.relative(process.cwd(), modelDir),
    file_count: files.length,
    tmdl_files: files.filter((file) => file.ext === ".tmdl").length,
    json_files: files.filter((file) => file.ext === ".json").length,
    pbip_files: files.filter(
      (file) =>
        file.ext === ".pbip" ||
        /(^|\/)definition\//i.test(file.relativePath) ||
        /semanticmodel/i.test(file.relativePath)
    ).length,
    source_candidate: getImportSourceFromFiles(files),
    imported: Boolean(existingImport?.catalog),
    imported_at: existingImport?.imported_at || null,
    updated_at: existingImport?.updated_at || null,
    warnings: existingImport?.warnings || [],
    error: existingImport?.error || null
  };
}

export async function importPowerBiCatalogForModel(modelKey) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (!sanitizedKey) {
    return {
      ok: false,
      error: "modelKey inválido."
    };
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    return {
      ok: false,
      error: "Modelo Power BI no encontrado."
    };
  }

  const modelDir = await getPowerBiCatalogImportPath(sanitizedKey);
  const files = await listFilesRecursive(modelDir);
  if (!files.length) {
    const error = "La carpeta de importación está vacía.";
    await upsertPowerBiCatalogImport({
      model_key: model.key,
      display_name: model.displayName,
      source: "json",
      status: "empty",
      imported_at: null,
      updated_at: new Date().toISOString(),
      error,
      warnings: [error],
      catalog: null,
      file_manifest_json: [],
      file_count: 0
    });
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error
    };
  }

  const source = getImportSourceFromFiles(files);
  if (!source) {
    const error = "No se encontraron archivos TMDL, PBIP o JSON válidos en la carpeta de importación.";
    await upsertPowerBiCatalogImport({
      model_key: model.key,
      display_name: model.displayName,
      source: "json",
      status: "empty",
      imported_at: null,
      updated_at: new Date().toISOString(),
      error,
      warnings: [error],
      catalog: null,
      file_manifest_json: [],
      file_count: files.length
    });
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error
    };
  }

  try {
    let parsed = null;
    if (source === "json") {
      parsed = await parseJsonImport(files, {
        modelKey: model.key,
        tableName: null,
        source
      });
    } else {
      parsed = await parseTmdlImport(files, {
        modelKey: model.key,
        source
      });
    }

    if (!parsed?.catalog) {
      const error = "No se pudo construir un catálogo técnico a partir de los archivos importados.";
      await upsertPowerBiCatalogImport({
        model_key: model.key,
        display_name: model.displayName,
        source,
        status: "failed",
        imported_at: null,
        updated_at: new Date().toISOString(),
        error,
        warnings: parsed?.warnings || [error],
        catalog: null,
        file_manifest_json: parsed?.manifest || [],
        file_count: files.length
      });
      return {
        ok: false,
        model: {
          key: model.key,
          displayName: model.displayName,
          area: model.area,
          enabled: model.enabled,
          description: model.description || null
        },
        error,
        warnings: parsed?.warnings || [error]
      };
    }

    const catalog = {
      ...parsed.catalog,
      modelKey: model.key,
      source
    };

    const saved = await upsertPowerBiCatalogImport({
      model_key: model.key,
      display_name: model.displayName,
      source,
      status: "ok",
      imported_at: catalog.generatedAt,
      updated_at: new Date().toISOString(),
      warnings: parsed.warnings || [],
      catalog,
      file_manifest_json: parsed.manifest || [],
      file_count: files.length
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
      ...saved.catalog,
      source,
      file_count: files.length,
      warnings: saved.warnings || [],
      imported_at: saved.imported_at,
      updated_at: saved.updated_at
    };
  } catch (error) {
    const friendly = friendlyError(error?.message || error);
    await upsertPowerBiCatalogImport({
      model_key: model.key,
      display_name: model.displayName,
      source,
      status: "failed",
      imported_at: null,
      updated_at: new Date().toISOString(),
      error: friendly,
      warnings: [friendly],
      catalog: null,
      file_manifest_json: files.map((entry) => ({
        path: entry.relativePath,
        size: entry.size,
        ext: entry.ext
      })),
      file_count: files.length
    });
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      error: friendly
    };
  }
}

export async function getPowerBiBusinessCatalog(modelKey) {
  const sanitizedKey = sanitizeModelKey(modelKey);
  if (!sanitizedKey) {
    return {
      ok: false,
      error: "modelKey inválido."
    };
  }

  const model = getPowerBiModel(sanitizedKey);
  if (!model) {
    return {
      ok: false,
      error: "Modelo Power BI no encontrado."
    };
  }

  const cached = await getPowerBiCatalogImport(sanitizedKey);
  if (!cached?.catalog) {
    return {
      ok: false,
      model: {
        key: model.key,
        displayName: model.displayName,
        area: model.area,
        enabled: model.enabled,
        description: model.description || null
      },
      source: cached?.source || null,
      catalogAvailable: false,
      warnings: cached?.warnings || [],
      error: cached?.error || "No hay catálogo importado."
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
    ...cached.catalog,
    source: cached.source,
    catalogAvailable: true,
    imported_at: cached.imported_at,
    updated_at: cached.updated_at,
    warnings: cached.warnings || [],
    file_count: cached.file_count
  };
}

export async function getPowerBiCatalogImportsStatus() {
  const models = listPowerBiModels();
  const [imports, summary] = await Promise.all([
    listPowerBiCatalogImports(),
    getPowerBiCatalogImportsSummary()
  ]);

  return {
    ok: true,
    models_total: models.length,
    imports_total: summary.total,
    updated_at: summary.updated_at,
    source_counts: summary.source_counts,
    imports: imports.map((row) => ({
      model_key: row.model_key,
      display_name: row.display_name,
      source: row.source,
      status: row.status,
      imported_at: row.imported_at,
      updated_at: row.updated_at,
      error: row.error || null,
      file_count: Number(row.file_count || 0)
    }))
  };
}
