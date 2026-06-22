import { buildPowerBiAskLabPayload, interpretPowerBiQuestion, POWERBI_ASK_MODEL_KEY } from "../../../../../../lib/powerbiNlqInterpreter";
import { runPowerBiControlledDaxLab } from "../../../../../../lib/powerbiDaxLab";

function normalizeModelKey(value) {
  const text = String(value || "").trim().toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : "";
}

function canProceed(interpretation) {
  if (!interpretation) {
    return false;
  }
  if (interpretation.needsClarification) {
    return false;
  }
  if (Number(interpretation.confidence || 0) < 0.75) {
    return false;
  }
  return !Array.isArray(interpretation.warnings)
    ? true
    : !interpretation.warnings.some((warning) =>
        /No puedo responder eso todavía|No puedo usar filtros temporales|pregunta está vacía|demasiado larga|topN debe estar|más de una dimensión posible|métrica por pregunta/i.test(
          String(warning || "")
        )
      );
}

function safeAskError(error, fallback) {
  const message = String(error?.message || error || fallback || "No se pudo procesar la consulta Power BI.").trim();
  if (/fetch failed|failed to fetch|network\s*error|econnreset|etimedout/i.test(message)) {
    return "No he podido ejecutar la consulta por un error temporal de conexión con Power BI. Reintenta la consulta o revisa el estado del modelo.";
  }
  return message;
}

function isRecoverableAskError(message) {
  return /No puedo|No he podido|Todav[ií]a|pregunta|topN|dimensi[oó]n|m[eé]trica|fecha|filtro temporal|DAX generado|payload|consulta interpretada|Power BI/i.test(
    String(message || "")
  );
}

function recoverableAskResponse(res, payload = {}) {
  return res.status(200).json({
    ok: false,
    recoverable: true,
    ...payload
  });
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

function buildNaturalSummary(interpretation, execution) {
  if (!execution) {
    return "";
  }

  if (interpretation.intent === "total_metric") {
    const firstRow = Array.isArray(execution.rows) ? execution.rows[0] || {} : {};
    const value = Object.values(firstRow)[0];
    const label = interpretation.metric === "unidades" ? "Unidades totales" : "Ventas totales";
    return `${label}: ${formatNumber(value)}.`;
  }

  if (interpretation.intent === "metric_by_month") {
    return `He generado ${execution.rowCount || 0} filas mensuales para ${interpretation.metric === "unidades" ? "unidades" : "ventas"}.`;
  }

  if (interpretation.intent === "metric_by_year") {
    return `He generado ${execution.rowCount || 0} filas anuales para ${interpretation.metric === "unidades" ? "unidades" : "ventas"}.`;
  }

  if (interpretation.intent === "comparison_metric") {
    const metricText = interpretation.metric === "unidades" ? "unidades" : "ventas";
    const label = String(interpretation.comparison?.label || "").trim();
    const yearMatch = label.match(/\b(20\d{2})\s+vs\s+(20\d{2})\b/i);
    if (yearMatch) {
      return `He comparado ${metricText} de ${yearMatch[1]} contra ${yearMatch[2]}.`;
    }
    return `He comparado ${metricText}${label ? `: ${label}` : ""}.`;
  }

  const metricLabel = interpretation.metric === "unidades" ? "unidades" : "ventas";
  const dimensionLabel = interpretation.dimension || "dimensión";
  const rankingLabel = interpretation.ranking?.order === "asc" ? "Bottom" : "Top";
  const topText =
    interpretation.intent === "top_dimension_by_metric" && interpretation.topN
      ? `${rankingLabel} ${interpretation.topN} `
      : "";
  return `He generado ${topText}${metricLabel} por ${dimensionLabel} con ${execution.rowCount || 0} filas.`;
}

function getReusableDaxLabPayload(req, question, modelKey) {
  const payload = req.body?.daxLabPayload || req.body?.plan || null;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (String(payload.modelKey || "").trim().toLowerCase() !== modelKey) {
    return null;
  }
  if (String(payload.question || "").trim() !== question) {
    return null;
  }
  if (!payload.intent || !payload.metric) {
    return null;
  }
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const modelKey = normalizeModelKey(req.query?.modelKey);
  if (modelKey !== POWERBI_ASK_MODEL_KEY) {
    return res.status(400).json({
      ok: false,
      error: "v0.17.6 solo permite administracion_ventas."
    });
  }

  const question = String(req.body?.question || "").trim();
  const interpretation = interpretPowerBiQuestion(question, { modelKey });
  console.info("[powerbi-ask-execute]", {
    modelKey,
    questionLength: question.length,
    questionNormalized: interpretation?.normalizedQuestion || null,
    intent: interpretation?.intent || null,
    metric: interpretation?.metric || null,
    dimension: interpretation?.dimension || null,
    dateRange: interpretation?.dateRange?.label || null,
    ranking: interpretation?.ranking?.label || null,
    timeRange: interpretation?.timeRange || null,
    canProceed: canProceed(interpretation)
  });
  if (!canProceed(interpretation)) {
    return recoverableAskResponse(res, {
      error:
        interpretation.clarificationQuestion ||
        interpretation.warnings?.[0] ||
        "No puedo interpretar esa pregunta todavía con seguridad.",
      interpretation
    });
  }

  try {
    const plannedPayload = getReusableDaxLabPayload(req, question, modelKey);
    const { payload } = plannedPayload
      ? { payload: plannedPayload }
      : buildPowerBiAskLabPayload(question, { modelKey });
    if (!payload) {
      return recoverableAskResponse(res, {
        error: "No se pudo convertir la pregunta en un payload de DAX Lab.",
        interpretation
      });
    }

    const result = await runPowerBiControlledDaxLab(payload);
    if (!result?.ok) {
      const resultError = safeAskError(result?.error, "No se pudo ejecutar la consulta interpretada.");
      return recoverableAskResponse(res, {
        type: result?.type || null,
        error: resultError,
        interpretation,
        daxLabPayload: payload,
        dax: result?.dax || null,
        validation: result?.validation || null,
        dimensionValidation: result?.dimensionValidation || null,
        candidates: result?.candidates || null
      });
    }

    return res.status(200).json({
      ok: true,
      interpretation,
      daxLabPayload: payload,
      semanticPlan: interpretation?.plan || payload?.semanticPlan || null,
      logicalPage: interpretation?.logicalPage || payload?.logicalPage || null,
      dateField: result.dateField || null,
      dimensionField: result.dimensionField || null,
      dimensionValidation: result.dimensionValidation || null,
      dax: result.dax,
      validation: result.validation,
      execution: {
        rowLimit: result.rowLimit,
        rowCount: result.rowCount,
        truncated: result.truncated,
        rows: Array.isArray(result.rows) ? result.rows : []
      },
      summary: result.summary || null,
      naturalSummary: buildNaturalSummary(interpretation, result)
    });
  } catch (error) {
    const message = safeAskError(error, "No se pudo ejecutar la consulta natural.");
    if (isRecoverableAskError(message)) {
      return recoverableAskResponse(res, {
        error: message,
        interpretation
      });
    }
    return res.status(400).json({
      ok: false,
      error: message
    });
  }
}
