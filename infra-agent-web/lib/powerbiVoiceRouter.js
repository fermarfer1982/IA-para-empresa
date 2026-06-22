import { getPowerBiVoiceHelp, getPowerBiSupportedUtterances } from "./powerbiCapabilities";
import {
  detectPowerBiIntent,
  formatPowerBiUnsupportedResponse,
  routePowerBiChatQuestion
} from "./powerbiChatRouter";

const POWERBI_VOICE_SOURCE_LABEL = "Power BI / administracion_ventas";

function normalizeText(value) {
  return String(value || "").trim();
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value ?? "");
  }
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(number);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function buildSpokenResponse(result) {
  const interpretation = result?.interpretation || {};
  const execution = result?.execution || {};
  const metric = interpretation.metric === "unidades" ? "unidades" : "ventas";
  const rows = Array.isArray(execution.rows) ? execution.rows : [];
  const rowCount = Number(execution.rowCount || rows.length || 0);

  if (!result?.handled) {
    return firstNonEmpty(
      result?.message,
      result?.rejectionReason,
      formatPowerBiUnsupportedResponse("Todavía no puedo consultar eso con seguridad.")
    );
  }

  if (interpretation.intent === "total_metric") {
    const firstRow = rows[0] || {};
    const firstNumericValue = Object.values(firstRow).find((value) => Number.isFinite(Number(value)));
    const formattedValue = formatNumber(firstNumericValue);
    if (!formattedValue) {
      return firstNonEmpty(
        result?.naturalSummary,
        result?.message,
        interpretation.metric === "unidades"
          ? "Las unidades totales están disponibles en pantalla."
          : "Las ventas totales están disponibles en pantalla."
      );
    }
    return interpretation.metric === "unidades"
      ? `Las unidades totales son aproximadamente ${formattedValue}.`
      : `Las ventas totales son aproximadamente ${formattedValue} euros.`;
  }

  if (interpretation.intent === "metric_by_month") {
    return interpretation.metric === "unidades"
      ? `He mostrado en pantalla las unidades por mes.`
      : `He mostrado en pantalla las ventas por mes.`;
  }

  if (interpretation.intent === "metric_by_year") {
    return interpretation.metric === "unidades"
      ? `He mostrado en pantalla las unidades por año.`
      : `He mostrado en pantalla las ventas por año.`;
  }

  if (interpretation.intent === "comparison_metric") {
    return `He mostrado en pantalla la comparación de ${metric}.`;
  }

  if (interpretation.intent === "top_dimension_by_metric") {
    const topN = Number(interpretation.topN || 10);
    const dimension = interpretation.dimension || "dimensión";
    return `He mostrado en pantalla los ${topN} resultados de ${metric} por ${dimension}.`;
  }

  const dimension = interpretation.dimension || "dimensión";
  const countText = rowCount ? `He mostrado en pantalla ${rowCount} resultados de ` : "He mostrado en pantalla ";
  return `${countText}${metric} por ${dimension}.`;
}

async function handlePowerBiVoiceCommand(transcript) {
  const question = normalizeText(transcript);
  const detection = detectPowerBiIntent(question);
  if (!detection.matched) {
    return {
      ok: false,
      handled: false,
      spokenResponse: "",
      visualResult: null,
      rejectionReason: "La consulta no parece ser de Power BI.",
      source: POWERBI_VOICE_SOURCE_LABEL,
      question,
      detection
    };
  }

  if (!question) {
    const rejectionReason = formatPowerBiUnsupportedResponse("La pregunta está vacía.");
    return {
      ok: true,
      handled: true,
      unsupported: true,
      spokenResponse: rejectionReason,
      visualResult: null,
      rejectionReason,
      source: POWERBI_VOICE_SOURCE_LABEL,
      question,
      detection
    };
  }

  const routed = await routePowerBiChatQuestion(question);
  if (!routed?.routed) {
    const rejectionReason = formatPowerBiUnsupportedResponse("No se pudo enrutar la consulta Power BI.");
    return {
      ok: true,
      handled: true,
      unsupported: true,
      spokenResponse: rejectionReason,
      visualResult: null,
      rejectionReason,
      source: POWERBI_VOICE_SOURCE_LABEL,
      question,
      detection,
      routed
    };
  }

  if (!routed.handled) {
    const rejectionReason = firstNonEmpty(
      routed.message,
      routed.interpretation?.clarificationQuestion,
      formatPowerBiUnsupportedResponse(routed.interpretation?.warnings?.[0] || "")
    );
    return {
      handled: true,
      spokenResponse: rejectionReason,
      visualResult: null,
      rejectionReason,
      source: POWERBI_VOICE_SOURCE_LABEL,
      question,
      detection,
      routed
    };
  }

  const visualResult = routed.formatted || null;
  const spokenResponse = buildSpokenResponse(routed);
  return {
    ok: true,
    handled: true,
    unsupported: false,
    spokenResponse,
    visualResult,
    rejectionReason: null,
    source: POWERBI_VOICE_SOURCE_LABEL,
    question,
    detection,
    routed
  };
}

function getPowerBiVoiceCommands() {
  return getPowerBiSupportedUtterances();
}

function getPowerBiVoiceHelpText() {
  return getPowerBiVoiceHelp();
}

export {
  getPowerBiVoiceCommands,
  getPowerBiVoiceHelpText,
  handlePowerBiVoiceCommand
};
