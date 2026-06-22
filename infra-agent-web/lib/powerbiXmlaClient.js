import { randomUUID } from "node:crypto";
import sax from "sax";
import { getPowerBiAccessToken } from "./powerbiAuth";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg";
const XMLA_NAMESPACE = "urn:schemas-microsoft-com:xml-analysis";
const SOAP_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";

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

async function fetchJson(url, options = {}, timeoutMs = 30000) {
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

async function fetchText(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const bodyText = await response.text();
    return { ok: response.ok, status: response.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

function buildPowerBiUrl(pathname) {
  const safePath = String(pathname || "").replace(/^\/+/, "");
  return `${POWERBI_API_BASE}/${safePath}`;
}

function parsePowerBiWorkspaceName(workspaceUrl) {
  try {
    const url = new URL(workspaceUrl);
    return url.hostname || "";
  } catch {
    return "";
  }
}

function parseXmlaConnectionString(connectionString) {
  const parts = [];
  const connection = { locale: "1033" };
  String(connectionString || "")
    .split(";")
    .forEach((part) => {
      const split = part.split("=");
      if (split.length === 2) {
        parts.push(split);
      }
    });

  for (const [key, rawValue] of parts) {
    switch (key) {
      case "Data Source": {
        const url = new URL(rawValue);
        connection.dataSource = rawValue;
        connection.rootUrl = url.hostname;
        connection.workspaceName = url.pathname.split("/").filter(Boolean).pop() || "";
        connection.connectionType = url.protocol.replace(":", "");
        break;
      }
      case "Catalog":
        connection.catalog = rawValue;
        break;
      case "Password":
        connection.token = rawValue;
        break;
      case "LocaleIdentifier":
        connection.locale = rawValue;
        break;
      default:
        break;
    }
  }

  return connection;
}

async function getWorkspaceById(workspaceId) {
  const token = await getPowerBiAccessToken();
  const response = await fetchJson(
    buildPowerBiUrl(`groups/${encodeURIComponent(workspaceId)}`),
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    const detail =
      response.body?.error?.message ||
      response.body?.message ||
      response.body?.error_description ||
      response.body?.error ||
      `HTTP ${response.status}`;
    throw new Error(`Power BI devolvió un error al leer el workspace. Detalle: ${sanitizePowerBiMessage(detail)}`);
  }

  return response.body || {};
}

async function getWorkspaces(rootUrl, token) {
  const response = await fetchJson(`https://${rootUrl}/powerbi/databases/v201606/workspaces`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const detail =
      response.body?.error?.message ||
      response.body?.message ||
      response.body?.error_description ||
      response.body?.error ||
      `HTTP ${response.status}`;
    throw new Error(`Power BI devolvió un error al leer workspaces XMLA. Detalle: ${sanitizePowerBiMessage(detail)}`);
  }

  return Array.isArray(response.body?.value) ? response.body.value : [];
}

async function getWorkspace(connection) {
  const workspaces = await getWorkspaces(connection.rootUrl, connection.token);
  return (
    workspaces.find((workspace) => workspace?.name === connection.workspaceName) ||
    workspaces.find((workspace) => String(workspace?.name || "").toLowerCase() === String(connection.workspaceName || "").toLowerCase()) ||
    null
  );
}

async function resolveCluster(workspace, requestId) {
  const clusterHostname = parsePowerBiWorkspaceName(workspace.capacityUri);
  const response = await fetchJson(`https://${clusterHostname}/webapi/clusterResolve`, {
    method: "POST",
    headers: {
      "x-ms-parent-activity-id": requestId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      serverName: workspace.capacityObjectId,
      premiumPublicXmlaEndpoint: true
    })
  });

  if (!response.ok) {
    const detail =
      response.body?.error?.message ||
      response.body?.message ||
      response.body?.error_description ||
      response.body?.error ||
      `HTTP ${response.status}`;
    throw new Error(`Power BI devolvió un error al resolver el clúster XMLA. Detalle: ${sanitizePowerBiMessage(detail)}`);
  }

  return response.body || {};
}

async function generateAsToken(connection, workspace) {
  const response = await fetchJson(
    `https://${connection.rootUrl}/metadata/v201606/generateastoken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        capacityObjectId: workspace.capacityObjectId,
        workspaceObjectId: workspace.id
      })
    }
  );

  if (!response.ok) {
    const detail =
      response.body?.error?.message ||
      response.body?.message ||
      response.body?.error_description ||
      response.body?.error ||
      `HTTP ${response.status}`;
    throw new Error(`Power BI devolvió un error al generar el token XMLA. Detalle: ${sanitizePowerBiMessage(detail)}`);
  }

  const token = response.body?.Token || response.body?.token || "";
  if (!token) {
    throw new Error("Power BI no devolvió un token XMLA válido.");
  }

  return token;
}

function createEnvelope(header, body) {
  return `<Envelope xmlns="${SOAP_NAMESPACE}">
    <Header>${header}</Header>
    <Body>${body}</Body>
  </Envelope>`;
}

function getProperties(connection, requestId) {
  return `<PropertyList>
    <Catalog>${connection.catalog}</Catalog>
    <LocaleIdentifier>${connection.locale}</LocaleIdentifier>
    <DbpropMsmdActivityID>${requestId}</DbpropMsmdActivityID>
    <DbpropMsmdCurrentActivityID>${requestId}</DbpropMsmdCurrentActivityID>
    <DbpropMsmdRequestID>${requestId}</DbpropMsmdRequestID>
  </PropertyList>`;
}

function getBeginSession(connection, requestId) {
  const header = `
<BeginSession soap:mustUnderstand="1" xmlns:soap="${SOAP_NAMESPACE}" xmlns="${XMLA_NAMESPACE}" />
<Version Sequence="920" xmlns="http://schemas.microsoft.com/analysisservices/2003/engine/2" />
<NamespaceCompatibility xmlns="http://schemas.microsoft.com/analysisservices/2003/xmla" mustUnderstand="0"/>`;
  const body = `<Execute xmlns="${XMLA_NAMESPACE}">
    <Command><Statement /></Command>
    <Properties>${getProperties(connection, requestId)}</Properties>
  </Execute>`;
  return createEnvelope(header, body);
}

function getEndSession(connection, requestId, sessionId) {
  const header = `
<EndSession soap:mustUnderstand="1" SessionId="${sessionId}" xmlns:soap="${SOAP_NAMESPACE}" xmlns="${XMLA_NAMESPACE}" />`;
  const body = `<Execute xmlns="${XMLA_NAMESPACE}">
    <Command><Statement /></Command>
    <Properties>${getProperties(connection, requestId)}</Properties>
  </Execute>`;
  return createEnvelope(header, body);
}

function getCommandSession(connection, requestId, sessionId, command) {
  const header = `<XA:Session soap:mustUnderstand="1" SessionId="${sessionId}" xmlns:soap="${SOAP_NAMESPACE}" xmlns:XA="${XMLA_NAMESPACE}" />`;
  return createEnvelope(header, command);
}

function buildDiscoverRequest(connection, requestId, requestType, restrictions = {}) {
  const restrictionEntries = Object.entries(restrictions)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `<${key}>${String(value)}</${key}>`)
    .join("");

  return `<Discover xmlns="${XMLA_NAMESPACE}">
    <RequestType>${requestType}</RequestType>
    <Restrictions>
      <RestrictionList>${restrictionEntries}</RestrictionList>
    </Restrictions>
    <Properties>${getProperties(connection, requestId)}</Properties>
  </Discover>`;
}

function determineQueryType(query) {
  const queryString = String(query || "");
  if (queryString.startsWith("<")) {
    if (queryString.toLowerCase().startsWith("<discover")) {
      return "discover";
    }
    return "other";
  }
  return "statement";
}

async function executeXmlaRequest({ url, token, body, headers = {}, timeoutMs = 30000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/xml",
        "Content-Length": Buffer.byteLength(body || "", "utf8"),
        ...(headers || {})
      },
      body
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `XMLA devolvió un error HTTP ${response.status}. Detalle: ${sanitizePowerBiMessage(bodyText)}`
      );
    }
    return bodyText;
  } finally {
    clearTimeout(timer);
  }
}

function parseTextValue(dataType, text) {
  const normalized = String(text ?? "").trim();
  switch (String(dataType || "").toLowerCase()) {
    case "int":
    case "integer":
    case "long":
      return Number.parseInt(normalized, 10);
    case "double":
    case "float":
    case "decimal":
      return Number.parseFloat(normalized);
    case "boolean":
      return normalized !== "false" && normalized !== "0";
    default:
      return normalized;
  }
}

function parseRowSet(xmlText) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const schema = [];
    let row = {};
    let columnName = "";
    let isSchema = false;
    let isRows = false;
    let isError = false;

    const parser = sax.parser(false, {
      trim: true,
      normalize: true,
      lowercase: true,
      xmlns: true
    });

    parser.onopentag = (tag) => {
      const name = tag?.name || "";
      if (name === "soap:fault") {
        isError = true;
      }
      if (
        name === "xsd:complextype" &&
        tag.attributes &&
        tag.attributes.name &&
        tag.attributes.name.value === "row"
      ) {
        isSchema = true;
      }
      if (
        isSchema &&
        name === "xsd:element" &&
        tag.attributes &&
        (tag.attributes.name || tag.attributes.type)
      ) {
        schema.push({
          friendlyName: tag.attributes["sql:field"]?.value || tag.attributes.name.value,
          columnName: String(tag.attributes.name.value).toLowerCase(),
          dataType: String(tag.attributes.type?.value || "").replace(/^xsd:/i, "")
        });
      }
      if (isError && name === "error") {
        const err = tag.attributes?.description?.value || "Error XMLA";
        const errCode = tag.attributes?.errorcode?.value || "";
        reject(new Error(`XMLA Error: ${err}${errCode ? ` (${errCode})` : ""}`));
      }
      if (!isError && name === "row") {
        isRows = true;
      }
      if (isRows) {
        columnName = name;
      }
    };

    parser.ontext = (text) => {
      if (!isRows || isError || !columnName) {
        return;
      }
      const column = schema.find((col) => col.columnName === columnName);
      if (!column) {
        return;
      }
      row[column.friendlyName] = parseTextValue(column.dataType, text);
    };

    parser.onclosetag = (tag) => {
      if (tag === "xsd:complextype" && isSchema) {
        isSchema = false;
      }
      if (tag === "row") {
        rows.push(row);
        row = {};
        isSchema = false;
      }
      if (tag === "root" && !isRows) {
        rows.push({});
        row = {};
        isSchema = false;
        schema.length = 0;
      }
    };

    parser.onerror = (err) => reject(err);
    parser.onend = () => resolve(rows);

    parser.write(xmlText).close();
  });
}

export async function createXmlaConnection({ workspaceId, workspaceName, datasetName }) {
  const aadToken = await getPowerBiAccessToken();
  const connectionString = [
    `Data Source=${process.env.POWERBI_XMLA_SERVER_PREFIX || "powerbi://api.powerbi.com/v1.0/myorg"}/${workspaceName}`,
    `Catalog=${datasetName}`,
    `Password=${aadToken}`,
    "LocaleIdentifier=1033"
  ].join(";");
  const connection = parseXmlaConnectionString(connectionString);
  connection.workspaceId = workspaceId;
  connection.datasetName = datasetName;
  connection.aadToken = aadToken;
  return connection;
}

export async function openXmlaSession(connection) {
  if (!connection?.workspaceName || !connection?.catalog || !connection?.token) {
    throw new Error("La conexión XMLA no está completa.");
  }

  const requestId = randomUUID();
  const workspace = await getWorkspace(connection);
  if (!workspace) {
    throw new Error(
      "Workspace is not in Premium/Fabric/PPU capacity or XMLA endpoint is not enabled"
    );
  }
  if (!workspace.capacityUri) {
    throw new Error(
      "Workspace is not in Premium/Fabric/PPU capacity or XMLA endpoint is not enabled"
    );
  }

  const cluster = await resolveCluster(workspace, requestId);
  if (!cluster?.clusterFQDN || !cluster?.coreServerName) {
    throw new Error("No se pudo resolver el clúster XMLA de Power BI.");
  }

  const xmlaToken = await generateAsToken(connection, workspace);
  const xmlaConnection = {
    ...connection,
    workspace,
    cluster,
    token: xmlaToken,
    requestId,
    sessionId: null
  };

  const beginSessionEnvelope = getBeginSession(xmlaConnection, requestId);
  const beginResult = await executeXmlaRequest({
    url: `https://${cluster.clusterFQDN}/webapi/xmla`,
    token: xmlaToken,
    body: beginSessionEnvelope,
    headers: {
      "X-AS-AcquireTokenStats": "AppName=",
      "x-ms-parent-activity-id": requestId,
      "x-ms-xmlaserver": cluster.coreServerName,
      "x-ms-xmlacaps-negotiation-flags": "0,0,0,0,0",
      "x-ms-accepts-continuations": "1",
      "x-ms-xmladedicatedconnection": "0",
      "x-ms-request-registration-id": randomUUID(),
      "x-ms-round-trip-id": "0"
    }
  });

  const sessionMatch = beginResult.match(/sessionid="([^"]+)"/i);
  if (!sessionMatch?.[1]) {
    throw new Error("XMLA no devolvió un SessionId válido.");
  }
  xmlaConnection.sessionId = sessionMatch[1];
  return xmlaConnection;
}

