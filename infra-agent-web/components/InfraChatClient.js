import Script from "next/script";
import { useRouter } from "next/router";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import VoiceAgentPanel from "./VoiceAgentPanel";
import {
  detectPowerBiIntent,
  routePowerBiChatQuestion,
  formatPowerBiChatAnswer,
  formatPowerBiUnsupportedResponse
} from "../lib/powerbiChatRouter";
import {
  detectOpsIntent,
  formatOpsUnsupportedResponse,
  routeOpsChatQuestion
} from "../lib/opsIntentRouterClient";
import {
  getPowerBiSupportedUtterances,
  getPowerBiVoiceHelp
} from "../lib/powerbiCapabilities";

const quickPrompts = [
  "¿Qué es lo más urgente hoy?",
  "Dame resumen de IncidenciasTI por estado.",
  "Cruza Zabbix e IncidenciasTI.",
  "Genera matriz de correlación.",
  "Dame acciones recomendadas para hoy."
];

const matrixPrompt =
  "Genera una matriz de correlación entre problemas Zabbix e incidencias IncidenciasTI. Incluye activo, problema técnico, incidencia relacionada, impacto y acción recomendada.";

const dailyReportPrompt =
  "Genera un informe diario operativo de infraestructura. Incluye estado general, problemas críticos, incidencias abiertas, correlación Zabbix-IncidenciasTI, riesgos de datos/backups/storage, acciones recomendadas para hoy y datos que faltan.";

const reportTypes = [
  { value: "daily_summary", label: "Informe diario" },
  { value: "correlation_matrix", label: "Matriz de correlación" },
  { value: "risks", label: "Riesgos" },
  { value: "monitoring_gaps", label: "Huecos de monitorización" }
];

const reportTypeLabels = reportTypes.reduce((labels, type) => {
  labels[type.value] = type.label;
  return labels;
}, {});

const communicationTypes = [
  { value: "email", label: "Email" },
  { value: "teams", label: "Teams" }
];

const communicationStatuses = [
  { value: "draft", label: "Borrador" },
  { value: "ready_for_review", label: "Listo para revisión" },
  { value: "reviewed", label: "Revisado" },
  { value: "copied", label: "Copiado" },
  { value: "discarded", label: "Descartado" }
];

const communicationSendStatuses = [
  { value: "not_sent", label: "No enviado" },
  { value: "prepared", label: "Preparado" },
  { value: "sending", label: "Enviando" },
  { value: "sent", label: "Enviado" },
  { value: "failed", label: "Fallido" }
];

const communicationStatusFilters = [
  { value: "", label: "Todos" },
  { value: "pending_review", label: "Pendientes de revisión" },
  ...communicationStatuses
];

const communicationSourceTypes = [
  { value: "daily_report", label: "Informe diario" },
  { value: "matrix", label: "Matriz" },
  { value: "incident", label: "Incidencia" },
  { value: "risk", label: "Riesgo" },
  { value: "manual", label: "Manual" }
];

const directoryDefaultLimit = 20;
const defaultCommunicationTemplateId = "executive_direccion";

const structuredEndpoints = {
  daily_summary: "/api/structured/daily-summary",
  correlation_matrix: "/api/structured/correlation-matrix",
  risks: "/api/structured/critical-risks",
  monitoring_gaps: "/api/structured/monitoring-gaps"
};

const POWERBI_ADVANCED_MODEL_KEYS = new Set(["administracion_ventas"]);

function isPowerBiAdvancedModelKey(modelKey) {
  return POWERBI_ADVANCED_MODEL_KEYS.has(String(modelKey || "").trim());
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Sin fecha";
    }
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  } catch {
    return "Sin fecha";
  }
}

function formatPowerBiMetricLabel(metric) {
  return String(metric || "").trim() === "unidades" ? "Unidades" : "Ventas";
}

function formatPowerBiDimensionLabel(dimension) {
  const normalized = String(dimension || "").trim().toLowerCase();
  const labels = {
    cliente: "Cliente",
    articulo: "Artículo",
    producto: "Producto",
    familia: "Familia",
    representante: "Representante",
    tipo: "Tipo",
    especie: "Especie",
    mes: "Mes"
  };
  return labels[normalized] || (dimension ? dimension.charAt(0).toUpperCase() + dimension.slice(1) : "Dimensión");
}

function powerBiFormatNumber(value, { decimals = 2, useGrouping = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value ?? "—");
  }
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping
  }).format(number);
}

function powerBiFormatCurrency(value) {
  return `${powerBiFormatNumber(value, { decimals: 2 })} €`;
}

function powerBiFormatInteger(value) {
  return powerBiFormatNumber(value, { decimals: 0 });
}

function powerBiTitleCase(value) {
  return String(value || "")
    .replace(/[_\.\[\]]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function powerBiHumanizeColumnLabel(column, interpretation = {}, index = 0) {
  const raw = String(column || "").trim();
  const metric = String(interpretation.metric || "").trim();
  const dimension = String(interpretation.dimension || "").trim();

  if (!raw) {
    return "Valor";
  }

  if (index === 0 && dimension) {
    return formatPowerBiDimensionLabel(dimension);
  }

  if (/^\[?metric\]?$/i.test(raw) || /(^|[^\p{L}])metric($|[^\p{L}])/iu.test(raw)) {
    return formatPowerBiMetricLabel(metric);
  }

  if (/ventas|importe|eur|euros|€|factur/i.test(raw)) {
    return "Ventas €";
  }

  if (/unidades|cantidad/i.test(raw)) {
    return "Unidades";
  }

  const bracketMatch = raw.match(/^(.+?)\[(.+?)\]$/);
  if (bracketMatch) {
    const field = String(bracketMatch[2] || "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return field ? powerBiTitleCase(field) : raw;
  }

  return powerBiTitleCase(raw.replace(/\[(.+?)\]/g, "$1").replace(/[._]/g, " "));
}

function powerBiLooksLikeDateValue(value) {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();
  if (!text) {
    return false;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{2}\/\d{2}\/\d{4}/.test(text)) {
    return true;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed);
}

function powerBiFormatCellValue(column, value, interpretation = {}) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  if (typeof value === "number") {
    const rawColumn = String(column || "").toLowerCase();
    const metric = String(interpretation.metric || "").toLowerCase();
    const useCurrency =
      metric === "ventas_eur" ||
      /ventas|importe|eur|euros|€|factur/.test(rawColumn);
    const useInteger = metric === "unidades" || /unidad|cantidad|count|total/.test(rawColumn);

    if (useCurrency) {
      return powerBiFormatCurrency(value);
    }

    if (useInteger || Number.isInteger(value)) {
      return powerBiFormatInteger(value);
    }

    return powerBiFormatNumber(value, { decimals: 2 });
  }

  if (powerBiLooksLikeDateValue(String(value))) {
    return formatDate(value);
  }

  return String(value);
}

function powerBiGetResultRows(result) {
  if (!result) {
    return [];
  }

  if (Array.isArray(result.rows)) {
    return result.rows;
  }

  if (Array.isArray(result.execution?.rows)) {
    return result.execution.rows;
  }

  return [];
}

function powerBiGetResultColumns(result, rows = []) {
  if (Array.isArray(result?.columns) && result.columns.length) {
    return result.columns;
  }

  const firstRow = Array.isArray(rows) && rows.length ? rows[0] : null;
  return firstRow && typeof firstRow === "object" ? Object.keys(firstRow) : [];
}

function powerBiGetKpiValue(result, rows = [], columns = []) {
  const firstRow = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!firstRow || typeof firstRow !== "object") {
    return null;
  }

  const interpretation = result?.interpretation || {};
  const metric = String(interpretation.metric || "").trim();
  const directMetricKey = columns.find((column) => /metric/i.test(String(column || "")));

  if (directMetricKey && firstRow[directMetricKey] !== undefined) {
    return firstRow[directMetricKey];
  }

  const firstNumericValue = Object.values(firstRow).find((value) => typeof value === "number");
  if (firstNumericValue !== undefined) {
    return firstNumericValue;
  }

  if (metric === "ventas_eur" || metric === "unidades") {
    return Object.values(firstRow).find((value) => typeof value === "number") ?? null;
  }

  return null;
}

function powerBiBuildResultTitle(result) {
  const interpretation = result?.interpretation || {};
  const metricLabel = formatPowerBiMetricLabel(interpretation.metric);
  const dimensionLabel = formatPowerBiDimensionLabel(interpretation.dimension);
  const topN = Number(interpretation.topN || 0) || 10;

  if (interpretation.intent === "total_metric") {
    return `${metricLabel} totales`;
  }

  if (interpretation.intent === "top_dimension_by_metric") {
    return `Top ${topN} ${dimensionLabel.toLowerCase()} por ${metricLabel.toLowerCase()}`;
  }

  if (interpretation.intent === "metric_by_month") {
    return `${metricLabel} por mes`;
  }

  if (interpretation.intent === "metric_by_dimension") {
    return `${metricLabel} por ${dimensionLabel.toLowerCase()}`;
  }

  return result?.headline || `${metricLabel}`;
}

function powerBiBuildDisplayNote(result, rows = []) {
  const interpretation = result?.interpretation || {};
  const notes = [];

  if (interpretation.intent !== "total_metric" && Number(interpretation.topN || 0) > 0) {
    notes.push(`Top ${interpretation.topN}`);
  }

  if (Boolean(result?.truncated)) {
    notes.push("Resultado truncado");
  } else if (Array.isArray(rows) && rows.length && Number(result?.rowCount || rows.length) > rows.length) {
    notes.push(`Se muestran ${rows.length} de ${Number(result.rowCount || rows.length)} filas`);
  } else if (Array.isArray(rows) && rows.length > 1) {
    notes.push(`Vista resumida de ${rows.length} filas`);
  }

  return notes.join(" · ");
}

function powerBiCsvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function powerBiBuildCsv(result) {
  const rows = powerBiGetResultRows(result);
  const columns = powerBiGetResultColumns(result, rows);
  if (!columns.length) {
    return "";
  }

  const header = columns.map((column, index) =>
    powerBiCsvEscape(powerBiHumanizeColumnLabel(column, result?.interpretation || {}, index))
  );
  const body = rows.map((row) =>
    columns
      .map((column) => powerBiCsvEscape(row?.[column] ?? ""))
      .join(";")
  );
  return [header.join(";"), ...body].join("\n");
}

function powerBiBuildPlainText(result) {
  if (!result) {
    return "";
  }

  const rows = powerBiGetResultRows(result);
  const columns = powerBiGetResultColumns(result, rows);
  const interpretation = result.interpretation || {};
  const lines = [
    powerBiBuildResultTitle(result),
    String(result.headline || result.naturalSummary || "").trim(),
    `${result.sourceLabel || "Power BI / administracion_ventas"} · Filas ${Number(result.rowCount || rows.length || 0)} · truncado ${result.truncated ? "sí" : "no"}`
  ].filter(Boolean);

  if (columns.length && rows.length) {
    lines.push("");
    lines.push(columns.map((column, index) => powerBiHumanizeColumnLabel(column, interpretation, index)).join("\t"));
    rows.forEach((row) => {
      lines.push(columns.map((column) => powerBiFormatCellValue(column, row?.[column], interpretation)).join("\t"));
    });
  }

  return lines.join("\n");
}

async function powerBiCopyToClipboard(text) {
  const safeText = String(text || "");
  if (!safeText) {
    return;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(safeText);
    return;
  }

  if (typeof document === "undefined") {
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = safeText;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function powerBiDownloadText(filename, content, mimeType) {
  if (typeof document === "undefined") {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getPowerBiChatMessageContent(route) {
  if (!route) {
    return "";
  }

  if (route.rejected) {
    return String(route.message || "Consulta Power BI rechazada.").trim();
  }

  if (route.error) {
    return String(route.error || "No se pudo resolver la consulta Power BI.").trim();
  }

  if (route.response?.headline) {
    return String(route.response.headline).trim();
  }

  if (route.formatted?.headline) {
    return String(route.formatted.headline).trim();
  }

  return String(route.message || "").trim();
}

const summaryCards = [
  {
    title: "Impacto confirmado en usuarios",
    value: "Usuarios",
    detail: "Incidencias con evidencia funcional.",
    prompt:
      "Cruza Zabbix e IncidenciasTI e identifica impacto confirmado en usuarios. Incluye activo, incidencia, evidencia y acción recomendada."
  },
  {
    title: "Riesgos críticos sin ticket",
    value: "Zabbix",
    detail: "Riesgos técnicos sin incidencia asociada.",
    prompt:
      "Identifica problemas críticos de Zabbix que no parezcan tener ticket o incidencia asociada en IncidenciasTI. Prioriza pérdida de datos, storage y backups."
  },
  {
    title: "Incidencias abiertas",
    value: "Abiertas",
    detail: "Trabajo pendiente reportado por usuarios.",
    prompt:
      "Muestra las incidencias abiertas de IncidenciasTI agrupadas por prioridad, sistema afectado, antigüedad y posible relación con Zabbix."
  },
  {
    title: "Sistemas con riesgo de pérdida de datos",
    value: "Datos",
    detail: "NAS, storage, SMART y backups.",
    prompt:
      "Consulta Zabbix y dame sistemas con riesgo de pérdida de datos. Prioriza SMART, RAID, NAS, Proxmox, storage y backups."
  },
  {
    title: "Huecos de monitorización",
    value: "Cobertura",
    detail: "Activos sin visibilidad suficiente.",
    prompt:
      "Dame los huecos de monitorización más importantes para razonar mejor sobre impacto en usuarios, backups, NAS, red, impresoras y servicios."
  },
  {
    title: "Acciones recomendadas para hoy",
    value: "Plan",
    detail: "Ordenadas por impacto y urgencia.",
    prompt:
      "Dame acciones recomendadas para hoy. Ordénalas por impacto, urgencia, riesgo técnico, dependencia humana y si requieren cambio en sistemas."
  }
];

const dashboardActions = [
  {
    label: "Generar resumen operativo de hoy",
    prompt: dailyReportPrompt,
    reportType: "daily_summary",
    title: "Resumen operativo de hoy"
  },
  {
    label: "Generar matriz",
    prompt: matrixPrompt,
    reportType: "correlation_matrix",
    title: "Matriz de correlación Zabbix + IncidenciasTI"
  },
  {
    label: "Ver incidencias abiertas",
    prompt:
      "Muestra las incidencias abiertas de IncidenciasTI agrupadas por estado, prioridad, sistema afectado y antigüedad."
  },
  {
    label: "Ver riesgos críticos",
    prompt:
      "Muestra los riesgos críticos de Zabbix ahora mismo, ordenados por severidad e impacto operativo.",
    reportType: "risks",
    title: "Riesgos críticos Zabbix"
  },
  {
    label: "Ver huecos de monitorización",
    prompt:
      "Muestra los huecos de monitorización más importantes y qué datos necesita Zabbix para que el agente razone mejor.",
    reportType: "monitoring_gaps",
    title: "Huecos de monitorización"
  }
];

const navigationTabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "today", label: "Informe de hoy" },
  { id: "matrix", label: "Matriz" },
  { id: "analysis", label: "Análisis" },
  { id: "powerbi", label: "Power BI" },
  { id: "communications", label: "Comunicaciones" },
  { id: "directory", label: "Libreta" },
  { id: "history", label: "Histórico" },
  { id: "chat_voice", label: "Chat/Voz" }
];

function exportUrl(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function reportExportUrl(reportId, format, params = {}) {
  return exportUrl(`/api/export/report/${reportId}`, { format, ...params });
}

function latestExportUrl(kind, format = "html", params = {}) {
  return exportUrl(`/api/export/${kind}`, { format, ...params });
}

function communicationDraftUrl(id) {
  return `/api/communications/drafts/${id}`;
}

function communicationDraftViewerPath(id) {
  return `/communications/drafts/${encodeURIComponent(String(id || "").trim())}`;
}

function communicationDraftTypeLabel(value) {
  return communicationTypes.find((item) => item.value === value)?.label || value || "email";
}

function communicationDraftStatusLabel(value) {
  return communicationStatuses.find((item) => item.value === value)?.label || value || "draft";
}

function communicationDraftSendStatusLabel(value) {
  return communicationSendStatuses.find((item) => item.value === value)?.label || value || "No enviado";
}

function communicationDraftFilterStatusLabel(value) {
  return communicationStatusFilters.find((item) => item.value === value)?.label || value || "Todos";
}

function communicationDraftSourceLabel(value) {
  return (
    communicationSourceTypes.find((item) => item.value === value)?.label || value || "manual"
  );
}

function powerBiCatalogSourceLabel(value) {
  switch (String(value || "").toLowerCase()) {
    case "tmdl":
    case "pbip":
    case "json":
      return "Import asistido";
    case "xmla":
      return "XMLA";
    case "rest":
      return "REST";
    default:
      return value || "REST";
  }
}

function communicationTemplateLabel(value, templates = []) {
  return templates.find((template) => template.id === value)?.name || value || "Sin plantilla";
}

function directoryUserEmail(user) {
  return user?.mail || user?.user_principal_name || "";
}

function directoryUserPhone(value) {
  return String(value || "").trim();
}

function communicationDraftBodyText(draft) {
  return String(draft?.body_text || draft?.body_markdown || "").trim();
}

function normalizeCommunicationEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAllowedDomains(domains = []) {
  return (Array.isArray(domains) ? domains : [])
    .map((domain) => String(domain || "").trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function communicationDraftRecipientDomain(draft) {
  const email = normalizeCommunicationEmail(draft?.recipient_email);
  if (!email.includes("@")) {
    return "";
  }
  return email.split("@").pop() || "";
}

function communicationDraftDomainAllowed(email, allowedDomains = []) {
  const domain = communicationDraftRecipientDomain({ recipient_email: email });
  const normalizedDomains = normalizeAllowedDomains(allowedDomains);
  if (!domain || !normalizedDomains.length) {
    return false;
  }
  return normalizedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function communicationDraftIsSent(draft) {
  return draft?.send_status === "sent" || Boolean(draft?.sent_at);
}

function getCommunicationSendReadiness(draft, { preparation = null, allowedDomains = [] } = {}) {
  const recipientEmail = normalizeCommunicationEmail(draft?.recipient_email);
  const recipientDomain = communicationDraftRecipientDomain({ recipient_email: recipientEmail });
  const normalizedAllowedDomains = normalizeAllowedDomains(allowedDomains);
  const subject = String(draft?.subject || "").trim();
  const body = communicationDraftBodyText(draft);
  const isEmail = draft?.type === "email";
  const isReviewed = draft?.status === "reviewed";
  const isSent = communicationDraftIsSent(draft);
  const isSending = draft?.send_status === "sending";
  const allowedDomain = communicationDraftDomainAllowed(recipientEmail, normalizedAllowedDomains);
  const matchingPreparation =
    Boolean(preparation?.confirmation_token) &&
    String(preparation?.draft?.id || "") === String(draft?.id || "") &&
    normalizeCommunicationEmail(preparation?.draft?.recipient_email) === recipientEmail &&
    String(preparation?.draft?.subject || "").trim() === subject &&
    communicationDraftBodyText(preparation?.draft) === body;

  const checks = {
    recipientEmail: {
      ok: Boolean(recipientEmail),
      label: "Destinatario informado",
      detail: recipientEmail || "Falta email destinatario"
    },
    allowedDomain: {
      ok: Boolean(recipientEmail && allowedDomain),
      label: "Dominio permitido",
      detail: recipientEmail
        ? normalizedAllowedDomains.length
          ? recipientDomain || "Sin dominio"
          : "Dominio pendiente"
        : "Sin dominio"
    },
    subject: {
      ok: Boolean(subject),
      label: "Asunto informado",
      detail: subject || "Falta asunto"
    },
    body: {
      ok: Boolean(body),
      label: "Cuerpo informado",
      detail: body ? "Contenido presente" : "Falta cuerpo"
    },
    reviewed: {
      ok: isReviewed,
      label: "Estado revisado",
      detail: communicationDraftStatusLabel(draft?.status)
    },
    notSent: {
      ok: !isSent && !isSending,
      label: "No enviado previamente",
      detail: isSent
        ? "Ya enviado"
        : isSending
          ? "Enviando"
          : communicationDraftSendStatusLabel(draft?.send_status)
    },
    preparedToken: {
      ok: matchingPreparation,
      label: "Confirmacion preparada",
      detail: matchingPreparation ? "Token preparado" : "Prepara el envio primero"
    }
  };

  const baseBlockers = [];
  if (!isEmail) baseBlockers.push("El borrador debe ser de tipo email");
  if (!checks.recipientEmail.ok) baseBlockers.push("Falta email destinatario");
  if (checks.recipientEmail.ok && !checks.allowedDomain.ok) {
    baseBlockers.push(
      normalizedAllowedDomains.length
        ? "Dominio no permitido"
        : "No se pudieron cargar dominios permitidos"
    );
  }
  if (!checks.subject.ok) baseBlockers.push("Falta asunto");
  if (!checks.body.ok) baseBlockers.push("Falta cuerpo");
  if (!checks.notSent.ok) baseBlockers.push(isSent ? "Ya enviado" : "Envío en curso");

  const prepareBlockers = [...baseBlockers];
  if (!checks.reviewed.ok) prepareBlockers.push("Debe estar revisado");

  const confirmBlockers = [...prepareBlockers];
  if (!checks.preparedToken.ok) confirmBlockers.push("Falta preparación de envío");

  return {
    canPrepare: prepareBlockers.length === 0,
    canConfirm: confirmBlockers.length === 0,
    canDirectSend: baseBlockers.length === 0,
    blockers: prepareBlockers,
    confirmBlockers,
    directSendBlockers: baseBlockers,
    checks,
    recipientDomain,
    allowedDomains: normalizedAllowedDomains
  };
}

function communicationDraftCanPrepareSend(draft, allowedDomains = []) {
  return getCommunicationSendReadiness(draft, { allowedDomains }).canPrepare;
}

function communicationDraftCanConfirmSend(draft, preparation, allowedDomains = []) {
  return getCommunicationSendReadiness(draft, { preparation, allowedDomains }).canConfirm;
}

function directoryUserAccountLabel(user) {
  if (user?.account_enabled === null || user?.account_enabled === undefined) {
    return "Sin estado";
  }
  return user.account_enabled ? "Activo" : "Inactivo";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCommunicationDownloadName(draft, extension) {
  const subject = String(draft?.subject || "borrador")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `comunicacion-${draft?.id || "nuevo"}-${subject || "borrador"}.${extension}`;
}

function buildCommunicationHtmlDocument(draft) {
  const templateLabel = String(draft?.template_id || "Sin plantilla");
  const rows = [
    ["Tipo", communicationDraftTypeLabel(draft?.type)],
    ["Estado", communicationDraftStatusLabel(draft?.status)],
    ["Destinatario", draft?.recipient_label || "Sin destinatario"],
    ["Email", draft?.recipient_email || "Sin email"],
    ["Fuente", communicationDraftSourceLabel(draft?.source_type)],
    ["Plantilla", templateLabel],
    ["Fuente ID informe", draft?.source_report_id ? `#${draft.source_report_id}` : "Sin ID"],
    ["Fuente ID incidencia", draft?.source_incident_id || "Sin ID"],
    ["Notas de revisión", draft?.review_notes || "Sin notas"],
    ["Estado de envío", draft?.send_status || "not_sent"],
    ["Remitente real", draft?.from_user || "Sin remitente"],
    ["Enviado por", draft?.sent_by || "Sin registro"],
    ["Preparado", draft?.send_prepared_at || "Sin registro"],
    ["Intento", draft?.send_attempt_at || "Sin registro"],
    ["Enviado", draft?.sent_at || "Sin registro"],
    ["Error", draft?.send_error || "Sin error"],
    ["Última acción", draft?.last_action_at || "Sin registro"],
    ["Revisado", draft?.reviewed_at || "Sin registro"],
    ["Copiado", draft?.copied_at || "Sin registro"],
    ["Descartado", draft?.discarded_at || "Sin registro"]
  ];

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(draft?.subject || "Borrador de comunicación")}</title>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; color: #17202a; background: #eef1f4; }
    main { max-width: 920px; margin: 0 auto; background: #fff; border: 1px solid #d9e0e8; border-radius: 8px; padding: 24px; box-shadow: 0 18px 45px rgba(20, 31, 45, 0.11); }
    h1, h2, h3 { margin: 0 0 12px; letter-spacing: 0; }
    h1 { font-size: 26px; line-height: 1.15; }
    p { margin: 0 0 12px; color: #667385; line-height: 1.55; }
    .meta { width: 100%; border-collapse: collapse; margin: 16px 0 20px; }
    .meta th, .meta td { border: 1px solid #d9e0e8; padding: 9px 10px; text-align: left; vertical-align: top; font-size: 13px; }
    .meta th { width: 220px; background: #f7f9fb; }
    .body { white-space: pre-wrap; line-height: 1.6; background: #f7f9fb; border: 1px solid #d9e0e8; border-radius: 8px; padding: 16px; font-size: 13px; }
    .stamp { color: #667385; font-size: 12px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <main>
    <div class="stamp">Borrador generado para revisión manual</div>
    <h1>${escapeHtml(draft?.subject || "Borrador de comunicación")}</h1>
    <p>${escapeHtml(draft?.recipient_label || "Sin destinatario")}</p>
    <table class="meta">
      <tbody>
        ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}
      </tbody>
    </table>
    <h2>Cuerpo</h2>
    <div class="body">${escapeHtml(draft?.body_text || draft?.body_markdown || "")}</div>
  </main>
</body>
</html>`;
}

function buildCommunicationMarkdownDocument(draft) {
  const templateLabel = String(draft?.template_id || "Sin plantilla");
  return [
    `# ${draft?.subject || "Borrador de comunicación"}`,
    "",
    `- Tipo: ${communicationDraftTypeLabel(draft?.type)}`,
    `- Estado: ${communicationDraftStatusLabel(draft?.status)}`,
    `- Destinatario: ${draft?.recipient_label || "Sin destinatario"}`,
    `- Email: ${draft?.recipient_email || "Sin email"}`,
    `- Fuente: ${communicationDraftSourceLabel(draft?.source_type)}`,
    `- Plantilla: ${templateLabel}`,
    `- Fuente informe: ${draft?.source_report_id ? `#${draft.source_report_id}` : "Sin ID"}`,
    `- Fuente incidencia: ${draft?.source_incident_id || "Sin ID"}`,
    `- Notas de revisión: ${draft?.review_notes || "Sin notas"}`,
    `- Estado de envío: ${draft?.send_status || "not_sent"}`,
    `- Remitente real: ${draft?.from_user || "Sin remitente"}`,
    `- Enviado por: ${draft?.sent_by || "Sin registro"}`,
    `- Preparado: ${draft?.send_prepared_at || "Sin registro"}`,
    `- Intento: ${draft?.send_attempt_at || "Sin registro"}`,
    `- Enviado: ${draft?.sent_at || "Sin registro"}`,
    `- Error: ${draft?.send_error || "Sin error"}`,
    `- Última acción: ${draft?.last_action_at || "Sin registro"}`,
    `- Revisado: ${draft?.reviewed_at || "Sin registro"}`,
    `- Copiado: ${draft?.copied_at || "Sin registro"}`,
    `- Descartado: ${draft?.discarded_at || "Sin registro"}`,
    "",
    "## Cuerpo",
    "",
    draft?.body_markdown || draft?.body_text || ""
  ].join("\n");
}

function buildCommunicationPlainText(draft) {
  const templateLabel = String(draft?.template_id || "Sin plantilla");
  return [
    draft?.subject || "Borrador de comunicación",
    "",
    `Destinatario: ${draft?.recipient_label || "Sin destinatario"}`,
    `Email: ${draft?.recipient_email || "Sin email"}`,
    `Fuente: ${communicationDraftSourceLabel(draft?.source_type)}`,
    `Plantilla: ${templateLabel}`,
    `Fuente informe: ${draft?.source_report_id ? `#${draft.source_report_id}` : "Sin ID"}`,
    `Fuente incidencia: ${draft?.source_incident_id || "Sin ID"}`,
    `Notas de revisión: ${draft?.review_notes || "Sin notas"}`,
    `Estado de envío: ${draft?.send_status || "not_sent"}`,
    `Remitente real: ${draft?.from_user || "Sin remitente"}`,
    `Enviado por: ${draft?.sent_by || "Sin registro"}`,
    `Preparado: ${draft?.send_prepared_at || "Sin registro"}`,
    `Intento: ${draft?.send_attempt_at || "Sin registro"}`,
    `Enviado: ${draft?.sent_at || "Sin registro"}`,
    `Error: ${draft?.send_error || "Sin error"}`,
    `Última acción: ${draft?.last_action_at || "Sin registro"}`,
    `Revisado: ${draft?.reviewed_at || "Sin registro"}`,
    `Copiado: ${draft?.copied_at || "Sin registro"}`,
    `Descartado: ${draft?.discarded_at || "Sin registro"}`,
    "",
    draft?.body_text || draft?.body_markdown || ""
  ].join("\n");
}

function buildMailtoHref(draft) {
  if (!draft?.recipient_email) {
    return null;
  }

  const subject = encodeURIComponent(draft.subject || "");
  const body = encodeURIComponent(draft.body_text || draft.body_markdown || "");
  return `mailto:${encodeURIComponent(draft.recipient_email)}?subject=${subject}&body=${body}`;
}

function communicationDraftId(value) {
  return String(value?.id ?? value?.draft_id ?? value ?? "").trim();
}

function normalizeCommunicationDraftRecord(draft = {}) {
  const normalizedId = draft?.id ?? draft?.draft_id ?? "";
  return {
    id: normalizedId ? Number(normalizedId) || String(normalizedId) : "",
    draft_id: normalizedId ? Number(normalizedId) || String(normalizedId) : "",
    type: draft?.type ?? draft?.communication_type ?? "email",
    status: draft?.status ?? "draft",
    recipient_label: draft?.recipient_label ?? draft?.recipientName ?? draft?.recipient_name ?? draft?.recipientLabel ?? "",
    recipient_name: draft?.recipient_name ?? draft?.recipientName ?? draft?.recipient_label ?? draft?.recipientLabel ?? "",
    recipient_email: draft?.recipient_email ?? draft?.recipientEmail ?? "",
    optional_email: draft?.optional_email ?? draft?.optionalEmail ?? "",
    subject: draft?.subject ?? "",
    body_markdown: draft?.body_markdown ?? draft?.bodyMarkdown ?? "",
    body_text: draft?.body_text ?? draft?.bodyText ?? "",
    body_html: draft?.body_html ?? draft?.bodyHtml ?? "",
    source_type: draft?.source_type ?? draft?.sourceType ?? "manual",
    source_report_id: draft?.source_report_id ?? draft?.sourceReportId ?? "",
    source_incident_id: draft?.source_incident_id ?? draft?.sourceIncidentId ?? "",
    template_id: draft?.template_id ?? draft?.template_key ?? draft?.template ?? "",
    review_notes: draft?.review_notes ?? draft?.reviewNotes ?? "",
    created_at: draft?.created_at ?? draft?.createdAt ?? "",
    updated_at: draft?.updated_at ?? draft?.updatedAt ?? "",
    reviewed_at: draft?.reviewed_at ?? draft?.reviewedAt ?? "",
    reviewed_by: draft?.reviewed_by ?? draft?.reviewedBy ?? "",
    copied_at: draft?.copied_at ?? draft?.copiedAt ?? "",
    discarded_at: draft?.discarded_at ?? draft?.discardedAt ?? "",
    last_action_at: draft?.last_action_at ?? draft?.lastActionAt ?? "",
    send_status: draft?.send_status ?? draft?.sendStatus ?? "not_sent",
    send_prepared_at: draft?.send_prepared_at ?? draft?.sendPreparedAt ?? "",
    send_attempt_at: draft?.send_attempt_at ?? draft?.sendAttemptAt ?? "",
    sent_at: draft?.sent_at ?? draft?.sentAt ?? "",
    sent_by: draft?.sent_by ?? draft?.sentBy ?? "",
    from_user: draft?.from_user ?? draft?.fromUser ?? "",
    send_error: draft?.send_error ?? draft?.sendError ?? "",
    direct_send_requested:
      draft?.direct_send_requested ?? draft?.directSendRequested ?? 0,
    direct_send_source: draft?.direct_send_source ?? draft?.directSendSource ?? "",
    direct_send_requested_at:
      draft?.direct_send_requested_at ?? draft?.directSendRequestedAt ?? "",
    direct_send_from_user:
      draft?.direct_send_from_user ?? draft?.directSendFromUser ?? "",
    direct_send_recipient_email:
      draft?.direct_send_recipient_email ?? draft?.directSendRecipientEmail ?? "",
    direct_send_source_incident_id:
      draft?.direct_send_source_incident_id ?? draft?.directSendSourceIncidentId ?? "",
    direct_send_send_status:
      draft?.direct_send_send_status ?? draft?.directSendSendStatus ?? "",
    direct_send_send_attempt_at:
      draft?.direct_send_send_attempt_at ?? draft?.directSendSendAttemptAt ?? "",
    direct_send_sent_at:
      draft?.direct_send_sent_at ?? draft?.directSendSentAt ?? "",
    direct_send_sent_by:
      draft?.direct_send_sent_by ?? draft?.directSendSentBy ?? "",
    direct_send_send_error:
      draft?.direct_send_send_error ?? draft?.directSendSendError ?? ""
  };
}

function defaultCommunicationDraftForm() {
  return {
    id: "",
    type: "email",
    status: "draft",
    recipient_label: "",
    recipient_email: "",
    optional_email: "",
    subject: "",
    body_markdown: "",
    body_text: "",
    body_html: "",
    source_type: "manual",
    source_report_id: "",
    source_incident_id: "",
    template_id: "",
    review_notes: "",
    created_at: "",
    updated_at: ""
  };
}

function ExportLink({ href, children, inline = false }) {
  return (
    <a
      className="action-button secondary-action export-link"
      href={href}
      target={inline ? "_blank" : undefined}
      rel={inline ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

function ExportToolbar({ label, children }) {
  return (
    <div className="export-toolbar" aria-label={label}>
      {children}
    </div>
  );
}

async function requestClientSecret(existingClientSecret) {
  const response = await fetch("/api/chatkit/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      refresh: Boolean(existingClientSecret)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.client_secret) {
    throw new Error(data.error || "No se pudo crear la sesión ChatKit.");
  }

  return data.client_secret;
}

function StructuredDailyView({ data }) {
  return (
    <div className="structured-block">
      <div className="structured-status-row">
        <span className={`status-badge ${data.overall_status || "unknown"}`}>
          {data.overall_status || "unknown"}
        </span>
        <p>{data.executive_summary}</p>
      </div>
      <div className="structured-cards">
        {(data.key_findings || []).slice(0, 6).map((finding) => (
          <article key={`${finding.title}-${finding.severity}`} className="structured-card">
            <span className={`severity-pill ${finding.severity}`}>{finding.severity}</span>
            <h3>{finding.title}</h3>
            <p>{finding.description}</p>
            <strong>{finding.recommended_action}</strong>
          </article>
        ))}
      </div>
      <div className="structured-list">
        <h3>Acciones principales</h3>
        {(data.top_actions || []).map((action) => (
          <p key={`${action.priority}-${action.action}`}>
            <strong>{action.priority}</strong> · {action.action} · {action.owner_type}
          </p>
        ))}
      </div>
    </div>
  );
}

function StructuredCorrelationView({ data }) {
  return (
    <div className="structured-block">
      <p className="structured-summary">{data.summary}</p>
      <div className="matrix-table-wrap">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Activo / servicio</th>
              <th>Problema técnico</th>
              <th>Incidencias relacionadas</th>
              <th>Nivel</th>
              <th>Impacto usuario</th>
              <th>Riesgo técnico</th>
              <th>Prioridad</th>
              <th>Acción recomendada</th>
              <th>Tipo de tarea</th>
            </tr>
          </thead>
          <tbody>
            {(data.rows || []).map((row) => (
              <tr key={`${row.asset_or_service}-${row.technical_problem}`}>
                <td>{row.asset_or_service}</td>
                <td>{row.technical_problem}</td>
                <td>
                  {(row.related_incidents || []).length
                    ? row.related_incidents
                        .map((incident) => `${incident.id} ${incident.title} (${incident.status})`)
                        .join("; ")
                    : "Sin incidencia directa"}
                </td>
                <td>
                  <span className="matrix-pill">{row.correlation_level}</span>
                </td>
                <td>{row.user_impact}</td>
                <td>{row.technical_risk}</td>
                <td>
                  <span className="priority-pill">{row.priority}</span>
                </td>
                <td>{row.recommended_action}</td>
                <td>{row.task_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="structured-columns">
        <div>
          <h3>Impacto confirmado</h3>
          {(data.confirmed_impact || []).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <h3>Críticos sin ticket</h3>
          {(data.critical_without_ticket || []).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <h3>Huecos</h3>
          {(data.monitoring_gaps || []).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function StructuredRisksView({ data }) {
  return (
    <div className="structured-block">
      <p className="structured-summary">{data.summary}</p>
      <div className="structured-cards">
        {(data.risks || []).map((risk) => (
          <article key={`${risk.asset_or_service}-${risk.severity}`} className="structured-card">
            <span className={`severity-pill ${risk.severity}`}>{risk.severity}</span>
            <h3>{risk.asset_or_service}</h3>
            <p>{risk.evidence}</p>
            <strong>{risk.recommended_action}</strong>
          </article>
        ))}
      </div>
    </div>
  );
}

function StructuredGapsView({ data }) {
  return (
    <div className="structured-block">
      <p className="structured-summary">{data.summary}</p>
      <div className="structured-cards">
        {(data.gaps || []).map((gap) => (
          <article key={`${gap.block}-${gap.asset_or_service}`} className="structured-card">
            <span className={`severity-pill ${gap.priority}`}>{gap.priority}</span>
            <h3>
              {gap.block} · {gap.asset_or_service}
            </h3>
            <p>{gap.current_coverage}</p>
            <strong>{gap.recommended_action}</strong>
          </article>
        ))}
      </div>
    </div>
  );
}

function StructuredResultView({ result }) {
  if (!result?.data) {
    return null;
  }

  const { data, kind, source, warning } = result;

  return (
    <section className="structured-section" aria-label="Resultado estructurado">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Resultado estructurado</p>
          <h3>{data.title}</h3>
        </div>
        <span className="structured-source">{source}</span>
      </div>
      {warning ? <p className="structured-warning">Aviso: {warning}</p> : null}
      {kind === "correlation-matrix" ? (
        <StructuredCorrelationView data={data} />
      ) : kind === "critical-risks" ? (
        <StructuredRisksView data={data} />
      ) : kind === "monitoring-gaps" ? (
        <StructuredGapsView data={data} />
      ) : (
        <StructuredDailyView data={data} />
      )}
    </section>
  );
}

function PowerBiChatResultView({ result, expanded = false, onExpand }) {
  const [showDax, setShowDax] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  if (!result) {
    return null;
  }

  const interpretation = result.interpretation || {};
  const rows = powerBiGetResultRows(result);
  const columns = powerBiGetResultColumns(result, rows);
  const hasRows = rows.length > 0;
  const rowCount = Number(result.rowCount || rows.length || 0);
  const timestamp = result.generatedAt || result.createdAt || result.timestamp || null;
  const title = powerBiBuildResultTitle(result);
  const summary = String(result.headline || "").trim() || title;
  const previewRows = expanded ? rows : rows.slice(0, 3);
  const displayNote = powerBiBuildDisplayNote({ ...result, rowCount }, previewRows);
  const isKpi = String(interpretation.intent || "") === "total_metric";
  const kpiValue = powerBiGetKpiValue(result, rows, columns);
  const kpiLabel = formatPowerBiMetricLabel(interpretation.metric);
  const showExpand = typeof onExpand === "function" && !expanded;
  const hasDax = Boolean(String(result.dax || "").trim());
  const hasCsv = hasRows && columns.length > 0;
  const csvFilename = `${String(title || "powerbi-resultado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "powerbi-resultado"}.csv`;

  async function handleCopyResult() {
    try {
      await powerBiCopyToClipboard(powerBiBuildPlainText(result));
      setCopyStatus("Copiado");
      setTimeout(() => setCopyStatus(""), 1800);
    } catch {
      setCopyStatus("No se pudo copiar");
      setTimeout(() => setCopyStatus(""), 2400);
    }
  }

  function handleDownloadCsv() {
    const csv = powerBiBuildCsv(result);
    if (!csv) {
      return;
    }
    powerBiDownloadText(csvFilename, csv, "text/csv;charset=utf-8");
  }

  return (
    <section className={`powerbi-result-card ${expanded ? "expanded" : ""}`} aria-label="Respuesta Power BI">
      <div className="powerbi-result-header">
        <div className="powerbi-result-heading">
          <p className="eyebrow">Power BI Ask Lab</p>
          <h3>{title}</h3>
          <p className="powerbi-result-summary">{summary}</p>
        </div>
        <div className="powerbi-result-meta">
          <span className="structured-source">{result.sourceLabel || "Power BI / administracion_ventas"}</span>
          <div className="structured-status-row">
            <span className="status-badge green">Filas {rowCount || 0}</span>
            <span className={`status-badge ${result.truncated ? "yellow" : "green"}`}>
              truncado {result.truncated ? "sí" : "no"}
            </span>
          </div>
          <span className="powerbi-result-timestamp">{timestamp ? formatDate(timestamp) : "Sin fecha"}</span>
        </div>
      </div>

      {displayNote ? <p className="powerbi-result-note">{displayNote}</p> : null}

      {isKpi ? (
        <div className="powerbi-kpi-card" aria-label={`${kpiLabel} totales`}>
          <span className="powerbi-kpi-label">{kpiLabel}</span>
          <strong className="powerbi-kpi-value">
            {kpiLabel === "Ventas"
              ? powerBiFormatCurrency(kpiValue ?? 0)
              : powerBiFormatInteger(kpiValue ?? 0)}
          </strong>
          <span className="powerbi-kpi-meta">{result.sourceLabel || "Power BI / administracion_ventas"}</span>
          <span className="powerbi-kpi-meta">{timestamp ? formatDate(timestamp) : "Sin fecha"}</span>
        </div>
      ) : null}

      {!isKpi && hasRows ? (
        <div className={`powerbi-result-table-wrap ${expanded ? "expanded" : ""}`}>
          <table className="powerbi-result-table">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={column} title={powerBiHumanizeColumnLabel(column, interpretation, index)}>
                    {powerBiHumanizeColumnLabel(column, interpretation, index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, index) => {
                const rowValues = columns.map((column) => row?.[column]);
                const rowKey = `${index}-${rowValues.map((item) => String(item ?? "")).join("-")}`;
                return (
                  <tr key={rowKey}>
                    {columns.map((column, columnIndex) => {
                      const cellValue = row?.[column];
                      const displayValue = powerBiFormatCellValue(column, cellValue, interpretation);
                      const numericCell = typeof cellValue === "number";
                      return (
                        <td
                          key={column}
                          title={displayValue}
                          className={numericCell ? "powerbi-result-cell numeric" : "powerbi-result-cell"}
                        >
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!hasRows ? (
        <p className="empty-history">Sin filas para mostrar.</p>
      ) : !expanded && rows.length > previewRows.length ? (
        <p className="powerbi-result-note">
          Vista previa de {previewRows.length} de {rowCount} filas.
        </p>
      ) : null}

      {hasDax && showDax ? (
        <div className="powerbi-dax-preview">
          <div className="structured-status-row">
            <span className="structured-source">DAX generado internamente</span>
            <button type="button" className="action-button secondary-action" onClick={() => setShowDax(false)}>
              Ocultar DAX
            </button>
          </div>
          <pre>{result.dax}</pre>
        </div>
      ) : null}

      <div className="powerbi-result-actions">
        <button type="button" className="action-button secondary-action" onClick={handleCopyResult}>
          {copyStatus || "Copiar resultado"}
        </button>
        {hasCsv ? (
          <button type="button" className="action-button secondary-action" onClick={handleDownloadCsv}>
            Descargar CSV
          </button>
        ) : null}
        {hasDax && !showDax ? (
          <button type="button" className="action-button secondary-action" onClick={() => setShowDax(true)}>
            Ver DAX
          </button>
        ) : null}
        {showExpand ? (
          <button type="button" className="action-button secondary-action" onClick={() => onExpand(result)}>
            Ver resultado ampliado
          </button>
        ) : null}
      </div>
    </section>
  );
}

function OpsResultView({
  result,
  onPrevious,
  onNext,
  onPrepareCreatorEmail,
  onSelectIncident
}) {
  if (!result) {
    return null;
  }

  const visual = result.visualResult || result;
  const sourceLabel = visual.sourceLabel || result.source || "IncidenciasTI / Zabbix";
  const title = visual.title || "Resultado operativo";
  const summary = visual.summary || result.spokenResponse || result.message || "";
  const timestamp = result.at || result.generatedAt || result.createdAt || visual.latestAt || null;
  const kind = String(visual.kind || result.kind || "").trim();
  const isCorrelation = kind === "correlation_requested";
  const sourceBlocks = Array.isArray(visual.sourceBlocks) ? visual.sourceBlocks : [];
  const isLive = visual.live || result.live;
  const firewallHosts = Array.isArray(visual.hosts) ? visual.hosts : [];
  const firewallGaps = Array.isArray(visual.gaps) ? visual.gaps : [];
  const firewallProblems = Array.isArray(visual.activeProblems) ? visual.activeProblems : [];

  return (
    <section className="structured-block ops-result-banner" aria-label="Resultado operativo">
      <div className="structured-status-row">
        <span
          className={`status-badge ${
            result.unsupported ? "yellow" : isCorrelation ? "yellow" : "green"
          }`}
        >
          {result.source === "IncidenciasTI / Zabbix" && result.source !== "voice"
            ? "Resultado operativo"
            : result.source === "IncidenciasTI / Zabbix" && result.kind === "combined_summary"
              ? "Resumen separado"
              : result.source === "IncidenciasTI / Zabbix"
                ? "Resultado operativo"
                : "Resultado operativo"}
        </span>
        <p>
          {sourceLabel}
          {result.question ? ` · ${result.question}` : ""}
          {timestamp ? ` · ${formatDate(timestamp)}` : ""}
        </p>
      </div>

      <p className="structured-summary">{summary}</p>

      {kind === "combined_summary" && sourceBlocks.length ? (
        <div className="structured-columns">
          {sourceBlocks.map((block) => (
            <article key={`${block.label}-${block.ordering}`} className="structured-card">
              <div className="structured-status-row">
                <span className="structured-source">{block.label || "Fuente"}</span>
                <span className="structured-source">{block.ordering || "live read"}</span>
              </div>
              <p>{block.summary || "Sin resumen."}</p>
              {(Array.isArray(block.items) && block.items.length ? block.items : []).slice(0, 3).map((item) => (
                <p key={`${block.label}-${item.id || item.title || item.detail || "item"}`}>
                  <strong>{item.id ? `ID ${item.id} · ` : ""}</strong>
                  {item.title || item.detail || "Elemento"}
                  {item.status ? ` · ${item.status}` : ""}
                  {item.priority ? ` · ${item.priority}` : ""}
                </p>
              ))}
            </article>
          ))}
        </div>
      ) : null}

      {kind === "firewall_status" ? (
        <div className="structured-card">
          <div className="structured-status-row">
            <span className="structured-source">{sourceLabel}</span>
            <span className="structured-source">{visual.generatedAt || visual.latestAt || "live read"}</span>
            {isLive ? <span className="structured-source">Live read</span> : null}
          </div>
          <h3>{title}</h3>
          <p>{summary}</p>
          <p>
            <strong>Firewalls:</strong>{" "}
            {firewallHosts.length ? firewallHosts.join(", ") : "Sin hosts listados"}
          </p>
          <p>
            <strong>Problemas activos:</strong>{" "}
            {firewallProblems.length
              ? firewallProblems
                  .slice(0, 3)
                  .map((item) => item.title || item.detail || "Problema de firewall")
                  .join(" · ")
              : "Sin problemas filtrados"}
          </p>
          <p>
            <strong>Huecos de monitorización:</strong>{" "}
            {firewallGaps.length
              ? firewallGaps
                  .slice(0, 4)
                  .map((gap) => `${gap.host || "firewall"}: ${gap.missing_check || gap.description}`)
                  .join(" · ")
              : "Sin huecos destacados"}
          </p>
        </div>
      ) : null}

      {kind === "incidents_user" && visual.item ? (
        <article className="structured-card">
          <div className="structured-status-row">
            <span className="structured-source">{sourceLabel}</span>
            <span className="structured-source">{visual.ordering || "created desc / id desc"}</span>
            {isLive ? <span className="structured-source">Live read</span> : null}
          </div>
          <h3>{visual.title || "Incidencia"}</h3>
          <p>{visual.summary || summary}</p>
          <p>
            <strong>ID:</strong> {visual.item.id || "—"} · <strong>Estado:</strong>{" "}
            {visual.item.status || "—"} · <strong>Prioridad:</strong>{" "}
            {visual.item.priority || "—"}
          </p>
          <p>
            <strong>Sistema afectado:</strong> {visual.item.affected_system || "—"}
          </p>
          <p>
            <strong>Creada:</strong> {visual.item.created || "—"} · <strong>Modificada:</strong>{" "}
            {visual.item.modified || "—"}
          </p>
          <p>
            <strong>Creador:</strong>{" "}
            {visual.item.creator_name || visual.item.created_by_name || visual.item.requester || "No informado"}
          </p>
          <p>
            <strong>Email creador:</strong>{" "}
            {visual.item.creator_email || visual.item.created_by_email || "No informado"}
          </p>
          <div className="powerbi-result-actions">
            <button type="button" className="action-button secondary-action" onClick={onPrevious}>
              Anterior
            </button>
            <button type="button" className="action-button secondary-action" onClick={onNext}>
              Siguiente
            </button>
            <button
              type="button"
              className="action-button secondary-action"
              onClick={() => onPrepareCreatorEmail?.(visual.item)}
              disabled={!visual.item.creator_email}
            >
              Email al creador
            </button>
          </div>
        </article>
      ) : null}

      {kind === "incidents_user" && !visual.item && Array.isArray(visual.items) && visual.items.length ? (
        <div className="structured-cards">
          {visual.items.slice(0, 5).map((item) => (
            <article key={`${item.id}-${item.title}`} className="structured-card">
              <div className="structured-status-row">
                <span className="structured-source">{sourceLabel}</span>
                <span className="structured-source">{visual.ordering || "created desc / id desc"}</span>
                {isLive ? <span className="structured-source">Live read</span> : null}
              </div>
              <h3>{item.title || `Incidencia ${item.id || ""}`}</h3>
              <p>{item.status || "Sin estado"} · {item.priority || "Sin prioridad"}</p>
              <p>
                <strong>ID:</strong> {item.id || "—"} · <strong>Sistema:</strong>{" "}
                {item.affected_system || "—"}
              </p>
              <p>
                <strong>Creada:</strong> {item.created || "—"} · <strong>Modificada:</strong>{" "}
                {item.modified || "—"}
              </p>
              <p>
                <strong>Creador:</strong>{" "}
                {item.creator_name || item.created_by_name || item.requester || "No informado"}
              </p>
              <p>
                <strong>Email creador:</strong>{" "}
                {item.creator_email || item.created_by_email || "No informado"}
              </p>
              <div className="powerbi-result-actions">
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onSelectIncident?.(item)}
                >
                  Seleccionar
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onPrepareCreatorEmail?.(item)}
                  disabled={!item.creator_email}
                >
                  Email al creador
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {kind === "zabbix_monitoring" && Array.isArray(visual.items) ? (
        <div className="structured-cards">
          {visual.items.slice(0, 4).map((item) => (
            <article
              key={`${item.title}-${item.priority}-${item.detail}`}
              className="structured-card"
            >
              <span className="structured-source">{sourceLabel}</span>
              <h3>{item.title || "Problema"}</h3>
              <p>{item.detail || "Sin detalle."}</p>
              <strong>{item.priority || "unknown"}</strong>
            </article>
          ))}
        </div>
      ) : null}

      {kind === "correlation_requested" ? (
        <div className="structured-columns">
          <article className="structured-card">
            <span className="structured-source">{sourceLabel}</span>
            <h3>{visual.title || "Correlación"}</h3>
            <p>{visual.claim || summary}</p>
            <p>
              <strong>Confianza:</strong>{" "}
              {typeof visual.correlationConfidence === "number"
                ? `${Math.round(visual.correlationConfidence * 100)}%`
                : "—"}
            </p>
            <p>
              <strong>Causalidad permitida:</strong>{" "}
              {visual.causalClaimAllowed ? "Sí" : "No"}
            </p>
          </article>
          <article className="structured-card">
            <span className="structured-source">Evidencia</span>
            {(Array.isArray(visual.evidence) && visual.evidence.length ? visual.evidence : ["Sin evidencia suficiente."]).slice(0, 5).map((item) => (
              <p key={item}>{item}</p>
            ))}
          </article>
        </div>
      ) : null}

      {Array.isArray(visual.matchedAssets) && visual.matchedAssets.length ? (
        <div className="structured-list">
          <h3>Coincidencias detectadas</h3>
          {visual.matchedAssets.slice(0, 5).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function OperationalChatResultView({ entry }) {
  if (!entry) {
    return null;
  }

  const visual = entry.visualResult || null;
  const summary = visual?.summary || entry.content || entry.message || "";
  const sourceLabel = visual?.sourceLabel || entry.source || "IncidenciasTI / Zabbix";
  const timestamp = entry.createdAt || entry.at || visual?.generatedAt || null;
  const kind = String(entry.type || visual?.kind || "").trim();
  const isOperational = kind === "operational_result" || kind === "firewall_status";
  const firewallHosts = Array.isArray(visual?.hosts) ? visual.hosts : [];
  const firewallGaps = Array.isArray(visual?.gaps) ? visual.gaps : [];
  const firewallProblems = Array.isArray(visual?.activeProblems) ? visual.activeProblems : [];
  if (!visual && process.env.NODE_ENV !== "production") {
    console.debug("[ops-render-debug]", {
      type: kind,
      keys: Object.keys(entry || {})
    });
  }

  return (
    <article className={`operational-chat-result ${isOperational ? "is-operational" : ""}`}>
      <div className="operational-chat-result-head">
        <span className="status-badge green">RESULTADO OPERATIVO</span>
        <span className="structured-source">{sourceLabel}</span>
        {timestamp ? <span className="structured-source">{formatDate(timestamp)}</span> : null}
      </div>
      <strong>{entry.title || visual?.title || "Consulta operativa"}</strong>
      <p className="structured-summary">{summary}</p>
      {kind === "firewall_status" ? (
        <div className="operational-chat-firewall">
          <p>
            <strong>Tenemos {visual?.firewall_count || firewallHosts.length || 0} firewalls monitorizados.</strong>
          </p>
          {firewallHosts.length ? (
            <ul className="operational-list">
              {firewallHosts.slice(0, 5).map((host) => (
                <li key={host}>{host}</li>
              ))}
            </ul>
          ) : null}
          <div className="operational-chat-inline">
            <span>
              Problemas activos: {visual?.activeProblems?.length || firewallProblems.length || 0}
            </span>
            <span>
              Huecos de monitorización: {firewallGaps.length}
            </span>
          </div>
          {(firewallProblems.length || firewallGaps.length) ? (
            <details className="operational-details">
              <summary>Ver detalle</summary>
              {firewallProblems.length ? (
                <div>
                  <strong>Problemas activos</strong>
                  <ul className="operational-list">
                    {firewallProblems.slice(0, 4).map((problem, index) => (
                      <li key={`${problem.title || "problem"}-${index}`}>{problem.title || problem.detail || "Problema de firewall"}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {firewallGaps.length ? (
                <div>
                  <strong>Huecos de monitorización</strong>
                  <ul className="operational-list">
                    {firewallGaps.slice(0, 5).map((gap, index) => (
                      <li key={`${gap.host || "gap"}-${gap.missing_check || index}`}>
                        {gap.host || "firewall"}: {gap.missing_check || gap.description || "sin detalle"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function PowerBiExpandedResultOverlay({ result, onClose }) {
  if (!result || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="powerbi-result-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Resultado ampliado Power BI"
      onClick={onClose}
    >
      <section className="powerbi-result-modal" onClick={(event) => event.stopPropagation()}>
        <div className="powerbi-result-modal-header">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Resultado ampliado</p>
              <h3>Resultado Power BI</h3>
              <p className="chatkit-fallback-note">
                {result.sourceLabel || "Power BI / administracion_ventas"}
              </p>
            </div>
          </div>
          <button type="button" className="action-button secondary-action" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="powerbi-result-modal-body">
          <PowerBiChatResultView result={result} expanded />
        </div>
      </section>
    </div>,
    document.body
  );
}

function CommunicationDraftViewerModal({
  draft,
  draftId,
  loading = false,
  error = "",
  onClose,
  onMarkReadyForReview,
  onMarkReviewed,
  onOpenInEditor
}) {
  const [showHtml, setShowHtml] = useState(false);

  useEffect(() => {
    if (!draft || typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [draft, onClose]);

  useEffect(() => {
    setShowHtml(false);
  }, [draft?.id]);

  if (typeof document === "undefined" || (!loading && !draft && !error)) {
    return null;
  }

  const bodyMarkdown = draft?.body_markdown || "";
  const bodyText = draft?.body_text || "";
  const bodyHtml = draft?.body_html || "";
  const draftLabel = draft?.id || draftId || "—";

  const copyText = async (text) => {
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    } catch {
      // no-op
    }
  };

  return createPortal(
    <div
      className="communication-draft-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle del borrador de comunicación"
      onClick={onClose}
    >
      <section
        className="communication-draft-viewer-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="communication-draft-viewer-header">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Borrador abierto</p>
              <h3>Borrador #{draftLabel}</h3>
              <p className="chatkit-fallback-note">No se ha enviado nada.</p>
            </div>
          </div>
          <button type="button" className="action-button secondary-action" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="communication-draft-viewer-body">
          {loading ? (
            <div className="structured-warning">Cargando borrador...</div>
          ) : error ? (
            <div className="structured-warning">{error}</div>
          ) : draft ? (
            <>
              <div className="communications-diagnostics">
                <span>Estado: {communicationDraftStatusLabel(draft.status)}</span>
                <span>Tipo: {communicationDraftTypeLabel(draft.type)}</span>
                <span>Plantilla: {communicationTemplateLabel(draft.template_id)}</span>
                <span>Destinatario: {draft.recipient_email || "No informado"}</span>
                <span>Asunto: {draft.subject || "No informado"}</span>
                <span>Fuente incidencia ID: {draft.source_incident_id || "No informado"}</span>
                <span>Creado: {formatDate(draft.created_at)}</span>
                <span>Actualizado: {formatDate(draft.updated_at)}</span>
              </div>

              <div className="powerbi-result-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                <button type="button" className="action-button secondary-action" onClick={() => copyText(draft.subject || "")}>
                  Copiar asunto
                </button>
                <button type="button" className="action-button secondary-action" onClick={() => copyText(bodyMarkdown || bodyText || bodyHtml)}>
                  Copiar cuerpo
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() =>
                    copyText(
                      [
                        `Borrador #${draftLabel}`,
                        `Estado: ${communicationDraftStatusLabel(draft.status)}`,
                        `Tipo: ${communicationDraftTypeLabel(draft.type)}`,
                        `Plantilla: ${communicationTemplateLabel(draft.template_id)}`,
                        `Destinatario: ${draft.recipient_email || "No informado"}`,
                        `Asunto: ${draft.subject || "No informado"}`,
                        `Fuente incidencia ID: ${draft.source_incident_id || "No informado"}`,
                        "",
                        "Cuerpo Markdown:",
                        bodyMarkdown || "No informado",
                        "",
                        "Cuerpo texto:",
                        bodyText || "No informado",
                        bodyHtml ? ["", "Cuerpo HTML:", bodyHtml].join("\n") : ""
                      ].join("\n")
                    )
                  }
                >
                  Copiar todo
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onMarkReadyForReview?.(draft)}
                  disabled={communicationDraftIsSent(draft)}
                >
                  Marcar listo para revisión
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onMarkReviewed?.(draft)}
                  disabled={communicationDraftIsSent(draft)}
                >
                  Marcar revisado
                </button>
                {bodyHtml ? (
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() => setShowHtml((current) => !current)}
                  >
                    {showHtml ? "Ocultar HTML" : "Ver HTML"}
                  </button>
                ) : null}
                {bodyHtml ? (
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      copyText(bodyHtml).catch(() => {
                        setShowHtml(false);
                      })
                    }
                  >
                    Copiar HTML
                  </button>
                ) : null}
                {onOpenInEditor ? (
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() => onOpenInEditor(draft)}
                  >
                    Abrir en editor
                  </button>
                ) : null}
              </div>

              <div className="report-detail">
                <div className="report-detail-header">
                  <div>
                    <h3>Cuerpo Markdown</h3>
                  </div>
                  <span>{bodyMarkdown ? "Disponible" : "No informado"}</span>
                </div>
                <pre>{bodyMarkdown || "No informado."}</pre>
              </div>

              <div className="report-detail">
                <div className="report-detail-header">
                  <div>
                    <h3>Cuerpo texto</h3>
                  </div>
                  <span>{bodyText ? "Disponible" : "No informado"}</span>
                </div>
                <pre>{bodyText || "No informado."}</pre>
              </div>

              {showHtml && bodyHtml ? (
                <div className="report-detail">
                  <div className="report-detail-header">
                    <div>
                      <h3>Cuerpo HTML</h3>
                    </div>
                    <span>Disponible</span>
                  </div>
                  <pre>{bodyHtml}</pre>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}

function CommunicationDraftEmbeddedViewerModal({
  open,
  url,
  draftId,
  loading = false,
  error = "",
  onClose,
  onFrameLoad,
  onFrameError
}) {
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (!open || !url) {
      setFrameReady(false);
    }
  }, [open, url]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !url || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="communication-draft-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Visor de borrador de comunicación"
      onClick={onClose}
    >
      <section
        className="communication-draft-viewer-modal communication-draft-embedded-viewer-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="communication-draft-viewer-header">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Visor dedicado</p>
              <h3>Borrador #{draftId || "—"}</h3>
              <p className="chatkit-fallback-note">No se ha enviado nada.</p>
            </div>
          </div>
          <div className="report-list-actions">
            <a
              href={url}
              className="action-button secondary-action export-link"
              target="_blank"
              rel="noreferrer"
            >
              Abrir en pestaña nueva
            </a>
            <button type="button" className="action-button secondary-action" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="communication-draft-viewer-body communication-draft-embedded-viewer-body">
          {loading && !frameReady ? <div className="structured-warning">Cargando visor...</div> : null}
          {error ? <div className="structured-warning">{error}</div> : null}
          <div className="communication-draft-embedded-viewer-frame-shell">
            <iframe
              title={`Borrador ${draftId || "sin id"}`}
              src={url}
              className="communication-draft-embedded-viewer-frame"
              onLoad={() => {
                setFrameReady(true);
                onFrameLoad?.();
              }}
              onError={() => {
                const message = "No se pudo cargar el visor del borrador.";
                onFrameError?.(message);
              }}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function CommunicationDraftInlineViewerPanel({
  open,
  url,
  draftId,
  draft,
  loading = false,
  error = "",
  diagnostics = null,
  onClose
}) {
  if (!open && !url && !draft && !loading && !error) {
    return null;
  }

  const bodyMarkdown = draft?.body_markdown || draft?.bodyMarkdown || "";
  const bodyText = draft?.body_text || draft?.bodyText || "";
  const bodyHtml = draft?.body_html || draft?.bodyHtml || "";
  const draftLabel = draft?.id || draftId || "—";

  return (
    <section className="communications-inline-viewer">
      <div className="report-detail-header">
        <div>
          <p className="eyebrow">Visor dedicado</p>
          <h3>Revisión de borrador #{draftLabel}</h3>
          <p className="chatkit-fallback-note">No se ha enviado nada.</p>
        </div>
        <div className="report-list-actions">
          {url ? (
            <a
              href={url}
              className="action-button secondary-action export-link"
              target="_blank"
              rel="noreferrer"
            >
              Abrir en pestaña nueva
            </a>
          ) : null}
          <button type="button" className="action-button secondary-action" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <div className="communications-diagnostics">
        <span>Último draft creado por agente: {diagnostics?.lastCreatedDraftId ? `ID ${diagnostics.lastCreatedDraftId}` : "—"}</span>
        <span>Último draft abierto en visor: {diagnostics?.lastOpenedDraftId ? `ID ${diagnostics.lastOpenedDraftId}` : "—"}</span>
        <span>GET by ID: {diagnostics?.getByIdStatus || "—"}</span>
        <span>Total antes de crear: {diagnostics?.totalBeforeCreate ?? 0}</span>
        <span>Total después de crear: {diagnostics?.totalAfterCreate ?? 0}</span>
        <span>Última carga de borradores: {diagnostics?.lastDraftLoadAt ? formatDate(diagnostics.lastDraftLoadAt) : "—"}</span>
      </div>

      <div className="communications-note">
        El visor embebido carga el mismo borrador que la URL dedicada. Si el iframe no responde,
        el resumen del borrador sigue visible debajo.
      </div>

      {loading ? <div className="structured-warning">Cargando borrador...</div> : null}
      {error ? <div className="structured-warning">{error}</div> : null}

      {url ? (
        <div className="communication-draft-inline-frame-shell">
          <iframe
            title={`Borrador ${draftLabel}`}
            src={url}
            className="communication-draft-inline-frame"
          />
        </div>
      ) : null}

      {draft ? (
        <article className="communication-draft-inline-summary">
          <div className="communication-detail-grid">
            <div>
              <span>Estado</span>
              <p>{communicationDraftStatusLabel(draft.status)}</p>
            </div>
            <div>
              <span>Tipo</span>
              <p>{communicationDraftTypeLabel(draft.type)}</p>
            </div>
            <div>
              <span>Plantilla</span>
              <p>{communicationTemplateLabel(draft.template_id)}</p>
            </div>
            <div>
              <span>Destinatario</span>
              <p>{draft.recipient_email || "No informado"}</p>
            </div>
            <div>
              <span>Asunto</span>
              <p>{draft.subject || "No informado"}</p>
            </div>
            <div>
              <span>Fuente incidencia ID</span>
              <p>{draft.source_incident_id || "No informado"}</p>
            </div>
            <div>
              <span>Fecha creación</span>
              <p>{formatDate(draft.created_at)}</p>
            </div>
            <div>
              <span>Fecha actualización</span>
              <p>{formatDate(draft.updated_at)}</p>
            </div>
          </div>

          <div className="report-detail">
            <div className="report-detail-header">
              <div>
                <h3>Cuerpo Markdown</h3>
              </div>
              <span>{bodyMarkdown ? "Disponible" : "No informado"}</span>
            </div>
            <pre>{bodyMarkdown || "No informado."}</pre>
          </div>

          <div className="report-detail">
            <div className="report-detail-header">
              <div>
                <h3>Cuerpo texto</h3>
              </div>
              <span>{bodyText ? "Disponible" : "No informado"}</span>
            </div>
            <pre>{bodyText || "No informado."}</pre>
          </div>

          {bodyHtml ? (
            <div className="report-detail">
              <div className="report-detail-header">
                <div>
                  <h3>Cuerpo HTML</h3>
                </div>
                <span>Disponible</span>
              </div>
              <pre>{bodyHtml}</pre>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function CommunicationDraftReviewPanel({
  draftId = "",
  draft = null,
  loading = false,
  error = "",
  templates = [],
  allowedDomains = [],
  lastCreatedDraftId = "",
  onClose,
  onCopy,
  onDownload,
  onMarkReadyForReview,
  onMarkReviewed
}) {
  if (!draftId && !draft && !loading && !error) {
    return null;
  }

  const normalizedDraft = draft ? normalizeCommunicationDraftRecord(draft) : null;
  const visibleDraftId = communicationDraftId(normalizedDraft) || draftId;
  const bodyMarkdown = normalizedDraft?.body_markdown || "";
  const bodyText = normalizedDraft?.body_text || "";
  const bodyHtml = normalizedDraft?.body_html || "";
  const viewerHref = visibleDraftId ? communicationDraftViewerPath(visibleDraftId) : "";

  return (
    <section className="communication-draft-review-panel" aria-label="Revisión de borrador">
      <div className="report-detail-header">
        <div>
          <p className="eyebrow">Revisión de borrador</p>
          <h3>{visibleDraftId ? `Borrador #${visibleDraftId}` : "Cargando borrador"}</h3>
          <p className="chatkit-fallback-note">No se ha enviado nada.</p>
        </div>
        <div className="report-list-actions">
          {viewerHref ? (
            <a
              href={viewerHref}
              className="action-button secondary-action export-link"
              target="_blank"
              rel="noreferrer"
            >
              Abrir en pestaña nueva
            </a>
          ) : null}
          <button type="button" className="action-button secondary-action" onClick={onClose}>
            Cerrar panel
          </button>
        </div>
      </div>

      {lastCreatedDraftId ? (
        <div className="communications-note">
          Último borrador creado por el agente: ID {lastCreatedDraftId}.
        </div>
      ) : null}

      {loading ? <div className="structured-warning">Cargando borrador...</div> : null}
      {error ? <div className="structured-warning">{error}</div> : null}

      {normalizedDraft ? (
        <>
          <div className="communication-detail-grid">
            <div>
              <span>Estado</span>
              <p>{communicationDraftStatusLabel(normalizedDraft.status)}</p>
            </div>
            <div>
              <span>Tipo</span>
              <p>{communicationDraftTypeLabel(normalizedDraft.type)}</p>
            </div>
            <div>
              <span>Plantilla</span>
              <p>{communicationTemplateLabel(normalizedDraft.template_id, templates)}</p>
            </div>
            <div>
              <span>Destinatario</span>
              <p>{normalizedDraft.recipient_email || "No informado"}</p>
            </div>
            <div>
              <span>Asunto</span>
              <p>{normalizedDraft.subject || "No informado"}</p>
            </div>
            <div>
              <span>Fuente incidencia ID</span>
              <p>{normalizedDraft.source_incident_id || "No informado"}</p>
            </div>
            <div>
              <span>Fuente informe ID</span>
              <p>{normalizedDraft.source_report_id || "No informado"}</p>
            </div>
            <div>
              <span>Fecha creación</span>
              <p>{formatDate(normalizedDraft.created_at)}</p>
            </div>
            <div>
              <span>Fecha actualización</span>
              <p>{formatDate(normalizedDraft.updated_at)}</p>
            </div>
          </div>

          <div className="report-list-actions">
            <button type="button" className="action-button secondary-action" onClick={() => onCopy?.(normalizedDraft, "subject")}>
              Copiar asunto
            </button>
            <button type="button" className="action-button secondary-action" onClick={() => onCopy?.(normalizedDraft, "body")}>
              Copiar cuerpo
            </button>
            <button type="button" className="action-button secondary-action" onClick={() => onCopy?.(normalizedDraft, "all")}>
              Copiar todo
            </button>
            <button type="button" className="action-button secondary-action" onClick={() => onDownload?.(normalizedDraft, "markdown")}>
              Descargar Markdown
            </button>
            {bodyHtml ? (
              <button type="button" className="action-button secondary-action" onClick={() => onDownload?.(normalizedDraft, "html")}>
                Descargar HTML
              </button>
            ) : null}
            <button
              type="button"
              className="action-button secondary-action"
              onClick={() => onMarkReadyForReview?.(normalizedDraft)}
              disabled={communicationDraftIsSent(normalizedDraft)}
            >
              Marcar listo para revisión
            </button>
            <button
              type="button"
              className="action-button secondary-action"
              onClick={() => onMarkReviewed?.(normalizedDraft)}
              disabled={communicationDraftIsSent(normalizedDraft)}
            >
              Marcar revisado
            </button>
          </div>

          <div className="report-detail">
            <div className="report-detail-header">
              <div>
                <h3>Cuerpo Markdown</h3>
              </div>
              <span>{bodyMarkdown ? "Disponible" : "No informado"}</span>
            </div>
            <pre>{bodyMarkdown || "No informado."}</pre>
          </div>

          <div className="report-detail">
            <div className="report-detail-header">
              <div>
                <h3>Cuerpo texto</h3>
              </div>
              <span>{bodyText ? "Disponible" : "No informado"}</span>
            </div>
            <pre>{bodyText || "No informado."}</pre>
          </div>
        </>
      ) : null}
    </section>
  );
}

function CommunicationDraftReviewEditor({
  draftId = "",
  templates = [],
  allowedDomains = [],
  sendPreparation = null,
  isSaving = false,
  isSendingEmail = false,
  message = "",
  onClose,
  onDraftLoaded,
  onDraftUpdated,
  onCopy,
  onDownload,
  onDuplicate,
  onDiscard,
  onPrepareSend,
  onConfirmSend,
  onDirectSend
}) {
  const [draft, setDraft] = useState(null);
  const [form, setForm] = useState(() => communicationDraftToEditableForm(null));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [directSendArmed, setDirectSendArmed] = useState(false);
  const normalizedDraftId = String(draftId || "").trim();

  function communicationDraftToEditableForm(value) {
    const normalized = normalizeCommunicationDraftRecord(value || {});
    return {
      recipient_email: normalized.recipient_email || "",
      recipient_label: normalized.recipient_label || "",
      subject: normalized.subject || "",
      body_markdown: normalized.body_markdown || "",
      body_text: normalized.body_text || "",
      body_html: normalized.body_html || "",
      review_notes: normalized.review_notes || ""
    };
  }

  async function loadReviewDraft(id = normalizedDraftId) {
    const nextId = String(id || "").trim();
    if (!nextId) {
      setDraft(null);
      setForm(communicationDraftToEditableForm(null));
      return null;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(communicationDraftUrl(nextId));
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "No se pudo cargar el borrador.");
      }
      const normalized = normalizeCommunicationDraftRecord(data.draft || {});
      setDraft(normalized);
      setForm(communicationDraftToEditableForm(normalized));
      setLocalMessage(`Borrador #${normalized.id} cargado. No se ha enviado nada.`);
      onDraftLoaded?.(normalized);
      return normalized;
    } catch (loadError) {
      const nextError = loadError?.message || "No se pudo cargar el borrador.";
      setDraft(null);
      setError(nextError);
      setLocalMessage("");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReviewDraft(normalizedDraftId);
    setDirectSendArmed(false);
  }, [normalizedDraftId]);

  async function patchReviewDraft(patch, successMessage = "Cambios guardados.") {
    if (!draft?.id) {
      setError("No hay borrador cargado.");
      return null;
    }
    if (communicationDraftIsSent(draft)) {
      setError("Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.");
      return null;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch(communicationDraftUrl(draft.id), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "No se pudo actualizar el borrador.");
      }
      const normalized = normalizeCommunicationDraftRecord(data.draft || {});
      setDraft(normalized);
      setForm(communicationDraftToEditableForm(normalized));
      setLocalMessage(successMessage);
      onDraftUpdated?.(normalized);
      return normalized;
    } catch (patchError) {
      const nextError = patchError?.message || "No se pudo actualizar el borrador.";
      setError(nextError);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (communicationDraftIsSent(draft)) {
      setError("Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.");
      return;
    }
    await patchReviewDraft(
      {
        recipient_email: normalizeCommunicationEmail(form.recipient_email),
        recipient_label: form.recipient_label,
        subject: form.subject,
        body_markdown: form.body_markdown,
        body_text: form.body_text,
        body_html: form.body_html,
        review_notes: form.review_notes
      },
      "Cambios guardados. No se ha enviado nada."
    );
    await loadReviewDraft();
  }

  async function handleStatus(status) {
    if (communicationDraftIsSent(draft)) {
      setError("Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.");
      return;
    }
    const updated = await patchReviewDraft(
      {
        status,
        reviewed_by: status === "reviewed" ? "infra-agent-web" : undefined
      },
      status === "reviewed"
        ? "Borrador marcado como revisado. No se ha enviado nada."
        : "Borrador marcado como listo para revisión. No se ha enviado nada."
    );
    if (updated) {
      await loadReviewDraft();
    }
  }

  async function handlePrepareSend() {
    if (communicationDraftIsSent(draft)) {
      setError("Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.");
      return;
    }
    const readiness = getCommunicationSendReadiness(draft, { allowedDomains });
    if (!readiness.canPrepare) {
      setError(readiness.blockers[0] || "El borrador no está listo para preparar envío.");
      return;
    }
    const result = await onPrepareSend?.(draft);
    if (result?.draft) {
      const normalized = normalizeCommunicationDraftRecord(result.draft);
      setDraft(normalized);
      setForm(communicationDraftToEditableForm(normalized));
      onDraftUpdated?.(normalized);
    } else {
      await loadReviewDraft();
    }
  }

  async function handleConfirmSend() {
    if (communicationDraftIsSent(draft)) {
      setError("Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.");
      return;
    }
    const readiness = getCommunicationSendReadiness(draft, {
      preparation: selectedSendPreparation,
      allowedDomains
    });
    if (!readiness.canConfirm) {
      setError(readiness.confirmBlockers[0] || "Primero prepara el envío antes de confirmar.");
      return;
    }
    const result = await onConfirmSend?.(draft);
    if (result?.draft) {
      const normalized = normalizeCommunicationDraftRecord(result.draft);
      setDraft(normalized);
      setForm(communicationDraftToEditableForm(normalized));
      onDraftUpdated?.(normalized);
    } else {
      await loadReviewDraft();
    }
  }

  async function handleDirectSend() {
    if (!draft?.id) {
      setError("No hay borrador cargado.");
      return;
    }
    if (communicationDraftIsSent(draft)) {
      setError("Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.");
      return;
    }
    const readiness = getCommunicationSendReadiness(draft, { allowedDomains });
    if (!readiness.canDirectSend) {
      setError(readiness.directSendBlockers[0] || "El borrador no está listo para envío directo.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await onDirectSend?.(draft);
      if (result?.draft) {
        const normalized = normalizeCommunicationDraftRecord(result.draft);
        setDraft(normalized);
        setForm(communicationDraftToEditableForm(normalized));
        setLocalMessage(
          `Borrador #${normalized.id} enviado directamente. No se puede reenviar este mismo borrador.`
        );
        onDraftUpdated?.(normalized);
      } else {
        await loadReviewDraft();
      }
    } catch (directSendError) {
      const nextError = directSendError?.message || "No se pudo enviar directamente el correo.";
      setError(nextError);
      setLocalMessage("");
    } finally {
      setDirectSendArmed(false);
      setSaving(false);
    }
  }

  if (!normalizedDraftId) {
    return (
      <section className="communication-draft-review-panel" aria-label="Revisión de borrador">
        <div className="report-detail-header">
          <div>
            <p className="eyebrow">Revisión de borrador</p>
            <h3>Sin borrador seleccionado</h3>
          </div>
        </div>
        <p className="communications-note">
          Abre un borrador desde la lista, por ID, por voz o por chat para revisarlo aquí.
        </p>
      </section>
    );
  }

  const selectedSendPreparation =
    sendPreparation?.draft?.id && draft?.id && String(sendPreparation.draft.id) === String(draft.id)
      ? sendPreparation
      : null;
  const sendReadiness = getCommunicationSendReadiness(draft, {
    preparation: selectedSendPreparation,
    allowedDomains
  });
  const canPrepareSend = sendReadiness.canPrepare;
  const canConfirmSend = sendReadiness.canConfirm;
  const canDirectSend = sendReadiness.canDirectSend;
  const isSent = communicationDraftIsSent(draft);
  const busy = loading || saving || isSaving || isSendingEmail;
  const recipientDomain = sendReadiness.recipientDomain;
  const bodyMarkdown = draft?.body_markdown || "";
  const bodyText = draft?.body_text || "";
  const bodyHtml = draft?.body_html || "";
  const checklistItems = Object.values(sendReadiness.checks).map((item) => {
    const isError =
      item.label === "No enviado previamente" ||
      (item.label === "Dominio permitido" && sendReadiness.checks.recipientEmail.ok);
    return {
      label: item.label,
      status: item.ok ? "ok" : isError ? "error" : "pendiente",
      detail: item.detail
    };
  });
  const recipientResolutionMessage = draft?.source_incident_id
    ? draft?.recipient_email
      ? "Destinatario resuelto desde creador de incidencia."
      : "Falta email del creador. Indica un email para poder preparar el envío."
    : draft?.recipient_email
      ? "Destinatario resuelto desde libreta corporativa o email explícito."
      : "Falta email destinatario. Indica un email para poder preparar el envío.";

  return (
    <section className="communication-draft-review-panel communication-draft-review-editor" aria-label="Revisión y edición de borrador">
      <div className="communication-review-hero">
        <div className="report-detail-header communication-review-header">
          <div className="communication-review-title">
            <p className="eyebrow">Revisión de borrador</p>
            <h3>{draft?.id ? `Borrador #${draft.id}` : `Borrador #${normalizedDraftId}`}</h3>
            <p className="chatkit-fallback-note">
              {isSent
                ? "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
                : "No se ha enviado nada. Revisa, aprueba y prepara el envío."}
            </p>
          </div>
          <div className="communication-review-badges">
            <span className={`readonly-badge ${draft?.status || "pending_review"}`}>
              Estado: {communicationDraftStatusLabel(draft?.status)}
            </span>
            <span className="readonly-badge">
              Destinatario: {draft?.recipient_email || "No informado"}
            </span>
            <span className="readonly-badge">
              Incidencia: {draft?.source_incident_id || "No informada"}
            </span>
          </div>
        </div>

          <div className="communication-review-toolbar">
            {isSent ? (
              <>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onCopy?.(draft, "subject")}
                >
                  Copiar asunto
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onCopy?.(draft, "body")}
                >
                  Copiar cuerpo
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onCopy?.(draft, "all")}
                >
                  Copiar todo
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onDuplicate?.(draft)}
                  disabled={busy}
                >
                  Duplicar borrador
                </button>
                <button type="button" className="action-button secondary-action" onClick={onClose}>
                  Cerrar revisión
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="action-button primary-action"
                  onClick={handleSave}
                  disabled={busy || isSent}
                >
                  Guardar cambios
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => handleStatus("reviewed")}
                  disabled={busy || isSent}
                >
                  Marcar revisado
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={handlePrepareSend}
                  disabled={!canPrepareSend || busy}
                >
                  Preparar envío
                </button>
                <button
                  type="button"
                  className="action-button primary-action"
                  onClick={handleConfirmSend}
                  disabled={!canConfirmSend || busy}
                >
                  Confirmar y enviar
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onCopy?.(draft, "all")}
                >
                  Copiar todo
                </button>
                <button type="button" className="action-button secondary-action" onClick={onClose}>
                  Cerrar revisión
                </button>
              </>
            )}
          </div>
      </div>

      {draft ? (
        <div className={draft.recipient_email ? "communications-note" : "structured-warning"}>
          {recipientResolutionMessage}
        </div>
      ) : null}
      {message || localMessage ? <div className="report-message">{message || localMessage}</div> : null}
      {loading ? <div className="structured-loading">Cargando borrador...</div> : null}
      {error ? <div className="structured-warning">{error}</div> : null}

      {draft ? (
        <>
          {isSent ? (
            <div className="communication-review-sent-state">
              <div className="structured-warning">
                Este email ya fue enviado. Para enviar otro correo, duplica el borrador.
              </div>
              <div className="communication-detail-grid communication-review-meta-grid">
                <div>
                  <span>Enviado el</span>
                  <p>{formatDate(draft.sent_at || draft.direct_send_sent_at)}</p>
                </div>
                <div>
                  <span>Estado</span>
                  <p>{communicationDraftSendStatusLabel(draft.send_status)}</p>
                </div>
                <div>
                  <span>Dominio destinatario</span>
                  <p>{recipientDomain || "Sin dominio"}</p>
                </div>
                <div>
                  <span>Envío directo</span>
                  <p>
                    {draft.direct_send_requested
                      ? `${communicationDraftSendStatusLabel(draft.direct_send_send_status || draft.send_status)} · ${draft.direct_send_source || "Sin fuente"}`
                      : "No"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {!isSent ? (
            <>
          <div className="communication-review-modes" aria-label="Modos de envío">
            <article className="communication-review-mode-card">
              <div className="communication-review-step-head">
                <span>✓</span>
                <div>
                  <h4>Modo 1 · Revisar borrador</h4>
                  <p>Editar, guardar, marcar revisado, preparar envío y confirmar manualmente.</p>
                </div>
              </div>
              <p className="communications-note">
                Es el flujo recomendado. Mantiene la doble confirmación antes del envío real.
              </p>
            </article>

            <article className="communication-review-mode-card warning">
              <div className="communication-review-step-head">
                <span>!</span>
                <div>
                  <h4>Modo 2 · Enviar directamente</h4>
                  <p>Envía el correo real sin revisión manual. Solo usar si estás seguro.</p>
                </div>
              </div>
              {directSendArmed ? (
                <div className="structured-warning">
                  Vas a enviar este correo real a {draft?.recipient_email || "destino no informado"} sin revisión manual.
                  <div className="report-list-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="action-button warning-action"
                      onClick={handleDirectSend}
                      disabled={busy}
                    >
                      Confirmar envío directo
                    </button>
                    <button
                      type="button"
                      className="action-button secondary-action"
                      onClick={() => setDirectSendArmed(false)}
                      disabled={busy}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="action-button warning-action"
                  onClick={() => setDirectSendArmed(true)}
                  disabled={busy || isSent || !canDirectSend}
                  title={
                    canDirectSend
                      ? "Envía el correo real sin revisión manual. Solo usar si estás seguro."
                      : sendReadiness.directSendBlockers[0] || "Faltan datos para envío directo."
                  }
                >
                  Enviar directamente
                </button>
              )}
              {!canDirectSend ? (
                <p className="communications-note">
                  Envío directo bloqueado: {sendReadiness.directSendBlockers[0] || "faltan datos obligatorios"}.
                </p>
              ) : null}
            </article>
          </div>

          <div className="communication-review-steps">
            <article className="communication-review-step">
              <div className="communication-review-step-head">
                <span>1</span>
                <div>
                  <h4>Revisar contenido</h4>
                  <p>Comprueba destinatario, asunto y cuerpo. Guarda antes de pasar al siguiente paso.</p>
                </div>
              </div>
              <div className="communication-detail-grid communication-review-meta-grid">
                <div>
                  <span>Tipo</span>
                  <p>{communicationDraftTypeLabel(draft.type)}</p>
                </div>
                <div>
                  <span>Plantilla</span>
                  <p>{communicationTemplateLabel(draft.template_id, templates)}</p>
                </div>
                <div>
                  <span>Fuente informe ID</span>
                  <p>{draft.source_report_id || "No informado"}</p>
                </div>
                <div>
                  <span>Fuente incidencia ID</span>
                  <p>{draft.source_incident_id || "No informado"}</p>
                </div>
                <div>
                  <span>Creado</span>
                  <p>{formatDate(draft.created_at)}</p>
                </div>
                <div>
                  <span>Actualizado</span>
                  <p>{formatDate(draft.updated_at)}</p>
                </div>
                <div>
                  <span>Envío</span>
                  <p>{communicationDraftSendStatusLabel(draft.send_status)}</p>
                </div>
                <div>
                  <span>Remitente temporal</span>
                  <p>{selectedSendPreparation?.from_user || "Pendiente de preparar"}</p>
                </div>
              </div>

              {isSent ? (
                <div className="structured-warning">
                  Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.
                </div>
              ) : null}

              <form className="communications-editor review-editor-form communication-review-form" onSubmit={handleSave}>
                <div className="communication-field-row">
                  <label className="report-field">
                    <span>Nombre destinatario</span>
                    <input
                      type="text"
                      value={form.recipient_label}
                      readOnly={isSent}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, recipient_label: event.target.value }))
                      }
                    />
                  </label>
                  <label className="report-field">
                    <span>Email destinatario</span>
                    <input
                      type="email"
                      value={form.recipient_email}
                      readOnly={isSent}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, recipient_email: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="report-field">
                  <span>Asunto</span>
                  <input
                    type="text"
                    value={form.subject}
                    readOnly={isSent}
                    onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
                  />
                </label>

                <label className="report-field">
                  <span>Cuerpo Markdown</span>
                  <textarea
                    rows={12}
                    value={form.body_markdown}
                    readOnly={isSent}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, body_markdown: event.target.value }))
                    }
                  />
                </label>

                <details className="communication-review-details">
                  <summary>Más campos</summary>
                  <div className="communication-review-details-body">
                    <label className="report-field">
                      <span>Cuerpo texto</span>
                      <textarea
                        rows={8}
                        value={form.body_text}
                        readOnly={isSent}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, body_text: event.target.value }))
                        }
                      />
                    </label>

                    <label className="report-field">
                      <span>Notas de revisión</span>
                      <textarea
                        rows={4}
                        value={form.review_notes}
                        readOnly={isSent}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, review_notes: event.target.value }))
                        }
                      />
                    </label>

                    {bodyHtml ? (
                      <label className="report-field">
                        <span>Cuerpo HTML</span>
                        <textarea
                          rows={8}
                          value={form.body_html}
                          readOnly={isSent}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, body_html: event.target.value }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                </details>

                <div className="report-save-row">
                  <button type="submit" className="action-button primary-action" disabled={busy || isSent}>
                    Guardar cambios
                  </button>
                  <span className="report-message" aria-live="polite">
                    Guardar solo actualiza el borrador local. No envía nada.
                  </span>
                </div>
              </form>
            </article>

            <article className="communication-review-step">
              <div className="communication-review-step-head">
                <span>2</span>
                <div>
                  <h4>Aprobar borrador</h4>
                  <p>Marca listo para revisión y luego revisado para desbloquear el envío.</p>
                </div>
              </div>

              <div className="report-list-actions communication-review-inline-actions">
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => handleStatus("ready_for_review")}
                  disabled={busy || isSent}
                >
                  Marcar listo para revisión
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => handleStatus("reviewed")}
                  disabled={busy || isSent}
                >
                  Marcar revisado
                </button>
              </div>

              <div className="communication-review-progress-note">
                {!sendReadiness.checks.recipientEmail.ok
                  ? "Puedes revisar el contenido, pero no podrás preparar el envío hasta indicar email."
                  : isSent
                    ? "Ya enviado. Solo lectura."
                    : draft.status !== "reviewed"
                      ? "Debes marcar el borrador como revisado antes de poder preparar el envío."
                      : canPrepareSend
                        ? "Borrador revisado. Puedes preparar el envío."
                        : `Borrador revisado, pero bloqueado: ${sendReadiness.blockers[0] || "faltan datos"}.`}
              </div>
            </article>

            <article className={`communication-review-step ${draft.status !== "reviewed" ? "locked" : ""}`}>
              <div className="communication-review-step-head">
                <span>3</span>
                <div>
                  <h4>Envío real</h4>
                  <p>Primero prepara el envío. Después confirma manualmente para enviar el correo real.</p>
                </div>
              </div>

              <div className="communication-review-checklist">
                {checklistItems.map((item) => (
                  <div key={item.label} className={`communication-review-check-item ${item.status}`}>
                    <span>{item.label}</span>
                    <strong>{item.status === "ok" ? "OK" : item.status === "error" ? "Error" : "Pendiente"}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>

              {draft.status !== "reviewed" ? (
                <div className="structured-warning">
                  Para enviar, primero marca el borrador como revisado.
                </div>
              ) : null}
              {!canPrepareSend ? (
                <div className="structured-warning">
                  Preparar envío bloqueado: {sendReadiness.blockers[0] || "faltan datos obligatorios"}.
                </div>
              ) : null}
              {!canConfirmSend ? (
                <p className="communications-note">
                  Confirmar y enviar se activará solo después de preparar el envío y tener token de confirmación.
                  {sendReadiness.confirmBlockers.length
                    ? ` Falta: ${sendReadiness.confirmBlockers[0]}.`
                    : ""}
                </p>
              ) : null}
              {draft.send_error ? (
                <div className="structured-warning">Último error: {draft.send_error}</div>
              ) : null}

              <div className="communication-detail-grid communication-review-meta-grid">
                <div>
                  <span>Dominio destinatario</span>
                  <p>{selectedSendPreparation?.recipient_domain || recipientDomain || "Sin dominio"}</p>
                </div>
                <div>
                  <span>Dominios permitidos</span>
                  <p>
                    {selectedSendPreparation?.allowed_domains?.length
                      ? selectedSendPreparation.allowed_domains.join(", ")
                      : sendReadiness.allowedDomains.length
                        ? sendReadiness.allowedDomains.join(", ")
                        : "No configurado"}
                  </p>
                </div>
                <div>
                  <span>Preparado</span>
                  <p>
                    {selectedSendPreparation?.prepared_at
                      ? formatDate(selectedSendPreparation.prepared_at)
                      : draft.send_prepared_at
                        ? formatDate(draft.send_prepared_at)
                        : "Sin preparación"}
                  </p>
                </div>
                <div>
                  <span>Envío</span>
                  <p>{draft.sent_at ? formatDate(draft.sent_at) : "Sin envío"}</p>
                </div>
                <div>
                  <span>Intento</span>
                  <p>{draft.send_attempt_at ? formatDate(draft.send_attempt_at) : "Sin intento"}</p>
                </div>
                <div>
                  <span>Último estado</span>
                  <p>{communicationDraftSendStatusLabel(draft.send_status)}</p>
                </div>
                <div>
                  <span>Envío directo</span>
                  <p>
                    {draft.direct_send_requested
                      ? `${communicationDraftSendStatusLabel(draft.direct_send_send_status || draft.send_status)} · ${draft.direct_send_source || "Sin fuente"}`
                      : "No"}
                  </p>
                </div>
              </div>

              <div className="report-list-actions communication-review-inline-actions">
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={handlePrepareSend}
                  disabled={!canPrepareSend || busy}
                  title={canPrepareSend ? "Preparar doble confirmación" : sendReadiness.blockers[0] || "No preparado"}
                >
                  Preparar envío
                </button>
                <button
                  type="button"
                  className="action-button primary-action"
                  onClick={handleConfirmSend}
                  disabled={!canConfirmSend || busy}
                  title={canConfirmSend ? "Confirmar y enviar correo real" : sendReadiness.confirmBlockers[0] || "Falta preparación"}
                >
                  Confirmar y enviar
                </button>
              </div>

              {selectedSendPreparation ? (
                <div className="structured-warning">
                  Paso 1/2 completado. Revisa el contenido y confirma manualmente el envío.
                </div>
              ) : (
                <p className="communications-note">
                  Este botón todavía no envía. Solo prepara la confirmación.
                </p>
              )}
            </article>
          </div>

          <details className="communication-review-more-actions">
            <summary>Más acciones</summary>
            <div className="report-list-actions">
              <button
                type="button"
                className="action-button secondary-action"
                onClick={() => onCopy?.(draft, "subject")}
              >
                Copiar asunto
              </button>
              <button
                type="button"
                className="action-button secondary-action"
                onClick={() => onCopy?.(draft, "body")}
              >
                Copiar cuerpo
              </button>
              <button
                type="button"
                className="action-button secondary-action"
                onClick={() => onDownload?.(draft, "markdown")}
              >
                Descargar Markdown
              </button>
              {draft.body_html ? (
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onDownload?.(draft, "html")}
                >
                  Descargar HTML
                </button>
              ) : null}
              <button type="button" className="action-button secondary-action" onClick={() => onDuplicate?.(draft)} disabled={busy}>
                Duplicar borrador
              </button>
              {!isSent ? (
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={async () => {
                    await onDiscard?.(draft);
                    await loadReviewDraft();
                  }}
                  disabled={busy || isSent}
                >
                  Descartar
                </button>
              ) : null}
              <a
                href={communicationDraftViewerPath(normalizedDraftId)}
                className="action-button secondary-action export-link"
                target="_blank"
                rel="noreferrer"
              >
                Abrir en página dedicada
              </a>
            </div>
          </details>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

class PowerBiPanelBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (typeof this.props.onError === "function") {
      this.props.onError(error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="reports-section" aria-label="Power BI">
          <div className="structured-warning">
            No se pudo cargar el panel Power BI. Revisa logs/console.
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

class CommunicationsPanelBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (typeof this.props.onError === "function") {
      this.props.onError(error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="communications-section" aria-label="Comunicaciones">
          <div className="structured-warning">
            No se pudo cargar Comunicaciones. Revisa consola/logs.
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

function DashboardCardGrid({ cards, fallbackCards, isLoading, onPrompt }) {
  const visibleCards = cards?.length ? cards : fallbackCards;

  return (
    <div className="dashboard-grid">
      {visibleCards.map((card) => {
        const isLive = Boolean(cards?.length);
        return (
          <button
            key={card.id || card.title}
            type="button"
            className={`status-card ${isLive ? `card-status-${card.status || "gray"}` : ""} ${
              isLive && !card.prompt ? "static-card" : ""
            }`}
            onClick={() => (card.prompt ? onPrompt(card.prompt) : null)}
            disabled={isLoading}
          >
            <span className="status-card-title">{card.title}</span>
            <span className="status-card-value">{card.value}</span>
            <span className="status-card-detail">{card.description || card.detail}</span>
            {isLive ? (
              <span className="status-card-source">
                {card.source_report_id ? `Informe #${card.source_report_id}` : "Sin informe"}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function DashboardSnapshot({ dashboard, onOpenReport, presentationMode = false }) {
  if (!dashboard) {
    return (
      <section className="dashboard-latest-panel">
        <p className="empty-history">
          Sin composición guardada todavía. Genera informes estructurados para alimentar el panel.
        </p>
      </section>
    );
  }

  if (presentationMode) {
    return (
      <section
        className="dashboard-latest-panel presentation-summary"
        aria-label="Acciones recomendadas"
      >
        <div className="dashboard-list-panel">
          <h3>Acciones recomendadas</h3>
          {(dashboard.top_actions || []).length ? (
            dashboard.top_actions.slice(0, 5).map((action) => (
              <p key={`${action.priority}-${action.action}`}>
                <strong>{action.priority}</strong> · {action.action}
                <span>{action.reason}</span>
              </p>
            ))
          ) : (
            <p>Sin acciones estructuradas guardadas.</p>
          )}
        </div>

        {dashboard.missing_reports?.length ? (
          <div className="structured-warning">
            Faltan informes: {dashboard.missing_reports.join(", ")}.
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="dashboard-latest-panel" aria-label="Resumen desde informes estructurados">
      <div className="dashboard-latest-grid">
        <div className="dashboard-list-panel">
          <h3>Acciones principales</h3>
          {(dashboard.top_actions || []).length ? (
            dashboard.top_actions.slice(0, 5).map((action) => (
              <p key={`${action.priority}-${action.action}`}>
                <strong>{action.priority}</strong> · {action.action}
                <span>{action.reason}</span>
              </p>
            ))
          ) : (
            <p>Sin acciones estructuradas guardadas.</p>
          )}
        </div>

        <div className="dashboard-list-panel">
          <h3>Riesgos críticos</h3>
          {(dashboard.critical_risks || []).length ? (
            dashboard.critical_risks.slice(0, 5).map((risk) => <p key={risk}>{risk}</p>)
          ) : (
            <p>Sin riesgos críticos estructurados.</p>
          )}
        </div>

        <div className="dashboard-list-panel">
          <h3>Huecos</h3>
          {(dashboard.monitoring_gaps || []).length ? (
            dashboard.monitoring_gaps.slice(0, 5).map((gap) => <p key={gap}>{gap}</p>)
          ) : (
            <p>Sin huecos estructurados.</p>
          )}
        </div>
      </div>

      {dashboard.missing_reports?.length ? (
        <div className="structured-warning">
          Faltan informes: {dashboard.missing_reports.join(", ")}.
        </div>
      ) : null}

      <div className="latest-report-links">
        {Object.entries(dashboard.latest_reports || {}).map(([type, report]) => (
          <button
            key={type}
            type="button"
            className="action-button secondary-action"
            onClick={() => report?.id && onOpenReport(report.id)}
            disabled={!report?.id}
          >
            {reportTypeLabels[type] || type}
          </button>
        ))}
      </div>
    </section>
  );
}

function MatrixPreview({ rows }) {
  if (!rows?.length) {
    return (
      <p className="empty-history">
        No hay matriz estructurada guardada todavía. Genera una matriz estructurada para alimentar esta tabla.
      </p>
    );
  }

  return (
    <div className="matrix-table-wrap">
      <table className="matrix-table">
        <thead>
          <tr>
            <th>Activo / servicio</th>
            <th>Prioridad</th>
            <th>Nivel de correlación</th>
            <th>Impacto usuario</th>
            <th>Acción recomendada</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.asset_or_service}-${row.recommended_action}`}>
              <td>{row.asset_or_service}</td>
              <td>
                <span className="priority-pill">{row.priority}</span>
              </td>
              <td>
                <span className="matrix-pill">{row.correlation_level}</span>
              </td>
              <td>{row.user_impact}</td>
              <td>{row.recommended_action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizeBucket(value, fallback = "Sin dato") {
  const text = String(value || "").trim();
  return text || fallback;
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items || []) {
    const key = normalizeBucket(getter(item));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function BarChart({ title, data, emptyText = "Sin datos suficientes." }) {
  const max = Math.max(...(data || []).map((item) => item.value), 0);

  return (
    <article className="chart-card">
      <h3>{title}</h3>
      {data?.length ? (
        <div className="bar-chart" role="list">
          {data.map((item) => (
            <div key={item.label} className="bar-row" role="listitem">
              <div className="bar-label">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="bar-track" aria-hidden="true">
                <span style={{ width: `${max ? Math.max(8, (item.value / max) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-history">{emptyText}</p>
      )}
    </article>
  );
}

function TrendChart({ title, data, valueFormatter = (value) => value, emptyText = "Sin histórico suficiente." }) {
  const numericValues = (data || [])
    .map((item) => Number(item.score ?? item.value ?? 0))
    .filter((value) => Number.isFinite(value));
  const max = Math.max(...numericValues, 0);

  return (
    <article className="chart-card">
      <h3>{title}</h3>
      {data?.length ? (
        <div className="trend-chart" role="list">
          {data.map((item) => {
            const numericValue = Number(item.score ?? item.value ?? 0);
            const height = max ? Math.max(10, (numericValue / max) * 100) : 10;
            return (
              <div key={`${title}-${item.date}`} className="trend-item" role="listitem">
                <div className="trend-bar" aria-hidden="true">
                  <span style={{ height: `${height}%` }} />
                </div>
                <strong>{valueFormatter(item.value, item)}</strong>
                <em>{item.date?.slice(5) || item.date}</em>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty-history">{emptyText}</p>
      )}
    </article>
  );
}

function DiffList({ title, items, emptyText }) {
  return (
    <div className="visual-list-panel">
      <h3>{title}</h3>
      {items?.length ? items.slice(0, 8).map((item) => <p key={item}>{item}</p>) : <p>{emptyText}</p>}
    </div>
  );
}

function NavigationTabs({ activeView, onChange }) {
  return (
    <nav className="view-tabs" aria-label="Navegación interna">
      {navigationTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeView === tab.id ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function TodayReportView({
  report,
  data,
  matrixData,
  risksData,
  gapsData,
  isLoading,
  onRunDailyReport,
  onCreateExecutiveDraft,
  onCreateTechnicalDraft,
  onCreateOperationalDraft
}) {
  if (isLoading) {
    return <div className="structured-loading">Cargando informe de hoy...</div>;
  }

  if (!report || !data || !isReportToday(report)) {
    return (
      <section className="visual-report-panel" aria-label="Informe de hoy">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Informe de hoy</p>
            <h3>No hay informe diario de hoy</h3>
          </div>
        </div>
        <p className="empty-history">
          Genera el informe diario para alimentar esta vista con resumen ejecutivo, hallazgos,
          acciones y datos faltantes.
        </p>
        <button type="button" className="action-button primary-action" onClick={onRunDailyReport}>
          Generar informe diario ahora
        </button>
      </section>
    );
  }

  const topActions = (data.top_actions || []).slice(0, 3);
  const criticalRisks = (risksData?.risks || [])
    .filter((risk) => ["critical", "high"].includes(String(risk.severity || "").toLowerCase()))
    .slice(0, 5);
  const userImpact = [
    ...(matrixData?.confirmed_impact || []),
    ...(matrixData?.rows || [])
      .filter((row) => (row.related_incidents || []).length)
      .map((row) => `${row.asset_or_service}: ${row.user_impact}`)
  ].slice(0, 5);
  const monitoringGaps = [
    ...(gapsData?.gaps || []).map((gap) => `${gap.block}: ${gap.recommended_action}`),
    ...(matrixData?.monitoring_gaps || [])
  ].slice(0, 5);

  return (
    <section className="visual-report-panel" aria-label="Informe de hoy">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Informe de hoy</p>
          <h3>{data.title || report.title}</h3>
        </div>
        <span className={`status-badge ${data.overall_status || "unknown"}`}>
          {data.overall_status || "unknown"}
        </span>
      </div>

      <ExportToolbar label="Exportar informe de hoy">
        <ExportLink href={latestExportUrl("executive", "html")}>
          Descargar informe ejecutivo
        </ExportLink>
        <ExportLink href={latestExportUrl("technical", "html")}>
          Descargar informe técnico
        </ExportLink>
        <ExportLink href={latestExportUrl("operational", "html")}>
          Descargar informe operativo
        </ExportLink>
      </ExportToolbar>

      <ExportToolbar label="Crear borrador desde informe de hoy">
        <button type="button" className="action-button" onClick={onCreateExecutiveDraft}>
          Crear correo ejecutivo
        </button>
        <button type="button" className="action-button" onClick={onCreateTechnicalDraft}>
          Crear aviso técnico
        </button>
        <button type="button" className="action-button" onClick={onCreateOperationalDraft}>
          Crear resumen operativo
        </button>
      </ExportToolbar>

      <div className="executive-summary">
        <h3>Resumen ejecutivo</h3>
        <p>{data.executive_summary || "Sin resumen ejecutivo estructurado."}</p>
        <span>{formatDashboardTimestamp(report.created_at)}</span>
      </div>

      <div className="today-executive-grid">
        <div>
          <span>Top 3 acciones</span>
          {topActions.length ? (
            topActions.map((action) => (
              <p key={action.action}>
                <strong>{action.priority}</strong> · {action.action}
              </p>
            ))
          ) : (
            <p>Sin acciones prioritarias.</p>
          )}
        </div>
        <div>
          <span>Riesgos críticos</span>
          {criticalRisks.length ? (
            criticalRisks.map((risk) => (
              <p key={`${risk.asset_or_service}-${risk.impact}`}>
                <strong>{risk.severity}</strong> · {risk.asset_or_service}: {risk.impact}
              </p>
            ))
          ) : (
            <p>Sin riesgos críticos estructurados.</p>
          )}
        </div>
        <div>
          <span>Impacto en usuarios</span>
          {userImpact.length ? userImpact.map((item) => <p key={item}>{item}</p>) : <p>Sin impacto correlacionado destacado.</p>}
        </div>
        <div>
          <span>Huecos de monitorización</span>
          {monitoringGaps.length ? monitoringGaps.map((item) => <p key={item}>{item}</p>) : <p>Sin huecos destacados.</p>}
        </div>
      </div>

      <div className="visual-card-grid">
        {(data.key_findings || []).map((finding) => (
          <article key={`${finding.title}-${finding.severity}`} className="visual-card">
            <span className={`severity-pill ${finding.severity}`}>{finding.severity}</span>
            <h3>{finding.title}</h3>
            <p>{finding.description}</p>
            <strong>{finding.recommended_action}</strong>
          </article>
        ))}
      </div>

      <div className="visual-columns">
        <div className="visual-list-panel">
          <h3>Acciones recomendadas</h3>
          {(data.top_actions || []).length ? (
            data.top_actions.map((action) => (
              <p key={`${action.priority}-${action.action}`}>
                <strong>{action.priority}</strong> · {action.action}
                <span>{action.reason}</span>
                <em>{action.owner_type}</em>
              </p>
            ))
          ) : (
            <p>Sin acciones estructuradas.</p>
          )}
        </div>
        <div className="visual-list-panel">
          <h3>Datos faltantes</h3>
          {(data.missing_data || []).length ? (
            data.missing_data.map((item) => <p key={item}>{item}</p>)
          ) : (
            <p>No hay datos faltantes destacados en el informe.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function MatrixReportView({
  report,
  data,
  isLoading,
  filters,
  onFiltersChange,
  onGenerateMatrix,
  onCreateMatrixDraft
}) {
  const rows = data?.rows || [];
  const priorities = Array.from(new Set(rows.map((row) => normalizeBucket(row.priority)))).sort();
  const levels = Array.from(
    new Set(rows.map((row) => normalizeBucket(row.correlation_level)))
  ).sort();
  const query = String(filters.query || "").trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    const priorityOk = !filters.priority || normalizeBucket(row.priority) === filters.priority;
    const levelOk =
      !filters.correlation || normalizeBucket(row.correlation_level) === filters.correlation;
    const haystack = [
      row.asset_or_service,
      row.technical_problem,
      row.user_impact,
      row.technical_risk,
      row.priority,
      row.correlation_level,
      row.recommended_action,
      row.task_type,
      ...(row.related_incidents || []).map((incident) =>
        [incident.id, incident.title, incident.status].join(" ")
      )
    ]
      .join(" ")
      .toLowerCase();
    const queryOk = !query || haystack.includes(query);
    return priorityOk && levelOk && queryOk;
  });

  if (isLoading) {
    return <div className="structured-loading">Cargando matriz...</div>;
  }

  if (!report || !data) {
    return (
      <section className="visual-report-panel" aria-label="Matriz">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Matriz</p>
            <h3>No hay matriz estructurada</h3>
          </div>
        </div>
        <p className="empty-history">Genera una matriz para alimentar esta tabla visual.</p>
        <button type="button" className="action-button primary-action" onClick={onGenerateMatrix}>
          Generar matriz estructurada
        </button>
      </section>
    );
  }

  return (
    <section className="visual-report-panel" aria-label="Matriz">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Matriz</p>
          <h3>{data.title || report.title}</h3>
        </div>
        <div className="matrix-summary-tools">
          <span className="report-list-meta">{formatDashboardTimestamp(report.created_at)}</span>
          <span className="readonly-badge">
            {filteredRows.length} de {rows.length} filas
          </span>
        </div>
      </div>

      <ExportToolbar label="Exportar matriz">
        <ExportLink href={exportUrl("/api/export/latest-matrix", { format: "csv" })}>
          Descargar matriz CSV
        </ExportLink>
        <ExportLink href={exportUrl("/api/export/latest-matrix", { format: "html" })}>
          Descargar HTML
        </ExportLink>
        <ExportLink href={exportUrl("/api/export/latest-matrix", { format: "markdown" })}>
          Descargar Markdown
        </ExportLink>
        <ExportLink href={exportUrl("/api/export/latest-matrix", { format: "json" })}>
          Descargar datos JSON
        </ExportLink>
      </ExportToolbar>

      <ExportToolbar label="Crear borrador desde matriz">
        <button type="button" className="action-button" onClick={onCreateMatrixDraft}>
          Crear aviso técnico
        </button>
      </ExportToolbar>

      <p className="structured-summary">{data.summary}</p>

      <div className="matrix-filters" aria-label="Filtros de matriz">
        <label className="report-field">
          <span>Prioridad</span>
          <select
            value={filters.priority}
            onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value })}
          >
            <option value="">Todas</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label className="report-field">
          <span>Correlación</span>
          <select
            value={filters.correlation}
            onChange={(event) => onFiltersChange({ ...filters, correlation: event.target.value })}
          >
            <option value="">Todas</option>
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="report-field">
          <span>Texto</span>
          <input
            type="search"
            value={filters.query}
            placeholder="Activo, incidencia, riesgo..."
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="action-button secondary-action"
          onClick={() => onFiltersChange({ priority: "", correlation: "", query: "" })}
          disabled={!filters.priority && !filters.correlation && !filters.query}
        >
          Limpiar filtros
        </button>
      </div>

      <div className="matrix-table-wrap">
        <table className="matrix-table detailed-matrix-table">
          <thead>
            <tr>
              <th>Activo / servicio</th>
              <th>Problema técnico</th>
              <th>Incidencias relacionadas</th>
              <th>Correlación</th>
              <th>Impacto</th>
              <th>Riesgo</th>
              <th>Prioridad</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr
                key={`${row.asset_or_service}-${row.technical_problem}`}
                className={`matrix-row priority-${normalizeBucket(row.priority)
                  .toLowerCase()
                  .replace("í", "i")} correlation-${normalizeBucket(row.correlation_level)
                  .toLowerCase()
                  .replace("_", "-")}`}
              >
                <td>{row.asset_or_service}</td>
                <td>{row.technical_problem}</td>
                <td>
                  {(row.related_incidents || []).length
                    ? row.related_incidents
                        .map((incident) => `${incident.id} ${incident.title} (${incident.status})`)
                        .join("; ")
                    : "Sin incidencia directa"}
                </td>
                <td>
                  <span className={`matrix-pill level-${normalizeBucket(row.correlation_level).toLowerCase()}`}>
                    {row.correlation_level}
                  </span>
                </td>
                <td>{row.user_impact}</td>
                <td>{row.technical_risk}</td>
                <td>
                  <span className={`priority-pill priority-${normalizeBucket(row.priority).toLowerCase().replace("í", "i")}`}>
                    {row.priority}
                  </span>
                </td>
                <td>{row.recommended_action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filteredRows.length ? <p className="empty-history">Sin filas para esos filtros.</p> : null}
    </section>
  );
}

function VisualCharts({ dailyData, matrixData }) {
  const matrixRows = matrixData?.rows || [];
  const incidentItems = matrixRows.flatMap((row) => row.related_incidents || []);
  const dailyActions = dailyData?.top_actions || [];

  const incidentCounts = countBy(incidentItems, (incident) => incident.status);
  const riskCounts = countBy(matrixRows, (row) => row.priority);
  const correlationCounts = countBy(matrixRows, (row) => row.correlation_level);
  const taskCounts = countBy(
    matrixRows.length ? matrixRows : dailyActions,
    (item) => item.task_type || item.owner_type
  );

  return (
    <section className="charts-section" aria-label="Gráficos operativos">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Gráficos iniciales</p>
          <h3>Lectura visual</h3>
        </div>
      </div>
      <div className="charts-grid">
        <BarChart title="Incidencias por estado" data={incidentCounts} />
        <BarChart title="Riesgos por prioridad" data={riskCounts} />
        <BarChart title="Correlaciones por nivel" data={correlationCounts} />
        <BarChart title="Acciones por tipo de tarea" data={taskCounts} />
      </div>
    </section>
  );
}

function AnalyticsView({
  analytics,
  analyticsReports,
  isLoading,
  message,
  onReload,
  onCreateExecutiveDraft,
  onCreateTechnicalDraft,
  onCreateOperationalDraft
}) {
  const charts = analytics?.charts || {};
  const series = analytics?.series || {};
  const diff = analytics?.diff || {};

  if (isLoading) {
    return <div className="structured-loading">Cargando análisis desde SQLite...</div>;
  }

  if (!analytics) {
    return (
      <section className="visual-report-panel" aria-label="Análisis">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Análisis</p>
            <h3>Sin datos analíticos</h3>
          </div>
          <button type="button" className="action-button secondary-action" onClick={onReload}>
            Recargar análisis
          </button>
        </div>
        <p className="empty-history">
          No hay suficiente histórico para comparar. La comparativa estará disponible cuando
          existan informes de varios días. Genera más informes diarios para ver evolución.
        </p>
        {message ? <div className="report-message">{message}</div> : null}
      </section>
    );
  }

  return (
    <section className="analysis-section" aria-label="Análisis operativo">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Análisis v0.15</p>
          <h3>Gráficas, evolución y comparativa</h3>
        </div>
        <div className="analysis-header-actions">
          <ExportLink href={latestExportUrl("executive", "html")}>
            Descargar informe ejecutivo
          </ExportLink>
          <ExportLink href={latestExportUrl("technical", "html")}>
            Descargar informe técnico
          </ExportLink>
          <ExportLink href={latestExportUrl("operational", "html")}>
            Descargar informe operativo
          </ExportLink>
          <button type="button" className="action-button secondary-action" onClick={onCreateExecutiveDraft}>
            Crear correo ejecutivo
          </button>
          <button type="button" className="action-button secondary-action" onClick={onCreateTechnicalDraft}>
            Crear aviso técnico
          </button>
          <button type="button" className="action-button secondary-action" onClick={onCreateOperationalDraft}>
            Crear resumen operativo
          </button>
          <button type="button" className="action-button secondary-action" onClick={onReload}>
            Recargar análisis
          </button>
        </div>
      </div>

      {analytics.warnings?.length ? (
        <div className="structured-warning">
          {analytics.warnings.slice(0, 3).join(" ")}
        </div>
      ) : null}

      {!analytics.previous ? (
        <div className="structured-warning">
          No hay suficiente histórico para comparar. La comparativa estará disponible cuando
          existan informes de varios días. Genera más informes diarios para ver evolución.
        </div>
      ) : null}

      <div className="analytics-comparison">
        <div className="comparison-card">
          <span>Hoy</span>
          <strong>{analytics.today?.overall_status || "Sin datos"}</strong>
          <p>{analytics.today?.executive_summary || "Sin resumen ejecutivo disponible."}</p>
        </div>
        <div className="comparison-card">
          <span>Anterior</span>
          <strong>{analytics.previous?.overall_status || "Sin datos"}</strong>
          <p>
            {analytics.previous?.date
              ? `Comparado con ${analytics.previous.date}.`
              : "No hay informe anterior suficiente."}
          </p>
        </div>
        <div className="comparison-card">
          <span>Cambio</span>
          <strong>{diff.status_change || "sin_comparativa"}</strong>
          <p>
            Riesgos nuevos: {diff.new_critical_risks?.length || 0}. Huecos nuevos:{" "}
            {diff.monitoring_gap_changes?.new?.length || 0}.
          </p>
        </div>
      </div>

      <div className="charts-grid">
        <BarChart title="Incidencias por estado" data={charts.incidents_by_status || []} />
        <BarChart title="Riesgos por prioridad" data={charts.risks_by_priority || []} />
        <BarChart title="Correlaciones por nivel" data={charts.correlations_by_level || []} />
        <BarChart title="Acciones por tipo de tarea" data={charts.actions_by_type || []} />
      </div>

      <div className="charts-grid">
        <TrendChart
          title="Evolución estado general"
          data={series.overall_status || []}
          valueFormatter={(value) => value}
        />
        <TrendChart title="Evolución riesgos críticos" data={series.critical_risks || []} />
        <TrendChart title="Evolución huecos" data={series.monitoring_gaps || []} />
        <TrendChart title="Evolución acciones" data={series.recommended_actions || []} />
      </div>

      <div className="visual-columns">
        <DiffList
          title="Nuevos riesgos críticos"
          items={diff.new_critical_risks || []}
          emptyText="Sin nuevos riesgos críticos frente al anterior."
        />
        <DiffList
          title="Riesgos persistentes"
          items={diff.persistent_critical_risks || []}
          emptyText="Sin riesgos persistentes detectados."
        />
        <DiffList
          title="Riesgos desaparecidos"
          items={diff.resolved_critical_risks || []}
          emptyText="Sin riesgos desaparecidos detectados."
        />
      </div>

      <div className="visual-columns">
        <DiffList
          title="Huecos nuevos"
          items={diff.monitoring_gap_changes?.new || []}
          emptyText="Sin huecos nuevos."
        />
        <DiffList
          title="Huecos persistentes"
          items={diff.monitoring_gap_changes?.repeated || []}
          emptyText="Sin huecos persistentes."
        />
        <DiffList
          title="Acciones repetidas"
          items={diff.repeated_actions || []}
          emptyText="Sin acciones repetidas destacadas."
        />
      </div>

      <div className="report-history analytics-days">
        <div className="history-header">
          <h3>Últimos días</h3>
          <span>{analyticsReports?.reports?.length || 0} días</span>
        </div>
        {(analyticsReports?.reports?.length || 0) < 2 ? (
          <div className="structured-warning">
            No hay suficiente histórico para comparar. La comparativa estará disponible cuando
            existan informes de varios días. Genera más informes diarios para ver evolución.
          </div>
        ) : null}
        <div className="analytics-days-grid">
          {(analyticsReports?.reports || []).map((day) => (
            <article key={day.date} className="analytics-day-card">
              <strong>{day.date}</strong>
              <span className={`status-badge ${day.overall_status || "unknown"}`}>
                {day.overall_status || "unknown"}
              </span>
              <p>
                Riesgos: {day.critical_risks_count} · Huecos: {day.monitoring_gaps_count} · Acciones:{" "}
                {day.actions_count}
              </p>
              {day.missing_reports?.length ? (
                <em>Faltan: {day.missing_reports.join(", ")}</em>
              ) : (
                <em>Paquete completo</em>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CommunicationsView({
  drafts = [],
  selectedDraft,
  draftForm = defaultCommunicationDraftForm(),
  draftSummary = {},
  draftFilter = {},
  templates = [],
  allowedDomains = [],
  selectedTemplateId = defaultCommunicationTemplateId,
  templatesMessage = "",
  sendPreparation = null,
  directoryUsers,
  directoryQuery,
  directoryLoading,
  directoryMessage,
  directorySyncedAt,
  isLoading,
  isSaving,
  isSendingEmail,
  message,
  onReload,
  onNewManual,
  onCreateExecutive,
  onCreateTechnical,
  onCreateOperational,
  onCreateMatrix,
  onChangeForm,
  onSaveDraft,
  onDiscardDraft,
  onDeleteDraft,
  onCopyDraft,
  onDuplicateDraft,
  onPrepareSend,
  onConfirmSend,
  onDirectSend,
  onMarkReadyForReview,
  onMarkReviewed,
  onDownloadDraft,
  onCreateTemplateDraft,
  onTemplateChange,
  onDraftFilterChange,
  hasActiveFilters = false,
  onClearFilters,
  selectedDraftRef,
  editorMode = "new",
  openDraftId = "",
  reviewDraftId = "",
  reviewMessage = "",
  pendingVoiceDraftDecision = null,
  pendingVoiceSendConfirmation = null,
  onOpenDraft,
  onCloseReviewDraft,
  onReviewDraftLoaded,
  onReviewDraftUpdated,
  onOpenDraftIdChange,
  onOpenDraftByIdSubmit,
  onVoiceDraftReview,
  onVoiceDraftRequestDirectSend,
  onVoiceDraftConfirmDirectSend,
  onVoiceDraftCancel,
  onRecipientQueryChange,
  onSyncDirectory,
  onUseDirectoryUser
}) {
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;
  const safeAllowedDomains = normalizeAllowedDomains(allowedDomains);
  const selectedSendPreparation =
    sendPreparation?.draft?.id === selectedDraft?.id ? sendPreparation : null;
  const selectedDraftIsSent = communicationDraftIsSent(selectedDraft);
  const draftEditorLocked = selectedDraftIsSent;
  const canPrepareSend = communicationDraftCanPrepareSend(selectedDraft, safeAllowedDomains);
  const canConfirmSend = communicationDraftCanConfirmSend(
    selectedDraft,
    selectedSendPreparation,
    safeAllowedDomains
  );
  const totalDraftCount = Math.max(Number(draftSummary?.total || 0), drafts.length || 0);
  const visibleDraftCount = drafts.length || 0;

  const activeReviewTargetId = String(reviewDraftId || selectedDraft?.id || "").trim();

  useEffect(() => {
    if (!selectedDraftRef?.current || !activeReviewTargetId) {
      return;
    }

    try {
      selectedDraftRef.current.scrollIntoView({
        block: "start",
        behavior: "smooth"
      });
    } catch {
      // ignore scroll failures
    }
  }, [activeReviewTargetId, selectedDraftRef]);

  return (
    <section className="communications-section" aria-label="Comunicaciones">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Comunicaciones v0.15</p>
          <h3>Borradores para revisar y copiar</h3>
        </div>
        <div className="communications-header-actions">
          <button type="button" className="action-button" onClick={onCreateExecutive} disabled={isSaving}>
            Crear correo ejecutivo
          </button>
          <button type="button" className="action-button" onClick={onCreateTechnical} disabled={isSaving}>
            Crear aviso técnico
          </button>
          <button type="button" className="action-button" onClick={onCreateOperational} disabled={isSaving}>
            Crear resumen operativo
          </button>
          <button type="button" className="action-button" onClick={onCreateMatrix} disabled={isSaving}>
            Crear resumen de matriz
          </button>
          <button type="button" className="action-button secondary-action" onClick={onNewManual}>
            Crear borrador manual
          </button>
          <button type="button" className="action-button secondary-action" onClick={onReload} disabled={isLoading}>
            Recargar
          </button>
          <button
            type="button"
            className="action-button secondary-action"
            onClick={onClearFilters}
            disabled={!hasActiveFilters || isLoading}
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {message ? <div className="report-message">{message}</div> : null}

      {pendingVoiceDraftDecision ? (
        <div className="communication-voice-decision-banner">
          <div>
            <p className="eyebrow">Decisión por voz pendiente</p>
            <strong>Borrador #{pendingVoiceDraftDecision.draft_id} creado.</strong>
            <p>
              Para {pendingVoiceDraftDecision.recipient_name || "el destinatario"}. No se ha enviado nada.
              Elige si quieres enviarlo directamente o revisarlo antes.
            </p>
          </div>
          <div className="report-list-actions">
            <button type="button" className="action-button primary-action" onClick={onVoiceDraftRequestDirectSend}>
              Enviar directamente
            </button>
            <button type="button" className="action-button secondary-action" onClick={onVoiceDraftReview}>
              Revisar antes
            </button>
          </div>
        </div>
      ) : null}

      {pendingVoiceSendConfirmation ? (
        <div className="communication-voice-decision-banner warning">
          <div>
            <p className="eyebrow">Confirmación final requerida</p>
            <strong>Vas a enviar un correo real a {pendingVoiceSendConfirmation.recipient_email || "destino no informado"}.</strong>
            <p>Borrador #{pendingVoiceSendConfirmation.draft_id}. Esta acción enviará el email real y bloqueará el reenvío.</p>
          </div>
          <div className="report-list-actions">
            <button type="button" className="action-button warning-action" onClick={onVoiceDraftConfirmDirectSend}>
              Confirmar envío directo
            </button>
            <button type="button" className="action-button secondary-action" onClick={onVoiceDraftCancel}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="communications-summary" aria-label="Resumen de borradores">
        <div>
          <strong>{totalDraftCount}</strong>
          <span>Total global</span>
        </div>
        <div>
          <strong>{draftSummary?.pending_review ?? 0}</strong>
          <span>Pendientes</span>
        </div>
        <div>
          <strong>{draftSummary?.ready_for_review ?? 0}</strong>
          <span>Listos</span>
        </div>
        <div>
          <strong>{draftSummary?.reviewed ?? 0}</strong>
          <span>Revisados</span>
        </div>
        <div>
          <strong>{draftSummary?.copied ?? 0}</strong>
          <span>Copiados</span>
        </div>
        <div>
          <strong>{draftSummary?.discarded ?? 0}</strong>
          <span>Descartados</span>
        </div>
        <div>
          <strong>{visibleDraftCount}</strong>
          <span>Visibles</span>
        </div>
      </div>

      <div className="communications-note">
        {hasActiveFilters
          ? `Mostrando ${visibleDraftCount} borradores visibles de ${totalDraftCount} totales. Los filtros activos pueden ocultar un borrador abierto.`
          : `Mostrando ${visibleDraftCount} borradores visibles de ${totalDraftCount} totales.`}
      </div>

      <div ref={selectedDraftRef}>
        <CommunicationDraftReviewEditor
          draftId={reviewDraftId}
          templates={templates}
          allowedDomains={safeAllowedDomains}
          sendPreparation={sendPreparation}
          isSaving={isSaving}
          isSendingEmail={isSendingEmail}
          message={reviewMessage}
          onClose={onCloseReviewDraft}
          onDraftLoaded={onReviewDraftLoaded}
          onDraftUpdated={onReviewDraftUpdated}
          onCopy={onCopyDraft}
          onDownload={onDownloadDraft}
          onDuplicate={onDuplicateDraft}
          onDiscard={onDiscardDraft}
          onPrepareSend={onPrepareSend}
          onConfirmSend={onConfirmSend}
          onDirectSend={onDirectSend}
        />
      </div>

      <div className="communications-layout">
        <details className="communications-manual-draft">
          <summary>Crear borrador manual</summary>
          <div className="communications-manual-draft-body">
            <form className="communications-editor" onSubmit={onSaveDraft}>
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Editor</p>
              <h3>
                {editorMode === "edit" && selectedDraft?.id
                  ? `Editando borrador #${selectedDraft.id}`
                  : "Nuevo borrador"}
              </h3>
            </div>
            <span className="readonly-badge">
              {editorMode === "edit" ? "Edición" : "Nuevo"}
            </span>
          </div>

          <p className="communications-note">
            Los borradores creados por el agente se revisan en el panel superior. Este editor queda
            solo para crear borradores manuales.
          </p>

          <div className="communication-field-row">
            <label className="report-field">
              <span>Plantilla</span>
              <select
                value={selectedTemplateId}
                disabled={draftEditorLocked}
                onChange={(event) => {
                  onTemplateChange(event.target.value);
                  onChangeForm({ ...draftForm, template_id: event.target.value });
                }}
              >
                {templates.length ? (
                  templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))
                ) : (
                  <option value={selectedTemplateId}>Sin plantillas</option>
                )}
              </select>
            </label>
            <div className="report-field">
              <span>Descripción</span>
              <p className="empty-history">
                {selectedTemplate?.description || "Selecciona una plantilla para ver su descripción."}
              </p>
            </div>
          </div>

          <div className="communication-field-row">
            <label className="report-field">
              <span>Canal sugerido</span>
              <input type="text" readOnly value={selectedTemplate?.suggested_channel || "email"} />
            </label>
            <label className="report-field">
              <span>Tono</span>
              <input type="text" readOnly value={selectedTemplate?.tone || "claro"} />
            </label>
          </div>

          <div className="communication-field-row">
            <label className="report-field">
              <span>Tipo</span>
              <select
                value={draftForm.type}
                disabled={draftEditorLocked}
                onChange={(event) => onChangeForm({ ...draftForm, type: event.target.value })}
              >
                {communicationTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="report-field">
              <span>Estado</span>
              <select
                value={draftForm.status}
                disabled={draftEditorLocked}
                onChange={(event) => onChangeForm({ ...draftForm, status: event.target.value })}
              >
                {communicationStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="report-field">
            <span>Destinatario</span>
            <input
              type="text"
              value={draftForm.recipient_label}
              readOnly={draftEditorLocked}
              onChange={(event) => {
                const value = event.target.value;
                onChangeForm({ ...draftForm, recipient_label: value });
                onRecipientQueryChange(value);
              }}
            />
          </label>
          <div className="directory-inline-panel">
            <div className="directory-inline-header">
              <span>Libreta corporativa</span>
              <button
                type="button"
                className="action-button secondary-action"
                onClick={onSyncDirectory}
                disabled={directoryLoading}
              >
                Sincronizar
              </button>
            </div>
            <div className="directory-inline-meta">
              <span>{directoryLoading ? "Buscando..." : `${directoryUsers.length} coincidencias`}</span>
              <span>{directorySyncedAt ? `Actualizada ${directorySyncedAt}` : "Sin caché reciente"}</span>
            </div>
            {directoryMessage ? <div className="report-message">{directoryMessage}</div> : null}
            {directoryQuery ? (
              <div className="directory-inline-results">
                {directoryUsers.length === 0 ? (
                  <p className="empty-history">No hay coincidencias para la búsqueda actual.</p>
                ) : (
                  directoryUsers.slice(0, 5).map((user) => (
                    <div key={user.id || `${user.display_name}-${user.mail}`} className="directory-inline-result">
                      <div>
                        <strong>{user.display_name || "Sin nombre"}</strong>
                        <p>
                          {directoryUserEmail(user) || "Sin correo"} · {user.department || "Sin departamento"}
                        </p>
                        <p>
                          {user.job_title || "Sin puesto"} · {user.office_location || "Sin ubicación"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="action-button secondary-action"
                        disabled={draftEditorLocked}
                        onClick={() => onUseDirectoryUser(user)}
                      >
                        Usar en borrador
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="communication-field-row">
            <label className="report-field">
              <span>Email opcional</span>
              <input
                type="email"
                value={draftForm.recipient_email}
                readOnly={draftEditorLocked}
                onChange={(event) =>
                  onChangeForm({ ...draftForm, recipient_email: event.target.value })
                }
              />
            </label>
            <label className="report-field">
              <span>Fuente</span>
              <select
                value={draftForm.source_type}
                disabled={draftEditorLocked}
                onChange={(event) =>
                  onChangeForm({ ...draftForm, source_type: event.target.value })
                }
              >
                {communicationSourceTypes.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="communication-field-row">
            <label className="report-field">
              <span>Email alternativo</span>
              <input
                type="email"
                value={draftForm.optional_email || ""}
                readOnly={draftEditorLocked}
                onChange={(event) =>
                  onChangeForm({ ...draftForm, optional_email: event.target.value })
                }
              />
            </label>
            <div className="report-field">
              <span>Identificador interno</span>
              <input type="text" readOnly value={selectedDraft?.id ? String(selectedDraft.id) : ""} />
            </div>
          </div>

          <div className="communication-field-row">
            <label className="report-field">
              <span>Fuente informe ID</span>
              <input
                type="text"
                value={draftForm.source_report_id}
                readOnly={draftEditorLocked}
                onChange={(event) =>
                  onChangeForm({ ...draftForm, source_report_id: event.target.value })
                }
              />
            </label>
            <label className="report-field">
              <span>Fuente incidencia ID</span>
              <input
                type="text"
                value={draftForm.source_incident_id}
                readOnly={draftEditorLocked}
                onChange={(event) =>
                  onChangeForm({ ...draftForm, source_incident_id: event.target.value })
                }
              />
            </label>
          </div>

          <label className="report-field">
            <span>Asunto</span>
            <input
              type="text"
              value={draftForm.subject}
              readOnly={draftEditorLocked}
              onChange={(event) => onChangeForm({ ...draftForm, subject: event.target.value })}
            />
          </label>

          <label className="report-field">
            <span>Cuerpo Markdown</span>
            <textarea
              rows={9}
              value={draftForm.body_markdown}
              readOnly={draftEditorLocked}
              onChange={(event) =>
                onChangeForm({ ...draftForm, body_markdown: event.target.value })
              }
            />
          </label>

          <label className="report-field">
            <span>Cuerpo texto</span>
            <textarea
              rows={8}
              value={draftForm.body_text}
              readOnly={draftEditorLocked}
              onChange={(event) => onChangeForm({ ...draftForm, body_text: event.target.value })}
            />
          </label>

          <label className="report-field">
            <span>Cuerpo HTML</span>
            <textarea
              rows={8}
              value={draftForm.body_html || ""}
              readOnly={draftEditorLocked}
              onChange={(event) => onChangeForm({ ...draftForm, body_html: event.target.value })}
            />
          </label>

          <div className="report-save-row">
            <button
              type="submit"
              className="action-button primary-action"
              disabled={isSaving || draftEditorLocked}
            >
              {selectedDraftIsSent ? "Duplica para editar" : selectedDraft ? "Guardar cambios" : "Guardar borrador"}
            </button>
            <button
              type="button"
              className="action-button secondary-action"
              onClick={onCreateTemplateDraft}
              disabled={isSaving || draftEditorLocked || !selectedTemplateId || !templates.length}
            >
              Crear borrador con plantilla
            </button>
            <span className="report-message" aria-live="polite">
              Solo se guarda el borrador local. No hay envío automático.
            </span>
          </div>
            </form>
          </div>
        </details>

        <div className="communications-history">
        <div className="history-header">
          <h3>Borradores guardados</h3>
            <span>
              {isLoading
                ? "Cargando..."
                : `${drafts.length} recientes · ${communicationDraftFilterStatusLabel(
                    draftFilter.status
                  )}`}
            </span>
        </div>

          <form className="communications-open-by-id" onSubmit={onOpenDraftByIdSubmit}>
            <label className="report-field">
              <span>Abrir borrador por ID</span>
              <input
                name="draftId"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="21"
                value={openDraftId || ""}
                onChange={(event) =>
                  onOpenDraftIdChange?.(String(event.currentTarget.value || "").replace(/\D/g, ""))
                }
              />
            </label>
            <button
              type="submit"
              className="action-button secondary-action"
              disabled={isLoading}
            >
              Abrir por ID
            </button>
          </form>

          <div className="communications-note">
            mailto solo abre el cliente del usuario si el sistema tiene uno configurado. No envía
            nada por sí solo y puede truncar textos largos según el cliente local.
          </div>

          <div className="report-filters communications-filters" aria-label="Filtros de borradores">
            <label className="report-field">
              <span>Estado</span>
              <select
                value={draftFilter.status}
                onChange={(event) =>
                  onDraftFilterChange({ ...draftFilter, status: event.target.value })
                }
              >
                {communicationStatusFilters.map((status) => (
                  <option key={status.value || "all"} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="report-field">
              <span>Tipo</span>
              <select
                value={draftFilter.type}
                onChange={(event) =>
                  onDraftFilterChange({ ...draftFilter, type: event.target.value })
                }
              >
                <option value="">Todos</option>
                {communicationTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="report-field">
              <span>Plantilla</span>
              <select
                value={draftFilter.template_id}
                onChange={(event) =>
                  onDraftFilterChange({ ...draftFilter, template_id: event.target.value })
                }
              >
                <option value="">Todas</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="report-list">
            {drafts.length === 0 ? (
              <p className="empty-history">Aún no hay borradores de comunicación.</p>
            ) : (
              drafts.map((draft) => (
                <article
                  key={draft.id}
                  className={`report-list-entry${selectedDraft?.id === draft.id ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="report-list-item"
                    onClick={() => onOpenDraft?.(draft)}
                  >
                    <span className="report-list-title">{draft.subject}</span>
                    <span className="report-list-meta">
                      ID #{draft.id} · {draft.recipient_email || "Sin destinatario"} ·{" "}
                      {communicationDraftStatusLabel(draft.status)}
                      {draft.source_incident_id ? ` · incidencia ${draft.source_incident_id}` : ""}
                    </span>
                  </button>
                  <div className="report-list-actions">
                    <button
                      type="button"
                      className="action-button secondary-action"
                      onClick={() => onOpenDraft?.(draft)}
                    >
                      Revisar
                    </button>
                    <a
                      href={communicationDraftViewerPath(draft.id)}
                      className="action-button secondary-action export-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir en pestaña nueva
                    </a>
                  </div>
                </article>
              ))
            )}
          </div>

          {templatesMessage ? (
            <div className="report-message">{templatesMessage}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DirectoryView({
  query,
  users,
  isLoading,
  message,
  syncedAt,
  onQueryChange,
  onReload,
  onSync,
  onUseUser
}) {
  return (
    <section className="directory-section" aria-label="Libreta corporativa">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Libreta corporativa v0.15.1</p>
          <h3>Usuarios activos de la organización</h3>
        </div>
        <div className="directory-header-actions">
          <button type="button" className="action-button" onClick={onSync}>
            Sincronizar desde Graph
          </button>
          <button type="button" className="action-button secondary-action" onClick={onReload} disabled={isLoading}>
            Recargar
          </button>
        </div>
      </div>

      {message ? <div className="report-message">{message}</div> : null}

      <div className="directory-search-card">
        <label className="report-field">
          <span>Buscar persona</span>
          <input
            type="search"
            value={query}
            placeholder="Nombre, correo, departamento o puesto"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className="directory-meta-row">
          <span>{isLoading ? "Buscando..." : `${users.length} resultados`}</span>
          <span>{syncedAt ? `Última sincronización ${syncedAt}` : "Sin sincronización reciente"}</span>
        </div>
      </div>

      <div className="report-list">
        {users.length === 0 ? (
          <p className="empty-history">
            No hay resultados en la libreta corporativa. Sincroniza desde Graph o ajusta la búsqueda.
          </p>
        ) : (
          users.map((user) => (
            <article key={user.id || `${user.display_name}-${user.mail}`} className="report-list-entry">
              <div className="directory-user-card">
                <div>
                  <span className="report-list-title">{user.display_name || "Sin nombre"}</span>
                  <span className="report-list-meta">
                    {directoryUserEmail(user) || "Sin correo"} · {directoryUserAccountLabel(user)}
                  </span>
                </div>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => onUseUser(user)}
                >
                  Usar en borrador
                </button>
              </div>
              <div className="directory-details-grid">
                <div>
                  <span>Puesto</span>
                  <p>{user.job_title || "Sin puesto"}</p>
                </div>
                <div>
                  <span>Departamento</span>
                  <p>{user.department || "Sin departamento"}</p>
                </div>
                <div>
                  <span>Ubicación</span>
                  <p>{user.office_location || "Sin ubicación"}</p>
                </div>
                <div>
                  <span>Teléfono</span>
                  <p>{directoryUserPhone(user.business_phone || user.mobile_phone) || "Sin teléfono"}</p>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function PowerBiView({
  status,
  models,
  snapshots,
  isLoading,
  message,
  loadedAt,
  onReload,
  onRefreshModel,
  onRefreshCatalog,
  onImportCatalog,
  onGenerateBusinessDictionary,
  onReviewBusinessDictionary,
  capabilities,
  daxLab,
  onDaxLabChange,
  onBuildDaxLab,
  onValidateDaxLab,
  onExecuteDaxLab,
  askLab,
  askQuestion,
  onAskQuestionChange,
  onAskLabChange,
  onInterpretAskLab,
  onPreviewAskLab,
  onExecuteAskLab,
  onOpenExpandedResult,
  latestPowerBiResult,
  latestPowerBiResultSource,
  latestPowerBiQuestion,
  latestPowerBiTimestamp,
  powerBiHistory
}) {
  const configuredModels = Array.isArray(models) ? models : [];
  const enabledCount = status?.models_enabled ?? configuredModels.filter((model) => model.enabled).length;
  const totalCount = status?.models_total ?? configuredModels.length;
  const capabilityMetrics = Array.isArray(capabilities?.supportedMetrics) ? capabilities.supportedMetrics : [];
  const capabilityDimensions = Array.isArray(capabilities?.supportedDimensions)
    ? capabilities.supportedDimensions
    : [];
  const capabilityIntents = Array.isArray(capabilities?.supportedIntents)
    ? capabilities.supportedIntents
    : [];
  const capabilityTimeRanges = Array.isArray(capabilities?.supportedTimeRanges)
    ? capabilities.supportedTimeRanges
    : [];
  const capabilityQuestions = Array.isArray(capabilities?.supportedQuestions)
    ? capabilities.supportedQuestions
    : [];
  const capabilityRejected = Array.isArray(capabilities?.rejectedQuestions)
    ? capabilities.rejectedQuestions
    : [];
  const capabilityExamples = Array.isArray(capabilities?.examples) ? capabilities.examples : [];
  const recentPowerBiHistory = Array.isArray(powerBiHistory) ? powerBiHistory.slice(-5).reverse() : [];
  const latestVisualResult = latestPowerBiResult?.visualResult || null;
  const [showPowerBiCapabilities, setShowPowerBiCapabilities] = useState(false);

  function applyPowerBiAskLabExample(question) {
    const nextQuestion = String(question || "").trim();
    if (!nextQuestion) {
      return;
    }
    onAskQuestionChange(nextQuestion);
    onAskLabChange((current) => ({
      ...current,
      question: nextQuestion,
      interpretation: null,
      preview: null,
      execution: null,
      error: "",
      statusMessage: ""
    }));
  }

  return (
    <section className="reports-section" aria-label="Power BI">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Power BI v0.19.0</p>
          <h3>Modelo semántico y resultados analíticos</h3>
        </div>
        <div className="report-toolbar">
          <button type="button" className="action-button" onClick={onReload} disabled={isLoading}>
            Refrescar
          </button>
        </div>
      </div>

      {message ? <div className="report-message">{message}</div> : null}

      <div className="communications-summary" aria-label="Resumen Power BI">
        <div>
          <strong>{status?.enabled ? "Sí" : "No"}</strong>
          <span>Habilitado</span>
        </div>
        <div>
          <strong>{status?.configured ? "OK" : "KO"}</strong>
          <span>Configuración</span>
        </div>
        <div>
          <strong>{status?.token_ok ? "OK" : "KO"}</strong>
          <span>Token</span>
        </div>
        <div>
          <strong>{enabledCount}</strong>
          <span>Modelos activos</span>
        </div>
        <div>
          <strong>{totalCount}</strong>
          <span>Total modelos</span>
        </div>
      </div>

      <div className="directory-meta-row">
        <span>{isLoading ? "Consultando..." : "Lectura sin escritura ni DAX libre"}</span>
        <span>{loadedAt ? `Actualizado ${formatDate(loadedAt)}` : "Sin actualización reciente"}</span>
      </div>

      <div className="powerbi-workspace-grid" aria-label="Consulta y resultado Power BI">
        <section className="structured-block powerbi-query-panel">
          <div className="structured-status-row">
            <span className="status-badge green">Pregunta</span>
            <p>Modelo semántico administracion_ventas · router controlado</p>
          </div>
          <textarea
            className="form-input powerbi-question-input"
            rows={4}
            value={askQuestion || ""}
            onChange={(event) => {
              const nextQuestion = event.target.value;
              onAskQuestionChange(nextQuestion);
              onAskLabChange((current) => ({
                ...current,
                question: nextQuestion,
                interpretation: null,
                error: "",
                statusMessage: "",
                preview: null,
                execution: null
              }));
            }}
            placeholder="Pregunta al modelo: ventas por cliente, unidades por producto, ventas por mes..."
          />
          <div className="report-list-actions powerbi-query-actions">
            <button
              type="button"
              className="action-button secondary-action"
              onClick={() => onInterpretAskLab()}
              disabled={isLoading}
            >
              Interpretar
            </button>
            <button
              type="button"
              className="action-button secondary-action"
              onClick={() => onPreviewAskLab()}
              disabled={isLoading}
            >
              Previsualizar
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => onExecuteAskLab()}
              disabled={isLoading}
            >
              Consultar
            </button>
          </div>
          {Array.isArray(capabilityExamples) && capabilityExamples.length ? (
            <div className="powerbi-quick-examples">
              {capabilityExamples
                .filter((example) => example.supported)
                .slice(0, 6)
                .map((example) => (
                  <button
                    key={example.question}
                    type="button"
                    className="action-button secondary-action"
                    onClick={() => applyPowerBiAskLabExample(example.question)}
                  >
                    {example.question}
                  </button>
                ))}
            </div>
          ) : null}
          {askLab?.error ? <div className="structured-warning">{askLab.error}</div> : null}
          <PowerBiAskInterpretationDetails
            interpretation={askLab?.interpretation}
            payload={askLab?.preview || askLab?.execution || null}
          />
        </section>

        <section className="structured-block powerbi-main-result-panel">
          <div className="structured-status-row">
            <span className={`status-badge ${latestVisualResult ? "green" : latestPowerBiResult?.rejectionReason ? "yellow" : "unknown"}`}>
              {latestPowerBiResultSource === "voice" ? "Resultado por voz" : "Resultado"}
            </span>
            <p>
              {latestPowerBiQuestion || "Sin consulta ejecutada todavía"}
              {latestPowerBiTimestamp ? ` · ${formatDate(latestPowerBiTimestamp)}` : ""}
            </p>
          </div>
          {latestPowerBiResult?.spokenResponse ? (
            <p className="structured-summary">{latestPowerBiResult.spokenResponse}</p>
          ) : null}
          {latestVisualResult ? (
            <PowerBiChatResultView result={latestVisualResult} expanded onExpand={onOpenExpandedResult || (() => {})} />
          ) : latestPowerBiResult?.rejectionReason ? (
            <div className="structured-warning">{latestPowerBiResult.rejectionReason}</div>
          ) : (
            <p className="empty-history">
              Ejecuta una pregunta o usa la voz para dejar aquí el último resultado Power BI.
            </p>
          )}
        </section>

        <section className="structured-block powerbi-history-panel">
          <div className="structured-status-row">
            <span className="status-badge unknown">Historial corto</span>
            <p>Últimas consultas Power BI de texto, voz o drawer.</p>
          </div>
          {recentPowerBiHistory.length ? (
            <div className="powerbi-history-list">
              {recentPowerBiHistory.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="powerbi-history-entry"
                  onClick={() => {
                    if (entry.result) {
                      onOpenExpandedResult?.(entry.result);
                    }
                  }}
                >
                  <strong>{entry.content || "Consulta Power BI"}</strong>
                  <span>{entry.createdAt ? formatDate(entry.createdAt) : "Sin fecha"}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-history">Sin historial Power BI todavía.</p>
          )}
        </section>
      </div>

      <div className="report-list">
        {configuredModels.length === 0 ? (
          <p className="empty-history">No hay modelos Power BI configurados.</p>
        ) : (
          configuredModels.map((model) => {
            const snapshot = snapshots?.[model.key] || {};
            const snapshotStatus = snapshot.status || {};
            const dataset = snapshot.dataset || {};
            const reports = Array.isArray(snapshot.reports?.reports) ? snapshot.reports.reports : [];
            const schema = snapshot.schema || {};
            const testQuery = snapshot.testQuery || {};
            const catalog = snapshot.catalog || {};
            const businessCatalog = snapshot.businessCatalog || {};
            const importStatus = snapshot.importStatus || {};
            const businessDictionary = snapshot.businessDictionary || {};
            const businessDictionaryQuality = snapshot.businessDictionaryQuality || {};
            const businessDictionaryReview = snapshot.businessDictionaryReview || {};
            const daxLabStatus = snapshot.daxLabStatus || {};
            const reportNames = reports.slice(0, 3).map((item) => item.name).filter(Boolean);
            const catalogSummary = catalog.summary || {};
            const catalogWarnings = Array.isArray(catalog.warnings) ? catalog.warnings : [];
            const sourceLabel = powerBiCatalogSourceLabel(catalog.source || businessCatalog.source || "rest");
            const hasImportedCatalog = Boolean(businessCatalog.catalogAvailable);
            const hasBusinessDictionary = Boolean(businessDictionary?.modelKey);
            const dictionarySummary = businessDictionary.summary || businessDictionaryQuality.summary || {};
            const dictionaryStatus = businessDictionaryQuality.status || businessDictionary.status || "needs_review";
            const dictionaryStatusClass =
              dictionaryStatus === "ready"
                ? "green"
                : dictionaryStatus === "incomplete"
                ? "yellow"
                : dictionaryStatus === "needs_review"
                ? "red"
                : "unknown";
            const dictionaryScore = Number(businessDictionaryQuality.score || businessDictionary.score || 0);
            const reviewScore = Number(businessDictionaryReview.score || 0);
            const reviewStatus = String(businessDictionaryReview.review?.status || "").trim() || null;
            const reviewSummary = businessDictionaryReview.summary || {};
            const dictionaryIssues = Array.isArray(
              businessDictionaryQuality.issues || businessDictionary.issues
            )
              ? businessDictionaryQuality.issues || businessDictionary.issues
              : [];
            const dictionaryWarnings = Array.isArray(businessDictionary.warnings)
              ? businessDictionary.warnings
              : [];
            const isAdvancedModel = isPowerBiAdvancedModelKey(model.key);

            return (
              <article key={model.key} className="report-list-entry">
                <div className="report-detail-header">
                  <div>
                    <span className="report-list-meta">
                      {model.area} · {model.key}
                    </span>
                    <h3>{model.displayName}</h3>
                  </div>
                  <span className={`readonly-badge ${snapshotStatus.ok ? "sent" : "failed"}`}>
                    {snapshotStatus.ok ? "OK" : "KO"}
                  </span>
                </div>

                <div className="communication-detail-grid">
                  <div>
                    <span>Estado</span>
                    <p>{snapshotStatus.ok ? "Conectado" : snapshotStatus.error || "Pendiente"}</p>
                  </div>
                  <div>
                    <span>Dataset</span>
                    <p>{dataset.name || dataset.id || "Sin datos"}</p>
                  </div>
                  <div>
                    <span>Reports detectados</span>
                    <p>{reports.length}</p>
                  </div>
                  <div>
                    <span>Test query</span>
                    <p>
                      {testQuery.ok
                        ? `OK · ${testQuery.rows || 0} fila(s)`
                        : testQuery.error || "Sin ejecutar"}
                    </p>
                  </div>
                  <div>
                    <span>Esquema</span>
                    <p>
                      {schema.schemaAvailable
                        ? "Disponible"
                        : schema.reason || "REST metadata is limited; XMLA or another metadata path required"}
                    </p>
                  </div>
                  <div>
                    <span>Catálogo XMLA</span>
                    <p>
                      {catalog.catalogAvailable
                        ? `OK · ${catalogSummary.tables || 0} tablas, ${catalogSummary.columns || 0} columnas`
                        : catalog.reason || catalog.error || "Pendiente"}
                    </p>
                  </div>
                  <div>
                    <span>Origen catálogo</span>
                    <p>{sourceLabel}</p>
                  </div>
                  <div>
                    <span>XMLA</span>
                    <p>{catalog.xmlaAvailable ? "Disponible" : "No disponible"}</p>
                  </div>
                  <div>
                    <span>Catálogo importado</span>
                    <p>{hasImportedCatalog ? "Sí" : "No"}</p>
                  </div>
                  <div>
                    <span>Medidas</span>
                    <p>{catalogSummary.measures || 0}</p>
                  </div>
                  <div>
                    <span>Relaciones</span>
                    <p>{catalogSummary.relationships || 0}</p>
                  </div>
                  <div>
                    <span>Último catálogo</span>
                    <p>{catalog.generatedAt ? formatDate(catalog.generatedAt) : "Sin generar"}</p>
                  </div>
                  <div>
                    <span>Última importación</span>
                    <p>{importStatus.imported_at ? formatDate(importStatus.imported_at) : "Sin importar"}</p>
                  </div>
                  <div>
                    <span>Ámbito</span>
                    <p>{model.area}</p>
                  </div>
                </div>

                {catalogWarnings.length ? (
                  <div className="structured-warning">
                    {catalogWarnings.join(" · ")}
                  </div>
                ) : null}
                {!hasImportedCatalog ? (
                  <div className="structured-warning">
                    No hay catálogo importado. Puedes usar la ruta asistida con archivos PBIP/TMDL en
                    {" "}
                    <code>{`data/powerbi-catalog-imports/${model.key}/`}</code>
                  </div>
                ) : null}

                <div className="empty-history">
                  {reportNames.length
                    ? `Informes detectados: ${reportNames.join(" · ")}`
                    : "No hay informes detectados o no se pudo leer el workspace."}
                </div>

                {dataset.isEffectiveIdentityRequired || dataset.isEffectiveIdentityRolesRequired ? (
                  <div className="structured-warning">
                    Este dataset puede requerir identidad efectiva o roles; Execute Queries con service
                    principal puede quedar limitado si el modelo usa RLS o SSO.
                  </div>
                ) : null}

                {isAdvancedModel ? (
                  <div className="structured-block">
                    <div className="structured-status-row">
                      <span className={`status-badge ${dictionaryStatusClass}`}>
                        {dictionaryStatus === "ready"
                          ? "listo"
                          : dictionaryStatus === "incomplete"
                          ? "incompleto"
                          : "necesita revisión"}
                      </span>
                      <p>
                        {hasBusinessDictionary
                          ? `${businessDictionary.draft ? "Borrador" : "Diccionario guardado"} · Score ${dictionaryScore}`
                          : "Sin diccionario guardado todavía. Genera el borrador piloto desde el catálogo real."}
                      </p>
                    </div>

                    <div className="communications-summary" aria-label="Resumen diccionario de negocio">
                      <div>
                        <strong>{dictionarySummary.entities || 0}</strong>
                        <span>Entidades</span>
                      </div>
                      <div>
                        <strong>{dictionarySummary.metrics || 0}</strong>
                        <span>Métricas</span>
                      </div>
                      <div>
                        <strong>{dictionarySummary.dimensions || 0}</strong>
                        <span>Dimensiones</span>
                      </div>
                      <div>
                        <strong>{dictionarySummary.dates || 0}</strong>
                        <span>Fechas</span>
                      </div>
                      <div>
                        <strong>{dictionarySummary.synonyms || 0}</strong>
                        <span>Sinónimos</span>
                      </div>
                      <div>
                        <strong>{dictionarySummary.warnings || 0}</strong>
                        <span>Warnings</span>
                      </div>
                    </div>

                    {dictionaryWarnings.length ? (
                      <div className="structured-warning">
                        {dictionaryWarnings.slice(0, 4).join(" · ")}
                      </div>
                    ) : null}

                    {businessDictionaryReview?.modelKey ? (
                      <div className="structured-block">
                        <div className="structured-status-row">
                          <span
                            className={`status-badge ${
                              reviewScore >= 80 ? "green" : reviewScore >= 60 ? "yellow" : "red"
                            }`}
                          >
                            {reviewStatus || "review"}
                          </span>
                          <p>
                            {`Revisión asistida · score ${reviewScore} · ${reviewSummary.officialMeasures || 0} medidas oficiales`}
                          </p>
                        </div>

                        <div className="communications-summary" aria-label="Resumen revisión diccionario">
                          <div>
                            <strong>
                              {Array.isArray(businessDictionaryReview.officialMeasures)
                                ? businessDictionaryReview.officialMeasures.length
                                : 0}
                            </strong>
                            <span>Medidas oficiales</span>
                          </div>
                          <div>
                            <strong>
                              {Array.isArray(businessDictionaryReview.aggregationMetrics)
                                ? businessDictionaryReview.aggregationMetrics.length
                                : 0}
                            </strong>
                            <span>Métricas agregadas</span>
                          </div>
                          <div>
                            <strong>
                              {Array.isArray(businessDictionaryReview.missingDescriptions)
                                ? businessDictionaryReview.missingDescriptions.length
                                : 0}
                            </strong>
                            <span>Sin descripción</span>
                          </div>
                          <div>
                            <strong>
                              {Array.isArray(businessDictionaryReview.unclassifiedNumericColumns)
                                ? businessDictionaryReview.unclassifiedNumericColumns.length
                                : 0}
                            </strong>
                            <span>Numéricas sin clasificar</span>
                          </div>
                          <div>
                            <strong>
                              {Array.isArray(businessDictionaryReview.dateCandidates)
                                ? businessDictionaryReview.dateCandidates.length
                                : 0}
                            </strong>
                            <span>Fechas candidatas</span>
                          </div>
                          <div>
                            <strong>
                              {Array.isArray(businessDictionaryReview.hiddenObjects)
                                ? businessDictionaryReview.hiddenObjects.length
                                : 0}
                            </strong>
                            <span>Ocultos/técnicos</span>
                          </div>
                        </div>

                        {Array.isArray(businessDictionaryReview.recommendations) &&
                        businessDictionaryReview.recommendations.length ? (
                          <div className="structured-warning">
                            {businessDictionaryReview.recommendations.slice(0, 4).join(" · ")}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {isAdvancedModel && capabilities?.ok ? (
                      <div className="structured-block">
                        <div className="structured-status-row powerbi-capabilities-header">
                          <div>
                            <span className="status-badge green">Consultas soportadas</span>
                            <p>
                              Matriz formal de capacidades para {capabilities.displayName || model.displayName}.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => setShowPowerBiCapabilities((current) => !current)}
                          >
                            {showPowerBiCapabilities ? "Ocultar consultas soportadas" : "Ver consultas soportadas"}
                          </button>
                        </div>

                        <div className="communications-summary" aria-label="Resumen capacidades Power BI">
                          <div>
                            <strong>{capabilityMetrics.length}</strong>
                            <span>Métricas</span>
                          </div>
                          <div>
                            <strong>{capabilityDimensions.length}</strong>
                            <span>Dimensiones</span>
                          </div>
                          <div>
                            <strong>{capabilityIntents.length}</strong>
                            <span>Intents</span>
                          </div>
                          <div>
                            <strong>{capabilityTimeRanges.length}</strong>
                            <span>Time ranges</span>
                          </div>
                          <div>
                            <strong>{capabilities.limits?.topNMax || 0}</strong>
                            <span>topN máximo</span>
                          </div>
                          <div>
                            <strong>{capabilities.limits?.rowLimitMax || 0}</strong>
                            <span>rowLimit máximo</span>
                          </div>
                        </div>

                        {!showPowerBiCapabilities ? (
                          <div className="structured-note">
                            Resumen compacto. Expande para ver ejemplos, consultas soportadas y rechazos.
                          </div>
                        ) : (
                          <>
                            <div className="report-preview">
                              <h4>Métricas disponibles</h4>
                              <p>
                                {capabilityMetrics
                                  .map((item) => item.label || item.name)
                                  .filter(Boolean)
                                  .join(" · ") || "No hay métricas soportadas."}
                              </p>
                            </div>

                            <div className="report-preview">
                              <h4>Dimensiones disponibles</h4>
                              <p>
                                {capabilityDimensions
                                  .map((item) => item.label || item.name)
                                  .filter(Boolean)
                                  .join(" · ") || "No hay dimensiones soportadas."}
                              </p>
                            </div>

                            {capabilityQuestions.length ? (
                              <div className="report-preview">
                                <h4>Consultas soportadas</h4>
                                {capabilityQuestions.map((group) => (
                                  <div key={`${group.intent}-${group.metric}-${group.dimension || "total"}`}>
                                    <p>
                                      <strong>{group.intent}</strong>
                                      {group.metric ? ` · ${group.metric}` : ""}
                                      {group.dimension ? ` · ${group.dimension}` : ""}
                                    </p>
                                    <div className="report-list-actions">
                                      {Array.isArray(group.questions)
                                        ? group.questions.slice(0, 3).map((question) => (
                                            <button
                                              key={question}
                                              type="button"
                                              className="action-button secondary-action"
                                              onClick={() => applyPowerBiAskLabExample(question)}
                                            >
                                              {question}
                                            </button>
                                          ))
                                        : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {capabilityExamples.length ? (
                              <div className="report-preview">
                                <h4>Ejemplos rápidos</h4>
                                <div className="report-list-actions">
                                  {capabilityExamples.slice(0, 8).map((example) => (
                                    <button
                                      key={example.question}
                                      type="button"
                                      className={`action-button secondary-action ${
                                        example.supported ? "" : "disabled"
                                      }`}
                                      onClick={() =>
                                        example.supported ? applyPowerBiAskLabExample(example.question) : null
                                      }
                                      disabled={!example.supported}
                                    >
                                      {example.question}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {capabilityRejected.length ? (
                              <div className="structured-warning">
                                No soportado todavía:{" "}
                                {capabilityRejected.slice(0, 6).map((item) => item.question).join(" · ")}
                              </div>
                            ) : null}

                            {capabilities.warnings?.length ? (
                              <div className="structured-warning">{capabilities.warnings.join(" · ")}</div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}

                    {dictionaryIssues.length ? (
                      <div className="structured-warning">
                        Calidad: {dictionaryIssues.slice(0, 4).join(" · ")}
                      </div>
                    ) : null}

                    {daxLabStatus?.ok || isAdvancedModel ? (
                      <div className="structured-block">
                        <div className="structured-status-row">
                          <span className={`status-badge ${daxLabStatus?.ok ? "green" : "yellow"}`}>
                            DAX Lab
                          </span>
                          <p>
                            Laboratorio interno controlado para `administracion_ventas`. Sin chat libre ni DAX arbitrario.
                          </p>
                        </div>

                        <div className="communication-detail-grid">
                          <div>
                            <span>Intent</span>
                            <select
                              className="form-input"
                              value={daxLab?.intent || "top_dimension_by_metric"}
                              onChange={(event) =>
                                onDaxLabChange((current) => ({
                                  ...current,
                                  intent: event.target.value
                                }))
                              }
                            >
                              {(daxLabStatus?.allowedIntents?.length
                                ? daxLabStatus.allowedIntents
                                : ["total_metric", "metric_by_dimension", "top_dimension_by_metric", "metric_by_month"]
                              ).map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <span>Métrica</span>
                            <select
                              className="form-input"
                              value={daxLab?.metric || daxLabStatus?.defaultMetric || "ventas_eur"}
                              onChange={(event) =>
                                onDaxLabChange((current) => ({
                                  ...current,
                                  metric: event.target.value
                                }))
                              }
                            >
                              {(daxLabStatus?.allowedMetrics?.length
                                ? daxLabStatus.allowedMetrics
                                : ["ventas_eur", "unidades"]
                              ).map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <span>Dimensión</span>
                            <select
                              className="form-input"
                              value={daxLab?.dimension || daxLabStatus?.defaultDimension || "cliente"}
                              onChange={(event) =>
                                onDaxLabChange((current) => ({
                                  ...current,
                                  dimension: event.target.value
                                }))
                              }
                            >
                              {(daxLabStatus?.allowedDimensions?.length
                                ? daxLabStatus.allowedDimensions
                                : [
                                    "cliente",
                                    "articulo",
                                    "producto",
                                    "familia",
                                    "representante",
                                    "tipo",
                                    "especie"
                                  ]
                              ).map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <span>Time range</span>
                            <select
                              className="form-input"
                              value={daxLab?.timeRange || daxLabStatus?.defaultTimeRange || "all_time"}
                              onChange={(event) =>
                                onDaxLabChange((current) => ({
                                  ...current,
                                  timeRange: event.target.value
                                }))
                              }
                            >
                              {(daxLabStatus?.allowedTimeRanges?.length
                                ? daxLabStatus.allowedTimeRanges
                                : ["all_time"]
                              ).map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <span>topN</span>
                            <input
                              className="form-input"
                              type="number"
                              min={1}
                              max={20}
                              value={daxLab?.topN || 10}
                              onChange={(event) =>
                                onDaxLabChange((current) => ({
                                  ...current,
                                  topN: Number(event.target.value || 10)
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className="report-list-actions">
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => onBuildDaxLab()}
                            disabled={isLoading}
                          >
                            Generar DAX
                          </button>
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => onValidateDaxLab()}
                            disabled={isLoading}
                          >
                            Validar
                          </button>
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => onExecuteDaxLab()}
                            disabled={isLoading}
                          >
                            Ejecutar en laboratorio
                          </button>
                        </div>

                        <div className="structured-warning">
                          Laboratorio interno controlado. No hay chat libre ni DAX arbitrario de usuario.
                        </div>

                        {daxLab?.generatedDax ? (
                          <div className="report-preview">
                            <h4>DAX generado</h4>
                            <pre>{daxLab.generatedDax}</pre>
                          </div>
                        ) : null}

                    {daxLab?.validation ? (
                          <div className="structured-block">
                            <div className="structured-status-row">
                              <span className={`status-badge ${daxLab.validation.ok ? "green" : "red"}`}>
                                {daxLab.validation.ok ? "validation OK" : "validation KO"}
                              </span>
                              <p>{daxLab.statusMessage || "Validación del DAX controlado."}</p>
                            </div>
                            {Array.isArray(daxLab.validation.issues) && daxLab.validation.issues.length ? (
                              <div className="structured-warning">
                                {daxLab.validation.issues.join(" · ")}
                              </div>
                            ) : null}
                            {Array.isArray(daxLab.validation.warnings) && daxLab.validation.warnings.length ? (
                              <div className="structured-warning">
                                {daxLab.validation.warnings.join(" · ")}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {daxLab?.execution ? (
                          <div className="structured-block">
                            <div className="structured-status-row">
                              <span className={`status-badge ${daxLab.execution.ok ? "green" : "red"}`}>
                                {daxLab.execution.ok ? "execute OK" : "execute KO"}
                              </span>
                              <p>
                                {`Filas: ${daxLab.execution.rowCount || 0} · truncado: ${daxLab.execution.truncated ? "sí" : "no"}`}
                              </p>
                            </div>
                            <div className="communications-summary" aria-label="Resumen DAX Lab">
                              <div>
                                <strong>{daxLab.execution.rowCount || 0}</strong>
                                <span>Filas</span>
                              </div>
                              <div>
                                <strong>{daxLab.execution.rowLimit || 0}</strong>
                                <span>Límite</span>
                              </div>
                              <div>
                                <strong>{daxLab.execution.truncated ? "Sí" : "No"}</strong>
                                <span>Truncado</span>
                              </div>
                            </div>
                            {Array.isArray(daxLab.execution.rows) && daxLab.execution.rows.length ? (
                              <div className="report-preview">
                                <h4>Resultado limitado</h4>
                                <pre>{JSON.stringify(daxLab.execution.rows.slice(0, 5), null, 2)}</pre>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {isAdvancedModel ? (
                      <div className="structured-block">
                        <div className="structured-status-row">
                          <span className="status-badge green">Ask Lab</span>
                          <p>
                            Laboratorio limitado. No es chat libre Power BI. Solo ventas y unidades con dimensiones permitidas.
                          </p>
                        </div>

                        <div className="form-field">
                          <span>Pregunta natural</span>
                          <textarea
                            className="form-input"
                            rows={3}
                            value={askQuestion || ""}
                            onChange={(event) => {
                              const nextQuestion = event.target.value;
                              onAskQuestionChange(nextQuestion);
                              onAskLabChange((current) => ({
                                ...current,
                                question: nextQuestion,
                                interpretation: null,
                                error: "",
                                statusMessage: "",
                                preview: null,
                                execution: null
                              }));
                            }}
                            placeholder="Top 10 clientes por ventas"
                          />
                        </div>

                        <div className="report-list-actions">
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => onInterpretAskLab()}
                            disabled={isLoading}
                          >
                            Interpretar
                          </button>
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => onPreviewAskLab()}
                            disabled={isLoading}
                          >
                            Previsualizar consulta
                          </button>
                          <button
                            type="button"
                            className="action-button secondary-action"
                            onClick={() => onExecuteAskLab()}
                            disabled={isLoading}
                          >
                            Ejecutar en laboratorio
                          </button>
                        </div>

                        {askLab?.error ? (
                          <div className="structured-warning">{askLab.error}</div>
                        ) : null}

                        {askLab?.interpretation ? (
                          <div className="communications-summary" aria-label="Resumen interpretación Power BI Ask">
                            <div>
                              <strong>{askLab.interpretation.confidence ?? 0}</strong>
                              <span>Confidence</span>
                            </div>
                            <div>
                              <strong>{askLab.interpretation.intent || "—"}</strong>
                              <span>Intent</span>
                            </div>
                            <div>
                              <strong>{askLab.interpretation.metric || "—"}</strong>
                              <span>Métrica</span>
                            </div>
                            <div>
                              <strong>{askLab.interpretation.dimension || "—"}</strong>
                              <span>Dimensión</span>
                            </div>
                            <div>
                              <strong>{askLab.interpretation.topN || 0}</strong>
                              <span>topN</span>
                            </div>
                            <div>
                              <strong>{askLab.interpretation.needsClarification ? "Sí" : "No"}</strong>
                              <span>Aclara</span>
                            </div>
                          </div>
                        ) : null}

                        {askLab?.interpretation?.clarificationQuestion ? (
                          <div className="structured-warning">
                            {askLab.interpretation.clarificationQuestion}
                          </div>
                        ) : null}

                        <PowerBiAskInterpretationDetails
                          interpretation={askLab?.interpretation}
                          payload={askLab?.preview || askLab?.execution || null}
                        />

                        {Array.isArray(askLab?.interpretation?.warnings) &&
                        askLab.interpretation.warnings.length ? (
                          <div className="structured-warning">
                            {askLab.interpretation.warnings.join(" · ")}
                          </div>
                        ) : null}

                        {Array.isArray(askLab?.interpretation?.matchedTerms) &&
                        askLab.interpretation.matchedTerms.length ? (
                          <div className="empty-history">
                            Términos detectados: {askLab.interpretation.matchedTerms.join(" · ")}
                          </div>
                        ) : null}

                        {askLab?.preview?.dax ? (
                          <div className="report-preview">
                            <h4>DAX previsualizado</h4>
                            <pre>{askLab.preview.dax}</pre>
                          </div>
                        ) : null}

                        {askLab?.preview?.validation ? (
                          <div className="structured-block">
                            <div className="structured-status-row">
                              <span className={`status-badge ${askLab.preview.validation.ok ? "green" : "red"}`}>
                                {askLab.preview.validation.ok ? "preview OK" : "preview KO"}
                              </span>
                              <p>{askLab.preview.error || "Validación de la consulta previsualizada."}</p>
                            </div>
                            {Array.isArray(askLab.preview.validation.issues) &&
                            askLab.preview.validation.issues.length ? (
                              <div className="structured-warning">
                                {askLab.preview.validation.issues.join(" · ")}
                              </div>
                            ) : null}
                            {Array.isArray(askLab.preview.validation.warnings) &&
                            askLab.preview.validation.warnings.length ? (
                              <div className="structured-warning">
                                {askLab.preview.validation.warnings.join(" · ")}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {askLab?.execution ? (
                          <div className="structured-block">
                            <div className="structured-status-row">
                              <span className={`status-badge ${askLab.execution.ok ? "green" : "red"}`}>
                                {askLab.execution.ok ? "execute OK" : "execute KO"}
                              </span>
                              <p>{askLab.execution.naturalSummary || askLab.statusMessage || "Resultado del laboratorio."}</p>
                            </div>
                            <div className="communications-summary" aria-label="Resumen Power BI Ask">
                              <div>
                                <strong>{askLab.execution?.execution?.rowCount || 0}</strong>
                                <span>Filas</span>
                              </div>
                              <div>
                                <strong>{askLab.execution?.execution?.rowLimit || 0}</strong>
                                <span>Límite</span>
                              </div>
                              <div>
                                <strong>{askLab.execution?.execution?.truncated ? "Sí" : "No"}</strong>
                                <span>Truncado</span>
                              </div>
                            </div>
                            {Array.isArray(askLab.execution?.execution?.rows) &&
                            askLab.execution.execution.rows.length ? (
                              <div className="report-preview">
                                <h4>Resultado limitado</h4>
                                <pre>{JSON.stringify(askLab.execution.execution.rows.slice(0, 5), null, 2)}</pre>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="structured-warning">
                        Solo discovery disponible para este modelo. El catálogo avanzado, el diccionario, DAX Lab y Ask Lab quedan restringidos a administracion_ventas.
                      </div>
                    )}

                    {isAdvancedModel ? (
                      <div className="report-list-actions">
                        <button
                          type="button"
                          className="action-button secondary-action"
                          onClick={() => onGenerateBusinessDictionary(model.key)}
                          disabled={isLoading}
                        >
                          Generar borrador de diccionario
                        </button>
                        <button
                          type="button"
                          className="action-button secondary-action"
                          onClick={() => onReviewBusinessDictionary(model.key)}
                          disabled={isLoading}
                        >
                          Revisar diccionario
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="report-list-actions">
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() => onRefreshModel(model.key)}
                    disabled={isLoading}
                  >
                    Actualizar modelo
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() => onRefreshCatalog(model.key)}
                    disabled={isLoading}
                  >
                    Actualizar catálogo
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() => onImportCatalog(model.key)}
                    disabled={isLoading}
                  >
                    Importar catálogo
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function PowerBiAskInterpretationDetails({ interpretation, payload }) {
  if (!interpretation) {
    return null;
  }

  const metricLabel = interpretation.metric === "unidades" ? "Unidades" : "Ventas";
  const periodLabel = interpretation.dateRange?.label || interpretation.timeRange || "Sin filtro de fecha";
  const dimensions = Array.isArray(interpretation.dimensions) && interpretation.dimensions.length
    ? interpretation.dimensions
    : interpretation.dimension
      ? [interpretation.dimension]
      : [];
  const filters = Array.isArray(interpretation.filters) ? interpretation.filters : [];
  const comparisonLabel = interpretation.comparison?.label || "";
  const rankingLabel = interpretation.ranking?.label || "";
  const logicalPage = payload?.logicalPage || interpretation.logicalPage || interpretation.plan?.logicalPage || "";
  const dimensionField = payload?.dimensionField || payload?.dimensionValidation?.candidate
    ? payload?.dimensionField ||
      `${payload.dimensionValidation.candidate.table || "tabla"}[${payload.dimensionValidation.candidate.column || "columna"}]`
    : "";
  const dimensionStatus = payload?.dimensionValidation?.status || payload?.dimensionValidation?.candidate?.validationStatus || "";
  const expectedResult =
    interpretation.intent === "total_metric"
      ? "total"
      : interpretation.intent === "metric_by_month"
        ? "serie mensual"
        : interpretation.intent === "metric_by_year"
          ? "serie anual"
          : interpretation.intent === "comparison_metric"
            ? "comparativa"
            : rankingLabel
              ? "ranking"
              : dimensions.length
                ? "tabla agrupada"
                : "resultado";

  return (
    <div className="report-preview powerbi-interpretation-card" aria-label="Interpretación Power BI">
      <h4>Interpretación semántica</h4>
      <div className="communication-detail-grid">
        {logicalPage ? (
          <div>
            <span>Página lógica</span>
            <strong>{logicalPage}</strong>
          </div>
        ) : null}
        <div>
          <span>Métrica</span>
          <strong>{metricLabel}</strong>
        </div>
        <div>
          <span>Periodo</span>
          <strong>{periodLabel}</strong>
        </div>
        <div>
          <span>Agrupación</span>
          <strong>{dimensions.length ? dimensions.join(", ") : "ninguna"}</strong>
        </div>
        <div>
          <span>Resultado esperado</span>
          <strong>{expectedResult}</strong>
        </div>
        <div>
          <span>Ranking</span>
          <strong>{rankingLabel || "no"}</strong>
        </div>
        {interpretation.ranking?.order ? (
          <div>
            <span>Orden</span>
            <strong>{interpretation.ranking.order === "asc" ? "ascendente" : "descendente"}</strong>
          </div>
        ) : null}
        <div>
          <span>Fecha usada</span>
          <strong>{payload?.dateField || "fecha principal del modelo"}</strong>
        </div>
        {dimensionField ? (
          <div>
            <span>Agrupación usada</span>
            <strong>{dimensionField}</strong>
          </div>
        ) : null}
        {dimensionStatus ? (
          <div>
            <span>Validación dimensión</span>
            <strong>{dimensionStatus === "metadata_only" ? "pendiente de ejecución" : dimensionStatus}</strong>
          </div>
        ) : null}
      </div>
      {comparisonLabel ? (
        <div className="structured-note">Comparación detectada: {comparisonLabel}</div>
      ) : null}
      {filters.length ? (
        <div className="structured-note">
          Filtros:{" "}
          {filters
            .map((filter) => `${filter.dimension || "campo"} ${filter.operator || "="} ${filter.value || ""}`.trim())
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function formatDashboardTimestamp(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Fecha no válida";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function getDashboardFreshness(dashboard) {
  if (!dashboard?.updated_at) {
    return {
      status: "gray",
      label: "Sin datos",
      detail: "Todavía no hay actualización registrada."
    };
  }

  const updatedAt = new Date(dashboard.updated_at);
  if (Number.isNaN(updatedAt.getTime())) {
    return {
      status: "gray",
      label: "Fecha no válida",
      detail: "El dashboard no devolvió una fecha interpretable."
    };
  }

  const missingReports = dashboard.missing_reports || [];
  const today = new Date();
  const isToday = updatedAt.toDateString() === today.toDateString();

  if (missingReports.length) {
    return {
      status: "yellow",
      label: isToday ? "Actualizado hoy con avisos" : "Desactualizado con avisos",
      detail: `Faltan informes: ${missingReports.join(", ")}.`
    };
  }

  return {
    status: isToday ? "green" : "yellow",
    label: isToday ? "Actualizado hoy" : "Desactualizado",
    detail: `Última actualización: ${formatDashboardTimestamp(dashboard.updated_at)}.`
  };
}

function DashboardUpdateIndicator({ dashboard }) {
  const freshness = getDashboardFreshness(dashboard);

  return (
    <section className={`update-indicator ${freshness.status}`} aria-label="Última actualización">
      <div>
        <p className="eyebrow">Última actualización</p>
        <h3>{freshness.label}</h3>
      </div>
      <p>{freshness.detail}</p>
    </section>
  );
}

function isReportToday(report) {
  if (!report?.created_at) {
    return false;
  }

  const date = new Date(report.created_at);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.toDateString() === new Date().toDateString();
}

function DailyReportStatus({
  dashboard,
  isRunningDailyReport,
  onRunDailyReport,
  onOpenReport
}) {
  const dailyReport = dashboard?.latest_reports?.daily_summary || null;
  const matrixReport = dashboard?.latest_reports?.correlation_matrix || null;
  const generatedToday = isReportToday(dailyReport);
  const status = generatedToday ? "green" : "yellow";

  return (
    <section className={`daily-report-status ${status}`} aria-label="Informe diario">
      <div>
        <p className="eyebrow">Informe diario automático</p>
        <h3>{generatedToday ? "Informe de hoy generado" : "Informe de hoy pendiente"}</h3>
        <p>
          {dailyReport
            ? `Último informe diario: ${formatDashboardTimestamp(dailyReport.created_at)}.`
            : "Todavía no hay informe diario guardado."}
        </p>
      </div>
      <div className="daily-report-actions">
        <button
          type="button"
          className="action-button primary-action"
          onClick={onRunDailyReport}
          disabled={isRunningDailyReport}
        >
          Generar informe diario ahora
        </button>
        <button
          type="button"
          className="action-button secondary-action"
          onClick={() => dailyReport?.id && onOpenReport(dailyReport.id)}
          disabled={!dailyReport?.id}
        >
          Abrir último informe diario
        </button>
        <button
          type="button"
          className="action-button secondary-action"
          onClick={() => matrixReport?.id && onOpenReport(matrixReport.id)}
          disabled={!matrixReport?.id}
        >
          Abrir última matriz
        </button>
      </div>
    </section>
  );
}

function PresentationToggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      className={`presentation-toggle ${enabled ? "active" : ""}`}
      onClick={onToggle}
      aria-pressed={enabled}
    >
      <span>{enabled ? "Modo presentación" : "Modo operativo"}</span>
      <strong>{enabled ? "Activado" : "Normal"}</strong>
    </button>
  );
}

function RecommendedUsage({
  disabled,
  isUpdatingDashboard,
  isRunningDailyReport,
  onGenerateStructured,
  onRunDailyReport,
  onUpdateDashboard
}) {
  return (
    <section className="usage-panel" aria-label="Uso recomendado">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Uso recomendado</p>
          <h3>Rutina diaria</h3>
        </div>
      </div>

      <div className="usage-actions">
        <button
          type="button"
          className="action-button primary-action"
          onClick={onRunDailyReport}
          disabled={disabled || isRunningDailyReport}
        >
          Generar informe diario ahora
        </button>
        <button
          type="button"
          className="action-button"
          onClick={() => onGenerateStructured("daily_summary")}
          disabled={disabled}
        >
          Informe diario estructurado
        </button>
        <button
          type="button"
          className="action-button"
          onClick={() => onGenerateStructured("correlation_matrix")}
          disabled={disabled}
        >
          Matriz de correlación
        </button>
        <button
          type="button"
          className="action-button"
          onClick={() => onGenerateStructured("risks")}
          disabled={disabled}
        >
          Riesgos críticos
        </button>
        <button
          type="button"
          className="action-button"
          onClick={() => onGenerateStructured("monitoring_gaps")}
          disabled={disabled}
        >
          Huecos de monitorización
        </button>
        <button
          type="button"
          className="action-button secondary-action"
          onClick={onUpdateDashboard}
          disabled={disabled || isUpdatingDashboard}
        >
          Actualizar dashboard
        </button>
      </div>
    </section>
  );
}

function VisualGuide() {
  return (
    <section className="guide-panel" aria-label="Guía rápida">
      <div>
        <span>Voz</span>
        <p>Pregunta por voz: ¿Qué es lo más urgente hoy?</p>
      </div>
      <div>
        <span>Chat</span>
        <p>Pregunta por chat: Cruza Zabbix e IncidenciasTI.</p>
      </div>
      <div>
        <span>Inicio del día</span>
        <p>Usa Actualizar dashboard al inicio del día.</p>
      </div>
    </section>
  );
}

function ChatVoiceView({
  chatStatusText,
  briefing,
  briefingStep,
  isRunningBriefing,
  onRunBriefing,
  onOpenChat
}) {
  return (
    <>
      <MorningBriefingPanel
        briefing={briefing}
        step={briefingStep}
        isRunning={isRunningBriefing}
        onRunBriefing={onRunBriefing}
      />
      <section className="visual-report-panel" aria-label="Chat y voz">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Chat/Voz</p>
            <h3>Interacción con el agente</h3>
          </div>
          <span className="readonly-badge">{chatStatusText}</span>
        </div>
        <div className="visual-columns">
          <div className="visual-list-panel">
            <h3>Voz</h3>
            <p>Pregunta: ¿Qué es lo más urgente hoy?</p>
            <p>Pregunta: Muéstrame el informe de hoy.</p>
            <p>Pregunta: Prepara el informe ejecutivo.</p>
            <p>Pregunta: Prepara la matriz para exportar.</p>
            <p>Pregunta: Prepara un correo para dirección con el informe ejecutivo.</p>
            <p>Pregunta: Prepara un mensaje de Teams para soporte con los riesgos críticos.</p>
            <p>Pregunta: Dame el briefing de mañana.</p>
          </div>
          <div className="visual-list-panel">
            <h3>Chat textual</h3>
            <p>El chat textual se abre bajo demanda para no tapar el dashboard.</p>
            <p>Pregunta: Cruza Zabbix e IncidenciasTI.</p>
            <p>Pregunta: Dame resumen de IncidenciasTI por estado.</p>
            <button type="button" className="action-button secondary-action" onClick={onOpenChat}>
              Abrir chat textual
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function pickText(value, fallback = "") {
  return String(value || fallback).trim();
}

function compactList(values, limit = 3) {
  const seen = new Set();
  const result = [];
  for (const value of values.flat().filter(Boolean)) {
    const text = pickText(value);
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

function buildMorningBriefing({ dashboard, dailyData, matrixData }) {
  const status = dashboard?.overall_status || dailyData?.overall_status || "unknown";
  const risks = compactList([
    dashboard?.critical_risks || [],
    (dailyData?.key_findings || [])
      .filter((finding) => ["critical", "high"].includes(String(finding.severity).toLowerCase()))
      .map((finding) => `${finding.title}: ${finding.recommended_action}`)
  ]);
  const incidentImpact = compactList([
    matrixData?.confirmed_impact || [],
    (matrixData?.rows || [])
      .filter((row) => (row.related_incidents || []).length)
      .map((row) => `${row.asset_or_service}: ${row.user_impact}`)
  ]);
  const actions = compactList([
    (dashboard?.top_actions || []).map((action) => action.action),
    (dailyData?.top_actions || []).map((action) => action.action)
  ]);
  const gaps = compactList([dashboard?.monitoring_gaps || [], matrixData?.monitoring_gaps || []]);
  const sections = [
    {
      id: "status",
      title: "Estado general",
      text:
        dailyData?.executive_summary ||
        `El estado general actual es ${status}. Revisa el dashboard para detalle.`
    },
    {
      id: "risks",
      title: "Riesgos críticos",
      text: risks.length ? risks.join("; ") : "No hay riesgos críticos estructurados destacados."
    },
    {
      id: "impact",
      title: "Incidencias e impacto de usuario",
      text: incidentImpact.length
        ? incidentImpact.join("; ")
        : "No hay impacto de usuario correlacionado destacado en la última matriz."
    },
    {
      id: "actions",
      title: "Acciones recomendadas para hoy",
      text: actions.length ? actions.join("; ") : "No hay acciones priorizadas disponibles."
    },
    {
      id: "gaps",
      title: "Huecos de monitorización",
      text: gaps.length ? gaps.join("; ") : "No hay huecos estructurados destacados."
    }
  ];
  const topThree = actions.length ? actions.slice(0, 3) : [...risks, ...incidentImpact].slice(0, 3);
  const text = [
    `Briefing de mañana. Estado general: ${status}.`,
    `Resumen: ${sections[0].text}`,
    `Riesgos críticos: ${sections[1].text}`,
    `Impacto en usuarios: ${sections[2].text}`,
    `Acciones recomendadas: ${sections[3].text}`,
    `Huecos de monitorización: ${sections[4].text}`,
    topThree.length
      ? `Estas son las tres acciones que priorizaría hoy: ${topThree.join("; ")}.`
      : "No tengo tres acciones priorizadas suficientes; conviene actualizar el dashboard."
  ].join("\n");

  return {
    title: "Briefing de mañana",
    generated_at: new Date().toISOString(),
    status,
    sections,
    top_three: topThree,
    text
  };
}

function MorningBriefingPanel({ briefing, step, isRunning, onRunBriefing }) {
  return (
    <section className={`briefing-panel ${isRunning ? "active" : ""}`} aria-label="Briefing de mañana">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Briefing de mañana</p>
          <h3>{briefing?.title || "Resumen operativo guiado"}</h3>
        </div>
        <button
          type="button"
          className="action-button primary-action"
          onClick={onRunBriefing}
          disabled={isRunning}
        >
          Briefing de mañana
        </button>
      </div>
      {briefing ? (
        <>
          <p className="briefing-summary">{briefing.text}</p>
          <div className="briefing-steps">
            {briefing.sections.map((section) => (
              <div
                key={section.id}
                className={`briefing-step ${step === section.id ? "active" : ""}`}
              >
                <span>{section.title}</span>
                <p>{section.text}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-history">
          Pulsa el botón para preparar un briefing con estado general, riesgos, impacto,
          acciones y huecos. Si la voz ya está iniciada, el avatar lo leerá.
        </p>
      )}
    </section>
  );
}

export default function InfraChatClient() {
  const router = useRouter();
  const [lastPrompt, setLastPrompt] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [chatHealth, setChatHealth] = useState("loading");
  const [chatScriptState, setChatScriptState] = useState("cargando script ChatKit");
  const [chatSessionState, setChatSessionState] = useState("pendiente");
  const [chatMountState, setChatMountState] = useState("pendiente");
  const [chatReadyState, setChatReadyState] = useState("pendiente");
  const [chatError, setChatError] = useState("");
  const [hasChatClientSecret, setHasChatClientSecret] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [chatPanelPhase, setChatPanelPhase] = useState("closed");
  const [chatDrawerTab, setChatDrawerTab] = useState("agent");
  const [presentationMode, setPresentationMode] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [morningBriefing, setMorningBriefing] = useState(null);
  const [isRunningBriefing, setIsRunningBriefing] = useState(false);
  const [briefingStep, setBriefingStep] = useState("");
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [isGeneratingStructured, setIsGeneratingStructured] = useState(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isUpdatingDashboard, setIsUpdatingDashboard] = useState(false);
  const [isRunningDailyReport, setIsRunningDailyReport] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [structuredResult, setStructuredResult] = useState(null);
  const [latestDailyReport, setLatestDailyReport] = useState(null);
  const [latestDailyData, setLatestDailyData] = useState(null);
  const [latestMatrixReport, setLatestMatrixReport] = useState(null);
  const [latestMatrixData, setLatestMatrixData] = useState(null);
  const [latestRisksData, setLatestRisksData] = useState(null);
  const [latestGapsData, setLatestGapsData] = useState(null);
  const [isLoadingVisualReports, setIsLoadingVisualReports] = useState(false);
  const [visualReportsMessage, setVisualReportsMessage] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsReports, setAnalyticsReports] = useState(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsMessage, setAnalyticsMessage] = useState("");
  const [powerBiStatus, setPowerBiStatus] = useState(null);
  const [powerBiModels, setPowerBiModels] = useState([]);
  const [powerBiModelSnapshots, setPowerBiModelSnapshots] = useState({});
  const [powerBiLoading, setPowerBiLoading] = useState(false);
  const [powerBiMessage, setPowerBiMessage] = useState("");
  const [powerBiLoadedAt, setPowerBiLoadedAt] = useState("");
  const [powerBiDaxLab, setPowerBiDaxLab] = useState({
    modelKey: "administracion_ventas",
    intent: "top_dimension_by_metric",
    metric: "ventas_eur",
    dimension: "cliente",
    timeRange: "all_time",
    topN: 10,
    generatedDax: "",
    validation: null,
    execution: null,
    statusMessage: "",
    error: ""
  });
  const [powerBiAskLab, setPowerBiAskLab] = useState({
    modelKey: "administracion_ventas",
    question: "",
    interpretation: null,
    preview: null,
    execution: null,
    statusMessage: "",
    error: ""
  });
  const [powerBiAskQuestion, setPowerBiAskQuestion] = useState("");
  const [powerBiChatAnswer, setPowerBiChatAnswer] = useState(null);
  const [powerBiExpandedResult, setPowerBiExpandedResult] = useState(null);
  const [latestPowerBiResult, setLatestPowerBiResult] = useState(null);
  const [latestPowerBiResultSource, setLatestPowerBiResultSource] = useState("text");
  const [latestPowerBiQuestion, setLatestPowerBiQuestion] = useState("");
  const [latestPowerBiTimestamp, setLatestPowerBiTimestamp] = useState("");
  const [latestOpsResult, setLatestOpsResult] = useState(null);
  const [latestOpsResultSource, setLatestOpsResultSource] = useState("text");
  const [latestOpsQuestion, setLatestOpsQuestion] = useState("");
  const [latestOpsTimestamp, setLatestOpsTimestamp] = useState("");
  const [currentIncidentContext, setCurrentIncidentContext] = useState(null);
  const [powerBiDrawerMessages, setPowerBiDrawerMessages] = useState([]);
  const [localOpsQuestion, setLocalOpsQuestion] = useState("");
  const [localOpsMessages, setLocalOpsMessages] = useState([]);
  const [localOpsLoading, setLocalOpsLoading] = useState(false);
  const [localOpsError, setLocalOpsError] = useState("");
  const [localPowerBiQuestion, setLocalPowerBiQuestion] = useState("");
  const [localPowerBiMessages, setLocalPowerBiMessages] = useState([]);
  const [localPowerBiLoading, setLocalPowerBiLoading] = useState(false);
  const [localPowerBiError, setLocalPowerBiError] = useState("");
  const [showLocalPowerBiHelp, setShowLocalPowerBiHelp] = useState(false);
  const powerBiChatHandledRef = useRef({ text: "", at: 0 });
  const opsChatHandledRef = useRef({ text: "", at: 0 });
  const [matrixFilters, setMatrixFilters] = useState({
    priority: "",
    correlation: "",
    query: ""
  });
  const [reportFilterType, setReportFilterType] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportDateFrom, setReportDateFrom] = useState("");
  const [reportDateTo, setReportDateTo] = useState("");
  const [reportQuickRange, setReportQuickRange] = useState("");
  const [reportLimit, setReportLimit] = useState(10);
  const [reportDraft, setReportDraft] = useState({
    type: "daily_summary",
    title: "Informe diario operativo",
    prompt: dailyReportPrompt,
    response_markdown: ""
  });
  const [communicationDrafts, setCommunicationDrafts] = useState([]);
  const [communicationDraftSummary, setCommunicationDraftSummary] = useState(null);
  const [selectedCommunicationDraft, setSelectedCommunicationDraft] = useState(null);
  const [communicationDraftEditorMode, setCommunicationDraftEditorMode] = useState("new");
  const [communicationDraftOpenId, setCommunicationDraftOpenId] = useState("");
  const [lastCreatedDraftId, setLastCreatedDraftId] = useState("");
  const [communicationDraftViewerUrl, setCommunicationDraftViewerUrl] = useState("");
  const [communicationDraftViewerOpen, setCommunicationDraftViewerOpen] = useState(false);
  const [communicationDraftViewerDraftId, setCommunicationDraftViewerDraftId] = useState("");
  const [communicationDraftViewerDraft, setCommunicationDraftViewerDraft] = useState(null);
  const [openedCommunicationDraftId, setOpenedCommunicationDraftId] = useState("");
  const [openedCommunicationDraft, setOpenedCommunicationDraft] = useState(null);
  const [isCommunicationDraftViewerOpen, setIsCommunicationDraftViewerOpen] = useState(false);
  const [isCommunicationDraftViewerLoading, setIsCommunicationDraftViewerLoading] = useState(false);
  const [communicationDraftViewerError, setCommunicationDraftViewerError] = useState("");
  const [isLoadingCommunicationDrafts, setIsLoadingCommunicationDrafts] = useState(false);
  const [isSavingCommunicationDraft, setIsSavingCommunicationDraft] = useState(false);
  const [communicationMessage, setCommunicationMessage] = useState("");
  const [pendingVoiceDraftDecision, setPendingVoiceDraftDecision] = useState(null);
  const [pendingVoiceSendConfirmation, setPendingVoiceSendConfirmation] = useState(null);
  const [communicationDraftForm, setCommunicationDraftForm] = useState(
    defaultCommunicationDraftForm
  );
  const [communicationDraftFilter, setCommunicationDraftFilter] = useState({
    status: "",
    type: "",
    template_id: ""
  });
  const [communicationTemplates, setCommunicationTemplates] = useState([]);
  const [selectedCommunicationTemplateId, setSelectedCommunicationTemplateId] = useState(
    defaultCommunicationTemplateId
  );
  const [communicationTemplatesMessage, setCommunicationTemplatesMessage] = useState("");
  const [communicationSendConfig, setCommunicationSendConfig] = useState({
    allowedDomains: [],
    hasFromUser: false
  });
  const communicationAllowedDomains = Array.isArray(communicationSendConfig?.allowedDomains)
    ? communicationSendConfig.allowedDomains
    : [];
  const [communicationSendPreparation, setCommunicationSendPreparation] = useState(null);
  const [isSendingCommunicationEmail, setIsSendingCommunicationEmail] = useState(false);
  const [communicationDraftViewerDiagnostics, setCommunicationDraftViewerDiagnostics] = useState({
    lastCreatedDraftId: "",
    lastOpenedDraftId: "",
    getByIdStatus: "—",
    totalBeforeCreate: 0,
    totalAfterCreate: 0,
    lastDraftLoadAt: ""
  });
  const [communicationReviewDraftId, setCommunicationReviewDraftId] = useState("");
  const [communicationReviewMessage, setCommunicationReviewMessage] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryMessage, setDirectoryMessage] = useState("");
  const [directorySyncedAt, setDirectorySyncedAt] = useState("");
  const selectedCommunicationDraftRef = useRef(null);
  const briefingTimersRef = useRef([]);
  const chatPanelTimerRef = useRef(null);
  const directorySearchTimerRef = useRef(null);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const targetView = String(router.query?.view || "").trim();
    if (targetView === "communications") {
      setActiveView("communications");
      const queryDraftId = String(router.query?.draftId || "").replace(/\D/g, "").trim();
      if (queryDraftId) {
        setCommunicationReviewDraftId(queryDraftId);
        setCommunicationDraftOpenId(queryDraftId);
        setCommunicationReviewMessage(`Borrador #${queryDraftId} abierto para revisión. No se ha enviado nada.`);
      }
    }
  }, [router.isReady, router.query?.view, router.query?.draftId]);

  const getClientSecretWithDiagnostics = useCallback(async (existingClientSecret) => {
    setChatSessionState("Creando sesión ChatKit...");
    setChatError("");
    setHasChatClientSecret(false);

    try {
      const clientSecret = await requestClientSecret(existingClientSecret);
      setHasChatClientSecret(Boolean(clientSecret));
      setChatSessionState("Sesión ChatKit creada");
      return clientSecret;
    } catch (error) {
      setChatHealth("error");
      setChatSessionState("Error creando sesión ChatKit");
      setChatError(error?.message || "No se pudo crear la sesión ChatKit.");
      throw error;
    }
  }, []);

  const handleChatKitRef = useCallback((node) => {
    setChatMountState(node ? "ChatKit montado" : "ChatKit desmontado");
  }, []);

  function handleChatKitLog(event) {
    const name = String(event?.name || "").trim();
    const data = event?.data || {};
    const candidateText = String(
      data?.text ||
        data?.message ||
        data?.prompt ||
        data?.content?.text ||
        data?.input ||
        ""
    ).trim();

    console.debug("[chatkit-log]", {
      name,
      hasText: Boolean(candidateText),
      textLength: candidateText.length
    });

    if (!candidateText) {
      return;
    }

    if (!/submit|send|message|composer/i.test(name)) {
      return;
    }

    const opsDetection = detectOpsIntent(candidateText);
    if (opsDetection?.matched || opsDetection?.kind && opsDetection.kind !== "unknown") {
      void handleOpsChatMessage(candidateText, {
        source: "chatkit-log",
        currentIncidentContext
      });
      return;
    }

    void handlePowerBiChatMessage(candidateText, { source: "chatkit-log" });
  }

  const { control, ref: chatKitRef, focusComposer, sendUserMessage, setComposerValue } = useChatKit({
    api: {
      getClientSecret: getClientSecretWithDiagnostics
    },
    locale: "es-ES",
    theme: {
      colorScheme: "light",
      radius: "soft",
      density: "normal"
    },
    composer: {
      placeholder: "Enviar mensaje a la IA",
      attachments: {
        enabled: false
      }
    },
    header: {
      enabled: true,
      title: {
        enabled: true,
        text: "Agente Inteligente de Infraestructura"
      }
    },
    startScreen: {
      greeting: "¿Qué necesitas revisar de la infraestructura?",
      prompts: quickPrompts.map((prompt) => ({
        label: prompt,
        prompt
      }))
    },
    onReady: () => {
      setChatHealth("ready");
      setChatReadyState("ChatKit montado");
      setChatError("");
    },
    onResponseStart: () => {
      setChatReadyState("ChatKit respondiendo");
    },
    onResponseEnd: () => {
      setChatReadyState("ChatKit montado");
    },
    onThreadLoadStart: () => {
      setChatReadyState("Cargando hilo ChatKit");
    },
    onThreadLoadEnd: () => {
      setChatReadyState("ChatKit montado");
    },
    onLog: handleChatKitLog,
    onError: ({ error }) => {
      setChatHealth("error");
      setChatReadyState("ChatKit error");
      setChatError(error?.message || "ChatKit ha devuelto un error.");
      setStatusMessage(error?.message || "ChatKit ha devuelto un error.");
    }
  });

  const chatKitPowerBiBridgeRef = useRef({
    instance: null,
    originalSendUserMessage: null
  });
  const chatKitVisibleShellRef = useRef(null);

  function extractPowerBiVisibleChatTextFromEvent(event) {
    const target = event?.target || event?.currentTarget || null;
    const targetValue = String(target?.value || target?.textContent || "").trim();
    if (targetValue) {
      return targetValue;
    }

    const shell = chatKitVisibleShellRef.current;
    if (!shell || typeof shell.querySelector !== "function") {
      return "";
    }

    const composer =
      shell.querySelector("textarea") ||
      shell.querySelector('input[type="text"]') ||
      shell.querySelector('[contenteditable="true"]');

    if (!composer) {
      return "";
    }

    return String(composer.value || composer.textContent || "").trim();
  }

  function scheduleVisiblePowerBiChatCapture(event) {
    const eventType = String(event?.type || "");
    const target = event?.target || null;
    if (eventType === "click") {
      const targetElement =
        typeof target?.closest === "function"
          ? target
          : typeof target?.parentElement?.closest === "function"
            ? target.parentElement
            : null;
      const isButtonLike =
        Boolean(targetElement?.closest?.("button, [role='button']")) ||
        String(targetElement?.tagName || "").toLowerCase() === "button";
      if (!isButtonLike) {
        return;
      }
    }

    const text = extractPowerBiVisibleChatTextFromEvent(event);
    if (!text) {
      return;
    }

    const detection = detectPowerBiIntent(text);
    if (!detection.matched) {
      return;
    }

    console.debug("[powerbi-chat-visible]", {
      hasQuestion: true,
      questionLength: text.length,
      source: eventType || "unknown"
    });

    void handlePowerBiChatMessage(text, { source: "chatkit-visible" });
  }

  useEffect(() => {
    const instance = chatKitRef.current;
    if (!instance || chatKitPowerBiBridgeRef.current.instance === instance) {
      return;
    }

    const originalSendUserMessage =
      typeof instance.sendUserMessage === "function"
        ? instance.sendUserMessage.bind(instance)
        : null;
    if (!originalSendUserMessage) {
      return;
    }

    chatKitPowerBiBridgeRef.current = {
      instance,
      originalSendUserMessage
    };

    instance.sendUserMessage = async (params = {}) => {
      const prompt = String(params.text || params.reply || "").trim();
      const opsRouted = await handleOpsChatMessage(prompt, {
        source: "chatkit",
        currentIncidentContext
      });
      if (opsRouted.handled) {
        const nowIso = new Date().toISOString();
        setLocalOpsMessages((current) => [
          ...current,
          {
            id: `${nowIso}-user-chatkit`,
            role: "user",
            type: "operational_query",
            source: "ChatKit",
            createdAt: nowIso,
            content: prompt
          },
          {
            id: `${nowIso}-assistant-chatkit`,
            role: "assistant",
            type: opsRouted?.response?.visualResult?.kind === "firewall_status" ? "firewall_status" : "operational_result",
            source: opsRouted?.sourceLabel || opsRouted?.response?.sourceLabel || "IncidenciasTI / Zabbix",
            createdAt: nowIso,
            content:
              opsRouted?.message ||
              opsRouted?.spokenResponse ||
              opsRouted?.response?.spokenResponse ||
              "Resultado operativo disponible.",
            visualResult: opsRouted?.response?.visualResult || opsRouted?.visualResult || null
          }
        ]);
        try {
          await setComposerValue({ text: "" });
        } catch {
          // Ignore composer clearing failures.
        }
        return opsRouted;
      }
      const routed = await handlePowerBiChatMessage(prompt, { source: "chatkit" });
      if (routed.handled) {
        try {
          await setComposerValue({ text: "" });
        } catch {
          // Ignore composer clearing failures.
        }
        return routed;
      }
      return originalSendUserMessage(params);
    };

    return () => {
      const current = chatKitPowerBiBridgeRef.current;
      if (current.instance === instance && current.originalSendUserMessage) {
        instance.sendUserMessage = current.originalSendUserMessage;
      }
      if (current.instance === instance) {
        chatKitPowerBiBridgeRef.current = {
          instance: null,
          originalSendUserMessage: null
        };
      }
    };
  }, [chatKitRef, setComposerValue, chatHealth]);

  const isChatAvailable = chatHealth === "ready";
  const chatStatusText =
    chatHealth === "error"
      ? "ChatKit no disponible"
      : chatHealth === "ready"
        ? "Chat textual cargado"
        : chatSessionState === "Sesión ChatKit creada"
          ? "Sesión ChatKit creada"
          : "Creando sesión ChatKit";
  const chatPanelStatusText = !chatPanelOpen
    ? chatHealth === "error"
      ? "Error ChatKit"
      : "Chat cerrado"
    : chatPanelPhase === "opening"
      ? "Chat abriendo"
      : chatStatusText;

  useEffect(() => {
    try {
      setPresentationMode(window.localStorage.getItem("infra-agent-presentation-mode") === "1");
    } catch {
      // localStorage is optional; presentation mode still works for the current session.
    }
    loadReports();
    loadDashboard();
    loadAnalytics();
  }, []);

  useEffect(() => {
    function handleNavigationEvent(event) {
      const view = event?.detail?.view;
      if (view && navigationTabs.some((tab) => tab.id === view)) {
        setActiveView(view);
      }
      if (event?.detail?.focus === "risks_chart") {
        setActiveView("matrix");
        setMatrixFilters((current) => ({ ...current, priority: "" }));
      }
      if (event?.detail?.focus === "incidents_chart") {
        setActiveView("matrix");
      }
    }

    window.addEventListener("infra-agent:navigate", handleNavigationEvent);
    return () => window.removeEventListener("infra-agent:navigate", handleNavigationEvent);
  }, []);

  useEffect(() => {
    function handleDirectorySearch(event) {
      const detail = event?.detail || {};
      const query = String(detail.query || detail.q || "").trim();
      if (query) {
        setDirectoryQuery(query);
      }
      if (detail.users?.length) {
        setDirectoryUsers(detail.users.map(normalizeDirectoryUser).filter(Boolean));
      }
      if (detail.message) {
        setDirectoryMessage(detail.message);
      }
      setActiveView("directory");
    }

    window.addEventListener("infra-agent:directory-search", handleDirectorySearch);
    return () => window.removeEventListener("infra-agent:directory-search", handleDirectorySearch);
  }, []);

  useEffect(() => {
    if (activeView === "powerbi") {
      void loadPowerBiOverview();
    }
  }, [activeView]);

  useEffect(() => {
    const query = String(directoryQuery || "").trim();
    if (directorySearchTimerRef.current) {
      clearTimeout(directorySearchTimerRef.current);
    }

    directorySearchTimerRef.current = setTimeout(() => {
      if (query) {
        searchDirectoryUsers(query).catch(() => {});
      } else {
        loadDirectoryUsers().catch(() => {});
      }
    }, 280);

    return () => {
      if (directorySearchTimerRef.current) {
        clearTimeout(directorySearchTimerRef.current);
      }
    };
  }, [directoryQuery]);

  useEffect(() => {
    function handleVoiceBriefing(event) {
      const text = pickText(event?.detail?.text || event?.detail?.summary);
      setActiveView("dashboard");
      setBriefingStep("status");
      setMorningBriefing({
        title: "Briefing de mañana",
        generated_at: new Date().toISOString(),
        status: "unknown",
        text: text || "Briefing solicitado por voz.",
        top_three: [],
        sections: [
          {
            id: "status",
            title: "Estado general",
            text: text || "Briefing solicitado por voz."
          }
        ]
      });
    }

    function handleCommunicationDraft(event) {
      const detail = event?.detail || {};
      const payload = detail.payload || detail.draft || null;
      const voiceIntent = String(detail.voice_intent || detail.intent || detail.communication_action || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const payloadIntentText = [
        detail.source,
        detail.message,
        payload?.action,
        payload?.voice_intent,
        payload?.communication_action,
        payload?.template_id,
        payload?.source_type,
        payload?.source_incident_id,
        payload?.recipient_label,
        payload?.recipient_email,
        payload?.subject,
        payload?.custom_context?.summary,
        payload?.custom_context?.message,
        payload?.custom_context?.creator_name,
        payload?.custom_context?.creator_email,
        payload?.custom_context?.incident_id,
        payload?.custom_context?.incident_title
      ]
        .map((value) => String(value || ""))
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const isExplicitCreatorVoiceIntent = /prepare_creator_email|send_creator_email|direct_send_creator_email|email_to_incident_creator/.test(
        voiceIntent
      );
      const isVoiceCreatorPayload =
        String(detail.source || payload?.source || "").includes("voice") &&
        (/creador|creadora|creator|email al creador|correo al creador|email de esta incidencia|correo de esta incidencia|prepare_creator_email|direct_send_creator_email/.test(
          payloadIntentText
        ) ||
          (String(payload?.source_type || "").trim() === "incident" &&
            String(payload?.source_incident_id || "").trim() &&
            String(payload?.recipient_email || payload?.custom_context?.creator_email || "").includes("@")));
      const isIncidentCreatorPayload =
        (payload?.template_id === "seguimiento_incidencia" ||
          isExplicitCreatorVoiceIntent ||
          isVoiceCreatorPayload) &&
        String(payload?.source_type || "").trim() === "incident" &&
        String(payload?.source_incident_id || "").trim() &&
        String(payload?.recipient_email || payload?.custom_context?.creator_email || "").includes("@");
      if (isIncidentCreatorPayload) {
        void createIncidentCreatorDraftAndNavigate(
          {
            id: payload.source_incident_id,
            title: payload.custom_context?.incident_title || "",
            creator_name: payload.custom_context?.creator_name || payload.recipient_label || "",
            creator_email: payload.custom_context?.creator_email || payload.recipient_email || "",
            created_by_name: payload.recipient_label || "",
            created_by_email: payload.recipient_email || ""
          },
          { source: detail.source || "communication-draft-event" }
        ).catch((error) => {
          setCommunicationMessage(error?.message || "No se pudo preparar el borrador para el creador.");
        });
        return;
      }
      const isVoiceIncidentMissingEmail =
        String(detail.source || "").includes("voice") &&
        String(payload?.source_type || "").trim() === "incident" &&
        String(payload?.source_incident_id || "").trim() &&
        !(String(payload?.recipient_email || payload?.custom_context?.creator_email || "").includes("@"));
      if (isExplicitCreatorVoiceIntent || isVoiceIncidentMissingEmail) {
        console.debug("[communications] invalid voice route blocked", {
          error_code: "invalid_voice_route_for_incident_email",
          voice_intent: voiceIntent || "n/a",
          communication_action: "blocked",
          endpoint_selected: "none",
          source: detail.source || "n/a",
          has_creator_email: Boolean(payload?.recipient_email || payload?.custom_context?.creator_email),
          incident_id: String(payload?.source_incident_id || "").trim() || "n/a",
          template_key: String(payload?.template_id || "").trim() || "n/a"
        });
        setCommunicationMessage(
          "No he podido crear el borrador de forma verificable."
        );
        return;
      }
      if (isVoiceCreatorPayload) {
        console.debug("[communications] invalid voice route blocked", {
          error_code: "invalid_voice_route_for_incident_email",
          voice_intent: voiceIntent || "n/a",
          communication_action: "blocked",
          endpoint_selected: "none",
          source: detail.source || "n/a",
          has_creator_email: Boolean(payload?.recipient_email || payload?.custom_context?.creator_email),
          incident_id: String(payload?.source_incident_id || "").trim() || "n/a",
          template_key: String(payload?.template_id || "").trim() || "n/a"
        });
        setCommunicationMessage("No he podido crear el borrador de forma verificable.");
        return;
      }
      if (payload?.template_id) {
        launchCommunicationDraftFromTemplate(
          payload.template_id,
          {
            ...payload,
            source: detail.source || payload.source || "communication-draft-event",
            voice_intent: voiceIntent,
            communication_action: detail.communication_action || payload.communication_action || voiceIntent
          },
          detail.message
        );
        return;
      }
      if (payload) {
        launchCommunicationDraftFromPayload(payload, detail.message);
        return;
      }
      const kind = detail.kind || detail.preset || "manual";
      if (kind && kind !== "manual") {
        launchCommunicationDraftFromPreset(kind, detail.source || {}, detail.message);
      } else {
        startManualCommunicationDraft();
      }
    }

    function handleCommunicationDraftCreated(event) {
      const detail = event?.detail || {};
      const draftId = String(detail.draft_id || detail.draft?.id || "").trim();
      if (!draftId) {
        setCommunicationMessage("El borrador se creó, pero no se recibió draft_id para abrirlo.");
        return;
      }
      const isDirectSend = detail.action === "communication_direct_sent" || detail.send_status === "sent";
      if (isDirectSend) {
        setCommunicationSendPreparation(null);
        clearPendingVoiceCommunicationState();
      } else if (detail.action === "communication_send_confirmation_requested") {
        setPendingVoiceDraftDecision(null);
        setPendingVoiceSendConfirmation(communicationPendingFromDetail(detail));
      } else if ((detail.source === "voice_tool" || detail.source === "voice" || detail.source === "Comunicaciones") && detail.action === "communication_draft_created") {
        setPendingVoiceSendConfirmation(null);
        setPendingVoiceDraftDecision(communicationPendingFromDetail(detail));
      }
      const message = isDirectSend
        ? `Borrador #${draftId} enviado directamente. No se puede reenviar este mismo borrador.`
        : detail.action === "communication_send_confirmation_requested"
          ? `Vas a enviar un correo real a ${detail.recipient_email || "destino no informado"}. ¿Confirmar envío directo?`
        : `Borrador #${draftId} creado. Lo he abierto en Comunicaciones para revisión. No se ha enviado nada.`;
      openCommunicationDraftReview(
        draftId,
        message
      );
    }

    function handleCommunicationDraftDecision(event) {
      const detail = event?.detail || {};
      if (detail.action === "review_selected" || detail.action === "cancelled") {
        clearPendingVoiceCommunicationState();
        if (detail.draft_id) {
          openCommunicationDraftReview(detail.draft_id, detail.message || "No se ha enviado nada.");
        } else {
          setCommunicationMessage(detail.message || "No se ha enviado nada.");
        }
      }
    }

    function handleCommunicationReview(event) {
      const detail = event?.detail || {};
      const action = String(detail.action || "").trim();
      const message = String(detail.message || "").trim();

      void (async () => {
        try {
          if (action === "show_pending") {
            await showCommunicationDraftsByStatus(
              "pending_review",
              message || "Mostrando borradores pendientes de revisión."
            );
            return;
          }
          if (action === "show_ready") {
            await showCommunicationDraftsByStatus(
              "ready_for_review",
              message || "Mostrando borradores listos para revisión."
            );
            return;
          }
          if (action === "mark_selected_reviewed") {
            const target = getCommunicationDraftTarget("selected");
            if (!target?.id) {
              setCommunicationMessage("No hay borrador seleccionado para marcar como revisado.");
              return;
            }
            await markCommunicationDraftReviewed(target.id);
            setActiveView("communications");
            return;
          }
          if (action === "mark_selected_ready") {
            const target = getCommunicationDraftTarget("selected");
            if (!target?.id) {
              setCommunicationMessage("No hay borrador seleccionado para marcar como listo.");
              return;
            }
            await markCommunicationDraftReadyForReview(target.id);
            setActiveView("communications");
            return;
          }
          if (action === "discard_latest") {
            const target = getCommunicationDraftTarget("latest");
            if (!target?.id) {
              setCommunicationMessage("No hay borrador reciente para descartar.");
              return;
            }
            await discardCommunicationDraft(target.id);
            setActiveView("communications");
            return;
          }
          if (action === "mark_selected_copied") {
            const target = getCommunicationDraftTarget("selected");
            if (!target?.id) {
              setCommunicationMessage("No hay borrador seleccionado para marcar como copiado.");
              return;
            }
            await markCommunicationDraftCopied(target.id);
            setActiveView("communications");
            return;
          }
          setCommunicationMessage("Acción de revisión no reconocida.");
        } catch (error) {
          setCommunicationMessage(error?.message || "No se pudo aplicar la acción de revisión.");
        }
      })();
    }

    function handleCommunicationSendConfirmation(event) {
      const detail = event?.detail || {};
      const message = String(detail.message || "").trim();
      setActiveView("communications");
      setCommunicationMessage(
        message ||
          "Selecciona un borrador de email revisado y pulsa Preparar envío para ver la doble confirmación."
      );
    }

    function handlePowerBiVoiceResult(event) {
      const detail = event?.detail || {};
      const spokenResponse = String(detail.spokenResponse || detail.message || "").trim();
      const visualResult = detail.visualResult || null;
      const rejectionReason = String(detail.rejectionReason || "").trim();
      const handled = Boolean(detail.handled);

      const timestamp = new Date().toISOString();
      const sharedResult = {
        handled,
        unsupported: Boolean(detail.unsupported),
        spokenResponse,
        visualResult,
        rejectionReason,
        source: detail.source || "Power BI / administracion_ventas",
        question: String(detail.question || "").trim(),
        at: timestamp
      };

      setLatestPowerBiResult(sharedResult);
      setLatestPowerBiResultSource("voice");
      setLatestPowerBiQuestion(String(detail.question || "").trim());
      setLatestPowerBiTimestamp(timestamp);
      setPowerBiChatAnswer(visualResult ? { ...visualResult, generatedAt: timestamp } : null);
      if (visualResult) {
        appendPowerBiDrawerMessage({
          id: `${timestamp}-voice-result`,
          role: "assistant",
          type: "powerbi_result",
          source: "Power BI / administracion_ventas",
          createdAt: timestamp,
          content: spokenResponse || visualResult.headline || "Consulta Power BI por voz",
          result: { ...visualResult, generatedAt: timestamp }
        });
      }
      setActiveView("powerbi");
      if (handled) {
        setChatDrawerTab("powerbi");
      }
    }

    function handleOpsVoiceResult(event) {
      const detail = event?.detail || {};
      const spokenResponse = String(detail.spokenResponse || detail.message || "").trim();
      const visualResult = detail.visualResult || null;
      const rejectionReason = String(detail.rejectionReason || "").trim();
      const handled = Boolean(detail.handled);
      const timestamp = new Date().toISOString();

      const sharedResult = {
        handled,
        unsupported: Boolean(detail.unsupported),
        spokenResponse,
        visualResult,
        rejectionReason,
        source: detail.source || "IncidenciasTI / Zabbix",
        question: String(detail.question || "").trim(),
        kind: String(detail.kind || "").trim(),
        at: timestamp
      };

      setLatestOpsResult(sharedResult);
      setLatestOpsResultSource("voice");
      setLatestOpsQuestion(String(detail.question || "").trim());
      setLatestOpsTimestamp(timestamp);
      updateCurrentIncidentContextFromOpsResult(sharedResult, {
        queryType: String(detail.kind || "voice").trim()
      });
      if (handled) {
        setChatPanelOpen(true);
        setChatDrawerTab("agent");
      }
    }

    window.addEventListener("infra-agent:voice-briefing", handleVoiceBriefing);
    window.addEventListener("infra-agent:communication-draft", handleCommunicationDraft);
    window.addEventListener("infra-agent:communication-draft-created", handleCommunicationDraftCreated);
    window.addEventListener("infra-agent:communication-draft-decision", handleCommunicationDraftDecision);
    window.addEventListener("infra-agent:communication-review", handleCommunicationReview);
    window.addEventListener(
      "infra-agent:communication-send-confirmation",
      handleCommunicationSendConfirmation
    );
    window.addEventListener("infra-agent:powerbi-voice-result", handlePowerBiVoiceResult);
    window.addEventListener("infra-agent:ops-result", handleOpsVoiceResult);
    return () => {
      window.removeEventListener("infra-agent:voice-briefing", handleVoiceBriefing);
      window.removeEventListener("infra-agent:communication-draft", handleCommunicationDraft);
      window.removeEventListener(
        "infra-agent:communication-draft-created",
        handleCommunicationDraftCreated
      );
      window.removeEventListener(
        "infra-agent:communication-draft-decision",
        handleCommunicationDraftDecision
      );
      window.removeEventListener("infra-agent:communication-review", handleCommunicationReview);
      window.removeEventListener(
        "infra-agent:communication-send-confirmation",
        handleCommunicationSendConfirmation
      );
      window.removeEventListener("infra-agent:powerbi-voice-result", handlePowerBiVoiceResult);
      window.removeEventListener("infra-agent:ops-result", handleOpsVoiceResult);
    };
  }, []);

  useEffect(
    () => () => {
      briefingTimersRef.current.forEach((timer) => clearTimeout(timer));
      if (directorySearchTimerRef.current) {
        clearTimeout(directorySearchTimerRef.current);
      }
      if (chatPanelTimerRef.current) {
        clearTimeout(chatPanelTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const pending = pendingVoiceDraftDecision || pendingVoiceSendConfirmation;
    if (!pending?.created_at) {
      return undefined;
    }
    const createdAt = Date.parse(pending.created_at);
    if (!Number.isFinite(createdAt)) {
      return undefined;
    }
    const remainingMs = Math.max(0, 5 * 60 * 1000 - (Date.now() - createdAt));
    const timeout = window.setTimeout(() => {
      clearPendingVoiceCommunicationState();
      setCommunicationMessage("La decisión pendiente del borrador por voz ha caducado. No se ha enviado nada.");
    }, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [pendingVoiceDraftDecision, pendingVoiceSendConfirmation]);

  useEffect(() => {
    if (presentationMode) {
      closeChatPanel();
    }
  }, [presentationMode]);

  function openChatPanel() {
    if (chatPanelTimerRef.current) {
      clearTimeout(chatPanelTimerRef.current);
    }
    setChatPanelOpen(true);
    setChatDrawerTab("agent");
    setChatPanelPhase("opening");
    chatPanelTimerRef.current = setTimeout(() => {
      setChatPanelPhase("open");
    }, 180);
  }

  function closeChatPanel() {
    if (chatPanelTimerRef.current) {
      clearTimeout(chatPanelTimerRef.current);
      chatPanelTimerRef.current = null;
    }
    setChatPanelOpen(false);
    setChatPanelPhase("closed");
  }

  function togglePresentationMode() {
    setPresentationMode((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("infra-agent-presentation-mode", next ? "1" : "0");
      } catch {
        // Ignore storage errors; this setting is cosmetic.
      }
      return next;
    });
  }

  function parseReportMetadata(report) {
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

  async function fetchReportDetail(reportRef) {
    if (!reportRef?.id) {
      return null;
    }

    const response = await fetch(`/api/reports/${reportRef.id}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "No se pudo cargar el informe estructurado.");
    }
    return data.report || null;
  }

  async function loadLatestVisualReports(sourceDashboard = dashboard) {
    setIsLoadingVisualReports(true);
    setVisualReportsMessage("");

    try {
      const dailyRef = sourceDashboard?.latest_reports?.daily_summary || null;
      const matrixRef = sourceDashboard?.latest_reports?.correlation_matrix || null;
      const risksRef = sourceDashboard?.latest_reports?.critical_risks || null;
      const gapsRef = sourceDashboard?.latest_reports?.monitoring_gaps || null;
      const [dailyReport, matrixReport, risksReport, gapsReport] = await Promise.all([
        fetchReportDetail(dailyRef),
        fetchReportDetail(matrixRef),
        fetchReportDetail(risksRef),
        fetchReportDetail(gapsRef)
      ]);
      const dailyMetadata = parseReportMetadata(dailyReport);
      const matrixMetadata = parseReportMetadata(matrixReport);
      const risksMetadata = parseReportMetadata(risksReport);
      const gapsMetadata = parseReportMetadata(gapsReport);

      setLatestDailyReport(dailyReport);
      setLatestDailyData(dailyMetadata?.structured_data || null);
      setLatestMatrixReport(matrixReport);
      setLatestMatrixData(matrixMetadata?.structured_data || null);
      setLatestRisksData(risksMetadata?.structured_data || null);
      setLatestGapsData(gapsMetadata?.structured_data || null);
    } catch (error) {
      setVisualReportsMessage(error?.message || "No se pudieron cargar las vistas visuales.");
    } finally {
      setIsLoadingVisualReports(false);
    }
  }

  function clearBriefingTimers() {
    briefingTimersRef.current.forEach((timer) => clearTimeout(timer));
    briefingTimersRef.current = [];
  }

  function runBriefingSequence() {
    clearBriefingTimers();
    const steps = [
      { delay: 0, view: "dashboard", step: "status" },
      { delay: 4500, view: "today", step: "actions" },
      { delay: 9000, view: "matrix", step: "impact" },
      { delay: 13500, view: "matrix", step: "gaps" },
      { delay: 18000, view: "dashboard", step: "actions" }
    ];

    briefingTimersRef.current = steps.map((item) =>
      setTimeout(() => {
        setActiveView(item.view);
        setBriefingStep(item.step);
        if (item.step === "impact") {
          window.dispatchEvent(
            new CustomEvent("infra-agent:navigate", {
              detail: { view: "matrix", focus: "incidents_chart" }
            })
          );
        }
      }, item.delay)
    );
  }

  async function runMorningBriefing() {
    setIsRunningBriefing(true);
    setDashboardMessage("Preparando briefing de mañana...");

    try {
      const response = await fetch("/api/dashboard/latest");
      const freshDashboard = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(freshDashboard.error || "No se pudo cargar el dashboard para el briefing.");
      }

      setDashboard(freshDashboard);
      await loadLatestVisualReports(freshDashboard);

      const dailyReport = await fetchReportDetail(freshDashboard.latest_reports?.daily_summary);
      const matrixReport = await fetchReportDetail(freshDashboard.latest_reports?.correlation_matrix);
      const dailyData = parseReportMetadata(dailyReport)?.structured_data || latestDailyData;
      const matrixData = parseReportMetadata(matrixReport)?.structured_data || latestMatrixData;
      const briefing = buildMorningBriefing({
        dashboard: freshDashboard,
        dailyData,
        matrixData
      });

      setLatestDailyReport(dailyReport);
      setLatestDailyData(dailyData || null);
      setLatestMatrixReport(matrixReport);
      setLatestMatrixData(matrixData || null);
      setMorningBriefing(briefing);
      setDashboardMessage("Briefing preparado. Si la voz está iniciada, el avatar lo leerá.");
      runBriefingSequence();
      window.dispatchEvent(new CustomEvent("infra-agent:briefing", { detail: briefing }));
    } catch (error) {
      setDashboardMessage(error?.message || "No se pudo preparar el briefing de mañana.");
    } finally {
      setIsRunningBriefing(false);
    }
  }

  function showStructuredReport(report, data, source, warning) {
    const metadata = parseReportMetadata(report);
    const structuredData = data || metadata?.structured_data;
    const kind = metadata?.structured_kind;

    if (!structuredData) {
      return;
    }

    setStructuredResult({
      kind,
      data: structuredData,
      source: source || metadata?.source || "historico",
      warning: warning || metadata?.warning || null
    });
  }

  function prepareReportDraft(type, title, prompt) {
    setReportMessage(
      "Informe preparado. Genera o revisa la respuesta en el chat y pega el Markdown antes de guardar."
    );
    setReportDraft((current) => ({
      ...current,
      type,
      title,
      prompt
    }));
  }

  async function loadDashboard() {
    setIsLoadingDashboard(true);
    setDashboardMessage("");

    try {
      const response = await fetch("/api/dashboard/latest");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar el dashboard.");
      }

      setDashboard(data);
      await loadLatestVisualReports(data);
    } catch (error) {
      setDashboardMessage(error?.message || "No se pudo cargar el dashboard.");
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  async function loadAnalytics() {
    setIsLoadingAnalytics(true);
    setAnalyticsMessage("");

    try {
      const [summaryResponse, reportsResponse] = await Promise.all([
        fetch("/api/analytics/summary"),
        fetch("/api/analytics/reports?days=7")
      ]);
      const summaryData = await summaryResponse.json().catch(() => ({}));
      const reportsData = await reportsResponse.json().catch(() => ({}));

      if (!summaryResponse.ok) {
        throw new Error(summaryData.error || "No se pudo cargar el análisis.");
      }
      if (!reportsResponse.ok) {
        throw new Error(reportsData.error || "No se pudo cargar la serie de informes.");
      }

      setAnalytics(summaryData);
      setAnalyticsReports(reportsData);
    } catch (error) {
      setAnalyticsMessage(error?.message || "No se pudo cargar el análisis.");
    } finally {
      setIsLoadingAnalytics(false);
    }
  }

  async function loadReports(options = {}) {
    const { clearMessage = true } = options;
    setIsLoadingReports(true);
    if (clearMessage) {
      setReportMessage("");
    }

    try {
      const params = new URLSearchParams({
        limit: String(reportLimit || 10)
      });
      if (reportFilterType) {
        params.set("type", reportFilterType);
      }
      if (reportSearch.trim()) {
        params.set("query", reportSearch.trim());
      }
      if (reportQuickRange === "today") {
        params.set("today", "1");
      } else if (reportQuickRange === "7d") {
        params.set("days", "7");
      } else {
        if (reportDateFrom) {
          params.set("date_from", reportDateFrom);
        }
        if (reportDateTo) {
          params.set("date_to", reportDateTo);
        }
      }
      const response = await fetch(`/api/reports?${params.toString()}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar el histórico.");
      }

      setReports(data.reports || []);
    } catch (error) {
      setReportMessage(error?.message || "No se pudo cargar el histórico.");
    } finally {
      setIsLoadingReports(false);
    }
  }

  async function openReport(reportId) {
    setIsLoadingReports(true);
    setReportMessage("");

    try {
      const response = await fetch(`/api/reports/${reportId}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo abrir el informe.");
      }

      setSelectedReport(data.report);
      showStructuredReport(data.report);
    } catch (error) {
      setReportMessage(error?.message || "No se pudo abrir el informe.");
    } finally {
      setIsLoadingReports(false);
    }
  }

  async function saveReport() {
    setIsSavingReport(true);
    setReportMessage("");

    try {
      if (!reportDraft.response_markdown.trim()) {
        throw new Error("Pega la respuesta Markdown generada por el chat antes de guardar.");
      }

      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...reportDraft,
          metadata_json: {
            source: "chatkit_manual_paste",
            dashboard_version: "v0.3"
          }
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo guardar el informe.");
      }

      setSelectedReport(data.report);
      setReportDraft((current) => ({
        ...current,
        response_markdown: ""
      }));
      await loadReports({ clearMessage: false });
      setReportMessage("Informe guardado en el histórico local.");
    } catch (error) {
      setReportMessage(error?.message || "No se pudo guardar el informe.");
    } finally {
      setIsSavingReport(false);
    }
  }

  function communicationDraftToForm(draft) {
    const normalized = normalizeCommunicationDraftRecord(draft);
    return {
      id: normalized.id || "",
      type: normalized.type || "email",
      status: normalized.status || "draft",
      recipient_label: normalized.recipient_label || "",
      recipient_email: normalized.recipient_email || "",
      optional_email: normalized.optional_email || "",
      subject: normalized.subject || "",
      body_markdown: normalized.body_markdown || "",
      body_text: normalized.body_text || "",
      body_html: normalized.body_html || "",
      source_type: normalized.source_type || "manual",
      source_report_id: normalized.source_report_id || "",
      source_incident_id: normalized.source_incident_id || "",
    template_id: normalized.template_id || "",
    review_notes: normalized.review_notes || "",
    created_at: normalized.created_at || "",
    updated_at: normalized.updated_at || "",
    send_status: normalized.send_status || "not_sent",
    send_prepared_at: normalized.send_prepared_at || "",
    send_attempt_at: normalized.send_attempt_at || "",
    sent_at: normalized.sent_at || "",
    sent_by: normalized.sent_by || "",
    from_user: normalized.from_user || "",
    send_error: normalized.send_error || ""
  };
}

  function buildCommunicationContext() {
    return {
      dashboard,
      dailyReport: latestDailyReport,
      dailyData: latestDailyData,
      matrixReport: latestMatrixReport,
      matrixData: latestMatrixData,
      risksData: latestRisksData,
      gapsData: latestGapsData,
      analytics,
      analyticsReports
    };
  }

  function compactTexts(values, limit = 3) {
    return Array.from(
      new Set(
        values
          .flat()
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    ).slice(0, limit);
  }

  function communicationTemplateIdForKind(kind) {
    if (kind === "executive") {
      return "executive_direccion";
    }
    if (kind === "technical") {
      return "tecnico_sistemas";
    }
    if (kind === "operational") {
      return "informe_diario";
    }
    if (kind === "matrix") {
      return "matriz_correlacion";
    }
    return defaultCommunicationTemplateId;
  }

  function communicationTemplateIdForReportType(type) {
    if (type === "daily_summary") {
      return "informe_diario";
    }
    if (type === "correlation_matrix") {
      return "matriz_correlacion";
    }
    if (type === "risks") {
      return "aviso_riesgo_critico";
    }
    if (type === "monitoring_gaps") {
      return "tecnico_sistemas";
    }
    return defaultCommunicationTemplateId;
  }

  function communicationTemplateSourceTypeForId(templateId) {
    if (templateId === "tecnico_sistemas" || templateId === "matriz_correlacion") {
      return "matrix";
    }
    if (templateId === "usuario_final" || templateId === "seguimiento_incidencia") {
      return "incident";
    }
    if (templateId === "aviso_riesgo_critico" || templateId === "proveedor") {
      return "risk";
    }
    return "daily_report";
  }

  function buildExecutiveTemplateContext(source = {}) {
    const ctx = buildCommunicationContext();
    const reportStructured = safeJsonParse(source?.report?.metadata_json)?.structured_data || {};
    const reportDate =
      source?.report?.created_at || ctx.dailyReport?.created_at || new Date().toISOString();
    return {
      report_date: reportDate,
      status:
        reportStructured.overall_status ||
        ctx.dailyData?.overall_status ||
        ctx.dashboard?.overall_status ||
        "unknown",
      semaphore:
        reportStructured.overall_status ||
        ctx.dailyData?.overall_status ||
        ctx.dashboard?.overall_status ||
        "unknown",
      executive_summary:
        reportStructured.executive_summary ||
        ctx.dailyData?.executive_summary ||
        "Resumen ejecutivo preparado a partir del informe diario y la correlación actual.",
      top_risks: compactTexts([
        (reportStructured.key_findings || []).slice(0, 3).map((finding) =>
          `${finding.title}${finding.description ? `: ${finding.description}` : ""}`
        ),
        (ctx.risksData?.risks || []).slice(0, 3).map((risk) => {
          const detail = risk.evidence || risk.impact || risk.recommended_action || "";
          return `${risk.asset_or_service}${detail ? `: ${detail}` : ""}`;
        }),
        (ctx.matrixData?.rows || [])
          .filter((row) => ["critical", "high"].includes(String(row.priority || "").toLowerCase()))
          .slice(0, 3)
          .map((row) => `${row.asset_or_service}: ${row.technical_risk}`)
      ]),
      user_impact: compactTexts([
        reportStructured.confirmed_impact || [],
        ctx.matrixData?.confirmed_impact || [],
        (ctx.matrixData?.rows || [])
          .filter((row) => (row.related_incidents || []).length)
          .map((row) => `${row.asset_or_service}: ${row.user_impact}`)
      ]),
      actions: compactTexts([
        (reportStructured.top_actions || []).map((action) => action.action),
        (ctx.dailyData?.top_actions || []).slice(0, 3).map((action) => action.action),
        (ctx.dashboard?.top_actions || []).slice(0, 3).map((action) => action.action)
      ]),
      escalations: ["Revisar con dirección cualquier riesgo crítico que afecte a usuarios o continuidad."],
      missing_data: compactTexts([
        reportStructured.missing_data || [],
        ctx.dailyData?.missing_data || [],
        ctx.dashboard?.missing_reports || [],
        ctx.analytics?.warnings || []
      ], 4)
    };
  }

  function buildTechnicalTemplateContext(source = {}) {
    const ctx = buildCommunicationContext();
    const reportStructured = safeJsonParse(source?.report?.metadata_json)?.structured_data || {};
    const reportDate =
      source?.report?.created_at || ctx.matrixReport?.created_at || new Date().toISOString();
    const rows = ((reportStructured.rows || ctx.matrixData?.rows || []) || []).slice(0, 5);
    const incidents = compactTexts(
      rows.flatMap((row) =>
        (row.related_incidents || []).map(
          (incident) => `${incident.id} ${incident.title} (${incident.status})`
        )
      ),
      5
    );
    const risks = compactTexts([
      (reportStructured.risks || []).map((risk) =>
        `${risk.asset_or_service || risk.title}: ${risk.evidence || risk.impact || risk.recommended_action}`
      ),
      (ctx.risksData?.risks || []).slice(0, 4).map(
        (risk) => `${risk.asset_or_service}: ${risk.evidence || risk.impact || risk.recommended_action}`
      ),
      rows.map((row) => `${row.asset_or_service}: ${row.technical_risk}`)
    ], 5);
    const gaps = compactTexts([
      reportStructured.monitoring_gaps || [],
      ctx.gapsData?.gaps || [],
      ctx.dashboard?.monitoring_gaps || []
    ], 5);
    return {
      report_date: reportDate,
      summary:
        reportStructured.summary ||
        ctx.analytics?.today?.summary ||
        "Resumen técnico preparado a partir de la matriz, riesgos críticos y huecos de monitorización.",
      problems: risks,
      incidents,
      rows,
      evidence: [
        ...(reportStructured.evidence || []),
        ...rows.map((row) => `${row.asset_or_service}: ${row.user_impact}`)
      ],
      risks_by_priority: risks,
      monitoring_gaps: gaps,
      actions_by_type: {
        operativa: [
          "Validar y ejecutar las tareas más urgentes.",
          "Confirmar impacto real antes de intervenir."
        ],
        codex_zabbix: [
          "Revisar cobertura y generar nuevos elementos si faltan.",
          "Actualizar evidencias en Zabbix si procede."
        ],
        documentacion_inventario: [
          "Actualizar activos y evidencias faltantes.",
          "Alinear la documentación con el estado real."
        ],
        revision_humana: [
          "Confirmar cualquier riesgo que no tenga ticket claro.",
          "Escalar si la evidencia no es concluyente."
        ]
      },
      missing_data: compactTexts([
        ctx.dailyData?.missing_data || []
      ], 4),
      next_steps: ["Revisar la prioridad más alta y validar si requiere ticket o escalado."]
    };
  }

  function buildOperationalTemplateContext(source = {}) {
    const ctx = buildCommunicationContext();
    const reportStructured = safeJsonParse(source?.report?.metadata_json)?.structured_data || {};
    const reportDate =
      source?.report?.created_at || ctx.dailyReport?.created_at || new Date().toISOString();
    const rows = ctx.matrixData?.rows || [];
    return {
      report_date: reportDate,
      summary:
        reportStructured.summary ||
        ctx.dailyData?.summary ||
        ctx.dailyData?.executive_summary ||
        "Resumen operativo preparado a partir del informe diario.",
      status:
        reportStructured.overall_status ||
        ctx.dailyData?.overall_status ||
        ctx.dashboard?.overall_status ||
        "unknown",
      top_actions: compactTexts([
        (reportStructured.top_actions || []).map((action) => action.action),
        (ctx.dailyData?.top_actions || []).slice(0, 3).map((action) => action.action),
        (ctx.dashboard?.top_actions || []).slice(0, 3).map((action) => action.action)
      ], 4),
      risks: compactTexts([
        reportStructured.risks || [],
        rows.filter((row) => ["critical", "high"].includes(String(row.priority || "").toLowerCase())).map((row) => row.technical_risk),
        (ctx.risksData?.risks || []).slice(0, 3).map((risk) => risk.impact || risk.evidence)
      ], 4),
      gaps: compactTexts([
        reportStructured.missing_data || [],
        ctx.dailyData?.missing_data || [],
        ctx.gapsData?.gaps || []
      ], 4)
    };
  }

  function buildMatrixTemplateContext(source = {}) {
    const ctx = buildCommunicationContext();
    const reportStructured = safeJsonParse(source?.report?.metadata_json)?.structured_data || {};
    const reportDate =
      source?.report?.created_at || ctx.matrixReport?.created_at || new Date().toISOString();
    const rows = ((reportStructured.rows || ctx.matrixData?.rows || []) || []).slice(0, 6);
    return {
      report_date: reportDate,
      summary:
        reportStructured.summary ||
        ctx.matrixData?.summary ||
        "Resumen de correlación preparado para revisión manual.",
      rows,
      actions: [
        "Revisar filas con prioridad alta.",
        "Preparar seguimiento manual y validar ticket o escalado."
      ]
    };
  }

  function buildTemplateContext(templateId, source = {}, overrides = {}) {
    const mergedSource = { ...source, ...overrides };
    if (templateId === "executive_direccion") {
      return buildExecutiveTemplateContext(mergedSource);
    }
    if (templateId === "tecnico_sistemas") {
      return buildTechnicalTemplateContext(mergedSource);
    }
    if (templateId === "informe_diario") {
      return buildOperationalTemplateContext(mergedSource);
    }
    if (templateId === "matriz_correlacion") {
      return buildMatrixTemplateContext(mergedSource);
    }
    return {
      summary: mergedSource.message || mergedSource.summary || "Borrador preparado a partir del contexto operativo actual.",
      incident: mergedSource.source_incident_id || mergedSource.source_report_id || "Incidencia pendiente",
      risk: mergedSource.message || mergedSource.summary || "Riesgo o incidencia pendiente de redactar.",
      action: [mergedSource.message || "Revisar y completar manualmente."],
      impact: [mergedSource.message || "Sin impacto detallado."],
      done: [],
      pending: [mergedSource.message || "Pendiente de completar."],
      next_step: [mergedSource.message || "Revisión manual antes de enviar."],
      owner: mergedSource.recipient_label || "Destinatario"
    };
  }

  function buildExecutiveCommunicationDraft(source = {}) {
    const ctx = buildCommunicationContext();
    const reportDate = source?.report?.created_at || ctx.dailyReport?.created_at || new Date().toISOString();
    const status = ctx.dailyData?.overall_status || ctx.dashboard?.overall_status || "unknown";
    const topRisks = compactTexts([
      (ctx.risksData?.risks || []).slice(0, 3).map((risk) => {
        const detail = risk.evidence || risk.impact || risk.recommended_action || "";
        return `${risk.asset_or_service}${detail ? `: ${detail}` : ""}`;
      }),
      (ctx.matrixData?.rows || [])
        .filter((row) => ["critical", "high"].includes(String(row.priority || "").toLowerCase()))
        .slice(0, 3)
        .map((row) => `${row.asset_or_service}: ${row.technical_risk}`)
    ]);
    const impact = compactTexts([
      ctx.matrixData?.confirmed_impact || [],
      (ctx.matrixData?.rows || [])
        .filter((row) => (row.related_incidents || []).length)
        .map((row) => `${row.asset_or_service}: ${row.user_impact}`)
    ]);
    const actions = compactTexts([
      (ctx.dailyData?.top_actions || []).slice(0, 3).map((action) => action.action),
      (ctx.dashboard?.top_actions || []).slice(0, 3).map((action) => action.action)
    ]);
    const missing = compactTexts([
      ctx.dailyData?.missing_data || [],
      ctx.dashboard?.missing_reports || [],
      ctx.analytics?.warnings || []
    ], 4);

    const bodyMarkdown = [
      "# Informe ejecutivo",
      "",
      `- Fecha: ${formatDashboardTimestamp(reportDate)}`,
      `- Estado general: ${status}`,
      `- Semáforo general: ${status}`,
      "",
      "## Resumen ejecutivo",
      ctx.dailyData?.executive_summary ||
        "Resumen ejecutivo preparado a partir del informe diario y la correlación actual.",
      "",
      "## Top 3 riesgos",
      ...(topRisks.length ? topRisks.map((item) => `- ${item}`) : ["- Sin riesgos críticos destacados."]),
      "",
      "## Impacto en usuarios",
      ...(impact.length ? impact.map((item) => `- ${item}`) : ["- Sin impacto confirmado destacado."]),
      "",
      "## Top 3 acciones recomendadas",
      ...(actions.length ? actions.map((item) => `- ${item}`) : ["- Sin acciones priorizadas disponibles."]),
      "",
      "## Decisiones o escalados necesarios",
      "- Revisar con dirección cualquier riesgo crítico que afecte a usuarios o continuidad.",
      "",
      "## Datos faltantes importantes",
      ...(missing.length ? missing.map((item) => `- ${item}`) : ["- No hay datos faltantes relevantes destacados."])
    ].join("\n");

    const bodyText = [
      "Informe ejecutivo",
      `Fecha: ${formatDashboardTimestamp(reportDate)}`,
      `Estado general: ${status}`,
      `Semáforo general: ${status}`,
      "",
      "Resumen ejecutivo:",
      ctx.dailyData?.executive_summary ||
        "Resumen ejecutivo preparado a partir del informe diario y la correlación actual.",
      "",
      "Top 3 riesgos:",
      ...(topRisks.length ? topRisks.map((item) => `- ${item}`) : ["- Sin riesgos críticos destacados."]),
      "",
      "Impacto en usuarios:",
      ...(impact.length ? impact.map((item) => `- ${item}`) : ["- Sin impacto confirmado destacado."]),
      "",
      "Top 3 acciones recomendadas:",
      ...(actions.length ? actions.map((item) => `- ${item}`) : ["- Sin acciones priorizadas disponibles."]),
      "",
      "Decisiones o escalados necesarios:",
      "- Revisar con dirección cualquier riesgo crítico que afecte a usuarios o continuidad.",
      "",
      "Datos faltantes importantes:",
      ...(missing.length ? missing.map((item) => `- ${item}`) : ["- No hay datos faltantes relevantes destacados."])
    ].join("\n");

    return {
      type: "email",
      status: "draft",
      recipient_label: "Dirección",
      recipient_email: "",
      subject: `Informe ejecutivo - ${formatDashboardTimestamp(reportDate)}`,
      body_markdown: bodyMarkdown,
      body_text: bodyText,
      source_type: "daily_report",
      source_report_id: source?.report?.id || ctx.dailyReport?.id || "",
      source_incident_id: ""
    };
  }

  function buildTechnicalCommunicationDraft(source = {}) {
    const ctx = buildCommunicationContext();
    const reportDate = source?.report?.created_at || ctx.matrixReport?.created_at || new Date().toISOString();
    const rows = (ctx.matrixData?.rows || []).slice(0, 5);
    const incidents = compactTexts(
      rows.flatMap((row) =>
        (row.related_incidents || []).map(
          (incident) => `${incident.id} ${incident.title} (${incident.status})`
        )
      ),
      5
    );
    const risks = compactTexts([
      (ctx.risksData?.risks || []).slice(0, 4).map(
        (risk) => `${risk.asset_or_service}: ${risk.evidence || risk.impact || risk.recommended_action}`
      ),
      rows.map((row) => `${row.asset_or_service}: ${row.technical_risk}`)
    ], 5);
    const gaps = compactTexts([
      ctx.gapsData?.gaps || [],
      ctx.dashboard?.monitoring_gaps || []
    ], 5);

    const bodyMarkdown = [
      "# Aviso técnico",
      "",
      `- Fecha: ${formatDashboardTimestamp(reportDate)}`,
      `- Estado general: ${ctx.dailyData?.overall_status || ctx.dashboard?.overall_status || "unknown"}`,
      "",
      "## Resumen técnico",
      ctx.analytics?.today?.summary ||
        "Resumen técnico preparado a partir de la matriz, riesgos críticos y huecos de monitorización.",
      "",
      "## Problemas Zabbix relevantes",
      ...(risks.length ? risks.map((item) => `- ${item}`) : ["- Sin problemas Zabbix relevantes destacados."]),
      "",
      "## Incidencias relacionadas",
      ...(incidents.length ? incidents.map((item) => `- ${item}`) : ["- Sin incidencias relacionadas destacadas."]),
      "",
      "## Matriz de correlación resumida",
      ...(rows.length
        ? rows.map(
            (row) =>
              `- ${row.asset_or_service}: ${row.technical_problem} · ${row.correlation_level} · ${row.priority}`
          )
        : ["- Sin filas disponibles en la matriz."]),
      "",
      "## Evidencias técnicas",
      ...(rows.length ? rows.map((row) => `- ${row.asset_or_service}: ${row.user_impact}`) : ["- Sin evidencias técnicas adicionales."]),
      "",
      "## Riesgos por prioridad",
      ...(risks.length ? risks.map((item) => `- ${item}`) : ["- Sin riesgos destacados."]),
      "",
      "## Huecos de monitorización",
      ...(gaps.length ? gaps.map((item) => `- ${item}`) : ["- Sin huecos destacados."]),
      "",
      "## Acciones por tipo",
      "- Operativa: validar y ejecutar las tareas más urgentes.",
      "- Codex/Zabbix: revisar cobertura y generar nuevos elementos si faltan.",
      "- Documentación/inventario: actualizar activos y evidencias faltantes.",
      "- Revisión humana: confirmar cualquier riesgo que no tenga ticket claro.",
      "",
      "## Datos faltantes",
      ...(ctx.dailyData?.missing_data?.length
        ? ctx.dailyData.missing_data.map((item) => `- ${item}`)
        : ["- Sin datos faltantes destacados."]),
      "",
      "## Próximos pasos",
      "- Revisar la prioridad más alta y validar si requiere ticket o escalado."
    ].join("\n");

    const bodyText = bodyMarkdown.replace(/^#\s?/gm, "").replace(/^##\s?/gm, "");

    return {
      type: "teams",
      status: "draft",
      recipient_label: "Equipo de sistemas",
      recipient_email: "",
      subject: `Aviso técnico - ${formatDashboardTimestamp(reportDate)}`,
      body_markdown: bodyMarkdown,
      body_text: bodyText,
      source_type: "matrix",
      source_report_id: source?.report?.id || ctx.matrixReport?.id || ctx.dailyReport?.id || "",
      source_incident_id: ""
    };
  }

  function buildOperationalCommunicationDraft(source = {}) {
    const ctx = buildCommunicationContext();
    const reportDate = source?.report?.created_at || ctx.dailyReport?.created_at || new Date().toISOString();
    const rows = ctx.matrixData?.rows || [];
    const topActions = compactTexts([
      (ctx.dailyData?.top_actions || []).slice(0, 3).map((action) => action.action),
      (ctx.dashboard?.top_actions || []).slice(0, 3).map((action) => action.action)
    ], 4);
    const userImpact = compactTexts([
      ctx.matrixData?.confirmed_impact || [],
      rows.filter((row) => (row.related_incidents || []).length).map((row) => row.user_impact)
    ], 4);
    const technicalRisk = compactTexts([
      rows.filter((row) => ["critical", "high"].includes(String(row.priority || "").toLowerCase())).map((row) => row.technical_risk),
      (ctx.risksData?.risks || []).slice(0, 3).map((risk) => risk.impact || risk.evidence)
    ], 4);
    const delegable = compactTexts([
      "Generar informe y matriz estructurada en Codex/Zabbix.",
      "Preparar comprobación de evidencias y seguimiento local.",
      "Actualizar resumen operativo y entregar borrador."
    ], 3);
    const human = compactTexts([
      "Confirmar cualquier cambio con impacto en usuarios.",
      "Validar incidencias sin ticket y decidir escalado."
    ], 2);

    const bodyMarkdown = [
      "# Seguimiento operativo diario",
      "",
      `- Fecha: ${formatDashboardTimestamp(reportDate)}`,
      `- Estado de generación del informe: ${ctx.dailyReport?.id ? "completo" : "pendiente"}`,
      "",
      "## Qué revisar primero",
      ...(topActions.length ? topActions.map((item) => `- ${item}`) : ["- Revisar el estado general y las acciones más urgentes."]),
      "",
      "## Impacto real en usuarios",
      ...(userImpact.length ? userImpact.map((item) => `- ${item}`) : ["- No hay impacto confirmado destacado."]),
      "",
      "## Riesgo técnico aunque no haya ticket",
      ...(technicalRisk.length ? technicalRisk.map((item) => `- ${item}`) : ["- No hay riesgo técnico adicional destacado."]),
      "",
      "## Qué se puede delegar a Codex/Zabbix",
      ...(delegable.length ? delegable.map((item) => `- ${item}`) : ["- Sin tareas delegables destacadas."]),
      "",
      "## Qué requiere intervención humana",
      ...(human.length ? human.map((item) => `- ${item}`) : ["- Sin intervención humana destacada."]),
      "",
      "## Checklist de acciones del día",
      "- Revisar el informe ejecutivo y confirmar prioridades.",
      "- Validar matriz y huecos de monitorización.",
      "- Confirmar si los riesgos críticos tienen ticket o escalado.",
      "- Cerrar el circuito con revisión manual si falta contexto.",
      "",
      "## Datos faltantes",
      ...(ctx.dailyData?.missing_data?.length
        ? ctx.dailyData.missing_data.map((item) => `- ${item}`)
        : ["- No hay datos faltantes relevantes destacados."])
    ].join("\n");

    return {
      type: "email",
      status: "draft",
      recipient_label: "Operación / soporte",
      recipient_email: "",
      subject: `Seguimiento operativo diario - ${formatDashboardTimestamp(reportDate)}`,
      body_markdown: bodyMarkdown,
      body_text: bodyMarkdown,
      source_type: "daily_report",
      source_report_id: source?.report?.id || ctx.dailyReport?.id || "",
      source_incident_id: ""
    };
  }

  function buildMatrixCommunicationDraft(source = {}) {
    const ctx = buildCommunicationContext();
    const reportDate = source?.report?.created_at || ctx.matrixReport?.created_at || new Date().toISOString();
    const rows = (ctx.matrixData?.rows || []).slice(0, 6);
    const bodyMarkdown = [
      "# Borrador sobre matriz de correlación",
      "",
      `- Fecha: ${formatDashboardTimestamp(reportDate)}`,
      "",
      "## Resumen",
      ctx.matrixData?.summary || "Resumen de correlación preparado para revisión manual.",
      "",
      "## Filas destacadas",
      ...(rows.length
        ? rows.map(
            (row) =>
              `- ${row.asset_or_service}: ${row.technical_problem} · ${row.correlation_level} · ${row.priority}`
          )
        : ["- Sin filas disponibles."]),
      "",
      "## Acciones sugeridas",
      "- Revisar filas con prioridad alta.",
      "- Preparar seguimiento manual y validar ticket o escalado."
    ].join("\n");

    return {
      type: "teams",
      status: "draft",
      recipient_label: "Soporte técnico",
      recipient_email: "",
      subject: `Matriz de correlación - ${formatDashboardTimestamp(reportDate)}`,
      body_markdown: bodyMarkdown,
      body_text: bodyMarkdown,
      source_type: "matrix",
      source_report_id: source?.report?.id || ctx.matrixReport?.id || "",
      source_incident_id: ""
    };
  }

  function buildCommunicationDraftPayload(kind, source = {}) {
    if (kind === "executive") {
      return buildExecutiveCommunicationDraft(source);
    }
    if (kind === "technical") {
      return buildTechnicalCommunicationDraft(source);
    }
    if (kind === "operational") {
      return buildOperationalCommunicationDraft(source);
    }
    if (kind === "matrix") {
      return buildMatrixCommunicationDraft(source);
    }
    return defaultCommunicationDraftForm();
  }

  function communicationPresetForReportType(type) {
    if (type === "daily_summary") {
      return "executive";
    }
    if (type === "correlation_matrix") {
      return "matrix";
    }
    if (type === "risks") {
      return "technical";
    }
    if (type === "monitoring_gaps") {
      return "operational";
    }
    return "manual";
  }

  async function loadCommunicationDrafts(options = {}) {
    const { clearMessage = true } = options;
    const activeFilter = options.filter || communicationDraftFilter;
    setIsLoadingCommunicationDrafts(true);
    if (clearMessage) {
      setCommunicationMessage("");
    }

    try {
      const params = new URLSearchParams({
        limit: String(options.limit || 20)
      });
      if (activeFilter.status) {
        params.set("status", activeFilter.status);
      }
      if (activeFilter.type) {
        params.set("type", activeFilter.type);
      }
      if (activeFilter.template_id) {
        params.set("template_id", activeFilter.template_id);
      }

      const response = await fetch(`/api/communications/drafts?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudieron cargar los borradores.");
      }

      const nextDrafts = Array.isArray(data.drafts) ? data.drafts : [];
      setCommunicationDrafts(nextDrafts);
      setCommunicationDraftSummary(data.summary || null);
      setCommunicationDraftViewerDiagnostics((current) => ({
        ...current,
        lastDraftLoadAt: new Date().toISOString(),
        totalAfterCreate: Math.max(Number(data.summary?.total || 0), nextDrafts.length || 0)
      }));
      return { drafts: nextDrafts, summary: data.summary || null };
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudieron cargar los borradores.");
      return { drafts: [], summary: null };
    } finally {
      setIsLoadingCommunicationDrafts(false);
    }
  }

  async function loadCommunicationDraftById(draftId) {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      throw new Error("draft_id es obligatorio.");
    }

    const response = await fetch(communicationDraftUrl(normalizedDraftId));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "No se pudo cargar el borrador.");
    }

    return data.draft || null;
  }

  async function navigateToCommunicationDraftViewer(draftId) {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      throw new Error("draft_id es obligatorio.");
    }

    const path = communicationDraftViewerPath(normalizedDraftId);
    if (typeof window !== "undefined") {
      console.debug("[communications] navigating to draft", {
        draftId: normalizedDraftId,
        url: path
      });
      window.location.href = path;
      return true;
    }

    if (router?.push) {
      await router.push(path);
      return true;
    }

    return false;
  }

  function openCommunicationDraftReview(draftId, message = "") {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      setCommunicationMessage("Escribe un ID de borrador válido.");
      return false;
    }
    setCommunicationReviewDraftId(normalizedDraftId);
    setCommunicationDraftOpenId(normalizedDraftId);
    setActiveView("communications");
    setCommunicationReviewMessage(
      message || `Borrador #${normalizedDraftId} abierto para revisión. No se ha enviado nada.`
    );
    setCommunicationMessage(
      message || `Borrador #${normalizedDraftId} abierto para revisión. No se ha enviado nada.`
    );
    if (typeof window !== "undefined") {
      const url = `/?view=communications&draftId=${encodeURIComponent(normalizedDraftId)}`;
      window.history.replaceState(null, "", url);
    }
    return true;
  }

  function communicationPendingFromDetail(detail = {}) {
    const draft = detail.draft || {};
    const draftId = String(detail.draft_id || draft.id || "").trim();
    if (!draftId) {
      return null;
    }
    return {
      draft_id: draftId,
      recipient_name: String(detail.recipient_name || draft.recipient_name || draft.recipient_label || "el destinatario").trim(),
      recipient_email: String(detail.recipient_email || draft.recipient_email || "").trim(),
      subject: String(detail.subject || draft.subject || "").trim(),
      source: detail.source || "voice",
      created_at: new Date().toISOString()
    };
  }

  function clearPendingVoiceCommunicationState() {
    setPendingVoiceDraftDecision(null);
    setPendingVoiceSendConfirmation(null);
  }

  async function chooseVoiceDraftReview() {
    const pending = pendingVoiceDraftDecision || pendingVoiceSendConfirmation;
    clearPendingVoiceCommunicationState();
    if (pending?.draft_id) {
      openCommunicationDraftReview(
        pending.draft_id,
        "Perfecto. Lo dejo abierto para revisión. No se ha enviado nada."
      );
      return;
    }
    setCommunicationMessage("No hay borrador pendiente de decisión.");
  }

  async function requestVoiceDraftDirectSend() {
    const pending = pendingVoiceDraftDecision;
    if (!pending?.draft_id) {
      setCommunicationMessage("No tengo un borrador reciente pendiente de envío. Primero prepara o abre un borrador.");
      return null;
    }
    try {
      const draft = normalizeCommunicationDraftRecord(await loadCommunicationDraftById(pending.draft_id));
      const readiness = getCommunicationSendReadiness(draft, {
        allowedDomains: communicationAllowedDomains
      });
      if (!readiness.canDirectSend) {
        setCommunicationMessage(
          readiness.directSendBlockers[0] || "El borrador no está listo para envío directo."
        );
        return null;
      }
      setPendingVoiceDraftDecision(null);
      setPendingVoiceSendConfirmation({
        draft_id: String(draft.id),
        recipient_name: draft.recipient_name || draft.recipient_label || pending.recipient_name,
        recipient_email: draft.recipient_email,
        subject: draft.subject,
        source: "voice",
        created_at: new Date().toISOString()
      });
      openCommunicationDraftReview(
        String(draft.id),
        `Vas a enviar un correo real a ${draft.recipient_email}. ¿Confirmar envío directo?`
      );
      return draft;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo validar el borrador para envío directo.");
      return null;
    }
  }

  async function confirmVoiceDraftDirectSend() {
    const pending = pendingVoiceSendConfirmation;
    if (!pending?.draft_id) {
      setCommunicationMessage("No hay confirmación de envío pendiente.");
      return null;
    }
    try {
      const draft = normalizeCommunicationDraftRecord(await loadCommunicationDraftById(pending.draft_id));
      const sent = await directSendCommunicationDraft(draft, { source: "voice-ui-confirmation" });
      if (sent?.ok !== false) {
        clearPendingVoiceCommunicationState();
      }
      return sent;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo enviar directamente el borrador.");
      return null;
    }
  }

  function cancelVoiceDraftDirectSend() {
    const pending = pendingVoiceSendConfirmation || pendingVoiceDraftDecision;
    clearPendingVoiceCommunicationState();
    if (pending?.draft_id) {
      openCommunicationDraftReview(
        pending.draft_id,
        "De acuerdo. No se ha enviado nada. El borrador queda abierto para revisión."
      );
      return;
    }
    setCommunicationMessage("De acuerdo. No se ha enviado nada.");
  }

  function closeCommunicationDraftReview() {
    setCommunicationReviewDraftId("");
    setCommunicationReviewMessage("");
  }

  function communicationDraftHasActiveFilters(filter = communicationDraftFilter) {
    return Boolean(filter?.status || filter?.type || filter?.template_id);
  }

  function clearCommunicationDraftFilters() {
    const nextFilter = { status: "", type: "", template_id: "" };
    setCommunicationDraftFilter(nextFilter);
    return nextFilter;
  }

  function upsertCommunicationDraftInState(draft) {
    const normalizedDraft = normalizeCommunicationDraftRecord(draft);
    if (!normalizedDraft.id) {
      return normalizedDraft;
    }

    setCommunicationDrafts((current) => {
      const existingIndex = current.findIndex((item) => String(item.id) === String(normalizedDraft.id));
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = { ...next[existingIndex], ...normalizedDraft };
        return next;
      }
      return [normalizedDraft, ...current];
    });

    return normalizedDraft;
  }

  function clearOpenedCommunicationDraft() {
    setCommunicationDraftViewerOpen(false);
    setCommunicationDraftViewerUrl("");
    setCommunicationDraftViewerDraftId("");
    setCommunicationDraftViewerDraft(null);
    setIsCommunicationDraftViewerLoading(false);
    setCommunicationDraftViewerError("");
    setOpenedCommunicationDraft(null);
    setOpenedCommunicationDraftId("");
  }

  function openCommunicationDraftInNewTab(viewerPath) {
    if (typeof window === "undefined" || !viewerPath) {
      return false;
    }

    const opened = window.open(viewerPath, "_blank", "noopener,noreferrer");
    return Boolean(opened);
  }

  function openCommunicationDraftViewerPanel(draftId) {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      setCommunicationMessage("Escribe un ID de borrador válido.");
      return null;
    }

    const viewerUrl = communicationDraftViewerPath(normalizedDraftId);
    setOpenedCommunicationDraft(null);
    setOpenedCommunicationDraftId("");
    setCommunicationDraftViewerDraftId(normalizedDraftId);
    setCommunicationDraftViewerUrl(viewerUrl);
    setCommunicationDraftViewerOpen(true);
    setIsCommunicationDraftViewerLoading(true);
    setCommunicationDraftViewerError("");
    setCommunicationDraftViewerDraft(null);
    setCommunicationMessage(`Borrador #${normalizedDraftId} abierto. No se ha enviado nada.`);
    setActiveView("communications");
    return viewerUrl;
  }

  function closeCommunicationDraftViewerPanel() {
    setCommunicationDraftViewerOpen(false);
    setCommunicationDraftViewerUrl("");
    setCommunicationDraftViewerDraftId("");
    setCommunicationDraftViewerDraft(null);
    setIsCommunicationDraftViewerLoading(false);
    setCommunicationDraftViewerError("");
  }

  async function openCommunicationDraftViewer(draftId, { allowFilterReset = true } = {}) {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      setCommunicationDraftViewerError("Escribe un ID de borrador válido.");
      return null;
    }

    console.debug("[communications] open draft requested", { id: normalizedDraftId });
    setCommunicationDraftViewerDiagnostics((current) => ({
      ...current,
      lastOpenedDraftId: normalizedDraftId,
      getByIdStatus: "loading"
    }));
    setIsCommunicationDraftViewerLoading(true);
    setCommunicationDraftViewerError("");
    setCommunicationDraftViewerOpen(true);
    setCommunicationDraftViewerDraftId(normalizedDraftId);
    setCommunicationDraftViewerUrl(communicationDraftViewerPath(normalizedDraftId));
    setOpenedCommunicationDraft(null);
    setOpenedCommunicationDraftId(normalizedDraftId);
    setCommunicationDraftOpenId(normalizedDraftId);
    setActiveView("communications");

    try {
      const loadedDraft = await loadCommunicationDraftById(normalizedDraftId);
      if (!loadedDraft) {
        throw new Error("Borrador no encontrado.");
      }
      console.debug("[communications] open draft loaded", {
        id: loadedDraft.id,
        hasRecipient: Boolean(loadedDraft.recipient_email),
        hasSubject: Boolean(loadedDraft.subject),
        hasBody: Boolean(loadedDraft.body_markdown || loadedDraft.body_text || loadedDraft.body_html),
        status: loadedDraft.status
      });
      const normalizedDraft = normalizeCommunicationDraftRecord(loadedDraft);
      setCommunicationDraftViewerDraft(normalizedDraft);
      setOpenedCommunicationDraft(normalizedDraft);
      setOpenedCommunicationDraftId(String(normalizedDraft.id || normalizedDraftId));
      setCommunicationDraftViewerDraftId(String(normalizedDraft.id || normalizedDraftId));
      setCommunicationDraftViewerUrl(communicationDraftViewerPath(normalizedDraft.id || normalizedDraftId));
      setCommunicationDraftViewerDiagnostics((current) => ({
        ...current,
        lastOpenedDraftId: String(normalizedDraft.id || normalizedDraftId),
        getByIdStatus: "ok",
        lastDraftLoadAt: new Date().toISOString()
      }));
      upsertCommunicationDraftInState(normalizedDraft);
      setCommunicationMessage(
        `Borrador #${normalizedDraft.id} abierto en Comunicaciones. No se ha enviado nada.`
      );
      return normalizedDraft;
    } catch (error) {
      const message = error?.message || "No se pudo abrir el borrador.";
      setCommunicationDraftViewerDraft(null);
      setOpenedCommunicationDraft(null);
      setCommunicationDraftViewerDiagnostics((current) => ({
        ...current,
        getByIdStatus: "error",
        lastDraftLoadAt: new Date().toISOString()
      }));
      setCommunicationDraftViewerError(message);
      setCommunicationMessage(message);
      return null;
    } finally {
      setIsCommunicationDraftViewerLoading(false);
    }
  }

  async function revealCommunicationDraft(draft, { successMessage, allowFilterReset = true } = {}) {
    if (!draft?.id) {
      return null;
    }

    const nextDraft = normalizeCommunicationDraftRecord(draft);
    setCommunicationDraftEditorMode("edit");
    setSelectedCommunicationDraft(nextDraft);
    setCommunicationDraftForm(communicationDraftToForm(nextDraft));
    setCommunicationDraftOpenId(String(nextDraft.id || ""));
    setSelectedCommunicationTemplateId(nextDraft.template_id || defaultCommunicationTemplateId);
    upsertCommunicationDraftInState(nextDraft);
    setCommunicationSendPreparation((current) =>
      current?.draft?.id === nextDraft.id ? current : null
    );
    setActiveView("communications");

    const currentFilter = communicationDraftFilter;
    const loaded = await loadCommunicationDrafts({ clearMessage: false, filter: currentFilter });
    const visibleDraft = (loaded.drafts || []).some((item) => String(item.id) === String(nextDraft.id));

    if (!visibleDraft && communicationDraftHasActiveFilters(currentFilter) && allowFilterReset) {
      const resetFilter = clearCommunicationDraftFilters();
      await loadCommunicationDrafts({ clearMessage: false, filter: resetFilter });
      setSelectedCommunicationDraft(nextDraft);
      setCommunicationDraftForm(communicationDraftToForm(nextDraft));
      setCommunicationDraftEditorMode("edit");
      const cleanedMessage = `Borrador creado: ID ${nextDraft.id}. Se han limpiado los filtros para mostrarlo.`;
      setCommunicationMessage(successMessage ? `${cleanedMessage} ${successMessage}` : cleanedMessage);
      return nextDraft;
    }

    const recipientLabel = nextDraft.recipient_label || nextDraft.recipient_email || "Sin destinatario";
    const baseMessage = `Borrador creado: ID ${nextDraft.id}, destinatario ${recipientLabel}, estado ${communicationDraftStatusLabel(nextDraft.status)}.`;
    setCommunicationMessage(successMessage ? `${baseMessage} ${successMessage}` : baseMessage);
    return nextDraft;
  }

  async function openCommunicationDraftById(draftId, { successMessage, allowFilterReset = true } = {}) {
    const normalizedDraftId = String(draftId || "").trim();
    console.debug("[communications] open draft requested", { id: normalizedDraftId });
    if (!normalizedDraftId) {
      throw new Error("Escribe un ID de borrador válido.");
    }

    openCommunicationDraftReview(
      normalizedDraftId,
      successMessage || `Borrador #${normalizedDraftId} abierto para revisión. No se ha enviado nada.`
    );
    return { id: normalizedDraftId, viewer_path: communicationDraftViewerPath(normalizedDraftId) };
  }

  async function handleOpenCommunicationDraftByIdSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const draftId = String(formData.get("draftId") || "").trim();
    console.debug("[communications] openById clicked", { id: draftId });
    if (!draftId) {
      setCommunicationMessage("Escribe un ID de borrador válido.");
      return null;
    }

    try {
      return await openCommunicationDraftById(draftId, {
        successMessage: `Borrador abierto directamente por ID ${draftId}.`
      });
    } catch (error) {
      const message = error?.message || "No se pudo abrir el borrador.";
      setCommunicationDraftViewerError(message);
      setCommunicationMessage(message);
      return null;
    }
  }

  function populateCommunicationEditor(draft) {
    const normalizedDraft = normalizeCommunicationDraftRecord(draft);
    setSelectedCommunicationDraft(normalizedDraft);
    setCommunicationDraftEditorMode("edit");
    setCommunicationDraftForm(communicationDraftToForm(normalizedDraft));
    setCommunicationSendPreparation((current) =>
      current?.draft?.id === normalizedDraft.id ? current : null
    );
    setSelectedCommunicationTemplateId(normalizedDraft.template_id || defaultCommunicationTemplateId);
    setCommunicationDraftOpenId(String(normalizedDraft.id || ""));
    setActiveView("communications");
    upsertCommunicationDraftInState(normalizedDraft);
    console.debug("[communications] editor populated", {
      mode: "edit",
      selectedDraftId: normalizedDraft.id || null,
      hasRecipient: Boolean(normalizedDraft.recipient_email),
      hasSubject: Boolean(normalizedDraft.subject),
      hasBody: Boolean(normalizedDraft.body_markdown || normalizedDraft.body_text || normalizedDraft.body_html)
    });
    return normalizedDraft;
  }

  async function loadCommunicationTemplates() {
    try {
      const response = await fetch("/api/communications/templates");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudieron cargar las plantillas.");
      }
      const templates = Array.isArray(data.templates) ? data.templates : [];
      setCommunicationTemplates(templates);
      if (!templates.some((template) => template.id === selectedCommunicationTemplateId)) {
        setSelectedCommunicationTemplateId(templates[0]?.id || defaultCommunicationTemplateId);
      }
      setCommunicationTemplatesMessage("");
      return templates;
    } catch (error) {
      setCommunicationTemplates([]);
      setCommunicationTemplatesMessage(
        error?.message || "No se pudieron cargar las plantillas de comunicación."
      );
      return [];
    }
  }

  async function loadCommunicationSendConfig() {
    try {
      const response = await fetch("/api/communications/send-config");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "No se pudo cargar la configuración de envío.");
      }
      setCommunicationSendConfig({
        allowedDomains: normalizeAllowedDomains(data.allowed_domains || []),
        hasFromUser: Boolean(data.from_user_configured)
      });
      return data;
    } catch {
      setCommunicationSendConfig({
        allowedDomains: [],
        hasFromUser: false
      });
      return null;
    }
  }

  function normalizeDirectoryUser(user) {
    if (!user) {
      return null;
    }

    return {
      ...user,
      display_name: String(user.display_name || "").trim(),
      mail: String(user.mail || "").trim(),
      user_principal_name: String(user.user_principal_name || "").trim(),
      job_title: String(user.job_title || "").trim(),
      department: String(user.department || "").trim(),
      office_location: String(user.office_location || "").trim(),
      business_phone: String(user.business_phone || "").trim(),
      mobile_phone: String(user.mobile_phone || "").trim(),
      account_enabled:
        user.account_enabled === null || user.account_enabled === undefined
          ? null
          : Boolean(user.account_enabled),
      updated_at: String(user.updated_at || "").trim()
    };
  }

  async function loadDirectoryUsers(limit = directoryDefaultLimit) {
    setDirectoryLoading(true);
    setDirectoryMessage("");

    try {
      const response = await fetch(`/api/directory/users?limit=${encodeURIComponent(limit)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar la libreta corporativa.");
      }

      setDirectoryUsers((data.users || []).map(normalizeDirectoryUser).filter(Boolean));
      setDirectorySyncedAt(data.synced_at || "");
      return data.users || [];
    } catch (error) {
      setDirectoryMessage(error?.message || "No se pudo cargar la libreta corporativa.");
      setDirectoryUsers([]);
      return [];
    } finally {
      setDirectoryLoading(false);
    }
  }

  async function searchDirectoryUsers(query, options = {}) {
    const trimmed = String(query || "").trim();
    const limit = options.limit || directoryDefaultLimit;

    if (!trimmed) {
      return loadDirectoryUsers(limit);
    }

    setDirectoryLoading(true);
    setDirectoryMessage("");

    try {
      const response = await fetch(
        `/api/directory/search?q=${encodeURIComponent(trimmed)}&limit=${encodeURIComponent(limit)}`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo buscar en la libreta corporativa.");
      }

      const users = (data.users || []).map(normalizeDirectoryUser).filter(Boolean);
      setDirectoryUsers(users);
      setDirectorySyncedAt(data.synced_at || "");
      return users;
    } catch (error) {
      setDirectoryMessage(error?.message || "No se pudo buscar en la libreta corporativa.");
      setDirectoryUsers([]);
      return [];
    } finally {
      setDirectoryLoading(false);
    }
  }

  async function syncDirectoryUsers() {
    setDirectoryLoading(true);
    setDirectoryMessage("Sincronizando libreta corporativa...");

    try {
      const response = await fetch("/api/directory/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo sincronizar la libreta corporativa.");
      }

      setDirectoryUsers((data.users || []).map(normalizeDirectoryUser).filter(Boolean));
      setDirectorySyncedAt(data.synced_at || new Date().toLocaleString("es-ES"));
      setDirectoryMessage(`Sincronizados ${data.synced || 0} usuarios desde Graph.`);
      return data.users || [];
    } catch (error) {
      setDirectoryMessage(error?.message || "No se pudo sincronizar la libreta corporativa.");
      return [];
    } finally {
      setDirectoryLoading(false);
    }
  }

  async function fetchPowerBiJson(url, options = {}) {
    const nextOptions = { ...options };
    const headers = { ...(options.headers || {}) };

    if (
      nextOptions.body &&
      typeof nextOptions.body === "object" &&
      !(nextOptions.body instanceof FormData) &&
      !(nextOptions.body instanceof URLSearchParams) &&
      !(nextOptions.body instanceof Blob) &&
      !(nextOptions.body instanceof ArrayBuffer) &&
      !(ArrayBuffer.isView(nextOptions.body))
    ) {
      nextOptions.body = JSON.stringify(nextOptions.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    if (Object.keys(headers).length) {
      nextOptions.headers = headers;
    }

    let response;
    try {
      response = await fetch(url, nextOptions);
    } catch (error) {
      const message = String(error?.message || error || "").trim();
      throw new Error(
        /fetch failed|failed to fetch|network\s*error/i.test(message)
          ? "No he podido conectar con Power BI. Reintenta la consulta o revisa el estado del modelo."
          : message || "No he podido conectar con Power BI."
      );
    }
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function appendPowerBiDrawerMessage(entry) {
    setPowerBiDrawerMessages((current) => [...current, entry].slice(-20));
  }

  function appendLocalPowerBiMessage(entry) {
    setLocalPowerBiMessages((current) => [...current, entry].slice(-20));
  }

  function extractIncidentFromOpsVisualResult(result) {
    const visual = result?.visualResult || null;
    if (!visual) {
      return null;
    }

    if (visual.item) {
      return visual.item;
    }

    if (Array.isArray(visual.items) && visual.items.length) {
      return visual.items[0];
    }

    if (visual.current) {
      return visual.current;
    }

    return null;
  }

  function isCreatorEmailRequest(question) {
    const normalized = String(question || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    return (
      normalized.includes("email del creador") ||
      normalized.includes("correo del creador") ||
      normalized.includes("prepara un email al creador") ||
      normalized.includes("prepara email al creador") ||
      normalized.includes("prepara un correo al creador") ||
      normalized.includes("prepara correo al creador") ||
      normalized.includes("preparar un email al creador") ||
      normalized.includes("preparar email al creador") ||
      normalized.includes("preparar un correo al creador") ||
      normalized.includes("preparar correo al creador") ||
      ((normalized.includes("email") || normalized.includes("correo")) &&
        (normalized.includes("prepara") || normalized.includes("preparar")) &&
        (normalized.includes("creador") || normalized.includes("creadora")))
    );
  }

  function isCommunicationDraftRequest(question) {
    const normalized = String(question || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return (
      (normalized.includes("correo") ||
        normalized.includes("email") ||
        normalized.includes("mensaje") ||
        normalized.includes("borrador")) &&
      (normalized.includes("prepara") ||
        normalized.includes("preparar") ||
        normalized.includes("crea") ||
        normalized.includes("crear") ||
        normalized.includes("manda") ||
        normalized.includes("envia") ||
        normalized.includes("enviar") ||
        normalized.includes("avisa"))
    ) || (
      (normalized.includes("dile a ") ||
        normalized.includes("di a ") ||
        normalized.includes("avisa a ") ||
        normalized.includes("informa a ") ||
        normalized.includes("comunica a ")) &&
      (normalized.includes(" que ") || normalized.includes(" de que "))
    );
  }

  function isDirectCommunicationRequest(question) {
    const normalized = String(question || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return (
      normalized.includes("directamente") ||
      normalized.includes("sin revisar") ||
      normalized.includes("envialo ya") ||
      normalized.includes("mandalo ya")
    );
  }

  function updateCurrentIncidentContextFromOpsResult(result, { queryType = "" } = {}) {
    const visual = result?.visualResult || null;
    const item = extractIncidentFromOpsVisualResult(result);
    if (!visual || !item || String(visual.kind || result?.kind || "") !== "incidents_user") {
      return;
    }

    setCurrentIncidentContext({
      incidentId: String(item.id || "").trim(),
      ordering: String(visual.ordering || "created desc / id desc").trim(),
      source: String(result?.source || visual.sourceLabel || "IncidenciasTI / SharePoint").trim(),
      title: String(item.title || "").trim(),
      created: String(item.created || "").trim(),
      modified: String(item.modified || "").trim(),
      creator_name: String(item.creator_name || item.created_by_name || item.requester || "").trim(),
      creator_email: String(item.creator_email || item.created_by_email || "").trim(),
      lastQueryType: String(queryType || result?.kind || "").trim(),
      timestamp: new Date().toISOString()
    });
  }

  function openPowerBiExpandedResult(result) {
    if (!result) {
      return;
    }

    setPowerBiExpandedResult({
      result,
      openedAt: new Date().toISOString()
    });
  }

  function closePowerBiExpandedResult() {
    setPowerBiExpandedResult(null);
  }

  useEffect(() => {
    if (!powerBiExpandedResult) {
      return undefined;
    }

    function handleEscape(event) {
      if (event?.key === "Escape") {
        closePowerBiExpandedResult();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [powerBiExpandedResult]);

  useEffect(() => {
    if (chatDrawerTab !== "powerbi" && powerBiExpandedResult) {
      closePowerBiExpandedResult();
    }
  }, [chatDrawerTab, powerBiExpandedResult]);

  async function handleLocalPowerBiSubmit(event) {
    event?.preventDefault?.();

    const text = String(localPowerBiQuestion || "").trim();
    if (!text) {
      setLocalPowerBiError("La pregunta está vacía. Escribe una pregunta corta sobre ventas o unidades.");
      return;
    }

    const detection = detectPowerBiIntent(text);
    console.debug("[powerbi-local-input]", {
      hasQuestion: Boolean(text),
      questionLength: text.length,
      matched: detection.matched
    });
    if (!detection.matched) {
      const message = `Todavía no puedo responder esa consulta. ${powerBiVoiceHelpText}`;
      const nowIso = new Date().toISOString();
      setLocalPowerBiError(message);
      appendLocalPowerBiMessage({
        id: `${nowIso}-local-rejection`,
        role: "assistant",
        type: "powerbi_rejection",
        source: "Power BI / administracion_ventas",
        createdAt: nowIso,
        content: message,
        result: { message }
      });
      return;
    }

    setLocalPowerBiLoading(true);
    setLocalPowerBiError("");
    appendLocalPowerBiMessage({
      id: `${new Date().toISOString()}-local-user`,
      role: "user",
      type: "powerbi_question",
      source: "Power BI / administracion_ventas",
      createdAt: new Date().toISOString(),
      content: text,
      result: null
    });

    try {
      const routed = await handlePowerBiChatMessage(text, { source: "local-powerbi-input" });
      const nowIso = new Date().toISOString();

      if (!routed?.handled) {
        const message = `Todavía no puedo responder esa consulta. ${powerBiVoiceHelpText}`;
        setLocalPowerBiError(message);
        appendLocalPowerBiMessage({
          id: `${nowIso}-local-unsupported`,
          role: "assistant",
          type: "powerbi_rejection",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: message,
          result: { message }
        });
        return;
      }

      if (routed.rejected) {
        const message = routed.message || "Consulta Power BI rechazada.";
        appendLocalPowerBiMessage({
          id: `${nowIso}-local-rejection`,
          role: "assistant",
          type: "powerbi_rejection",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: message,
          result: { message, interpretation: routed.interpretation || null }
        });
        setLocalPowerBiQuestion("");
        setLocalPowerBiError("");
        return;
      }

      if (routed.error) {
        const message = routed.error || "No se pudo resolver la consulta Power BI.";
        setLocalPowerBiError(message);
        appendLocalPowerBiMessage({
          id: `${nowIso}-local-error`,
          role: "assistant",
          type: "powerbi_error",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: message,
          result: { error: message }
        });
        setLocalPowerBiQuestion("");
        return;
      }

      const response = routed.response || null;
      appendLocalPowerBiMessage({
        id: `${nowIso}-local-result`,
        role: "assistant",
        type: "powerbi_result",
        source: "Power BI / administracion_ventas",
        createdAt: nowIso,
        content: getPowerBiChatMessageContent(routed),
        result: response ? { ...response, generatedAt: nowIso } : null
      });
      setLocalPowerBiQuestion("");
      setLocalPowerBiError("");
    } catch (error) {
      const message = error?.message || "No se pudo resolver la consulta Power BI.";
      setLocalPowerBiError(message);
      appendLocalPowerBiMessage({
        id: `${new Date().toISOString()}-local-error`,
        role: "assistant",
        type: "powerbi_error",
        source: "Power BI / administracion_ventas",
        createdAt: new Date().toISOString(),
        content: message,
        result: { error: message }
      });
    } finally {
      setLocalPowerBiLoading(false);
    }
  }

  async function handleAppOwnedChatSubmit(event) {
    event?.preventDefault?.();
    const prompt = String(localOpsQuestion || "").trim();
    if (!prompt) {
      setLocalOpsError("Escribe una consulta operativa.");
      return;
    }

    const nowIso = new Date().toISOString();
    const textPreviewSafe = prompt.slice(0, 120);
    console.debug("[chat-text] user message captured", {
      source: "appOwnedChatInput",
      textLength: prompt.length,
      textPreviewSafe
    });

    setLocalOpsError("");
    setLocalOpsLoading(true);
    setLocalOpsMessages((current) => [
      ...current,
      {
        id: `${nowIso}-user`,
        role: "user",
        type: "operational_query",
        source: "drawer-local",
        createdAt: nowIso,
        content: prompt
      }
    ]);
    setLastPrompt(prompt);
    setStatusMessage("");
    setLatestOpsResult(null);
    setLatestOpsQuestion(prompt);
    setLatestOpsTimestamp(nowIso);

    try {
      const opsDetection = detectOpsIntent(prompt);
      if (opsDetection?.matched) {
        const routed = await handleOpsChatMessage(prompt, {
          source: "appOwnedChatInput",
          currentIncidentContext
        });
        console.debug("[chat-text] ops route result", {
          handled: Boolean(routed?.handled),
          type: routed?.response?.kind || routed?.kind || "unknown",
          ok: !routed?.error
        });

        if (routed?.handled) {
          const operationPayload = routed?.response || routed?.visualResult || null;
          const operationVisual =
            operationPayload?.visualResult ||
            operationPayload ||
            routed?.visualResult ||
            null;
          const operationSummary =
            operationVisual?.summary ||
            routed?.spokenResponse ||
            routed?.message ||
            "Resultado operativo disponible.";
          const operationTitle = operationVisual?.title || "Consulta operativa";
          const resultMessage =
            operationSummary ||
            operationVisual?.message ||
            operationVisual?.answer ||
            "Resultado operativo disponible.";
          setLocalOpsMessages((current) => [
            ...current,
            {
              id: `${new Date().toISOString()}-assistant`,
              role: "assistant",
              type: "operational_result",
              source:
                operationVisual?.sourceLabel ||
                routed?.source ||
                operationPayload?.sourceLabel ||
                "IncidenciasTI / Zabbix",
              createdAt: new Date().toISOString(),
              title: operationTitle,
              content: resultMessage,
              visualResult: operationVisual
            }
          ]);
          setLatestOpsResult(null);
          setLatestOpsQuestion("");
          setLatestOpsTimestamp("");
          setLocalOpsQuestion("");
          return;
        }

        const fallbackMessage =
          routed?.error ||
          routed?.message ||
          "No he podido consultar esa fuente ahora mismo.";
        setLocalOpsMessages((current) => [
          ...current,
          {
            id: `${new Date().toISOString()}-assistant-error`,
            role: "assistant",
            type: "operational_error",
            source: "IncidenciasTI / Zabbix",
            createdAt: new Date().toISOString(),
            content: fallbackMessage
          }
        ]);
        setLatestOpsResult(null);
        setLatestOpsQuestion("");
        setLatestOpsTimestamp("");
        setLocalOpsQuestion("");
        return;
      }

      const powerBiDetection = detectPowerBiIntent(prompt);
      if (powerBiDetection?.matched) {
        const routed = await handlePowerBiChatMessage(prompt, { source: "appOwnedChatInput" });
        if (routed?.handled) {
          setLocalOpsMessages((current) => [
            ...current,
            {
              id: `${new Date().toISOString()}-assistant-powerbi`,
              role: "assistant",
              type: "powerbi_result",
              source: "Power BI / administracion_ventas",
              createdAt: new Date().toISOString(),
              content: routed?.message || "Consulta Power BI resuelta.",
              visualResult: routed?.response || routed?.visualResult || null
            }
          ]);
          setLatestOpsResult(null);
          setLatestOpsQuestion("");
          setLatestOpsTimestamp("");
          setLocalOpsQuestion("");
          return;
        }
      }

      if (isChatAvailable) {
        await sendUserMessage({ text: prompt });
        setLocalOpsQuestion("");
        setStatusMessage("Consulta enviada al chat.");
      } else {
        throw new Error("ChatKit no está disponible todavía.");
      }
    } catch (error) {
      const message = error?.message || "No se pudo resolver la consulta operativa.";
      setLocalOpsError(message);
      setLocalOpsMessages((current) => [
        ...current,
        {
          id: `${new Date().toISOString()}-assistant-fallback`,
          role: "assistant",
          type: "operational_error",
          source: "IncidenciasTI / Zabbix",
          createdAt: new Date().toISOString(),
          content: "No he podido consultar esa fuente ahora mismo."
        }
      ]);
      setLatestOpsResult(null);
      setLatestOpsQuestion("");
      setLatestOpsTimestamp("");
    } finally {
      setLocalOpsLoading(false);
    }
  }

  async function handleOpsChatMessage(prompt, { source = "chat", currentIncidentContext: incidentContext = null } = {}) {
    const question = String(prompt || "").trim();
    const creatorEmailRequest = isCreatorEmailRequest(question);
    const detection = detectOpsIntent(question);
    const now = Date.now();

    if (creatorEmailRequest) {
      const incidentCandidate = incidentContext?.incidentId ? incidentContext : null;
      let incident = incidentCandidate ? { ...incidentCandidate } : null;

      if (!incident && /últim[oa]\s+incidencia|últim[oa]\s+ticket|ultima\s+incidencia|ultimo\s+ticket/i.test(question)) {
        const latest = await routeOpsChatQuestion("última incidencia", {
          currentIncidentContext: incidentContext,
          source: source || "chat"
        });
        incident = extractIncidentFromOpsVisualResult({ visualResult: latest?.visualResult || null }) || null;
      }

      if (incident?.incidentId && !incident.id) {
        incident = {
          id: incident.incidentId,
          title: incident.title,
          created: incident.created,
          modified: incident.modified,
          creator_name: incident.creator_name,
          creator_email: incident.creator_email,
          requester: incident.requester,
          created_by_name: incident.created_by_name,
          created_by_email: incident.created_by_email
        };
      }

      const creatorDraftSource = buildCreatorEmailDraftSource(incident);
      if (!creatorDraftSource) {
        const message = "No hay una incidencia en contexto para preparar el email al creador.";
        setLatestOpsResult({
          handled: true,
          unsupported: true,
          spokenResponse: message,
          visualResult: null,
          rejectionReason: message,
          source: INCIDENCES_SOURCE,
          question,
          kind: "incidents_user",
          at: new Date().toISOString()
        });
        setLatestOpsResultSource("text");
        setLatestOpsTimestamp(new Date().toISOString());
        setStatusMessage(message);
        return { handled: true, routed: true, rejected: true, message };
      }

      try {
        const createdDraft = await createIncidentCreatorDraftAndNavigate(incident, {
          source: source || "chat"
        });
        const draftId = createdDraft?.id ? String(createdDraft.id) : "";
        const recipientLabel = createdDraft?.recipient_label || creatorDraftSource.recipient_label;
        const message = draftId
          ? `Borrador #${draftId} creado para ${recipientLabel}. Lo he abierto en Comunicaciones para revisión. No se ha enviado nada.`
          : `Te he preparado un borrador para ${creatorDraftSource.recipient_label}. Revísalo antes de enviarlo manualmente.`;

        setLatestOpsResult({
          handled: true,
          unsupported: false,
          spokenResponse: message,
          visualResult: {
            kind: "incidents_user",
            title: "Borrador para el creador",
            sourceLabel: INCIDENCES_SOURCE,
            live: true,
            ordering: incidentContext?.ordering || "created desc / id desc",
            summary: message,
            item: incident || null,
            items: incident ? [incident] : [],
            question,
            action: "prepare_creator_email",
            draft_id: draftId,
            draft_status: createdDraft?.status || "draft"
          },
          rejectionReason: null,
          source: INCIDENCES_SOURCE,
          question,
          kind: "incidents_user",
          at: new Date().toISOString()
        });
        setLatestOpsResultSource("text");
        setLatestOpsTimestamp(new Date().toISOString());
        setStatusMessage(message);
        updateCurrentIncidentContextFromOpsResult(
          {
            kind: "incidents_user",
            source: INCIDENCES_SOURCE,
            visualResult: {
              kind: "incidents_user",
              item: incident || null,
              items: incident ? [incident] : [],
              ordering: incidentContext?.ordering || "created desc / id desc"
            }
          },
          { queryType: "creator_email_request" }
        );
        return { handled: true, routed: true, response: createdDraft || incident || null };
      } catch (error) {
        const message = error?.message || "No se pudo preparar el borrador para el creador.";
        setLatestOpsResult({
          handled: true,
          unsupported: false,
          spokenResponse: message,
          visualResult: null,
          rejectionReason: message,
          source: INCIDENCES_SOURCE,
          question,
          kind: "incidents_user",
          at: new Date().toISOString()
        });
        setLatestOpsResultSource("text");
        setLatestOpsTimestamp(new Date().toISOString());
        setStatusMessage(message);
        return { handled: true, routed: true, error: message };
      }
    }

    if (isCommunicationDraftRequest(question)) {
      try {
        const directSendRequested = isDirectCommunicationRequest(question);
        const response = await fetch("/api/communications/voice-draft", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            transcript: question,
            requestedRecipientName: "",
            requestedAction: directSendRequested
              ? "communication_direct_send_request"
              : "voice_prepare_communication_draft",
            directSendRequested,
            source: source || "chat",
            currentIncidentContext: currentIncidentContext?.incidentId
              ? {
                  incidentId: currentIncidentContext.incidentId,
                  title: currentIncidentContext.title,
                  creator_name: currentIncidentContext.creator_name,
                  creator_email: currentIncidentContext.creator_email,
                  created_by_name: currentIncidentContext.creator_name,
                  created_by_email: currentIncidentContext.creator_email
                }
              : null
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || "No se pudo crear el borrador.");
        }

        const draftId = String(data.draft_id || data.draft?.id || "").trim();
        const loadedDraft = await loadCreatedDraftAndNavigate(draftId);
        const missingEmailMessage = loadedDraft?.recipient_email
          ? ""
          : " Falta indicar el email destinatario antes de preparar el envío.";
        const message =
          data.action === "communication_direct_sent"
            ? `Borrador #${draftId} enviado directamente a ${data.recipient_email || loadedDraft?.recipient_email || "el destinatario"}. No se puede reenviar este mismo borrador.`
            : `Borrador #${draftId} creado. Lo he abierto en Comunicaciones para revisión. No se ha enviado nada.${missingEmailMessage}`;
        setStatusMessage(message);
        setCommunicationMessage(message);
        setLatestOpsResult({
          handled: true,
          unsupported: false,
          spokenResponse: message,
          visualResult: {
            kind: "communications",
            title: "Borrador de comunicación",
            sourceLabel: "Comunicaciones",
            live: true,
            summary: message,
            action: data.action || "communication_draft_created",
            draft_id: draftId,
            view_url: data.view_url || communicationDraftViewerPath(draftId),
            draft_status: loadedDraft?.status || data.status || "draft"
          },
          rejectionReason: null,
          source: "Comunicaciones",
          question,
          kind: "communications",
          at: new Date().toISOString()
        });
        setLatestOpsResultSource("text");
        setLatestOpsTimestamp(new Date().toISOString());
        return { handled: true, routed: true, response: loadedDraft };
      } catch (error) {
        const message = error?.message || "No se pudo crear el borrador.";
        setStatusMessage(message);
        setCommunicationMessage(message);
        return { handled: true, routed: true, error: message };
      }
    }

    if (!detection || detection.kind === "unknown") {
      return { handled: false };
    }

    console.debug("[ops-chat router]", {
      source,
      hasQuestion: Boolean(question),
      questionLength: question.length,
      kind: detection.kind
    });

    setLastPrompt(question);
    setStatusMessage("Interpretando consulta operativa limitada...");
    setLatestOpsQuestion(question);
    setLatestOpsResult(null);

    try {
      const routed = await routeOpsChatQuestion(question, {
        currentIncidentContext: incidentContext,
        source: source || "chat"
      });
      const nowIso = new Date().toISOString();

      if (!routed.routed) {
        const message = formatOpsUnsupportedResponse(
          "La consulta no parece ser de IncidenciasTI ni de Zabbix."
        );
        setLatestOpsResult({
          handled: false,
          unsupported: true,
          spokenResponse: message,
          visualResult: null,
          rejectionReason: message,
          source: "IncidenciasTI / Zabbix",
          question,
          at: nowIso
        });
        setLatestOpsResultSource("text");
        setLatestOpsTimestamp(nowIso);
        updateCurrentIncidentContextFromOpsResult(
          {
            kind: routed.kind,
            source: routed.sourceLabel,
            visualResult: routed.visualResult
          },
          { queryType: detection.kind }
        );
        setStatusMessage(message);
        return { handled: true, routed: false, message };
      }

      if (!routed.handled) {
        const message = routed.message || formatOpsUnsupportedResponse();
        setLatestOpsResult({
          handled: true,
          unsupported: true,
          spokenResponse: message,
          visualResult: routed.visualResult || null,
          rejectionReason: message,
          source: routed.sourceLabel || "IncidenciasTI / Zabbix",
          question,
          kind: routed.kind || detection.kind,
          at: nowIso
        });
        setLatestOpsResultSource("text");
        setLatestOpsTimestamp(nowIso);
        updateCurrentIncidentContextFromOpsResult(
          {
            kind: routed.kind,
            source: routed.sourceLabel,
            visualResult: routed.visualResult
          },
          { queryType: detection.kind }
        );
        setStatusMessage(message);
        console.debug("[ops-chat]", {
          source,
          handled: false,
          kind: routed.kind || detection.kind
        });
        return { handled: true, routed: true, rejected: true, message };
      }

      let visualResult = routed.visualResult || null;
      if (visualResult?.action === "prepare_creator_email" && !visualResult?.draft_id) {
        const incident = extractIncidentFromOpsVisualResult({ visualResult });
        if (!incident?.id) {
          throw new Error("No hay una incidencia en contexto para preparar el email al creador.");
        }
        const createdDraft = await createIncidentCreatorDraftAndNavigate(incident, {
          source: source || "ops-router"
        });
        const draftId = String(createdDraft?.id || createdDraft?.draft_id || "").trim();
        const message = `Borrador #${draftId} creado. Lo he abierto en Comunicaciones para revisión. No se ha enviado nada.`;
        visualResult = {
          ...visualResult,
          summary: message,
          draft_id: draftId,
          view_url: createdDraft.view_url || createdDraft.viewer_path || communicationDraftViewerPath(draftId),
          draft_status: createdDraft.status || "draft"
        };
        routed.spokenResponse = message;
      }
      if (visualResult?.action === "communication_direct_sent" && visualResult?.draft_id) {
        const directSendMessage =
          routed.spokenResponse ||
          `He enviado el correo directamente a ${visualResult.recipient_email || "el creador"}.`;
        setCommunicationSendPreparation(null);
        openCommunicationDraftReview(
          visualResult.draft_id,
          `${directSendMessage} No se puede reenviar este mismo borrador.`
        );
      }
      setLatestOpsResult({
        handled: true,
        unsupported: false,
        spokenResponse: routed.spokenResponse || routed.message || "",
        visualResult,
        rejectionReason: null,
        source: routed.sourceLabel || "IncidenciasTI / Zabbix",
        question,
        kind: routed.kind || detection.kind,
        at: nowIso
      });
      setLatestOpsResultSource("text");
      setLatestOpsTimestamp(nowIso);
      updateCurrentIncidentContextFromOpsResult(
        {
          kind: routed.kind,
          source: routed.sourceLabel,
          visualResult
        },
        { queryType: detection.kind }
      );
      console.debug("[ops-chat]", {
        source,
        handled: true,
        kind: routed.kind || detection.kind,
        sourceLabel: routed.sourceLabel || "IncidenciasTI / Zabbix"
      });
      setStatusMessage("Consulta operativa completada en modo limitado.");
      return { handled: true, routed: true, response: visualResult };
    } catch (error) {
      const message = error?.message || "No se pudo resolver la consulta operativa.";
      setLatestOpsResult({
        handled: true,
        unsupported: false,
        spokenResponse: message,
        visualResult: null,
        rejectionReason: message,
        source: "IncidenciasTI / Zabbix",
        question,
        at: new Date().toISOString()
      });
      setLatestOpsResultSource("text");
      setLatestOpsTimestamp(new Date().toISOString());
      setStatusMessage(message);
      return { handled: true, routed: true, error: message };
    }
  }

  function selectIncidentFromOpsResult(incident) {
    if (!incident) {
      return;
    }

    setChatPanelOpen(true);
    setCurrentIncidentContext({
      incidentId: String(incident.id || "").trim(),
      ordering: String(latestOpsResult?.visualResult?.ordering || "created desc / id desc").trim(),
      source: String(latestOpsResult?.source || latestOpsResult?.visualResult?.sourceLabel || "IncidenciasTI / SharePoint").trim(),
      title: String(incident.title || "").trim(),
      created: String(incident.created || "").trim(),
      modified: String(incident.modified || "").trim(),
      creator_name: String(incident.creator_name || incident.requester || "").trim(),
      creator_email: String(incident.creator_email || "").trim(),
      lastQueryType: String(latestOpsResult?.kind || "selection").trim(),
      timestamp: new Date().toISOString()
    });
    setChatDrawerTab("agent");
  }

  async function handleOpsPreviousIncident() {
    return navigateIncidentRelative("previous");
  }

  async function handleOpsNextIncident() {
    return navigateIncidentRelative("next");
  }

  async function handlePrepareCreatorEmailFromIncident(incident) {
    return prepareIncidentCreatorEmail(incident);
  }

  function buildCreatorEmailDraftSource(incident) {
    if (!incident) {
      return null;
    }

    const recipientEmail = String(incident.creator_email || incident.created_by_email || "").trim();
    const incidentId = String(incident.id || incident.incidentId || incident.source_incident_id || "").trim();
    if (!incidentId) {
      return null;
    }

    return {
      recipient_label: String(
        incident.creator_name || incident.created_by_name || incident.requester || "Creador de la incidencia"
      ).trim(),
      recipient_email: recipientEmail,
      source_type: "incident",
      source_incident_id: incidentId,
      custom_context: {
        incident_id: incidentId,
        incident_title: String(incident.title || "").trim(),
        creator_name: String(incident.creator_name || incident.created_by_name || incident.requester || "").trim(),
        creator_email: recipientEmail
      }
    };
  }

  async function createIncidentCreatorDraftAndNavigate(incident, { source = "chat" } = {}) {
    const creatorDraftSource = buildCreatorEmailDraftSource(incident);
    if (!creatorDraftSource) {
      throw new Error("No hay una incidencia en contexto para preparar el email al creador.");
    }

    const incidentId = String(creatorDraftSource.source_incident_id || "").trim();
    if (!incidentId) {
      throw new Error("No hay una incidencia en contexto para preparar el email al creador.");
    }

    const recipientDomain = String(creatorDraftSource.recipient_email || "").split("@")[1] || "";
    console.debug("[communications] create creator draft requested", {
      action: "prepare_creator_email",
      source,
      incident_id: incidentId,
      has_creator_email: Boolean(creatorDraftSource.recipient_email),
      recipient_domain: recipientDomain
    });

    const response = await fetch("/api/communications/draft-from-incident", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "prepare_creator_email",
        incident_id: incidentId,
        incident_title: creatorDraftSource.custom_context?.incident_title || incident?.title || "",
        recipient_name: creatorDraftSource.recipient_label,
        recipient_email: creatorDraftSource.recipient_email
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "No se pudo crear el borrador para el creador.");
    }

    const draftId = String(data.draft_id || data.draft?.id || "").trim();
    if (!draftId) {
      throw new Error("No se recibió draft_id del borrador creado.");
    }

    const verifiedDraft = await loadCommunicationDraftById(draftId);
    if (!verifiedDraft?.id) {
      throw new Error("El borrador se creó pero no se pudo verificar por ID.");
    }

    const normalizedDraft = normalizeCommunicationDraftRecord(verifiedDraft);
    const viewUrl = data.view_url || communicationDraftViewerPath(draftId);
    setCommunicationDraftOpenId(draftId);
    setLastCreatedDraftId(draftId);
    upsertCommunicationDraftInState(normalizedDraft);
    await loadCommunicationDrafts({ clearMessage: false, filter: communicationDraftFilter });

    console.debug("[communications] create creator draft completed", {
      action: "prepare_creator_email",
      source,
      incident_id: incidentId,
      has_creator_email: Boolean(normalizedDraft.recipient_email),
      recipient_domain: String(normalizedDraft.recipient_email || "").split("@")[1] || "",
      draft_created: true,
      draft_id: draftId,
      total_before: data.total_before,
      total_after: data.total_after
    });

    openCommunicationDraftReview(
      draftId,
      `Borrador #${draftId} creado y abierto en Comunicaciones. No se ha enviado nada.`
    );

    return {
      ...normalizedDraft,
      draft_id: draftId,
      viewer_path: viewUrl,
      view_url: viewUrl,
      total_before: data.total_before,
      total_after: data.total_after,
      navigated: typeof window !== "undefined"
    };
  }

  async function prepareIncidentCreatorEmail(incident) {
    const creatorDraftSource = buildCreatorEmailDraftSource(incident);
    if (!creatorDraftSource) {
      setCommunicationMessage("No hay una incidencia en contexto para preparar el email al creador.");
      setActiveView("communications");
      return null;
    }

    try {
      return await createIncidentCreatorDraftAndNavigate(incident, {
        source: "incident-card"
      });
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo preparar el borrador para el creador.");
      return null;
    }
  }

  async function navigateIncidentRelative(direction) {
    const current = currentIncidentContext;
    const query =
      direction === "previous"
        ? "dime la anterior"
        : direction === "next"
          ? "dime la siguiente"
          : "la anterior";

    if (!current?.incidentId) {
      setStatusMessage("¿Anterior a qué incidencia? Ahora puedo navegar desde una incidencia concreta.");
      return null;
    }

    const result = await handleOpsChatMessage(query, {
      source: `incident-${direction}`,
      currentIncidentContext: current
    });

    if (result?.response) {
      setChatPanelOpen(true);
      setChatDrawerTab("agent");
    }
    return result;
  }

  async function handlePowerBiChatMessage(prompt, { source = "chat" } = {}) {
    const question = String(prompt || "").trim();
    const detection = detectPowerBiIntent(question);
    const now = Date.now();

    if (
      question &&
      powerBiChatHandledRef.current.text === question &&
      now - powerBiChatHandledRef.current.at < 1500
    ) {
      return { handled: true, routed: true, duplicate: true };
    }

    console.debug("Power BI chat router", {
      source,
      hasQuestion: Boolean(question),
      questionLength: question.length,
      matched: detection.matched
    });

    if (!detection.matched) {
      return { handled: false };
    }

    setActiveView("powerbi");
    setChatPanelOpen(true);
    setChatDrawerTab("powerbi");
    setLastPrompt(question);
    setStatusMessage("Interpretando consulta Power BI limitada...");
    setPowerBiChatAnswer(null);
    setLatestPowerBiQuestion(question);
    try {
      const powerBiRoute = await routePowerBiChatQuestion(question);
      const nowIso = new Date().toISOString();

      if (!powerBiRoute.routed) {
        const message = "No se pudo enrutar la consulta Power BI.";
        const entry = {
          id: `${nowIso}-error`,
          role: "assistant",
          type: "powerbi_error",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: message,
          result: { error: message }
        };
        appendPowerBiDrawerMessage(entry);
        setStatusMessage(message);
        setLatestPowerBiResult({
          handled: true,
          unsupported: false,
          spokenResponse: message,
          visualResult: null,
          rejectionReason: message,
          source: "Power BI / administracion_ventas",
          question,
          at: nowIso
        });
        setLatestPowerBiResultSource("text");
        setLatestPowerBiTimestamp(nowIso);
        setPowerBiChatAnswer(null);
        powerBiChatHandledRef.current = {
          text: question,
          at: now
        };
        return { handled: true, routed: false, message };
      }

      if (!powerBiRoute.handled) {
        const message =
          powerBiRoute.message ||
          formatPowerBiUnsupportedResponse(
            powerBiRoute.interpretation?.warnings?.[0] ||
              powerBiRoute.interpretation?.clarificationQuestion
          );
        const entry = {
          id: `${nowIso}-rejection`,
          role: "assistant",
          type: "powerbi_rejection",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: message,
          result: {
            message,
            interpretation: powerBiRoute.interpretation || null
          }
        };
        appendPowerBiDrawerMessage(entry);
        setStatusMessage(message);
        setLatestPowerBiResult({
          handled: true,
          unsupported: true,
          spokenResponse: message,
          visualResult: null,
          rejectionReason: message,
          source: "Power BI / administracion_ventas",
          question,
          at: nowIso
        });
        setLatestPowerBiResultSource("text");
        setLatestPowerBiTimestamp(nowIso);
        setPowerBiChatAnswer(null);
        powerBiChatHandledRef.current = {
          text: question,
          at: now
        };
        return { handled: true, routed: true, message, rejected: true };
      }

      const renderedResult = powerBiRoute.formatted || null;
      const entry = {
        id: `${nowIso}-result`,
        role: "assistant",
        type: "powerbi_result",
        source: "Power BI / administracion_ventas",
        createdAt: nowIso,
        content: getPowerBiChatMessageContent(powerBiRoute),
        result: renderedResult ? { ...renderedResult, generatedAt: nowIso } : null
      };
      appendPowerBiDrawerMessage(entry);
      setPowerBiChatAnswer(renderedResult ? { ...renderedResult, generatedAt: nowIso } : null);
      setLatestPowerBiResult({
        handled: true,
        unsupported: false,
        spokenResponse: powerBiRoute.message || getPowerBiChatMessageContent(powerBiRoute),
        visualResult: renderedResult ? { ...renderedResult, generatedAt: nowIso } : null,
        rejectionReason: null,
        source: "Power BI / administracion_ventas",
        question,
        at: nowIso
      });
      setLatestPowerBiResultSource("text");
      setLatestPowerBiTimestamp(nowIso);
      powerBiChatHandledRef.current = {
        text: question,
        at: now
      };
      console.debug("[powerbi-chat]", {
        source,
        handled: true,
        resultType: entry.type,
        rowCount: renderedResult?.rowCount || 0
      });
      setStatusMessage("Consulta Power BI completada en modo limitado.");
      return { handled: true, routed: true, response: powerBiRoute.formatted || null };
    } catch (error) {
      const message = error?.message || "No se pudo resolver la consulta Power BI.";
      appendPowerBiDrawerMessage({
        id: `${new Date().toISOString()}-error`,
        role: "assistant",
        type: "powerbi_error",
        source: "Power BI / administracion_ventas",
        createdAt: new Date().toISOString(),
        content: message,
        result: { error: message }
      });
      setLatestPowerBiResult({
        handled: true,
        unsupported: false,
        spokenResponse: message,
        visualResult: null,
        rejectionReason: message,
        source: "Power BI / administracion_ventas",
        question,
        at: new Date().toISOString()
      });
      setLatestPowerBiResultSource("text");
      setLatestPowerBiTimestamp(new Date().toISOString());
      setPowerBiChatAnswer(null);
      setStatusMessage(message);
      powerBiChatHandledRef.current = {
        text: question,
        at: now
      };
      return { handled: true, routed: true, error: message };
    }
  }

  function normalizePowerBiStatusPayload(payload) {
    const status = payload?.status || payload || {};
    return {
      ok: Boolean(status.ok),
      enabled: Boolean(status.enabled),
      configured: Boolean(status.configured),
      token_ok: Boolean(status.token_ok),
      token_error: String(status.token_error || "").trim(),
      models_total: Number(status.models_total || 0),
      models_enabled: Number(status.models_enabled || 0),
      models_disabled: Number(status.models_disabled || 0),
      token_cached: Boolean(status.token_cached)
    };
  }

  function normalizePowerBiModelPayload(model) {
    if (!model) {
      return null;
    }

    const key = String(model.key || "").trim();
    if (!key) {
      return null;
    }

    return {
      key,
      displayName: String(model.displayName || "").trim(),
      area: String(model.area || "").trim(),
      enabled: Boolean(model.enabled),
      description: String(model.description || "").trim() || null
    };
  }

  function normalizePowerBiDatasetPayload(payload) {
    if (!payload) {
      return null;
    }

    return {
      ok: Boolean(payload.ok),
      id: String(payload.dataset?.id || payload.id || "").trim(),
      name: String(payload.dataset?.name || payload.name || "").trim() || null,
      description:
        String(payload.dataset?.description || payload.description || "").trim() || null,
      configuredBy:
        String(payload.dataset?.configuredBy || payload.configuredBy || "").trim() || null,
      isEffectiveIdentityRequired:
        payload.dataset?.isEffectiveIdentityRequired ?? payload.isEffectiveIdentityRequired ?? null,
      isEffectiveIdentityRolesRequired:
        payload.dataset?.isEffectiveIdentityRolesRequired ??
        payload.isEffectiveIdentityRolesRequired ??
        null,
      isOnPremGatewayRequired:
        payload.dataset?.isOnPremGatewayRequired ?? payload.isOnPremGatewayRequired ?? null,
      isRefreshable: payload.dataset?.isRefreshable ?? payload.isRefreshable ?? null,
      targetStorageMode:
        String(payload.dataset?.targetStorageMode || payload.targetStorageMode || "").trim() ||
        null,
      webUrl: String(payload.dataset?.webUrl || payload.webUrl || "").trim() || null,
      error: String(payload.error || payload.dataset?.error || "").trim() || null
    };
  }

  function normalizePowerBiReportsPayload(payload) {
    if (!payload) {
      return null;
    }

    return {
      ok: Boolean(payload.ok),
      reports: Array.isArray(payload.reports)
        ? payload.reports.map((report) => ({
            id: String(report.id || "").trim(),
            name: String(report.name || "").trim(),
            datasetId: String(report.datasetId || "").trim() || null,
            reportType: String(report.reportType || "").trim() || null,
            format: String(report.format || "").trim() || null,
            webUrl: String(report.webUrl || "").trim() || null
          }))
        : [],
      error: String(payload.error || "").trim() || null
    };
  }

  function normalizePowerBiSchemaPayload(payload) {
    if (!payload) {
      return null;
    }

    return {
      ok: Boolean(payload.ok),
      schemaAvailable: payload.schemaAvailable ?? false,
      reason: String(payload.reason || "").trim() || null,
      nextStep: String(payload.nextStep || "").trim() || null,
      error: String(payload.error || "").trim() || null
    };
  }

  function normalizePowerBiTestQueryPayload(payload) {
    if (!payload) {
      return null;
    }

    return {
      ok: Boolean(payload.ok),
      query: String(payload.query || 'EVALUATE ROW("ok", 1)').trim(),
      rows: Number(payload.rows || 0),
      tables: Number(payload.tables || 0),
      value: payload.value ?? null,
      error: String(payload.error || "").trim() || null
    };
  }

  function normalizePowerBiCatalogPayload(payload) {
    if (!payload) {
      return null;
    }

    const tables = Array.isArray(payload.tables) ? payload.tables : [];
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const measures = Array.isArray(payload.measures) ? payload.measures : [];
    const relationships = Array.isArray(payload.relationships) ? payload.relationships : [];
    const hierarchies = Array.isArray(payload.hierarchies) ? payload.hierarchies : [];
    const warnings = Array.isArray(payload.warnings)
      ? payload.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
      : [];

    return {
      ok: Boolean(payload.ok),
      modelKey: String(payload.modelKey || "").trim() || null,
      displayName: String(payload.displayName || "").trim() || null,
      area: String(payload.area || "").trim() || null,
      catalogAvailable: payload.catalogAvailable ?? false,
      xmlaAvailable: payload.xmlaAvailable ?? false,
      source: String(payload.source || "").trim() || null,
      generatedAt: String(payload.generatedAt || "").trim() || null,
      reason: String(payload.reason || "").trim() || null,
      error: String(payload.error || "").trim() || null,
      warnings,
      summary: {
        tables: Number(payload.summary?.tables || tables.length || 0),
        columns: Number(payload.summary?.columns || columns.length || 0),
        measures: Number(payload.summary?.measures || measures.length || 0),
        relationships: Number(payload.summary?.relationships || relationships.length || 0),
        hierarchies: Number(payload.summary?.hierarchies || hierarchies.length || 0)
      },
      cache: payload.cache || null
    };
  }

function normalizePowerBiImportStatusPayload(payload) {
  if (!payload) {
    return null;
  }

    return {
      ok: Boolean(payload.ok),
      folder: String(payload.folder || "").trim() || null,
      folder_exists: payload.folder_exists ?? false,
      file_count: Number(payload.file_count || 0),
      tmdl_files: Number(payload.tmdl_files || 0),
      json_files: Number(payload.json_files || 0),
      pbip_files: Number(payload.pbip_files || 0),
      source_candidate: String(payload.source_candidate || "").trim() || null,
      imported: payload.imported ?? false,
      imported_at: String(payload.imported_at || "").trim() || null,
      updated_at: String(payload.updated_at || "").trim() || null,
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
    error: String(payload.error || "").trim() || null
  };
}

function normalizePowerBiBusinessDictionaryPayload(payload) {
  if (!payload) {
    return null;
  }

  const dictionary = payload.dictionary || payload;
  const summary = payload.quality?.counts || payload.summary || {};

  return {
    ok: Boolean(payload.ok),
    saved: payload.saved ?? false,
    generated: payload.generated ?? false,
    modelKey: String(payload.modelKey || dictionary?.modelKey || "").trim() || null,
    displayName: String(payload.displayName || dictionary?.displayName || "").trim() || null,
    draft: payload.draft ?? dictionary?.draft ?? false,
    businessDescription:
      String(dictionary?.businessDescription || payload.businessDescription || "").trim() || null,
    defaultDateTable: String(dictionary?.defaultDateTable || payload.defaultDateTable || "").trim() || null,
    defaultDateColumn:
      String(dictionary?.defaultDateColumn || payload.defaultDateColumn || "").trim() || null,
    defaultCurrency:
      String(dictionary?.defaultCurrency || payload.defaultCurrency || "").trim() || null,
    entities: Array.isArray(dictionary?.entities) ? dictionary.entities : [],
    metrics: Array.isArray(dictionary?.metrics) ? dictionary.metrics : [],
    dimensions: Array.isArray(dictionary?.dimensions) ? dictionary.dimensions : [],
    timeDimensions: Array.isArray(dictionary?.timeDimensions) ? dictionary.timeDimensions : [],
    synonyms: Array.isArray(dictionary?.synonyms) ? dictionary.synonyms : [],
    hiddenObjects: Array.isArray(dictionary?.hiddenObjects) ? dictionary.hiddenObjects : [],
    technicalObjects: Array.isArray(dictionary?.technicalObjects) ? dictionary.technicalObjects : [],
    warnings: Array.isArray(dictionary?.warnings)
      ? dictionary.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
      : [],
    sourceCatalog: dictionary?.sourceCatalog || null,
    generatedAt: String(dictionary?.generatedAt || payload.generatedAt || "").trim() || null,
    updatedAt: String(dictionary?.updatedAt || payload.updatedAt || "").trim() || null,
    quality: payload.quality || null,
    summary: {
      entities: Number(summary.entities || dictionary?.entities?.length || 0),
      metrics: Number(summary.metrics || dictionary?.metrics?.length || 0),
      dimensions: Number(summary.dimensions || dictionary?.dimensions?.length || 0),
      dates: Number(summary.dates || dictionary?.timeDimensions?.length || 0),
      synonyms: Number(summary.synonyms || dictionary?.synonyms?.length || 0),
      warnings: Number(summary.warnings || dictionary?.warnings?.length || 0)
    },
    status: String(payload.quality?.status || payload.status || "").trim() || null,
    score: Number(payload.quality?.score || payload.score || 0),
    issues: Array.isArray(payload.quality?.issues)
      ? payload.quality.issues.map((issue) => String(issue || "").trim()).filter(Boolean)
      : [],
    recommendations: Array.isArray(payload.quality?.recommendations)
      ? payload.quality.recommendations.map((item) => String(item || "").trim()).filter(Boolean)
      : []
  };
}

function normalizePowerBiBusinessDictionaryQualityPayload(payload) {
  if (!payload) {
    return null;
  }

  const summary = payload.summary || payload.quality?.counts || {};

  return {
    ok: Boolean(payload.ok),
    saved: payload.saved ?? false,
    generated: payload.generated ?? false,
    dictionaryAvailable: payload.dictionaryAvailable ?? false,
    status: String(payload.quality?.status || payload.status || "").trim() || null,
    score: Number(payload.quality?.score || payload.score || 0),
    issues: Array.isArray(payload.quality?.issues || payload.issues)
      ? (payload.quality?.issues || payload.issues)
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    recommendations: Array.isArray(payload.quality?.recommendations || payload.recommendations)
      ? (payload.quality?.recommendations || payload.recommendations)
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    summary: {
      entities: Number(summary.entities || 0),
      metrics: Number(summary.metrics || 0),
      dimensions: Number(summary.dimensions || 0),
      dates: Number(summary.dates || 0),
      synonyms: Number(summary.synonyms || 0),
      warnings: Number(summary.warnings || 0)
    }
  };
}

function normalizePowerBiDaxLabStatusPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    ok: Boolean(payload.ok),
    enabled: payload.enabled ?? false,
    allowedModelKey: String(payload.allowedModelKey || "").trim() || null,
    allowedIntents: Array.isArray(payload.allowedIntents)
      ? payload.allowedIntents.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    allowedMetrics: Array.isArray(payload.allowedMetrics)
      ? payload.allowedMetrics.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    allowedDimensions: Array.isArray(payload.allowedDimensions)
      ? payload.allowedDimensions.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    allowedTimeRanges: Array.isArray(payload.allowedTimeRanges)
      ? payload.allowedTimeRanges.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    defaultMetric: String(payload.defaultMetric || "").trim() || null,
    defaultDimension: String(payload.defaultDimension || "").trim() || null,
    defaultTimeRange: String(payload.defaultTimeRange || "").trim() || null,
    rowLimit: Number(payload.rowLimit || 0),
    available: payload.available ?? false,
    dictionarySummary: {
      entities: Number(payload.dictionarySummary?.entities || 0),
      metrics: Number(payload.dictionarySummary?.metrics || 0),
      dimensions: Number(payload.dictionarySummary?.dimensions || 0),
      timeDimensions: Number(payload.dictionarySummary?.timeDimensions || 0)
    },
    quality: payload.quality || null,
    error: String(payload.error || "").trim() || null
  };
}

function normalizePowerBiDaxLabPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    ok: Boolean(payload.ok),
    model: payload.model || null,
    intent: String(payload.intent || "").trim() || null,
    metric: String(payload.metric || "").trim() || null,
    dimension: String(payload.dimension || "").trim() || null,
    timeRange: String(payload.timeRange || "").trim() || null,
    topN: Number(payload.topN || 0),
    dax: String(payload.dax || "").trim() || null,
    validation: payload.validation || null,
    rowLimit: Number(payload.rowLimit || 0),
    rowCount: Number(payload.rowCount || 0),
    truncated: payload.truncated ?? false,
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    summary: payload.summary || null,
    error: String(payload.error || "").trim() || null
  };
}

function normalizePowerBiAskInterpretationPayload(payload) {
  if (!payload) {
    return null;
  }

  const source = payload.interpretation || payload;
  return {
    modelKey: String(source.modelKey || "").trim() || null,
    intent: String(source.intent || "").trim() || null,
    metric: String(source.metric || "").trim() || null,
    logicalPage: String(source.logicalPage || source.plan?.logicalPage || "").trim() || null,
    aggregation: String(source.aggregation || "").trim() || null,
    dimension: String(source.dimension || "").trim() || null,
    dimensions: Array.isArray(source.dimensions)
      ? source.dimensions.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    filters: Array.isArray(source.filters) ? source.filters : [],
    dateRange: source.dateRange || null,
    timeRange: String(source.timeRange || "all_time").trim() || null,
    ranking: source.ranking || null,
    comparison: source.comparison || null,
    granularity: String(source.granularity || "").trim() || null,
    topN: Number(source.topN || 0),
    confidence: Number(source.confidence || 0),
    confidenceLabel: String(source.confidenceLabel || "").trim() || null,
    ambiguity: Array.isArray(source.ambiguity)
      ? source.ambiguity.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    missingInfo: Array.isArray(source.missingInfo)
      ? source.missingInfo.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    needsClarification: Boolean(source.needsClarification),
    clarificationQuestion: String(source.clarificationQuestion || "").trim() || null,
    matchedTerms: Array.isArray(source.matchedTerms)
      ? source.matchedTerms.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    warnings: Array.isArray(source.warnings)
      ? source.warnings.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    plan: source.plan || null
  };
}

function normalizePowerBiAskLabPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    ok: Boolean(payload.ok),
    interpretation: normalizePowerBiAskInterpretationPayload(payload.interpretation || payload),
    daxLabPayload: payload.daxLabPayload || null,
    semanticPlan: payload.semanticPlan || payload.interpretation?.plan || null,
    dateField: String(payload.dateField || "").trim() || null,
    logicalPage: String(payload.logicalPage || payload.interpretation?.logicalPage || payload.interpretation?.plan?.logicalPage || "").trim() || null,
    dimensionField: String(payload.dimensionField || "").trim() || null,
    dimensionValidation: payload.dimensionValidation || null,
    dax: String(payload.dax || "").trim() || null,
    validation: payload.validation || null,
    execution: payload.execution || null,
    summary: payload.summary || null,
    naturalSummary: String(payload.naturalSummary || "").trim() || null,
    error: String(payload.error || "").trim() || null
  };
}

function normalizePowerBiBusinessDictionaryReviewPayload(payload) {
  if (!payload) {
    return null;
  }

  const summary = payload.summary || {};
  return {
    ok: Boolean(payload.ok),
    modelKey: String(payload.modelKey || "").trim() || null,
    quality: payload.quality || null,
    score: Number(payload.score || payload.quality?.score || 0),
    summary: {
      entities: Number(summary.entities || 0),
      metrics: Number(summary.metrics || 0),
      dimensions: Number(summary.dimensions || 0),
      dates: Number(summary.dates || 0),
      synonyms: Number(summary.synonyms || 0),
      warnings: Number(summary.warnings || 0),
      officialMeasures: Number(summary.officialMeasures || payload.officialMeasures?.length || 0),
      aggregationMetrics: Number(summary.aggregationMetrics || payload.aggregationMetrics?.length || 0),
      missingDescriptions: Number(summary.missingDescriptions || payload.missingDescriptions?.length || 0),
      unclassifiedNumericColumns: Number(
        summary.unclassifiedNumericColumns || payload.unclassifiedNumericColumns?.length || 0
      ),
      dateCandidates: Number(summary.dateCandidates || payload.dateCandidates?.length || 0),
      hiddenObjects: Number(summary.hiddenObjects || payload.hiddenObjects?.length || 0),
      technicalObjects: Number(summary.technicalObjects || payload.technicalObjects?.length || 0),
      synonymConflicts: Number(summary.synonymConflicts || payload.synonymConflicts?.length || 0)
    },
    officialMeasures: Array.isArray(payload.officialMeasures) ? payload.officialMeasures : [],
    aggregationMetrics: Array.isArray(payload.aggregationMetrics) ? payload.aggregationMetrics : [],
    missingDescriptions: Array.isArray(payload.missingDescriptions) ? payload.missingDescriptions : [],
    unclassifiedNumericColumns: Array.isArray(payload.unclassifiedNumericColumns)
      ? payload.unclassifiedNumericColumns
      : [],
    dateCandidates: Array.isArray(payload.dateCandidates) ? payload.dateCandidates : [],
    hiddenObjects: Array.isArray(payload.hiddenObjects) ? payload.hiddenObjects : [],
    technicalObjects: Array.isArray(payload.technicalObjects) ? payload.technicalObjects : [],
    synonymConflicts: Array.isArray(payload.synonymConflicts) ? payload.synonymConflicts : [],
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
    review: payload.review || null,
    generatedAt: String(payload.generatedAt || "").trim() || null
  };
}

function normalizePowerBiCapabilitiesPayload(payload) {
  if (!payload) {
    return null;
  }

  const limits = payload.limits || {};
  return {
    ok: Boolean(payload.ok),
    modelKey: String(payload.modelKey || "").trim() || null,
    displayName: String(payload.displayName || "").trim() || null,
    supportedMetrics: Array.isArray(payload.supportedMetrics) ? payload.supportedMetrics : [],
    supportedDimensions: Array.isArray(payload.supportedDimensions) ? payload.supportedDimensions : [],
    supportedIntents: Array.isArray(payload.supportedIntents)
      ? payload.supportedIntents.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    supportedTimeRanges: Array.isArray(payload.supportedTimeRanges)
      ? payload.supportedTimeRanges.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    limits: {
      topNMax: Number(limits.topNMax || 0),
      rowLimitMax: Number(limits.rowLimitMax || 0),
      defaultTopN: Number(limits.defaultTopN || 0),
      defaultRowLimit: Number(limits.defaultRowLimit || 0),
      defaultTimeRange: String(limits.defaultTimeRange || "").trim() || null
    },
    supportedQuestions: Array.isArray(payload.supportedQuestions) ? payload.supportedQuestions : [],
    rejectedQuestions: Array.isArray(payload.rejectedQuestions) ? payload.rejectedQuestions : [],
    examples: Array.isArray(payload.examples) ? payload.examples : [],
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    voiceHelp: String(payload.voiceHelp || "").trim() || null,
    supportedUtterances: Array.isArray(payload.supportedUtterances)
      ? payload.supportedUtterances.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    rejectedUtterances: Array.isArray(payload.rejectedUtterances)
      ? payload.rejectedUtterances.map((item) => String(item || "").trim()).filter(Boolean)
      : []
  };
}

function normalizePowerBiCapabilitiesExamplesPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    ok: Boolean(payload.ok),
    modelKey: String(payload.modelKey || "").trim() || null,
    displayName: String(payload.displayName || "").trim() || null,
    voiceHelp: String(payload.voiceHelp || "").trim() || null,
    supportedUtterances: Array.isArray(payload.supportedUtterances)
      ? payload.supportedUtterances.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    examples: Array.isArray(payload.examples) ? payload.examples : [],
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.map((item) => String(item || "").trim()).filter(Boolean)
      : []
  };
}

  async function loadPowerBiModelSnapshot(modelKey) {
    const encodedKey = encodeURIComponent(modelKey);
    const isAdvancedModel = isPowerBiAdvancedModelKey(modelKey);
    const endpoints = {
      status: `/api/powerbi/models/${encodedKey}/status`,
      dataset: `/api/powerbi/models/${encodedKey}/dataset`,
      reports: `/api/powerbi/models/${encodedKey}/reports`,
      schema: `/api/powerbi/models/${encodedKey}/schema`,
      catalog: `/api/powerbi/models/${encodedKey}/catalog`,
      importStatus: `/api/powerbi/models/${encodedKey}/catalog/import-status`,
      testQuery: `/api/powerbi/models/${encodedKey}/test-query`,
      businessCatalog: `/api/powerbi/models/${encodedKey}/catalog/business`,
      businessDictionary: `/api/powerbi/models/${encodedKey}/business-dictionary`,
      businessDictionaryQuality: `/api/powerbi/models/${encodedKey}/business-dictionary/quality`,
      businessDictionaryReview: `/api/powerbi/models/${encodedKey}/business-dictionary/review`,
      capabilities: `/api/powerbi/models/${encodedKey}/capabilities`,
      capabilitiesExamples: `/api/powerbi/models/${encodedKey}/capabilities/examples`,
      daxLabStatus: `/api/powerbi/models/${encodedKey}/dax-lab/status`,
      askStatus: `/api/powerbi/models/${encodedKey}/ask/interpret`
    };

    const [
      statusResult,
      datasetResult,
      reportsResult,
      schemaResult,
      catalogResult,
      businessCatalogResult,
      importStatusResult,
      testQueryResult,
      businessDictionaryResult,
      businessDictionaryQualityResult,
      businessDictionaryReviewResult,
      capabilitiesResult,
      capabilitiesExamplesResult,
      daxLabStatusResult
    ] =
      await Promise.all([
        fetchPowerBiJson(endpoints.status),
        fetchPowerBiJson(endpoints.dataset),
        fetchPowerBiJson(endpoints.reports),
        fetchPowerBiJson(endpoints.schema),
        fetchPowerBiJson(endpoints.catalog),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.businessCatalog)
          : Promise.resolve({ response: { ok: true }, data: null }),
        fetchPowerBiJson(endpoints.importStatus),
        fetchPowerBiJson(endpoints.testQuery, { method: "POST" }),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.businessDictionary)
          : Promise.resolve({ response: { ok: true }, data: null }),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.businessDictionaryQuality)
          : Promise.resolve({ response: { ok: true }, data: null }),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.businessDictionaryReview)
          : Promise.resolve({ response: { ok: true }, data: null }),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.capabilities)
          : Promise.resolve({ response: { ok: true }, data: null }),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.capabilitiesExamples)
          : Promise.resolve({ response: { ok: true }, data: null }),
        isAdvancedModel
          ? fetchPowerBiJson(endpoints.daxLabStatus)
          : Promise.resolve({ response: { ok: true }, data: null })
      ]);

    const statusPayload = normalizePowerBiStatusPayload(statusResult.data);
    const datasetPayload = normalizePowerBiDatasetPayload(datasetResult.data);
    const reportsPayload = normalizePowerBiReportsPayload(reportsResult.data);
    const schemaPayload = normalizePowerBiSchemaPayload(schemaResult.data);
    const catalogPayload = normalizePowerBiCatalogPayload(catalogResult.data);
    const businessCatalogPayload = isAdvancedModel
      ? normalizePowerBiCatalogPayload(businessCatalogResult.data)
      : null;
    const importStatusPayload = normalizePowerBiImportStatusPayload(importStatusResult.data);
    const testQueryPayload = normalizePowerBiTestQueryPayload(testQueryResult.data);
    const businessDictionaryPayload = isAdvancedModel
      ? normalizePowerBiBusinessDictionaryPayload(businessDictionaryResult.data)
      : null;
    const businessDictionaryQualityPayload = isAdvancedModel
      ? normalizePowerBiBusinessDictionaryQualityPayload(businessDictionaryQualityResult.data)
      : null;
    const businessDictionaryReviewPayload = isAdvancedModel
      ? normalizePowerBiBusinessDictionaryReviewPayload(businessDictionaryReviewResult.data)
      : null;
    const capabilitiesPayload = isAdvancedModel
      ? normalizePowerBiCapabilitiesPayload(capabilitiesResult.data)
      : null;
    const capabilitiesExamplesPayload = isAdvancedModel
      ? normalizePowerBiCapabilitiesExamplesPayload(capabilitiesExamplesResult.data)
      : null;
    const daxLabStatusPayload = isAdvancedModel
      ? normalizePowerBiDaxLabStatusPayload(daxLabStatusResult.data)
      : null;

    return {
      status: statusPayload,
      dataset: datasetPayload,
      reports: reportsPayload,
      schema: schemaPayload,
      catalog: catalogPayload,
      businessCatalog: businessCatalogPayload,
      importStatus: importStatusPayload,
      testQuery: testQueryPayload,
      businessDictionary: businessDictionaryPayload,
      businessDictionaryQuality: businessDictionaryQualityPayload,
      businessDictionaryReview: businessDictionaryReviewPayload,
      capabilities: capabilitiesPayload,
      capabilitiesExamples: capabilitiesExamplesPayload,
      daxLabStatus: daxLabStatusPayload
    };
  }

  async function loadPowerBiOverview() {
    setPowerBiLoading(true);
    setPowerBiMessage("");

    try {
      const [statusResponse, modelsResponse] = await Promise.all([
        fetchPowerBiJson("/api/powerbi/status"),
        fetchPowerBiJson("/api/powerbi/models")
      ]);

      if (!statusResponse.response.ok) {
        throw new Error(statusResponse.data?.error || "No se pudo consultar el estado de Power BI.");
      }
      if (!modelsResponse.response.ok) {
        throw new Error(modelsResponse.data?.error || "No se pudieron cargar los modelos de Power BI.");
      }

      const nextStatus = normalizePowerBiStatusPayload(statusResponse.data);
      const nextModels = Array.isArray(modelsResponse.data?.models)
        ? modelsResponse.data.models.map(normalizePowerBiModelPayload).filter(Boolean)
        : [];
      setPowerBiStatus(nextStatus);
      setPowerBiModels(nextModels);

      const snapshots = {};
      await Promise.all(
        nextModels.map(async (model) => {
          snapshots[model.key] = await loadPowerBiModelSnapshot(model.key);
        })
      );
      setPowerBiModelSnapshots(snapshots);
      setPowerBiLoadedAt(new Date().toISOString());
      setPowerBiMessage(
        nextStatus.ok
          ? "Power BI listo para discovery read-only."
          : nextStatus.token_error || "Power BI no está completamente disponible."
      );
      return {
        status: nextStatus,
        models: nextModels,
        snapshots
      };
    } catch (error) {
      setPowerBiMessage(error?.message || "No se pudo cargar Power BI.");
      setPowerBiStatus((current) =>
        current || {
          ok: false,
          enabled: false,
          configured: false,
          token_ok: false,
          token_error: error?.message || "No se pudo cargar Power BI.",
          models_total: 0,
          models_enabled: 0,
          models_disabled: 0,
          token_cached: false
        }
      );
      setPowerBiModelSnapshots({});
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function refreshPowerBiModel(modelKey) {
    if (!modelKey) {
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage(`Actualizando modelo ${modelKey}...`);

    try {
      const snapshot = await loadPowerBiModelSnapshot(modelKey);
      setPowerBiModelSnapshots((current) => ({
        ...current,
        [modelKey]: snapshot
      }));
      setPowerBiMessage(`Modelo ${modelKey} actualizado.`);
      return snapshot;
    } catch (error) {
      setPowerBiMessage(error?.message || "No se pudo actualizar el modelo.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function refreshPowerBiModelCatalog(modelKey) {
    if (!modelKey) {
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage(`Actualizando catálogo de ${modelKey}...`);

    try {
      const encodedKey = encodeURIComponent(modelKey);
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodedKey}/catalog/refresh`,
        {
          method: "POST"
        }
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo refrescar el catálogo.");
      }

      const snapshot = await loadPowerBiModelSnapshot(modelKey);
      setPowerBiModelSnapshots((current) => ({
        ...current,
        [modelKey]: snapshot
      }));
      setPowerBiMessage(`Catálogo de ${modelKey} actualizado.`);
      return snapshot;
    } catch (error) {
      setPowerBiMessage(error?.message || "No se pudo actualizar el catálogo.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function generatePowerBiBusinessDictionary(modelKey) {
    if (!modelKey) {
      return null;
    }
    if (!isPowerBiAdvancedModelKey(modelKey)) {
      setPowerBiMessage("El diccionario solo está disponible para administracion_ventas.");
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage(`Generando borrador del diccionario de ${modelKey}...`);

    try {
      const encodedKey = encodeURIComponent(modelKey);
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodedKey}/business-dictionary/generate-draft`,
        {
          method: "POST"
        }
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo generar el diccionario.");
      }

      const snapshot = await loadPowerBiModelSnapshot(modelKey);
      setPowerBiModelSnapshots((current) => ({
        ...current,
        [modelKey]: snapshot
      }));
      setPowerBiMessage(`Diccionario de negocio generado para ${modelKey}.`);
      return snapshot;
    } catch (error) {
      setPowerBiMessage(error?.message || "No se pudo generar el diccionario.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function reviewPowerBiBusinessDictionary(modelKey) {
    if (!modelKey) {
      return null;
    }
    if (!isPowerBiAdvancedModelKey(modelKey)) {
      setPowerBiMessage("La revisión del diccionario solo está disponible para administracion_ventas.");
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage(`Revisando diccionario de ${modelKey}...`);

    try {
      const encodedKey = encodeURIComponent(modelKey);
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodedKey}/business-dictionary/review`
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo revisar el diccionario.");
      }

      const snapshot = await loadPowerBiModelSnapshot(modelKey);
      setPowerBiModelSnapshots((current) => ({
        ...current,
        [modelKey]: snapshot
      }));
      setPowerBiMessage(`Diccionario revisado para ${modelKey}.`);
      return snapshot;
    } catch (error) {
      setPowerBiMessage(error?.message || "No se pudo revisar el diccionario.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function buildPowerBiDaxLabQuery() {
    if (!isPowerBiAdvancedModelKey(powerBiDaxLab.modelKey)) {
      setPowerBiDaxLab((current) => ({
        ...current,
        error: "El DAX Lab solo está disponible para administracion_ventas."
      }));
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage("Generando DAX controlado...");

    try {
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodeURIComponent(powerBiDaxLab.modelKey)}/dax-lab/build`,
        {
          method: "POST",
          body: {
            intent: powerBiDaxLab.intent,
            metric: powerBiDaxLab.metric,
            dimension: powerBiDaxLab.dimension,
            timeRange: powerBiDaxLab.timeRange,
            topN: powerBiDaxLab.topN
          }
        }
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo generar el DAX controlado.");
      }

      const payload = normalizePowerBiDaxLabPayload(response.data);
      setPowerBiDaxLab((current) => ({
        ...current,
        generatedDax: payload?.dax || "",
        validation: payload?.validation || null,
        execution: null,
        error: "",
        statusMessage: "DAX generado internamente."
      }));
      setPowerBiMessage("DAX controlado generado.");
      return payload;
    } catch (error) {
      setPowerBiDaxLab((current) => ({
        ...current,
        error: error?.message || "No se pudo generar el DAX controlado."
      }));
      setPowerBiMessage(error?.message || "No se pudo generar el DAX controlado.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function validatePowerBiDaxLabQuery() {
    if (!isPowerBiAdvancedModelKey(powerBiDaxLab.modelKey)) {
      setPowerBiDaxLab((current) => ({
        ...current,
        error: "El DAX Lab solo está disponible para administracion_ventas."
      }));
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage("Validando DAX controlado...");

    try {
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodeURIComponent(powerBiDaxLab.modelKey)}/dax-lab/validate`,
        {
          method: "POST",
          body: {
            intent: powerBiDaxLab.intent,
            metric: powerBiDaxLab.metric,
            dimension: powerBiDaxLab.dimension,
            timeRange: powerBiDaxLab.timeRange,
            topN: powerBiDaxLab.topN,
            dax: powerBiDaxLab.generatedDax || undefined
          }
        }
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo validar el DAX controlado.");
      }

      const payload = normalizePowerBiDaxLabPayload(response.data);
      setPowerBiDaxLab((current) => ({
        ...current,
        generatedDax: payload?.dax || current.generatedDax,
        validation: payload?.validation || null,
        error: "",
        statusMessage: payload?.validation?.ok ? "Validación correcta." : "Validación con incidencias."
      }));
      setPowerBiMessage("DAX controlado validado.");
      return payload;
    } catch (error) {
      setPowerBiDaxLab((current) => ({
        ...current,
        error: error?.message || "No se pudo validar el DAX controlado."
      }));
      setPowerBiMessage(error?.message || "No se pudo validar el DAX controlado.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function executePowerBiDaxLabQuery() {
    if (!isPowerBiAdvancedModelKey(powerBiDaxLab.modelKey)) {
      setPowerBiDaxLab((current) => ({
        ...current,
        error: "El DAX Lab solo está disponible para administracion_ventas."
      }));
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage("Ejecutando DAX controlado...");

    try {
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodeURIComponent(powerBiDaxLab.modelKey)}/dax-lab/execute`,
        {
          method: "POST",
          body: {
            intent: powerBiDaxLab.intent,
            metric: powerBiDaxLab.metric,
            dimension: powerBiDaxLab.dimension,
            timeRange: powerBiDaxLab.timeRange,
            topN: powerBiDaxLab.topN,
            rowLimit: 50
          }
        }
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo ejecutar el DAX controlado.");
      }

      const payload = normalizePowerBiDaxLabPayload(response.data);
      setPowerBiDaxLab((current) => ({
        ...current,
        generatedDax: payload?.dax || current.generatedDax,
        validation: payload?.validation || current.validation,
        execution: payload,
        error: "",
        statusMessage: payload?.truncated
          ? "Resultado truncado para el laboratorio."
          : "Resultado completo del laboratorio."
      }));
      setPowerBiMessage("DAX controlado ejecutado.");
      return payload;
    } catch (error) {
      setPowerBiDaxLab((current) => ({
        ...current,
        error: error?.message || "No se pudo ejecutar el DAX controlado."
      }));
      setPowerBiMessage(error?.message || "No se pudo ejecutar el DAX controlado.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function interpretPowerBiAskLabQuestion() {
    if (powerBiLoading) {
      return null;
    }
    if (!isPowerBiAdvancedModelKey(powerBiAskLab.modelKey)) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: "Power BI Ask Lab solo está disponible para administracion_ventas."
      }));
      return null;
    }

    const question = String(powerBiAskQuestion || "").trim();
    console.debug("Power BI Ask Lab", {
      action: "interpret",
      questionLength: question.length,
      hasQuestion: Boolean(question)
    });
    if (!question) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: "La pregunta está vacía. Escribe una pregunta corta sobre ventas o unidades."
      }));
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage("Interpretando pregunta de Power BI...");

    try {
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodeURIComponent(powerBiAskLab.modelKey)}/ask/interpret`,
        {
          method: "POST",
          body: {
            question,
            daxLabPayload: powerBiAskLab.preview?.daxLabPayload || undefined
          }
        }
      );
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo interpretar la pregunta.");
      }

      const interpretation = normalizePowerBiAskInterpretationPayload(response.data);
      setPowerBiAskLab((current) => ({
        ...current,
        interpretation,
        preview: null,
        execution: null,
        error: "",
        statusMessage: interpretation?.needsClarification
          ? interpretation.clarificationQuestion || "Necesita aclaración."
          : interpretation?.confidence >= 0.75
            ? "Interpretación lista."
            : "Interpretación limitada."
      }));
      setPowerBiMessage("Pregunta interpretada.");
      return interpretation;
    } catch (error) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: error?.message || "No se pudo interpretar la pregunta."
      }));
      setPowerBiMessage(error?.message || "No se pudo interpretar la pregunta.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function previewPowerBiAskLabQuestion() {
    if (powerBiLoading) {
      return null;
    }
    if (!isPowerBiAdvancedModelKey(powerBiAskLab.modelKey)) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: "Power BI Ask Lab solo está disponible para administracion_ventas."
      }));
      return null;
    }

    const question = String(powerBiAskQuestion || "").trim();
    console.debug("Power BI Ask Lab", {
      action: "preview",
      questionLength: question.length,
      hasQuestion: Boolean(question)
    });
    if (!question) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: "La pregunta está vacía. Escribe una pregunta corta sobre ventas o unidades."
      }));
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage("Previsualizando consulta de Power BI...");

    try {
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodeURIComponent(powerBiAskLab.modelKey)}/ask/preview`,
        {
          method: "POST",
          body: {
            question
          }
        }
      );
      const payload = normalizePowerBiAskLabPayload(response.data);
      if (payload && payload.ok === false && response.response.ok) {
        const errorMessage = payload.error || "La pregunta necesita aclaración antes de ejecutarse.";
        setPowerBiAskLab((current) => ({
          ...current,
          interpretation: payload?.interpretation || current.interpretation,
          preview: payload,
          execution: null,
          error: errorMessage,
          statusMessage: errorMessage
        }));
        setPowerBiMessage(errorMessage);
        return payload;
      }
      if (!response.response.ok) {
        setPowerBiAskLab((current) => ({
          ...current,
          interpretation: payload?.interpretation || current.interpretation,
          preview: payload,
          execution: null,
          error: payload?.error || response.data?.error || "No se pudo previsualizar la pregunta."
        }));
        throw new Error(response.data?.error || "No se pudo previsualizar la pregunta.");
      }

      setPowerBiAskLab((current) => ({
        ...current,
        interpretation: payload?.interpretation || current.interpretation,
        preview: payload,
        execution: null,
        error: "",
        statusMessage: "Consulta previsualizada."
      }));
      setPowerBiMessage("Consulta previsualizada.");
      return payload;
    } catch (error) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: error?.message || "No se pudo previsualizar la pregunta."
      }));
      setPowerBiMessage(error?.message || "No se pudo previsualizar la pregunta.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function executePowerBiAskLabQuestion() {
    if (powerBiLoading) {
      return null;
    }
    if (!isPowerBiAdvancedModelKey(powerBiAskLab.modelKey)) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: "Power BI Ask Lab solo está disponible para administracion_ventas."
      }));
      return null;
    }

    const question = String(powerBiAskQuestion || "").trim();
    console.debug("Power BI Ask Lab", {
      action: "execute",
      questionLength: question.length,
      hasQuestion: Boolean(question)
    });
    if (!question) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: "La pregunta está vacía. Escribe una pregunta corta sobre ventas o unidades."
      }));
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage("Ejecutando pregunta interpretada...");

    try {
      const response = await fetchPowerBiJson(
        `/api/powerbi/models/${encodeURIComponent(powerBiAskLab.modelKey)}/ask/execute`,
        {
          method: "POST",
          body: {
            question
          }
        }
      );
      const payload = normalizePowerBiAskLabPayload(response.data);
      const nowIso = new Date().toISOString();
      const formattedResult = payload?.ok
        ? { ...formatPowerBiChatAnswer(response.data), generatedAt: nowIso }
        : null;
      if (payload && payload.ok === false && response.response.ok) {
        const errorMessage = payload.error || "La pregunta necesita aclaración antes de ejecutarse.";
        setPowerBiAskLab((current) => ({
          ...current,
          interpretation: payload?.interpretation || current.interpretation,
          preview: payload?.dax ? payload : current.preview,
          execution: payload,
          error: errorMessage,
          statusMessage: errorMessage
        }));
        setLatestPowerBiResult({
          handled: true,
          unsupported: true,
          spokenResponse: errorMessage,
          visualResult: null,
          rejectionReason: errorMessage,
          source: "Power BI / administracion_ventas",
          question,
          at: nowIso
        });
        setLatestPowerBiResultSource("text");
        setLatestPowerBiQuestion(question);
        setLatestPowerBiTimestamp(nowIso);
        appendPowerBiDrawerMessage({
          id: `${nowIso}-ask-rejection`,
          role: "assistant",
          type: "powerbi_rejection",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: errorMessage
        });
        setPowerBiMessage(errorMessage);
        return payload;
      }
      if (!response.response.ok) {
        setPowerBiAskLab((current) => ({
          ...current,
          interpretation: payload?.interpretation || current.interpretation,
          preview: payload?.dax ? payload : current.preview,
          execution: payload?.execution || null,
          error: payload?.error || response.data?.error || "No se pudo ejecutar la pregunta."
        }));
        throw new Error(response.data?.error || "No se pudo ejecutar la pregunta.");
      }

      setPowerBiAskLab((current) => ({
        ...current,
        interpretation: payload?.interpretation || current.interpretation,
        preview: payload,
        execution: payload,
        error: "",
        statusMessage: payload?.naturalSummary || "Pregunta ejecutada en el laboratorio."
      }));
      if (formattedResult) {
        setPowerBiChatAnswer(formattedResult);
        setLatestPowerBiResult({
          handled: true,
          unsupported: false,
          spokenResponse: payload?.naturalSummary || formattedResult.headline || "Consulta Power BI completada.",
          visualResult: formattedResult,
          rejectionReason: null,
          source: "Power BI / administracion_ventas",
          question,
          at: nowIso
        });
        setLatestPowerBiResultSource("text");
        setLatestPowerBiQuestion(question);
        setLatestPowerBiTimestamp(nowIso);
        appendPowerBiDrawerMessage({
          id: `${nowIso}-ask-result`,
          role: "assistant",
          type: "powerbi_result",
          source: "Power BI / administracion_ventas",
          createdAt: nowIso,
          content: formattedResult.headline || payload?.naturalSummary || question,
          result: formattedResult
        });
      }
      setPowerBiMessage("Pregunta ejecutada.");
      return payload;
    } catch (error) {
      setPowerBiAskLab((current) => ({
        ...current,
        error: error?.message || "No se pudo ejecutar la pregunta."
      }));
      setPowerBiMessage(error?.message || "No se pudo ejecutar la pregunta.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  async function importPowerBiModelCatalog(modelKey) {
    if (!modelKey) {
      return null;
    }

    setPowerBiLoading(true);
    setPowerBiMessage(`Importando catálogo de ${modelKey}...`);

    try {
      const encodedKey = encodeURIComponent(modelKey);
      const response = await fetchPowerBiJson(`/api/powerbi/models/${encodedKey}/catalog/import`, {
        method: "POST"
      });
      if (!response.response.ok) {
        throw new Error(response.data?.error || "No se pudo importar el catálogo.");
      }

      const snapshot = await loadPowerBiModelSnapshot(modelKey);
      setPowerBiModelSnapshots((current) => ({
        ...current,
        [modelKey]: snapshot
      }));
      setPowerBiMessage(`Catálogo importado para ${modelKey}.`);
      return snapshot;
    } catch (error) {
      setPowerBiMessage(error?.message || "No se pudo importar el catálogo.");
      return null;
    } finally {
      setPowerBiLoading(false);
    }
  }

  function useDirectoryUserInDraft(user) {
    if (communicationDraftIsSent(selectedCommunicationDraft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return;
    }
    const email = directoryUserEmail(user);
    setCommunicationDraftForm((current) => ({
      ...current,
      recipient_label: user?.display_name || current.recipient_label,
      recipient_email: email || current.recipient_email
    }));
    setDirectoryQuery(user?.display_name || email || "");
    setActiveView("communications");
    setCommunicationMessage(
      `${user?.display_name || "Destinatario"} listo para usar en el borrador.`
    );
  }

  function startManualCommunicationDraft() {
    setCommunicationDraftEditorMode("new");
    setSelectedCommunicationDraft(null);
    setCommunicationDraftForm(defaultCommunicationDraftForm());
    setCommunicationSendPreparation(null);
    setCommunicationDraftOpenId("");
    setDirectoryQuery("");
    setCommunicationMessage("Borrador manual listo para editar.");
    setActiveView("communications");
  }

  async function fetchCommunicationJson(url, options = {}) {
    const requestBody = options?.body ? JSON.parse(String(options.body || "{}")) : {};
    const source = String(requestBody.source || requestBody.event_source || "").toLowerCase();
    const action = String(
      requestBody.action || requestBody.voice_intent || requestBody.communication_action || ""
    ).toLowerCase();
    const requestedByVoice =
      requestBody.requestedByVoice === true ||
      requestBody.requested_by_voice === true ||
      source.includes("voice") ||
      action.includes("voice");

    if (String(url).includes("/api/communications/draft-from-template") && requestedByVoice) {
      console.error("[communications] blocked_voice_draft_from_template", {
        endpoint: "draft-from-template",
        source: source || "n/a",
        action: action || "n/a",
        template_key: String(requestBody.template_id || requestBody.template_key || "").trim() || "n/a",
        has_source_incident_id: Boolean(
          String(requestBody.source_incident_id || requestBody.incident_id || "").trim()
        ),
        has_recipient_email: Boolean(
          String(requestBody.recipient_email || requestBody.custom_context?.creator_email || "").trim()
        )
      });
      throw new Error("La voz debe usar /api/communications/voice-draft, no draft-from-template.");
    }

    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function openCommunicationDraft(draft) {
    const draftId = communicationDraftId(draft);
    if (!draftId) {
      setCommunicationMessage("Selecciona un borrador válido.");
      return;
    }
    openCommunicationDraftReview(
      draftId,
      `Borrador #${draftId} abierto para revisión. No se ha enviado nada.`
    );
  }

  async function loadCreatedDraftAndNavigate(normalizedDraftId) {
    const loadedDraft = await loadCommunicationDraftById(normalizedDraftId);
    if (!loadedDraft) {
      throw new Error("El borrador se creó pero no se pudo validar por ID.");
    }
    const normalizedDraft = normalizeCommunicationDraftRecord(loadedDraft);
    const draftId = String(normalizedDraft.id || normalizedDraftId);
    const viewerPath = communicationDraftViewerPath(draftId);
    setCommunicationDraftOpenId(draftId);
    setLastCreatedDraftId(draftId);
    upsertCommunicationDraftInState(normalizedDraft);
    const draftWithPath = { ...normalizedDraft, viewer_path: viewerPath };
    draftWithPath.navigated = openCommunicationDraftReview(
      draftId,
      `Borrador #${draftId} creado y abierto en Comunicaciones. No se ha enviado nada.`
    );
    return draftWithPath;
  }

  async function createCommunicationDraftFromPayload(payload, successMessage) {
    setIsSavingCommunicationDraft(true);
    const totalBeforeCreate = Math.max(Number(communicationDraftSummary?.total || 0), communicationDrafts.length || 0);
    setCommunicationDraftViewerDiagnostics((current) => ({
      ...current,
      totalBeforeCreate
    }));
    setCommunicationMessage("Preparando borrador...");

    try {
      const response = await fetch("/api/communications/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo crear el borrador.");
      }

      setCommunicationSendPreparation(null);
      const normalizedDraftId = String(data.draft_id || data.draft?.id || "").trim();
      if (!normalizedDraftId) {
        throw new Error("No se recibió draft_id del borrador creado.");
      }

      const refreshed = await loadCommunicationDrafts({ clearMessage: false, filter: communicationDraftFilter });
      const totalAfterCreate = Math.max(
        Number(refreshed?.summary?.total || 0),
        refreshed?.drafts?.length || 0
      );
      const visibleDraft = (refreshed?.drafts || []).some(
        (item) => String(item.id) === normalizedDraftId
      );
      setCommunicationDraftViewerDiagnostics((current) => ({
        ...current,
        lastCreatedDraftId: normalizedDraftId,
        totalAfterCreate,
        lastDraftLoadAt: new Date().toISOString(),
        getByIdStatus: "loading"
      }));

      const openedDraft = await loadCreatedDraftAndNavigate(normalizedDraftId);

      const navigationMessage = openedDraft.navigated
        ? "Lo he abierto en pantalla para revisión."
        : `No pude abrirlo automáticamente. Abre ${openedDraft.viewer_path}.`;
      const baseMessage = `Borrador #${normalizedDraftId} creado. Destinatario: ${
        openedDraft.recipient_email || "No informado"
      }. Asunto: ${openedDraft.subject || "No informado"}. Estado: ${
        communicationDraftStatusLabel(openedDraft.status)
      }. Ruta: ${openedDraft.viewer_path}. No se ha enviado nada. ${navigationMessage}`;
      const visibilityMessage = visibleDraft
        ? ""
        : "El borrador se creó, pero puede estar oculto por filtros o búsqueda.";
      const finalMessage = [baseMessage, visibilityMessage, successMessage || ""]
        .filter(Boolean)
        .join(" ");
      setCommunicationMessage(finalMessage);
      return openedDraft;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo crear el borrador.");
      throw error;
    } finally {
      setIsSavingCommunicationDraft(false);
    }
  }

  async function createCommunicationDraftFromTemplate(templateId, source = {}, successMessage) {
    const templateSource = { ...source };
    const sourceReport = templateSource.report || templateSource.source_report || null;
    const sourceIncident = templateSource.incident || templateSource.source_incident || null;
    const payload = {
      template_id: templateId,
      source: templateSource.source || templateSource.event_source || "",
      action: templateSource.action || templateSource.voice_intent || templateSource.communication_action || "",
      voice_intent: templateSource.voice_intent || "",
      communication_action: templateSource.communication_action || "",
      recipient_label: templateSource.recipient_label || "",
      recipient_email: templateSource.recipient_email || "",
      source_type:
        templateSource.source_type ||
        communicationTemplateSourceTypeForId(templateId) ||
        "manual",
      source_report_id:
        templateSource.source_report_id ||
        sourceReport?.id ||
        sourceReport?.report_id ||
        "",
      source_incident_id:
        templateSource.source_incident_id ||
        sourceIncident?.id ||
        sourceIncident?.incident_id ||
        "",
      custom_context:
        templateSource.custom_context ||
        buildTemplateContext(templateId, templateSource, {
          message: templateSource.message || successMessage || ""
        })
    };

    setIsSavingCommunicationDraft(true);
    setCommunicationMessage("Preparando borrador con plantilla...");

    try {
      const { response, data } = await fetchCommunicationJson("/api/communications/draft-from-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(data.error || "No se pudo crear el borrador con plantilla.");
      }

      setCommunicationSendPreparation(null);
      setSelectedCommunicationTemplateId(templateId);
      const normalizedDraftId = String(data.draft_id || data.draft?.id || "").trim();
      if (!normalizedDraftId) {
        throw new Error("No se recibió draft_id del borrador creado.");
      }

      const refreshed = await loadCommunicationDrafts({ clearMessage: false, filter: communicationDraftFilter });
      const totalAfterCreate = Math.max(
        Number(refreshed?.summary?.total || 0),
        refreshed?.drafts?.length || 0
      );
      const visibleDraft = (refreshed?.drafts || []).some(
        (item) => String(item.id) === normalizedDraftId
      );
      setCommunicationDraftViewerDiagnostics((current) => ({
        ...current,
        lastCreatedDraftId: normalizedDraftId,
        totalAfterCreate,
        lastDraftLoadAt: new Date().toISOString(),
        getByIdStatus: "loading"
      }));

      const openedDraft = await loadCreatedDraftAndNavigate(normalizedDraftId);

      const navigationMessage = openedDraft.navigated
        ? "Lo he abierto en pantalla para revisión."
        : `No pude abrirlo automáticamente. Abre ${openedDraft.viewer_path}.`;
      const baseMessage = `Borrador #${normalizedDraftId} creado. Destinatario: ${
        openedDraft.recipient_email || "No informado"
      }. Asunto: ${openedDraft.subject || "No informado"}. Estado: ${
        communicationDraftStatusLabel(openedDraft.status)
      }. Ruta: ${openedDraft.viewer_path}. No se ha enviado nada. ${navigationMessage}`;
      const visibilityMessage = visibleDraft
        ? ""
        : "El borrador se creó, pero puede estar oculto por filtros o búsqueda.";
      const finalMessage = [baseMessage, visibilityMessage, successMessage || ""]
        .filter(Boolean)
        .join(" ");
      setCommunicationMessage(finalMessage);
      return openedDraft;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo crear el borrador con plantilla.");
      throw error;
    } finally {
      setIsSavingCommunicationDraft(false);
    }
  }

  async function createCommunicationDraftFromPreset(kind, source = {}, successMessage) {
    return createCommunicationDraftFromTemplate(
      communicationTemplateIdForKind(kind),
      source,
      successMessage
    );
  }

  function launchCommunicationDraftFromPreset(kind, source = {}, successMessage) {
    void createCommunicationDraftFromPreset(kind, source, successMessage).catch(() => {});
  }

  function launchCommunicationDraftFromTemplate(templateId, source = {}, successMessage) {
    void createCommunicationDraftFromTemplate(templateId, source, successMessage).catch(() => {});
  }

  function launchCommunicationDraftFromPayload(payload, successMessage) {
    void createCommunicationDraftFromPayload(payload, successMessage).catch(() => {});
  }

  function getCommunicationDraftTarget(strategy = "selected") {
    if (strategy === "selected" && selectedCommunicationDraft?.id) {
      return selectedCommunicationDraft;
    }
    if (communicationDrafts.length) {
      return communicationDrafts[0];
    }
    return selectedCommunicationDraft || null;
  }

  async function showCommunicationDraftsByStatus(status, message) {
    const nextFilter = {
      ...communicationDraftFilter,
      status
    };
    setCommunicationDraftFilter(nextFilter);
    setActiveView("communications");
    setCommunicationMessage(message || "Mostrando borradores de comunicación.");
    await loadCommunicationDrafts({ clearMessage: false, filter: nextFilter });
  }

  async function saveCommunicationDraft() {
    if (communicationDraftIsSent(selectedCommunicationDraft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return;
    }
    setIsSavingCommunicationDraft(true);
    setCommunicationMessage("");

    try {
      const payload = {
        ...communicationDraftForm,
        recipient_email: normalizeCommunicationEmail(communicationDraftForm.recipient_email),
        source_report_id: communicationDraftForm.source_report_id || "",
        source_incident_id: communicationDraftForm.source_incident_id || ""
      };
      const method = selectedCommunicationDraft?.id ? "PATCH" : "POST";
      const endpoint = selectedCommunicationDraft?.id
        ? communicationDraftUrl(selectedCommunicationDraft.id)
        : "/api/communications/draft";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo guardar el borrador.");
      }

      populateCommunicationEditor(data.draft);
      setCommunicationSendPreparation((current) =>
        current?.draft?.id === data.draft?.id ? current : null
      );
      await openCommunicationDraftById(data.draft?.id, {
        successMessage: `Borrador guardado: ID ${data.draft.id}, estado ${communicationDraftStatusLabel(data.draft.status)}.`
      });
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo guardar el borrador.");
    } finally {
      setIsSavingCommunicationDraft(false);
    }
  }

  async function duplicateCommunicationDraft(draft) {
    if (!draft?.id) {
      setCommunicationMessage("Selecciona un borrador para duplicarlo.");
      return null;
    }

    const payload = {
      type: draft.type || "email",
      status: "draft",
      recipient_label: draft.recipient_label || "",
      recipient_email: draft.recipient_email || "",
      subject: draft.subject || "",
      body_markdown: draft.body_markdown || "",
      body_text: draft.body_text || "",
      source_type: draft.source_type || "manual",
      source_report_id: draft.source_report_id || "",
      source_incident_id: draft.source_incident_id || "",
      template_id: draft.template_id || "",
      review_notes: "",
      reviewed_at: "",
      reviewed_by: "",
      copied_at: "",
      discarded_at: "",
      last_action_at: "",
      send_status: "not_sent",
      send_prepared_at: "",
      send_attempt_at: "",
      sent_at: "",
      sent_by: "",
      from_user: "",
      send_error: ""
    };

    return createCommunicationDraftFromPayload(
      payload,
      "Borrador duplicado. Revisa el contenido antes de enviarlo manualmente."
    );
  }

  async function updateCommunicationDraftPatch(draftId, patch = {}) {
    const normalizedDraftId = communicationDraftId(draftId);
    const response = await fetch(communicationDraftUrl(normalizedDraftId), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(patch)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "No se pudo actualizar el borrador.");
    }
    populateCommunicationEditor(data.draft);
    setCommunicationSendPreparation((current) =>
      current?.draft?.id === data.draft?.id ? null : current
    );
    await loadCommunicationDrafts({ clearMessage: false });
    return data.draft;
  }

  async function updateCommunicationDraftStatus(draftId, status, extraPatch = {}) {
    return updateCommunicationDraftPatch(communicationDraftId(draftId), { ...extraPatch, status });
  }

  async function discardCommunicationDraft(draftId) {
    const normalizedDraftId = communicationDraftId(draftId);
    const targetDraft = communicationDrafts.find((draft) => String(draft.id) === normalizedDraftId);
    if (communicationDraftIsSent(targetDraft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return;
    }
    try {
      await updateCommunicationDraftStatus(normalizedDraftId, "discarded");
      setCommunicationSendPreparation((current) =>
        String(current?.draft?.id) === normalizedDraftId ? null : current
      );
      setCommunicationMessage("Borrador descartado.");
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo descartar el borrador.");
    }
  }

  async function markCommunicationDraftReadyForReview(draftId) {
    const normalizedDraftId = communicationDraftId(draftId);
    const targetDraft = communicationDrafts.find((draft) => String(draft.id) === normalizedDraftId);
    if (communicationDraftIsSent(targetDraft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return;
    }
    try {
      const updatedDraft = await updateCommunicationDraftStatus(normalizedDraftId, "ready_for_review");
      setCommunicationMessage("Borrador marcado como listo para revisión.");
      return updatedDraft;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo marcar el borrador como listo.");
      return null;
    }
  }

  async function markCommunicationDraftReviewed(draftId) {
    const normalizedDraftId = communicationDraftId(draftId);
    const targetDraft = communicationDrafts.find((draft) => String(draft.id) === normalizedDraftId);
    if (communicationDraftIsSent(targetDraft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return;
    }
    try {
      const updatedDraft = await updateCommunicationDraftStatus(normalizedDraftId, "reviewed", {
        reviewed_by: "infra-agent-web"
      });
      setCommunicationMessage("Borrador marcado como revisado.");
      return updatedDraft;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo marcar el borrador como revisado.");
      return null;
    }
  }

  async function markCommunicationDraftCopied(draftId) {
    try {
      await updateCommunicationDraftStatus(draftId, "copied");
      setCommunicationMessage("Contenido copiado.");
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo registrar la copia.");
    }
  }

  async function prepareCommunicationDraftSend(draft) {
    if (!draft?.id) {
      setCommunicationMessage("Selecciona un borrador para preparar el envío.");
      return null;
    }
    if (communicationDraftIsSent(draft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return null;
    }
    const readiness = getCommunicationSendReadiness(draft, {
      allowedDomains: communicationAllowedDomains
    });
    if (!readiness.canPrepare) {
      setCommunicationMessage(
        readiness.blockers[0] || "Solo se puede preparar el envío de borradores email revisados con destinatario, asunto y cuerpo."
      );
      return null;
    }

    setIsSavingCommunicationDraft(true);
    setCommunicationMessage("Preparando doble confirmación visual para el envío...");

    try {
      const response = await fetch("/api/communications/prepare-send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ draft_id: draft.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo preparar el envío.");
      }

      populateCommunicationEditor(data.draft);
      setCommunicationSendPreparation({
        draft: data.draft,
        confirmation_token: data.confirmation_token,
        from_user: data.from_user,
        allowed_domains: data.allowed_domains || [],
        recipient_domain: data.recipient_domain || communicationDraftRecipientDomain(data.draft),
        prepared_at: data.prepared_at
      });
      await loadCommunicationDrafts({ clearMessage: false });
      setCommunicationMessage(
        "Paso 1/2 completado. Revisa el panel de confirmación y pulsa Confirmar y enviar."
      );
      return data;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo preparar el envío.");
      return null;
    } finally {
      setIsSavingCommunicationDraft(false);
    }
  }

  async function confirmCommunicationDraftSend(draft) {
    if (!draft?.id || !communicationSendPreparation?.confirmation_token) {
      setCommunicationMessage("Primero prepara el envío antes de confirmar.");
      return null;
    }
    if (communicationDraftIsSent(draft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return null;
    }
    const readiness = getCommunicationSendReadiness(draft, {
      preparation: communicationSendPreparation,
      allowedDomains: communicationAllowedDomains
    });
    if (!readiness.canConfirm) {
      setCommunicationMessage(readiness.confirmBlockers[0] || "Primero prepara el envío antes de confirmar.");
      return null;
    }

    setIsSendingCommunicationEmail(true);
    setCommunicationMessage("Confirmando y enviando correo real...");

    try {
      const response = await fetch("/api/communications/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          draft_id: draft.id,
          confirmation_token: communicationSendPreparation.confirmation_token,
          confirm: true
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo enviar el correo.");
      }

      populateCommunicationEditor(data.draft);
      setCommunicationSendPreparation(null);
      await loadCommunicationDrafts({ clearMessage: false });
      setCommunicationMessage("Correo enviado y registrado en la auditoría local.");
      return data;
    } catch (error) {
      setCommunicationSendPreparation((current) =>
        current ? { ...current, confirmation_token: "" } : null
      );
      setCommunicationMessage(error?.message || "No se pudo enviar el correo.");
      return null;
    } finally {
      setIsSendingCommunicationEmail(false);
    }
  }

  async function directSendCommunicationDraft(draft, { source = "button" } = {}) {
    if (!draft?.id) {
      setCommunicationMessage("Selecciona un borrador para enviarlo directamente.");
      return null;
    }
    if (communicationDraftIsSent(draft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return null;
    }
    const readiness = getCommunicationSendReadiness(draft, {
      allowedDomains: communicationAllowedDomains
    });
    if (!readiness.canDirectSend) {
      setCommunicationMessage(readiness.directSendBlockers[0] || "El borrador no está listo para envío directo.");
      return null;
    }

    setIsSavingCommunicationDraft(true);
    setCommunicationMessage(
      `Vas a enviar este correo real a ${draft.recipient_email || "destino no informado"} sin revisión manual. ¿Confirmar envío directo?`
    );

    try {
      const response = await fetch("/api/communications/direct-send-from-incident", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          draft_id: draft.id,
          confirm_direct_send: true,
          source
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "No se pudo enviar directamente el correo.");
      }

      const directDraft = normalizeCommunicationDraftRecord(data.draft || draft);
      upsertCommunicationDraftInState(directDraft);
      setCommunicationSendPreparation(null);
      await loadCommunicationDrafts({ clearMessage: false, filter: communicationDraftFilter });
      openCommunicationDraftReview(
        String(directDraft.id || draft.id || ""),
        `Borrador #${directDraft.id || draft.id} enviado directamente. No se puede reenviar este mismo borrador.`
      );
      setCommunicationMessage(
        `He enviado el correo directamente a ${data.recipient_email || directDraft.recipient_email || "destino no informado"}. No se puede reenviar este mismo borrador.`
      );
      return data;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo enviar directamente el correo.");
      return null;
    } finally {
      setIsSavingCommunicationDraft(false);
    }
  }

  async function deleteCommunicationDraft(draftId) {
    const targetDraft = communicationDrafts.find((draft) => Number(draft.id) === Number(draftId));
    if (communicationDraftIsSent(targetDraft)) {
      setCommunicationMessage(
        "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
      );
      return;
    }
    try {
      const response = await fetch(communicationDraftUrl(draftId), {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo eliminar el borrador.");
      }
      setSelectedCommunicationDraft(null);
      setCommunicationDraftForm(defaultCommunicationDraftForm());
      setCommunicationSendPreparation((current) =>
        current?.draft?.id === draftId ? null : current
      );
      await loadCommunicationDrafts({ clearMessage: false });
      setCommunicationMessage("Borrador eliminado.");
      return data.draft;
    } catch (error) {
      setCommunicationMessage(error?.message || "No se pudo eliminar el borrador.");
      return null;
    }
  }

  async function copyTextToClipboard(text, afterCopy) {
    if (typeof navigator === "undefined") {
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    if (afterCopy) {
      await afterCopy();
    }
  }

  function triggerDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function copyCommunicationDraftContent(draft, mode = "all") {
    const content =
      mode === "subject"
        ? draft?.subject || ""
        : mode === "body"
          ? draft?.body_text || draft?.body_markdown || ""
          : buildCommunicationPlainText(draft);
    return copyTextToClipboard(content, () => markCommunicationDraftCopied(draft.id)).catch(
      (error) => {
        setCommunicationMessage(error?.message || "No se pudo copiar el contenido.");
      }
    );
  }

  async function handleCommunicationDraftDownload(draft, format) {
    if (format === "markdown") {
      triggerDownload(
        buildCommunicationDownloadName(draft, "md"),
        buildCommunicationMarkdownDocument(draft),
        "text/markdown"
      );
      return;
    }
    if (format === "html") {
      triggerDownload(
        buildCommunicationDownloadName(draft, "html"),
        buildCommunicationHtmlDocument(draft),
        "text/html"
      );
    }
  }

  async function handleCommunicationDraftSave(event) {
    event?.preventDefault?.();
    await saveCommunicationDraft();
  }

  useEffect(() => {
    loadCommunicationTemplates();
    loadCommunicationSendConfig();
    loadCommunicationDrafts();
  }, []);

  async function sendPrompt(prompt) {
    setLastPrompt(prompt);
    setStatusMessage("");
    setIsSendingPrompt(true);
    setLatestOpsResult(null);
    setLatestOpsQuestion("");
    setLatestOpsTimestamp("");
    setPowerBiChatAnswer(null);
    const wasChatClosed = !chatPanelOpen;
    openChatPanel();

    try {
      if (wasChatClosed) {
        setStatusMessage("Chat abriendo. La consulta se enviará cuando ChatKit esté disponible.");
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      const opsResult = await handleOpsChatMessage(prompt, {
        source: "sendPrompt",
        currentIncidentContext
      });
      if (opsResult.handled) {
        return;
      }
      const powerBiResult = await handlePowerBiChatMessage(prompt, { source: "sendPrompt" });
      if (powerBiResult.handled) {
        return;
      }

      if (!isChatAvailable) {
        throw new Error("ChatKit no está disponible todavía. Espera a que cargue el chat textual.");
      }
      await sendUserMessage({ text: prompt });
      setStatusMessage("Consulta enviada al chat.");
    } catch (error) {
      if (!isChatAvailable) {
        setStatusMessage(error?.message || "ChatKit no está listo.");
        return;
      }
      try {
        await setComposerValue({ text: prompt });
        await focusComposer();
        setStatusMessage("Pregunta preparada en el chat. Revísala y envíala.");
      } catch {
        setStatusMessage(error?.message || "No se pudo enviar la pregunta rápida.");
      }
    } finally {
      setIsSendingPrompt(false);
    }
  }

  async function generateAndPrepareReport(type, title, prompt) {
    prepareReportDraft(type, title, prompt);
    await sendPrompt(prompt);
  }

  async function generateStructured(type, options = {}) {
    const endpoint = structuredEndpoints[type];
    if (!endpoint) {
      setReportMessage("Tipo estructurado no soportado.");
      return;
    }

    setIsGeneratingStructured(true);
    if (!options.quiet) {
      setReportMessage("Generando informe estructurado desde backend...");
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo generar el informe estructurado.");
      }

      setSelectedReport(data.report);
      setStructuredResult({
        kind: parseReportMetadata(data.report)?.structured_kind,
        data: data.data,
        source: data.source,
        warning: data.warning || null
      });
      setReportDraft((current) => ({
        ...current,
        type,
        title: data.report?.title || current.title,
        prompt: data.report?.prompt || current.prompt,
        response_markdown: data.markdown || ""
      }));
      await loadReports({ clearMessage: false });
      if (options.reloadDashboard !== false) {
        await loadDashboard();
      }
      await loadAnalytics();
      setReportMessage(
        data.warning
          ? `Informe estructurado guardado con aviso: ${data.warning}`
          : "Informe estructurado generado y guardado en SQLite."
      );
      return data;
    } catch (error) {
      setReportMessage(error?.message || "No se pudo generar el informe estructurado.");
      throw error;
    } finally {
      setIsGeneratingStructured(false);
    }
  }

  async function updateDashboard() {
    setIsUpdatingDashboard(true);
    setDashboardMessage("Actualizando dashboard con los cuatro informes estructurados...");

    try {
      const response = await fetch("/api/dashboard/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo actualizar el dashboard.");
      }

      setDashboard(data.dashboard);
      await loadReports({ clearMessage: false });
      await loadLatestVisualReports(data.dashboard);
      await loadAnalytics();
      setDashboardMessage("Dashboard actualizado desde los últimos informes estructurados.");
    } catch (error) {
      setDashboardMessage(error?.message || "No se pudo actualizar el dashboard.");
    } finally {
      setIsUpdatingDashboard(false);
    }
  }

  async function runDailyReportNow() {
    setIsRunningDailyReport(true);
    setDashboardMessage("Generando informe diario automático completo...");

    try {
      const response = await fetch("/api/dashboard/run-daily-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "No se pudo generar el informe diario automático.");
      }

      setDashboard(data.dashboard);
      await loadReports({ clearMessage: false });
      await loadLatestVisualReports(data.dashboard);
      await loadAnalytics();
      setDashboardMessage("Informe diario generado y dashboard actualizado.");
    } catch (error) {
      setDashboardMessage(error?.message || "No se pudo generar el informe diario automático.");
    } finally {
      setIsRunningDailyReport(false);
    }
  }

  const powerBiVoiceHelpText = getPowerBiVoiceHelp();
  const powerBiSupportedUtterances = getPowerBiSupportedUtterances();

  return (
    <>
      <Script
        src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js"
        strategy="afterInteractive"
        onLoad={() => setChatScriptState("Script ChatKit cargado")}
        onError={() => {
          setChatScriptState("Error cargando script ChatKit");
          setChatHealth("error");
          setChatError("No se pudo cargar el script de ChatKit desde OpenAI.");
        }}
      />
      <main className={`app-shell ${presentationMode ? "presentation-mode" : ""}`}>
        <aside className="side-panel" aria-label="Accesos rápidos">
          <div className="brand-block">
            <p className="eyebrow">Consola interna</p>
            <h1>Agente Inteligente de Infraestructura</h1>
            <p className="summary">
              Consulta Zabbix e IncidenciasTI mediante el workflow publicado en
              Agent Builder.
            </p>
          </div>

          <nav className="quick-actions" aria-label="Preguntas rápidas">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="quick-action"
                onClick={() => sendPrompt(prompt)}
                disabled={isSendingPrompt}
              >
                {prompt}
              </button>
            ))}
          </nav>

          {powerBiChatAnswer ? (
            <PowerBiChatResultView
              result={powerBiChatAnswer}
              onExpand={openPowerBiExpandedResult}
            />
          ) : null}

          <div className="sidebar-footer" aria-live="polite">
            <span className="status-dot" />
            <span>
              {statusMessage ||
                (lastPrompt ? `Última consulta: ${lastPrompt}` : "MCPs en modo read-only")}
            </span>
          </div>
        </aside>

        <section className="chat-section" aria-label="Chat del agente">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Dashboard operativo v0.15</p>
              <h2>Dashboard operativo v0.15</h2>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="chat-open-button"
                onClick={openChatPanel}
                aria-expanded={chatPanelOpen}
              >
                {chatPanelOpen ? "Chat abierto" : "Abrir chat"}
              </button>
              <PresentationToggle enabled={presentationMode} onToggle={togglePresentationMode} />
              <span className="readonly-badge">Read-only</span>
            </div>
          </div>

          <div className="workspace-grid">
            <section className="dashboard-panel" aria-label="Panel operativo">
              <VoiceAgentPanel
                presentationMode={presentationMode}
                currentIncidentContext={currentIncidentContext}
              />

              <NavigationTabs activeView={activeView} onChange={setActiveView} />

              {visualReportsMessage ? (
                <div className="report-message">{visualReportsMessage}</div>
              ) : null}

            {activeView === "dashboard" ? (
              <>
            <MorningBriefingPanel
              briefing={morningBriefing}
              step={briefingStep}
              isRunning={isRunningBriefing}
              onRunBriefing={runMorningBriefing}
            />

            <DashboardUpdateIndicator dashboard={dashboard} />

            <DailyReportStatus
              dashboard={dashboard}
              isRunningDailyReport={isRunningDailyReport}
              onRunDailyReport={runDailyReportNow}
              onOpenReport={openReport}
            />

            <RecommendedUsage
              disabled={isGeneratingStructured || isUpdatingDashboard || isRunningDailyReport}
              isUpdatingDashboard={isUpdatingDashboard}
              isRunningDailyReport={isRunningDailyReport}
              onGenerateStructured={generateStructured}
              onRunDailyReport={runDailyReportNow}
              onUpdateDashboard={updateDashboard}
            />

            <VisualGuide />

            <div className="section-heading">
              <div>
                <p className="eyebrow">Resumen operativo</p>
                <h3>Lectura rápida</h3>
              </div>
            </div>

            {isLoadingDashboard || isUpdatingDashboard || isRunningDailyReport ? (
              <div className="structured-loading" aria-live="polite">
                {isRunningDailyReport
                  ? "Generando informe diario automático..."
                  : isUpdatingDashboard
                  ? "Generando informes y recomponiendo dashboard..."
                  : "Cargando dashboard desde SQLite..."}
              </div>
            ) : null}

            {dashboardMessage ? <div className="report-message">{dashboardMessage}</div> : null}

            <DashboardCardGrid
              cards={dashboard?.cards}
              fallbackCards={summaryCards}
              isLoading={
                isLoadingDashboard || isUpdatingDashboard || isRunningDailyReport || isSendingPrompt
              }
              onPrompt={sendPrompt}
            />

            <DashboardSnapshot
              dashboard={dashboard}
              onOpenReport={openReport}
              presentationMode={presentationMode}
            />

            {!presentationMode ? (
            <div className="dashboard-actions" aria-label="Acciones operativas">
              {dashboardActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="action-button"
                  onClick={() =>
                    action.reportType
                      ? generateAndPrepareReport(action.reportType, action.title, action.prompt)
                      : sendPrompt(action.prompt)
                  }
                  disabled={isSendingPrompt}
                >
                  {action.label}
                </button>
              ))}
            </div>
            ) : null}
              </>
            ) : null}

            {activeView === "today" ? (
              <>
                <DailyReportStatus
                  dashboard={dashboard}
                  isRunningDailyReport={isRunningDailyReport}
                  onRunDailyReport={runDailyReportNow}
                  onOpenReport={openReport}
                />
                <TodayReportView
                  report={latestDailyReport}
                  data={latestDailyData}
                  matrixData={latestMatrixData}
                  risksData={latestRisksData}
                  gapsData={latestGapsData}
                  isLoading={isLoadingVisualReports || isRunningDailyReport}
                  onRunDailyReport={runDailyReportNow}
                  onCreateExecutiveDraft={() =>
                    launchCommunicationDraftFromTemplate("executive_direccion", {
                      report: latestDailyReport
                    })
                  }
                  onCreateTechnicalDraft={() =>
                    launchCommunicationDraftFromTemplate("tecnico_sistemas", {
                      report: latestDailyReport
                    })
                  }
                  onCreateOperationalDraft={() =>
                    launchCommunicationDraftFromTemplate("informe_diario", {
                      report: latestDailyReport
                    })
                  }
                />
                <VisualCharts dailyData={latestDailyData} matrixData={latestMatrixData} />
              </>
            ) : null}

            {activeView === "matrix" ? (
              <>
                <MatrixReportView
                  report={latestMatrixReport}
                  data={latestMatrixData}
                  isLoading={isLoadingVisualReports}
                  filters={matrixFilters}
                  onFiltersChange={setMatrixFilters}
                  onGenerateMatrix={() => generateStructured("correlation_matrix")}
                  onCreateMatrixDraft={() =>
                    launchCommunicationDraftFromTemplate("matriz_correlacion", {
                      report: latestMatrixReport
                    })
                  }
                />
                <VisualCharts dailyData={latestDailyData} matrixData={latestMatrixData} />
              </>
            ) : null}

            {activeView === "analysis" ? (
              <AnalyticsView
                analytics={analytics}
                analyticsReports={analyticsReports}
                isLoading={isLoadingAnalytics}
                message={analyticsMessage}
                onReload={loadAnalytics}
                onCreateExecutiveDraft={() =>
                  launchCommunicationDraftFromTemplate("executive_direccion", {
                    report: latestDailyReport
                  })
                }
                onCreateTechnicalDraft={() =>
                  launchCommunicationDraftFromTemplate("tecnico_sistemas", {
                    report: latestMatrixReport
                  })
                }
                onCreateOperationalDraft={() =>
                  launchCommunicationDraftFromTemplate("informe_diario", {
                    report: latestDailyReport
                  })
                }
              />
            ) : null}

            {activeView === "powerbi" ? (
              <PowerBiPanelBoundary>
                <PowerBiView
                  status={powerBiStatus}
                  models={powerBiModels}
                  snapshots={powerBiModelSnapshots}
                  capabilities={powerBiModelSnapshots?.administracion_ventas?.capabilities || null}
                  isLoading={powerBiLoading}
                  message={powerBiMessage}
                  loadedAt={powerBiLoadedAt}
                  onReload={loadPowerBiOverview}
                  onRefreshModel={refreshPowerBiModel}
                  onRefreshCatalog={refreshPowerBiModelCatalog}
                  onImportCatalog={importPowerBiModelCatalog}
                  onGenerateBusinessDictionary={generatePowerBiBusinessDictionary}
                  onReviewBusinessDictionary={reviewPowerBiBusinessDictionary}
                  daxLab={powerBiDaxLab}
                  onDaxLabChange={setPowerBiDaxLab}
                  onBuildDaxLab={buildPowerBiDaxLabQuery}
                  onValidateDaxLab={validatePowerBiDaxLabQuery}
                  onExecuteDaxLab={executePowerBiDaxLabQuery}
                  askLab={powerBiAskLab}
                  askQuestion={powerBiAskQuestion}
                  onAskQuestionChange={setPowerBiAskQuestion}
                  onAskLabChange={setPowerBiAskLab}
                  onInterpretAskLab={interpretPowerBiAskLabQuestion}
                  onPreviewAskLab={previewPowerBiAskLabQuestion}
                  onExecuteAskLab={executePowerBiAskLabQuestion}
                  onOpenExpandedResult={openPowerBiExpandedResult}
                  latestPowerBiResult={latestPowerBiResult}
                  latestPowerBiResultSource={latestPowerBiResultSource}
                  latestPowerBiQuestion={latestPowerBiQuestion}
                  latestPowerBiTimestamp={latestPowerBiTimestamp}
                  powerBiHistory={powerBiDrawerMessages}
                />
              </PowerBiPanelBoundary>
          ) : null}

            {activeView === "directory" ? (
              <DirectoryView
                query={directoryQuery}
                users={directoryUsers}
                isLoading={directoryLoading}
                message={directoryMessage}
                syncedAt={directorySyncedAt}
                onQueryChange={setDirectoryQuery}
                onReload={() => loadDirectoryUsers()}
                onSync={syncDirectoryUsers}
                onUseUser={useDirectoryUserInDraft}
              />
            ) : null}

            {activeView === "communications" ? (
              <CommunicationsPanelBoundary>
                <CommunicationsView
                  drafts={communicationDrafts}
                  selectedDraft={selectedCommunicationDraft}
                  draftForm={communicationDraftForm}
                  editorMode={communicationDraftEditorMode}
                  draftSummary={communicationDraftSummary}
                  draftFilter={communicationDraftFilter}
                  hasActiveFilters={communicationDraftHasActiveFilters(communicationDraftFilter)}
                  templates={communicationTemplates}
                  allowedDomains={communicationAllowedDomains}
                  selectedTemplateId={selectedCommunicationTemplateId}
                  templatesMessage={communicationTemplatesMessage}
                  sendPreparation={communicationSendPreparation}
                  directoryUsers={directoryUsers}
                  directoryQuery={directoryQuery}
                  directoryLoading={directoryLoading}
                  directoryMessage={directoryMessage}
                  directorySyncedAt={directorySyncedAt}
                  isLoading={isLoadingCommunicationDrafts}
                  isSaving={isSavingCommunicationDraft}
                  isSendingEmail={isSendingCommunicationEmail}
                  message={communicationMessage}
                  onReload={loadCommunicationDrafts}
                  onNewManual={startManualCommunicationDraft}
                  onCreateExecutive={() =>
                    launchCommunicationDraftFromTemplate("executive_direccion", {
                      report: latestDailyReport
                    })
                  }
                  onCreateTechnical={() =>
                    launchCommunicationDraftFromTemplate("tecnico_sistemas", {
                      report: latestMatrixReport
                    })
                  }
                  onCreateOperational={() =>
                    launchCommunicationDraftFromTemplate("informe_diario", {
                      report: latestDailyReport
                    })
                  }
                  onCreateMatrix={() =>
                    launchCommunicationDraftFromTemplate("matriz_correlacion", {
                      report: latestMatrixReport
                    })
                  }
                  onChangeForm={setCommunicationDraftForm}
                  onSaveDraft={handleCommunicationDraftSave}
                  onDiscardDraft={discardCommunicationDraft}
                  onDeleteDraft={deleteCommunicationDraft}
                  onCopyDraft={copyCommunicationDraftContent}
                  onDuplicateDraft={duplicateCommunicationDraft}
                  onPrepareSend={prepareCommunicationDraftSend}
                  onConfirmSend={confirmCommunicationDraftSend}
                  onMarkReadyForReview={markCommunicationDraftReadyForReview}
                  onMarkReviewed={markCommunicationDraftReviewed}
                  onDownloadDraft={handleCommunicationDraftDownload}
                  onCreateTemplateDraft={() =>
                    createCommunicationDraftFromTemplate(
                      selectedCommunicationTemplateId,
                      communicationDraftForm
                    )
                  }
                  selectedDraftRef={selectedCommunicationDraftRef}
                  openDraftId={communicationDraftOpenId}
                  reviewDraftId={communicationReviewDraftId}
                  reviewMessage={communicationReviewMessage}
                  pendingVoiceDraftDecision={pendingVoiceDraftDecision}
                  pendingVoiceSendConfirmation={pendingVoiceSendConfirmation}
                  onOpenDraft={openCommunicationDraft}
                  onCloseReviewDraft={closeCommunicationDraftReview}
                  onReviewDraftLoaded={(draft) => {
                    upsertCommunicationDraftInState(draft);
                    setCommunicationDraftOpenId(String(draft?.id || ""));
                  }}
                  onReviewDraftUpdated={(draft) => {
                    upsertCommunicationDraftInState(draft);
                    void loadCommunicationDrafts({ clearMessage: false });
                  }}
                  onOpenDraftIdChange={setCommunicationDraftOpenId}
                  onOpenDraftByIdSubmit={handleOpenCommunicationDraftByIdSubmit}
                  onVoiceDraftReview={chooseVoiceDraftReview}
                  onVoiceDraftRequestDirectSend={requestVoiceDraftDirectSend}
                  onVoiceDraftConfirmDirectSend={confirmVoiceDraftDirectSend}
                  onVoiceDraftCancel={cancelVoiceDraftDirectSend}
                  onTemplateChange={setSelectedCommunicationTemplateId}
                  onDraftFilterChange={(next) => {
                    setCommunicationDraftFilter(next);
                    void loadCommunicationDrafts({ clearMessage: false, filter: next });
                  }}
                  onClearFilters={() => {
                    const nextFilter = clearCommunicationDraftFilters();
                    void loadCommunicationDrafts({ clearMessage: false, filter: nextFilter });
                  }}
                  onRecipientQueryChange={setDirectoryQuery}
                  onSyncDirectory={syncDirectoryUsers}
                  onUseDirectoryUser={useDirectoryUserInDraft}
                />
              </CommunicationsPanelBoundary>
            ) : null}

            {activeView === "chat_voice" ? (
              <ChatVoiceView
                chatStatusText={chatStatusText}
                briefing={morningBriefing}
                briefingStep={briefingStep}
                isRunningBriefing={isRunningBriefing}
                onRunBriefing={runMorningBriefing}
                onOpenChat={openChatPanel}
              />
            ) : null}

            {!presentationMode && activeView === "history" ? (
            <section className="reports-section" aria-label="Histórico de informes">
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">Memoria operativa v0.9</p>
                  <h3>Informes y matrices</h3>
                </div>
                <div className="report-toolbar">
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => generateStructured("daily_summary")}
                    disabled={isGeneratingStructured}
                  >
                    Generar informe diario estructurado
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => generateStructured("correlation_matrix")}
                    disabled={isGeneratingStructured}
                  >
                    Generar matriz estructurada
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => generateStructured("risks")}
                    disabled={isGeneratingStructured}
                  >
                    Generar riesgos estructurados
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => generateStructured("monitoring_gaps")}
                    disabled={isGeneratingStructured}
                  >
                    Generar huecos estructurados
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      generateAndPrepareReport(
                        "daily_summary",
                        "Informe diario operativo",
                        dailyReportPrompt
                      )
                    }
                    disabled={isSendingPrompt}
                  >
                    Generar informe diario en chat
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      prepareReportDraft(
                        "daily_summary",
                        "Informe diario operativo",
                        dailyReportPrompt
                      )
                    }
                  >
                    Guardar informe diario
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      prepareReportDraft(
                        "correlation_matrix",
                        "Matriz de correlación Zabbix + IncidenciasTI",
                        matrixPrompt
                      )
                    }
                  >
                    Guardar matriz de correlación
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={loadReports}
                    disabled={isLoadingReports}
                  >
                    Ver histórico
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      launchCommunicationDraftFromTemplate("executive_direccion", {
                        report: latestDailyReport
                      })
                    }
                    disabled={isSavingCommunicationDraft}
                  >
                    Crear correo ejecutivo
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      launchCommunicationDraftFromTemplate("tecnico_sistemas", {
                        report: latestMatrixReport
                      })
                    }
                    disabled={isSavingCommunicationDraft}
                  >
                    Crear aviso técnico
                  </button>
                  <button
                    type="button"
                    className="action-button secondary-action"
                    onClick={() =>
                      launchCommunicationDraftFromTemplate("informe_diario", {
                        report: latestDailyReport
                      })
                    }
                    disabled={isSavingCommunicationDraft}
                  >
                    Crear resumen operativo
                  </button>
                </div>
              </div>

              {isGeneratingStructured ? (
                <div className="structured-loading" aria-live="polite">
                  Generando JSON estructurado desde backend...
                </div>
              ) : null}

              <StructuredResultView result={structuredResult} />

              <div className="reports-layout">
                <div className="report-editor">
                  <div className="report-field-row">
                    <label className="report-field">
                      <span>Tipo</span>
                      <select
                        value={reportDraft.type}
                        onChange={(event) =>
                          setReportDraft((current) => ({
                            ...current,
                            type: event.target.value
                          }))
                        }
                      >
                        {reportTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="report-field">
                      <span>Título</span>
                      <input
                        type="text"
                        value={reportDraft.title}
                        onChange={(event) =>
                          setReportDraft((current) => ({
                            ...current,
                            title: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label className="report-field">
                    <span>Prompt asociado</span>
                    <textarea
                      rows={3}
                      value={reportDraft.prompt}
                      onChange={(event) =>
                        setReportDraft((current) => ({
                          ...current,
                          prompt: event.target.value
                        }))
                      }
                    />
                  </label>

                  <label className="report-field">
                    <span>Respuesta Markdown generada</span>
                    <textarea
                      rows={7}
                      value={reportDraft.response_markdown}
                      placeholder="Pega aquí la respuesta del chat que quieras conservar. No pegues tokens ni secretos."
                      onChange={(event) =>
                        setReportDraft((current) => ({
                          ...current,
                          response_markdown: event.target.value
                        }))
                      }
                    />
                  </label>

                  <div className="report-save-row">
                    <button
                      type="button"
                      className="action-button primary-action"
                      onClick={saveReport}
                      disabled={isSavingReport}
                    >
                      Guardar respuesta como informe
                    </button>
                    <span className="report-message" aria-live="polite">
                      {reportMessage || "SQLite local: solo informes generados por el usuario."}
                    </span>
                  </div>
                </div>

                <div className="report-history">
                  <div className="history-header">
                    <h3>Histórico de informes</h3>
                    <span>{isLoadingReports ? "Cargando..." : `${reports.length} recientes`}</span>
                  </div>

                  <ExportToolbar label="Exportar informes operativos">
                    <ExportLink href={latestExportUrl("executive", "html")}>
                      Descargar informe ejecutivo
                    </ExportLink>
                    <ExportLink href={latestExportUrl("technical", "html")}>
                      Descargar informe técnico
                    </ExportLink>
                    <ExportLink href={latestExportUrl("operational", "html")}>
                      Descargar informe operativo
                    </ExportLink>
                  </ExportToolbar>

                  <div className="report-filters" aria-label="Filtros de histórico">
                    <label className="report-field">
                      <span>Tipo</span>
                      <select
                        value={reportFilterType}
                        onChange={(event) => setReportFilterType(event.target.value)}
                      >
                        <option value="">Todos</option>
                        {reportTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="report-field">
                      <span>Buscar</span>
                      <input
                        type="search"
                        value={reportSearch}
                        placeholder="Texto en título o prompt"
                        onChange={(event) => setReportSearch(event.target.value)}
                      />
                    </label>
                    <label className="report-field">
                      <span>Rango</span>
                      <select
                        value={reportQuickRange}
                        onChange={(event) => setReportQuickRange(event.target.value)}
                      >
                        <option value="">Fechas manuales</option>
                        <option value="today">Solo hoy</option>
                        <option value="7d">Últimos 7 días</option>
                      </select>
                    </label>
                    <label className="report-field">
                      <span>Desde</span>
                      <input
                        type="date"
                        value={reportDateFrom}
                        onChange={(event) => setReportDateFrom(event.target.value)}
                        disabled={Boolean(reportQuickRange)}
                      />
                    </label>
                    <label className="report-field">
                      <span>Hasta</span>
                      <input
                        type="date"
                        value={reportDateTo}
                        onChange={(event) => setReportDateTo(event.target.value)}
                        disabled={Boolean(reportQuickRange)}
                      />
                    </label>
                    <label className="report-field">
                      <span>Límite</span>
                      <select
                        value={reportLimit}
                        onChange={(event) => setReportLimit(Number(event.target.value))}
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="action-button secondary-action"
                      onClick={loadReports}
                      disabled={isLoadingReports}
                    >
                      Filtrar
                    </button>
                    <button
                      type="button"
                      className="action-button secondary-action"
                      onClick={() => {
                        setReportFilterType("");
                        setReportSearch("");
                        setReportDateFrom("");
                        setReportDateTo("");
                        setReportQuickRange("");
                      }}
                    >
                      Limpiar
                    </button>
                  </div>

                  <div className="report-list">
                    {reports.length === 0 ? (
                      <p className="empty-history">Aún no hay informes guardados.</p>
                    ) : (
                      reports.map((report) => (
                        <article
                          key={report.id}
                          className={`report-list-entry${
                            selectedReport?.id === report.id ? " active" : ""
                          }`}
                        >
                          <button
                            type="button"
                            className="report-list-item"
                            onClick={() => openReport(report.id)}
                          >
                            <span className="report-list-title">{report.title}</span>
                            <span className="report-list-meta">
                              {reportTypeLabels[report.type] || report.type} ·{" "}
                              {formatDate(report.created_at)}
                            </span>
                          </button>
                          <div className="report-list-actions">
                            <button
                              type="button"
                              className="action-button secondary-action"
                              onClick={() => openReport(report.id)}
                            >
                              Ver
                            </button>
                            <ExportLink href={reportExportUrl(report.id, "html")}>
                              Descargar HTML
                            </ExportLink>
                            <ExportLink href={reportExportUrl(report.id, "markdown")}>
                              Descargar Markdown
                            </ExportLink>
                            <ExportLink href={reportExportUrl(report.id, "json")}>
                              Descargar JSON
                            </ExportLink>
                            {report.type === "correlation_matrix" ? (
                              <ExportLink href={reportExportUrl(report.id, "csv")}>
                                Descargar CSV
                              </ExportLink>
                            ) : null}
                            <button
                              type="button"
                              className="action-button secondary-action"
                              onClick={() =>
                                launchCommunicationDraftFromTemplate(
                                  communicationTemplateIdForReportType(report.type),
                                  { report }
                                )
                              }
                            >
                              {report.type === "correlation_matrix"
                                ? "Crear aviso técnico"
                                : report.type === "risks"
                                  ? "Crear aviso técnico"
                                  : report.type === "daily_summary"
                                    ? "Crear correo ejecutivo"
                                    : "Crear resumen operativo"}
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>

                  {selectedReport ? (
                    <article className="report-detail">
                      <div className="report-detail-header">
                        <div>
                          <span className="report-list-meta">
                            {reportTypeLabels[selectedReport.type] || selectedReport.type}
                          </span>
                          <h3>{selectedReport.title}</h3>
                        </div>
                        <span>{formatDate(selectedReport.created_at)}</span>
                      </div>
                      <ExportToolbar label="Exportar informe seleccionado">
                        <ExportLink href={reportExportUrl(selectedReport.id, "html")}>
                          Descargar HTML
                        </ExportLink>
                        <ExportLink href={reportExportUrl(selectedReport.id, "markdown")}>
                          Descargar Markdown
                        </ExportLink>
                        <ExportLink href={reportExportUrl(selectedReport.id, "json")}>
                          Descargar JSON
                        </ExportLink>
                        {selectedReport.type === "correlation_matrix" ? (
                          <ExportLink href={reportExportUrl(selectedReport.id, "csv")}>
                            Descargar CSV
                          </ExportLink>
                        ) : null}
                        <button
                          type="button"
                          className="action-button secondary-action"
                          onClick={() =>
                            launchCommunicationDraftFromTemplate(
                              communicationTemplateIdForReportType(selectedReport.type),
                              { report: selectedReport }
                            )
                          }
                        >
                          {selectedReport.type === "correlation_matrix"
                            ? "Crear aviso técnico"
                            : selectedReport.type === "risks"
                              ? "Crear aviso técnico"
                              : selectedReport.type === "daily_summary"
                                ? "Crear correo ejecutivo"
                                : "Crear resumen operativo"}
                        </button>
                      </ExportToolbar>
                      <pre>{selectedReport.response_markdown}</pre>
                    </article>
                  ) : null}
                </div>
              </div>
            </section>
            ) : null}

            {activeView === "dashboard" ? (
            <section className="matrix-section" aria-label="Matriz de correlación">
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">Última matriz</p>
                  <h3>Desde informe estructurado</h3>
                </div>
              </div>

              <MatrixPreview rows={dashboard?.correlation_preview} />
            </section>
            ) : null}
            </section>

            <button
              type="button"
              className={`chat-floating-button ${chatPanelOpen ? "hidden" : ""}`}
              onClick={openChatPanel}
              aria-label="Abrir chat textual"
            >
              <span>Chat</span>
              <small>{chatPanelStatusText}</small>
            </button>

            <div
              className={`chat-overlay ${chatPanelOpen ? "open" : ""}`}
              aria-hidden="true"
              onClick={closeChatPanel}
            />

            <aside
              className={`chat-column chat-drawer ${chatPanelOpen ? "open" : ""}`}
              aria-label="Chat textual"
              aria-hidden={!chatPanelOpen}
              inert={chatPanelOpen ? undefined : "true"}
            >
              <div className="chat-text-header">
                <div>
                  <p className="eyebrow">Chat textual</p>
                  <h3>Consulta al agente</h3>
                </div>
                <div className="chat-header-tools">
                  <span className={`chat-status ${chatHealth === "error" ? "error" : "ready"}`}>
                    {chatPanelStatusText}
                  </span>
                  <button
                    type="button"
                    className="chat-close-button"
                    onClick={closeChatPanel}
                    aria-label="Cerrar chat textual"
                  >
                    X
                  </button>
                </div>
              </div>
              {chatHealth === "error" && statusMessage ? (
                <p className="chat-status-message">{statusMessage}</p>
              ) : null}
              {!presentationMode ? (
              <div className="chat-diagnostics" aria-live="polite">
                <span>{chatScriptState}</span>
                <span>{chatSessionState}</span>
                <span>{chatMountState}</span>
                <span>{chatReadyState}</span>
              </div>
              ) : null}
              <div className="chat-frame" ref={chatKitVisibleShellRef}>
                <div className="chat-drawer-tabs" role="tablist" aria-label="Pestañas del chat">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chatDrawerTab === "agent"}
                    className={`chat-drawer-tab-button ${chatDrawerTab === "agent" ? "active" : ""}`}
                    onClick={() => setChatDrawerTab("agent")}
                  >
                    Agente general
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chatDrawerTab === "powerbi"}
                    className={`chat-drawer-tab-button ${chatDrawerTab === "powerbi" ? "active" : ""}`}
                    onClick={() => setChatDrawerTab("powerbi")}
                  >
                    Power BI
                  </button>
                </div>

                <div className="chat-drawer-panels">
                  <section
                    className={`chat-drawer-panel ${chatDrawerTab === "agent" ? "active" : ""}`}
                    role="tabpanel"
                    aria-label="Agente general"
                    hidden={chatDrawerTab !== "agent"}
                  >
                    <div className="chat-drawer-agent-shell">
                      <div className="chat-text-header chat-text-header-compact">
                        <div>
                          <p className="eyebrow">Chat textual</p>
                          <h3>Consulta al agente</h3>
                        </div>
                        <div className="chat-header-tools">
                          <span className={`chat-status ${chatHealth === "error" ? "error" : "ready"}`}>
                            {chatPanelStatusText}
                          </span>
                          <button
                            type="button"
                            className="chat-close-button"
                            onClick={closeChatPanel}
                            aria-label="Cerrar chat textual"
                          >
                            X
                          </button>
                        </div>
                      </div>
                      {chatHealth === "error" && statusMessage ? (
                        <p className="chat-status-message">{statusMessage}</p>
                      ) : null}
                      {!presentationMode ? (
                        <div className="chat-diagnostics" aria-live="polite">
                          <span>{chatScriptState}</span>
                          <span>{chatSessionState}</span>
                          <span>{chatMountState}</span>
                          <span>{chatReadyState}</span>
                        </div>
                      ) : null}
                      <section className="chatkit-fallback operational-chat-panel" aria-label="Consulta operativa local">
                        <form className="powerbi-local-form" onSubmit={handleAppOwnedChatSubmit}>
                          <textarea
                            className="powerbi-local-textarea operational-local-textarea"
                            value={localOpsQuestion}
                            onChange={(event) => {
                              const next = String(event?.target?.value || "");
                              setLocalOpsQuestion(next);
                              setLocalOpsError("");
                            }}
                            placeholder="Consulta operativa: firewalls, Zabbix, NAS, UPS..."
                            rows={2}
                          />
                          <div className="powerbi-local-actions">
                            <button type="submit" className="button button-primary" disabled={localOpsLoading}>
                              {localOpsLoading ? "Consultando..." : "Consultar"}
                            </button>
                          </div>
                        </form>
                        {localOpsError ? <p className="chatkit-fallback-error">{localOpsError}</p> : null}
                        {Array.isArray(localOpsMessages) && localOpsMessages.length ? (
                          <div className="powerbi-local-messages">
                            {localOpsMessages.slice(-4).map((entry) => (
                              <article key={entry.id} className="powerbi-local-message">
                                <div className="structured-status-row">
                                  <span className={`status-badge ${entry.role === "assistant" ? "green" : "yellow"}`}>
                                    {entry.role === "assistant" ? "Asistente" : "Usuario"}
                                  </span>
                                  <span className="structured-source">{formatDate(entry.createdAt)}</span>
                                </div>
                                {entry.role === "assistant" ? (
                                  <OperationalChatResultView entry={entry} />
                                ) : (
                                  <p className="structured-summary">{entry.content}</p>
                                )}
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </section>
                      {!localOpsMessages.length && (latestOpsResult?.spokenResponse ||
                      latestOpsResult?.visualResult ||
                      latestOpsResult?.rejectionReason) ? (
                        <div className="ops-result-banner">
                          <OpsResultView
                            result={latestOpsResult}
                            onPrevious={handleOpsPreviousIncident}
                            onNext={handleOpsNextIncident}
                            onPrepareCreatorEmail={handlePrepareCreatorEmailFromIncident}
                            onSelectIncident={selectIncidentFromOpsResult}
                          />
                        </div>
                      ) : null}
                      {chatHealth !== "ready" ? (
                        <div className="chatkit-fallback" role="status">
                          <strong>{chatStatusText}</strong>
                          <p>Estado de sesión: {chatSessionState}</p>
                          <p>Client secret efímero recibido: {hasChatClientSecret ? "sí" : "no"}</p>
                          <p>Montaje: {chatMountState}</p>
                          <p>Estado interno: {chatReadyState}</p>
                          {chatError ? <p className="chatkit-fallback-error">ChatKit error: {chatError}</p> : null}
                          <p>Si queda en este estado, recarga la página y revisa la consola del navegador.</p>
                        </div>
                      ) : null}
                      <div className="chatkit-host-shell">
                        <ChatKit
                          ref={handleChatKitRef}
                          control={control}
                          className="chatkit-host"
                          style={{
                            display: "block",
                            width: "100%",
                            height: "100%",
                            minHeight: "620px"
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section
                    className={`chat-drawer-panel ${chatDrawerTab === "powerbi" ? "active" : ""}`}
                    role="tabpanel"
                    aria-label="Power BI"
                    hidden={chatDrawerTab !== "powerbi"}
                  >
                    <div className="chatkit-fallback powerbi-local-input-panel" aria-label="Consulta local Power BI">
                      <div className="section-heading compact-heading">
                        <div>
                          <p className="eyebrow">Consulta local Power BI</p>
                          <h3>administracion_ventas</h3>
                        </div>
                        <span className="structured-source">Router controlado</span>
                      </div>
                      <p className="chatkit-fallback-note">ChatKit queda para el agente general.</p>
                      <div className="powerbi-local-help">
                        <button
                          type="button"
                          className="action-button secondary-action powerbi-local-help-toggle"
                          onClick={() => setShowLocalPowerBiHelp((current) => !current)}
                        >
                          {showLocalPowerBiHelp ? "Ocultar ayuda rápida" : "Ver ejemplos"}
                        </button>
                        {showLocalPowerBiHelp ? (
                          <div className="report-preview">
                            <h4>Ayuda rápida</h4>
                            <p>{powerBiVoiceHelpText}</p>
                            <div className="report-list-actions">
                              {powerBiSupportedUtterances.slice(0, 6).map((utterance) => (
                                <button
                                  key={utterance}
                                  type="button"
                                  className="action-button secondary-action"
                                  onClick={() => setLocalPowerBiQuestion(utterance)}
                                >
                                  {utterance}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="structured-warning">
                        No soportado todavía: margen, rentabilidad, este año / año pasado, exportaciones y DAX manual.
                      </div>
                      <form className="powerbi-local-form" onSubmit={handleLocalPowerBiSubmit}>
                        <textarea
                          className="powerbi-local-textarea"
                          value={localPowerBiQuestion}
                          onChange={(event) => {
                            const next = String(event?.target?.value || "");
                            setLocalPowerBiQuestion(next);
                            setLocalPowerBiError("");
                          }}
                          placeholder="Escribe una consulta Power BI sobre ventas o unidades..."
                          rows={3}
                        />
                        <div className="powerbi-local-actions">
                          <button type="submit" className="button button-primary" disabled={localPowerBiLoading}>
                            {localPowerBiLoading ? "Consultando..." : "Consultar"}
                          </button>
                          <span className="structured-source">
                            Solo se aceptan consultas seguras de ventas o unidades.
                          </span>
                        </div>
                      </form>
                      {localPowerBiError ? <p className="chatkit-fallback-error">{localPowerBiError}</p> : null}
                      {Array.isArray(localPowerBiMessages) && localPowerBiMessages.length ? (
                        <div className="powerbi-local-messages">
                          {localPowerBiMessages.slice(-1).map((entry) => (
                            <article key={entry.id} className="powerbi-local-message">
                              <div className="structured-status-row">
                                <span className={`status-badge ${entry.type === "powerbi_result" ? "green" : "yellow"}`}>
                                  {entry.role === "assistant" ? "Asistente" : "Usuario"}
                                </span>
                                <span className="structured-source">{formatDate(entry.createdAt)}</span>
                              </div>
                              <p className="structured-summary">{entry.content}</p>
                              {entry.type === "powerbi_result" ? (
                                <PowerBiChatResultView result={entry.result} onExpand={openPowerBiExpandedResult} />
                              ) : entry.type === "powerbi_rejection" ? (
                                <div className="structured-warning">{entry.content}</div>
                              ) : entry.type === "powerbi_error" ? (
                                <div className="structured-warning">{entry.content}</div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            </aside>
          </div>
        </section>
        {powerBiExpandedResult?.result ? (
          <PowerBiExpandedResultOverlay
            result={powerBiExpandedResult.result}
            onClose={closePowerBiExpandedResult}
          />
        ) : null}
      </main>
    </>
  );
}
