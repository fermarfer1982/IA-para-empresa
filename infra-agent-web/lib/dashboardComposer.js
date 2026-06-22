import { getLatestReportByType } from "./reportsDb";
import { getFirewallStatus } from "./firewallStatus";

const REPORT_TYPES = {
  daily_summary: "daily_summary",
  correlation_matrix: "correlation_matrix",
  risks: "risks",
  monitoring_gaps: "monitoring_gaps"
};

function parseMetadata(report) {
  if (!report?.metadata_json) {
    return null;
  }

  try {
    return typeof report.metadata_json === "string"
      ? JSON.parse(report.metadata_json)
      : report.metadata_json;
  } catch {
    return null;
  }
}

function structuredData(report) {
  return parseMetadata(report)?.structured_data || null;
}

function statusFromSeverity(severity) {
  if (["critical", "critica", "high", "alta"].includes(String(severity).toLowerCase())) {
    return "red";
  }
  if (["medium", "media"].includes(String(severity).toLowerCase())) {
    return "yellow";
  }
  if (["low", "baja"].includes(String(severity).toLowerCase())) {
    return "green";
  }
  return "gray";
}

function card(id, title, value, status, description, sourceReportId) {
  return {
    id,
    title,
    value,
    status,
    description,
    source_report_id: sourceReportId || null
  };
}

