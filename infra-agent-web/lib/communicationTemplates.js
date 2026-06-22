function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function list(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => text(value))
    .filter(Boolean);
}

function firstValue(values, fallback = "") {
  const items = list(values);
  return items.length ? items[0] : fallback;
}

function stripMarkdown(value) {
  return text(value)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function subjectWithDate(prefix, context = {}) {
  const date = text(context.report_date || context.created_at || context.date);
  return date ? `${prefix} - ${date}` : prefix;
}

function normalizeCustomContext(input = {}) {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input;
}

function buildMarkdownDocument({ title, recipientLabel, template, sections, closing }) {
  const parts = [
    `# ${title}`,
    "",
    `- Destinatario: ${recipientLabel || "Sin destinatario"}`,
    `- Canal sugerido: ${template.suggested_channel}`,
    `- Tono: ${template.tone}`,
    "",
    ...sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      ...(Array.isArray(section.lines) && section.lines.length
        ? section.lines.map((line) => `- ${line}`)
        : [section.text || "Sin datos."]),
      ""
    ])
  ];

  if (closing) {
    parts.push(`## Cierre`, "", closing, "");
  }

  return parts.join("\n").trim() + "\n";
}

function templateFromContext(template, input = {}) {
  const context = normalizeCustomContext(input.custom_context);
  const recipientLabel = text(input.recipient_label, template.default_recipient || "Sin destinatario");
  const recipientEmail = text(input.recipient_email);
  const sourceType = text(input.source_type, template.default_source_type || "manual");
  const sourceReportId = text(input.source_report_id);
  const sourceIncidentId = text(input.source_incident_id);
  const subject = text(input.subject) || template.subject(context, input);
  const bodyMarkdown = template.body({
    template,
    context,
    recipientLabel,
    recipientEmail,
    sourceType,
    sourceReportId,
    sourceIncidentId,
    input
  });

  return {
    type: template.suggested_channel,
    status: "draft",
    recipient_label: recipientLabel,
    recipient_email: recipientEmail,
    subject,
    body_markdown: bodyMarkdown,
    body_text: stripMarkdown(bodyMarkdown),
    source_type: sourceType,
    template_id: template.id,
    source_report_id: sourceReportId || "",
    source_incident_id: sourceIncidentId || ""
  };
}

function executiveBody({ context, recipientLabel, template }) {
  const topRisks = list(context.top_risks || context.risks || context.critical_risks);
  const impacts = list(context.user_impact || context.impact || context.impacts);
  const actions = list(context.actions || context.top_actions || context.recommended_actions);
  const missing = list(context.missing_data || context.missing || context.gaps);
  const escalations = list(context.escalations || context.decisions || context.decisions_needed);

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      {
        title: "Resumen ejecutivo",
        text:
          text(context.executive_summary) ||
          text(context.summary) ||
          "Resumen ejecutivo preparado a partir del informe disponible."
      },
      {
        title: "Estado general",
        lines: [text(context.status, "unknown"), text(context.semaphore || context.traffic_light || "unknown")]
      },
      { title: "Top 3 riesgos", lines: topRisks.slice(0, 3) },
      { title: "Impacto en usuarios", lines: impacts.slice(0, 3) },
      { title: "Top 3 acciones recomendadas", lines: actions.slice(0, 3) },
      { title: "Decisiones o escalados necesarios", lines: escalations.slice(0, 3) },
      { title: "Datos faltantes importantes", lines: missing.slice(0, 4) }
    ],
    closing: "Revise el contenido antes de reenviarlo manualmente."
  });
}

