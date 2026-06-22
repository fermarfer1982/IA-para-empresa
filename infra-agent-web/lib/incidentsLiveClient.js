import fs from "fs";
import { requestJson } from "./httpJson";

const INCIDENTS_MCP_ENV = "/etc/zabbix-codex/incidents-ti-mcp.env";

function readEnvFile(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .reduce((env, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return env;
        }
        const index = trimmed.indexOf("=");
        if (index === -1) {
          return env;
        }
        const key = trimmed.slice(0, index).trim();
        const value = trimmed
          .slice(index + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        env[key] = value;
        return env;
      }, {});
  } catch {
    return {};
  }
}

function mcpBaseUrlFromEnv(env, defaultPort) {
  const host = env.MCP_BIND_HOST || "127.0.0.1";
  const port = env.MCP_BIND_PORT || defaultPort;
  return `http://${host}:${port}`;
}

function text(value) {
  return String(value || "").trim();
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIncidentId(value) {
  const textValue = String(value || "").trim();
  const numeric = Number.parseInt(textValue.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
}

function normalizeIncident(incident) {
  if (!incident || typeof incident !== "object") {
    return null;
  }

  const fieldsRaw = incident.fields_raw && typeof incident.fields_raw === "object" ? incident.fields_raw : {};
  const listItemRaw = incident.list_item_raw && typeof incident.list_item_raw === "object" ? incident.list_item_raw : {};
  const createdByUser = listItemRaw?.createdBy?.user || incident?.createdBy?.user || {};
  const fields = {
    ...fieldsRaw,
    ...(incident.fields && typeof incident.fields === "object" ? incident.fields : {})
  };
  const creatorName = firstText(
    incident.creator_name,
    incident.created_by_name,
    incident.createdByName,
    fields.CreadoPorNombre,
    fields.creador,
    fields.createdByDisplayName,
    createdByUser.displayName,
    incident.Author?.displayName,
    incident.author?.displayName,
    incident.requester
  );
  const creatorEmail = firstText(
    incident.creator_email,
    incident.created_by_email,
    incident.createdByEmail,
    fields.CreadoPorEmail,
    fields.createdByEmail,
    createdByUser.email,
    incident.Author?.email,
    incident.author?.email
  );

  return {
    id: text(incident.id),
    title: text(incident.title),
    description: text(incident.description),
    status: text(incident.status),
    created: text(incident.created),
    modified: text(incident.modified),
    requester: text(incident.requester),
    created_by_name: creatorName,
    created_by_email: creatorEmail,
    creator_name: creatorName,
    creator_email: creatorEmail,
    assigned_to: text(incident.assigned_to),
    modified_by: text(incident.modified_by),
    priority: text(incident.priority),
    category: text(incident.category),
    affected_system: text(incident.affected_system),
    location: text(incident.location),
    comments: text(incident.comments),
    closed_at: text(incident.closed_at),
    url: text(incident.url)
  };
}

function hasCreatorDetails(incident) {
  return Boolean(text(incident?.creator_name || incident?.created_by_name || incident?.requester || "")) || Boolean(text(incident?.creator_email || incident?.created_by_email || ""));
}

async function enrichIncidentCreatorDetails(incident) {
  if (!incident || !incident.id || hasCreatorDetails(incident)) {
    return incident || null;
  }

  const detailed = await getIncidentByIdLive(incident.id);
  if (detailed.ok && detailed.incident) {
    return {
      ...incident,
      ...detailed.incident,
      creator_name: detailed.incident.creator_name || detailed.incident.created_by_name || incident.creator_name || incident.created_by_name || incident.requester || "",
      created_by_name: detailed.incident.created_by_name || detailed.incident.creator_name || incident.created_by_name || incident.creator_name || incident.requester || "",
      creator_email: detailed.incident.creator_email || detailed.incident.created_by_email || incident.creator_email || incident.created_by_email || "",
      created_by_email: detailed.incident.created_by_email || detailed.incident.creator_email || incident.created_by_email || incident.creator_email || ""
    };
  }

  return incident;
}

async function enrichIncidentListCreatorDetails(incidents, limit = 10) {
  const list = Array.isArray(incidents) ? incidents.slice(0, Math.max(0, limit)) : [];
  return Promise.all(list.map((incident) => enrichIncidentCreatorDetails(incident)));
}

function coerceIncidentArray(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.incidents)) {
    return payload.incidents;
  }

  if (Array.isArray(payload.latest)) {
    return payload.latest;
  }

  if (Array.isArray(payload.urgent_candidates)) {
    return payload.urgent_candidates;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (Array.isArray(payload.value)) {
    return payload.value;
  }

  return [];
}

function sortByCreatedThenIdDesc(incidents) {
  return [...(incidents || [])].sort((a, b) => {
    const aCreated = parseDate(a?.created) || parseDate(a?.modified) || new Date(0);
    const bCreated = parseDate(b?.created) || parseDate(b?.modified) || new Date(0);
    const timeDiff = bCreated.getTime() - aCreated.getTime();
    if (timeDiff) {
      return timeDiff;
    }
    return parseIncidentId(b?.id) - parseIncidentId(a?.id);
  });
}

function sortByModifiedThenIdDesc(incidents) {
  return [...(incidents || [])].sort((a, b) => {
    const aModified = parseDate(a?.modified) || parseDate(a?.created) || new Date(0);
    const bModified = parseDate(b?.modified) || parseDate(b?.created) || new Date(0);
    const timeDiff = bModified.getTime() - aModified.getTime();
    if (timeDiff) {
      return timeDiff;
    }
    return parseIncidentId(b?.id) - parseIncidentId(a?.id);
  });
}

function sortIncidentsByOrdering(incidents, ordering = "created desc / id desc") {
  const normalizedOrdering = String(ordering || "").toLowerCase();
  if (normalizedOrdering.includes("modified")) {
    return sortByModifiedThenIdDesc(incidents);
  }
  return sortByCreatedThenIdDesc(incidents);
}

function extractMcpText(result) {
  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  const content = result.content || result.result?.content;
  if (Array.isArray(content)) {
    return content.map((entry) => entry?.text || "").filter(Boolean).join("\n");
  }

  if (typeof result.text === "string") {
    return result.text;
  }

  return "";
}

function tryParseJson(textValue) {
  const raw = text(textValue);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function callMcpTool(toolName, args = {}) {
  const env = readEnvFile(INCIDENTS_MCP_ENV);
  const token = env.MCP_SHARED_TOKEN;
  const baseUrl = mcpBaseUrlFromEnv(env, "8766");

  if (!baseUrl || !token) {
    return { ok: false, error: "MCP IncidenciasTI no configurado." };
  }

  const response = await requestJson(`${baseUrl.replace(/\/$/, "")}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    timeoutMs: 25000,
    body: {
      jsonrpc: "2.0",
      id: `${toolName}-${Date.now()}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { ok: false, error: `HTTP ${response.statusCode}` };
  }

  if (response.body?.error) {
    return {
      ok: false,
      error: response.body.error?.message || "Error MCP IncidenciasTI."
    };
  }

  const rawText = extractMcpText(response.body?.result);
  const parsed = tryParseJson(rawText);
  return {
    ok: true,
    raw: rawText,
    data: parsed || rawText
  };
}

async function getRecentIncidentPayload({ days = 365, limit = 500 } = {}) {
  const result = await callMcpTool("get_recent_incidents", {
    days: Math.max(0, Math.min(Number(days) || 365, 365)),
    limit: Math.max(1, Math.min(Number(limit) || 500, 500))
  });

  if (!result.ok) {
    return result;
  }

  const incidents = coerceIncidentArray(result.data).map(normalizeIncident).filter(Boolean);
  return {
    ok: true,
    incidents
  };
}

export function getIncidentCreatorContact(incident) {
  const creatorName = text(
    incident?.creator_name ||
      incident?.created_by_name ||
      incident?.requester ||
      ""
  );
  const creatorEmail = text(incident?.creator_email || incident?.created_by_email || "");
  return {
    creator_name: creatorName || "No informado",
    creator_email: creatorEmail,
    creator_email_label: creatorEmail || "No informado",
    can_use_email: Boolean(creatorEmail),
    source_field: incident?.creator_email
      ? "CreadoPorEmail"
      : incident?.creator_name
        ? "CreadoPorNombre"
        : "No informado"
  };
}

export async function getLatestCreatedIncident() {
  const payload = await getRecentIncidentPayload({ days: 365, limit: 500 });
  if (!payload.ok) {
    return payload;
  }

  const incidents = sortByCreatedThenIdDesc(payload.incidents);
  const incident = await enrichIncidentCreatorDetails(incidents[0] || null);
  return {
    ok: true,
    ordering: "created desc / id desc",
    incident,
    incidents
  };
}

export async function getLatestModifiedIncident() {
  const payload = await getRecentIncidentPayload({ days: 365, limit: 500 });
  if (!payload.ok) {
    return payload;
  }

  const incidents = sortByModifiedThenIdDesc(payload.incidents);
  const incident = await enrichIncidentCreatorDetails(incidents[0] || null);
  return {
    ok: true,
    ordering: "modified desc / id desc",
    incident,
    incidents
  };
}

export async function getRecentIncidents({ days = 30, limit = 25 } = {}) {
  const payload = await getRecentIncidentPayload({ days, limit });
  if (!payload.ok) {
    return payload;
  }

  const incidents = await enrichIncidentListCreatorDetails(sortByCreatedThenIdDesc(payload.incidents).slice(0, limit), limit);

  return {
    ok: true,
    ordering: "created desc / id desc",
    incidents
  };
}

export async function getRecentIncidentsLive({ limit = 25, ordering = "created desc / id desc", days = 365 } = {}) {
  const payload = await getRecentIncidentPayload({ days, limit: Math.max(1, Math.min(Number(limit) || 25, 500)) });
  if (!payload.ok) {
    return payload;
  }

  const incidents = await enrichIncidentListCreatorDetails(sortIncidentsByOrdering(payload.incidents, ordering), limit);
  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    ordering: String(ordering || "created desc / id desc"),
    incidents: incidents.slice(0, limit)
  };
}

export async function getIncidentByIdLive(incidentId) {
  return getIncidentById(incidentId);
}

export async function getIncidentNeighbors({ incidentId, ordering = "created desc / id desc", limit = 500 } = {}) {
  const currentId = text(incidentId);
  if (!currentId) {
    return { ok: false, error: "incidentId es obligatorio." };
  }

  const recent = await getRecentIncidentsLive({ limit, ordering });
  if (!recent.ok) {
    return recent;
  }

  let incidents = sortIncidentsByOrdering(recent.incidents, ordering);
  let index = incidents.findIndex((incident) => text(incident?.id) === currentId);
  let current = index >= 0 ? incidents[index] : null;

  if (!current) {
    const byId = await getIncidentByIdLive(currentId);
    if (byId.ok && byId.incident) {
      current = byId.incident;
      incidents = sortIncidentsByOrdering([...incidents, current], ordering);
      index = incidents.findIndex((incident) => text(incident?.id) === currentId);
    }
  }

  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    ordering: recent.ordering || ordering,
    current: await enrichIncidentCreatorDetails(current),
    previous: await enrichIncidentCreatorDetails(index >= 0 && index < incidents.length - 1 ? incidents[index + 1] : null),
    next: await enrichIncidentCreatorDetails(index > 0 ? incidents[index - 1] : null)
  };
}

