function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizeLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  if (["disaster", "critical", "critica", "high", "alta"].includes(level)) {
    return "critical";
  }
  if (["average", "medium", "warning", "media", "advertencia"].includes(level)) {
    return "warning";
  }
  if (["ok", "low", "info", "information", "baja"].includes(level)) {
    return "info";
  }
  return "info";
}

function normalizeSeverity(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (["critical", "critica", "red"].includes(severity)) {
    return "critical";
  }
  if (["warning", "yellow"].includes(severity)) {
    return "warning";
  }
  if (["ok", "green"].includes(severity)) {
    return "ok";
  }
  return "unknown";
}

function suggestedActionForAlert(alert) {
  const text = `${alert?.title || ""} ${alert?.detail || ""}`.toLowerCase();

  if (/raid|smart|hdd|disk|disco|battery|bateria|storage|latency/.test(text)) {
    return "Revisar almacenamiento, confirmar redundancia y planificar sustitucion o remediacion.";
  }
  if (/backup|pbs|copia/.test(text)) {
    return "Validar ultimo backup util, retencion y prueba de restauracion.";
  }
  if (/memory|cpu|load|latencia|latency/.test(text)) {
    return "Revisar consumo y tendencia antes de que impacte a usuarios.";
  }
  if (/network|snmp|interface|red/.test(text)) {
    return "Comprobar conectividad, monitorizacion SNMP y estado del enlace.";
  }

  return "Asignar revision tecnica, confirmar impacto y registrar seguimiento.";
}

function buildSummary({ severity, criticalProblems, warningProblems, totalProblems }) {
  if (severity === "critical") {
    return `Infraestructura en estado critico: ${criticalProblems} problemas de alta prioridad y ${warningProblems} avisos requieren revision.`;
  }
  if (severity === "warning") {
    return `Infraestructura con avisos activos: ${warningProblems || totalProblems || 0} elementos deben revisarse para evitar degradacion.`;
  }
  if (severity === "ok") {
    return "Infraestructura sin alertas criticas destacadas en este momento.";
  }
  return "Estado de infraestructura parcialmente disponible; se mantiene informe fallback hasta tener datos suficientes.";
}

function buildHighlights({ dashboard, infrastructureSummary, criticalAlerts, recommendations, latestReport, source }) {
  const totalProblems = infrastructureSummary.problems;
  const criticalProblems = infrastructureSummary.criticalProblems;
  const warningProblems = infrastructureSummary.warningProblems;
  const highlights = [];

  if (totalProblems !== null && totalProblems !== undefined) {
    highlights.push(`${totalProblems} problemas activos o recientes detectados en monitorizacion.`);
  }
  if (criticalProblems) {
    highlights.push(`${criticalProblems} problemas criticos o de alta prioridad requieren atencion.`);
  }
  if (warningProblems) {
    highlights.push(`${warningProblems} avisos permanecen pendientes de revision.`);
  }
  if (criticalAlerts.length) {
    highlights.push(`${criticalAlerts.length} alertas destacadas alimentan el panel ejecutivo.`);
  }
  if (recommendations.length) {
    highlights.push(`${recommendations.length} recomendaciones operativas disponibles para priorizar.`);
  }
  if (latestReport?.title) {
    highlights.push(`Ultimo informe estructurado usado como contexto: ${latestReport.title}.`);
  }
  if (dashboard?.firewalls?.count) {
    highlights.push(
      `${dashboard.firewalls.count} firewalls / red perimetral detectados: ${dashboard.firewalls.hosts.slice(0, 3).join(", ")}.`
    );
  }
  if (!highlights.length) {
    highlights.push(
      source === "fallback"
        ? "Datos insuficientes para un informe completo; se muestra fallback seguro."
        : "No se han detectado riesgos criticos destacados en la muestra actual."
    );
  }

  return highlights.slice(0, 5);
}

function buildRisks(criticalAlerts) {
  const risks = criticalAlerts.slice(0, 4).map((alert) => ({
    level: normalizeLevel(alert?.severity),
    title: cleanText(alert?.title, "Riesgo operativo detectado"),
    detail: cleanText(alert?.detail || alert?.source, "Alerta procedente de monitorizacion."),
    suggestedAction: suggestedActionForAlert(alert)
  }));

  if (risks.length) {
    return risks;
  }

  return [
    {
      level: "info",
      title: "Sin riesgos criticos destacados",
      detail: "No hay alertas criticas en los datos disponibles para esta pantalla.",
      suggestedAction: "Mantener seguimiento y refrescar el informe periodicamente."
    }
  ];
}

function buildNextActions(recommendations, risks) {
  const actions = recommendations
    .map((item) => cleanText(item?.text || item?.action || item?.reason))
    .filter(Boolean)
    .slice(0, 5);

  if (actions.length) {
    return actions;
  }

  return risks
    .map((risk) => risk.suggestedAction)
    .filter(Boolean)
    .slice(0, 4);
}

