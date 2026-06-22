import { useEffect, useRef, useState } from "react";
import { handlePowerBiVoiceCommand } from "../lib/powerbiVoiceRouter";
import { handleOpsVoiceCommand } from "../lib/opsIntentRouterClient";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

const statusLabels = {
  disconnected: "desconectado",
  listening: "escuchando",
  thinking: "pensando",
  speaking: "hablando",
  briefing: "briefing",
  consulting: "consultando dashboard",
  generating: "generando informe",
  refreshing: "actualizando dashboard",
  error: "error"
};

const toolStatusLabels = {
  get_dashboard_latest: "consultando dashboard",
  refresh_dashboard: "actualizando dashboard",
  generate_daily_summary: "generando informe diario",
  generate_correlation_matrix: "generando matriz",
  generate_critical_risks: "generando riesgos",
  generate_monitoring_gaps: "generando huecos",
  voice_open_incidents: "consultando incidencias abiertas",
  voice_incidents_in_progress: "consultando incidencias en curso",
  voice_critical_risks: "consultando riesgos críticos",
  voice_storage_backup_status: "consultando NAS/backups/storage",
  voice_monitoring_gaps: "consultando huecos",
  voice_today_actions: "consultando acciones de hoy",
  voice_run_daily_report: "generando informe de hoy",
  voice_today_report: "consultando informe de hoy",
  voice_latest_matrix: "consultando última matriz",
  voice_show_incident_chart: "preparando gráfico de incidencias",
  voice_show_risk_chart: "preparando gráfico de riesgos",
  voice_morning_briefing: "preparando briefing",
  voice_analytics_summary: "consultando análisis",
  voice_analytics_reports: "consultando evolución",
  voice_directory_search: "buscando en libreta corporativa",
  voice_prepare_executive_report: "preparando informe ejecutivo",
  voice_prepare_technical_report: "preparando informe técnico",
  voice_prepare_operational_report: "preparando informe operativo",
  voice_prepare_matrix_export: "preparando exportación de matriz",
  voice_prepare_communication_draft: "preparando borrador de comunicación",
  voice_communication_draft_decision: "decidiendo envío de borrador",
  voice_prepare_email_send: "abriendo confirmación de envío",
  voice_manage_communication_drafts: "revisando borradores",
  voice_report_direction: "orientando informe para dirección",
  voice_report_systems: "orientando informe para sistemas",
  voice_export_help: "mostrando descargas",
  voice_search: "buscando en informes",
  voice_powerbi_query: "consultando Power BI",
  voice_ops_query: "consultando IncidenciasTI/Zabbix"
};

const internalTools = {
  get_dashboard_latest: {
    method: "GET",
    endpoint: "/api/dashboard/latest",
    status: "consulting"
  },
  refresh_dashboard: {
    method: "POST",
    endpoint: "/api/dashboard/refresh",
    status: "refreshing"
  },
  generate_daily_summary: {
    method: "POST",
    endpoint: "/api/structured/daily-summary",
    status: "generating"
  },
  generate_correlation_matrix: {
    method: "POST",
    endpoint: "/api/structured/correlation-matrix",
    status: "generating"
  },
  generate_critical_risks: {
    method: "POST",
    endpoint: "/api/structured/critical-risks",
    status: "generating"
  },
  generate_monitoring_gaps: {
    method: "POST",
    endpoint: "/api/structured/monitoring-gaps",
    status: "generating"
  },
  voice_open_incidents: {
    method: "GET",
    endpoint: "/api/voice/open-incidents",
    status: "consulting"
  },
  voice_incidents_in_progress: {
    method: "GET",
    endpoint: "/api/voice/incidents-in-progress",
    status: "consulting"
  },
  voice_critical_risks: {
    method: "GET",
    endpoint: "/api/voice/critical-risks",
    status: "consulting"
  },
  voice_storage_backup_status: {
    method: "GET",
    endpoint: "/api/voice/storage-backup-status",
    status: "consulting"
  },
  voice_monitoring_gaps: {
    method: "GET",
    endpoint: "/api/voice/monitoring-gaps",
    status: "consulting"
  },
  voice_today_actions: {
    method: "GET",
    endpoint: "/api/voice/today-actions",
    status: "consulting"
  },
  voice_run_daily_report: {
    method: "POST",
    endpoint: "/api/dashboard/run-daily-report",
    status: "refreshing"
  },
  voice_today_report: {
    method: "GET",
    endpoint: "/api/voice/today-report",
    status: "consulting"
  },
  voice_latest_matrix: {
    method: "GET",
    endpoint: "/api/voice/latest-matrix",
    status: "consulting"
  },
  voice_show_incident_chart: {
    method: "GET",
    endpoint: "/api/voice/latest-matrix",
    status: "consulting"
  },
  voice_show_risk_chart: {
    method: "GET",
    endpoint: "/api/voice/latest-matrix",
    status: "consulting"
  },
  voice_morning_briefing: {
    method: "GET",
    endpoint: "/api/voice/morning-briefing",
    status: "briefing"
  },
  voice_analytics_summary: {
    method: "GET",
    endpoint: "/api/analytics/summary",
    status: "consulting"
  },
  voice_analytics_reports: {
    method: "GET",
    endpoint: "/api/analytics/reports?days=7",
    status: "consulting"
  },
  voice_directory_search: {
    method: "GET",
    endpoint: "/api/directory/search",
    status: "consulting"
  },
  voice_prepare_executive_report: {
    local: true,
    status: "consulting"
  },
  voice_prepare_technical_report: {
    local: true,
    status: "consulting"
  },
  voice_prepare_operational_report: {
    local: true,
    status: "consulting"
  },
  voice_prepare_matrix_export: {
    local: true,
    status: "consulting"
  },
  voice_prepare_communication_draft: {
    local: true,
    status: "consulting"
  },
  voice_communication_draft_decision: {
    local: true,
    status: "consulting"
  },
  voice_prepare_email_send: {
    local: true,
    status: "consulting"
  },
  voice_manage_communication_drafts: {
    local: true,
    status: "consulting"
  },
  voice_report_direction: {
    local: true,
    status: "consulting"
  },
  voice_report_systems: {
    local: true,
    status: "consulting"
  },
  voice_export_help: {
    local: true,
    status: "consulting"
  },
  voice_search: {
    method: "GET",
    endpoint: "/api/voice/search",
    status: "consulting"
  },
  voice_powerbi_query: {
    local: true,
    status: "consulting"
  },
  voice_ops_query: {
    local: true,
    status: "consulting"
  }
};

const manualToolButtons = [
  ["get_dashboard_latest", "Probar get_dashboard_latest"],
  ["refresh_dashboard", "Probar refresh_dashboard"],
  ["generate_daily_summary", "Probar generate_daily_summary"],
  ["generate_correlation_matrix", "Probar generate_correlation_matrix"],
  ["generate_critical_risks", "Probar generate_critical_risks"],
  ["generate_monitoring_gaps", "Probar generate_monitoring_gaps"],
  ["voice_open_incidents", "Probar incidencias abiertas"],
  ["voice_incidents_in_progress", "Probar incidencias en curso"],
  ["voice_critical_risks", "Probar riesgos críticos"],
  ["voice_storage_backup_status", "Probar NAS/backups"],
  ["voice_monitoring_gaps", "Probar huecos semánticos"],
  ["voice_today_actions", "Probar acciones de hoy"],
  ["voice_run_daily_report", "Probar informe de hoy"],
  ["voice_today_report", "Probar ver informe de hoy"],
  ["voice_latest_matrix", "Probar última matriz"],
  ["voice_show_incident_chart", "Probar gráfico incidencias"],
  ["voice_show_risk_chart", "Probar gráfico riesgos"],
  ["voice_morning_briefing", "Probar briefing de mañana"],
  ["voice_analytics_summary", "Probar análisis"],
  ["voice_analytics_reports", "Probar evolución"],
  ["voice_directory_search", "Probar libreta corporativa", { q: "fernando" }],
  ["voice_prepare_executive_report", "Probar preparar ejecutivo"],
  ["voice_prepare_technical_report", "Probar preparar técnico"],
  ["voice_prepare_operational_report", "Probar preparar operativo"],
  ["voice_prepare_matrix_export", "Probar preparar matriz exportable"],
  ["voice_prepare_communication_draft", "Probar borrador comunicación"],
  ["voice_prepare_email_send", "Probar confirmación envío"],
  ["voice_manage_communication_drafts", "Probar revisión borradores"],
  ["voice_report_direction", "Probar informe dirección"],
  ["voice_report_systems", "Probar informe sistemas"],
  ["voice_export_help", "Probar ayuda descargas"],
  ["voice_search", "Probar búsqueda impresoras", { q: "impresoras" }],
  ["voice_powerbi_query", "Probar Power BI voz", { question: "Cuánto hemos vendido" }],
  ["voice_ops_query", "Probar operaciones voz", { question: "Última incidencia" }]
];

const fallbackVoiceOptions = ["marin", "cedar"];
const responseStyles = [
  ["operativo", "Operativo"],
  ["ejecutivo", "Ejecutivo"],
  ["breve", "Breve"],
  ["tecnico", "Técnico"]
];
const avatarThemes = [
  ["default", "Default"],
  ["robot", "Robot"],
  ["tecnico", "Técnico"],
  ["empresa", "Empresa"]
];
const voiceTestText =
  "Hola, soy el Agente Inteligente de Infraestructura. Esta es una prueba de voz.";