export async function getPreviousIncident({ incidentId, ordering = "created desc / id desc" } = {}) {
  const neighbors = await getIncidentNeighbors({ incidentId, ordering });
  if (!neighbors.ok) {
    return neighbors;
  }
  return {
    ok: true,
    live: true,
    source: neighbors.source,
    ordering: neighbors.ordering,
    current: neighbors.current,
    incident: neighbors.previous || null
  };
}

export async function getNextIncident({ incidentId, ordering = "created desc / id desc" } = {}) {
  const neighbors = await getIncidentNeighbors({ incidentId, ordering });
  if (!neighbors.ok) {
    return neighbors;
  }
  return {
    ok: true,
    live: true,
    source: neighbors.source,
    ordering: neighbors.ordering,
    current: neighbors.current,
    incident: neighbors.next || null
  };
}

export async function searchIncidentsByCreator({ query, limit = 25 } = {}) {
  const q = text(query);
  if (!q) {
    return { ok: false, error: "query es obligatorio." };
  }

  const recent = await getRecentIncidentsLive({ limit: Math.max(limit, 100), ordering: "created desc / id desc" });
  if (!recent.ok) {
    return recent;
  }

  const normalizedQuery = q.toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 3);
  const items = (recent.incidents || []).filter((incident) => {
    const creatorName = text(incident.creator_name || incident.requester).toLowerCase();
    const creatorEmail = text(incident.creator_email).toLowerCase();
    const haystack = [
      incident.title,
      incident.description,
      incident.requester,
      incident.creator_name,
      incident.creator_email,
      incident.affected_system,
      incident.location
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const creatorMatch =
      creatorName.includes(normalizedQuery) ||
      creatorEmail.includes(normalizedQuery) ||
      normalizedQuery.includes(creatorName) ||
      normalizedQuery.includes(creatorEmail);

    const tokenMatch = tokens.some((token) => creatorName.includes(token) || creatorEmail.includes(token));

    return creatorMatch || tokenMatch || haystack.includes(normalizedQuery);
  });

  const enrichedItems = await enrichIncidentListCreatorDetails(sortByCreatedThenIdDesc(items).slice(0, limit), limit);

  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    ordering: "created desc / id desc",
    creator_query: q,
    incidents: enrichedItems
  };
}

