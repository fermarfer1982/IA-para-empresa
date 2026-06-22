import { buildAnalyticsReports, buildAnalyticsSummary } from "./analytics";
import { getLatestReportByType, getReport } from "./reportsDb";

const EXPORT_VERSION = "v0.15";

const SECRET_KEY_PATTERN =
  /(^|_)(api_?key|client_?secret|secret|token|password|workflow_?id|authorization)(_|$)/i;
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /OPENAI_API_KEY\s*=\s*\S+/gi,
  /OPENAI_WORKFLOW_ID\s*=\s*\S+/gi,
  /client_secret\s*[:=]\s*\S+/gi,
  /Authorization:\s*Bearer\s+\S+/gi,
  /MCP_SHARED_TOKEN\s*=\s*\S+/gi,
  /GRAPH_CLIENT_SECRET\s*=\s*\S+/gi,
  /PBS_TOKEN_SECRET\s*=\s*\S+/gi,
  /PROXMOX_TOKEN_SECRET\s*=\s*\S+/gi,
  /ZABBIX_TOKEN\s*=\s*\S+/gi
];

const REPORT_TYPE_LABELS = {
  daily_summary: "Informe diario",
  correlation_matrix: "Matriz de correlacion",
  risks: "Riesgos criticos",
  monitoring_gaps: "Huecos de monitorizacion",
  analytics: "Analisis operativo"
};

const MATRIX_CSV_COLUMNS = [
  "asset_or_service",
  "technical_problem",
  "related_incidents",
  "zabbix_evidence",
  "correlation_level",
  "user_impact",
  "technical_risk",
  "priority",
  "recommended_action",
  "task_type"
];

function safeJsonParse(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function redactText(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_VALUE_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text;
}

function sanitizeForExport(value, key = "") {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForExport(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeForExport(entryValue, entryKey)
      ])
    );
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  return value;
}

function parseReportMetadata(report) {
  return safeJsonParse(report?.metadata_json) || {};
}

function structuredData(report) {
  return parseReportMetadata(report)?.structured_data || null;
}

function reportRef(report) {
  if (!report) {
    return null;
  }
  return {
    id: report.id,
    type: report.type,
    title: redactText(report.title),
    created_at: report.created_at,
    created_by: redactText(report.created_by || "")
  };
}

function exportJson(payload) {
  return `${JSON.stringify(sanitizeForExport(payload), null, 2)}\n`;
}

