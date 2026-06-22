function normalizeText(value) {
  return String(value || "").trim();
}

function stripQuotes(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).replace(/""/g, '"');
  }
  return text;
}

function parseBoolean(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) {
    return null;
  }
  if (["true", "yes", "on", "1"].includes(text)) {
    return true;
  }
  if (["false", "no", "off", "0"].includes(text)) {
    return false;
  }
  return null;
}

function parseScalar(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  const booleanValue = parseBoolean(text);
  if (booleanValue !== null) {
    return booleanValue;
  }

  return stripQuotes(text);
}

function normalizeKey(key) {
  return normalizeText(key).replace(/\s+/g, "_").toLowerCase();
}

function parseReference(value) {
  const text = stripQuotes(value);
  if (!text) {
    return {
      raw: "",
      table: null,
      column: null
    };
  }

  const bracketMatch = text.match(/^(.+?)\s*\[\s*(.+?)\s*\]$/);
  if (bracketMatch) {
    return {
      raw: text,
      table: stripQuotes(bracketMatch[1]).replace(/\.$/, "") || null,
      column: stripQuotes(bracketMatch[2]) || null
    };
  }

  const simpleColumn = text.match(/^\[(.+)\]$/);
  if (simpleColumn) {
    return {
      raw: text,
      table: null,
      column: stripQuotes(simpleColumn[1]) || null
    };
  }

  return {
    raw: text,
    table: null,
    column: null
  };
}

function inferTableFromPath(filePath) {
  const parts = String(filePath || "").split(/[\\/]/).filter(Boolean);
  const tablesIndex = parts.findIndex((part) => part.toLowerCase() === "tables");
  if (tablesIndex === -1 || !parts[tablesIndex + 1]) {
    return null;
  }

  const candidate = parts[tablesIndex + 1];
  if (candidate.toLowerCase().endsWith(".tmdl")) {
    return stripQuotes(candidate.replace(/\.tmdl$/i, ""));
  }

  return stripQuotes(candidate);
}

function detectSourceFromPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".pbip")) {
    return "pbip";
  }
  if (normalized.includes("/definition/") || normalized.includes("/semanticmodel/")) {
    return "pbip";
  }
  return "tmdl";
}

function createNode(type, name, indent, filePath) {
  return {
    type,
    name: stripQuotes(name),
    indent,
    filePath,
    properties: {},
    children: [],
    descriptionFromComment: "",
    expressionLines: []
  };
}

function splitInlineExpression(text) {
  const raw = normalizeText(text);
  if (!raw) {
    return { name: "", expression: "", hasExpression: false };
  }

  const match = raw.match(/^(.*?)\s*=\s*(.*)$/);
  if (!match) {
    return {
      name: raw,
      expression: "",
      hasExpression: false
    };
  }

  return {
    name: match[1].trim(),
    expression: match[2].trim(),
    hasExpression: true
  };
}

function finalizeExpression(node) {
  if (!node || !Array.isArray(node.expressionLines) || !node.expressionLines.length) {
    return;
  }

  const expression = node.expressionLines.join("\n").trim();
  if (expression) {
    node.properties.expression = expression;
  }
  node.expressionLines = [];
}