function normalizeOption(value, fallback, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function localExportToolPayload(toolName, args = {}) {
  const commonItems = [
    {
      title: "Descargar HTML",
      detail: "Genera un archivo legible y preparado para imprimir.",
      priority: "low",
      source: "export_ui"
    },
    {
      title: "Descargar datos JSON",
      detail: "Exporta metadata_json saneado para archivo manual.",
      priority: "low",
      source: "export_ui"
    }
  ];

  if (toolName === "voice_prepare_executive_report") {
    return {
      ok: true,
      topic: "export_executive_report",
      title: "Informe ejecutivo preparado",
      summary:
        "He abierto la vista Informe de hoy. Usa el botón Descargar informe ejecutivo.",
      items: commonItems,
      missing_data: [],
      recommended_action:
        "Pulsa Descargar informe ejecutivo; si necesitas PDF, usa Preparar PDF y guarda desde el navegador."
    };
  }

  if (toolName === "voice_prepare_technical_report") {
    return {
      ok: true,
      topic: "export_technical_report",
      title: "Informe técnico preparado",
      summary: "He abierto la vista Informe de hoy. Usa el botón Descargar informe técnico.",
      items: commonItems,
      missing_data: [],
      recommended_action:
        "Pulsa Descargar informe técnico, Descargar Markdown o Descargar datos JSON según el destino."
    };
  }

  if (
    toolName === "voice_prepare_operational_report" ||
    toolName === "voice_report_direction" ||
    toolName === "voice_report_systems"
  ) {
    return {
      ok: true,
      topic:
        toolName === "voice_prepare_operational_report"
          ? "export_operational_report"
          : toolName === "voice_report_direction"
            ? "export_direction_report"
            : "export_systems_report",
      title:
        toolName === "voice_prepare_operational_report"
          ? "Informe operativo preparado"
          : toolName === "voice_report_direction"
            ? "Informe para dirección preparado"
            : "Informe para sistemas preparado",
      summary:
        toolName === "voice_prepare_operational_report"
          ? "He abierto la vista Informe de hoy. Usa el botón Descargar informe operativo."
          : toolName === "voice_report_direction"
            ? "Para dirección conviene el informe ejecutivo. He abierto la vista Informe de hoy."
            : "Para sistemas conviene el informe técnico. He abierto la vista Informe de hoy.",
      items:
        toolName === "voice_report_direction"
          ? [
              {
                title: "Descargar informe ejecutivo",
                detail: "Versión breve orientada a responsables.",
                priority: "low",
                source: "export_ui"
              },
              ...commonItems
            ]
          : toolName === "voice_report_systems"
            ? [
                {
                  title: "Descargar informe técnico",
                  detail: "Versión detallada para el equipo de sistemas.",
                  priority: "low",
                  source: "export_ui"
                },
                ...commonItems
              ]
            : [
                {
                  title: "Descargar informe operativo",
                  detail: "Checklist de trabajo del día.",
                  priority: "low",
                  source: "export_ui"
                },
                ...commonItems
              ],
      missing_data: [],
      recommended_action:
        toolName === "voice_report_direction"
          ? "Pulsa Descargar informe ejecutivo."
          : toolName === "voice_report_systems"
            ? "Pulsa Descargar informe técnico."
            : "Pulsa Descargar informe operativo."
    };
  }

  if (toolName === "voice_prepare_matrix_export") {
    return {
      ok: true,
      topic: "export_matrix",
      title: "Matriz preparada para exportar",
      summary: "He abierto la vista Matriz. Usa Descargar matriz CSV para Excel o LibreOffice.",
      items: [
        {
          title: "Descargar matriz CSV",
          detail: "Archivo tabular con las columnas de correlación.",
          priority: "low",
          source: "export_ui"
        },
        ...commonItems
      ],
      missing_data: [],
      recommended_action: "Pulsa Descargar matriz CSV o Descargar datos JSON en la vista Matriz."
    };
  }

  if (toolName === "voice_prepare_communication_draft") {
    const intent = String(args.intent || args.kind || "").toLowerCase();
    const inferredKind =
      String(args.kind || "").toLowerCase() ||
      (intent.includes("support") || intent.includes("teams") || intent.includes("notice")
        ? "teams"
        : "email");
    const inferredTemplateId =
      String(args.template_id || "").trim() ||
      (intent.includes("provider")
        ? "proveedor"
        : intent.includes("user") || intent.includes("final")
          ? "usuario_final"
          : intent.includes("follow")
            ? "seguimiento_incidencia"
            : intent.includes("risk") || intent.includes("critical")
              ? "aviso_riesgo_critico"
              : intent.includes("teams") || intent.includes("support")
                ? "tecnico_sistemas"
                : "executive_direccion");
    const inferredSourceType =
      String(args.source_type || "").toLowerCase() ||
      (intent.includes("incident")
        ? "incident"
        : intent.includes("support") || intent.includes("risk") || intent.includes("notice")
          ? "risk"
          : "daily_report");
    const recipientLabel =
      String(args.recipient_label || "").trim() ||
      String(args.recipient_query || "").trim() ||
      (intent.includes("direction")
        ? "Dirección"
        : intent.includes("support")
          ? "Soporte"
          : intent.includes("follow")
            ? "Operación"
            : "Equipo interno");
    const subject =
      String(args.subject || "").trim() ||
      (intent.includes("direction")
        ? "Correo para dirección"
        : intent.includes("support")
          ? "Aviso para soporte"
          : intent.includes("follow")
            ? "Seguimiento de incidencia"
            : "Borrador de comunicación");
    const bodyMarkdown = [
      "# Borrador de comunicación",
      "",
      `- Destinatario: ${recipientLabel}`,
      `- Tipo: ${String(args.kind || "email")}`,
      `- Plantilla: ${inferredTemplateId}`,
      "",
      "## Resumen",
      "Te he preparado un borrador. Revísalo en pantalla antes de enviarlo manualmente.",
      "",
      "## Mensaje",
      String(args.message || "Mensaje preparado a partir del contexto operativo actual.")
    ].join("\n");

    return {
      ok: true,
      topic: "communication_draft",
      title: "Borrador de comunicación preparado",
      summary: "Te he preparado un borrador. Revísalo en pantalla antes de enviarlo manualmente.",
      draft: {
        template_id: inferredTemplateId,
        type: inferredKind,
        status: "draft",
        recipient_label: recipientLabel,
        recipient_email: String(args.recipient_email || "").trim(),
        subject,
        body_markdown: bodyMarkdown,
        body_text: bodyMarkdown,
        source_type: inferredSourceType,
        source_report_id: String(args.source_report_id || ""),
        source_incident_id: String(args.source_incident_id || ""),
        custom_context: {
          summary: String(args.message || "Mensaje preparado a partir del contexto operativo actual."),
          message: String(args.message || "Mensaje preparado a partir del contexto operativo actual."),
          recipient_query: String(args.recipient_query || "").trim(),
          source_type: inferredSourceType,
          source_report_id: String(args.source_report_id || ""),
          source_incident_id: String(args.source_incident_id || ""),
          report_date: new Date().toISOString()
        }
      },
      items: [
        {
          title: "Revisar destinatario",
          detail: recipientLabel,
          priority: "low",
          source: "communication_draft"
        },
        {
          title: "Copiar texto",
          detail: "El borrador queda listo para copiar o descargar.",
          priority: "low",
          source: "communication_draft"
        }
      ],
      missing_data: [],
      recommended_action: "Revisa el borrador en pantalla antes de enviarlo manualmente."
    };
  }

  if (toolName === "voice_prepare_email_send") {
    return {
      ok: true,
      topic: "communication_send_confirmation",
      title: "Confirmación de envío abierta",
      summary:
        "He abierto la vista Comunicaciones. Selecciona un borrador de email revisado y pulsa Preparar envío para ver la doble confirmación. Si pedías enviarlo, revisa la pantalla y pulsa manualmente.",
      items: [
        {
          title: "Borrador revisado",
          detail: "Solo se puede preparar el envío si el borrador es de tipo email y está revisado.",
          priority: "medium",
          source: "communication_send"
        },
        {
          title: "Confirmación visual",
          detail: "Primero se prepara el envío y luego se confirma manualmente en pantalla.",
          priority: "medium",
          source: "communication_send"
        }
      ],
      missing_data: [],
      recommended_action:
        "Abre un borrador revisado de tipo email y pulsa Preparar envío antes de confirmar."
    };
  }

  if (toolName === "voice_manage_communication_drafts") {
    const intent = String(args.intent || args.action || "").toLowerCase();
    const action =
      String(args.action || "").trim() ||
      (intent.includes("pend") || intent.includes("pendiente")
        ? "show_pending"
        : intent.includes("ready") || intent.includes("list")
          ? "show_ready"
          : intent.includes("discard")
            ? "discard_latest"
            : "mark_selected_reviewed");
    const actionLabels = {
      show_pending: "pendientes de revisión",
      show_ready: "listos para revisión",
      mark_selected_reviewed: "marcar seleccionado como revisado",
      mark_selected_ready: "marcar seleccionado como listo",
      discard_latest: "descartar el último borrador",
      mark_selected_copied: "marcar seleccionado como copiado"
    };

    return {
      ok: true,
      topic: "communication_review",
      title: "Revisión de borradores",
      summary: `Voy a ${actionLabels[action] || action}. Te he abierto la vista de comunicaciones.`,
      action,
      items: [
        {
          title: "Abrir Comunicaciones",
          detail: "La revisión se hace localmente sobre borradores ya guardados.",
          priority: "low",
          source: "communication_drafts"
        },
        {
          title: "Aplicar estado local",
          detail: actionLabels[action] || action,
          priority: "medium",
          source: "communication_drafts"
        }
      ],
      missing_data: [],
      recommended_action: "Revisa la lista en pantalla y confirma el estado antes de continuar."
    };
  }

  return {
    ok: true,
    topic: "export_help",
    title: "Descargas disponibles",
    summary:
      "Las descargas están en Informe de hoy, Matriz, Análisis y en cada elemento del Histórico.",
    items: [
      {
        title: "Informe de hoy",
        detail: "Ejecutivo, técnico, Markdown, JSON y HTML imprimible para PDF.",
        priority: "low",
        source: "export_ui"
      },
      {
        title: "Matriz",
        detail: "CSV, HTML, Markdown y JSON.",
        priority: "low",
        source: "export_ui"
      },
      {
        title: "Histórico",
        detail: "Cada informe tiene Ver, HTML, Markdown, JSON y CSV si es matriz.",
        priority: "low",
        source: "export_ui"
      }
    ],
    missing_data: [],
    recommended_action: "Abre la pestaña correspondiente y pulsa el botón de descarga."
  };
}

function summarizeForVoice(toolName, payload) {
  if (!payload) {
    return { ok: false, message: "La herramienta no devolvió datos." };
  }

  if (toolName === "get_dashboard_latest") {
    return {
      ok: true,
      tool: toolName,
      overall_status: payload.overall_status,
      cards: (payload.cards || []).map((card) => ({
        title: card.title,
        value: card.value,
        status: card.status,
        description: card.description
      })),
      top_actions: (payload.top_actions || []).slice(0, 5),
      critical_risks: (payload.critical_risks || []).slice(0, 5),
      monitoring_gaps: (payload.monitoring_gaps || []).slice(0, 5),
      correlation_preview: (payload.correlation_preview || []).slice(0, 5),
      missing_reports: payload.missing_reports || []
    };
  }

  if (toolName === "refresh_dashboard" || toolName === "voice_run_daily_report") {
    return {
      ok: true,
      tool: toolName,
      reports: (payload.reports || []).map((report) => ({
        kind: report.kind,
        report_id: report.report_id,
        source: report.source,
        warning: report.warning
      })),
      overall_status: payload.dashboard?.overall_status,
      cards: (payload.dashboard?.cards || []).map((card) => ({
        title: card.title,
        value: card.value,
        status: card.status
      })),
      top_actions: (payload.dashboard?.top_actions || []).slice(0, 5)
    };
  }

  if (toolName.startsWith("voice_")) {
    if (toolName === "voice_directory_search") {
      return {
        ok: true,
        tool: toolName,
        topic: "directory_search",
        title: "Libreta corporativa",
        summary: `Encontrados ${payload.users?.length || 0} usuarios.`,
        users: payload.users || [],
        items: (payload.users || []).slice(0, 8).map((user) => ({
          title: user.display_name || user.mail || user.user_principal_name || "Usuario",
          detail: [user.mail, user.job_title, user.department, user.office_location]
            .filter(Boolean)
            .join(" · "),
          priority: user.account_enabled === false ? "low" : "medium",
          source: "company_directory"
        })),
        missing_data: payload.users?.length ? [] : ["No hay coincidencias en la libreta corporativa."],
        recommended_action: "Selecciona un usuario en la vista Libreta o úsalo en un borrador."
      };
    }
    if (toolName === "voice_analytics_summary") {
      return {
        ok: true,
        tool: toolName,
        topic: "analytics_summary",
        title: "Análisis operativo",
        summary: `Estado ${payload.today?.overall_status || "unknown"}. Cambio: ${
          payload.diff?.status_change || "sin comparativa"
        }. Riesgos nuevos: ${payload.diff?.new_critical_risks?.length || 0}. Huecos nuevos: ${
          payload.diff?.monitoring_gap_changes?.new?.length || 0
        }.`,
        items: [
          ...(payload.diff?.new_critical_risks || []).map((item) => ({
            title: item,
            priority: "high",
            source: "analytics_diff"
          })),
          ...(payload.diff?.persistent_critical_risks || []).map((item) => ({
            title: item,
            priority: "medium",
            source: "analytics_diff"
          }))
        ].slice(0, 8),
        missing_data: payload.warnings || [],
        recommended_action: "Abre la pestaña Análisis para revisar evolución, comparativa y gráficos."
      };
    }
    if (toolName === "voice_analytics_reports") {
      return {
        ok: true,
        tool: toolName,
        topic: "analytics_reports",
        title: "Evolución de informes",
        summary: `Hay ${payload.reports?.length || 0} días con informes en el periodo consultado.`,
        items: (payload.reports || []).slice(-7).map((day) => ({
          title: day.date,
          detail: `Estado ${day.overall_status}. Riesgos ${day.critical_risks_count}. Huecos ${day.monitoring_gaps_count}. Acciones ${day.actions_count}.`,
          priority: day.complete ? "low" : "medium",
          source: "analytics_reports"
        })),
        missing_data: [],
        recommended_action: "Revisa días incompletos y regenera informes si faltan datos."
      };
    }
  if (toolName === "voice_prepare_email_send") {
    return {
      ok: true,
      tool: toolName,
      topic: "communication_send_confirmation",
        title: "Confirmación de envío abierta",
        summary: payload.summary,
        items: (payload.items || []).slice(0, 4).map((item) => ({
          title: item.title || "Elemento",
          detail: item.detail || "",
          priority: item.priority || "medium",
          source: item.source || "communication_send"
        })),
        missing_data: payload.missing_data || [],
        recommended_action: payload.recommended_action || ""
      };
    }
    if (toolName === "voice_manage_communication_drafts") {
      return {
        ok: true,
        tool: toolName,
        topic: "communication_review",
        title: "Revisión de borradores",
        summary: payload.summary,
        action: payload.action,
        items: (payload.items || []).slice(0, 4).map((item) => ({
          title: item.title || "Elemento",
          detail: item.detail || "",
          priority: item.priority || "medium",
          source: item.source || "communication_drafts"
        })),
        missing_data: payload.missing_data || [],
        recommended_action: payload.recommended_action || ""
      };
    }
    return {
      ok: payload.ok !== false,
      tool: toolName,
      topic: payload.topic,
      title: payload.title,
      summary: payload.summary,
      draft: payload.draft || null,
      updated_at: payload.updated_at || null,
      items: (payload.items || []).slice(0, 6).map((item) => ({
        title: item.title || item.asset_or_service || item.action || "Elemento",
        detail: item.detail || item.description || item.recommended_action || "",
        priority: item.priority || item.severity || "unknown",
        status: item.status || "",
        source: item.source || ""
      })),
      missing_data: payload.missing_data || [],
      recommended_action: payload.recommended_action || ""
    };
  }

  return {
    ok: true,
    tool: toolName,
    report_id: payload.report?.id || null,
    title: payload.report?.title || payload.data?.title || "Informe generado",
    source: payload.source || null,
    warning: payload.warning || null,
    summary:
      payload.data?.executive_summary ||
      payload.data?.summary ||
      "Informe estructurado generado y guardado.",
    top_actions: (payload.data?.top_actions || []).slice(0, 5),
    rows: (payload.data?.rows || []).slice(0, 5),
    risks: (payload.data?.risks || []).slice(0, 5),
    gaps: (payload.data?.gaps || []).slice(0, 5)
  };
}

function compactToolSummary(toolName, output) {
  if (!output?.ok) {
    return output?.error || output?.message || "La herramienta falló.";
  }

  if (toolName === "get_dashboard_latest") {
    return `Estado ${output.overall_status || "unknown"} · ${output.cards?.length || 0} tarjetas · ${
      output.top_actions?.length || 0
    } acciones · ${output.critical_risks?.length || 0} riesgos.`;
  }

  if (toolName === "refresh_dashboard" || toolName === "voice_run_daily_report") {
    return `Dashboard actualizado · ${output.reports?.length || 0} informes · estado ${
      output.overall_status || "unknown"
    }.`;
  }

  if (toolName === "generate_correlation_matrix") {
    return `Matriz generada · informe #${output.report_id || "n/a"} · ${
      output.rows?.length || 0
    } filas resumidas.`;
  }

  if (toolName === "generate_critical_risks") {
    return `Riesgos generados · informe #${output.report_id || "n/a"} · ${
      output.risks?.length || 0
    } riesgos resumidos.`;
  }

  if (toolName === "generate_monitoring_gaps") {
    return `Huecos generados · informe #${output.report_id || "n/a"} · ${
      output.gaps?.length || 0
    } huecos resumidos.`;
  }

  if (toolName === "voice_directory_search") {
    return `Libreta corporativa · ${output.items?.length || 0} coincidencias · ${
      output.missing_data?.length || 0
    } avisos.`;
  }

  if (toolName === "voice_manage_communication_drafts") {
    return `Revisión local · ${output.action || "sin acción"} · ${output.items?.length || 0} elementos.`;
  }

  if (toolName === "voice_communication_draft_decision") {
    if (output?.action === "communication_send_confirmation_requested") {
      return `Confirmación verbal requerida · borrador #${output.draft_id} · ${output.recipient_email || "sin destinatario"}.`;
    }
    if (output?.action === "communication_direct_sent") {
      return `Correo enviado · borrador #${output.draft_id} · ${output.recipient_email || "sin destinatario"}.`;
    }
    return output?.spokenResponse || output?.error || "Decisión de borrador procesada.";
  }

  if (toolName === "voice_prepare_email_send") {
    return `Confirmación de envío abierta · ${output.items?.length || 0} elementos · ${
      output.missing_data?.length || 0
    } avisos · requiere confirmación manual.`;
  }

  if (toolName === "voice_powerbi_query") {
    if (!output?.ok) {
      return output?.error || output?.message || "La herramienta falló.";
    }
    if (output?.unsupported) {
      return `Consulta Power BI no soportada · ${output.rejectionReason || output.spokenResponse || "sin detalle"}.`;
    }
    return `${output.spokenResponse || "Consulta Power BI"} · ${
      output.visualResult?.rowCount || 0
    } filas · ${output.visualResult?.truncated ? "truncado" : "completo"}.`;
  }

  if (toolName === "voice_ops_query") {
    if (!output?.ok) {
      return output?.error || output?.message || "La herramienta falló.";
    }
    if (output?.action === "communication_direct_sent" && output?.draft_id) {
      return `Envío directo completado · borrador #${output.draft_id} · ${output.recipient_email || "sin destinatario"}.`;
    }
    if (output?.action === "communication_draft_created" && output?.draft_id) {
      return `Borrador #${output.draft_id} creado · no enviado · abriendo revisión.`;
    }
    if (output?.unsupported) {
      return `Consulta operativa no soportada · ${
        output.rejectionReason || output.spokenResponse || "sin detalle"
      }.`;
    }
    const blockCount = output.visualResult?.sourceBlocks?.length || 0;
    const itemCount = Array.isArray(output.visualResult?.items) ? output.visualResult.items.length : 0;
    const sizeLabel = blockCount ? `${blockCount} bloques` : `${itemCount || 0} elementos`;
    return `${output.spokenResponse || "Consulta operativa"} · ${
      output.visualResult?.kind || "resultado"
    } · ${sizeLabel}.`;
  }

  if (toolName.startsWith("voice_")) {
    if (output?.action === "communication_direct_sent" && output?.draft_id) {
      return `Envío directo completado · borrador #${output.draft_id} · ${output.recipient_email || "sin destinatario"}.`;
    }
    if (output?.action === "communication_draft_created" && output?.draft_id) {
      return `Borrador #${output.draft_id} creado · no enviado · abriendo revisión.`;
    }
    return `${output.title || "Consulta"} · ${output.items?.length || 0} elementos · ${
      output.missing_data?.length || 0
    } avisos.`;
  }

  return `Informe generado · informe #${output.report_id || "n/a"}.`;
}

function isCreatorEmailRequest(transcript) {
  const normalized = String(transcript || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalized.includes("email del creador") ||
    normalized.includes("correo del creador") ||
    normalized.includes("email al creador") ||
    normalized.includes("correo al creador") ||
    normalized.includes("email de esta incidencia") ||
    normalized.includes("correo de esta incidencia") ||
    normalized.includes("avisar al creador") ||
    normalized.includes("avisa al creador") ||
    normalized.includes("mandar correo al creador") ||
    normalized.includes("mandar email al creador") ||
    normalized.includes("manda correo al creador") ||
    normalized.includes("manda email al creador") ||
    normalized.includes("manda el correo al creador") ||
    normalized.includes("manda el email al creador") ||
    normalized.includes("mandale correo al creador") ||
    normalized.includes("mándale correo al creador") ||
    normalized.includes("mandale email al creador") ||
    normalized.includes("mándale email al creador") ||
    normalized.includes("mandale algo al creador") ||
    normalized.includes("mándale algo al creador") ||
    normalized.includes("enviar correo al creador") ||
    normalized.includes("enviar email al creador") ||
    normalized.includes("envia correo al creador") ||
    normalized.includes("envía correo al creador") ||
    normalized.includes("envia email al creador") ||
    normalized.includes("envía email al creador") ||
    normalized.includes("envia el correo al creador") ||
    normalized.includes("envía el correo al creador") ||
    normalized.includes("envia el email al creador") ||
    normalized.includes("envía el email al creador") ||
    normalized.includes("haz un correo al creador") ||
    normalized.includes("haz un email al creador") ||
    normalized.includes("hacer un correo al creador") ||
    normalized.includes("hacer un email al creador") ||
    normalized.includes("correo de la incidencia") ||
    normalized.includes("email de la incidencia") ||
    normalized.includes("avisar al creador de la incidencia") ||
    normalized.includes("prepara un email al creador") ||
    normalized.includes("prepara email al creador") ||
    normalized.includes("prepara un correo al creador") ||
    normalized.includes("prepara correo al creador") ||
    normalized.includes("preparar un email al creador") ||
    normalized.includes("preparar email al creador") ||
    normalized.includes("preparar un correo al creador") ||
    normalized.includes("preparar correo al creador") ||
    normalized.includes("prepare_creator_email") ||
    ((normalized.includes("email") || normalized.includes("correo")) &&
      (normalized.includes("prepara") || normalized.includes("preparar")) &&
      (normalized.includes("creador") || normalized.includes("creadora") || normalized.includes("creator")))
  );
}

function isCreatorDirectSendRequest(transcript) {
  const normalized = String(transcript || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    normalized.includes("direct_send_creator_email") ||
    normalized.includes("send_creator_email") ||
    normalized.includes("communication_direct_send_request") ||
    normalized.includes("communication_direct_sent") ||
    normalized.includes("envia directamente un correo al creador") ||
    normalized.includes("envia directamente un email al creador") ||
    normalized.includes("envia directamente el correo al creador") ||
    normalized.includes("envia directamente el email al creador") ||
    normalized.includes("envía directamente un correo al creador") ||
    normalized.includes("envía directamente un email al creador") ||
    normalized.includes("envía directamente el correo al creador") ||
    normalized.includes("envía directamente el email al creador") ||
    normalized.includes("manda directamente un correo al creador") ||
    normalized.includes("manda directamente un email al creador") ||
    normalized.includes("manda directamente el correo al creador") ||
    normalized.includes("manda directamente el email al creador") ||
    normalized.includes("envialo ya sin revisar") ||
    normalized.includes("envíalo ya sin revisar") ||
    normalized.includes("mandalo ya sin revisar") ||
    normalized.includes("mándalo ya sin revisar") ||
    normalized.includes("manda el correo directamente") ||
    normalized.includes("manda el email directamente") ||
    normalized.includes("envia el correo directamente") ||
    normalized.includes("envía el correo directamente") ||
    normalized.includes("envia el email directamente") ||
    normalized.includes("envía el email directamente") ||
    normalized.includes("envia directamente") ||
    normalized.includes("envía directamente") ||
    normalized.includes("manda directamente") ||
    normalized.includes("mandalo ya sin revisar") ||
    normalized.includes("mándalo ya sin revisar") ||
    normalized.includes("envialo ya sin revisar") ||
    normalized.includes("envíalo ya sin revisar") ||
    ((normalized.includes("directamente") || normalized.includes("sin revisar")) &&
      (normalized.includes("email") || normalized.includes("correo") || normalized.includes("mand") || normalized.includes("envi")))
  );
}

function incidentFromVoiceOpsOutput(output) {
  const visual = output?.visualResult || null;
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

function safeEmailDomain(email) {
  const parts = String(email || "").trim().toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function draftViewerUrl(draftId, fallbackUrl = "") {
  const normalizedDraftId = String(draftId || "").trim();
  if (fallbackUrl) {
    return String(fallbackUrl);
  }
  return normalizedDraftId ? `/communications/drafts/${encodeURIComponent(normalizedDraftId)}` : "";
}

function isIncidentCreatorDraftArgs(args = {}) {
  const joined = [
    args.question,
    args.text,
    args.q,
    args.prompt,
    args.intent,
    args.kind,
    args.message,
    args.subject,
    args.action,
    args.voice_intent,
    args.communication_action,
    args.template_id,
    args.source_type,
    args.source_incident_id,
    args.incident_id,
    args.incident_title,
    args.recipient_name,
    args.recipient_label,
    args.recipient_email,
    args.recipient_query,
    args.custom_context?.action,
    args.custom_context?.summary,
    args.custom_context?.message,
    args.custom_context?.creator_name,
    args.custom_context?.creator_email,
    args.custom_context?.incident_id,
    args.custom_context?.incident_title
  ]
    .map((value) => String(value || ""))
    .join(" ");
  const normalized = joined
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    isCreatorEmailRequest(joined) ||
    normalized.includes("prepare_creator_email") ||
    normalized.includes("email_to_incident_creator") ||
    normalized.includes("direct_send_creator_email") ||
    ((normalized.includes("creador") || normalized.includes("creadora") || normalized.includes("creator")) &&
      (normalized.includes("email") ||
        normalized.includes("correo") ||
        normalized.includes("incidencia") ||
        normalized.includes("incident") ||
        String(args.recipient_email || args.custom_context?.creator_email || "").includes("@"))) ||
    (String(args.template_id || "").trim() === "seguimiento_incidencia" &&
      (String(args.source_type || "").trim() === "incident" ||
        String(args.source_incident_id || args.incident_id || args.custom_context?.incident_id || "").trim() ||
        normalized.includes("creador") ||
        normalized.includes("creator") ||
        normalized.includes("seguimiento") ||
        normalized.includes("incidencia") ||
        String(args.recipient_email || args.custom_context?.creator_email || "").includes("@"))) ||
    (String(args.source_type || "").trim() === "incident" &&
      (String(args.source_incident_id || args.incident_id || args.custom_context?.incident_id || "").trim() ||
        normalized.includes("creador") ||
        normalized.includes("creator")))
  );
}

function eventTimestamp() {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function formatRealtimeError(error) {
  if (!error) {
    return "Realtime devolvió un error sin detalle.";
  }

  const parts = [
    error.type ? `type=${error.type}` : "",
    error.code ? `code=${error.code}` : "",
    error.param ? `param=${error.param}` : "",
    error.message || ""
  ].filter(Boolean);

  return parts.join(" · ") || "Realtime devolvió un error.";
}

function navigationForTool(toolName) {
  if (
    toolName === "voice_prepare_executive_report" ||
    toolName === "voice_prepare_technical_report" ||
    toolName === "voice_prepare_operational_report" ||
    toolName === "voice_powerbi_query" ||
    toolName === "voice_directory_search" ||
    toolName === "voice_prepare_communication_draft" ||
    toolName === "voice_prepare_email_send" ||
    toolName === "voice_manage_communication_drafts" ||
    toolName === "voice_report_direction" ||
    toolName === "voice_report_systems" ||
    toolName === "voice_export_help"
  ) {
    if (toolName === "voice_directory_search") {
      return { view: "directory" };
    }
    if (toolName === "voice_powerbi_query") {
      return { view: "powerbi", focus: "ask" };
    }
    return {
      view:
        toolName === "voice_prepare_communication_draft" ||
        toolName === "voice_prepare_email_send" ||
        toolName === "voice_manage_communication_drafts"
          ? "communications"
          : "today",
      focus: toolName === "voice_prepare_email_send" ? "send_confirmation" : "exports"
    };
  }
  if (toolName === "voice_prepare_matrix_export") {
    return { view: "matrix", focus: "exports" };
  }
  if (toolName === "voice_today_report") {
    return { view: "today" };
  }
  if (toolName === "voice_morning_briefing") {
    return { view: "dashboard", focus: "briefing" };
  }
  if (toolName === "voice_analytics_summary" || toolName === "voice_analytics_reports") {
    return { view: "analysis" };
  }
  if (
    toolName === "voice_latest_matrix" ||
    toolName === "voice_show_incident_chart" ||
    toolName === "voice_show_risk_chart"
  ) {
    return {
      view: "matrix",
      focus:
        toolName === "voice_show_incident_chart"
          ? "incidents_chart"
          : toolName === "voice_show_risk_chart"
            ? "risks_chart"
            : "matrix"
    };
  }
  if (toolName === "voice_run_daily_report" || toolName === "refresh_dashboard") {
    return { view: "dashboard" };
  }
  return null;
}

export default function VoiceAgentPanel({ presentationMode = false, currentIncidentContext = null }) {
  const [voiceStatus, setVoiceStatus] = useState("disconnected");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastTool, setLastTool] = useState("");
  const [lastToolSummary, setLastToolSummary] = useState("");
  const [lastEventAt, setLastEventAt] = useState("");
  const [realtimeState, setRealtimeState] = useState("desconectado");
  const [voiceEvents, setVoiceEvents] = useState([]);
  const [isManualToolRunning, setIsManualToolRunning] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [activeVoice, setActiveVoice] = useState("");
  const [voiceOptions, setVoiceOptions] = useState(fallbackVoiceOptions);
  const [defaultVoice, setDefaultVoice] = useState("marin");
  const [selectedVoice, setSelectedVoice] = useState("");
  const [activeStyle, setActiveStyle] = useState("operativo");
  const [avatarTheme, setAvatarTheme] = useState("default");
  const [avatarName, setAvatarName] = useState("");
  const [voiceConfigState, setVoiceConfigState] = useState("Cargando configuración de voz...");
  const executedCallsRef = useRef(new Set());
  const pendingInitialPromptRef = useRef("");
  const peerRef = useRef(null);
  const streamRef = useRef(null);
  const channelRef = useRef(null);
  const audioRef = useRef(null);
  const pendingVoiceDraftDecisionRef = useRef(null);
  const pendingVoiceSendConfirmationRef = useRef(null);

  function navigateToDraftReviewFromVoice(output) {
    const draftId = String(output?.draft_id || output?.draft?.id || "").trim();
    if (!draftId || typeof window === "undefined") {
      return false;
    }
    const viewUrl = draftViewerUrl(draftId, output?.view_url);
    if (!viewUrl) {
      return false;
    }
    console.debug("[voice communications] navigation requested", {
      action: output?.action || "communication_draft_created",
      draft_id: draftId,
      view_url: viewUrl,
      navigation_requested: true
    });
    const outputAction = output?.action || "communication_draft_created";
    if (outputAction === "communication_draft_created") {
      setPendingVoiceDraftDecisionFromOutput(output);
    } else if (outputAction === "communication_send_confirmation_requested") {
      setPendingVoiceSendConfirmationFromDraft(output?.draft || {
        id: draftId,
        recipient_name: output?.recipient_name,
        recipient_label: output?.recipient_name,
        recipient_email: output?.recipient_email,
        subject: output?.subject
      });
    } else if (outputAction === "communication_direct_sent") {
      clearPendingVoiceCommunicationDecision();
    }
    window.dispatchEvent(
      new CustomEvent("infra-agent:communication-draft-created", {
        detail: {
          ...output,
          draft_id: draftId,
          view_url: viewUrl,
          navigation_requested: true
        }
      })
    );
    return true;
  }

  function voiceDraftRecipientName(draftOrOutput = {}) {
    return String(
      draftOrOutput.recipient_name ||
        draftOrOutput.recipient_label ||
        draftOrOutput.draft?.recipient_name ||
        draftOrOutput.draft?.recipient_label ||
        "el destinatario"
    ).trim();
  }

  function voiceDraftRecipientEmail(draftOrOutput = {}) {
    return String(
      draftOrOutput.recipient_email || draftOrOutput.draft?.recipient_email || ""
    ).trim();
  }

  function pendingDraftFromOutput(output = {}) {
    const draftId = String(output.draft_id || output.draft?.id || "").trim();
    if (!draftId) {
      return null;
    }
    return {
      draft_id: draftId,
      recipient_name: voiceDraftRecipientName(output),
      recipient_email: voiceDraftRecipientEmail(output),
      subject: String(output.subject || output.draft?.subject || "").trim(),
      source: "voice",
      created_at: new Date().toISOString()
    };
  }

  function setPendingVoiceDraftDecisionFromOutput(output) {
    const pending = pendingDraftFromOutput(output);
    pendingVoiceDraftDecisionRef.current = pending;
    pendingVoiceSendConfirmationRef.current = null;
    return pending;
  }

  function setPendingVoiceSendConfirmationFromDraft(draft) {
    const pending = pendingDraftFromOutput({ draft_id: draft?.id, draft });
    pendingVoiceSendConfirmationRef.current = pending;
    pendingVoiceDraftDecisionRef.current = null;
    return pending;
  }

  function clearPendingVoiceCommunicationDecision() {
    pendingVoiceDraftDecisionRef.current = null;
    pendingVoiceSendConfirmationRef.current = null;
  }

  function pendingVoiceDecisionIsExpired(pending) {
    const createdAt = pending?.created_at ? Date.parse(pending.created_at) : NaN;
    return !Number.isFinite(createdAt) || Date.now() - createdAt > 5 * 60 * 1000;
  }

  async function loadCommunicationSendAllowedDomains() {
    try {
      const response = await fetch("/api/communications/send-config");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return [];
      }
      return Array.isArray(data.allowed_domains) ? data.allowed_domains : [];
    } catch {
      return [];
    }
  }

  function voiceDraftSendBlockers(draft, allowedDomains = []) {
    const recipientEmail = String(draft?.recipient_email || "").trim().toLowerCase();
    const domain = recipientEmail.includes("@") ? recipientEmail.split("@").pop() : "";
    const normalizedAllowed = (Array.isArray(allowedDomains) ? allowedDomains : [])
      .map((item) => String(item || "").trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean);
    const body = String(draft?.body_text || draft?.body_markdown || "").trim();
    const blockers = [];

    if (draft?.send_status === "sent" || draft?.sent_at) blockers.push("ya enviado");
    if (!recipientEmail) blockers.push("falta email destinatario");
    if (recipientEmail && normalizedAllowed.length && !normalizedAllowed.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) {
      blockers.push("dominio no permitido");
    }
    if (!String(draft?.subject || "").trim()) blockers.push("falta asunto");
    if (!body) blockers.push("falta cuerpo");

    return blockers;
  }

  async function prepareVoiceSendConfirmationForDraft(draftId) {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      throw new Error("No hay un borrador pendiente de envío.");
    }
    const draft = await verifyDraftVisibleById(normalizedDraftId);
    const allowedDomains = await loadCommunicationSendAllowedDomains();
    const blockers = voiceDraftSendBlockers(draft, allowedDomains);
    if (blockers.length) {
      clearPendingVoiceCommunicationDecision();
      return {
        ok: false,
        handled: true,
        action: "communication_send_blocked",
        draft_id: normalizedDraftId,
        draft,
        spokenResponse: `No puedo enviarlo porque ${blockers[0]}.`,
        error: blockers[0],
        source: "Comunicaciones"
      };
    }

    const pending = setPendingVoiceSendConfirmationFromDraft(draft);
    return {
      ok: true,
      handled: true,
      action: "communication_send_confirmation_requested",
      draft_id: normalizedDraftId,
      draft,
      view_url: draftViewerUrl(normalizedDraftId),
      recipient_name: pending.recipient_name,
      recipient_email: pending.recipient_email,
      subject: pending.subject,
      spokenResponse: `Vas a enviar un correo real a ${pending.recipient_email}. ¿Confirmas el envío?`,
      source: "Comunicaciones"
    };
  }

  async function sendPendingVoiceDraftDirectly(transcript = "") {
    const pending = pendingVoiceSendConfirmationRef.current;
    if (!pending || pendingVoiceDecisionIsExpired(pending)) {
      clearPendingVoiceCommunicationDecision();
      return {
        ok: false,
        handled: true,
        action: "communication_send_confirmation_missing",
        spokenResponse: "No tengo un borrador pendiente de confirmación de envío. Primero prepara o abre un borrador.",
        error: "No hay confirmación pendiente.",
        source: "Comunicaciones"
      };
    }
    if (!/confirm/i.test(
      String(transcript || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
    )) {
      return {
        ok: false,
        handled: true,
        action: "communication_send_confirmation_required",
        draft_id: pending.draft_id,
        spokenResponse: "Para enviar necesito una confirmación explícita. Di confirmo el envío si quieres enviarlo.",
        error: "Confirmación explícita requerida.",
        source: "Comunicaciones"
      };
    }

    const response = await fetch(`/api/communications/drafts/${encodeURIComponent(pending.draft_id)}/direct-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm_direct_send: true,
        source: "voice",
        sent_by: "infra-agent-web"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        handled: true,
        action: "communication_direct_send_failed",
        draft_id: pending.draft_id,
        spokenResponse: data.error || "No he podido enviar el correo de forma verificable.",
        error: data.error || "No se pudo enviar directamente.",
        source: "Comunicaciones"
      };
    }

    clearPendingVoiceCommunicationDecision();
    const sentDraft = await verifyDraftVisibleById(data.draft_id || pending.draft_id);
    return {
      ...data,
      ok: true,
      handled: true,
      action: "communication_direct_sent",
      draft_id: String(data.draft_id || pending.draft_id),
      draft: sentDraft,
      view_url: data.view_url || draftViewerUrl(data.draft_id || pending.draft_id),
      recipient_name: sentDraft.recipient_name || sentDraft.recipient_label || data.recipient_name || pending.recipient_name,
      recipient_email: sentDraft.recipient_email || data.recipient_email || pending.recipient_email,
      spokenResponse: `Correo enviado a ${sentDraft.recipient_email || data.recipient_email || pending.recipient_email}. El borrador #${data.draft_id || pending.draft_id} queda marcado como enviado y no se puede reenviar.`,
      source: "Comunicaciones"
    };
  }

  async function handleVoiceCommunicationDraftDecision(args = {}, source = "voice_tool") {
    const rawTranscript = String(args.transcript || args.question || args.text || args.message || "").trim();
    const normalizedTranscript = rawTranscript
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const explicitAction = String(args.action || args.decision || "").trim();
    const inferredAction =
      explicitAction ||
      (/confirm/.test(normalizedTranscript)
        ? "confirm_direct_send"
        : /cancel|mejor no|no lo envies|no lo env(i|í)es|dejalo|déjalo/.test(normalizedTranscript)
          ? "cancel"
          : /revis|edit|abrir|no enviar|no lo mandes/.test(normalizedTranscript)
            ? "review"
            : /directamente|envialo|envíalo|mandalo|mándalo|enviar ahora/.test(normalizedTranscript)
              ? "request_direct_send"
              : "");

    if (inferredAction === "review") {
      const pending = pendingVoiceDraftDecisionRef.current || pendingVoiceSendConfirmationRef.current;
      clearPendingVoiceCommunicationDecision();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:communication-draft-decision", {
            detail: {
              action: "review_selected",
              draft_id: pending?.draft_id || "",
              source,
              message: "Perfecto. Lo dejo abierto para revisión. No se ha enviado nada."
            }
          })
        );
      }
      return {
        ok: true,
        handled: true,
        action: "communication_review_selected",
        draft_id: pending?.draft_id || "",
        spokenResponse: "Perfecto. Lo dejo abierto para revisión. No se ha enviado nada.",
        source: "Comunicaciones"
      };
    }

    if (inferredAction === "cancel") {
      const pending = pendingVoiceDraftDecisionRef.current || pendingVoiceSendConfirmationRef.current;
      clearPendingVoiceCommunicationDecision();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:communication-draft-decision", {
            detail: {
              action: "cancelled",
              draft_id: pending?.draft_id || "",
              source,
              message: "De acuerdo. No se ha enviado nada. El borrador queda abierto para revisión."
            }
          })
        );
      }
      return {
        ok: true,
        handled: true,
        action: "communication_send_cancelled",
        draft_id: pending?.draft_id || "",
        spokenResponse: "De acuerdo. No se ha enviado nada. El borrador queda abierto para revisión.",
        source: "Comunicaciones"
      };
    }

    if (inferredAction === "request_direct_send") {
      const pending = pendingVoiceDraftDecisionRef.current;
      if (!pending || pendingVoiceDecisionIsExpired(pending)) {
        clearPendingVoiceCommunicationDecision();
        return {
          ok: false,
          handled: true,
          action: "communication_draft_decision_missing",
          spokenResponse: "No tengo un borrador reciente pendiente de envío. Primero prepara o abre un borrador.",
          error: "No hay borrador pendiente.",
          source: "Comunicaciones"
        };
      }
      const output = await prepareVoiceSendConfirmationForDraft(pending.draft_id);
      if (typeof window !== "undefined" && output?.draft_id) {
        if (output.ok) {
          navigateToDraftReviewFromVoice(output);
        } else {
          window.dispatchEvent(
            new CustomEvent("infra-agent:communication-draft-decision", {
              detail: {
                action: "cancelled",
                draft_id: output.draft_id,
                source,
                message: output.spokenResponse || output.error || "No se puede enviar el borrador."
              }
            })
          );
        }
      }
      return output;
    }

    if (inferredAction === "confirm_direct_send") {
      const output = await sendPendingVoiceDraftDirectly(rawTranscript);
      if (typeof window !== "undefined" && output?.draft_id) {
        navigateToDraftReviewFromVoice(output);
      }
      return output;
    }

    return {
      ok: false,
      handled: true,
      action: "communication_draft_decision_ambiguous",
      spokenResponse: "No lo envío porque la respuesta no es clara. Di revisarlo antes o enviarlo directamente.",
      error: "Decisión ambigua.",
      source: "Comunicaciones"
    };
  }

  async function verifyDraftVisibleById(draftId) {
    const normalizedDraftId = String(draftId || "").trim();
    if (!normalizedDraftId) {
      throw new Error("No se recibió draft_id del borrador creado.");
    }
    const response = await fetch(`/api/communications/drafts/${encodeURIComponent(normalizedDraftId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false || !data.draft?.id) {
      throw new Error(data.error || "El borrador se creó pero no se pudo verificar por ID.");
    }
    return data.draft;
  }

  function incidentFromVoiceContextOrArgs(args = {}) {
    const contextIncident = currentIncidentContext?.incidentId
      ? {
          id: currentIncidentContext.incidentId,
          incidentId: currentIncidentContext.incidentId,
          title: currentIncidentContext.title,
          creator_name: currentIncidentContext.creator_name,
          creator_email: currentIncidentContext.creator_email,
          created_by_name: currentIncidentContext.creator_name,
          created_by_email: currentIncidentContext.creator_email,
          requester: currentIncidentContext.requester,
          ordering: currentIncidentContext.ordering
        }
      : null;
    return {
      ...(contextIncident || {}),
      id: String(args.source_incident_id || args.incident_id || contextIncident?.id || "").trim(),
      incidentId: String(args.source_incident_id || args.incident_id || contextIncident?.incidentId || "").trim(),
      title: String(
        args.incident_title ||
          args.custom_context?.incident_title ||
          contextIncident?.title ||
          args.subject ||
          ""
      ).trim(),
      creator_name: String(
        args.recipient_name ||
          args.recipient_label ||
          args.custom_context?.creator_name ||
          contextIncident?.creator_name ||
          contextIncident?.created_by_name ||
          ""
      ).trim(),
      creator_email: String(
        args.recipient_email ||
          args.custom_context?.creator_email ||
          contextIncident?.creator_email ||
          contextIncident?.created_by_email ||
          ""
      ).trim(),
      created_by_name: String(
        args.recipient_name ||
          args.recipient_label ||
          args.custom_context?.creator_name ||
          contextIncident?.created_by_name ||
          ""
      ).trim(),
      created_by_email: String(
        args.recipient_email ||
          args.custom_context?.creator_email ||
          contextIncident?.created_by_email ||
          ""
      ).trim()
    };
  }

  async function createCreatorEmailDraftFromVoice({
    toolName,
    transcript = "",
    incident,
    source = "voice_tool"
  }) {
    const normalizedIncident = incident || null;
    const incidentId = String(
      normalizedIncident?.id || normalizedIncident?.incidentId || normalizedIncident?.source_incident_id || ""
    ).trim();
    const recipientEmail = String(
      normalizedIncident?.creator_email ||
        normalizedIncident?.created_by_email ||
        normalizedIncident?.recipient_email ||
        ""
    ).trim();
    const recipientName = String(
      normalizedIncident?.creator_name ||
        normalizedIncident?.created_by_name ||
        normalizedIncident?.recipient_label ||
        normalizedIncident?.requester ||
        "Creador de la incidencia"
    ).trim();
    const recipientDomain = safeEmailDomain(recipientEmail);

    console.debug("[voice communications] creator draft route", {
      voice_tool_name: toolName,
      transcript_intent: "prepare_creator_email",
      incident_id: incidentId || null,
      has_current_incident_context: Boolean(currentIncidentContext?.incidentId),
      has_creator_email: Boolean(recipientEmail),
      recipient_domain: recipientDomain,
      endpoint_called: "/api/communications/voice-draft",
      draft_insert_attempted: Boolean(incidentId && recipientEmail)
    });

    if (!incidentId) {
      throw new Error("No hay una incidencia en contexto para preparar el email al creador.");
    }
    const createResponse = await fetch("/api/communications/voice-draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transcript,
        requestedAction: "prepare_creator_email",
        directSendRequested: false,
        source: "voice",
        currentIncidentContext: {
          incidentId,
          title: String(normalizedIncident?.title || "").trim(),
          creator_name: recipientName,
          creator_email: recipientEmail,
          created_by_name: recipientName,
          created_by_email: recipientEmail
        }
      })
    });
    const createData = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || createData.ok === false) {
      console.debug("[voice communications] creator draft failed", {
        voice_tool_name: toolName,
        transcript_intent: "prepare_creator_email",
        incident_id: incidentId,
        has_current_incident_context: Boolean(currentIncidentContext?.incidentId),
        has_creator_email: Boolean(recipientEmail),
        recipient_domain: recipientDomain,
        endpoint_called: "/api/communications/voice-draft",
        draft_insert_attempted: true,
        draft_created: false,
        error: createData.error || `HTTP ${createResponse.status}`,
        navigation_requested: false
      });
      throw new Error(createData.error || "No se pudo crear el borrador para el creador.");
    }

    const draftId = String(createData.draft_id || createData.draft?.id || "").trim();
    const verifiedDraft = await verifyDraftVisibleById(draftId);
    const viewUrl = draftViewerUrl(draftId, createData.view_url);
    const spokenResponse = `Borrador #${draftId} creado para ${verifiedDraft.recipient_name || verifiedDraft.recipient_label || recipientName}. No se ha enviado todavía. ¿Quieres enviarlo directamente o prefieres revisarlo antes?`;
    const output = {
      ok: true,
      handled: true,
      unsupported: false,
      action: "communication_draft_created",
      spokenResponse,
      draft_id: draftId,
      draft: verifiedDraft,
      view_url: viewUrl,
      recipient_email: verifiedDraft.recipient_email || createData.recipient_email || recipientEmail,
      subject: verifiedDraft.subject || createData.subject || "Seguimiento de incidencia",
      status: verifiedDraft.status || createData.status || "draft",
      source_incident_id: String(verifiedDraft.source_incident_id || createData.source_incident_id || incidentId),
      total_before: createData.total_before,
      total_after: createData.total_after,
      visualResult: {
        kind: "incidents_user",
        title: "Borrador para el creador",
        sourceLabel: "IncidenciasTI / SharePoint",
        live: true,
        ordering: currentIncidentContext?.ordering || normalizedIncident?.ordering || "created desc / id desc",
        summary: spokenResponse,
        item: normalizedIncident || null,
        items: normalizedIncident ? [normalizedIncident] : [],
        question: transcript,
        action: "prepare_creator_email",
        draft_id: draftId,
        view_url: viewUrl,
        draft_status: verifiedDraft.status || createData.status || "draft"
      },
      source: "IncidenciasTI / SharePoint"
    };

    console.debug("[voice communications] creator draft completed", {
      voice_tool_name: toolName,
      transcript_intent: "prepare_creator_email",
      incident_id: incidentId,
      has_current_incident_context: Boolean(currentIncidentContext?.incidentId),
      has_creator_email: Boolean(output.recipient_email),
      recipient_domain: safeEmailDomain(output.recipient_email),
      endpoint_called: "/api/communications/voice-draft",
      draft_insert_attempted: true,
      draft_created: true,
      draft_id: draftId,
      view_url: viewUrl,
      navigation_requested: true
    });

    return output;
  }

  async function createGenericCommunicationDraftFromVoice({
    toolName,
    transcript = "",
    args = {},
    source = "voice_tool",
    directSendRequested = false,
    deferDirectSendConfirmation = false
  }) {
    const requestedAction = String(
      args.requestedAction ||
        args.action ||
        args.voice_intent ||
        args.communication_action ||
        args.intent ||
        args.kind ||
        args.template_id ||
        "voice_prepare_communication_draft"
    ).trim();
    const voiceResolvedRecipient = {
      recipient_name:
        args.recipient_name ||
        args.recipient_label ||
        args.recipient_query ||
        args.toName ||
        args.to ||
        args.contact?.displayName ||
        args.contact?.display_name ||
        args.contact?.name ||
        args.matchedContact?.displayName ||
        args.matchedContact?.display_name ||
        args.matchedContact?.name ||
        "",
      recipient_email:
        args.recipient_email ||
        args.recipientEmail ||
        args.toEmail ||
        args.email ||
        args.contact?.mail ||
        args.contact?.email ||
        args.contact?.userPrincipalName ||
        args.contact?.user_principal_name ||
        args.matchedContact?.mail ||
        args.matchedContact?.email ||
        args.matchedContact?.userPrincipalName ||
        args.matchedContact?.user_principal_name ||
        "",
      recipient_source: args.recipient_source || args.contact?.source || args.matchedContact?.source || "",
      recipient_confidence: args.recipient_confidence ?? args.contact?.confidence ?? args.matchedContact?.confidence ?? ""
    };

    console.debug("[voice communications] voice draft route", {
      voice_tool_name: toolName,
      transcript_intent: requestedAction || "voice_prepare_communication_draft",
      endpoint_called: "/api/communications/voice-draft",
      has_current_incident_context: Boolean(currentIncidentContext?.incidentId),
      has_resolved_recipient: Boolean(voiceResolvedRecipient.recipient_name || voiceResolvedRecipient.recipient_email),
      has_recipient_email: Boolean(voiceResolvedRecipient.recipient_email),
      draft_insert_attempted: true
    });

    const response = await fetch("/api/communications/voice-draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transcript,
        requestedAction,
        requestedRecipientName:
          args.recipient_name ||
          args.recipient_label ||
          args.recipient_query ||
          args.toName ||
          args.to ||
          "",
        recipient_name: voiceResolvedRecipient.recipient_name,
        recipient_email: voiceResolvedRecipient.recipient_email,
        recipient_source: voiceResolvedRecipient.recipient_source,
        recipient_confidence: voiceResolvedRecipient.recipient_confidence,
        resolvedRecipient: voiceResolvedRecipient,
        directSendRequested,
        deferDirectSendConfirmation,
        requireVoiceSendConfirmation: deferDirectSendConfirmation,
        source: "voice",
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
      throw new Error(data.error || "No se pudo crear el borrador de voz.");
    }

    const draftId = String(data.draft_id || data.draft?.id || "").trim();
    const verifiedDraft = await verifyDraftVisibleById(draftId);
    const viewUrl = draftViewerUrl(draftId, data.view_url);
    const isDirectSent = data.action === "communication_direct_sent" || data.send_status === "sent";
    const hasRecipientEmail = Boolean(verifiedDraft.recipient_email || data.recipient_email);
    const spokenResponse = isDirectSent
      ? `Borrador #${draftId} enviado directamente a ${
          verifiedDraft.recipient_email || data.recipient_email || "el destinatario"
        }. No se puede reenviar este mismo borrador.`
      : hasRecipientEmail
        ? `Borrador #${draftId} creado para ${verifiedDraft.recipient_name || verifiedDraft.recipient_label || "el destinatario"}. No se ha enviado todavía. ¿Quieres enviarlo directamente o prefieres revisarlo antes?`
        : `Borrador #${draftId} creado. Falta indicar el email destinatario antes de enviarlo. No se ha enviado nada.`;

    console.debug("[voice communications] voice draft completed", {
      voice_tool_name: toolName,
      transcript_intent: requestedAction || "voice_prepare_communication_draft",
      endpoint_called: "/api/communications/voice-draft",
      draft_created: true,
      draft_id: draftId,
      view_url: viewUrl,
      navigation_requested: true
    });

    return {
      ok: true,
      handled: true,
      unsupported: false,
      action: data.action || (isDirectSent ? "communication_direct_sent" : "communication_draft_created"),
      spokenResponse,
      draft_id: draftId,
      draft: verifiedDraft,
      view_url: viewUrl,
      recipient_name: verifiedDraft.recipient_name || verifiedDraft.recipient_label || data.recipient_name || "",
      recipient_email: verifiedDraft.recipient_email || data.recipient_email || "",
      recipient_source: data.recipient_source || data.recipient_resolution_source || "",
      recipient_confidence: data.recipient_confidence ?? data.recipient_resolution_confidence ?? "",
      subject: verifiedDraft.subject || data.subject || "",
      status: verifiedDraft.status || data.status || "draft",
      source_incident_id: String(verifiedDraft.source_incident_id || data.source_incident_id || ""),
      total_before: data.total_before,
      total_after: data.total_after,
      visualResult: {
        kind: "communications",
        title: "Borrador de comunicación",
        sourceLabel: "Comunicaciones",
        live: true,
        summary: spokenResponse,
        action: data.action || (isDirectSent ? "communication_direct_sent" : "communication_draft_created"),
        draft_id: draftId,
        view_url: viewUrl,
        draft_status: verifiedDraft.status || data.status || "draft"
      },
      source: "Comunicaciones"
    };
  }

  function cleanup() {
    try {
      channelRef.current?.close();
    } catch {
      // no-op
    }
    try {
      peerRef.current?.close();
    } catch {
      // no-op
    }
    for (const track of streamRef.current?.getTracks?.() || []) {
      track.stop();
    }
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    executedCallsRef.current.clear();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadVoiceConfig() {
      try {
        const response = await fetch("/api/realtime/session");
        const data = await response.json().catch(() => ({}));
        const configuredVoices =
          Array.isArray(data.voices) && data.voices.length ? data.voices : fallbackVoiceOptions;
        const nextDefaultVoice = data.default_voice || configuredVoices[0] || "marin";

        let savedVoice = "";
        let savedStyle = "operativo";
        let savedTheme = "default";
        let savedName = "";
        try {
          savedVoice = window.localStorage.getItem("infra-agent-realtime-voice") || "";
          savedStyle = window.localStorage.getItem("infra-agent-response-style") || "operativo";
          savedTheme = window.localStorage.getItem("infra-agent-avatar-theme") || "default";
          savedName = window.localStorage.getItem("infra-agent-avatar-name") || "";
        } catch {
          // localStorage is optional; voice configuration still works for this session.
        }

        if (!cancelled) {
          setVoiceOptions(configuredVoices);
          setDefaultVoice(nextDefaultVoice);
          setSelectedVoice(normalizeOption(savedVoice, nextDefaultVoice, configuredVoices));
          setActiveStyle(
            normalizeOption(
              savedStyle,
              data.default_response_style || "operativo",
              responseStyles.map(([value]) => value)
            )
          );
          setAvatarTheme(
            normalizeOption(
              savedTheme,
              data.default_avatar_theme || "default",
              avatarThemes.map(([value]) => value)
            )
          );
          setAvatarName(savedName.slice(0, 40));
          setVoiceConfigState(response.ok ? "Configuración de voz cargada." : "Usando voces locales.");
        }
      } catch {
        if (!cancelled) {
          setVoiceOptions(fallbackVoiceOptions);
          setDefaultVoice("marin");
          setSelectedVoice((current) => current || "marin");
          setVoiceConfigState("No se pudo cargar configuración; usando voces locales.");
        }
      }
    }

    loadVoiceConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  function addVoiceEvent(event) {
    const timestamp = eventTimestamp();
    setLastEventAt(timestamp);
    setVoiceEvents((current) =>
      [
        {
          timestamp,
          type: event.type || "evento",
          tool: event.tool || "",
          status: event.status || voiceStatus,
          summary: event.summary || ""
        },
        ...current
      ].slice(0, 20)
    );
  }

  function sendRealtimeEvent(event) {
    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(JSON.stringify(event));
      return true;
    }
    return false;
  }

  function selectedVoiceForSession() {
    return selectedVoice || defaultVoice || voiceOptions[0] || "marin";
  }

  function persistVoiceSetting(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage is optional; the selected value still applies to the next session in memory.
    }
  }

  function changeSelectedVoice(value) {
    const voice = normalizeOption(value, defaultVoice || "marin", voiceOptions);
    setSelectedVoice(voice);
    persistVoiceSetting("infra-agent-realtime-voice", voice);
  }

  function changeActiveStyle(value) {
    const style = normalizeOption(
      value,
      "operativo",
      responseStyles.map(([item]) => item)
    );
    setActiveStyle(style);
    persistVoiceSetting("infra-agent-response-style", style);
  }

  function changeAvatarTheme(value) {
    const theme = normalizeOption(
      value,
      "default",
      avatarThemes.map(([item]) => item)
    );
    setAvatarTheme(theme);
    persistVoiceSetting("infra-agent-avatar-theme", theme);
  }

  function changeAvatarName(value) {
    const name = String(value || "").slice(0, 40);
    setAvatarName(name);
    persistVoiceSetting("infra-agent-avatar-name", name);
  }

  function responseStyleInstruction() {
    if (activeStyle === "ejecutivo") {
      return "Usa estilo ejecutivo: impacto, decisiones y prioridades, sin detalle técnico innecesario.";
    }
    if (activeStyle === "breve") {
      return "Usa estilo breve: una o dos frases, solo lo esencial.";
    }
    if (activeStyle === "tecnico") {
      return "Usa estilo técnico: evidencia, sistemas afectados y diagnóstico resumido.";
    }
    return "Usa estilo operativo: directo, accionable y claro.";
  }

  function sendSpokenInstruction(text, eventType = "prueba_voz") {
    const sent = sendRealtimeEvent({
      type: "response.create",
      response: {
        instructions: `${responseStyleInstruction()} No llames herramientas internas. No consultes Zabbix ni SharePoint. Di exactamente este mensaje en español: ${text}`
      }
    });

    if (sent) {
      setVoiceStatus("speaking");
      setLastResponse(text);
      addVoiceEvent({
        type: eventType,
        status: "hablando",
        summary: "Respuesta de prueba enviada al modelo."
      });
    }
    return sent;
  }

  function speakBriefing(briefing) {
    const text = String(briefing?.text || briefing?.summary || "").trim();
    if (!text) {
      return false;
    }

    setLastTool("morning_briefing");
    setLastToolSummary("Briefing preparado para voz.");
    setLastResponse(text);

    const sent = sendRealtimeEvent({
      type: "response.create",
      response: {
        instructions: `${responseStyleInstruction()} Lee este briefing operativo en español. No añadas acciones de escritura ni digas que has modificado sistemas. Briefing: ${text}`
      }
    });

    if (sent) {
      setVoiceStatus("briefing");
      addVoiceEvent({
        type: "briefing",
        tool: "morning_briefing",
        status: "briefing",
        summary: "Briefing enviado al modelo para respuesta hablada."
      });
      return true;
    }

    addVoiceEvent({
      type: "briefing",
      tool: "morning_briefing",
      status: "sin_voz",
      summary: "Briefing mostrado en pantalla. Inicia voz para escucharlo."
    });
    return false;
  }

  useEffect(() => {
    function handleBriefing(event) {
      speakBriefing(event.detail || {});
    }

    window.addEventListener("infra-agent:briefing", handleBriefing);
    return () => window.removeEventListener("infra-agent:briefing", handleBriefing);
  }, []);

  function endpointWithArgs(tool, args = {}) {
    if (toolNameNeedsQuery(tool, args)) {
      const params = new URLSearchParams({ q: String(args.q || "").slice(0, 120) });
      if (tool?.endpoint === "/api/directory/search" && args.limit) {
        params.set("limit", String(Math.max(1, Math.min(Number(args.limit) || 10, 50))));
      }
      return `${tool.endpoint}?${params.toString()}`;
    }
    return tool.endpoint;
  }

  function toolNameNeedsQuery(tool, args) {
    return (
      (tool?.endpoint === "/api/voice/search" || tool?.endpoint === "/api/directory/search") &&
      args?.q
    );
  }

  async function runInternalTool(toolName, source = "manual", args = {}) {
    const tool = internalTools[toolName];
    setLastTool(toolName);
    setLastToolSummary("");
    addVoiceEvent({
      type: source,
      tool: toolName,
      status: tool?.status || "error",
      summary: "Inicio de herramienta."
    });

    if (!tool) {
      const errorOutput = {
        ok: false,
        error: `Herramienta no permitida: ${toolName}`
      };
      setErrorMessage(errorOutput.error);
      setVoiceStatus("error");
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: "error",
        summary: errorOutput.error
      });
      return errorOutput;
    }

    if (toolName === "voice_powerbi_query") {
      setVoiceStatus(tool.status);
      setErrorMessage("");
      const transcript = String(
        args.question || args.text || args.q || args.prompt || args.message || ""
      ).trim();
      const output = await handlePowerBiVoiceCommand(transcript);
      const summary = compactToolSummary(toolName, output);
      setLastToolSummary(summary);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:powerbi-voice-result", {
            detail: {
              ...output,
              question: transcript,
              source: "voice_tool"
            }
          })
        );
        if (output.handled) {
          window.dispatchEvent(new CustomEvent("infra-agent:navigate", { detail: { view: "powerbi" } }));
        }
      }
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: output.ok ? "ok" : "error",
        summary
      });
      return output;
    }

    if (toolName === "voice_communication_draft_decision") {
      setVoiceStatus(tool.status);
      setErrorMessage("");
      const output = await handleVoiceCommunicationDraftDecision(args, source);
      const summary = compactToolSummary(toolName, output);
      setLastToolSummary(summary);
      if (!output.ok && output.error) {
        setErrorMessage(output.error);
      }
      if (typeof window !== "undefined" && output?.draft_id) {
        const outputAction = output.action || output.visualResult?.action;
        if (
          outputAction === "communication_direct_sent" ||
          outputAction === "communication_send_confirmation_requested"
        ) {
          navigateToDraftReviewFromVoice(output);
        }
      }
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: output.ok ? "ok" : "error",
        summary
      });
      return output;
    }

    if (toolName === "voice_ops_query") {
      setVoiceStatus(tool.status);
      setErrorMessage("");
      const transcript = String(
        args.question || args.text || args.q || args.prompt || args.message || ""
      ).trim();

      if (
        pendingVoiceDraftDecisionRef.current ||
        pendingVoiceSendConfirmationRef.current
      ) {
        const decisionOutput = await handleVoiceCommunicationDraftDecision({ transcript }, source);
        const decisionSummary = compactToolSummary("voice_communication_draft_decision", decisionOutput);
        setLastToolSummary(decisionSummary);
        addVoiceEvent({
          type: source,
          tool: "voice_communication_draft_decision",
          status: decisionOutput.ok ? "ok" : "error",
          summary: decisionSummary
        });
        return decisionOutput;
      }

      if (isCreatorDirectSendRequest(transcript)) {
        const createdOutput = await createGenericCommunicationDraftFromVoice({
          toolName,
          transcript,
          args,
          source,
          directSendRequested: false,
          deferDirectSendConfirmation: true
        });
        const output = createdOutput?.draft_id
          ? await prepareVoiceSendConfirmationForDraft(createdOutput.draft_id)
          : createdOutput;
        const summary = compactToolSummary(toolName, output);
        setLastToolSummary(summary);
        if (typeof window !== "undefined") {
          const directAction = output.action || output.visualResult?.action;
          const directDraftId = output.draft_id || output.visualResult?.draft_id;
          if (
            (directAction === "communication_direct_sent" ||
              directAction === "communication_send_confirmation_requested") &&
            directDraftId
          ) {
            navigateToDraftReviewFromVoice({
              ...output,
              action: directAction,
              draft_id: directDraftId,
              view_url: output.view_url || output.visualResult?.view_url
            });
          }
          window.dispatchEvent(
            new CustomEvent("infra-agent:ops-result", {
              detail: {
                ...output,
                question: transcript,
                source: "voice_tool"
              }
            })
          );
        }
        addVoiceEvent({
          type: source,
          tool: toolName,
          status: output.ok ? "ok" : "error",
          summary
        });
        return output;
      }

      if (isCreatorEmailRequest(transcript)) {
        let incident = currentIncidentContext?.incidentId
          ? incidentFromVoiceContextOrArgs({})
          : null;

        let output;
        try {
          output = await createCreatorEmailDraftFromVoice({
            toolName,
            transcript,
            incident,
            source
          });
        } catch (error) {
          output = {
            ok: false,
            handled: true,
            action: "communication_draft_failed",
            error: error?.message || "No he podido crear el borrador de forma verificable.",
            spokenResponse: "No he podido crear el borrador de forma verificable.",
            source: "IncidenciasTI / SharePoint"
          };
          setErrorMessage(output.error);
        }
        const summary = compactToolSummary(toolName, output);
        setLastToolSummary(summary);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("infra-agent:ops-result", {
              detail: {
                ...output,
                question: transcript,
                source: "voice_tool"
              }
            })
          );
          if (output.action === "communication_draft_created" && output.draft_id) {
            navigateToDraftReviewFromVoice(output);
          }
        }
        addVoiceEvent({
          type: source,
          tool: toolName,
          status: output.ok ? "ok" : "error",
          summary
        });
        return output;
      }

      const output = await handleOpsVoiceCommand(transcript, {
        currentIncidentContext,
        source: source || "voice"
      });
      const summary = compactToolSummary(toolName, output);
      setLastToolSummary(summary);
      if (typeof window !== "undefined") {
        const directAction = output.action || output.visualResult?.action;
        const directDraftId = output.draft_id || output.visualResult?.draft_id;
        if (directAction === "communication_direct_sent" && directDraftId) {
          navigateToDraftReviewFromVoice({
            ...output,
            action: directAction,
            draft_id: directDraftId,
            view_url: output.view_url || output.visualResult?.view_url
          });
        }
        window.dispatchEvent(
          new CustomEvent("infra-agent:ops-result", {
            detail: {
              ...output,
              question: transcript,
              source: "voice_tool"
            }
          })
        );
      }
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: output.ok ? "ok" : "error",
        summary
      });
      return output;
    }

    if (tool.local) {
      setVoiceStatus(tool.status);
      setErrorMessage("");
      if (toolName === "voice_prepare_communication_draft") {
        const transcript = String(
          args.question || args.text || args.q || args.prompt || args.message || args.intent || args.subject || ""
        ).trim();
        try {
          const textForRouting = transcript || [
            args.action,
            args.voice_intent,
            args.communication_action,
            args.intent,
            args.kind,
            args.template_id,
            args.recipient_label,
            args.subject,
            args.message
          ]
            .map((value) => String(value || ""))
            .join(" ");
          const directRequested = isCreatorDirectSendRequest(textForRouting);
          let output = directRequested
            ? await createGenericCommunicationDraftFromVoice({
                toolName,
                transcript: textForRouting || "envía directamente un correo al creador",
                args,
                source,
                directSendRequested: false,
                deferDirectSendConfirmation: true
              })
            : isIncidentCreatorDraftArgs(args)
            ? await createCreatorEmailDraftFromVoice({
                toolName,
                transcript: textForRouting || transcript,
                incident: incidentFromVoiceContextOrArgs(args),
                source
              })
            : await createGenericCommunicationDraftFromVoice({
                toolName,
                transcript: textForRouting || transcript,
                args,
                source,
                directSendRequested: false,
                deferDirectSendConfirmation: false
              });
          if (directRequested && output?.draft_id) {
            output = await prepareVoiceSendConfirmationForDraft(output.draft_id);
          }
          const summary = compactToolSummary(toolName, output);
          setLastToolSummary(summary);
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("infra-agent:ops-result", {
                detail: {
                  ...output,
                  question: transcript,
                  source: "voice_tool"
                }
              })
            );
            const outputAction = output.action || output.visualResult?.action;
            const outputDraftId = output.draft_id || output.visualResult?.draft_id;
            if (
              (outputAction === "communication_draft_created" ||
                outputAction === "communication_direct_sent" ||
                outputAction === "communication_send_confirmation_requested") &&
              outputDraftId
            ) {
              navigateToDraftReviewFromVoice({
                ...output,
                action: outputAction,
                draft_id: outputDraftId,
                view_url: output.view_url || output.visualResult?.view_url
              });
            }
          }
          addVoiceEvent({
            type: source,
            tool: toolName,
            status: "ok",
            summary
          });
          return output;
        } catch (error) {
          const message = error?.message || "No he podido crear el borrador de forma verificable.";
          const output = {
            ok: false,
            handled: true,
            action: "communication_draft_failed",
            error: message,
            spokenResponse: "No he podido crear el borrador de forma verificable.",
            source: "IncidenciasTI / SharePoint"
          };
          const summary = compactToolSummary(toolName, output);
          setLastToolSummary(summary);
          setErrorMessage(message);
          addVoiceEvent({
            type: source,
            tool: toolName,
            status: "error",
            summary
          });
          return output;
        }
      }
      const output = summarizeForVoice(toolName, localExportToolPayload(toolName, args));
      const summary = compactToolSummary(toolName, output);
      setLastToolSummary(summary);
      const navigation = navigationForTool(toolName);
      if (navigation && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("infra-agent:navigate", { detail: navigation }));
      }
      if (toolName === "voice_prepare_communication_draft" && typeof window !== "undefined") {
        console.error("[voice communications] blocked_voice_draft_from_template", {
          voice_tool_name: toolName,
          endpoint_selected: "/api/communications/voice-draft",
          reason: "voice_prepare_communication_draft must be handled before generic local dispatch"
        });
      }
      if (toolName === "voice_prepare_email_send" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:communication-send-confirmation", {
            detail: {
              message: output.summary,
              source: "voice_tool"
            }
          })
        );
      }
      if (toolName === "voice_manage_communication_drafts" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:communication-review", {
            detail: {
              action: output.action,
              message: output.summary,
              source: "voice_tool"
            }
          })
        );
      }
      if (toolName === "voice_directory_search" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:directory-search", {
            detail: {
              query: args.q || "",
              users: output.users || [],
              message: output.summary || "Búsqueda en libreta corporativa completada."
            }
          })
        );
      }
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: "ok",
        summary
      });
      return output;
    }

    setVoiceStatus(tool.status);
    setErrorMessage("");

    try {
      const response = await fetch(endpointWithArgs(tool, args), {
        method: tool.method,
        headers: {
          "Content-Type": "application/json"
        }
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || `Error HTTP ${response.status}`);
      }

      const output = summarizeForVoice(toolName, payload);
      const summary = compactToolSummary(toolName, output);
      setLastToolSummary(summary);
      const navigation = navigationForTool(toolName);
      if (navigation && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("infra-agent:navigate", { detail: navigation }));
      }
      if (toolName === "voice_morning_briefing" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:voice-briefing", {
            detail: {
              text: output.summary,
              source: "voice_tool",
              items: output.items || []
            }
          })
        );
      }
      if (toolName === "voice_directory_search" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("infra-agent:directory-search", {
            detail: {
              query: args.q || "",
              users: output.users || [],
              message: output.summary || "Búsqueda en libreta corporativa completada."
            }
          })
        );
      }
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: "ok",
        summary
      });
      return output;
    } catch (error) {
      const message = error?.message || "Error ejecutando herramienta interna.";
      setErrorMessage(message);
      setVoiceStatus("error");
      addVoiceEvent({
        type: source,
        tool: toolName,
        status: "error",
        summary: message
      });
      return {
        ok: false,
        tool: toolName,
        error: message
      };
    }
  }

  function parseToolArguments(value) {
    if (!value) {
      return {};
    }
    if (typeof value === "object") {
      return value;
    }
    return safeJsonParse(value) || {};
  }

  async function executeInternalTool(toolName, callId, args = {}) {
    if (!toolName || !callId || executedCallsRef.current.has(callId)) {
      return;
    }

    executedCallsRef.current.add(callId);
    const output = await runInternalTool(toolName, "realtime_tool", args);
    sendToolResult(callId, output);
  }

  async function runManualTool(toolName, args = {}) {
    setIsManualToolRunning(true);
    try {
      await runInternalTool(toolName, "manual_test", args);
    } finally {
      setIsManualToolRunning(false);
    }
  }

  function sendToolResult(callId, output) {
    const sentOutput = sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output)
      }
    });

    if (sentOutput) {
      sendRealtimeEvent({
        type: "response.create",
        response: {
          instructions: `${responseStyleInstruction()} Responde por voz en español. Resume el resultado de la herramienta. Si hay errores o falta información, dilo claramente.`
        }
      });
      setVoiceStatus("thinking");
      setRealtimeState("conectando");
      addVoiceEvent({
        type: "realtime",
        status: "pensando",
        summary: "Resultado de herramienta enviado al modelo."
      });
    }
  }

  function handleFunctionCallsFromResponseDone(event) {
    const outputs = event?.response?.output || [];
    for (const item of outputs) {
      if (item?.type === "function_call") {
        executeInternalTool(item.name, item.call_id, parseToolArguments(item.arguments));
      }
    }
  }

  async function handleRealtimeEvent(event) {
    const type = event?.type || "";
    addVoiceEvent({
      type,
      status: voiceStatus,
      summary: type.includes("response.done") ? "Respuesta completada." : ""
    });

    if (type === "response.function_call_arguments.done") {
      await executeInternalTool(event.name, event.call_id, parseToolArguments(event.arguments));
      return;
    }

    if (type === "response.output_item.done" && event?.item?.type === "function_call") {
      await executeInternalTool(
        event.item.name,
        event.item.call_id,
        parseToolArguments(event.item.arguments)
      );
      return;
    }

    if (type.includes("input_audio") || type.includes("speech_started")) {
      setVoiceStatus("listening");
    }
    if (type.includes("speech_stopped") || type.includes("response.created")) {
      setVoiceStatus("thinking");
    }
      if (type.includes("response.audio") && type.includes("delta")) {
        setVoiceStatus("speaking");
      }
    if (type.includes("response.done")) {
      setVoiceStatus("listening");
      handleFunctionCallsFromResponseDone(event);
    }
    if (type.includes("error")) {
      const message = formatRealtimeError(event?.error);
      setVoiceStatus("error");
      setErrorMessage(message);
      setRealtimeState("error");
      addVoiceEvent({
        type,
        status: "error",
        summary: message
      });
    }

    const transcriptDelta =
      event?.delta ||
      event?.transcript ||
      event?.item?.content?.find?.((entry) => entry?.transcript)?.transcript;

    if (
      type.includes("input_audio_transcription") ||
      type.includes("conversation.item.input_audio_transcription")
    ) {
      if (transcriptDelta) {
        setPartialTranscript((current) => `${current}${transcriptDelta}`);
      }
      if (type.includes("completed")) {
        setLastTranscript((current) => partialTranscript || current);
        setPartialTranscript("");
      }
    }

    if (type.includes("response.output_text") || type.includes("response.text")) {
      if (event?.delta) {
        setLastResponse((current) => `${current}${event.delta}`);
      }
    }
    if (type.includes("response.done")) {
      const outputText = event?.response?.output
        ?.flatMap((item) => item?.content || [])
        ?.map((content) => content?.text || content?.transcript || "")
        ?.filter(Boolean)
        ?.join("\n");
      if (outputText) {
        setLastResponse(outputText);
      }
    }
  }

  async function startVoice() {
    setErrorMessage("");
    setLastResponse("");
    setPartialTranscript("");

    if (typeof window === "undefined") {
      return;
    }
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus("error");
      setErrorMessage("Este navegador no soporta WebRTC o acceso a micrófono.");
      return;
    }

    cleanup();
    setRealtimeState("conectando");
    setVoiceStatus("thinking");

    try {
      const tokenResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          voice: selectedVoiceForSession(),
          response_style: activeStyle,
          avatar_theme: avatarTheme,
          avatar_name: avatarName
        })
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.client_secret) {
        throw new Error(tokenData.error || "No se pudo crear la sesión Realtime.");
      }
      setActiveVoice(tokenData.voice || selectedVoiceForSession());
      if (tokenData.response_style) {
        setActiveStyle(tokenData.response_style);
      }
      if (tokenData.avatar_theme) {
        setAvatarTheme(tokenData.avatar_theme);
      }

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setRealtimeState("conectado");
        } else if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
          setRealtimeState(peer.connectionState === "closed" ? "desconectado" : "error");
        } else {
          setRealtimeState("conectando");
        }
      };

      const audioElement = new Audio();
      audioElement.autoplay = true;
      audioRef.current = audioElement;
      peer.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
        setVoiceStatus("speaking");
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      peer.addTrack(stream.getAudioTracks()[0], stream);

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("open", () => {
        setRealtimeState("conectado");
        setVoiceStatus("listening");
        addVoiceEvent({
          type: "realtime",
          status: "conectado",
          summary: "Canal de eventos abierto."
        });
        const initialPrompt =
          pendingInitialPromptRef.current ||
          "Saluda brevemente y pregunta en qué punto de la infraestructura quiere centrarse la persona.";
        pendingInitialPromptRef.current = "";
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `${responseStyleInstruction()} ${initialPrompt}`
            }
          })
        );
      });
      channel.addEventListener("message", (message) => {
        const event = safeJsonParse(message.data);
        if (event) {
          void handleRealtimeEvent(event);
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenData.client_secret}`,
          "Content-Type": "application/sdp"
        }
      });

      if (!sdpResponse.ok) {
        throw new Error("OpenAI Realtime no aceptó la conexión WebRTC.");
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text()
      });
    } catch (error) {
      cleanup();
      pendingInitialPromptRef.current = "";
      setVoiceStatus("error");
      setRealtimeState("error");
      setErrorMessage(error?.message || "No se pudo iniciar la voz.");
    }
  }

  async function testVoice() {
    setErrorMessage("");
    setLastResponse(voiceTestText);
    if (sendSpokenInstruction(voiceTestText)) {
      return;
    }

    pendingInitialPromptRef.current = `No llames herramientas. Di exactamente: ${voiceTestText}`;
    addVoiceEvent({
      type: "prueba_voz",
      status: "conectando",
      summary: "Iniciando Realtime para prueba de voz."
    });
    await startVoice();
  }

  function stopVoice() {
    cleanup();
    pendingInitialPromptRef.current = "";
    setRealtimeState("desconectado");
    setVoiceStatus("disconnected");
    setPartialTranscript("");
    addVoiceEvent({
      type: "realtime",
      status: "desconectado",
      summary: "Sesión de voz detenida."
    });
  }

  return (
    <section className="voice-panel" aria-label="Hablar con el agente">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Avatar de voz v0.15</p>
          <h3>Hablar con el agente</h3>
        </div>
        <span className={`voice-status ${voiceStatus}`}>
          {statusLabels[voiceStatus] || voiceStatus}
        </span>
      </div>

      <div className="voice-content">
        <div className={`voice-avatar ${voiceStatus} avatar-theme-${avatarTheme}`} aria-hidden="true">
          <div className="avatar-face">
            <span className="avatar-eye" />
            <span className="avatar-eye" />
            <span className="avatar-mouth" />
          </div>
        </div>

        <div className="voice-controls">
          <div className="voice-buttons">
            <button
              type="button"
              className="action-button primary-action"
              onClick={startVoice}
              disabled={voiceStatus !== "disconnected" && voiceStatus !== "error"}
            >
              Iniciar voz
            </button>
            <button
              type="button"
              className="action-button secondary-action"
              onClick={stopVoice}
              disabled={voiceStatus === "disconnected"}
            >
              Detener voz
            </button>
            <button
              type="button"
              className="action-button secondary-action"
              onClick={testVoice}
              disabled={voiceStatus !== "disconnected" && voiceStatus !== "error" && realtimeState !== "conectado"}
            >
              Probar voz
            </button>
          </div>

          {presentationMode ? (
            <p className="voice-presentation-hint">
              Pregunta por voz: ¿Qué es lo más urgente hoy?
            </p>
          ) : (
            <div className="voice-text-grid">
              <div>
                <span>Herramienta</span>
                <p>
                  {lastTool ? toolStatusLabels[lastTool] || lastTool : "Sin herramienta ejecutada."}
                </p>
              </div>
              <div>
                <span>Resultado</span>
                <p>{lastToolSummary || "Sin resultado de herramienta todavía."}</p>
              </div>
              <div>
                <span>Voz activa</span>
                <p>
                  {activeVoice || selectedVoiceForSession()} · {activeStyle}
                </p>
              </div>
              <div>
                <span>Conexión</span>
                <p>{realtimeState}. La voz es generada por IA.</p>
              </div>
              <div>
                <span>Transcripción</span>
                <p>{partialTranscript || lastTranscript || "Sin audio reconocido todavía."}</p>
              </div>
              <div>
                <span>Última respuesta</span>
                <p>{lastResponse || "El agente responderá aquí cuando hable."}</p>
              </div>
            </div>
          )}

          {errorMessage ? <p className="voice-error">{errorMessage}</p> : null}
        </div>
      </div>

      {!presentationMode ? (
      <section className="voice-config-panel" aria-label="Configuración de voz">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Configuración de voz</p>
            <h3>Voz y avatar</h3>
          </div>
          <span className="readonly-badge">IA generativa</span>
        </div>

        <div className="voice-config-grid">
          <label className="voice-config-field">
            <span>Voz</span>
            <select
              value={selectedVoice || defaultVoice}
              onChange={(event) => changeSelectedVoice(event.target.value)}
              disabled={voiceStatus !== "disconnected" && voiceStatus !== "error"}
            >
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
          </label>
          <label className="voice-config-field">
            <span>Estilo</span>
            <select
              value={activeStyle}
              onChange={(event) => changeActiveStyle(event.target.value)}
            >
              {responseStyles.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="voice-config-field">
            <span>Tema avatar</span>
            <select
              value={avatarTheme}
              onChange={(event) => changeAvatarTheme(event.target.value)}
            >
              {avatarThemes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="voice-config-field">
            <span>Nombre opcional</span>
            <input
              type="text"
              value={avatarName}
              maxLength={40}
              placeholder="Agente"
              onChange={(event) => changeAvatarName(event.target.value)}
            />
          </label>
        </div>

        <p className="voice-config-note">
          {voiceConfigState} La selección se usará en la próxima sesión Realtime. Si no eliges
          voz, se usa `OPENAI_REALTIME_VOICE`.
        </p>
      </section>
      ) : null}

      {!presentationMode ? (
      <section className="voice-diagnostics" aria-label="Diagnóstico de voz">
        <div className="voice-diagnostics-header">
          <div>
            <p className="eyebrow">Diagnóstico de voz</p>
            <h3>Control de herramientas</h3>
          </div>
          <button
            type="button"
            className="action-button secondary-action"
            onClick={() => setIsDiagnosticsOpen((open) => !open)}
          >
            {isDiagnosticsOpen ? "Ocultar diagnóstico" : "Mostrar diagnóstico"}
          </button>
        </div>

        {isDiagnosticsOpen ? (
          <>
            <div className="voice-diagnostics-grid">
              <div>
                <span>Realtime</span>
                <strong>{realtimeState}</strong>
              </div>
              <div>
                <span>Avatar</span>
                <strong>{statusLabels[voiceStatus] || voiceStatus}</strong>
              </div>
              <div>
                <span>Última herramienta</span>
                <strong>{lastTool || "Ninguna"}</strong>
              </div>
              <div>
                <span>Último evento</span>
                <strong>{lastEventAt || "Sin eventos"}</strong>
              </div>
            </div>

            <div className="manual-tool-grid">
              {manualToolButtons.map(([toolName, label, args]) => (
                <button
                  key={toolName}
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => runManualTool(toolName, args || {})}
                  disabled={isManualToolRunning}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="voice-events">
              <h3>Historial de eventos</h3>
              {voiceEvents.length ? (
                voiceEvents.map((event, index) => (
                  <div key={`${event.timestamp}-${index}`} className="voice-event-row">
                    <span>{event.timestamp}</span>
                    <strong>{event.type}</strong>
                    <em>{event.tool || "-"}</em>
                    <p>{event.summary || event.status || "-"}</p>
                  </div>
                ))
              ) : (
                <p className="empty-history">Sin eventos de voz todavía.</p>
              )}
            </div>
          </>
        ) : null}
      </section>
      ) : null}
    </section>
  );
}
