import {
  getActiveProblems,
  getCriticalRisks,
  getLatestProblems
} from "./zabbixLiveClient";
import { getFirewallStatus } from "./firewallStatus";
import {
  getIncidentById,
  getIncidentByIdLive,
  getIncidentCreatorContact,
  getIncidentNeighbors,
  getIncidentsRelatedToAsset,
  getLatestCreatedIncident,
  getLatestModifiedIncident,
  getNextIncident,
  getOpenIncidents,
  getPreviousIncident,
  getRecentIncidents,
  getRecentIncidentsLive,
  getUrgentIncidents,
  searchIncidents,
  searchIncidentsByCreator
} from "./incidentsLiveClient";
import { directSendCommunicationDraftFromIncident } from "./communicationDirectSend";

const INCIDENCES_SOURCE = "IncidenciasTI / SharePoint";
const ZABBIX_SOURCE = "Zabbix / Monitorización";

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

function isFirewallStatusRequest(question) {
  const normalized = normalizeMessage(question);
  return hasAny(normalized, [
    "firewall",
    "firewalls",
    "pfsense",
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

function incidentSummary(incident) {
  if (!incident) {
    return null;
  }

  const creator = getIncidentCreatorContact(incident);
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    priority: incident.priority,
    created: incident.created,
    modified: incident.modified,
    affected_system: incident.affected_system,
    requester: incident.requester,
    created_by_name: incident.created_by_name || creator.creator_name,
    created_by_email: incident.created_by_email || creator.creator_email,
    creator_name: creator.creator_name,
    creator_email: creator.creator_email,
    assigned_to: incident.assigned_to,
    category: incident.category,
    location: incident.location,
    comments: incident.comments,
    url: incident.url
  };
}

function problemSummary(problem) {
  if (!problem) {
    return null;
  }

  return {
    title: problem.title,
    detail: problem.detail,
    priority: problem.priority,
    source: problem.source || ZABBIX_SOURCE
  };
}

function extractAssetTerms(question) {
  return normalizeMessage(question)
    .split(/\s+/)
    .filter((term) => term.length >= 3)
    .filter((term) => !["zabbix", "incidencias", "incidenciasti", "sharepoint"].includes(term));
}

function formatIncidentLine(incident) {
  if (!incident) {
    return "Sin datos de incidencia.";
  }

  const creator = getIncidentCreatorContact(incident);
  return [
    `ID ${incident.id}`,
    incident.title,
    incident.created ? `Creada: ${incident.created}` : "",
    incident.modified ? `Modificada: ${incident.modified}` : "",
    incident.status ? `Estado: ${incident.status}` : "",
    incident.priority ? `Prioridad: ${incident.priority}` : "",
    incident.affected_system ? `Sistema afectado: ${incident.affected_system}` : "",
    `Creador: ${creator.creator_name || "No informado"}`,
    `Email creador: ${creator.creator_email || "No informado"}`
  ]
    .filter(Boolean)
    .join(" · ");
}

function currentIncidentFromContext(context) {
  const incidentId = normalizeText(context?.incidentId || context?.incident_id || "");
  const ordering = String(context?.ordering || "created desc / id desc").trim();
  const lastQueryType = String(context?.lastQueryType || context?.last_query_type || "").trim();
  return incidentId
    ? {
        incidentId,
        ordering: ordering || "created desc / id desc",
        lastQueryType,
        source: context?.source || INCIDENCES_SOURCE,
        title: String(context?.title || "").trim(),
        created: String(context?.created || "").trim(),
        modified: String(context?.modified || "").trim(),
        creator_name: String(context?.creator_name || context?.requester || "").trim(),
        creator_email: String(context?.creator_email || "").trim()
      }
    : null;
}

function incidentContextFromIncident(incident, ordering, lastQueryType) {
  if (!incident) {
    return null;
  }

  return {
    incidentId: String(incident.id || "").trim(),
    ordering: String(ordering || "created desc / id desc").trim(),
    source: INCIDENCES_SOURCE,
    title: String(incident.title || "").trim(),
    created: String(incident.created || "").trim(),
    modified: String(incident.modified || "").trim(),
    creator_name: String(incident.creator_name || incident.created_by_name || incident.requester || "").trim(),
    creator_email: String(incident.creator_email || incident.created_by_email || "").trim(),
    lastQueryType: String(lastQueryType || "").trim(),
    timestamp: new Date().toISOString()
  };
}

function buildCreatorSearchSummary(query, items, ordering) {
  const orderingLabel = ordering || "created desc / id desc";
  return items.length
    ? `Encontré ${items.length} incidencias creadas por ${query}, ordenadas por ${orderingLabel}.`
    : `No encuentro incidencias creadas por ${query}.`;
}

function extractCreatorQuery(question) {
  const source = normalizeText(question);
  if (!source) {
    return "";
  }

  if (
    hasAny(source, [
      "última incidencia",
      "ultima incidencia",
      "última incidencia modificada",
      "ultima incidencia modificada",
      "última modificada",
      "ultima modificada",
      "último ticket",
      "ultimo ticket",
      "incidencia anterior",
      "anterior modificada",
      "siguiente incidencia",
      "siguiente modificada",
      "incidencia más reciente",
      "incidencia mas reciente"
    ])
  ) {
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

function isCreatorEmailRequest(question) {
  const normalized = normalizeMessage(question);
  return (
    hasAny(normalized, [
      "email del creador",
      "correo del creador",
      "prepara un email al creador",
      "prepara email al creador",
      "preparar un email al creador",
      "preparar email al creador"
    ]) ||
    (hasAny(normalized, ["email", "correo", "prepara", "preparar"]) && hasAny(normalized, ["creador", "creadora"]))
  );
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

function isCreatorInfoRequest(question) {
  const normalized = normalizeMessage(question);
  return (
    hasAny(normalized, [
      "quien creo esta incidencia",
      "quien creo la incidencia",
      "quien creo este ticket",
      "quien creo el ticket",
      "quien es el creador",
      "quien es la creadora",
      "quien creó esta incidencia",
      "quien creó la incidencia",
      "quien creó este ticket",
      "quien creó el ticket"
    ]) ||
    (hasAny(normalized, ["creador", "creo", "creada"]) && hasAny(normalized, ["esta incidencia", "este ticket", "esta", "este"]))
  );
}

function formatProblemLine(problem) {
  if (!problem) {
    return "Sin datos de problema.";
  }

  return [problem.title, problem.detail, problem.priority ? `Prioridad: ${problem.priority}` : ""]
    .filter(Boolean)
    .join(" · ");
}

function buildCombinedSummary({ zabbix, incidents }) {
  const zabbixItems = (zabbix?.items || []).slice(0, 5);
  const incidentItems = (incidents?.items || []).slice(0, 5);

  return {
    kind: "combined_summary",
    title: "Resumen operativo separado",
    summary:
      "He separado el estado técnico de Zabbix y las incidencias de usuario de IncidenciasTI. No mezclo causas sin evidencia explícita.",
    sourceLabel: "Mixto",
    sourceBlocks: [
      {
        label: ZABBIX_SOURCE,
        ordering: zabbix?.ordering || "live read",
        summary: zabbix?.summary || "Sin detalle de Zabbix.",
        items: zabbixItems.map(problemSummary)
      },
      {
        label: INCIDENCES_SOURCE,
        ordering: incidents?.ordering || "live read",
        summary: incidents?.summary || "Sin detalle de IncidenciasTI.",
        items: incidentItems.map(incidentSummary)
      }
    ],
    latestAt: new Date().toISOString()
  };
}

function inferIntent(question) {
  const normalized = normalizeMessage(question);

  if (!normalized) {
    return { kind: "unknown", reason: "La pregunta está vacía." };
  }

  if (isCreatorDirectSendRequest(question)) {
    return { matched: true, kind: "incidents_user", subkind: "creator_direct_send_request" };
  }

  if (isCreatorEmailRequest(question)) {
    return { matched: true, kind: "incidents_user", subkind: "creator_email_request" };
  }

  if (isCreatorInfoRequest(question)) {
    return { matched: true, kind: "incidents_user", subkind: "creator_lookup" };
  }

  if (isFirewallStatusRequest(question)) {
    return { matched: true, kind: "firewall_status" };
  }

  const creatorQuery = extractCreatorQuery(question);
  if (creatorQuery && hasAny(normalized, ["incidencia", "incidencias", "ticket", "tickets", "abiertas", "abierto", "abierta"])) {
    return { matched: true, kind: "incidents_user", subkind: "creator_search", creatorQuery };
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
      "tickets en curso"
    ])
  ) {
    return { matched: true, kind: "incidents_user", subkind: "open" };
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

async function buildIncidentResult(question, subkind, context = {}) {
  const currentContext = currentIncidentFromContext(context);
  const activeOrdering =
    subkind === "latest_modified" || subkind === "previous_modified" || subkind === "next_modified"
      ? "modified desc / id desc"
      : currentContext?.ordering || "created desc / id desc";

  if (subkind === "creator_direct_send_request") {
    const needsLatest = hasAny(question, ["última incidencia", "ultima incidencia", "último ticket", "ultimo ticket", "más reciente", "mas reciente"]);
    let incident = currentContext?.incidentId
      ? {
          id: currentContext.incidentId,
          title: currentContext.title,
          created: currentContext.created,
          modified: currentContext.modified,
          creator_name: currentContext.creator_name,
          creator_email: currentContext.creator_email,
          requester: currentContext.requester,
          created_by_name: currentContext.created_by_name,
          created_by_email: currentContext.created_by_email
        }
      : null;

    if (incident && !incident.creator_email && !incident.creator_name) {
      const current = await getIncidentByIdLive(currentContext.incidentId);
      incident = current.ok ? current.incident : incident;
    }

    if (!incident && needsLatest) {
      const latest = await getLatestCreatedIncident();
      incident = latest.ok ? latest.incident : null;
    }

    const creator = getIncidentCreatorContact(incident);
    if (!incident) {
      const message = "Necesito saber qué incidencia usar antes de enviar el correo.";
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: message,
        rejectionReason: message,
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Envío directo al creador",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          items: [],
          summary: message,
          action: "communication_direct_send_request"
        }
      };
    }

    const creatorEmail = creator.creator_email || incident.creator_email || incident.created_by_email || "";
    const creatorName = creator.creator_name || incident.creator_name || incident.created_by_name || incident.requester || "";
    if (!creatorEmail || !creatorEmail.includes("@")) {
      const message = "No puedo enviarlo directamente porque la incidencia no tiene email de creador informado.";
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: message,
        rejectionReason: message,
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Envío directo al creador",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          item: incidentSummary(incident),
          items: [incidentSummary(incident)],
          summary: message,
          action: "communication_direct_send_request"
        }
      };
    }

    const sent = await directSendCommunicationDraftFromIncident({
      incidentId: incident.id,
      recipientEmail: creatorEmail,
      recipientName: creatorName,
      incidentTitle: incident.title || "",
      source: context?.source || "chat",
      confirm_direct_send: true,
      sentBy: "infra-agent-web"
    });

    const summary = `He enviado el correo directamente a ${sent.recipient_email}. No se puede reenviar este mismo borrador.`;
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      action: "communication_direct_sent",
      draft_id: sent.draft_id,
      draft: sent.draft,
      view_url: sent.view_url,
      recipient_email: sent.recipient_email,
      subject: sent.draft?.subject || "",
      status: sent.send_status || sent.draft?.status || "sent",
      source_incident_id: sent.source_incident_id || String(incident.id || ""),
      visualResult: {
        kind: "incidents_user",
        title: "Envío directo al creador",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: activeOrdering,
        summary,
        item: incidentSummary(incident),
        items: [incidentSummary(incident)],
        action: "communication_direct_sent",
        draft_id: sent.draft_id,
        view_url: sent.view_url,
        draft_status: sent.send_status || sent.draft?.status || "sent",
        recipient_email: sent.recipient_email,
        source_incident_id: sent.source_incident_id || String(incident.id || ""),
        sent_at: sent.sent_at
      }
    };
  }

  if (subkind === "creator_email_request") {
    const needsLatest = hasAny(question, ["última incidencia", "ultima incidencia", "último ticket", "ultimo ticket", "más reciente", "mas reciente"]);
    let incident = currentContext?.incidentId
      ? {
          id: currentContext.incidentId,
          title: currentContext.title,
          created: currentContext.created,
          modified: currentContext.modified,
          creator_name: currentContext.creator_name,
          creator_email: currentContext.creator_email,
          requester: currentContext.requester,
          created_by_name: currentContext.created_by_name,
          created_by_email: currentContext.created_by_email
        }
      : null;

    if (incident && !incident.creator_email && !incident.creator_name) {
      const current = await getIncidentByIdLive(currentContext.incidentId);
      incident = current.ok ? current.incident : incident;
    }

    if (!incident && needsLatest) {
      const latest = await getLatestCreatedIncident();
      incident = latest.ok ? latest.incident : null;
    }

    const creator = getIncidentCreatorContact(incident);
    if (!incident) {
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: "No encuentro una incidencia sobre la que preparar el correo del creador.",
        rejectionReason: "No encuentro una incidencia sobre la que preparar el correo del creador.",
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Email al creador",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          items: [],
          summary: "No encuentro una incidencia sobre la que preparar el correo del creador."
        }
      };
    }

    const creatorEmail = creator.creator_email || incident.creator_email || incident.created_by_email || "";
    const creatorName = creator.creator_name || incident.creator_name || incident.created_by_name || incident.requester || "";

    if (!creatorEmail || !creatorEmail.includes("@")) {
      const message = "No hay email de creador disponible para esta incidencia.";
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: message,
        rejectionReason: message,
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Email al creador",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          item: incidentSummary(incident),
          items: [incidentSummary(incident)],
          summary: message,
          action: "prepare_creator_email"
        }
      };
    }

    const summary = `Te he preparado un borrador para ${creatorName || "el creador de la incidencia"}. Revísalo antes de enviarlo manualmente.`;
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Email al creador",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: activeOrdering,
        summary,
        item: incidentSummary(incident),
        items: [incidentSummary(incident)],
        action: "prepare_creator_email",
        creator_name: creatorName,
        creator_email: creatorEmail
      }
    };
  }

  if (subkind === "creator_lookup") {
    let incident = currentContext?.incidentId
      ? {
          id: currentContext.incidentId,
          title: currentContext.title,
          created: currentContext.created,
          modified: currentContext.modified,
          creator_name: currentContext.creator_name,
          creator_email: currentContext.creator_email,
          requester: currentContext.requester,
          created_by_name: currentContext.created_by_name,
          created_by_email: currentContext.created_by_email
        }
      : null;

    if (incident && !incident.creator_name && !incident.creator_email) {
      const current = await getIncidentByIdLive(currentContext.incidentId);
      incident = current.ok ? current.incident : incident;
    }

    if (!incident) {
      const latest = await getLatestCreatedIncident();
      incident = latest.ok ? latest.incident : null;
    }

    if (!incident) {
      const message = "No encuentro una incidencia para mostrar su creador.";
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: message,
        rejectionReason: message,
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Creador de incidencia",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          items: [],
          summary: message
        }
      };
    }

    const creator = getIncidentCreatorContact(incident);
    const summary = `La incidencia la creó ${creator.creator_name || "No informado"}${creator.creator_email ? `, email ${creator.creator_email}` : ""}.`;
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Creador de incidencia",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: activeOrdering,
        summary,
        item: incidentSummary(incident),
        items: [incidentSummary(incident)],
        creator_name: creator.creator_name,
        creator_email: creator.creator_email
      }
    };
  }

  if (subkind === "previous" || subkind === "previous_modified") {
    if (!currentContext?.incidentId) {
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: "¿Anterior a qué incidencia? Ahora puedo navegar desde una incidencia concreta, por ejemplo ID 214.",
        rejectionReason: "¿Anterior a qué incidencia? Ahora puedo navegar desde una incidencia concreta, por ejemplo ID 214.",
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Navegación de incidencias",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          items: [],
          summary: "Necesito una incidencia en contexto para navegar a la anterior."
        }
      };
    }

    const neighbors = await getIncidentNeighbors({
      incidentId: currentContext.incidentId,
      ordering: activeOrdering
    });
    if (!neighbors.ok) {
      return { ok: false, error: neighbors.error || "No se pudo consultar IncidenciasTI." };
    }
    const incident = neighbors.previous || null;
    if (!incident) {
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: "No hay una incidencia anterior en IncidenciasTI para la incidencia actual.",
        rejectionReason: "No hay una incidencia anterior en IncidenciasTI para la incidencia actual.",
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Incidencia anterior",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: neighbors.ordering || activeOrdering,
          items: [],
          summary: "No hay una incidencia anterior en IncidenciasTI para la incidencia actual."
        }
      };
    }

    const summary = `Incidencia anterior en IncidenciasTI: ${formatIncidentLine(incident)}.`;
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Incidencia anterior",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: neighbors.ordering || activeOrdering,
        summary,
        item: incidentSummary(incident),
        items: [incidentSummary(incident)],
        question,
        previous: incidentSummary(incident),
        current: incidentSummary(neighbors.current),
        next: incidentSummary(neighbors.next)
      }
    };
  }

  if (subkind === "next" || subkind === "next_modified") {
    if (!currentContext?.incidentId) {
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: "¿Siguiente a qué incidencia? Ahora puedo navegar desde una incidencia concreta, por ejemplo ID 214.",
        rejectionReason: "¿Siguiente a qué incidencia? Ahora puedo navegar desde una incidencia concreta, por ejemplo ID 214.",
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Navegación de incidencias",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: activeOrdering,
          items: [],
          summary: "Necesito una incidencia en contexto para navegar a la siguiente."
        }
      };
    }

    const neighbors = await getIncidentNeighbors({
      incidentId: currentContext.incidentId,
      ordering: activeOrdering
    });
    if (!neighbors.ok) {
      return { ok: false, error: neighbors.error || "No se pudo consultar IncidenciasTI." };
    }
    const incident = neighbors.next || null;
    if (!incident) {
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: "No hay una incidencia siguiente en IncidenciasTI para la incidencia actual.",
        rejectionReason: "No hay una incidencia siguiente en IncidenciasTI para la incidencia actual.",
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Incidencia siguiente",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: neighbors.ordering || activeOrdering,
          items: [],
          summary: "No hay una incidencia siguiente en IncidenciasTI para la incidencia actual."
        }
      };
    }

    const summary = `Incidencia siguiente en IncidenciasTI: ${formatIncidentLine(incident)}.`;
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Incidencia siguiente",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: neighbors.ordering || activeOrdering,
        summary,
        item: incidentSummary(incident),
        items: [incidentSummary(incident)],
        question,
        previous: incidentSummary(neighbors.previous),
        current: incidentSummary(neighbors.current),
        next: incidentSummary(incident)
      }
    };
  }

  if (subkind === "creator_search") {
    const creatorQuery = extractCreatorQuery(question) || String(context?.creatorQuery || "").trim();
    const search = await searchIncidentsByCreator({ query: creatorQuery, limit: 10 });
    if (!search.ok) {
      return { ok: false, error: search.error || "No se pudo consultar IncidenciasTI." };
    }

    const items = (search.incidents || []).slice(0, 10).map(incidentSummary).filter(Boolean);
    const incident = items[0] || null;
    const summary = buildCreatorSearchSummary(creatorQuery, items, search.ordering || "created desc / id desc");
    return {
      ok: true,
      handled: true,
      unsupported: items.length === 0,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: items.length ? null : summary,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: `Incidencias creadas por ${creatorQuery}`,
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: search.ordering || "created desc / id desc",
        summary,
        items,
        item: incident,
        question,
        creatorQuery
      }
    };
  }

  if (subkind === "latest_modified") {
    const latest = await getLatestModifiedIncident();
    if (!latest.ok) {
      return { ok: false, error: latest.error || "No se pudo consultar IncidenciasTI." };
    }

    const incident = latest.incident;
    if (!incident) {
      return {
        ok: true,
        handled: true,
        unsupported: true,
        kind: "incidents_user",
        spokenResponse: "No encuentro incidencias recientes en IncidenciasTI.",
        rejectionReason: "No encuentro incidencias recientes en IncidenciasTI.",
        sourceLabel: INCIDENCES_SOURCE,
        visualResult: {
          kind: "incidents_user",
          title: "Última incidencia modificada",
          sourceLabel: INCIDENCES_SOURCE,
          live: true,
          ordering: latest.ordering || "modified desc / id desc",
          items: [],
          summary: "No encuentro incidencias recientes en IncidenciasTI."
        }
      };
    }

    const summary = `Última incidencia modificada en IncidenciasTI: ${formatIncidentLine(incident)}.`;
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: summary,
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Última incidencia modificada",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: latest.ordering || "modified desc / id desc",
        summary,
        item: incidentSummary(incident),
        items: incident ? [incidentSummary(incident)] : [],
        question
      }
    };
  }

  if (subkind === "open") {
    const open = await getOpenIncidents({ limit: 10 });
    if (!open.ok) {
      return { ok: false, error: open.error || "No se pudo consultar IncidenciasTI." };
    }

    const items = (open.incidents || []).slice(0, 10).map(incidentSummary).filter(Boolean);
    return {
      ok: true,
      handled: true,
      unsupported: false,
      kind: "incidents_user",
      spokenResponse: items.length
        ? `He mostrado en pantalla ${items.length} incidencias abiertas de IncidenciasTI.`
        : "No hay incidencias abiertas en IncidenciasTI.",
      rejectionReason: null,
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Incidencias abiertas",
        sourceLabel: INCIDENCES_SOURCE,
        live: true,
        ordering: open.ordering || "created desc / id desc",
        summary: items.length
          ? `Hay ${items.length} incidencias abiertas en IncidenciasTI.`
          : "No hay incidencias abiertas en IncidenciasTI.",
        items,
        question
      }
    };
  }

  const latest = await getLatestCreatedIncident();
  if (!latest.ok) {
    return { ok: false, error: latest.error || "No se pudo consultar IncidenciasTI." };
  }

  const incident = latest.incident;
  if (!incident) {
    return {
      ok: true,
      handled: true,
      unsupported: true,
      kind: "incidents_user",
      spokenResponse: "No encuentro incidencias recientes en IncidenciasTI.",
      rejectionReason: "No encuentro incidencias recientes en IncidenciasTI.",
      sourceLabel: INCIDENCES_SOURCE,
      visualResult: {
        kind: "incidents_user",
        title: "Última incidencia creada",
        sourceLabel: INCIDENCES_SOURCE,
        ordering: latest.ordering || "created desc / id desc",
        items: [],
        summary: "No encuentro incidencias recientes en IncidenciasTI."
      }
    };
  }

  const summary = `Última incidencia creada en IncidenciasTI: ${formatIncidentLine(incident)}.`;
  return {
    ok: true,
    handled: true,
    unsupported: false,
    kind: "incidents_user",
    spokenResponse: summary,
    rejectionReason: null,
    sourceLabel: INCIDENCES_SOURCE,
    visualResult: {
      kind: "incidents_user",
      title: "Última incidencia creada",
      sourceLabel: INCIDENCES_SOURCE,
      ordering: latest.ordering || "created desc / id desc",
      summary,
      item: incidentSummary(incident),
      items: [incidentSummary(incident)],
      question
    }
  };
}

