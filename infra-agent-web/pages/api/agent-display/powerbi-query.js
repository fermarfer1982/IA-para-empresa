import { buildPowerBiAskLabPayload, POWERBI_ASK_MODEL_KEY } from "../../../lib/powerbiNlqInterpreter";
import { runPowerBiControlledDaxLab } from "../../../lib/powerbiDaxLab";
import { getAgentDisplayPowerbiSuggestedQuestions } from "../../../lib/agentDisplayPowerbi";
import { getPowerBiModel } from "../../../lib/powerbiModels";
import { withPermission } from "../../../lib/security/apiAuth";
import { auditEvent } from "../../../lib/security/auditLogger";

const DEFAULT_ROW_LIMIT = 10;

function normalizeText(value) {
  return String(value || "").trim();
}

function stripAccents(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuestion(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModelKey(value) {
  const text = normalizeText(value).toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : "";
}

function safeError(error, fallback) {
  const message = normalizeText(error?.message || error || fallback || "No se pudo ejecutar la consulta Power BI.");
  if (/fetch failed|failed to fetch|network\s*error|econnreset|etimedout/i.test(message)) {
    return "No he podido ejecutar la consulta por un error temporal de conexión con Power BI.";
  }
  return message;
}

function inferResultType(interpretation = {}) {
  const intent = normalizeText(interpretation.intent).toLowerCase();
  if (intent === "total_metric") return "metric";
  if (intent === "top_dimension_by_metric") return "ranking";
  if (intent === "comparison_metric") return "table";
  if (intent === "metric_by_month" || intent === "metric_by_year" || intent === "metric_by_dimension") return "table";
  return "text";
}

function buildSummaryText(interpretation, execution, resultType) {
  const rowCount = Number(execution?.rowCount || 0);
  const metric = normalizeText(interpretation?.metric) === "unidades" ? "unidades" : "ventas";

  if (resultType === "metric") {
    return `Consulta de ${metric} total completada.`;
  }
  if (resultType === "ranking") {
    return `Ranking de ${metric} completado con ${rowCount} fila(s).`;
  }
  if (resultType === "table") {
    return `Tabla de ${metric} completada con ${rowCount} fila(s).`;
  }
  return "Consulta ejecutada correctamente.";
}

function buildHighlights(interpretation, execution, resultType) {
  const highlights = [];
  const rows = Array.isArray(execution?.rows) ? execution.rows : [];
  const columns = Array.isArray(execution?.columns) ? execution.columns : [];

  if (resultType === "metric" && rows[0]) {
    const firstRow = rows[0];
    const metricValue = Object.values(firstRow)[0];
    if (metricValue !== undefined) {
      highlights.push(`Valor principal: ${metricValue}.`);
    }
  }

  if (interpretation?.dimension) {
    highlights.push(`Dimensión: ${interpretation.dimension}.`);
  }

  if (columns.length) {
    highlights.push(`Columnas: ${columns.slice(0, 4).map((column) => column.name).filter(Boolean).join(", ")}.`);
  }

  if (execution?.truncated) {
    highlights.push("Mostrando solo las primeras filas disponibles.");
  }

  if (!highlights.length) {
    highlights.push("Consulta ejecutada sin incidencias visibles.");
  }

  return highlights.slice(0, 4);
}

function buildWarnings(execution) {
  const warnings = [];
  if (execution?.truncated) {
    warnings.push("Mostrando resultados principales.");
  }
  if (!Array.isArray(execution?.rows) || !execution.rows.length) {
    warnings.push("La consulta no devolvió filas visibles.");
  }
  return warnings;
}

function deriveColumns(rows, explicitColumns = []) {
  const directColumns = Array.isArray(explicitColumns)
    ? explicitColumns
        .map((column) => normalizeText(column?.name))
        .filter(Boolean)
        .map((name) => ({ name }))
    : [];
  if (directColumns.length) {
    return directColumns;
  }

  const firstRow = Array.isArray(rows) ? rows[0] : null;
  if (!firstRow || typeof firstRow !== "object") {
    return [];
  }

  return Object.keys(firstRow)
    .filter(Boolean)
    .slice(0, 8)
    .map((name) => ({ name }));
}

function isAllowedQuestion(question, suggestedQuestions) {
  const normalizedQuestion = normalizeQuestion(question);
  const allowed = Array.isArray(suggestedQuestions) ? suggestedQuestions : [];
  return allowed.some((item) => normalizeQuestion(item) === normalizedQuestion);
}

function getModelName(modelKey) {
  return getPowerBiModel(modelKey)?.displayName || "General - Informe general de ventas";
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const modelKey = normalizeModelKey(req.body?.modelKey) || POWERBI_ASK_MODEL_KEY;
  if (modelKey !== POWERBI_ASK_MODEL_KEY) {
    auditEvent({
      req,
      user: req.security?.user,
      action: "powerbi_query",
      resource: "agent-display:powerbi-query",
      allowed: false,
      details: { reason: "model_not_allowed", modelKey }
    });
    return res.status(200).json({
      ok: false,
      status: "error",
      generatedAt: new Date().toISOString(),
      modelKey,
      modelName: null,
      question: normalizeText(req.body?.question),
      headline: "Consulta Power BI no permitida",
      summary: "Solo se permite consultar el modelo administracion_ventas.",
      resultType: "text",
      columns: [],
      rows: [],
      highlights: [],
      warnings: ["Modelo no permitido."]
    });
  }

  const question = normalizeText(req.body?.question);
  const suggestedQuestions = getAgentDisplayPowerbiSuggestedQuestions(modelKey);
  if (!question || !isAllowedQuestion(question, suggestedQuestions)) {
    auditEvent({
      req,
      user: req.security?.user,
      action: "powerbi_query",
      resource: "agent-display:powerbi-query",
      allowed: false,
      details: { reason: "question_not_allowed", modelKey, questionLength: question.length }
    });
    return res.status(200).json({
      ok: false,
      status: "error",
      generatedAt: new Date().toISOString(),
      modelKey,
      modelName: getModelName(modelKey),
      question,
      headline: "Consulta Power BI no permitida",
      summary: "Solo se permiten las consultas sugeridas desde la pantalla visual.",
      resultType: "text",
      columns: [],
      rows: [],
      highlights: [],
      warnings: [
        "Usa una de las preguntas sugeridas por la pantalla visual."
      ]
    });
  }

  const interpretationRequest = buildPowerBiAskLabPayload(question, { modelKey });
  if (!interpretationRequest?.payload) {
    auditEvent({
      req,
      user: req.security?.user,
      action: "powerbi_query",
      resource: "agent-display:powerbi-query",
      allowed: false,
      details: { reason: "plan_unavailable", modelKey, questionLength: question.length }
    });
    return res.status(200).json({
      ok: false,
      status: "error",
      generatedAt: new Date().toISOString(),
      modelKey,
      modelName: getModelName(modelKey),
      question,
      headline: "Consulta Power BI no disponible",
      summary: "La pregunta no pudo convertirse en un plan de consulta seguro.",
      resultType: "text",
      columns: [],
      rows: [],
      highlights: [],
      warnings: ["No se pudo construir un plan de consulta controlado."]
    });
  }

  const payload = {
    ...interpretationRequest.payload,
    rowLimit: DEFAULT_ROW_LIMIT
  };

  try {
    const result = await runPowerBiControlledDaxLab(payload);
    const resultType = inferResultType(result);
    const generatedAt = new Date().toISOString();
    const rows = Array.isArray(result?.rows) ? result.rows.slice(0, DEFAULT_ROW_LIMIT) : [];
    const columns = deriveColumns(result?.rows || rows, result?.columns).slice(0, 8);
    const modelName = result?.model?.displayName || getModelName(modelKey);

    console.info("[agent-display-powerbi-query]", {
      modelKey,
      questionLength: question.length,
      intent: interpretationRequest.interpretation?.intent || null,
      metric: interpretationRequest.interpretation?.metric || null,
      dimension: interpretationRequest.interpretation?.dimension || null,
      resultType,
      rowCount: Number(result?.rowCount || rows.length || 0),
      truncated: Boolean(result?.truncated)
    });

    if (!result?.ok) {
      auditEvent({
        req,
        user: req.security?.user,
        action: "powerbi_query",
        resource: "agent-display:powerbi-query",
        allowed: false,
        details: {
          reason: "execution_error",
          modelKey,
          intent: interpretationRequest.interpretation?.intent || null,
          rowCount: Number(result?.rowCount || rows.length || 0)
        }
      });
      return res.status(200).json({
        ok: false,
        status: "error",
        generatedAt,
        modelKey,
        modelName,
        question,
        headline: "Consulta Power BI con aviso",
        summary: safeError(result?.error, "No se pudo ejecutar la consulta Power BI."),
        resultType,
        columns,
        rows,
        highlights: buildHighlights(interpretationRequest.interpretation, result, resultType),
        warnings: [
          ...buildWarnings(result),
          safeError(result?.error, "No se pudo ejecutar la consulta Power BI.")
        ].filter(Boolean)
      });
    }

    const summary = buildSummaryText(interpretationRequest.interpretation, result, resultType);
    const warnings = buildWarnings(result);
    auditEvent({
      req,
      user: req.security?.user,
      action: "powerbi_query",
      resource: "agent-display:powerbi-query",
      allowed: true,
      details: {
        modelKey,
        intent: interpretationRequest.interpretation?.intent || null,
        resultType,
        rowCount: Number(result?.rowCount || rows.length || 0)
      }
    });
    return res.status(200).json({
      ok: true,
      generatedAt,
      modelKey,
      modelName,
      question,
      status: "completed",
      headline: "Resultado de consulta Power BI",
      summary,
      resultType,
      columns,
      rows,
      highlights: buildHighlights(interpretationRequest.interpretation, result, resultType),
      warnings
    });
  } catch (error) {
    const generatedAt = new Date().toISOString();
    const message = safeError(error, "No se pudo ejecutar la consulta Power BI.");
    auditEvent({
      req,
      user: req.security?.user,
      action: "powerbi_query",
      resource: "agent-display:powerbi-query",
      allowed: false,
      details: { reason: "exception", modelKey, questionLength: question.length }
    });
    return res.status(200).json({
      ok: false,
      status: "error",
      generatedAt,
      modelKey,
      modelName: getModelName(modelKey),
      question,
      headline: "Consulta Power BI con aviso",
      summary: message,
      resultType: "text",
      columns: [],
      rows: [],
      highlights: [],
      warnings: [message]
    });
  }
}

export default withPermission(handler, "powerbi:query", {
  action: "powerbi_query_permission",
  resource: "agent-display:powerbi-query"
});