function technicalBody({ context, recipientLabel, template }) {
  const problems = list(context.problems || context.zabbix_problems || context.risks);
  const incidents = list(context.incidents || context.related_incidents);
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const evidence = list(context.evidence || context.zabbix_evidence || context.evidences);
  const risks = list(context.risks_by_priority || context.risks || context.critical_risks);
  const gaps = list(context.monitoring_gaps || context.gaps);
  const actionsByType = context.actions_by_type && typeof context.actions_by_type === "object"
    ? context.actions_by_type
    : {};
  const nextSteps = list(context.next_steps || context.next_actions);
  const missing = list(context.missing_data || context.missing);

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      {
        title: "Resumen técnico",
        text:
          text(context.summary) ||
          "Resumen técnico preparado a partir de la matriz, los riesgos y los huecos disponibles."
      },
      { title: "Problemas Zabbix relevantes", lines: problems.slice(0, 6) },
      { title: "Incidencias relacionadas", lines: incidents.slice(0, 6) },
      {
        title: "Matriz de correlación resumida",
        lines: rows.slice(0, 6).map((row) =>
          [
            row.asset_or_service,
            row.technical_problem,
            row.correlation_level,
            row.priority
          ]
            .filter(Boolean)
            .join(" · ")
        )
      },
      { title: "Evidencias técnicas", lines: evidence.slice(0, 6) },
      { title: "Riesgos por prioridad", lines: risks.slice(0, 6) },
      { title: "Huecos de monitorización", lines: gaps.slice(0, 6) },
      {
        title: "Acciones por tipo",
        lines: [
          ...(list(actionsByType.operativa).map((item) => `Operativa: ${item}`)),
          ...(list(actionsByType.codex_zabbix).map((item) => `Codex/Zabbix: ${item}`)),
          ...(list(actionsByType.documentacion_inventario).map(
            (item) => `Documentación/inventario: ${item}`
          )),
          ...(list(actionsByType.revision_humana).map((item) => `Revisión humana: ${item}`))
        ]
      },
      { title: "Datos faltantes", lines: missing.slice(0, 4) },
      { title: "Próximos pasos", lines: nextSteps.slice(0, 4) }
    ],
    closing: "Conservar este borrador para revisión técnica interna antes de copiarlo."
  });
}

function userBody({ context, recipientLabel, template }) {
  const incident = text(context.incident || context.issue || context.title, "Incidencia pendiente");
  const impact = list(context.impact || context.user_impact);
  const workaround = list(context.workaround || context.actions || context.recommended_actions);
  const nextUpdate = text(context.next_update || context.follow_up || "Próxima actualización cuando haya novedades.");
  const owner = text(context.owner || context.contact || "Soporte");

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      {
        title: "Resumen",
        text:
          text(context.summary) ||
          `Mensaje preparado para informar sobre ${incident}.`
      },
      { title: "Impacto", lines: impact.slice(0, 5) },
      { title: "Qué puede hacer el usuario", lines: workaround.slice(0, 5) },
      { title: "Siguiente actualización", lines: [nextUpdate] },
      { title: "Contacto", lines: [owner] }
    ],
    closing: "Mantener el mensaje claro y breve."
  });
}

function providerBody({ context, recipientLabel, template }) {
  const asset = text(context.asset || context.service || "Servicio afectado");
  const issue = list(context.issue || context.problems || context.summary);
  const request = list(context.request || context.action || context.actions);
  const deadline = text(context.deadline || context.sla || "Sin plazo definido");
  const contact = text(context.contact || context.owner || "Equipo interno");

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      {
        title: "Contexto",
        text: text(context.summary) || `Se requiere revisión sobre ${asset}.`
      },
      { title: "Problema", lines: issue.slice(0, 5) },
      { title: "Solicitud", lines: request.slice(0, 5) },
      { title: "Plazo o prioridad", lines: [deadline] },
      { title: "Contacto", lines: [contact] }
    ],
    closing: "Confirmar recepción y siguiente paso por el canal acordado."
  });
}

function followupBody({ context, recipientLabel, template }) {
  const incident = text(context.incident || context.title || "Incidencia");
  const done = list(context.done || context.resolved || context.progress);
  const pending = list(context.pending || context.blockers || context.remaining);
  const nextStep = list(context.next_step || context.next_steps);
  const owner = text(context.owner || context.contact || "Soporte");

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      {
        title: "Incidencia",
        text: incident
      },
      { title: "Hecho hasta ahora", lines: done.slice(0, 5) },
      { title: "Pendiente", lines: pending.slice(0, 5) },
      { title: "Siguiente paso", lines: nextStep.slice(0, 5) },
      { title: "Responsable", lines: [owner] }
    ],
    closing: "Mantener seguimiento manual hasta cierre completo."
  });
}

