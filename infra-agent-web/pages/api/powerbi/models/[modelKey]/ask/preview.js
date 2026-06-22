import { buildPowerBiAskLabPayload, interpretPowerBiQuestion, POWERBI_ASK_MODEL_KEY } from "../../../../../../lib/powerbiNlqInterpreter";
import { buildPowerBiControlledDax, validatePowerBiControlledDax } from "../../../../../../lib/powerbiDaxLab";

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
    return "No he podido previsualizar la consulta por un error temporal de conexión con Power BI. Reintenta la consulta o revisa el estado del modelo.";
  }
  return message;
}

function isRecoverableAskError(message) {
  return /No puedo|No he podido|Todav[ií]a|pregunta|topN|dimensi[oó]n|m[eé]trica|fecha|filtro temporal|DAX generado|payload|Power BI/i.test(
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
  console.info("[powerbi-ask-preview]", {
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
    const { payload } = buildPowerBiAskLabPayload(question, { modelKey });
    if (!payload) {
      return recoverableAskResponse(res, {
        error: "No se pudo convertir la pregunta en un payload de DAX Lab.",
        interpretation
      });
    }

    const built = await buildPowerBiControlledDax(payload);
    const validated = await validatePowerBiControlledDax({
      ...payload,
      dax: built.dax
    });

    if (!validated?.validation?.ok) {
      return recoverableAskResponse(res, {
        error: "El DAX generado no pasó la validación del laboratorio.",
        interpretation,
        daxLabPayload: payload,
        dax: built.dax,
        validation: validated?.validation || null
      });
    }

    return res.status(200).json({
      ok: true,
      interpretation,
      daxLabPayload: payload,
      semanticPlan: interpretation?.plan || null,
      logicalPage: interpretation?.logicalPage || payload?.logicalPage || null,
      dateField: built.dateField || null,
      dimensionField: built.dimensionField || null,
      dimensionValidation: built.dimensionValidation || null,
      dax: built.dax,
      validation: validated.validation
    });
  } catch (error) {
    const message = safeAskError(error, "No se pudo previsualizar la consulta natural.");
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
