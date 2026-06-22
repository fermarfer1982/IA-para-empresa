import { POWERBI_ASK_MODEL_KEY } from "./powerbiNlqInterpreter";
import { getPowerBiVoiceHelp } from "./powerbiCapabilities";

const POWERBI_ASK_INTERPRET_URL = `/api/powerbi/models/${POWERBI_ASK_MODEL_KEY}/ask/interpret`;
const POWERBI_ASK_EXECUTE_URL = `/api/powerbi/models/${POWERBI_ASK_MODEL_KEY}/ask/execute`;
const SUPPORTED_CHAT_LABEL = "Power BI / administracion_ventas";

const EXPLICIT_CHAT_PATTERNS = [
  /^\s*power\s*bi\b[:\-\s]*/i,
  /^\s*consulta\s+power\s*bi\b[:\-\s]*/i,
  /^\s*pregunta\s+a\s+power\s*bi\b[:\-\s]*/i,
  /^\s*consulta\s+ventas\b[:\-\s]*/i,
  /^\s*pregunta\s+a\s+ventas\b[:\-\s]*/i,
  /^\s*ventas\s+por\s+/i,
  /^\s*ventas\b/i,
  /^\s*unidades\s+por\s+/i,
  /^\s*unidades\b/i,
  /^\s*(?:productos?|clientes?|representantes?|pa[ií]ses?)\s+(?:euros?|importe|€|ventas?|unidades?|uds?|cantidad)\b/i,
  /^\s*productos?\s+m[aá]s\s+vendidos?\b/i,
  /^\s*(?:clientes?|productos?|art[ií]culos?|familias?|representantes?|pa[ií]ses?|variedad(?:es)?)\s+menos\s+vendid[oa]s?\b/i,
  /^\s*(?:clientes?|productos?|art[ií]culos?|familias?|representantes?|pa[ií]ses?)\s+con\s+menos\s+(ventas|unidades)\b/i,
  /^\s*(?:bottom|peores?|[uú]ltimos?)\s+.+\s+por\s+(?:ventas|unidades)\b/i,
  /^\s*(?:producto|art[ií]culo|familia|tipo|especie|variedad|pa[ií]s|representante)\s+m[aá]s\s+vendid[oa]\b/i,
  /^\s*(?:qu[eé]|cu[aá]l)\s+(?:cliente|producto|art[ií]culo|familia|tipo|especie|variedad|pa[ií]s|representante).+\b(?:m[aá]s\s+vendid[oa]|vendid[oa]\s+m[aá]s|ventas?|factura|unidades?)\b/i,
  /^\s*principales?\s+(clientes?|productos?|art[ií]culos?|familias?|representantes?|pa[ií]ses?)\b/i,
  /^\s*mejores?\s+(clientes?|productos?|art[ií]culos?|familias?|representantes?|pa[ií]ses?)\b/i,
  /^\s*peores?\s+(clientes?|productos?|art[ií]culos?|familias?|representantes?|pa[ií]ses?)\b/i,
  /^\s*(clientes?|productos?|art[ií]culos?|familias?|representantes?|pa[ií]ses?)\s+con\s+m[aá]s\s+(ventas|unidades)\b/i,
  /^\s*top\s+(?:\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte)\s+.+\s+por\s+ventas\b/i,
  /^\s*top\s+(?:\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte)\s+.+\s+por\s+unidades\b/i,
  /^\s*comparar\s+(?:ventas|unidades)\b/i,
  /^\s*ventas?\s+por\s+pa[ií]s\b/i,
  /^\s*unidades?\s+por\s+pa[ií]s\b/i,
  /^\s*cu[aá]nto\s+hemos\s+vendido\b/i,
  /^\s*cu[aá]nto\s+se\s+(?:ha\s+)?(?:vendido|vend[ií]o)\b/i,
  /^\s*cu[aá]nto\s+se\s+ha\s+vendido\b/i,
  /^\s*cu[aá]ntas?\s+unidades?\s+hemos\s+vendido\b/i,
  /^\s*total\s+de\s+ventas\b/i,
  /^\s*total\s+de\s+unidades\b/i
];

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
    .replace(/[^\p{L}\p{N}\s€]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingPowerBiTrigger(message) {
  const raw = normalizeText(message);
  if (!raw) {
    return "";
  }
  return raw
    .replace(/^\s*power\s*bi\b[:\-\s]*/i, "")
    .replace(/^\s*consulta\s+power\s*bi\b[:\-\s]*/i, "")
    .replace(/^\s*pregunta\s+a\s+power\s*bi\b[:\-\s]*/i, "")
    .trim();
}

function buildUnsupportedMessage(reason) {
  const helpText = getPowerBiVoiceHelp();
  const base =
    String(reason || "").trim() ||
    "Todavía no puedo consultar eso con seguridad.";

  if (/No puedo responder eso todavía/i.test(base)) {
    return `Todavía no puedo consultar margen o rentabilidad. ${helpText}`;
  }

  if (/No puedo usar filtros temporales|Todavía no puedo usar ese filtro temporal/i.test(base)) {
    return `Ese filtro temporal no está soportado todavía. Puedo consultar este año, este mes, este trimestre, últimos 12 meses, año pasado, mes pasado, hoy o ayer. ${helpText}`;
  }

  if (/topN debe estar|topN .* supera el máximo/i.test(base)) {
    return "El top solicitado supera el límite permitido. Ahora puedo mostrar como máximo 20 resultados.";
  }

  if (/pregunta está vacía/i.test(base)) {
    return "La pregunta está vacía. Escribe una pregunta corta sobre ventas o unidades.";
  }

  if (/demasiado larga/i.test(base)) {
    return "La pregunta es demasiado larga. Escribe una pregunta más corta sobre ventas o unidades.";
  }

  if (/margen|rentabil|beneficio/i.test(base)) {
    return `Todavía no puedo consultar margen o rentabilidad. ${helpText}`;
  }

  if (/fecha|compar/i.test(base)) {
    return `Ese filtro temporal no está soportado todavía. Puedo consultar este año, este mes, este trimestre, últimos 12 meses, año pasado, mes pasado, hoy o ayer. ${helpText}`;
  }

  if (/todos los clientes|exporta todos los datos|listado completo|masiva/i.test(base)) {
    return `Todavía no puedo hacer exportaciones masivas o listados completos. ${helpText}`;
  }

  if (/dax|evaluate|summarizecolumns|define|info|dmv/i.test(base)) {
    return `No puedo ejecutar DAX manual. ${helpText}`;
  }

  if (/topN|top 100|máximo|maximo/i.test(base)) {
    return "El top solicitado supera el límite permitido. Ahora puedo mostrar como máximo 20 resultados.";
  }

  return `Todavía no puedo consultar eso con seguridad. ${helpText}`;
}

function formatPowerBiChatAnswer(result) {
  const interpretation = result?.interpretation || {};
  const execution = result?.execution || {};
  const rowCount = Number(execution.rowCount || 0);
  const truncated = Boolean(execution.truncated);
  const rows = Array.isArray(execution.rows) ? execution.rows : [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const metricLabel = interpretation.metric === "unidades" ? "Unidades" : "Ventas";
  const dimensionLabel = interpretation.dimension || "";
  let headline = result?.naturalSummary || "";

  if (!headline) {
    if (interpretation.intent === "total_metric") {
      headline = `${metricLabel} totales.`;
    } else if (interpretation.intent === "metric_by_month") {
      headline = `Consulta mensual de ${metricLabel.toLowerCase()}.`;
    } else if (interpretation.intent === "top_dimension_by_metric") {
      headline = `Top ${interpretation.topN || 10} ${metricLabel.toLowerCase()} por ${dimensionLabel}.`;
    } else if (dimensionLabel) {
      headline = `${metricLabel} por ${dimensionLabel}.`;
    } else {
      headline = `${metricLabel}.`;
    }
  }

  return {
    sourceLabel: SUPPORTED_CHAT_LABEL,
    headline,
    rowCount,
    truncated,
    rowLimit: Number(execution.rowLimit || rows.length || 0),
    rows,
    columns,
    interpretation,
    dax: result?.dax || null,
    daxLabPayload: result?.daxLabPayload || null,
    naturalSummary: result?.naturalSummary || null,
    summary: result?.summary || null
  };
}

function detectPowerBiIntent(message) {
  const text = normalizeText(message);
  if (!text) {
    return {
      matched: false,
      reason: "La pregunta está vacía."
    };
  }

  const normalized = normalizeMessage(text);
  const matched =
    EXPLICIT_CHAT_PATTERNS.some((pattern) => pattern.test(text)) ||
    normalized.includes("power bi") ||
    normalized.startsWith("consulta ventas") ||
    normalized.startsWith("pregunta a ventas");

  return {
    matched,
    normalized,
    cleanedQuestion: stripLeadingPowerBiTrigger(text),
    trigger: matched ? "powerbi" : null
  };
}

async function routePowerBiChatQuestion(message) {
  const detection = detectPowerBiIntent(message);
  if (!detection.matched) {
    return {
      routed: false,
      detection
    };
  }

  const question = normalizeText(detection.cleanedQuestion || message);
  if (!question) {
    return {
      routed: true,
      handled: false,
      kind: "unsupported",
      sourceLabel: SUPPORTED_CHAT_LABEL,
      message: buildUnsupportedMessage("La pregunta está vacía."),
      detection
    };
  }

  const interpretResponse = await fetch(POWERBI_ASK_INTERPRET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question })
  });

  const interpretation = await interpretResponse.json().catch(() => ({}));
  if (!interpretResponse.ok) {
    return {
      routed: true,
      handled: false,
      kind: "unsupported",
      sourceLabel: SUPPORTED_CHAT_LABEL,
      message: buildUnsupportedMessage(interpretation.error || "No puedo interpretar esa pregunta."),
      detection
    };
  }

  if (
    interpretation.needsClarification ||
    Number(interpretation.confidence || 0) < 0.75 ||
    (Array.isArray(interpretation.warnings) &&
      interpretation.warnings.some((warning) =>
        /No puedo responder eso todavía|No puedo usar filtros temporales|Todavía no puedo usar ese filtro temporal|pregunta está vacía|demasiado larga|topN debe estar|más de una dimensión posible|métrica por pregunta/i.test(
          String(warning || "")
        )
      ))
  ) {
    const firstWarning = Array.isArray(interpretation.warnings) ? interpretation.warnings[0] : "";
    const shouldUseFriendlyUnsupportedMessage = /No puedo responder eso todavía|No puedo usar filtros temporales|Todavía no puedo usar ese filtro temporal|topN debe estar|topN .* supera el máximo|pregunta está vacía|demasiado larga/i.test(
      String(firstWarning || "")
    );

    return {
      routed: true,
      handled: false,
      kind: "clarification",
      sourceLabel: SUPPORTED_CHAT_LABEL,
      interpretation,
      message: shouldUseFriendlyUnsupportedMessage
        ? buildUnsupportedMessage(firstWarning || interpretation.clarificationQuestion || "")
        : interpretation.clarificationQuestion ||
          buildUnsupportedMessage(firstWarning || "No puedo interpretar esa pregunta con seguridad."),
      detection
    };
  }

  const executeResponse = await fetch(POWERBI_ASK_EXECUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question })
  });

  const executionResult = await executeResponse.json().catch(() => ({}));
  if (!executeResponse.ok || !executionResult.ok) {
    return {
      routed: true,
      handled: false,
      kind: "unsupported",
      sourceLabel: SUPPORTED_CHAT_LABEL,
      interpretation,
      message: buildUnsupportedMessage(executionResult.error || "No se pudo ejecutar la consulta de Power BI."),
      detection
    };
  }

  const formatted = formatPowerBiChatAnswer(executionResult);
  return {
    routed: true,
    handled: true,
    kind: "answer",
    sourceLabel: SUPPORTED_CHAT_LABEL,
    interpretation: executionResult.interpretation || interpretation,
    execution: executionResult.execution || null,
    naturalSummary: executionResult.naturalSummary || "",
    message: formatted.headline,
    formatted,
    detection
  };
}

export {
  buildUnsupportedMessage as formatPowerBiUnsupportedResponse,
  detectPowerBiIntent,
  formatPowerBiChatAnswer,
  routePowerBiChatQuestion
};
