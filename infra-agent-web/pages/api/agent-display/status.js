import { composeLatestDashboard } from "../../../lib/dashboardComposer";
import {
  buildAgentDisplayExecutiveReport,
  buildAgentDisplayPresentationPlan
} from "../../../lib/agentDisplayReport";
import { buildAgentDisplayPowerbiSummary } from "../../../lib/agentDisplayPowerbi";
import { getLatestProblems } from "../../../lib/zabbixLiveClient";
import { withPermission } from "../../../lib/security/apiAuth";

const REQUEST_TIMEOUT_MS = 4500;

function withTimeout(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), REQUEST_TIMEOUT_MS);
    })
  ]);
}

function emptyPayload(overrides = {}) {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dataSource: "fallback",
    agentStatus: "idle",
    headline: "Estado general de infraestructura",
    agentMessage:
      "Centro de control preparado. Todavia no hay datos live suficientes para mostrar un resumen operativo completo.",
    infrastructureSummary: {
      status: "unknown",
      totalHosts: null,
      problems: null,
      criticalProblems: null,
      warningProblems: null
    },
    criticalAlerts: [],
    powerbiSummary: {
      status: "not_connected",
      source: "fallback",
      modelKey: null,
      modelName: null,
      headline: "Power BI pendiente de conexión",
      message: "Power BI pendiente de conexion en esta pantalla",
      kpis: [],
      insights: [],
      updatedAt: null,
      businessSummary: {
        title: "Lectura ejecutiva pendiente",
        summary: "Power BI pendiente de conexión en esta pantalla.",
        highlights: [],
        watchItems: [],
        suggestedQuestions: []
      }
    },
    activeReport: null,
    recommendations: [],
    presentation: {
      recommendedView: "overview",
      reason: "Sin datos suficientes; mostrando resumen general seguro",
      priority: "low",
      rotateSeconds: 15,
      source: "fallback"
    },
    ...overrides
  };
}

function normalizePriority(value) {
  return String(value || "unknown").trim().toLowerCase();
}

function isCritical(priority) {
  return ["disaster", "critical", "critica", "high", "alta"].includes(normalizePriority(priority));
}

function isWarning(priority) {
  return ["average", "medium", "warning", "media", "advertencia"].includes(normalizePriority(priority));
}

function statusFromCounts(criticalProblems, warningProblems, totalProblems) {
  if (criticalProblems > 0) {
    return "critical";
  }
  if (warningProblems > 0 || totalProblems > 0) {
    return "warning";
  }
  if (totalProblems === 0) {
    return "ok";
  }
  return "unknown";
}

function pickLatestReport(latestReports = {}) {
  const reports = Object.values(latestReports || {}).filter(Boolean);
  if (!reports.length) {
    return null;
  }
  return reports.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0];
}

function buildRecommendations(dashboard) {
  const topActions = Array.isArray(dashboard?.top_actions) ? dashboard.top_actions : [];
  return topActions
    .map((action) => ({
      priority: action.priority || "unknown",
      text: action.action || action.reason || ""
    }))
    .filter((item) => item.text)
    .slice(0, 5);
}

function buildCriticalAlerts(zabbixProblems, dashboard) {
  const zabbixAlerts = (zabbixProblems?.items || []).map((item, index) => ({
    id: item.id || item.eventid || `ZBX-${index + 1}`,
    title: item.title || "Problema activo",
    detail: item.detail || "",
    severity: item.priority || "unknown",
    source: zabbixProblems.source || "Zabbix / Monitorizacion"
  }));

  const dashboardAlerts = (dashboard?.critical_risks || []).map((risk, index) => ({
    id: `RISK-${index + 1}`,
    title: String(risk || "Riesgo critico").slice(0, 140),
    detail: "",
    severity: "critical",
    source: "Informes estructurados"
  }));

  return [...zabbixAlerts, ...dashboardAlerts].slice(0, 6);
}