async function buildZabbixResult(question, subkind) {
  const latest = await getLatestProblems({ limit: 10 });
  if (!latest.ok) {
    return { ok: false, error: latest.error || "No se pudo consultar Zabbix." };
  }

  const items = (latest.items || []).slice(0, 10).map(problemSummary).filter(Boolean);
  const summary = items.length
    ? `He encontrado ${items.length} problemas activos o recientes de Zabbix.`
    : "No hay problemas activos de Zabbix.";

  return {
    ok: true,
    handled: true,
    unsupported: false,
    kind: "zabbix_monitoring",
    spokenResponse: items.length
      ? "He mostrado en pantalla los problemas de Zabbix."
      : "No hay problemas activos en Zabbix.",
    rejectionReason: null,
    sourceLabel: ZABBIX_SOURCE,
      visualResult: {
        kind: "zabbix_monitoring",
        title: subkind === "latest_problem" ? "Último problema Zabbix" : "Problemas Zabbix",
        sourceLabel: ZABBIX_SOURCE,
        live: true,
        ordering: latest.ordering || "live read",
        summary,
        items,
      question
    }
  };
}

async function buildFirewallResult(question) {
  const status = await getFirewallStatus({ limit: 20 });
  const hosts = Array.isArray(status.hosts) ? status.hosts : [];
  const gaps = Array.isArray(status.gaps) ? status.gaps : [];
  const problems = Array.isArray(status.activeProblems) ? status.activeProblems : [];

  if (!status.ok && !hosts.length) {
    const message = status.reason || "No encuentro firewalls en el mapa cargado.";
    return {
      ok: true,
      handled: true,
      unsupported: true,
      kind: "firewall_status",
      sourceLabel: "Firewalls / Red perimetral",
      spokenResponse: message,
      rejectionReason: message,
      visualResult: {
        kind: "firewall_status",
        title: "Firewalls / Red perimetral",
        sourceLabel: "Firewalls / Red perimetral",
        live: true,
        summary: message,
        items: [],
        hosts: [],
        gaps: [],
        activeProblems: [],
        firewall_count: 0,
        source: status.source || "agent_knowledge/global_infrastructure_map.json",
        generatedAt: status.generatedAt || new Date().toISOString(),
        reason: message
      }
    };
  }

  const primaryMessage = hosts.length
    ? `Tengo ${hosts.length} firewalls en la categoría Firewalls / Red perimetral: ${hosts.join(", ")}.`
    : "He detectado firewalls, pero no puedo listar hosts aún.";
  const gapMessage = gaps.length
    ? ` Faltan ${gaps.length} huecos de monitorización específicos.`
    : " No veo huecos específicos destacados.";
  const problemMessage = problems.length
    ? ` Hay ${problems.length} problemas activos relacionados con firewalls o red perimetral.`
    : " No hay problemas activos claramente filtrados para firewalls.";

  const summary = `${primaryMessage}${problemMessage}${gapMessage}`;

  return {
    ok: true,
    handled: true,
    unsupported: false,
    kind: "firewall_status",
    sourceLabel: "Firewalls / Red perimetral",
    spokenResponse: summary,
    rejectionReason: null,
    visualResult: {
      kind: "firewall_status",
      title: "Firewalls / Red perimetral",
      sourceLabel: "Firewalls / Red perimetral",
      live: true,
      summary,
      items: problems.slice(0, 8).map((problem) => ({
        title: problem.title || "Problema de firewall",
        detail: problem.detail || "",
        priority: problem.priority || "unknown",
        source: problem.source || "Zabbix / Monitorización"
      })),
      hosts,
      gaps,
      activeProblems: problems,
      firewall_count: hosts.length,
      source: status.source || "agent_knowledge/global_infrastructure_map.json",
      generatedAt: status.generatedAt || new Date().toISOString(),
      reason: status.reason || null
    }
  };
}

