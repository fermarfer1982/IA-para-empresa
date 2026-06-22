import {
  getCompanyDirectoryCacheCount,
  listCompanyDirectoryUsers as listCompanyDirectoryUsersFromCache,
  replaceCompanyDirectoryCache,
  searchCompanyDirectoryCache
} from "./reportsDb";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const GRAPH_TOKEN_URL_BASE = "https://login.microsoftonline.com";
const GRAPH_SELECT_FIELDS = [
  "id",
  "displayName",
  "mail",
  "userPrincipalName",
  "jobTitle",
  "department",
  "officeLocation",
  "businessPhones",
  "mobilePhone",
  "accountEnabled"
].join(",");

function normalizeConfigValue(value) {
  return String(value || "").trim();
}

export function getCompanyDirectoryConfig() {
  const tenantId = normalizeConfigValue(process.env.GRAPH_TENANT_ID);
  const clientId = normalizeConfigValue(process.env.GRAPH_CLIENT_ID);
  const clientSecret = normalizeConfigValue(process.env.GRAPH_CLIENT_SECRET);

  if (!tenantId || !clientId || !clientSecret) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret
  };
}

export function isCompanyDirectoryConfigured() {
  return Boolean(getCompanyDirectoryConfig());
}

function companyDirectoryError(message) {
  return new Error(message);
}

function mapGraphUser(user) {
  return {
    id: normalizeConfigValue(user?.id),
    display_name: normalizeConfigValue(user?.displayName),
    mail: normalizeConfigValue(user?.mail),
    user_principal_name: normalizeConfigValue(user?.userPrincipalName),
    job_title: normalizeConfigValue(user?.jobTitle),
    department: normalizeConfigValue(user?.department),
    office_location: normalizeConfigValue(user?.officeLocation),
    business_phone: Array.isArray(user?.businessPhones)
      ? normalizeConfigValue(user.businessPhones.find(Boolean))
      : normalizeConfigValue(user?.businessPhones),
    mobile_phone: normalizeConfigValue(user?.mobilePhone),
    account_enabled:
      user?.accountEnabled === null || user?.accountEnabled === undefined
        ? null
        : Boolean(user.accountEnabled),
    updated_at: new Date().toISOString()
  };
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
        body = { error: bodyText.slice(0, 500) };
      }
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getGraphAccessToken(config) {
  const tokenUrl = `${GRAPH_TOKEN_URL_BASE}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const payload = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
  });

  const response = await fetchJsonWithTimeout(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload
    },
    30000
  );

  if (!response.ok || !response.body?.access_token) {
    const detail =
      response.body?.error_description || response.body?.error || `HTTP ${response.status}`;
    throw companyDirectoryError(
      `No se pudo obtener token de Microsoft Graph. Revisa la app de Entra y los permisos read-only. Detalle: ${detail}`
    );
  }

  return response.body.access_token;
}

async function fetchGraphUsersPage(url, accessToken) {
  const response = await fetchJsonWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    30000
  );

  if (!response.ok) {
    const detail = response.body?.error?.message || response.body?.error || `HTTP ${response.status}`;
    throw companyDirectoryError(
      `Microsoft Graph devolvió un error al leer usuarios. Detalle: ${detail}`
    );
  }

  return response.body || {};
}

async function fetchActiveGraphUsers({ maxUsers = 1000 } = {}) {
  const config = getCompanyDirectoryConfig();
  if (!config) {
    throw companyDirectoryError(
      "Microsoft Graph Directory no está configurado. Define GRAPH_TENANT_ID, GRAPH_CLIENT_ID y GRAPH_CLIENT_SECRET."
    );
  }

  const accessToken = await getGraphAccessToken(config);
  const users = [];
  let nextUrl =
    `${GRAPH_BASE_URL}/users?` +
    new URLSearchParams({
      $select: GRAPH_SELECT_FIELDS,
      $top: "999"
    }).toString();

  while (nextUrl && users.length < maxUsers) {
    const page = await fetchGraphUsersPage(nextUrl, accessToken);
    for (const user of page.value || []) {
      users.push(mapGraphUser(user));
      if (users.length >= maxUsers) {
        break;
      }
    }
    nextUrl = page["@odata.nextLink"] || null;
  }

  return users;
}

function sortDirectoryUsersLocally(users = []) {
  return [...users].sort((left, right) => {
    const leftName = normalizeConfigValue(left?.display_name).toLowerCase();
    const rightName = normalizeConfigValue(right?.display_name).toLowerCase();
    if (leftName !== rightName) {
      return leftName.localeCompare(rightName, "es");
    }

    const leftSecondary = normalizeConfigValue(left?.mail || left?.user_principal_name).toLowerCase();
    const rightSecondary = normalizeConfigValue(right?.mail || right?.user_principal_name).toLowerCase();
    return leftSecondary.localeCompare(rightSecondary, "es");
  });
}

async function ensureCacheHasData() {
  const cachedCount = await getCompanyDirectoryCacheCount();
  if (cachedCount > 0) {
    return true;
  }

  if (!isCompanyDirectoryConfigured()) {
    return false;
  }

  await syncCompanyDirectory();
  return (await getCompanyDirectoryCacheCount()) > 0;
}

function normalizeQuery(query) {
  return normalizeConfigValue(query).slice(0, 120);
}

export async function syncCompanyDirectory(options = {}) {
  const maxUsers = Math.max(1, Math.min(Number(options.maxUsers) || 1000, 2000));
  const users = await fetchActiveGraphUsers({ maxUsers });
  await replaceCompanyDirectoryCache(users);

  return {
    ok: true,
    synced: users.length,
    users: sortDirectoryUsersLocally(await listCompanyDirectoryUsersFromCache({ limit: 50 }))
  };
}

export async function listCompanyDirectoryUsers(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
  const ready = await ensureCacheHasData();
  if (!ready) {
    throw companyDirectoryError(
      "La libreta corporativa no tiene caché disponible y Microsoft Graph no está configurado."
    );
  }

  return listCompanyDirectoryUsersFromCache({ limit });
}

export async function searchCompanyDirectoryUsers(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
  const query = normalizeQuery(options.q || options.query);
  const ready = await ensureCacheHasData();
  if (!ready) {
    throw companyDirectoryError(
      "La libreta corporativa no tiene caché disponible y Microsoft Graph no está configurado."
    );
  }

  if (!query) {
    return listCompanyDirectoryUsersFromCache({ limit });
  }

  return searchCompanyDirectoryCache(query, limit);
}

export async function syncCompanyDirectoryIfNeeded() {
  return ensureCacheHasData();
}