export async function getOpenIncidents({ limit = 25 } = {}) {
  const result = await callMcpTool("get_open_incidents", {
    limit: Math.max(1, Math.min(Number(limit) || 25, 200))
  });

  if (!result.ok) {
    return result;
  }

  const incidents = await enrichIncidentListCreatorDetails(
    sortByCreatedThenIdDesc(coerceIncidentArray(result.data).map(normalizeIncident).filter(Boolean)),
    limit
  );
  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    ordering: "created desc / id desc",
    incidents: incidents.slice(0, limit)
  };
}

export async function getUrgentIncidents({ limit = 25 } = {}) {
  const summary = await callMcpTool("get_incidents_summary", {
    limit: Math.max(1, Math.min(Number(limit) || 25, 100))
  });

  if (!summary.ok) {
    return summary;
  }

  const urgent = coerceIncidentArray(summary.data).map(normalizeIncident).filter(Boolean);
  const incidents = await enrichIncidentListCreatorDetails(sortByCreatedThenIdDesc(urgent).slice(0, limit), limit);

  if (incidents.length) {
    return {
      ok: true,
      live: true,
      source: "IncidenciasTI / SharePoint",
      ordering: "created desc / id desc",
      incidents,
      total: typeof summary.data?.total === "number" ? summary.data.total : incidents.length,
      counts: summary.data?.counts || null
    };
  }

  const open = await getOpenIncidents({ limit });
  if (!open.ok) {
    return open;
  }

  const fallback = await enrichIncidentListCreatorDetails(
    open.incidents.filter((incident) =>
    ["critical", "high", "alta", "critica", "urgente"].some((token) =>
      `${incident.priority} ${incident.title} ${incident.description} ${incident.category} ${incident.affected_system} ${incident.comments}`
        .toLowerCase()
        .includes(token)
    )
  ),
    limit
  );

  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    ordering: "created desc / id desc",
    incidents: fallback.slice(0, limit),
    total: fallback.length,
    counts: summary.data?.counts || null
  };
}