function criticalRiskBody({ context, recipientLabel, template }) {
  const risk = text(context.risk || context.summary || "Riesgo crítico");
  const impact = list(context.impact || context.user_impact || context.evidence);
  const action = list(context.action || context.actions || context.recommended_actions);
  const deadline = text(context.deadline || context.when || "Urgente");

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      {
        title: "Resumen",
        text: risk
      },
      { title: "Impacto", lines: impact.slice(0, 5) },
      { title: "Acción requerida", lines: action.slice(0, 5) },
      { title: "Plazo", lines: [deadline] }
    ],
    closing: "Escalar si no hay confirmación de contención."
  });
}

function dailyReportBody({ context, recipientLabel, template }) {
  const summary = text(context.summary || context.executive_summary);
  const status = text(context.status || "unknown");
  const actions = list(context.top_actions || context.actions);
  const risks = list(context.risks || context.top_risks);
  const gaps = list(context.gaps || context.missing_data);

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      { title: "Resumen", text: summary || "Resumen operativo diario preparado a partir del informe disponible." },
      { title: "Estado general", lines: [status] },
      { title: "Top acciones", lines: actions.slice(0, 5) },
      { title: "Riesgos", lines: risks.slice(0, 5) },
      { title: "Datos faltantes", lines: gaps.slice(0, 5) }
    ],
    closing: "Usar este borrador como base para comunicación interna manual."
  });
}

function matrixBody({ context, recipientLabel, template }) {
  const summary = text(context.summary || "Resumen de correlación preparado para revisión manual.");
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const actions = list(context.actions || context.recommended_actions);

  return buildMarkdownDocument({
    title: template.name,
    recipientLabel,
    template,
    sections: [
      { title: "Resumen", text: summary },
      {
        title: "Filas destacadas",
        lines: rows.slice(0, 8).map((row) =>
          [
            row.asset_or_service,
            row.technical_problem,
            row.correlation_level,
            row.priority
          ]
            .filter(Boolean)
            .join(" · ")
        )
      },
      { title: "Acciones sugeridas", lines: actions.slice(0, 5) }
    ],
    closing: "Revisar antes de enviar o copiar."
  });
}