function uniqueStrings(values, limit = 8) {
  const seen = new Set();
  const result = [];

  for (const value of values.flat().filter(Boolean)) {
    const text = String(value).trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function topSeverity(items, field = "severity") {
  const order = ["critical", "critica", "high", "alta", "medium", "media", "low", "baja"];
  const values = items.map((item) => String(item?.[field] || "").toLowerCase());
  for (const severity of order) {
    if (values.includes(severity)) {
      return severity;
    }
  }
  return "unknown";
}

function normalizePriority(priority) {
  return String(priority || "unknown").toLowerCase();
}

function composeCards({
  dailyReport,
  daily,
  matrixReport,
  matrix,
  risksReport,
  risks,
  gapsReport,
  gaps,
  firewallStatus
}) {
  const keyFindings = daily?.key_findings || [];
  const topActions = daily?.top_actions || [];
  const rows = matrix?.rows || [];
  const riskItems = risks?.risks || [];
  const gapItems = gaps?.gaps || [];
  const confirmedImpact = matrix?.confirmed_impact || [];
  const criticalWithoutTicket = matrix?.critical_without_ticket || [];
  return [
    card(
      "overall_status",
      "Estado general",
      daily?.overall_status || "Sin datos",
      daily?.overall_status === "red"
        ? "red"
        : daily?.overall_status === "yellow"
          ? "yellow"
          : daily?.overall_status === "green"
            ? "green"
            : "gray",
      daily?.executive_summary || "Genera un informe diario estructurado para alimentar esta tarjeta.",
      dailyReport?.id
    ),
    card(
      "confirmed_impact",
      "Impacto confirmado en usuarios",
      confirmedImpact.length || rows.filter((row) => /confirm/i.test(row.user_impact || "")).length,
      confirmedImpact.length ? "red" : rows.length ? "yellow" : "gray",
      confirmedImpact[0] || "Sin impacto confirmado registrado en la última matriz.",
      matrixReport?.id
    ),
    card(
      "critical_risks",
      "Riesgos críticos",
      riskItems.filter((risk) => ["critical", "high"].includes(normalizePriority(risk.severity))).length,
      statusFromSeverity(topSeverity(riskItems)),
      riskItems[0]?.recommended_action || "Genera riesgos estructurados para priorizar esta tarjeta.",
      risksReport?.id
    ),
    card(
      "firewalls",
      "Firewalls / Red perimetral",
      firewallStatus?.count || 0,
      firewallStatus?.summary?.status === "critical"
        ? "red"
        : firewallStatus?.summary?.activeProblems || firewallStatus?.gaps?.length
          ? "yellow"
          : "green",
      firewallStatus?.hosts?.length
        ? `${firewallStatus.hosts.slice(0, 3).join(", ")}${firewallStatus.hosts.length > 3 ? "..." : ""}`
        : "No hay firewalls clasificados en el dashboard actual.",
      firewallStatus?.sourceReportId || null
    ),
    card(
      "critical_without_ticket",
      "Críticos sin ticket",
      criticalWithoutTicket.length,
      criticalWithoutTicket.length ? "red" : rows.length ? "green" : "gray",
      criticalWithoutTicket[0] || "Sin críticos sin ticket en la última matriz.",
      matrixReport?.id
    ),
    card(
      "monitoring_gaps",
      "Huecos de monitorización",
      gapItems.length || (matrix?.monitoring_gaps || []).length,
      gapItems.some((gap) => ["critical", "high"].includes(normalizePriority(gap.priority))) ? "red" : gapItems.length ? "yellow" : "gray",
      gapItems[0]?.recommended_action || matrix?.monitoring_gaps?.[0] || "Genera huecos estructurados para alimentar esta tarjeta.",
      gapsReport?.id || matrixReport?.id
    ),
    card(
      "top_actions",
      "Acciones recomendadas",
      topActions.length || risks?.top_actions?.length || gaps?.top_actions?.length || 0,
      topActions.some((action) => ["critical", "high"].includes(normalizePriority(action.priority))) ? "red" : topActions.length ? "yellow" : "gray",
      topActions[0]?.action || risks?.top_actions?.[0]?.action || gaps?.top_actions?.[0]?.action || "Genera informes estructurados para obtener acciones.",
      dailyReport?.id || risksReport?.id || gapsReport?.id
    )
  ];
}

export async function composeLatestDashboard() {
  const [dailyReport, matrixReport, risksReport, gapsReport] = await Promise.all([
    getLatestReportByType(REPORT_TYPES.daily_summary),
    getLatestReportByType(REPORT_TYPES.correlation_matrix),
    getLatestReportByType(REPORT_TYPES.risks),
    getLatestReportByType(REPORT_TYPES.monitoring_gaps)
  ]);
  const firewallStatus = await getFirewallStatus({ limit: 20 });

  const daily = structuredData(dailyReport);
  const matrix = structuredData(matrixReport);
  const risks = structuredData(risksReport);
  const gaps = structuredData(gapsReport);
  const missingReports = [];

  if (!daily) {
    missingReports.push("daily_summary");
  }
  if (!matrix) {
    missingReports.push("correlation_matrix");
  }
  if (!risks) {
    missingReports.push("critical_risks");
  }
  if (!gaps) {
    missingReports.push("monitoring_gaps");
  }

  const dates = [dailyReport, matrixReport, risksReport, gapsReport]
    .map((report) => report?.created_at)
    .filter(Boolean)
    .sort();

  const topActions = [
    ...(daily?.top_actions || []),
    ...(risks?.top_actions || []),
    ...(gaps?.top_actions || []),
    ...(firewallStatus?.gaps || []).map((gap) => ({
      priority: gap.priority || "medium",
      action: `Firewall ${gap.host || ""}: ${gap.missing_check || "revisar métricas"}`.trim(),
      reason: gap.description || "Completar métricas del firewall.",
      owner_type: gap.requires_human_action ? "revision_humana" : "automatizable"
    }))
  ].slice(0, 8);

  const correlationPreview = (matrix?.rows || []).slice(0, 8).map((row) => ({
    asset_or_service: row.asset_or_service,
    priority: row.priority,
    correlation_level: row.correlation_level,
    user_impact: row.user_impact,
    recommended_action: row.recommended_action
  }));

  return {
    updated_at: dates.length ? dates[dates.length - 1] : new Date().toISOString(),
    overall_status: daily?.overall_status || "unknown",
    cards: composeCards({
      dailyReport,
      daily,
      matrixReport,
      matrix,
      risksReport,
      risks,
      gapsReport,
      gaps,
      firewallStatus
    }),
    top_actions: topActions.map((action) => ({
      priority: action.priority || "unknown",
      action: action.action || "",
      reason: action.reason || "",
      owner_type: action.owner_type || "revision_humana"
    })),
    correlation_preview: correlationPreview,
    monitoring_gaps: uniqueStrings([
      matrix?.monitoring_gaps || [],
      (gaps?.gaps || []).map((gap) => `${gap.block}: ${gap.recommended_action}`),
      (firewallStatus?.gaps || []).map(
        (gap) => `Firewalls / Red perimetral: ${gap.host || "firewall"} - ${gap.description || gap.missing_check || "sin detalle"}`
      )
    ]),
    critical_risks: uniqueStrings([
      matrix?.critical_without_ticket || [],
      (risks?.risks || []).map((risk) => `${risk.asset_or_service}: ${risk.impact}`)
    ]),
    missing_reports: missingReports,
    latest_reports: {
      daily_summary: dailyReport ? { id: dailyReport.id, title: dailyReport.title, created_at: dailyReport.created_at } : null,
      correlation_matrix: matrixReport ? { id: matrixReport.id, title: matrixReport.title, created_at: matrixReport.created_at } : null,
      critical_risks: risksReport ? { id: risksReport.id, title: risksReport.title, created_at: risksReport.created_at } : null,
      monitoring_gaps: gapsReport ? { id: gapsReport.id, title: gapsReport.title, created_at: gapsReport.created_at } : null
    },
    firewalls: firewallStatus
  };
}
