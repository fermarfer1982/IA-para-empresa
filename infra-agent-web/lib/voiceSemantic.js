import { composeLatestDashboard } from "./dashboardComposer";
import {
  getOpenIncidents,
  getRecentIncidents,
  getUrgentIncidents
} from "./incidentsLiveClient";
import { getLatestReportByType } from "./reportsDb";

const REPORT_TYPES = ["daily_summary", "correlation_matrix", "risks", "monitoring_gaps"];

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

function getStructuredData(report) {
  return parseMetadata(report)?.structured_data || null;
}

function text(value) {
  return String(value || "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function compactItem(item) {
  if (!item) {
    return null;
  }

  if (typeof item === "string") {
    return {
      title: item,
      detail: "",
      priority: "unknown",
      source: "structured_reports"
    };
  }

  return item;
}

function uniqueItems(items, limit = 8) {
  const seen = new Set();
  const result = [];

  for (const rawItem of items.map(compactItem).filter(Boolean)) {
    const key = lower(
      `${rawItem.title || ""} ${rawItem.asset_or_service || ""} ${rawItem.action || ""} ${
        rawItem.detail || rawItem.description || rawItem.recommended_action || ""
      }`
    );
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(rawItem);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function includesAny(value, words) {
  const normalized = lower(value);
  return words.some((word) => normalized.includes(lower(word)));
}

function reportReference(report) {
  return report ? { id: report.id, title: report.title, created_at: report.created_at } : null;
}

function isToday(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.toDateString() === new Date().toDateString();
}

async function loadVoiceContext() {
  const [dashboard, dailyReport, matrixReport, risksReport, gapsReport] = await Promise.all([
    composeLatestDashboard(),
    getLatestReportByType("daily_summary"),
    getLatestReportByType("correlation_matrix"),
    getLatestReportByType("risks"),
    getLatestReportByType("monitoring_gaps")
  ]);

  return {
    dashboard,
    reports: {
      daily_summary: dailyReport,
      correlation_matrix: matrixReport,
      risks: risksReport,
      monitoring_gaps: gapsReport
    },
    data: {
      daily: getStructuredData(dailyReport),
      matrix: getStructuredData(matrixReport),
      risks: getStructuredData(risksReport),
      gaps: getStructuredData(gapsReport)
    }
  };
}

function sourceReports(reports) {
  return Object.fromEntries(
    Object.entries(reports).map(([type, report]) => [type, reportReference(report)])
  );
}

function missingData(ctx, extra = []) {
  return uniqueItems([...(ctx.dashboard?.missing_reports || []), ...extra], 8).map(
    (item) => item.title
  );
}

function response(ctx, topic, title, summary, items, extra = {}) {
  const normalizedItems = uniqueItems(items, extra.limit || 8);
  return {
    ok: true,
    topic,
    title,
    ordering: extra.ordering || "live read",
    summary:
      summary ||
      (normalizedItems.length
        ? `Encontrados ${normalizedItems.length} elementos relevantes.`
        : "No hay datos estructurados suficientes para responder con detalle."),
    updated_at: ctx.dashboard?.updated_at || null,
    items: normalizedItems,
    missing_data: missingData(ctx, extra.missing_data || []),
    recommended_action:
      extra.recommended_action ||
      (ctx.dashboard?.missing_reports?.length
        ? "Actualiza el dashboard para regenerar los informes estructurados."
        : "Revisar los elementos listados y priorizar intervención humana cuando aplique."),
    source_reports: sourceReports(ctx.reports)
  };
}

function incidentVoiceItem(incident) {
  if (!incident) {
    return null;
  }

  const creatorName = incident.creator_name || incident.created_by_name || incident.requester || "";
  const creatorEmail = incident.creator_email || incident.created_by_email || "";

  return {
    title: incident.title || "Incidencia",
    id: incident.id || "",
    status: incident.status || "unknown",
    asset_or_service: incident.affected_system || incident.category || "",
    detail: [incident.description, incident.comments].filter(Boolean).join(" · "),
    priority: incident.priority || "unknown",
    creator_name: creatorName,
    creator_email: creatorEmail,
    recommended_action: "",
    source: "incidenciasti_live"
  };
}

async function loadLiveIncidents({ days = 365, limit = 500 } = {}) {
  const result = await getRecentIncidents({ days, limit });
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    ordering: result.ordering || "created desc / id desc",
    incidents: (result.incidents || []).map(incidentVoiceItem).filter(Boolean)
  };
}

export async function getOpenIncidentsVoice() {
  const ctx = await loadVoiceContext();
  const open = await getOpenIncidents({ limit: 25 });
  const items = open.ok ? (open.incidents || []).map(incidentVoiceItem).filter(Boolean) : [];

  return response(
    ctx,
    "open_incidents",
    "Incidencias abiertas",
    items.length ? `Hay ${items.length} incidencias abiertas en IncidenciasTI.` : "No encuentro incidencias abiertas en IncidenciasTI.",
    items,
    {
      ordering: open.ordering || "created desc / id desc",
      missing_data: items.length ? [] : ["No hay incidencias abiertas en IncidenciasTI o no se pudo consultar el MCP."],
      recommended_action: items.length
        ? "Prioriza las abiertas con impacto confirmado o riesgo técnico alto."
        : "Consulta de nuevo o revisa la conectividad del MCP de IncidenciasTI."
    }
  );
}

export async function getIncidentsInProgressVoice() {
  const ctx = await loadVoiceContext();
  let recent;
  try {
    recent = await loadLiveIncidents({ days: 60, limit: 200 });
  } catch (error) {
    recent = {
      ok: false,
      ordering: "created desc / id desc",
      incidents: [],
      error: error?.message || "No se pudo consultar IncidenciasTI live."
    };
  }
  const items = recent.ok
    ? (recent.incidents || []).filter((incident) =>
        includesAny(incident.status, ["en curso", "curso", "progress", "pendiente", "review", "working"])
      )
    : [];

  return response(
    ctx,
    "incidents_in_progress",
    "Incidencias en curso",
    items.length ? `Hay ${items.length} incidencias en curso en IncidenciasTI.` : "No encuentro incidencias en curso en IncidenciasTI.",
    items,
    {
      ordering: recent.ordering || "created desc / id desc",
      missing_data: items.length
        ? []
        : [
            recent.error
              ? `No se pudo consultar IncidenciasTI live: ${recent.error}`
              : "No hay incidencias en curso visibles en IncidenciasTI."
          ],
      recommended_action: items.length
        ? "Revisa bloqueos, antigüedad, prioridad y estado."
        : "Este endpoint no es crítico para preparar borradores; reintenta IncidenciasTI live si necesitas esta lista."
    }
  );
}

export async function getCriticalRisksVoice() {
  const ctx = await loadVoiceContext();
  const riskItems = [
    ...(ctx.data.risks?.risks || []).map((risk) => ({
      title: risk.asset_or_service,
      detail: risk.impact || risk.evidence,
      priority: risk.severity,
      recommended_action: risk.recommended_action,
      source: risk.source || "critical_risks"
    })),
    ...(ctx.dashboard?.critical_risks || []).map((risk) => ({
      title: risk,
      detail: "",
      priority: "high",
      source: "dashboard_latest"
    }))
  ];

  return response(
    ctx,
    "critical_risks",
    "Riesgos críticos",
    riskItems.length
      ? `Hay ${uniqueItems(riskItems).length} riesgos críticos o altos en los informes actuales.`
      : "No hay riesgos críticos estructurados disponibles.",
    riskItems,
    {
      recommended_action: "Atiende primero riesgos de datos, backups, storage, NAS y servicios con impacto de usuario."
    }
  );
}

export async function getStorageBackupStatusVoice() {
  const ctx = await loadVoiceContext();
  const keywords = [
    "nas",
    "backup",
    "backups",
    "pbs",
    "proxmox",
    "storage",
    "datastore",
    "smart",
    "raid",
    "disco",
    "NasAlmeria",
    "perdida de datos"
  ];
  const candidates = [
    ...(ctx.data.risks?.risks || []).map((risk) => ({
      title: risk.asset_or_service,
      detail: `${risk.evidence || ""} ${risk.impact || ""}`,
      priority: risk.severity,
      recommended_action: risk.recommended_action,
      source: risk.source || "critical_risks"
    })),
    ...(ctx.data.matrix?.rows || []).map((row) => ({
      title: row.asset_or_service,
      detail: `${row.technical_problem || ""} ${row.technical_risk || ""} ${row.zabbix_evidence || ""}`,
      priority: row.priority,
      recommended_action: row.recommended_action,
      source: "correlation_matrix"
    })),
    ...(ctx.data.daily?.key_findings || []).map((finding) => ({
      title: finding.title,
      detail: finding.description,
      priority: finding.severity,
      recommended_action: finding.recommended_action,
      source: finding.source
    }))
  ];
  const items = candidates.filter((item) =>
    includesAny(
      `${item.title} ${item.detail} ${item.recommended_action}`,
      keywords
    )
  );

  return response(
    ctx,
    "storage_backup_status",
    "Estado NAS, storage y backups",
    items.length
      ? `Encontré ${uniqueItems(items).length} elementos relacionados con NAS, storage o backups.`
      : "No hay datos estructurados suficientes sobre NAS, storage o backups en los últimos informes.",
    items,
    {
      recommended_action: items.length
        ? "Prioriza cualquier riesgo de pérdida de datos y confirma backups antes de cambios."
        : "Actualiza dashboard y genera riesgos críticos para obtener estado reciente."
    }
  );
}

export async function getMonitoringGapsVoice() {
  const ctx = await loadVoiceContext();
  const items = [
    ...(ctx.data.gaps?.gaps || []).map((gap) => ({
      title: `${gap.block}: ${gap.asset_or_service}`,
      detail: gap.current_coverage,
      priority: gap.priority,
      recommended_action: gap.recommended_action,
      source: "monitoring_gaps",
      missing_checks: gap.missing_checks || []
    })),
    ...(ctx.dashboard?.monitoring_gaps || []).map((gap) => ({
      title: gap,
      detail: "",
      priority: "medium",
      source: "dashboard_latest"
    }))
  ];

  return response(
    ctx,
    "monitoring_gaps",
    "Huecos de monitorización",
    items.length
      ? `Hay ${uniqueItems(items).length} huecos de monitorización destacados.`
      : "No hay huecos estructurados disponibles.",
    items,
    {
      recommended_action: "Prioriza huecos que afecten a datos, backups, NAS, red, SAIs y servicios críticos."
    }
  );
}

export async function getTodayActionsVoice() {
  const ctx = await loadVoiceContext();
  const items = [
    ...(ctx.dashboard?.top_actions || []).map((action) => ({
      title: action.action,
      detail: action.reason,
      priority: action.priority,
      owner_type: action.owner_type,
      source: "dashboard_latest"
    })),
    ...(ctx.data.daily?.top_actions || []).map((action) => ({
      title: action.action,
      detail: action.reason,
      priority: action.priority,
      owner_type: action.owner_type,
      source: "daily_summary"
    }))
  ];

  return response(
    ctx,
    "today_actions",
    "Acciones recomendadas para hoy",
    items.length
      ? `Hay ${uniqueItems(items).length} acciones recomendadas para priorizar hoy.`
      : "No hay acciones estructuradas disponibles.",
    items,
    {
      recommended_action: "Empieza por acciones críticas y por las que requieren confirmación humana."
    }
  );
}

export async function getMorningBriefingVoice() {
  const ctx = await loadVoiceContext();
  const risks = [
    ...(ctx.dashboard?.critical_risks || []).map((risk) => ({
      title: risk,
      detail: "",
      priority: "high",
      source: "dashboard_latest"
    })),
    ...(ctx.data.risks?.risks || []).map((risk) => ({
      title: risk.asset_or_service,
      detail: risk.impact || risk.evidence,
      priority: risk.severity,
      recommended_action: risk.recommended_action,
      source: risk.source || "critical_risks"
    }))
  ];
  const urgentIncidents = await getUrgentIncidents({ limit: 4 });
  const incidents = urgentIncidents.ok
    ? (urgentIncidents.incidents || []).map(incidentVoiceItem).filter(Boolean)
    : [];
  const actions = [
    ...(ctx.dashboard?.top_actions || []),
    ...(ctx.data.daily?.top_actions || [])
  ].map((action) => ({
    title: action.action,
    detail: action.reason,
    priority: action.priority,
    owner_type: action.owner_type,
    source: "daily_summary"
  }));
  const gaps = (ctx.dashboard?.monitoring_gaps || []).map((gap) => ({
    title: gap,
    detail: "",
    priority: "medium",
    source: "dashboard_latest"
  }));
  const items = [...risks, ...incidents, ...actions, ...gaps];
  const topThree = uniqueItems(actions.length ? actions : items, 3)
    .map((item) => item.title)
    .filter(Boolean);

  return response(
    ctx,
    "morning_briefing",
    "Briefing de mañana",
    `Estado general ${ctx.dashboard?.overall_status || "unknown"}. ${
      risks.length
        ? `Hay ${uniqueItems(risks).length} riesgos críticos o altos.`
        : "No hay riesgos críticos estructurados destacados."
    } ${
      incidents.length
        ? `Hay ${incidents.length} incidencias relacionadas con impacto o correlación.`
        : "No hay incidencias correlacionadas destacadas."
    } ${
      topThree.length
        ? `Estas son las tres acciones que priorizaría hoy: ${topThree.join("; ")}.`
        : "No hay tres acciones priorizadas disponibles."
    }`,
    items,
    {
      ordering: urgentIncidents.ok ? urgentIncidents.ordering || "created desc / id desc" : "live read",
      recommended_action: topThree.length
        ? `Prioriza: ${topThree.join("; ")}.`
        : "Actualiza el dashboard si necesitas un briefing con acciones priorizadas.",
      missing_data: ctx.dashboard?.missing_reports || [],
      limit: 10
    }
  );
}

export async function getTodayReportVoice() {
  const ctx = await loadVoiceContext();
  const report = ctx.reports.daily_summary;
  const daily = ctx.data.daily;
  const generatedToday = isToday(report?.created_at);
  const items = [
    ...(daily?.key_findings || []).map((finding) => ({
      title: finding.title,
      detail: finding.description,
      priority: finding.severity,
      recommended_action: finding.recommended_action,
      source: finding.source || "daily_summary"
    })),
    ...(daily?.top_actions || []).map((action) => ({
      title: action.action,
      detail: action.reason,
      priority: action.priority,
      owner_type: action.owner_type,
      source: "daily_summary"
    }))
  ];

  return response(
    ctx,
    "today_report",
    generatedToday ? "Informe de hoy" : "Último informe diario",
    daily?.executive_summary ||
      (report
        ? "Hay un informe diario guardado, pero no contiene resumen estructurado."
        : "No hay informe diario guardado."),
    items,
    {
      missing_data: generatedToday
        ? []
        : ["No hay informe diario generado hoy. Puedes pedir: genera el informe de hoy."],
      recommended_action: generatedToday
        ? "Usa las acciones principales para priorizar la jornada."
        : "Genera el informe de hoy antes de tomar decisiones operativas.",
      limit: 10
    }
  );
}

export async function getLatestMatrixVoice() {
  const ctx = await loadVoiceContext();
  const report = ctx.reports.correlation_matrix;
  const matrix = ctx.data.matrix;
  const items = (matrix?.rows || []).map((row) => ({
    title: row.asset_or_service,
    detail: `${row.technical_problem || ""} ${row.user_impact || ""}`.trim(),
    priority: row.priority,
    status: row.correlation_level,
    recommended_action: row.recommended_action,
    source: "correlation_matrix"
  }));

  return response(
    ctx,
    "latest_matrix",
    "Última matriz de correlación",
    matrix?.summary ||
      (report
        ? "Hay una matriz guardada, pero no contiene filas estructuradas."
        : "No hay matriz de correlación guardada."),
    items,
    {
      missing_data: report ? [] : ["Genera una matriz de correlación para alimentar esta vista."],
      recommended_action: items.length
        ? "Atiende primero filas con correlación alta, impacto de usuario y prioridad crítica o alta."
        : "Genera matriz estructurada o actualiza dashboard.",
      limit: 8
    }
  );
}

export async function searchVoice(query) {
  const ctx = await loadVoiceContext();
  const q = text(query).slice(0, 120);
  if (!q) {
    return response(
      ctx,
      "search",
      "Búsqueda operativa",
      "Falta texto de búsqueda.",
      [],
      {
        missing_data: ["Indica un activo, sistema o término, por ejemplo impresoras, Seedtek o NasAlmeria."],
        recommended_action: "Repite la búsqueda con un término concreto."
      }
    );
  }

  const liveIncidents = await searchIncidents(q, { limit: 50 }).catch(() => ({ ok: false }));
  const fallbackIncidents = await getOpenIncidents({ limit: 50 }).catch(() => ({ ok: false }));
  const candidates = [
    ...(liveIncidents.ok ? (liveIncidents.incidents || []).map(incidentVoiceItem).filter(Boolean) : []),
    ...(fallbackIncidents.ok ? (fallbackIncidents.incidents || []).map(incidentVoiceItem).filter(Boolean) : []),
    ...(ctx.data.matrix?.rows || []).map((row) => ({
      title: row.asset_or_service,
      detail: `${row.technical_problem || ""} ${row.user_impact || ""} ${row.technical_risk || ""}`,
      priority: row.priority,
      recommended_action: row.recommended_action,
      source: "correlation_matrix"
    })),
    ...(ctx.data.risks?.risks || []).map((risk) => ({
      title: risk.asset_or_service,
      detail: `${risk.evidence || ""} ${risk.impact || ""}`,
      priority: risk.severity,
      recommended_action: risk.recommended_action,
      source: risk.source || "critical_risks"
    })),
    ...(ctx.data.gaps?.gaps || []).map((gap) => ({
      title: `${gap.block}: ${gap.asset_or_service}`,
      detail: `${gap.current_coverage || ""} ${(gap.missing_checks || []).join(", ")}`,
      priority: gap.priority,
      recommended_action: gap.recommended_action,
      source: "monitoring_gaps"
    })),
    ...(ctx.data.daily?.key_findings || []).map((finding) => ({
      title: finding.title,
      detail: finding.description,
      priority: finding.severity,
      recommended_action: finding.recommended_action,
      source: finding.source
    }))
  ];
  const terms = lower(q)
    .split(/\s+/)
    .filter((term) => term.length >= 3);
  const items = candidates.filter((item) => {
    const haystack = lower(
      `${item.title || ""} ${item.id || ""} ${item.status || ""} ${item.asset_or_service || ""} ${
        item.detail || ""
      } ${item.recommended_action || ""}`
    );
    return terms.length ? terms.some((term) => haystack.includes(term)) : haystack.includes(lower(q));
  });

  return response(
    ctx,
    "search",
    `Búsqueda: ${q}`,
    items.length
      ? `Encontré ${uniqueItems(items).length} resultados relacionados con "${q}".`
      : `No encontré resultados estructurados para "${q}".`,
    items,
    {
      ordering: liveIncidents.ok ? liveIncidents.ordering || "created desc / id desc" : "live read",
      missing_data: items.length ? [] : ["Puede que haga falta actualizar dashboard o generar matriz de correlación."],
      recommended_action: items.length
        ? "Revisa los resultados y contrasta si hay impacto de usuario o riesgo técnico."
        : "Actualiza el dashboard o busca con otro nombre del activo."
    }
  );
}