function escapeHtml(value) {
  return redactText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMarkdown(value) {
  return redactText(value).replace(/\|/g, "\\|");
}

function slugPart(value, fallback = "export") {
  const text = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function datePart(value = new Date().toISOString()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Fecha no valida";
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function asList(values) {
  return (values || [])
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return [
        item?.title,
        item?.asset_or_service,
        item?.description,
        item?.evidence,
        item?.impact,
        item?.recommended_action,
        item?.action
      ]
        .filter(Boolean)
        .join(": ");
    })
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function relatedIncidentsText(incidents) {
  return (incidents || [])
    .map((incident) =>
      [incident.id, incident.title, incident.status ? `(${incident.status})` : ""]
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .join(" | ");
}

function matrixRows(matrix) {
  return (matrix?.rows || []).map((row) => ({
    asset_or_service: row.asset_or_service || "",
    technical_problem: row.technical_problem || "",
    related_incidents: relatedIncidentsText(row.related_incidents),
    zabbix_evidence: row.zabbix_evidence || "",
    correlation_level: row.correlation_level || "",
    user_impact: row.user_impact || "",
    technical_risk: row.technical_risk || "",
    priority: row.priority || "",
    recommended_action: row.recommended_action || "",
    task_type: row.task_type || ""
  }));
}

function csvCell(value) {
  const text = redactText(value).replace(/\r?\n/g, " ");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  const body = [
    MATRIX_CSV_COLUMNS.join(","),
    ...rows.map((row) => MATRIX_CSV_COLUMNS.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
  return `\uFEFF${body}\n`;
}

function tableToMarkdown(headers, rows) {
  if (!rows.length) {
    return "Sin datos.\n";
  }
  const headerLine = `| ${headers.map((header) => escapeMarkdown(header.label)).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) =>
      `| ${headers
        .map((header) => escapeMarkdown(normalizeText(row[header.key], "Sin dato")))
        .join(" | ")} |`
  );
  return `${[headerLine, divider, ...body].join("\n")}\n`;
}

function tableToHtml(headers, rows) {
  if (!rows.length) {
    return `<p class="empty">Sin datos.</p>`;
  }
  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header.label)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${headers
          .map((header) => `<td>${escapeHtml(normalizeText(row[header.key], "Sin dato"))}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody></table></div>`;
}

function listToMarkdown(items) {
  const values = asList(items);
  if (!values.length) {
    return "- Sin datos.\n";
  }
  return `${values.map((item) => `- ${escapeMarkdown(item)}`).join("\n")}\n`;
}

function listToHtml(items) {
  const values = asList(items);
  if (!values.length) {
    return `<p class="empty">Sin datos.</p>`;
  }
  return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function actionRows(actions) {
  return (actions || []).map((action) => ({
    priority: action.priority || "",
    action: action.action || action.recommended_action || "",
    owner_type: action.owner_type || action.task_type || "",
    reason: action.reason || ""
  }));
}

function findingRows(findings) {
  return (findings || []).map((finding) => ({
    severity: finding.severity || "",
    title: finding.title || "",
    source: finding.source || "",
    description: finding.description || "",
    recommended_action: finding.recommended_action || ""
  }));
}

function riskRows(risks) {
  return (risks || []).map((risk) => ({
    severity: risk.severity || "",
    asset_or_service: risk.asset_or_service || "",
    source: risk.source || "",
    evidence: risk.evidence || "",
    impact: risk.impact || "",
    recommended_action: risk.recommended_action || ""
  }));
}

function gapRows(gaps) {
  return (gaps || []).map((gap) => ({
    priority: gap.priority || "",
    block: gap.block || "",
    asset_or_service: gap.asset_or_service || "",
    current_coverage: gap.current_coverage || "",
    missing_checks: (gap.missing_checks || []).join(" | "),
    recommended_action: gap.recommended_action || ""
  }));
}

function uniqueTexts(values, limit = 20) {
  const seen = new Set();
  const output = [];
  for (const value of values.flat(Infinity).filter(Boolean)) {
    const text =
      typeof value === "string"
        ? normalizeText(value)
        : normalizeText(
            [
              value?.title,
              value?.asset_or_service,
              value?.description,
              value?.evidence,
              value?.impact,
              value?.recommended_action,
              value?.action,
              value?.block,
              value?.current_coverage
            ]
              .filter(Boolean)
              .join(": ")
          );
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function severityRank(value) {
  const text = String(value || "").toLowerCase();
  if (["critical", "critica", "crítica", "high", "alta"].includes(text)) {
    return 3;
  }
  if (["medium", "media", "average"].includes(text)) {
    return 2;
  }
  if (["low", "baja", "warning"].includes(text)) {
    return 1;
  }
  return 0;
}

function sortBySeverity(items, getter) {
  return [...(items || [])].sort((a, b) => severityRank(getter(b)) - severityRank(getter(a)));
}

function matrixRowsWithIncidents(matrix) {
  return matrixRows(matrix)
    .filter((row) => row.related_incidents)
    .map((row) => ({
      asset_or_service: row.asset_or_service,
      technical_problem: row.technical_problem,
      related_incidents: row.related_incidents,
      zabbix_evidence: row.zabbix_evidence,
      correlation_level: row.correlation_level,
      user_impact: row.user_impact,
      technical_risk: row.technical_risk,
      priority: row.priority,
      recommended_action: row.recommended_action,
      task_type: row.task_type
    }));
}

function actionRowsWithSource(items, source) {
  return (items || []).map((action) => ({
    priority: action.priority || "",
    action: action.action || action.recommended_action || "",
    owner_type: action.owner_type || action.task_type || "",
    reason: action.reason || "",
    source
  }));
}

function uniqueActionsByLabel(rows, limit = 10) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const label = normalizeText(row.action);
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    result.push(row);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function operationalChecklistItems(ctx) {
  const primary = uniqueTexts([
    ctx.daily?.top_actions?.slice(0, 3).map((action) => action.action),
    ctx.analytics?.diff?.new_critical_risks || [],
    ctx.analytics?.diff?.monitoring_gap_changes?.new || [],
    ctx.matrix?.confirmed_impact || []
  ], 6);

  if (primary.length) {
    return primary.map((item) => `Revisar: ${item}`);
  }

  return [
    "Revisar el estado general del dashboard.",
    "Confirmar impacto en usuarios y tickets relacionados.",
    "Priorizar riesgos críticos y huecos de monitorización."
  ];
}

function reportGenerationState(ctx) {
  const missing = ctx.missing_reports || [];
  return {
    generated_at: ctx.generated_at,
    ready: missing.length === 0,
    missing_reports: missing,
    latest_reports: {
      daily_summary: reportRef(ctx.dailyReport),
      correlation_matrix: reportRef(ctx.matrixReport),
      risks: reportRef(ctx.risksReport),
      monitoring_gaps: reportRef(ctx.gapsReport)
    },
    analytics_generated_at: ctx.analytics?.generated_at || null
  };
}

function buildGenericReportDocument({
  title,
  typeLabel,
  createdAt,
  status,
  summary,
  sections,
  tables,
  printNote
}) {
  return {
    title,
    typeLabel,
    createdAt,
    status,
    summary,
    sections,
    tables,
    printNote
  };
}

function documentHtml({ title, typeLabel, createdAt, status, summary, sections, tables, printNote }) {
  const generatedAt = new Date().toISOString();
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f3f5f7; color: #17202a; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header, section { background: #ffffff; border: 1px solid #d9e0e8; border-radius: 8px; margin-bottom: 14px; padding: 18px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    p { margin: 0 0 10px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; color: #667385; font-size: 12px; }
    .meta span, .badge { border: 1px solid #d9e0e8; border-radius: 999px; padding: 5px 9px; }
    .badge { display: inline-block; background: #d8efeb; color: #0f4e47; font-weight: 700; text-transform: uppercase; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 5px 0; }
    .table-wrap { overflow-x: auto; border: 1px solid #d9e0e8; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #d9e0e8; padding: 8px 9px; text-align: left; vertical-align: top; }
    th { background: #f7f9fb; color: #667385; }
    tr:last-child td { border-bottom: 0; }
    .empty { color: #667385; }
    .print-note { color: #667385; font-size: 12px; }
    @media print { body { background: #ffffff; } main { max-width: none; padding: 0; } header, section { break-inside: avoid; } .print-note { display: none; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(summary || "Sin resumen estructurado disponible.")}</p>
      <div class="meta">
        <span>Tipo: ${escapeHtml(typeLabel)}</span>
        <span>Informe: ${escapeHtml(formatDate(createdAt))}</span>
        <span>Exportado: ${escapeHtml(formatDate(generatedAt))}</span>
        <span>Version: ${EXPORT_VERSION}</span>
        <span class="badge">Estado: ${escapeHtml(status || "unknown")}</span>
      </div>
      ${printNote ? `<p class="print-note">Para PDF: abre este HTML y usa Imprimir / Guardar como PDF desde el navegador.</p>` : ""}
    </header>
    ${sections
      .map(
        (section) =>
          `<section><h2>${escapeHtml(section.title)}</h2>${listToHtml(section.items)}</section>`
      )
      .join("")}
    ${tables
      .map(
        (table) =>
          `<section><h2>${escapeHtml(table.title)}</h2>${tableToHtml(table.headers, table.rows)}</section>`
      )
      .join("")}
  </main>
</body>
</html>`;
}

function documentMarkdown({ title, typeLabel, createdAt, status, summary, sections, tables }) {
  return `# ${escapeMarkdown(title)}

- Tipo: ${escapeMarkdown(typeLabel)}
- Informe: ${escapeMarkdown(formatDate(createdAt))}
- Exportado: ${escapeMarkdown(formatDate(new Date().toISOString()))}
- Version: ${EXPORT_VERSION}
- Estado general: ${escapeMarkdown(status || "unknown")}

## Resumen ejecutivo

${escapeMarkdown(summary || "Sin resumen estructurado disponible.")}

${sections
  .map((section) => `## ${escapeMarkdown(section.title)}\n\n${listToMarkdown(section.items)}`)
  .join("\n")}
${tables
  .map((table) => `## ${escapeMarkdown(table.title)}\n\n${tableToMarkdown(table.headers, table.rows)}`)
  .join("\n")}`;
}

const findingHeaders = [
  { key: "severity", label: "Severidad" },
  { key: "title", label: "Hallazgo" },
  { key: "source", label: "Fuente" },
  { key: "description", label: "Descripcion" },
  { key: "recommended_action", label: "Accion recomendada" }
];

const actionHeaders = [
  { key: "priority", label: "Prioridad" },
  { key: "action", label: "Accion" },
  { key: "owner_type", label: "Tipo de tarea" },
  { key: "reason", label: "Motivo" }
];

const riskHeaders = [
  { key: "severity", label: "Severidad" },
  { key: "asset_or_service", label: "Activo / servicio" },
  { key: "source", label: "Fuente" },
  { key: "evidence", label: "Evidencia" },
  { key: "impact", label: "Impacto" },
  { key: "recommended_action", label: "Accion recomendada" }
];

const gapHeaders = [
  { key: "priority", label: "Prioridad" },
  { key: "block", label: "Bloque" },
  { key: "asset_or_service", label: "Activo / servicio" },
  { key: "current_coverage", label: "Cobertura actual" },
  { key: "missing_checks", label: "Checks faltantes" },
  { key: "recommended_action", label: "Accion recomendada" }
];

const matrixHeaders = MATRIX_CSV_COLUMNS.map((column) => ({
  key: column,
  label: column
}));

function highPriorityFinding(finding) {
  return ["critical", "high"].includes(String(finding?.severity || "").toLowerCase());
}

function buildDailyDocument(bundle, variant = "technical", printNote = false) {
  const daily = bundle.daily || {};
  const matrix = bundle.matrix || {};
  const risks = bundle.risks || {};
  const gaps = bundle.gaps || {};
  const report = bundle.dailyReport;
  const titlePrefix = variant === "executive" ? "Informe ejecutivo" : "Informe tecnico";
  const title = `${titlePrefix}: ${daily.title || report?.title || "Informe diario"}`;
  const criticalRisks = [
    ...(daily.key_findings || [])
      .filter(highPriorityFinding)
      .map((finding) => `${finding.title}: ${finding.recommended_action}`),
    ...(risks.risks || [])
      .filter((risk) => ["critical", "high"].includes(String(risk.severity || "").toLowerCase()))
      .map((risk) => `${risk.asset_or_service}: ${risk.impact || risk.recommended_action}`),
    ...(matrix.critical_without_ticket || [])
  ];
  const userImpact = [
    ...(matrix.confirmed_impact || []),
    ...(matrix.rows || [])
      .filter((row) => (row.related_incidents || []).length)
      .map((row) => `${row.asset_or_service}: ${row.user_impact}`)
  ];
  const monitoringGaps = [
    ...(daily.missing_data || []),
    ...(matrix.monitoring_gaps || []),
    ...(gaps.gaps || []).map((gap) => `${gap.block}: ${gap.recommended_action}`)
  ];
  const sections =
    variant === "executive"
      ? [
          { title: "Riesgos criticos", items: criticalRisks.slice(0, 5) },
          { title: "Impacto en usuarios", items: userImpact.slice(0, 5) },
          { title: "Top 3 acciones", items: (daily.top_actions || []).slice(0, 3) },
          { title: "Datos faltantes", items: monitoringGaps.slice(0, 6) }
        ]
      : [
          { title: "Hallazgos", items: daily.key_findings || [] },
          { title: "Riesgos criticos", items: criticalRisks },
          { title: "Impacto en usuarios", items: userImpact },
          { title: "Huecos y datos faltantes", items: monitoringGaps }
        ];
  const tables =
    variant === "executive"
      ? [
          {
            title: "Acciones recomendadas",
            headers: actionHeaders,
            rows: actionRows(daily.top_actions || []).slice(0, 3)
          }
        ]
      : [
          { title: "Hallazgos clave", headers: findingHeaders, rows: findingRows(daily.key_findings) },
          { title: "Acciones recomendadas", headers: actionHeaders, rows: actionRows(daily.top_actions) },
          { title: "Matriz de correlacion", headers: matrixHeaders, rows: matrixRows(matrix) },
          { title: "Riesgos", headers: riskHeaders, rows: riskRows(risks.risks) },
          { title: "Huecos", headers: gapHeaders, rows: gapRows(gaps.gaps) }
        ];

  return {
    title,
    typeLabel:
      variant === "executive"
        ? "Informe ejecutivo"
        : "Informe tecnico",
    createdAt: report?.created_at || daily.generated_at,
    status: daily.overall_status || "unknown",
    summary: daily.executive_summary || daily.summary || "",
    sections,
    tables,
    printNote
  };
}

function buildMatrixDocument(report, matrix, printNote = false) {
  return {
    title: matrix?.title || report?.title || "Matriz de correlacion",
    typeLabel: REPORT_TYPE_LABELS.correlation_matrix,
    createdAt: report?.created_at || matrix?.generated_at,
    status: "n/a",
    summary: matrix?.summary || "Sin resumen estructurado disponible.",
    sections: [
      { title: "Impacto confirmado", items: matrix?.confirmed_impact || [] },
      { title: "Criticos sin ticket", items: matrix?.critical_without_ticket || [] },
      { title: "Tickets sin evidencia Zabbix", items: matrix?.tickets_without_zabbix_evidence || [] },
      { title: "Datos faltantes", items: matrix?.monitoring_gaps || [] }
    ],
    tables: [{ title: "Matriz", headers: matrixHeaders, rows: matrixRows(matrix) }],
    printNote
  };
}

function buildRisksDocument(report, risks, printNote = false) {
  return {
    title: risks?.title || report?.title || "Riesgos criticos",
    typeLabel: REPORT_TYPE_LABELS.risks,
    createdAt: report?.created_at || risks?.generated_at,
    status: "n/a",
    summary: risks?.summary || "Sin resumen estructurado disponible.",
    sections: [
      { title: "Acciones recomendadas", items: risks?.top_actions || [] },
      { title: "Datos faltantes", items: risks?.missing_data || [] }
    ],
    tables: [{ title: "Riesgos", headers: riskHeaders, rows: riskRows(risks?.risks) }],
    printNote
  };
}

function buildGapsDocument(report, gaps, printNote = false) {
  return {
    title: gaps?.title || report?.title || "Huecos de monitorizacion",
    typeLabel: REPORT_TYPE_LABELS.monitoring_gaps,
    createdAt: report?.created_at || gaps?.generated_at,
    status: "n/a",
    summary: gaps?.summary || "Sin resumen estructurado disponible.",
    sections: [
      { title: "Acciones recomendadas", items: gaps?.top_actions || [] },
      { title: "Datos faltantes", items: gaps?.missing_data || [] }
    ],
    tables: [{ title: "Huecos", headers: gapHeaders, rows: gapRows(gaps?.gaps) }],
    printNote
  };
}

function buildFallbackDocument(report, printNote = false) {
  return {
    title: report?.title || "Informe",
    typeLabel: REPORT_TYPE_LABELS[report?.type] || report?.type || "Informe",
    createdAt: report?.created_at,
    status: "unknown",
    summary: "Informe sin datos estructurados en metadata_json.",
    sections: [
      {
        title: "Contenido Markdown",
        items: [report?.response_markdown || "Sin contenido."]
      }
    ],
    tables: [],
    printNote
  };
}

function documentForReport(report, variant = "technical", bundle = null, printNote = false) {
  const data = structuredData(report);
  if (report?.type === "daily_summary" && data) {
    return buildDailyDocument(
      {
        dailyReport: report,
        daily: data,
        matrixReport: bundle?.matrixReport || null,
        matrix: bundle?.matrix || null,
        risksReport: bundle?.risksReport || null,
        risks: bundle?.risks || null,
        gapsReport: bundle?.gapsReport || null,
        gaps: bundle?.gaps || null
      },
      variant,
      printNote
    );
  }
  if (report?.type === "correlation_matrix" && data) {
    return buildMatrixDocument(report, data, printNote);
  }
  if (report?.type === "risks" && data) {
    return buildRisksDocument(report, data, printNote);
  }
  if (report?.type === "monitoring_gaps" && data) {
    return buildGapsDocument(report, data, printNote);
  }
  return buildFallbackDocument(report, printNote);
}

function jsonForReport(report, related = null) {
  const payload = {
    exported_at: new Date().toISOString(),
    export_version: EXPORT_VERSION,
    source_report: reportRef(report),
    metadata_json: parseReportMetadata(report)
  };
  if (related) {
    payload.related_reports = related;
  }
  return payload;
}

function fileResult({ body, format, basename, contentType, disposition = "attachment" }) {
  const extensions = {
    html: "html",
    markdown: "md",
    csv: "csv",
    json: "json"
  };
  return {
    body,
    contentType,
    filename: `${slugPart(basename)}.${extensions[format] || format}`,
    disposition
  };
}

function validateFormat(format, allowed) {
  const normalized = String(format || allowed[0]).toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`Formato no permitido. Usa: ${allowed.join(", ")}.`);
  }
  return normalized;
}

function normalizeVariant(value) {
  return String(value || "technical").toLowerCase() === "executive"
    ? "executive"
    : "technical";
}

function dispositionFromQuery(value) {
  return String(value || "").toLowerCase() === "inline" ? "inline" : "attachment";
}

export function sendExport(res, result) {
  res.setHeader("Content-Type", result.contentType);
  res.setHeader(
    "Content-Disposition",
    `${result.disposition}; filename="${result.filename}"`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(result.body);
}

export async function buildReportExport(id, query = {}) {
  const format = validateFormat(query.format, ["html", "markdown", "json", "csv"]);
  const variant = normalizeVariant(query.variant);
  const report = await getReport(id);
  if (!report) {
    return null;
  }
  const basename = `${REPORT_TYPE_LABELS[report.type] || report.type}-${report.id}-${datePart(
    report.created_at
  )}`;
  if (format === "csv") {
    if (report.type !== "correlation_matrix") {
      throw new Error("CSV solo esta disponible para matrices de correlacion.");
    }
    return fileResult({
      body: toCsv(matrixRows(structuredData(report) || {})),
      format,
      basename,
      contentType: "text/csv; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  if (format === "json") {
    return fileResult({
      body: exportJson(jsonForReport(report)),
      format,
      basename,
      contentType: "application/json; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  const document = documentForReport(report, variant, null, query.print === "1");
  if (format === "markdown") {
    return fileResult({
      body: documentMarkdown(document),
      format,
      basename,
      contentType: "text/markdown; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  return fileResult({
    body: documentHtml(document),
    format,
    basename,
    contentType: "text/html; charset=utf-8",
    disposition: dispositionFromQuery(query.disposition)
  });
}

async function latestBundle() {
  const [dailyReport, matrixReport, risksReport, gapsReport] = await Promise.all([
    getLatestReportByType("daily_summary"),
    getLatestReportByType("correlation_matrix"),
    getLatestReportByType("risks"),
    getLatestReportByType("monitoring_gaps")
  ]);
  return {
    dailyReport,
    daily: structuredData(dailyReport),
    matrixReport,
    matrix: structuredData(matrixReport),
    matrixRows: matrixRows(structuredData(matrixReport)),
    risksReport,
    risks: structuredData(risksReport),
    gapsReport,
    gaps: structuredData(gapsReport)
  };
}

async function latestExportContext() {
  const bundle = await latestBundle();
  const [analyticsSummary, analyticsReports] = await Promise.all([
    buildAnalyticsSummary({ days: 14 }),
    buildAnalyticsReports({ days: 7 })
  ]);
  const generated_at = new Date().toISOString();
  const missing_reports = [
    bundle.dailyReport ? null : "daily_summary",
    bundle.matrixReport ? null : "correlation_matrix",
    bundle.risksReport ? null : "risks",
    bundle.gapsReport ? null : "monitoring_gaps"
  ].filter(Boolean);

  return {
    ...bundle,
    analytics: analyticsSummary,
    analyticsReports,
    generated_at,
    missing_reports,
    generation_state: reportGenerationState({
      ...bundle,
      analytics: analyticsSummary,
      generated_at,
      missing_reports
    })
  };
}

function latestDailySummaryText(ctx) {
  return (
    ctx.daily?.executive_summary ||
    ctx.daily?.summary ||
    ctx.analytics?.today?.executive_summary ||
    "Sin resumen disponible."
  );
}

function dailyTopActions(ctx) {
  return uniqueActionsByLabel(
    [
      ...actionRowsWithSource(ctx.daily?.top_actions || [], "daily"),
      ...actionRowsWithSource(ctx.risks?.top_actions || [], "risks"),
      ...actionRowsWithSource(ctx.gaps?.top_actions || [], "gaps")
    ].sort((a, b) => severityRank(b.priority) - severityRank(a.priority)),
    10
  );
}

function executiveRiskRows(ctx) {
  const riskRows = [
    ...(ctx.risks?.risks || []).map((risk) => ({
      severity: risk.severity || "",
      asset_or_service: risk.asset_or_service || "",
      impact: risk.impact || "",
      recommended_action: risk.recommended_action || "",
      evidence: risk.evidence || ""
    })),
    ...(ctx.matrix?.critical_without_ticket || []).map((item) => ({
      severity: "high",
      asset_or_service: item,
      impact: "Riesgo técnico sin ticket asociado.",
      recommended_action: "Escalar y validar con el equipo responsable.",
      evidence: "Derivado de la última matriz."
    }))
  ];

  return uniqueTexts(riskRows.map((risk) => `${risk.asset_or_service}: ${risk.impact}`), 3).length
    ? sortBySeverity(riskRows, (row) => row.severity).slice(0, 3)
    : [];
}

function executiveImpactItems(ctx) {
  return uniqueTexts(
    [
      ctx.matrix?.confirmed_impact || [],
      (ctx.matrix?.rows || [])
        .filter((row) => (row.related_incidents || []).length)
        .map((row) => `${row.asset_or_service}: ${row.user_impact}`)
    ],
    5
  );
}

function executiveDecisionItems(ctx) {
  return uniqueTexts(
    [
      ctx.analytics?.warnings || [],
      ctx.daily?.missing_data || [],
      ctx.matrix?.monitoring_gaps || [],
      ctx.gaps?.missing_data || []
    ],
    5
  );
}

function technicalProblemRows(ctx) {
  const rows = [
    ...(ctx.daily?.key_findings || [])
      .filter((finding) => ["zabbix", "both"].includes(String(finding.source || "").toLowerCase()))
      .map((finding) => ({
        asset_or_service: finding.title || "",
        technical_problem: finding.description || "",
        related_incidents: "",
        zabbix_evidence: finding.recommended_action || "",
        correlation_level: "alta",
        user_impact: finding.description || "",
        technical_risk: finding.recommended_action || "",
        priority: finding.severity || "",
        recommended_action: finding.recommended_action || "",
        task_type: "operativa"
      })),
    ...matrixRowsWithIncidents(ctx.matrix).map((row) => ({
      ...row,
      related_incidents: row.related_incidents || "Sin incidencia directa"
    }))
  ];

  return rows;
}

function technicalActionRows(ctx) {
  return uniqueActionsByLabel(
    [
      ...actionRowsWithSource(ctx.daily?.top_actions || [], "daily"),
      ...actionRowsWithSource(ctx.risks?.top_actions || [], "risks"),
      ...actionRowsWithSource(ctx.gaps?.top_actions || [], "gaps"),
      ...ctx.matrixRows
        .filter((row) => row.task_type)
        .map((row) => ({
          priority: row.priority || "",
          action: row.recommended_action || "",
          owner_type: row.task_type || "",
          reason: row.technical_risk || row.user_impact || "",
          source: "matrix"
        }))
    ].sort((a, b) => severityRank(b.priority) - severityRank(a.priority)),
    12
  );
}

function technicalEvidenceItems(ctx) {
  return uniqueTexts(
    [
      (ctx.matrix?.rows || []).map((row) => `${row.asset_or_service}: ${row.zabbix_evidence}`),
      (ctx.risks?.risks || []).map((risk) => `${risk.asset_or_service}: ${risk.evidence}`)
    ],
    8
  );
}

function technicalNextSteps(ctx) {
  return uniqueTexts(
    [
      ctx.analytics?.diff?.new_critical_risks || [],
      ctx.analytics?.diff?.monitoring_gap_changes?.new || [],
      ctx.daily?.missing_data || []
    ],
    6
  );
}

function operationalReviewItems(ctx) {
  const first = uniqueTexts(
    [
      ctx.daily?.top_actions?.slice(0, 3).map((action) => action.action),
      ctx.analytics?.diff?.new_critical_risks || [],
      ctx.matrix?.confirmed_impact || []
    ],
    4
  );
  return first.length ? first : ["Revisar el dashboard operativo.", "Revisar la última matriz."];
}

function operationalRiskItems(ctx) {
  return uniqueTexts(
    [
      ...(ctx.matrix?.critical_without_ticket || []),
      ...(ctx.risks?.risks || [])
        .filter((risk) => ["critical", "high"].includes(String(risk.severity || "").toLowerCase()))
        .map((risk) => `${risk.asset_or_service}: ${risk.impact}`)
    ],
    5
  );
}

function operationalDelegableItems(ctx) {
  return uniqueTexts(
    [
      ...(ctx.daily?.top_actions || [])
        .filter((action) => String(action.owner_type || "").toLowerCase() === "codex_zabbix")
        .map((action) => action.action),
      ...(ctx.risks?.top_actions || [])
        .filter((action) => String(action.owner_type || "").toLowerCase() === "codex_zabbix")
        .map((action) => action.action)
    ],
    4
  );
}

function operationalHumanItems(ctx) {
  return uniqueTexts(
    [
      ...(ctx.daily?.top_actions || [])
        .filter((action) => String(action.owner_type || "").toLowerCase() === "revision_humana")
        .map((action) => action.action),
      ...(ctx.risks?.top_actions || [])
        .filter((action) => String(action.owner_type || "").toLowerCase() === "revision_humana")
        .map((action) => action.action),
      ...(ctx.gaps?.top_actions || [])
        .filter((action) => String(action.owner_type || "").toLowerCase() === "revision_humana")
        .map((action) => action.action)
    ],
    4
  );
}

function operationalChecklist(ctx) {
  return operationalChecklistItems(ctx).slice(0, 6);
}

function buildExecutiveExportDocument(ctx, printNote = false) {
  return buildGenericReportDocument({
    title: `Informe ejecutivo: ${ctx.dailyReport?.title || "Informe diario"}`,
    typeLabel: "Informe ejecutivo",
    createdAt: ctx.dailyReport?.created_at || ctx.generated_at,
    status: ctx.daily?.overall_status || ctx.analytics?.today?.overall_status || "unknown",
    summary: latestDailySummaryText(ctx),
    sections: [
      {
        title: "Semáforo general",
        items: [
          `Estado general: ${ctx.daily?.overall_status || "unknown"}`,
          `Informe generado: ${ctx.generation_state.ready ? "completo" : "con avisos"}`
        ]
      },
      { title: "Top 3 riesgos", items: executiveRiskRows(ctx).map((risk) => `${risk.asset_or_service}: ${risk.impact}`) },
      { title: "Impacto en usuarios", items: executiveImpactItems(ctx) },
      {
        title: "Top 3 acciones recomendadas",
        items: dailyTopActions(ctx)
          .slice(0, 3)
          .map((action) => `${action.priority}: ${action.action}`)
      },
      { title: "Decisiones o escalados necesarios", items: executiveDecisionItems(ctx) },
      { title: "Datos faltantes importantes", items: uniqueTexts([ctx.daily?.missing_data || [], ctx.analytics?.warnings || []], 6) }
    ],
    tables: [
      {
        title: "Riesgos priorizados",
        headers: [
          { key: "severity", label: "Severidad" },
          { key: "asset_or_service", label: "Riesgo" },
          { key: "impact", label: "Impacto" },
          { key: "recommended_action", label: "Acción" }
        ],
        rows: executiveRiskRows(ctx)
      },
      {
        title: "Acciones recomendadas",
        headers: [
          { key: "priority", label: "Prioridad" },
          { key: "action", label: "Acción" },
          { key: "owner_type", label: "Tipo" }
        ],
        rows: dailyTopActions(ctx).slice(0, 3)
      }
    ],
    printNote
  });
}

function buildTechnicalExportDocument(ctx, printNote = false) {
  const matrixTableRows = ctx.matrixRows.slice(0, 15);
  const riskRows = sortBySeverity(ctx.risks?.risks || [], (risk) => risk.severity).map((risk) => ({
    severity: risk.severity || "",
    asset_or_service: risk.asset_or_service || "",
    source: risk.source || "",
    evidence: risk.evidence || "",
    impact: risk.impact || "",
    recommended_action: risk.recommended_action || ""
  }));
  const actionRows = technicalActionRows(ctx);

  return buildGenericReportDocument({
    title: `Informe técnico: ${ctx.dailyReport?.title || "Informe diario"}`,
    typeLabel: "Informe técnico",
    createdAt: ctx.dailyReport?.created_at || ctx.generated_at,
    status: ctx.daily?.overall_status || ctx.analytics?.today?.overall_status || "unknown",
    summary:
      ctx.daily?.summary ||
      ctx.daily?.executive_summary ||
      ctx.analytics?.today?.executive_summary ||
      "Sin resumen técnico disponible.",
    sections: [
      { title: "Resumen técnico", items: [latestDailySummaryText(ctx)] },
      { title: "Problemas Zabbix relevantes", items: uniqueTexts([ctx.daily?.key_findings || [], technicalProblemRows(ctx).slice(0, 6).map((row) => `${row.asset_or_service}: ${row.technical_problem}`)], 8) },
      { title: "Incidencias IncidenciasTI relacionadas", items: uniqueTexts([matrixTableRows.map((row) => row.related_incidents)], 8) },
      { title: "Evidencias técnicas", items: technicalEvidenceItems(ctx) },
      { title: "Huecos de monitorización", items: uniqueTexts([ctx.matrix?.monitoring_gaps || [], ctx.gaps?.gaps || []], 8) },
      { title: "Próximos pasos", items: technicalNextSteps(ctx) },
      { title: "Datos faltantes", items: uniqueTexts([ctx.daily?.missing_data || [], ctx.analytics?.warnings || []], 6) }
    ],
    tables: [
      {
        title: "Matriz de correlación resumida",
        headers: [
          { key: "asset_or_service", label: "Activo / servicio" },
          { key: "technical_problem", label: "Problema técnico" },
          { key: "related_incidents", label: "Incidencias relacionadas" },
          { key: "zabbix_evidence", label: "Evidencia Zabbix" },
          { key: "correlation_level", label: "Correlación" },
          { key: "user_impact", label: "Impacto usuario" },
          { key: "technical_risk", label: "Riesgo técnico" },
          { key: "priority", label: "Prioridad" },
          { key: "recommended_action", label: "Acción recomendada" },
          { key: "task_type", label: "Tipo de tarea" }
        ],
        rows: matrixTableRows
      },
      {
        title: "Riesgos por prioridad",
        headers: riskHeaders,
        rows: riskRows.slice(0, 12)
      },
      {
        title: "Acciones por tipo",
        headers: [
          { key: "priority", label: "Prioridad" },
          { key: "action", label: "Acción" },
          { key: "owner_type", label: "Tipo de tarea" },
          { key: "reason", label: "Motivo" },
          { key: "source", label: "Fuente" }
        ],
        rows: actionRows.slice(0, 12)
      }
    ],
    printNote
  });
}

function buildOperationalExportDocument(ctx, printNote = false) {
  return buildGenericReportDocument({
    title: `Informe operativo diario: ${ctx.dailyReport?.title || "Informe diario"}`,
    typeLabel: "Informe operativo diario",
    createdAt: ctx.dailyReport?.created_at || ctx.generated_at,
    status: ctx.daily?.overall_status || ctx.analytics?.today?.overall_status || "unknown",
    summary:
      ctx.daily?.executive_summary ||
      ctx.analytics?.today?.executive_summary ||
      "Sin resumen operativo disponible.",
    sections: [
      { title: "Qué revisar primero", items: operationalReviewItems(ctx) },
      { title: "Impacto real en usuarios", items: executiveImpactItems(ctx) },
      { title: "Riesgo técnico sin ticket", items: operationalRiskItems(ctx) },
      { title: "Delegable a Codex/Zabbix", items: operationalDelegableItems(ctx) },
      { title: "Requiere intervención humana", items: operationalHumanItems(ctx) },
      { title: "Checklist de acciones del día", items: operationalChecklist(ctx) },
      {
        title: "Estado de generación del informe",
        items: [
          `Estado general: ${ctx.daily?.overall_status || "unknown"}`,
          `Paquete completo: ${ctx.generation_state.ready ? "sí" : "no"}`,
          `Faltan: ${ctx.generation_state.missing_reports.length ? ctx.generation_state.missing_reports.join(", ") : "nada"}`
        ]
      }
    ],
    tables: [
      {
        title: "Acciones principales",
        headers: [
          { key: "priority", label: "Prioridad" },
          { key: "action", label: "Acción" },
          { key: "owner_type", label: "Tipo" },
          { key: "reason", label: "Motivo" }
        ],
        rows: dailyTopActions(ctx).slice(0, 6)
      }
    ],
    printNote
  });
}

export async function buildLatestDailyExport(query = {}) {
  const format = validateFormat(query.format, ["html", "markdown", "json"]);
  const variant = normalizeVariant(query.variant);
  const bundle = await latestBundle();
  if (!bundle.dailyReport) {
    return null;
  }
  const basename = `${variant === "executive" ? "informe-ejecutivo" : "informe-tecnico"}-${datePart(
    bundle.dailyReport.created_at
  )}`;
  if (format === "json") {
    return fileResult({
      body: exportJson(
        jsonForReport(bundle.dailyReport, {
          correlation_matrix: {
            source_report: reportRef(bundle.matrixReport),
            metadata_json: parseReportMetadata(bundle.matrixReport)
          },
          risks: {
            source_report: reportRef(bundle.risksReport),
            metadata_json: parseReportMetadata(bundle.risksReport)
          },
          monitoring_gaps: {
            source_report: reportRef(bundle.gapsReport),
            metadata_json: parseReportMetadata(bundle.gapsReport)
          }
        })
      ),
      format,
      basename,
      contentType: "application/json; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  const document = buildDailyDocument(bundle, variant, query.print === "1");
  if (format === "markdown") {
    return fileResult({
      body: documentMarkdown(document),
      format,
      basename,
      contentType: "text/markdown; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  return fileResult({
    body: documentHtml(document),
    format,
    basename,
    contentType: "text/html; charset=utf-8",
    disposition: dispositionFromQuery(query.disposition)
  });
}

export async function buildLatestMatrixExport(query = {}) {
  const format = validateFormat(query.format, ["csv", "html", "markdown", "json"]);
  const report = await getLatestReportByType("correlation_matrix");
  if (!report) {
    return null;
  }
  const matrix = structuredData(report) || {};
  const basename = `matriz-correlacion-${datePart(report.created_at)}`;
  if (format === "csv") {
    return fileResult({
      body: toCsv(matrixRows(matrix)),
      format,
      basename,
      contentType: "text/csv; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  if (format === "json") {
    return fileResult({
      body: exportJson(jsonForReport(report)),
      format,
      basename,
      contentType: "application/json; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  const document = buildMatrixDocument(report, matrix, query.print === "1");
  if (format === "markdown") {
    return fileResult({
      body: documentMarkdown(document),
      format,
      basename,
      contentType: "text/markdown; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  return fileResult({
    body: documentHtml(document),
    format,
    basename,
    contentType: "text/html; charset=utf-8",
    disposition: dispositionFromQuery(query.disposition)
  });
}

function buildExportJsonPayload(exportType, ctx, document, extras = {}) {
  return {
    exported_at: new Date().toISOString(),
    export_version: EXPORT_VERSION,
    export_type: exportType,
    report: {
      title: document.title,
      type_label: document.typeLabel,
      generated_at: document.createdAt,
      status: document.status,
      summary: document.summary,
      sections: document.sections,
      tables: document.tables
    },
    generation_state: ctx.generation_state,
    source_reports: {
      daily_summary: reportRef(ctx.dailyReport),
      correlation_matrix: reportRef(ctx.matrixReport),
      risks: reportRef(ctx.risksReport),
      monitoring_gaps: reportRef(ctx.gapsReport)
    },
    analytics: ctx.analytics,
    source_data: {
      daily_summary: ctx.daily,
      correlation_matrix: ctx.matrix,
      critical_risks: ctx.risks,
      monitoring_gaps: ctx.gaps
    },
    ...extras
  };
}

function exportDocumentResult({ query, basename, document, exportType, ctx }) {
  const format = validateFormat(query.format, ["html", "markdown", "json"]);
  if (format === "json") {
    return fileResult({
      body: exportJson(buildExportJsonPayload(exportType, ctx, document)),
      format,
      basename,
      contentType: "application/json; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  if (format === "markdown") {
    return fileResult({
      body: documentMarkdown(document),
      format,
      basename,
      contentType: "text/markdown; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  return fileResult({
    body: documentHtml(document),
    format,
    basename,
    contentType: "text/html; charset=utf-8",
    disposition: dispositionFromQuery(query.disposition)
  });
}

export async function buildExecutiveExport(query = {}) {
  const ctx = await latestExportContext();
  if (!ctx.dailyReport) {
    return null;
  }
  const document = buildExecutiveExportDocument(ctx, query.print === "1");
  const basename = `informe-ejecutivo-${datePart(ctx.dailyReport.created_at)}`;
  return exportDocumentResult({
    query,
    basename,
    document,
    exportType: "executive",
    ctx
  });
}

export async function buildTechnicalExport(query = {}) {
  const ctx = await latestExportContext();
  if (!ctx.dailyReport) {
    return null;
  }
  const document = buildTechnicalExportDocument(ctx, query.print === "1");
  const basename = `informe-tecnico-${datePart(ctx.dailyReport.created_at)}`;
  return exportDocumentResult({
    query,
    basename,
    document,
    exportType: "technical",
    ctx
  });
}

export async function buildOperationalExport(query = {}) {
  const ctx = await latestExportContext();
  if (!ctx.dailyReport) {
    return null;
  }
  const document = buildOperationalExportDocument(ctx, query.print === "1");
  const basename = `informe-operativo-${datePart(ctx.dailyReport.created_at)}`;
  return exportDocumentResult({
    query,
    basename,
    document,
    exportType: "operational",
    ctx
  });
}

function analyticsDocument(summary, reports, printNote = false) {
  const today = summary.today || {};
  const diff = summary.diff || {};
  const rows = (reports.reports || []).map((day) => ({
    date: day.date || "",
    overall_status: day.overall_status || "",
    critical_risks_count: String(day.critical_risks_count ?? 0),
    monitoring_gaps_count: String(day.monitoring_gaps_count ?? 0),
    actions_count: String(day.actions_count ?? 0),
    missing_reports: (day.missing_reports || []).join(" | "),
    complete: day.complete ? "si" : "no"
  }));
  return {
    title: "Analisis operativo",
    typeLabel: REPORT_TYPE_LABELS.analytics,
    createdAt: summary.generated_at,
    status: today.overall_status || "unknown",
    summary:
      today.executive_summary ||
      `Cambio: ${diff.status_change || "sin_comparativa"}. Riesgos nuevos: ${
        diff.new_critical_risks?.length || 0
      }. Huecos nuevos: ${diff.monitoring_gap_changes?.new?.length || 0}.`,
    sections: [
      { title: "Avisos", items: summary.warnings || [] },
      { title: "Nuevos riesgos criticos", items: diff.new_critical_risks || [] },
      { title: "Riesgos persistentes", items: diff.persistent_critical_risks || [] },
      { title: "Huecos nuevos", items: diff.monitoring_gap_changes?.new || [] },
      { title: "Acciones repetidas", items: diff.repeated_actions || [] }
    ],
    tables: [
      {
        title: "Ultimos dias",
        headers: [
          { key: "date", label: "Fecha" },
          { key: "overall_status", label: "Estado" },
          { key: "critical_risks_count", label: "Riesgos criticos" },
          { key: "monitoring_gaps_count", label: "Huecos" },
          { key: "actions_count", label: "Acciones" },
          { key: "missing_reports", label: "Informes faltantes" },
          { key: "complete", label: "Completo" }
        ],
        rows
      }
    ],
    printNote
  };
}

export async function buildAnalyticsExport(query = {}) {
  const format = validateFormat(query.format, ["html", "markdown", "json"]);
  const [summary, reports] = await Promise.all([
    buildAnalyticsSummary({ days: query.days || 14 }),
    buildAnalyticsReports({ days: query.days || 7 })
  ]);
  const basename = `analisis-operativo-${datePart(summary.generated_at)}`;
  if (format === "json") {
    return fileResult({
      body: exportJson({
        exported_at: new Date().toISOString(),
        export_version: EXPORT_VERSION,
        summary,
        reports
      }),
      format,
      basename,
      contentType: "application/json; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  const document = analyticsDocument(summary, reports, query.print === "1");
  if (format === "markdown") {
    return fileResult({
      body: documentMarkdown(document),
      format,
      basename: `${basename}-resumen`,
      contentType: "text/markdown; charset=utf-8",
      disposition: dispositionFromQuery(query.disposition)
    });
  }
  return fileResult({
    body: documentHtml(document),
    format,
    basename,
    contentType: "text/html; charset=utf-8",
    disposition: dispositionFromQuery(query.disposition)
  });
}
