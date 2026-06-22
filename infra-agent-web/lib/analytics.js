import { getReportsForAnalytics } from "./reportsDb";

const REPORT_TYPES = ["daily_summary", "correlation_matrix", "risks", "monitoring_gaps"];
const STATUS_SCORE = {
  unknown: 0,
  green: 1,
  yellow: 2,
  red: 3
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

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "sin_fecha";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return dateKey(new Date().toISOString());
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizePriority(value) {
  const text = normalizeText(value, "unknown").toLowerCase();
  if (["critica", "crítica", "critical"].includes(text)) {
    return "critical";
  }
  if (["alta", "high"].includes(text)) {
    return "high";
  }
  if (["media", "medium", "average"].includes(text)) {
    return "medium";
  }
  if (["baja", "low", "warning"].includes(text)) {
    return "low";
  }
  return text || "unknown";
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items || []) {
    const label = normalizeText(getter(item), "Sin dato");
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function uniqueStrings(values, limit = 20) {
  const seen = new Set();
  const result = [];
  for (const value of values.flat().filter(Boolean)) {
    const text = normalizeText(value);
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

function riskLabel(risk) {
  if (typeof risk === "string") {
    return risk;
  }
  return normalizeText(
    [
      risk?.asset_or_service,
      risk?.severity,
      risk?.impact || risk?.evidence || risk?.recommended_action
    ]
      .filter(Boolean)
      .join(": ")
  );
}

function gapLabel(gap) {
  if (typeof gap === "string") {
    return gap;
  }
  return normalizeText(
    [
      gap?.block,
      gap?.asset_or_service,
      gap?.recommended_action || gap?.current_coverage
    ]
      .filter(Boolean)
      .join(": ")
  );
}

function actionLabel(action) {
  if (typeof action === "string") {
    return action;
  }
  return normalizeText(action?.action || action?.recommended_action || action?.reason);
}

function groupReportsByDay(reports) {
  const days = new Map();
  for (const report of reports || []) {
    const key = dateKey(report.created_at);
    if (!days.has(key)) {
      days.set(key, {
        date: key,
        reports: [],
        by_type: {}
      });
    }
    const day = days.get(key);
    day.reports.push(report);
    const current = day.by_type[report.type];
    if (!current || new Date(report.created_at) > new Date(current.created_at)) {
      day.by_type[report.type] = report;
    }
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function bundleForDay(day) {
  const dailyReport = day?.by_type?.daily_summary || null;
  const matrixReport = day?.by_type?.correlation_matrix || null;
  const risksReport = day?.by_type?.risks || null;
  const gapsReport = day?.by_type?.monitoring_gaps || null;
  const daily = structuredData(dailyReport);
  const matrix = structuredData(matrixReport);
  const risks = structuredData(risksReport);
  const gaps = structuredData(gapsReport);
  const missing_reports = REPORT_TYPES.filter((type) => !day?.by_type?.[type]);
  const riskItems = risks?.risks || [];
  const gapItems = gaps?.gaps || [];
  const actionItems = [
    ...(daily?.top_actions || []),
    ...(risks?.top_actions || []),
    ...(gaps?.top_actions || [])
  ];
  const matrixRows = matrix?.rows || [];
  const incidents = matrixRows.flatMap((row) => row.related_incidents || []);

  return {
    date: day?.date || null,
    report_ids: Object.fromEntries(
      REPORT_TYPES.map((type) => [type, day?.by_type?.[type]?.id || null])
    ),
    reports: {
      daily_summary: dailyReport
        ? { id: dailyReport.id, title: dailyReport.title, created_at: dailyReport.created_at }
        : null,
      correlation_matrix: matrixReport
        ? { id: matrixReport.id, title: matrixReport.title, created_at: matrixReport.created_at }
        : null,
      risks: risksReport
        ? { id: risksReport.id, title: risksReport.title, created_at: risksReport.created_at }
        : null,
      monitoring_gaps: gapsReport
        ? { id: gapsReport.id, title: gapsReport.title, created_at: gapsReport.created_at }
        : null
    },
    data: {
      daily,
      matrix,
      risks,
      gaps
    },
    overall_status: daily?.overall_status || "unknown",
    executive_summary: daily?.executive_summary || "",
    critical_risks: riskItems
      .filter((risk) => ["critical", "high"].includes(normalizePriority(risk.severity)))
      .map(riskLabel),
    all_risks: riskItems.map(riskLabel),
    monitoring_gaps: [
      ...gapItems.map(gapLabel),
      ...(matrix?.monitoring_gaps || [])
    ],
    recommended_actions: uniqueStrings([
      actionItems.map(actionLabel),
      matrixRows.map((row) => row.recommended_action)
    ], 30),
    incidents,
    matrix_rows: matrixRows,
    missing_reports
  };
}

function selectTodayAndPrevious(bundles) {
  if (!bundles.length) {
    return { today: null, previous: null, warnings: ["No hay informes estructurados guardados."] };
  }

  const warnings = [];
  const currentDay = todayKey();
  let todayIndex = bundles.findIndex((bundle) => bundle.date === currentDay);
  if (todayIndex === -1) {
    todayIndex = bundles.length - 1;
    warnings.push("No hay paquete completo de informes de hoy; se usa el último día disponible.");
  }

  return {
    today: bundles[todayIndex],
    previous: todayIndex > 0 ? bundles[todayIndex - 1] : null,
    warnings
  };
}

function diffSets(currentValues, previousValues) {
  const current = new Set((currentValues || []).filter(Boolean));
  const previous = new Set((previousValues || []).filter(Boolean));
  return {
    new: Array.from(current).filter((item) => !previous.has(item)),
    repeated: Array.from(current).filter((item) => previous.has(item)),
    resolved: Array.from(previous).filter((item) => !current.has(item))
  };
}

function incidentStatusCounts(bundle) {
  const counts = {};
  for (const incident of bundle?.incidents || []) {
    const status = normalizeText(incident.status, "Sin estado").toLowerCase();
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function buildDiff(today, previous) {
  if (!today || !previous) {
    return {
      status_change: "sin_comparativa",
      new_critical_risks: [],
      persistent_critical_risks: [],
      resolved_critical_risks: [],
      incident_changes: {},
      monitoring_gap_changes: {
        new: [],
        repeated: [],
        resolved: []
      },
      repeated_actions: []
    };
  }

  const risks = diffSets(today.critical_risks, previous.critical_risks);
  const gaps = diffSets(today.monitoring_gaps, previous.monitoring_gaps);
  const actions = diffSets(today.recommended_actions, previous.recommended_actions);
  const currentIncidents = incidentStatusCounts(today);
  const previousIncidents = incidentStatusCounts(previous);
  const incidentStatuses = Array.from(
    new Set([...Object.keys(currentIncidents), ...Object.keys(previousIncidents)])
  ).sort();

  return {
    status_change:
      today.overall_status === previous.overall_status
        ? "sin_cambio"
        : `${previous.overall_status} -> ${today.overall_status}`,
    status_score_delta:
      (STATUS_SCORE[today.overall_status] || 0) - (STATUS_SCORE[previous.overall_status] || 0),
    new_critical_risks: risks.new,
    persistent_critical_risks: risks.repeated,
    resolved_critical_risks: risks.resolved,
    incident_changes: Object.fromEntries(
      incidentStatuses.map((status) => [
        status,
        {
          previous: previousIncidents[status] || 0,
          today: currentIncidents[status] || 0,
          delta: (currentIncidents[status] || 0) - (previousIncidents[status] || 0)
        }
      ])
    ),
    monitoring_gap_changes: gaps,
    repeated_actions: actions.repeated
  };
}

function buildCharts(bundle) {
  const matrixRows = bundle?.matrix_rows || [];
  const dailyActions = bundle?.data?.daily?.top_actions || [];
  const risks = bundle?.data?.risks?.risks || [];
  const gapsActions = bundle?.data?.gaps?.top_actions || [];
  return {
    incidents_by_status: countBy(bundle?.incidents || [], (incident) => incident.status),
    risks_by_priority: countBy(
      risks.length ? risks : matrixRows,
      (item) => normalizePriority(item.severity || item.priority)
    ),
    correlations_by_level: countBy(matrixRows, (row) => row.correlation_level),
    actions_by_type: countBy(
      matrixRows.length ? matrixRows : [...dailyActions, ...gapsActions],
      (item) => item.task_type || item.owner_type
    )
  };
}

function buildSeries(bundles) {
  return {
    overall_status: bundles.map((bundle) => ({
      date: bundle.date,
      value: bundle.overall_status,
      score: STATUS_SCORE[bundle.overall_status] || 0
    })),
    critical_risks: bundles.map((bundle) => ({
      date: bundle.date,
      value: bundle.critical_risks.length
    })),
    monitoring_gaps: bundles.map((bundle) => ({
      date: bundle.date,
      value: bundle.monitoring_gaps.length
    })),
    recommended_actions: bundles.map((bundle) => ({
      date: bundle.date,
      value: bundle.recommended_actions.length
    }))
  };
}

function publicBundle(bundle) {
  if (!bundle) {
    return null;
  }
  return {
    date: bundle.date,
    report_ids: bundle.report_ids,
    reports: bundle.reports,
    overall_status: bundle.overall_status,
    executive_summary: bundle.executive_summary,
    critical_risks: bundle.critical_risks,
    monitoring_gaps: bundle.monitoring_gaps,
    recommended_actions: bundle.recommended_actions,
    counts: {
      risks: bundle.all_risks.length,
      critical_risks: bundle.critical_risks.length,
      monitoring_gaps: bundle.monitoring_gaps.length,
      recommended_actions: bundle.recommended_actions.length,
      incidents: bundle.incidents.length,
      matrix_rows: bundle.matrix_rows.length
    },
    missing_reports: bundle.missing_reports
  };
}

export async function buildAnalyticsSummary(options = {}) {
  const days = Math.max(2, Math.min(Number(options.days) || 14, 90));
  const reports = await getReportsForAnalytics({ days });
  const dayGroups = groupReportsByDay(reports);
  const bundles = dayGroups.map(bundleForDay);
  const selected = selectTodayAndPrevious(bundles);
  const warnings = [...selected.warnings];

  if (selected.today?.missing_reports?.length) {
    warnings.push(`Faltan informes en el día analizado: ${selected.today.missing_reports.join(", ")}.`);
  }
  if (!selected.previous) {
    warnings.push("No hay suficiente histórico para comparar.");
    warnings.push("La comparativa estará disponible cuando existan informes de varios días.");
    warnings.push("Genera más informes diarios para ver evolución.");
  }

  return {
    generated_at: new Date().toISOString(),
    today: publicBundle(selected.today),
    previous: publicBundle(selected.previous),
    diff: buildDiff(selected.today, selected.previous),
    series: buildSeries(bundles),
    charts: buildCharts(selected.today),
    warnings
  };
}

export async function buildAnalyticsReports(options = {}) {
  const days = Math.max(1, Math.min(Number(options.days) || 7, 90));
  const reports = await getReportsForAnalytics({ days });
  const bundles = groupReportsByDay(reports).map(bundleForDay);
  return {
    generated_at: new Date().toISOString(),
    days,
    reports: bundles.map((bundle) => ({
      date: bundle.date,
      ids: bundle.report_ids,
      overall_status: bundle.overall_status,
      risks_count: bundle.all_risks.length,
      critical_risks_count: bundle.critical_risks.length,
      monitoring_gaps_count: bundle.monitoring_gaps.length,
      actions_count: bundle.recommended_actions.length,
      missing_reports: bundle.missing_reports,
      complete: bundle.missing_reports.length === 0
    }))
  };
}