async function correlateIncidentWithZabbix(incident) {
  if (!incident) {
    return {
      correlationConfidence: 0,
      causalClaimAllowed: false,
      matchedAssets: [],
      matchedZabbixProblems: [],
      evidence: [],
      claim: "No hay incidencia para correlacionar."
    };
  }

  const zabbix = await getLatestProblems({ limit: 20 });
  const problems = zabbix.ok ? zabbix.items || [] : [];
  const assets = [
    incident.affected_system,
    incident.title,
    incident.description,
    incident.location,
    incident.comments
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const matchedZabbixProblems = problems.filter((problem) => {
    const haystack = normalizeMessage(
      `${problem.title} ${problem.detail} ${problem.priority} ${problem.source}`
    );
    return assets.some((asset) => {
      const terms = extractAssetTerms(asset);
      return terms.length ? terms.some((term) => haystack.includes(term)) : false;
    });
  });

  const matchedAssets = assets.filter((asset) => {
    const terms = extractAssetTerms(asset);
    return terms.some((term) =>
      matchedZabbixProblems.some((problem) =>
        normalizeMessage(`${problem.title} ${problem.detail}`).includes(term)
      )
    );
  });

  const evidence = [];
  if (incident.affected_system) {
    evidence.push(`Sistema afectado: ${incident.affected_system}`);
  }
  if (incident.title) {
    evidence.push(`Título de incidencia: ${incident.title}`);
  }
  matchedZabbixProblems.slice(0, 3).forEach((problem) => {
    evidence.push(`Zabbix: ${formatProblemLine(problem)}`);
  });

  const correlationConfidence = matchedZabbixProblems.length
    ? Math.min(0.95, 0.55 + matchedZabbixProblems.length * 0.1)
    : 0.25;

  return {
    correlationConfidence,
    causalClaimAllowed: false,
    matchedAssets,
    matchedZabbixProblems,
    evidence,
    claim: matchedZabbixProblems.length
      ? "Posible relación detectada, pero no hay evidencia suficiente para afirmar causalidad."
      : "No hay evidencia suficiente para relacionar la incidencia con un problema Zabbix."
  };
}

async function buildCorrelationResult(question) {
  const assetTerms = extractAssetTerms(question);
  let incident = null;

  const idMatch = normalizeMessage(question).match(/\b(?:id\s*)?(\d{1,8})\b/);
  if (idMatch?.[1]) {
    const byId = await getIncidentById(idMatch[1]);
    if (byId.ok) {
      incident = byId.incident;
    }
  }

  if (!incident && assetTerms.length) {
    const search = await searchIncidents(assetTerms.join(" "), { limit: 10 });
    if (search.ok) {
      incident = search.incidents?.[0] || null;
    }
  }

  if (!incident && assetTerms.length) {
    const related = await getIncidentsRelatedToAsset(assetTerms.join(" "), { limit: 10 });
    if (related.ok) {
      incident = related.incidents?.[0] || null;
    }
  }

  if (!incident) {
    const latest = await getLatestCreatedIncident();
    incident = latest.ok ? latest.incident : null;
  }

  const correlation = await correlateIncidentWithZabbix(incident);
  const incidentBlock = incidentSummary(incident);
  const zabbixProblems = correlation.matchedZabbixProblems.slice(0, 5).map(problemSummary).filter(Boolean);
  const summary = correlation.matchedZabbixProblems.length
    ? "He encontrado una posible relación con evidencia, pero no suficiente para afirmar causalidad."
    : "No hay evidencia suficiente para relacionar la incidencia con Zabbix.";

  return {
    ok: true,
    handled: true,
    unsupported: false,
    kind: "correlation_requested",
    spokenResponse: summary,
    rejectionReason: null,
    sourceLabel: "Correlación",
      visualResult: {
        kind: "correlation_requested",
        title: "Posible relación IncidenciasTI + Zabbix",
        sourceLabel: "Correlación",
        live: true,
        summary,
        incident: incidentBlock,
        matchedAssets: correlation.matchedAssets,
      matchedZabbixProblems: zabbixProblems,
      correlationConfidence: correlation.correlationConfidence,
      causalClaimAllowed: false,
      evidence: correlation.evidence,
      claim: correlation.claim,
      question
    }
  };
}

export function detectOpsIntent(message) {
  return inferIntent(message);
}

export function formatOpsUnsupportedResponse(reason) {
  return buildUnsupportedResponse(reason);
}

export async function routeOpsChatQuestion(message, { currentIncidentContext = null } = {}) {
  const question = normalizeText(message);
  const intent = inferIntent(question);

  if (intent.kind === "unknown") {
    return {
      routed: false,
      kind: "unknown",
      message: buildUnsupportedResponse("La consulta no parece de IncidenciasTI ni de Zabbix."),
      intent
    };
  }

  if (intent.kind === "incidents_user") {
    const result = await buildIncidentResult(question, intent.subkind, {
      ...currentIncidentContext,
      creatorQuery: intent.creatorQuery || ""
    });
    if (!result.ok) {
      return {
        routed: true,
        handled: false,
        kind: "error",
        message: result.error || "No se pudo consultar IncidenciasTI.",
        intent
      };
    }
    if (result.unsupported) {
      return {
        routed: true,
        handled: false,
        kind: "unsupported",
        message: result.rejectionReason,
        interpretation: intent,
        visualResult: result.visualResult,
        intent
      };
    }
    return {
      routed: true,
      handled: true,
      kind: result.kind,
      sourceLabel: result.sourceLabel,
      spokenResponse: result.spokenResponse,
      message: result.spokenResponse,
      visualResult: result.visualResult,
      intent
    };
  }

  if (intent.kind === "zabbix_monitoring") {
    const result = await buildZabbixResult(question, intent.subkind);
    if (!result.ok) {
      return {
        routed: true,
        handled: false,
        kind: "error",
        message: result.error || "No se pudo consultar Zabbix.",
        intent
      };
    }
    return {
      routed: true,
      handled: true,
      kind: result.kind,
      sourceLabel: result.sourceLabel,
      spokenResponse: result.spokenResponse,
      message: result.spokenResponse,
      visualResult: result.visualResult,
      intent
    };
  }

  if (intent.kind === "firewall_status") {
    const result = await buildFirewallResult(question);
    return {
      routed: true,
      handled: true,
      kind: "firewall_status",
      sourceLabel: "Firewalls / Red perimetral",
      spokenResponse: result.spokenResponse,
      message: result.spokenResponse,
      visualResult: result.visualResult,
      intent
    };
  }

  if (intent.kind === "combined_summary") {
    const [zabbix, incidents] = await Promise.all([
      getLatestProblems({ limit: 5 }),
      getUrgentIncidents({ limit: 5 })
    ]);
    const zabbixBlock = zabbix.ok
      ? {
          sourceLabel: ZABBIX_SOURCE,
          ordering: zabbix.ordering || "live read",
          summary: zabbix.summary || "Sin problemas activos destacados.",
          items: (zabbix.items || []).slice(0, 5).map(problemSummary).filter(Boolean)
        }
      : {
          sourceLabel: ZABBIX_SOURCE,
          ordering: "live read",
          summary: "No se pudo consultar Zabbix.",
          items: []
        };
    const incidentsBlock = incidents.ok
      ? {
          sourceLabel: INCIDENCES_SOURCE,
          ordering: incidents.ordering || "created desc / id desc",
          summary: incidents.items?.length
            ? `Hay ${incidents.items.length} incidencias urgentes o abiertas.`
            : "No hay incidencias urgentes destacadas.",
          items: (incidents.items || []).slice(0, 5).map(incidentSummary).filter(Boolean)
        }
      : {
          sourceLabel: INCIDENCES_SOURCE,
          ordering: "created desc / id desc",
          summary: "No se pudo consultar IncidenciasTI.",
          items: []
        };

    const spokenResponse = incidentsBlock.items.length
      ? "He mostrado en pantalla un resumen separado de Zabbix e IncidenciasTI."
      : "He mostrado en pantalla el estado de Zabbix; no encuentro incidencias urgentes en IncidenciasTI.";

    return {
      routed: true,
      handled: true,
      kind: "combined_summary",
      sourceLabel: "Mixto",
      spokenResponse,
      message: spokenResponse,
      visualResult: {
        kind: "combined_summary",
        title: "Resumen operativo separado",
        sourceLabel: "Mixto",
        live: true,
        summary:
          "He separado Zabbix y IncidenciasTI para evitar mezclar causas. Las dos fuentes se muestran por separado.",
        sourceBlocks: [zabbixBlock, incidentsBlock],
        question
      },
      intent
    };
  }

  if (intent.kind === "correlation_requested") {
    const result = await buildCorrelationResult(question);
    return {
      routed: true,
      handled: true,
      kind: "correlation_requested",
      sourceLabel: "Correlación",
      spokenResponse: result.spokenResponse,
      message: result.spokenResponse,
      visualResult: result.visualResult,
      intent
    };
  }

  return {
    routed: false,
    kind: "unknown",
    intent
  };
}

export async function handleOpsVoiceCommand(transcript, { currentIncidentContext = null } = {}) {
  const question = normalizeText(transcript);
  const routed = await routeOpsChatQuestion(question, { currentIncidentContext });

  if (!routed.routed) {
    return {
      ok: false,
      handled: false,
      unsupported: true,
      source: "IncidenciasTI / Zabbix",
      question,
      spokenResponse: formatOpsUnsupportedResponse(
        "La consulta no parece ser de IncidenciasTI ni de Zabbix."
      ),
      rejectionReason: formatOpsUnsupportedResponse(
        "La consulta no parece ser de IncidenciasTI ni de Zabbix."
      ),
      visualResult: null
    };
  }

  if (!routed.handled) {
    return {
      ok: true,
      handled: true,
      unsupported: true,
      source: routed.sourceLabel || "IncidenciasTI / Zabbix",
      question,
      spokenResponse: routed.message || formatOpsUnsupportedResponse(),
      rejectionReason: routed.message || formatOpsUnsupportedResponse(),
      visualResult: routed.visualResult || null
    };
  }

  return {
    ok: true,
    handled: true,
    unsupported: false,
    source: routed.sourceLabel || "IncidenciasTI / Zabbix",
    question,
    spokenResponse: routed.spokenResponse || routed.message || "",
    rejectionReason: null,
    visualResult: routed.visualResult || null,
    kind: routed.kind || "unknown"
  };
}

export { correlateIncidentWithZabbix };
