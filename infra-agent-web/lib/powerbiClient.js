import { getPowerBiAccessToken } from "./powerbiAuth";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg";

function normalizeText(value) {
  return String(value || "").trim();
}

function sanitizePowerBiMessage(value) {
  if (value && typeof value === "object") {
    const nested =
      value?.error?.message ||
      value?.message ||
      value?.error_description ||
      value?.error ||
      JSON.stringify(value);
    return sanitizePowerBiMessage(nested);
  }

  return normalizeText(value)
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]")
    .replace(/access_token["']?\s*[:=]\s*["']?[^"'\s]+["']?/gi, "access_token=[redacted]")
    .replace(/client_secret\s*[:=]\s*[^,\s]+/gi, "client_secret=[redacted]");
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    const bodyText = await response.text();
    let body = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = { error: bodyText.slice(0, 1000) };
      }
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function buildPowerBiUrl(pathname) {
  const safePath = String(pathname || "").replace(/^\/+/, "");
  return `${POWERBI_API_BASE}/${safePath}`;
}

async function requestPowerBiJson(pathname, options = {}, timeoutMs = 30000) {
  const accessToken = await getPowerBiAccessToken();
  const body =
    options.body === undefined || options.body === null
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  const response = await fetchJsonWithTimeout(
    buildPowerBiUrl(pathname),
    {
      ...options,
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    },
    timeoutMs
  );

  if (!response.ok) {
    const detail =
      response.body?.error?.message ||
      response.body?.message ||
      response.body?.error_description ||
      response.body?.error ||
      `HTTP ${response.status}`;
    throw new Error(`Power BI devolvió un error. Detalle: ${sanitizePowerBiMessage(detail)}`);
  }

  return response.body || {};
}

export async function listWorkspaceReports(workspaceId) {
  return requestPowerBiJson(`groups/${encodeURIComponent(workspaceId)}/reports`);
}

export async function getWorkspaceDataset(workspaceId, datasetId) {
  return requestPowerBiJson(
    `groups/${encodeURIComponent(workspaceId)}/datasets/${encodeURIComponent(datasetId)}`
  );
}

export async function executeDatasetQuery(workspaceId, datasetId, daxQuery) {
  return requestPowerBiJson(
    `groups/${encodeURIComponent(workspaceId)}/datasets/${encodeURIComponent(datasetId)}/executeQueries`,
    {
      method: "POST",
      body: {
        queries: [
          {
            query: daxQuery
          }
        ],
        serializerSettings: {
          includeNulls: true
        }
      }
    },
    30000
  );
}