export const communicationTemplates = [
  {
    id: "executive_direccion",
    name: "Correo ejecutivo para dirección",
    description:
      "Resumen breve orientado a responsables no técnicos, centrado en estado, riesgos e impacto.",
    suggested_channel: "email",
    tone: "ejecutivo",
    default_recipient: "Dirección",
    default_source_type: "daily_report",
    subject: (context) => subjectWithDate("Informe ejecutivo", context),
    expected_data: ["informe", "riesgo", "acción recomendada", "destinatario"],
    structure: [
      "Resumen ejecutivo",
      "Estado general",
      "Top 3 riesgos",
      "Impacto en usuarios",
      "Top 3 acciones recomendadas",
      "Decisiones o escalados",
      "Datos faltantes"
    ],
    body: executiveBody
  },
  {
    id: "tecnico_sistemas",
    name: "Aviso técnico para sistemas",
    description:
      "Detalle técnico para el equipo de sistemas con incidencias, evidencias y próximos pasos.",
    suggested_channel: "teams",
    tone: "técnico",
    default_recipient: "Equipo de sistemas",
    default_source_type: "matrix",
    subject: (context) => subjectWithDate("Aviso técnico", context),
    expected_data: ["informe", "incidencia", "riesgo", "acción recomendada", "destinatario"],
    structure: [
      "Resumen técnico",
      "Problemas Zabbix relevantes",
      "Incidencias relacionadas",
      "Matriz de correlación resumida",
      "Evidencias técnicas",
      "Riesgos por prioridad",
      "Huecos de monitorización",
      "Acciones por tipo",
      "Datos faltantes",
      "Próximos pasos"
    ],
    body: technicalBody
  },
  {
    id: "usuario_final",
    name: "Mensaje para usuario final",
    description:
      "Mensaje claro y breve para comunicar estado, impacto y siguiente paso a una persona usuaria.",
    suggested_channel: "email",
    tone: "claro",
    default_recipient: "Usuario final",
    default_source_type: "incident",
    subject: (context) => subjectWithDate("Actualización de incidencia", context),
    expected_data: ["incidencia", "acción recomendada", "destinatario"],
    structure: ["Resumen", "Impacto", "Qué puede hacer el usuario", "Siguiente actualización", "Contacto"],
    body: userBody
  },
  {
    id: "proveedor",
    name: "Comunicación a proveedor",
    description:
      "Solicitud formal para un tercero, centrada en el problema, la acción requerida y el plazo.",
    suggested_channel: "email",
    tone: "claro",
    default_recipient: "Proveedor",
    default_source_type: "risk",
    subject: (context) => subjectWithDate("Solicitud a proveedor", context),
    expected_data: ["informe", "incidencia", "riesgo", "acción recomendada", "destinatario"],
    structure: ["Contexto", "Problema", "Solicitud", "Plazo o prioridad", "Contacto"],
    body: providerBody
  },
  {
    id: "seguimiento_incidencia",
    name: "Seguimiento de incidencia",
    description:
      "Seguimiento operativo de una incidencia con lo hecho, lo pendiente y el siguiente paso.",
    suggested_channel: "email",
    tone: "breve",
    default_recipient: "Soporte",
    default_source_type: "incident",
    subject: (context) => subjectWithDate("Seguimiento de incidencia", context),
    expected_data: ["incidencia", "acción recomendada", "destinatario"],
    structure: ["Incidencia", "Hecho hasta ahora", "Pendiente", "Siguiente paso", "Responsable"],
    body: followupBody
  },
  {
    id: "aviso_riesgo_critico",
    name: "Aviso de riesgo crítico",
    description:
      "Aviso urgente para comunicar un riesgo crítico y la acción requerida con prioridad alta.",
    suggested_channel: "teams",
    tone: "breve",
    default_recipient: "Soporte",
    default_source_type: "risk",
    subject: (context) => subjectWithDate("Aviso de riesgo crítico", context),
    expected_data: ["riesgo", "acción recomendada", "destinatario"],
    structure: ["Resumen", "Impacto", "Acción requerida", "Plazo"],
    body: criticalRiskBody
  },
  {
    id: "informe_diario",
    name: "Resumen operativo diario",
    description:
      "Resumen operativo para trabajo del día, con estado general, acciones y huecos.",
    suggested_channel: "email",
    tone: "ejecutivo",
    default_recipient: "Operación / soporte",
    default_source_type: "daily_report",
    subject: (context) => subjectWithDate("Resumen operativo diario", context),
    expected_data: ["informe", "acción recomendada", "destinatario"],
    structure: ["Resumen", "Estado general", "Top acciones", "Riesgos", "Datos faltantes"],
    body: dailyReportBody
  },
  {
    id: "matriz_correlacion",
    name: "Resumen de matriz de correlación",
    description:
      "Resumen técnico de la matriz para compartir filas destacadas y acciones asociadas.",
    suggested_channel: "teams",
    tone: "técnico",
    default_recipient: "Soporte técnico",
    default_source_type: "matrix",
    subject: (context) => subjectWithDate("Matriz de correlación", context),
    expected_data: ["informe", "acción recomendada", "destinatario"],
    structure: ["Resumen", "Filas destacadas", "Acciones sugeridas"],
    body: matrixBody
  }
];

export function listCommunicationTemplates() {
  return communicationTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    suggested_channel: template.suggested_channel,
    tone: template.tone,
    subject_suggestion: template.subject({}),
    expected_data: template.expected_data,
    structure: template.structure
  }));
}

export function getCommunicationTemplate(templateId) {
  return communicationTemplates.find((template) => template.id === templateId) || null;
}

export function buildCommunicationDraftFromTemplate(templateId, input = {}) {
  const template = getCommunicationTemplate(templateId);
  if (!template) {
    throw new Error("Plantilla de comunicación no encontrada.");
  }

  return {
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      suggested_channel: template.suggested_channel,
      tone: template.tone,
      expected_data: template.expected_data,
      structure: template.structure
    },
    draft: templateFromContext(template, input)
  };
}