export async function getIncidentById(incidentId) {
  const id = text(incidentId);
  if (!id) {
    return { ok: false, error: "incident_id es obligatorio." };
  }

  const result = await callMcpTool("get_incident_by_id", {
    incident_id: id
  });

  if (!result.ok) {
    return result;
  }

  const incident = normalizeIncident(result.data?.incident || result.data || null);
  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    incident
  };
}

export async function searchIncidents(query, { limit = 25 } = {}) {
  const q = text(query);
  if (!q) {
    return { ok: false, error: "query es obligatorio." };
  }

  const result = await callMcpTool("search_incidents", {
    query: q,
    limit: Math.max(1, Math.min(Number(limit) || 25, 500))
  });

  if (!result.ok) {
    return result;
  }

  const incidents = sortByCreatedThenIdDesc(coerceIncidentArray(result.data).map(normalizeIncident).filter(Boolean));
  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    query: q,
    ordering: "created desc / id desc",
    incidents: incidents.slice(0, limit)
  };
}

export async function getIncidentsRelatedToAsset(assetName, { limit = 25 } = {}) {
  const asset = text(assetName);
  if (!asset) {
    return { ok: false, error: "asset_name es obligatorio." };
  }

  const result = await callMcpTool("get_incidents_related_to_asset", {
    asset_name: asset,
    limit: Math.max(1, Math.min(Number(limit) || 25, 500))
  });

  if (!result.ok) {
    return result;
  }

  const incidents = sortByCreatedThenIdDesc(coerceIncidentArray(result.data).map(normalizeIncident).filter(Boolean));
  return {
    ok: true,
    live: true,
    source: "IncidenciasTI / SharePoint",
    asset_name: asset,
    ordering: "created desc / id desc",
    incidents: incidents.slice(0, limit)
  };
}