async function buildPayload({ dashboard, zabbixProblems }) {
  const problemItems = zabbixProblems?.ok ? zabbixProblems.items || [] : [];
  const criticalProblems = problemItems.filter((item) => isCritical(item.priority)).length;
  const warningProblems = problemItems.filter((item) => isWarning(item.priority)).length;
  const totalProblems = zabbixProblems?.ok ? Number(zabbixProblems.total ?? problemItems.length) : null;
  const latestReport = pickLatestReport(dashboard?.latest_reports);
  const firewallSummary = dashboard?.firewalls || null;
  const infrastructureStatus = statusFromCounts(criticalProblems, warningProblems, totalProblems);
  const hasRealZabbix = Boolean(zabbixProblems?.ok);
  const hasReports = Boolean(latestReport);
  const dataSource = hasRealZabbix ? "real" : hasReports ? "fallback" : "mock";
  const criticalAlerts = buildCriticalAlerts(zabbixProblems, dashboard);
  const recommendations = buildRecommendations(dashboard);
  const generatedAt = new Date().toISOString();
  const infrastructureSummary = {
    status: infrastructureStatus,
    totalHosts: null,
    problems: totalProblems,
    criticalProblems,
    warningProblems
  };
  const executiveReport = buildAgentDisplayExecutiveReport({
    dashboard,
    zabbixProblems,
    infrastructureSummary,
    criticalAlerts,
    recommendations,
    latestReport,
    generatedAt,
    dataSource
  });
  const powerbiSummary = await withTimeout(buildAgentDisplayPowerbiSummary(), {
    status: "not_connected",
    source: "fallback",
    modelKey: null,
    modelName: null,
    headline: "Power BI pendiente de conexión",
    message: "Power BI pendiente de conexion en esta pantalla",
    kpis: [],
    insights: [],
    updatedAt: generatedAt
  });
  const presentation = buildAgentDisplayPresentationPlan({
    infrastructureSummary,
    criticalAlerts,
    recommendations,
    activeReport: executiveReport,
    powerbiSummary,
    dataSource
  });
  const attentionHeadline =
    presentation.recommendedView === "report"
      ? "Informe critico disponible"
      : presentation.recommendedView === "alerts"
        ? `${criticalAlerts.filter((item) => {
            const severity = String(item?.severity || "").toLowerCase();
            return severity === "critical" || severity === "high" || severity === "disaster";
          }).length} problemas criticos requieren atencion`
        : presentation.recommendedView === "recommendations"
          ? `${recommendations.filter((item) => {
              const priority = String(item?.priority || item?.severity || "").toLowerCase();
              return priority === "critical" || priority === "high" || priority === "disaster";
            }).length || recommendations.length} acciones recomendadas pendientes`
          : infrastructureStatus === "critical"
            ? "Estado general de infraestructura en alerta"
            : "Estado general de infraestructura";

  const agentStatus =
    infrastructureStatus === "critical"
      ? "alert"
      : hasReports
        ? "reporting"
        : "idle";

  return emptyPayload({
    generatedAt,
    dataSource,
    agentStatus,
    headline: attentionHeadline,
    agentMessage:
      presentation.recommendedView === "report"
        ? "Informe ejecutivo listo para priorizar."
        : presentation.recommendedView === "alerts"
          ? `${criticalAlerts.filter((item) => {
              const severity = String(item?.severity || "").toLowerCase();
              return severity === "critical" || severity === "high" || severity === "disaster";
            }).length} alertas de alta prioridad requieren revision.`
          : presentation.recommendedView === "recommendations"
            ? `${recommendations.length} acciones recomendadas disponibles para priorizar.`
            : criticalAlerts.length > 0
              ? `Hay ${criticalAlerts.length} elementos destacados para revisar.`
              : "No hay alertas criticas destacadas en este momento.",
    infrastructureSummary,
    firewallSummary,
    criticalAlerts,
    powerbiSummary,
    activeReport: executiveReport,
    recommendations,
    presentation
  });
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  try {
    const [dashboardResult, zabbixResult] = await Promise.allSettled([
      withTimeout(composeLatestDashboard(), null),
      withTimeout(getLatestProblems({ limit: 8 }), { ok: false, error: "timeout" })
    ]);

    const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
    const zabbixProblems = zabbixResult.status === "fulfilled" ? zabbixResult.value : null;
    const payload = await buildPayload({ dashboard, zabbixProblems });

    return res.status(200).json(payload);
  } catch {
    return res.status(200).json(
      emptyPayload({
        dataSource: "fallback",
        agentStatus: "idle",
        agentMessage: "No se pudo leer el estado live. Mantengo la pantalla en modo fallback seguro."
      })
    );
  }
}

export default withPermission(handler, "display:view", {
  action: "display_status",
  resource: "agent-display:status"
});
