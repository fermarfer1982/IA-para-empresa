const OPERATIONS_QUERY_URL = "/api/ops/query";

function normalizeText(value) {
  return String(value || "").trim();
}

function stripAccents(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeMessage(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, terms) {
  const normalized = normalizeMessage(text);
  return terms.some((term) => normalized.includes(normalizeMessage(term)));
}

function extractCreatorQuery(question) {
  const source = normalizeText(question);
  if (!source) {
    return "";
  }

  const patterns = [
    /(?:incidencias?|tickets?|última incidencia|ultima incidencia|último ticket|ultimo ticket|incidencias abiertas|incidencias en curso)\s+(?:creadas?|creado|de|por)\s+(.+)/i,
    /(?:última incidencia de|ultima incidencia de|último ticket de|ultimo ticket de|incidencias de|tickets de)\s+(.+)/i,
    /(?:creadas? por|creado por|de)\s+(.+)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      const candidate = normalizeText(match[1]).replace(/^(la|el|los|las|esta|este|esa|ese|por|de)\s+/i, "");
      if (candidate && candidate.length >= 2 && !/^(esta|este|aqui|aquí|la|el|esta incidencia|este ticket)$/i.test(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function isCreatorDirectSendRequest(question) {
  const normalized = normalizeMessage(question);
  return (
    hasAny(normalized, [
      "envia directamente un correo al creador",
      "envia directamente el email al creador",
      "envia directamente el correo al creador",
      "manda directamente el email al creador",
      "manda directamente el correo al creador",
      "envialo ya sin revisar",
      "mandalo ya sin revisar",
      "manda el correo directamente",
      "envia el correo directamente",
      "envia directamente",
      "manda directamente"
    ]) ||
    ((hasAny(normalized, ["envia", "manda", "mandalo", "envialo"]) || normalized.includes("direct")) &&
      hasAny(normalized, ["creador", "creadora"]))
  );
}

function isFirewallStatusRequest(question) {
  const normalized = normalizeMessage(question);
  return hasAny(normalized, [
    "firewall",
    "firewalls",
    "pfsense",
    "fortigate",
    "fortinet",
    "mikrotik",
    "sonicwall",
    "checkpoint",
    "palo alto",
    "red perimetral",
    "estado de los firewalls",
    "que firewalls tenemos",
    "qué firewalls tenemos",
    "problemas en firewalls",
    "huecos de monitorizacion en firewalls",
    "huecos de monitorización en firewalls",
    "firewall de almeria",
    "firewall de la plana",
    "firewall de gallarza",
    "firewall almeria",
    "firewall gallarza",
    "firewall la plana"
  ]);
}

function buildUnsupportedResponse(reason) {
  const base = normalizeText(reason);
  if (/margen|rentabil|beneficio/i.test(base)) {
    return "Todavía no puedo consultar margen o rentabilidad. Ahora puedo consultar IncidenciasTI o Zabbix por separado y, si me lo pides explícitamente, una posible correlación con evidencia.";
  }
  if (/vac[ií]a/i.test(base)) {
    return "La pregunta está vacía. Escribe una pregunta corta sobre incidencias o monitorización.";
  }
  return (
    base ||
    "Todavía no puedo responder eso con seguridad. Puedo consultar IncidenciasTI o Zabbix por separado y, si me lo pides explícitamente, hacer una posible correlación con evidencia."
  );
}

export function detectOpsIntent(message) {
  const normalized = normalizeMessage(message);

  if (!normalized) {
    return { matched: false, kind: "unknown", reason: "La pregunta está vacía." };
  }

  if (isCreatorDirectSendRequest(message)) {
    return { matched: true, kind: "incidents_user", subkind: "creator_direct_send_request" };
  }

  if (isFirewallStatusRequest(message)) {
    return { matched: true, kind: "firewall_status" };
  }

  const creatorQuery = extractCreatorQuery(message);
  if (creatorQuery && hasAny(normalized, ["incidencia", "incidencias", "ticket", "tickets", "abiertas", "abierto", "abierta"])) {
    return { matched: true, kind: "incidents_user", subkind: "creator_search", creatorQuery };
  }

  if (
    hasAny(normalized, [
      "cruza zabbix e incidenciasti",
      "cruza zebra con zabbix",
      "relaciona incidencias con problemas",
      "busca si esta incidencia puede estar relacionada",
      "posible relacion",
      "posible relación"
    ]) ||
    (normalized.includes("correl") && (normalized.includes("zabbix") || normalized.includes("incid")))
  ) {
    return { matched: true, kind: "correlation_requested" };
  }

  if (
    hasAny(normalized, [
      "qué es lo más urgente",
      "que es lo mas urgente",
      "resumen operativo",
      "estado general",
      "riesgos críticos",
      "riesgos criticos"
    ])
  ) {
    return { matched: true, kind: "combined_summary" };
  }

  if (
    hasAny(normalized, [
      "última incidencia modificada",
      "ultima incidencia modificada",
      "última actualizada",
      "ultima actualizada",
      "última modificada",
      "ultima modificada"
    ])
  ) {
    return { matched: true, kind: "incidents_user", subkind: "latest_modified" };
  }

  if (
    hasAny(normalized, [
      "última incidencia",
      "ultima incidencia",
      "último ticket",
      "ultimo ticket",
      "incidencia más reciente",
      "incidencia mas reciente",
      "última incidencia de usuario",
      "ultima incidencia de usuario",
      "última incidencia ti",
      "ultima incidencia ti"
    ])
  ) {
    return { matched: true, kind: "incidents_user", subkind: "latest_created" };
  }

  if (
    hasAny(normalized, [
      "incidencias abiertas",
      "tickets abiertos",
      "incidencias en curso",
      "mis incidencias",
      "pendientes de soporte",
      "incidencias pendientes"
    ])
  ) {
    return { matched: true, kind: "incidents_user", subkind: "open" };
  }

  if (
    hasAny(normalized, [
      "la anterior a la que estamos viendo",
      "incidencia anterior",
      "anterior a esta",
      "dime la anterior",
      "la anterior",
      "anterior incidencia",
      "anterior modificada",
      "la anterior modificada"
    ])
  ) {
    return {
      matched: true,
      kind: "incidents_user",
      subkind: hasAny(normalized, ["anterior modificada", "la anterior modificada"])
        ? "previous_modified"
        : "previous"
    };
  }

  if (
    hasAny(normalized, [
      "la siguiente",
      "siguiente incidencia",
      "dime la siguiente",
      "siguiente a esta",
      "siguiente modificada",
      "la siguiente modificada"
    ])
  ) {
    return {
      matched: true,
      kind: "incidents_user",
      subkind: hasAny(normalized, ["siguiente modificada", "la siguiente modificada"])
        ? "next_modified"
        : "next"
    };
  }

  if (
    hasAny(normalized, [
      "último problema",
      "ultimo problema",
      "alertas activas",
      "problemas activos",
      "problemas zabbix",
      "monitorización",
      "monitorizacion",
      "host caído",
      "host caido",
      "latencia",
      "disco",
      "nas",
      "backup",
      "ups",
      "sai"
    ])
  ) {
    return { matched: true, kind: "zabbix_monitoring", subkind: "latest_problem" };
  }

  return { matched: false, kind: "unknown" };
}

export function formatOpsUnsupportedResponse(reason) {
  return buildUnsupportedResponse(reason);
}

async function callOpsQuery(question, mode = "chat", context = null, source = "chat") {
  const response = await fetch(OPERATIONS_QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question, mode, context, source })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data.error || `HTTP ${response.status}` };
  }

  return data;
}

export async function routeOpsChatQuestion(
  message,
  { currentIncidentContext = null, source = "chat" } = {}
) {
  const question = normalizeText(message);
  if (!question) {
    return {
      routed: false,
      kind: "unknown",
      message: buildUnsupportedResponse("La pregunta está vacía."),
      intent: { matched: false, kind: "unknown", reason: "La pregunta está vacía." }
    };
  }

  return callOpsQuery(question, "chat", { ...(currentIncidentContext || {}), source }, source);
}

export async function handleOpsVoiceCommand(
  transcript,
  { currentIncidentContext = null, source = "voice" } = {}
) {
  const question = normalizeText(transcript);
  if (!question) {
    return {
      ok: false,
      handled: false,
      unsupported: true,
      source: "IncidenciasTI / Zabbix",
      question,
      spokenResponse: buildUnsupportedResponse("La pregunta está vacía."),
      rejectionReason: buildUnsupportedResponse("La pregunta está vacía."),
      visualResult: null
    };
  }

  return callOpsQuery(question, "voice", { ...(currentIncidentContext || {}), source }, source);
}