function getPriorityScore(value) {
  const level = String(value || "").trim().toLowerCase();
  if (["disaster", "critical", "critica"].includes(level)) {
    return 3;
  }
  if (["high", "alta", "warning", "medium", "average"].includes(level)) {
    return 2;
  }
  if (["ok", "info", "information", "low", "baja"].includes(level)) {
    return 1;
  }
  return 0;
}

export function buildAgentDisplayPresentationPlan({
  infrastructureSummary = {},
  criticalAlerts = [],
  recommendations = [],
  activeReport = null,
  powerbiSummary = null,
  dataSource = "fallback"
} = {}) {
  const safeAlerts = safeArray(criticalAlerts);
  const safeRecommendations = safeArray(recommendations);
  const reportSeverity = normalizeSeverity(activeReport?.severity || infrastructureSummary?.status);
  const alertPriority = safeAlerts
    .map((alert) => getPriorityScore(alert?.severity))
    .reduce((highest, current) => Math.max(highest, current), 0);
  const recommendationPriority = safeRecommendations
    .map((item) => getPriorityScore(item?.priority || item?.severity))
    .reduce((highest, current) => Math.max(highest, current), 0);
  const infrastructurePriority = getPriorityScore(infrastructureSummary?.status);

  let recommendedView = "overview";
  let reason = "Resumen general disponible";
  let priority = "low";

  if (reportSeverity === "critical") {
    recommendedView = "report";
    reason = "Informe crítico disponible";
    priority = "critical";
  } else if (alertPriority >= 3) {
    recommendedView = "alerts";
    reason = "Alertas de alta prioridad activas";
    priority = "critical";
  } else if (recommendationPriority >= 3) {
    recommendedView = "recommendations";
    reason = "Recomendaciones de alta prioridad pendientes";
    priority = "warning";
  } else if (infrastructurePriority >= 2) {
    recommendedView = "overview";
    reason = "Estado general con incidencias pendientes";
    priority = "warning";
  } else if (
    powerbiSummary?.status === "connected" &&
    (
      safeArray(powerbiSummary?.kpis).length ||
      safeArray(powerbiSummary?.insights).length ||
      safeArray(powerbiSummary?.businessSummary?.highlights).length ||
      safeArray(powerbiSummary?.businessSummary?.suggestedQuestions).length
    )
  ) {
    recommendedView = "powerbi";
    reason = "Power BI conectado con datos útiles";
    priority = "low";
  } else if (powerbiSummary?.status === "not_connected") {
    recommendedView = "overview";
    reason = "Power BI pendiente; priorizando infraestructura";
    priority = "low";
  }

  if (dataSource === "fallback" && recommendedView === "overview" && !safeAlerts.length && !safeRecommendations.length) {
    reason = "Sin datos suficientes; mostrando resumen general seguro";
  }

  return {
    recommendedView,
    reason,
    priority,
    rotateSeconds: 15,
    source: dataSource === "real" ? "real" : "fallback"
  };
}

export function buildAgentDisplayExecutiveReport({
  dashboard = null,
  zabbixProblems = null,
  infrastructureSummary = {},
  criticalAlerts = [],
  recommendations = [],
  latestReport = null,
  generatedAt = new Date().toISOString(),
  dataSource = "fallback"
} = {}) {
  const safeInfrastructure = {
    status: infrastructureSummary?.status || "unknown",
    totalHosts: infrastructureSummary?.totalHosts ?? null,
    problems: infrastructureSummary?.problems ?? null,
    criticalProblems: infrastructureSummary?.criticalProblems ?? 0,
    warningProblems: infrastructureSummary?.warningProblems ?? 0
  };
  const safeAlerts = safeArray(criticalAlerts);
  const safeRecommendations = safeArray(recommendations);
  const source = zabbixProblems?.ok || dashboard ? dataSource : "fallback";
  const severity = normalizeSeverity(safeInfrastructure.status);
  const risks = buildRisks(safeAlerts);
  const nextActions = buildNextActions(safeRecommendations, risks);
  const summary = buildSummary({
    severity,
    criticalProblems: safeInfrastructure.criticalProblems,
    warningProblems: safeInfrastructure.warningProblems,
    totalProblems: safeInfrastructure.problems
  });

  return {
    id: latestReport?.id || "agent-display-executive",
    type: "agent_display_executive",
    title: "Informe ejecutivo de infraestructura",
    generatedAt,
    updatedAt: generatedAt,
    status: source === "fallback" ? "Fallback seguro" : "Disponible",
    severity,
    summary,
    highlights: buildHighlights({
      dashboard,
      infrastructureSummary: safeInfrastructure,
      criticalAlerts: safeAlerts,
      recommendations: safeRecommendations,
      latestReport,
      source
    }),
    risks,
    nextActions,
    source,
    sourceReportId: latestReport?.id || null,
    sourceReportTitle: latestReport?.title || null
  };
}