function parseTmdlText(text, filePath = "") {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const root = createNode("root", "__root__", -1, filePath);
  const stack = [root];
  let pendingComments = [];
  let expressionNode = null;
  let expressionIndent = -1;

  const currentNode = () => stack[stack.length - 1] || root;

  function flushExpression() {
    if (!expressionNode) {
      return;
    }
    finalizeExpression(expressionNode);
    expressionNode = null;
    expressionIndent = -1;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (!trimmed) {
      if (expressionNode) {
        expressionNode.expressionLines.push("");
      }
      continue;
    }

    if (/^\/\/\//.test(trimmed)) {
      pendingComments.push(trimmed.replace(/^\/\/\/\s?/, ""));
      continue;
    }

    if (/^\/\//.test(trimmed) || /^#/.test(trimmed)) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length || 0;
    const objectMatch = trimmed.match(/^(model|table|column|measure|hierarchy|level|relationship)\s+(.+)$/i);
    if (objectMatch) {
      flushExpression();
      const type = objectMatch[1].toLowerCase();
      const { name, expression, hasExpression } = splitInlineExpression(objectMatch[2]);
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = currentNode();
      const node = createNode(type, name, indent, filePath);
      if (pendingComments.length) {
        node.descriptionFromComment = pendingComments.join("\n").trim();
        pendingComments = [];
      }
      parent.children.push(node);
      stack.push(node);
      if (hasExpression) {
        if (expression) {
          node.expressionLines.push(expression);
        }
        expressionNode = node;
        expressionIndent = indent;
      }
      continue;
    }

    const propertyMatch = trimmed.match(/^([A-Za-z_][\w.]*)\s*:\s*(.*)$/);
    if (propertyMatch) {
      if (expressionNode && indent <= expressionIndent) {
        flushExpression();
      }
      const key = normalizeKey(propertyMatch[1]);
      const value = parseScalar(propertyMatch[2]);
      currentNode().properties[key] = value;
      continue;
    }

    const shorthandBoolean = trimmed.match(/^(isHidden|hidden)$/i);
    if (shorthandBoolean) {
      if (expressionNode && indent <= expressionIndent) {
        flushExpression();
      }
      currentNode().properties[normalizeKey(shorthandBoolean[1])] = true;
      continue;
    }

    if (expressionNode && indent > expressionIndent) {
      expressionNode.expressionLines.push(trimmed);
      continue;
    }

    pendingComments = [];
  }

  flushExpression();
  return root.children;
}

function walkNodes(nodes, visitor, ancestors = []) {
  for (const node of nodes) {
    visitor(node, ancestors);
    if (Array.isArray(node.children) && node.children.length) {
      walkNodes(node.children, visitor, [...ancestors, node]);
    }
  }
}

function parseJsonCatalog(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value;
  }

  return null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBusinessCatalogShape(raw, context = {}) {
  const source = raw?.source || context.source || "json";
  const generatedAt = raw?.generatedAt || raw?.generated_at || new Date().toISOString();
  const warnings = normalizeArray(raw?.warnings).map((warning) => normalizeText(warning)).filter(Boolean);

  const tables = normalizeArray(raw?.tables).map((table) => ({
    ...table,
    name: normalizeText(table?.name),
    description: table?.description || null,
    hidden: Boolean(table?.hidden),
    displayFolder: table?.displayFolder || table?.display_folder || null,
    columns: normalizeArray(table?.columns),
    measures: normalizeArray(table?.measures),
    hierarchies: normalizeArray(table?.hierarchies)
  }));

  const columns = normalizeArray(raw?.columns).map((column) => ({
    ...column,
    tableName: column?.tableName || column?.table_name || context.tableName || null,
    name: normalizeText(column?.name),
    dataType: column?.dataType || column?.data_type || null,
    hidden: Boolean(column?.hidden),
    description: column?.description || null,
    displayFolder: column?.displayFolder || column?.display_folder || null,
    sourceColumn: column?.sourceColumn || column?.source_column || null
  }));

  const measures = normalizeArray(raw?.measures).map((measure) => ({
    ...measure,
    tableName: measure?.tableName || measure?.table_name || context.tableName || null,
    name: normalizeText(measure?.name),
    expression: measure?.expression || null,
    formatString: measure?.formatString || measure?.format_string || null,
    hidden: Boolean(measure?.hidden),
    description: measure?.description || null,
    displayFolder: measure?.displayFolder || measure?.display_folder || null
  }));

  const relationships = normalizeArray(raw?.relationships).map((relationship) => ({
    ...relationship,
    name: normalizeText(relationship?.name),
    fromTable: relationship?.fromTable || relationship?.from_table || null,
    fromColumn: relationship?.fromColumn || relationship?.from_column || null,
    toTable: relationship?.toTable || relationship?.to_table || null,
    toColumn: relationship?.toColumn || relationship?.to_column || null,
    isActive: relationship?.isActive ?? relationship?.is_active ?? null,
    cardinality: relationship?.cardinality || null
  }));

  const hierarchies = normalizeArray(raw?.hierarchies).map((hierarchy) => ({
    ...hierarchy,
    tableName: hierarchy?.tableName || hierarchy?.table_name || context.tableName || null,
    name: normalizeText(hierarchy?.name),
    hidden: Boolean(hierarchy?.hidden),
    description: hierarchy?.description || null,
    levels: normalizeArray(hierarchy?.levels)
  }));

  return {
    modelKey: normalizeText(raw?.modelKey || context.modelKey),
    source,
    generatedAt,
    tables,
    columns,
    measures,
    relationships,
    hierarchies,
    warnings
  };
}

function parseNormalizedJsonCatalog(json, context) {
  const normalized = normalizeBusinessCatalogShape(json, context);
  const hasCatalogContent =
    normalized.tables.length ||
    normalized.columns.length ||
    normalized.measures.length ||
    normalized.relationships.length ||
    normalized.hierarchies.length;

  return hasCatalogContent ? normalized : null;
}

function parseTmdlNodes(nodes, context = {}) {
  const tableMap = new Map();
  const columns = [];
  const measures = [];
  const relationships = [];
  const hierarchies = [];
  const warnings = [];

  walkNodes(nodes, (node, ancestors) => {
    const tableAncestor = [...ancestors].reverse().find((ancestor) => ancestor.type === "table");
    const tableNameFromAncestor = tableAncestor?.name || context.tableName || null;
    const description =
      normalizeText(node.properties.description) ||
      normalizeText(node.descriptionFromComment) ||
      null;
    const displayFolder = normalizeText(node.properties.displayfolder) || null;
    const hidden =
      node.properties.ishidden !== undefined
        ? Boolean(node.properties.ishidden)
        : node.properties.hidden !== undefined
          ? Boolean(node.properties.hidden)
          : false;

    if (node.type === "table") {
      const table = {
        name: node.name,
        description,
        hidden,
        displayFolder,
        columns: [],
        measures: [],
        hierarchies: [],
        sourceFile: node.filePath
      };
      tableMap.set(node.name.toLowerCase(), table);
      return;
    }

    if (node.type === "column") {
      const reference = parseReference(node.properties.sourcecolumn || node.properties.source_column);
      const tableName = tableNameFromAncestor || reference.table || context.tableName || null;
      const column = {
        name: node.name,
        tableName,
        dataType: node.properties.datatype || node.properties.data_type || null,
        hidden,
        description,
        displayFolder,
        expression: node.properties.expression || null,
        sourceColumn: reference.column || stripQuotes(node.properties.sourcecolumn || node.properties.source_column) || null,
        sourceTable: reference.table || null
      };
      columns.push(column);
      if (tableName) {
        const table = tableMap.get(String(tableName).toLowerCase());
        if (table) {
          table.columns.push(column);
        }
      }
      return;
    }

    if (node.type === "measure") {
      const tableName = tableNameFromAncestor || normalizeText(node.properties.table) || context.tableName || null;
      const measure = {
        name: node.name,
        tableName,
        expression: node.properties.expression || null,
        formatString: node.properties.formatstring || node.properties.format_string || null,
        hidden,
        description,
        displayFolder,
        dataType: node.properties.datatype || node.properties.data_type || null
      };
      measures.push(measure);
      if (tableName) {
        const table = tableMap.get(String(tableName).toLowerCase());
        if (table) {
          table.measures.push(measure);
        }
      }
      return;
    }

    if (node.type === "hierarchy") {
      const tableName = tableNameFromAncestor || context.tableName || null;
      const hierarchy = {
        name: node.name,
        tableName,
        hidden,
        description,
        displayFolder,
        levels: []
      };
      hierarchies.push(hierarchy);
      if (tableName) {
        const table = tableMap.get(String(tableName).toLowerCase());
        if (table) {
          table.hierarchies.push(hierarchy);
        }
      }
      return;
    }

    if (node.type === "level") {
      const hierarchyAncestor = [...ancestors].reverse().find((ancestor) => ancestor.type === "hierarchy");
      if (!hierarchyAncestor) {
        return;
      }
      const hierarchy = hierarchies.find(
        (item) =>
          item.name.toLowerCase() === hierarchyAncestor.name.toLowerCase() &&
          String(item.tableName || "").toLowerCase() ===
            String(tableNameFromAncestor || context.tableName || "").toLowerCase()
      );
      if (!hierarchy) {
        return;
      }
      const reference = parseReference(node.properties.column || node.properties.sourcecolumn);
      hierarchy.levels.push({
        name: node.name,
        hidden,
        description,
        displayFolder,
        ordinal: Number(node.properties.ordinal || 0),
        column: reference.column || stripQuotes(node.properties.column || node.properties.sourcecolumn) || null,
        tableName: reference.table || tableNameFromAncestor || context.tableName || null
      });
      return;
    }

    if (node.type === "relationship") {
      const fromColumnRef = parseReference(node.properties.fromcolumn || node.properties.from_column);
      const toColumnRef = parseReference(node.properties.tocolumn || node.properties.to_column);
      relationships.push({
        name: node.name,
        fromTable: fromColumnRef.table || node.properties.fromtable || node.properties.from_table || null,
        fromColumn: fromColumnRef.column || stripQuotes(node.properties.fromcolumn || node.properties.from_column) || null,
        toTable: toColumnRef.table || node.properties.totable || node.properties.to_table || null,
        toColumn: toColumnRef.column || stripQuotes(node.properties.tocolumn || node.properties.to_column) || null,
        isActive:
          node.properties.isactive !== undefined
            ? Boolean(node.properties.isactive)
            : node.properties.active !== undefined
              ? Boolean(node.properties.active)
              : null,
        cardinality: node.properties.cardinality || null,
        crossFilteringBehavior: node.properties.crossfilteringbehavior || null,
        hidden,
        description
      });
      return;
    }
  });

  for (const table of tableMap.values()) {
    if (table.description == null && table.descriptionFromComment) {
      table.description = table.descriptionFromComment;
    }
    delete table.descriptionFromComment;
  }

  return {
    modelKey: normalizeText(context.modelKey),
    source: context.source || "tmdl",
    generatedAt: new Date().toISOString(),
    tables: [...tableMap.values()],
    columns,
    measures,
    relationships,
    hierarchies,
    warnings
  };
}

export function parsePowerBiCatalogSource(text, options = {}) {
  const context = {
    modelKey: normalizeText(options.modelKey),
    tableName: normalizeText(options.tableName) || null,
    source: normalizeText(options.source) || "tmdl"
  };

  if (typeof text !== "string") {
    const normalized = parseNormalizedJsonCatalog(text, context);
    if (normalized) {
      return normalized;
    }
    return null;
  }

  const parsedJson = parseJsonCatalog(text);
  if (parsedJson) {
    const normalized = parseNormalizedJsonCatalog(parsedJson, context);
    if (normalized) {
      return normalized;
    }
  }

  const nodes = parseTmdlText(text, options.filePath || "");
  if (!nodes.length) {
    return null;
  }

  const parsed = parseTmdlNodes(nodes, {
    modelKey: context.modelKey,
    tableName: context.tableName,
    source: detectSourceFromPath(options.filePath || "")
  });

  if (
    parsed.tables.length ||
    parsed.columns.length ||
    parsed.measures.length ||
    parsed.relationships.length ||
    parsed.hierarchies.length
  ) {
    return parsed;
  }

  return null;
}

export function inferTmdlSourceFromPath(filePath) {
  return detectSourceFromPath(filePath);
}

export function inferTmdlTableFromPath(filePath) {
  return inferTableFromPath(filePath);
}

export function normalizePowerBiCatalogImport(catalog, context = {}) {
  return normalizeBusinessCatalogShape(catalog, context);
}