export async function closeXmlaSession(connection) {
  if (!connection?.sessionId || !connection?.cluster?.clusterFQDN) {
    return;
  }

  try {
    const endSessionEnvelope = getEndSession(connection, connection.requestId, connection.sessionId);
    await executeXmlaRequest({
      url: `https://${connection.cluster.clusterFQDN}/webapi/xmla`,
      token: connection.token,
      body: endSessionEnvelope,
      headers: {
        "X-AS-AcquireTokenStats": "AppName=",
        "x-ms-parent-activity-id": connection.requestId,
        "x-ms-xmlaserver": connection.cluster.coreServerName,
        "x-ms-xmlacaps-negotiation-flags": "0,0,0,0,0",
        "x-ms-accepts-continuations": "1",
        "x-ms-xmladedicatedconnection": "0",
        "x-ms-request-registration-id": randomUUID(),
        "x-ms-round-trip-id": "0"
      }
    });
  } catch {
    // Best effort close.
  }
}

export async function executeXmlaDiscover(connection, requestType, restrictions = {}) {
  if (!connection?.sessionId) {
    throw new Error("La sesión XMLA no está abierta.");
  }

  const requestId = randomUUID();
  const discoverEnvelope = getCommandSession(
    connection,
    requestId,
    connection.sessionId,
    buildDiscoverRequest(connection, requestId, requestType, restrictions)
  );
  const result = await executeXmlaRequest({
    url: `https://${connection.cluster.clusterFQDN}/webapi/xmla`,
    token: connection.token,
    body: discoverEnvelope,
    headers: {
      "X-AS-AcquireTokenStats": "AppName=",
      "x-ms-parent-activity-id": requestId,
      "x-ms-xmlaserver": connection.cluster.coreServerName,
      "x-ms-xmlacaps-negotiation-flags": "0,0,0,0,0",
      "x-ms-accepts-continuations": "1",
      "x-ms-xmladedicatedconnection": "0",
      "x-ms-request-registration-id": randomUUID(),
      "x-ms-round-trip-id": "0"
    }
  });
  return parseRowSet(result);
}

export async function detectXmlaCatalogSupport({ workspaceId, workspaceName, datasetName }) {
  const connection = await createXmlaConnection({ workspaceId, workspaceName, datasetName });
  try {
    const session = await openXmlaSession(connection);
    try {
      return {
        ok: true,
        available: true,
        session
      };
    } finally {
      await closeXmlaSession(session);
    }
  } catch (error) {
    return {
      ok: false,
      available: false,
      error: sanitizePowerBiMessage(error?.message || error)
    };
  }
}

export async function getWorkspaceDetailsById(workspaceId) {
  return getWorkspaceById(workspaceId);
}
