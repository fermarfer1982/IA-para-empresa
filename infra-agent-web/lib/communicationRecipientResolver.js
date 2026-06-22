import { searchCompanyDirectoryUsers } from "./companyDirectory";
import { getIncidentByIdLive, getIncidentCreatorContact } from "./incidentsLiveClient";

function text(value) {
  return String(value || "").trim();
}

function normalized(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesAny(source, terms) {
  const haystack = normalized(source);
  return terms.some((term) => haystack.includes(normalized(term)));
}

export function extractCommunicationEmail(value) {
  const match = text(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function recipientNameFromEmail(email) {
  const localPart = text(email).split("@")[0] || "";
  return localPart.replace(/[._-]+/g, " ").trim();
}

export function isCreatorRecipientIntent(transcript = "", intent = "") {
  const source = [transcript, intent].join(" ");
  return includesAny(source, [
    "email al creador",
    "correo al creador",
    "email del creador",
    "correo del creador",
    "email de esta incidencia",
    "correo de esta incidencia",
    "email de la incidencia",
    "correo de la incidencia",
    "avisa al creador",
    "avisar al creador",
    "manda correo al creador",
    "manda email al creador",
    "envia correo al creador",
    "envía correo al creador",
    "envia email al creador",
    "envía email al creador",
    "prepare_creator_email",
    "send_creator_email",
    "email_to_incident_creator",
    "direct_send_creator_email"
  ]);
}

function incidentFromContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const incidentId = text(
    source.incidentId || source.incident_id || source.id || source.source_incident_id
  );
  if (!incidentId) {
    return null;
  }
  return {
    id: incidentId,
    title: text(source.title || source.incident_title),
    creator_name: text(source.creator_name || source.created_by_name || source.recipient_name),
    creator_email: text(source.creator_email || source.created_by_email || source.recipient_email),
    created_by_name: text(source.created_by_name || source.creator_name),
    created_by_email: text(source.created_by_email || source.creator_email),
    requester: text(source.requester)
  };
}

async function resolveIncident(context) {
  let incident = incidentFromContext(context);
  if (!incident?.id) {
    return null;
  }

  if (!incident.creator_email || !incident.creator_name || !incident.title) {
    const live = await getIncidentByIdLive(incident.id);
    if (live.ok && live.incident) {
      incident = {
        ...live.incident,
        ...incident,
        creator_name: incident.creator_name || live.incident.creator_name || live.incident.created_by_name || "",
        creator_email: incident.creator_email || live.incident.creator_email || live.incident.created_by_email || "",
        title: incident.title || live.incident.title || ""
      };
    }
  }

  return incident;
}

function cleanRecipientCandidate(value) {
  return text(value)
    .replace(/^(el|la|los|las|un|una|al)\s+/i, "")
    .replace(/\b(que|de que|sobre que|para que)\b.*$/i, "")
    .replace(/\b(voice_prepare_communication_draft|voice|ya|directamente|sin revisar|con copia|por favor).*$/i, "")
    .trim();
}

function confidenceScore(confidence) {
  if (typeof confidence === "number") {
    return confidence;
  }
  if (confidence === "high") {
    return 0.95;
  }
  if (confidence === "missing_email") {
    return 0.5;
  }
  if (confidence === "ambiguous") {
    return 0.4;
  }
  return 0;
}

function recipientResult(payload = {}) {
  const source = payload.source || payload.recipient_source || "generic";
  const confidence = payload.confidence || payload.recipient_confidence || "none";
  return {
    ...payload,
    source,
    confidence,
    recipient_source: source,
    recipient_confidence: confidenceScore(confidence)
  };
}

function isBlockedRecipientCandidate(candidate) {
  return /^(creador|creadora|incidencia|esta incidencia|la incidencia|equipo interno|direccion|dirección|sistemas|soporte|hoy|mañana|manana|esta tarde|esta mañana|esta manana|luego)$/i.test(
    text(candidate)
  );
}

export function extractNamedCommunicationRecipient(transcript = "", requestedRecipientName = "", intent = "") {
  const sources = [requestedRecipientName, transcript, intent]
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  const patterns = [
    /(?:dile|di|avisa|avisar|informa|informar|comunica|comunicar)\s+(?:a|para)\s+([^,.]+?)(?:\s+(?:que|de que|sobre|para)\b|$)/i,
    /(?:prepara|preparar|crear|crea|haz|hacer|manda|mandar|envia|envía|enviar)\s+(?:directamente\s+)?(?:un\s+|una\s+)?(?:correo|email|mensaje|borrador)\s+(?:a|para)\s+([^,.]+)/i,
    /(?:correo|email|mensaje|borrador)\s+(?:a|para)\s+([^,.]+)/i,
    /(?:manda|mandar|envia|envía|enviar|prepara|preparar|crear|crea)\s+(?:directamente\s+)?(?:a|para)\s+([^,.]+)/i,
    /(?:\bdestinatario\b|\bpara\b)\s+([^,.]+)/i,
    /(?:^|\s)(?:a|para)\s+([^,.]+)/i
  ];

  for (const source of sources) {
    const explicitEmail = extractCommunicationEmail(source);
    if (explicitEmail && source === requestedRecipientName) {
      return "";
    }

    for (const pattern of patterns) {
      const match = source.match(pattern);
      const candidate = cleanRecipientCandidate(match?.[1]);
      if (candidate && !isBlockedRecipientCandidate(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function directoryUserEmail(user) {
  return text(user?.mail || user?.user_principal_name);
}

function directoryUserSearchText(user) {
  return normalized(
    [
      user?.display_name,
      user?.given_name,
      user?.surname,
      user?.mail,
      user?.user_principal_name,
      user?.job_title,
      user?.department
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function candidateForResponse(user) {
  return {
    name: text(user?.display_name),
    email: directoryUserEmail(user)
  };
}

function contactName(contact) {
  return text(
    contact?.recipient_name ||
      contact?.recipientName ||
      contact?.recipient_label ||
      contact?.recipientLabel ||
      contact?.displayName ||
      contact?.display_name ||
      contact?.name ||
      contact?.mail ||
      contact?.email ||
      contact?.userPrincipalName ||
      contact?.user_principal_name
  );
}

function contactEmail(contact) {
  return extractCommunicationEmail(
    contact?.recipient_email ||
      contact?.recipientEmail ||
      contact?.mail ||
      contact?.email ||
      contact?.userPrincipalName ||
      contact?.user_principal_name ||
      contact?.toEmail ||
      contact?.targetEmail
  );
}

function pickUniqueDirectoryUser(users = [], query = "") {
  const withEmail = users.filter((user) => directoryUserEmail(user));
  const normalizedQuery = normalized(query);
  if (!normalizedQuery || !withEmail.length) {
    return null;
  }

  const exactMatches = withEmail.filter((user) =>
    [
      user?.display_name,
      user?.given_name,
      user?.surname,
      user?.mail,
      user?.user_principal_name
    ].some((value) => normalized(value) === normalizedQuery)
  );
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const startsWithMatches = withEmail.filter((user) =>
    [user?.display_name, user?.mail, user?.user_principal_name].some((value) =>
      normalized(value).startsWith(normalizedQuery)
    )
  );
  if (startsWithMatches.length === 1) {
    return startsWithMatches[0];
  }

  const containedMatches = withEmail.filter((user) =>
    directoryUserSearchText(user).includes(normalizedQuery)
  );
  if (containedMatches.length === 1) {
    return containedMatches[0];
  }

  return withEmail.length === 1 ? withEmail[0] : null;
}

export async function resolveCommunicationRecipient({
  transcript = "",
  requestedRecipientName = "",
  resolvedRecipient = null,
  currentIncidentContext = null,
  intent = "",
  defaultRecipientName = "Equipo interno"
} = {}) {
  const sourceText = [transcript, requestedRecipientName, intent].join(" ");
  if (isCreatorRecipientIntent(transcript, intent)) {
    const incident = await resolveIncident(currentIncidentContext);
    if (!incident?.id) {
      return recipientResult({
        recipient_name: "Creador de la incidencia",
        recipient_email: "",
        source: "incident_creator",
        confidence: "none",
        needs_clarification: false,
        candidates: [],
        error: "Necesito saber qué incidencia usar antes de preparar el correo.",
        source_incident_id: "",
        incident: null
      });
    }

    const creator = getIncidentCreatorContact(incident);
    const creatorName = text(
      creator.creator_name || incident.creator_name || incident.created_by_name || incident.requester
    );
    const creatorEmail = extractCommunicationEmail(
      creator.creator_email || incident.creator_email || incident.created_by_email
    );
    return recipientResult({
      recipient_name: creatorName || "Creador de la incidencia",
      recipient_email: creatorEmail,
      source: "incident_creator",
      confidence: creatorEmail ? "high" : "missing_email",
      needs_clarification: false,
      candidates: [],
      error: creatorEmail ? "" : "Falta email del creador.",
      source_incident_id: String(incident.id || ""),
      incident
    });
  }

  const resolvedName = contactName(resolvedRecipient);
  const resolvedEmail = contactEmail(resolvedRecipient);
  if (resolvedEmail) {
    return recipientResult({
      recipient_name: resolvedName || recipientNameFromEmail(resolvedEmail),
      recipient_email: resolvedEmail,
      source: resolvedRecipient?.recipient_source || resolvedRecipient?.source || "directory_unique_match",
      confidence: resolvedRecipient?.recipient_confidence || resolvedRecipient?.confidence || "high",
      needs_clarification: false,
      candidates: [],
      error: ""
    });
  }

  const explicitEmail = extractCommunicationEmail(sourceText);
  if (explicitEmail) {
    const cleanName = cleanRecipientCandidate(
      text(requestedRecipientName).replace(explicitEmail, "") ||
        text(transcript).replace(explicitEmail, "")
    )
      .replace(/^(prepara|preparar|crear|crea|haz|hacer|manda|mandar|envia|envía|enviar)\s+(directamente\s+)?(un\s+|una\s+)?(correo|email|mensaje|borrador)?\s*(a|para)?\s*/i, "")
      .replace(/^(correo|email|mensaje|borrador)\s*(a|para)?\s*/i, "")
      .replace(/^(a|para)\s*/i, "")
      .trim();
    return recipientResult({
      recipient_name: cleanName || recipientNameFromEmail(explicitEmail),
      recipient_email: explicitEmail,
      source: "explicit_email",
      confidence: "high",
      needs_clarification: false,
      candidates: [],
      error: ""
    });
  }

  const directRequestedRecipient = cleanRecipientCandidate(requestedRecipientName);
  const namedRecipient =
    directRequestedRecipient && !isBlockedRecipientCandidate(directRequestedRecipient)
      ? directRequestedRecipient
      : extractNamedCommunicationRecipient(transcript, requestedRecipientName, intent);
  if (namedRecipient) {
    try {
      const users = await searchCompanyDirectoryUsers({ q: namedRecipient, limit: 10 });
      const withEmail = users.filter((user) => directoryUserEmail(user));
      const selectedUser = pickUniqueDirectoryUser(withEmail, namedRecipient);
      if (selectedUser) {
        return recipientResult({
          recipient_name: text(selectedUser.display_name) || namedRecipient,
          recipient_email: directoryUserEmail(selectedUser),
          source: "directory_unique_match",
          confidence: "high",
          needs_clarification: false,
          candidates: [],
          error: ""
        });
      }

      return recipientResult({
        recipient_name: namedRecipient,
        recipient_email: "",
        source: withEmail.length > 1 ? "directory_ambiguous" : "not_found",
        confidence: withEmail.length > 1 ? "ambiguous" : "none",
        needs_clarification: withEmail.length > 1,
        candidates: withEmail.slice(0, 5).map(candidateForResponse),
        error: withEmail.length > 1
          ? `Hay varias coincidencias para ${namedRecipient}.`
          : `No he encontrado email para ${namedRecipient}.`
      });
    } catch {
      return recipientResult({
        recipient_name: namedRecipient,
        recipient_email: "",
        source: "not_found",
        confidence: "none",
        needs_clarification: false,
        candidates: [],
        error: `No he encontrado email para ${namedRecipient}.`
      });
    }
  }

  return recipientResult({
    recipient_name: defaultRecipientName,
    recipient_email: "",
    source: "generic",
    confidence: "none",
    needs_clarification: false,
    candidates: [],
    error: ""
  });
}
