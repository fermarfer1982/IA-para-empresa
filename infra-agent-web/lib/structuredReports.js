import { createReport } from "./reportsDb";
import { requestJson } from "./httpJson";
import { buildReadOnlySnapshot } from "./mcpSnapshot";
import { structuredReportDefinitions } from "./structuredSchemas";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_STRUCTURED_MODEL = "gpt-4o-mini";

function sanitizeError(error) {
  return String(error?.message || error || "Error desconocido.")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function extractOutputText(body) {
  if (typeof body?.output_text === "string") {
    return body.output_text;
  }

  const chunks = [];
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function parseJsonText(text) {
  if (!text) {
    throw new Error("OpenAI no devolvió texto estructurado.");
  }

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("La respuesta no contiene JSON válido.");
    }
    return JSON.parse(match[0]);
  }
}

function assertArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`JSON inválido: ${field} debe ser un array.`);
  }
}

function validateStructuredData(kind, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("JSON inválido: la raíz debe ser un objeto.");
  }

  if (!data.title || !data.generated_at) {
    throw new Error("JSON inválido: faltan title o generated_at.");
  }

  if (kind === "daily-summary") {
    assertArray(data.key_findings, "key_findings");
    assertArray(data.top_actions, "top_actions");
    assertArray(data.missing_data, "missing_data");
  } else if (kind === "correlation-matrix") {
    assertArray(data.rows, "rows");
    assertArray(data.confirmed_impact, "confirmed_impact");
    assertArray(data.critical_without_ticket, "critical_without_ticket");
    assertArray(data.tickets_without_zabbix_evidence, "tickets_without_zabbix_evidence");
    assertArray(data.monitoring_gaps, "monitoring_gaps");
  } else if (kind === "critical-risks") {
    assertArray(data.risks, "risks");
    assertArray(data.top_actions, "top_actions");
    assertArray(data.missing_data, "missing_data");
  } else if (kind === "monitoring-gaps") {
    assertArray(data.gaps, "gaps");
    assertArray(data.top_actions, "top_actions");
    assertArray(data.missing_data, "missing_data");
  }
}

function compactSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2).slice(0, 52000);
}

async function callOpenAIStructured(definition, snapshot) {
  const apiKey = process.env.OPENAI_API_KEY;
  const workflowId = process.env.OPENAI_WORKFLOW_ID;

  if (!apiKey || !workflowId) {
    throw new Error("Faltan OPENAI_API_KEY u OPENAI_WORKFLOW_ID en el backend.");
  }

  const model = process.env.OPENAI_STRUCTURED_MODEL || DEFAULT_STRUCTURED_MODEL;
  const payload = {
    model,
    store: false,
    input: [
      {
        role: "system",
        content:
          "Eres el backend estructurado del Agente Inteligente de Infraestructura. Usa solo los datos proporcionados. No inventes activos, tickets, problemas ni métricas. Si falta un dato, inclúyelo en missing_data. No propongas cerrar, silenciar ni modificar sistemas como acción automática. Devuelve JSON válido que cumpla exactamente el esquema."
      },
      {
        role: "user",
        content: `${definition.prompt}

Contexto operativo:
- La consola ChatKit principal usa el workflow Agent Builder configurado en el backend.
- Este endpoint backend genera una versión estructurada para dashboard e histórico local.
- Todos los MCPs y sistemas externos son read-only.

Snapshot read-only disponible:
${compactSnapshot(snapshot)}`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: definition.schemaName,
        strict: true,
        schema: definition.schema
      }
    },
    metadata: {
      app: "infra-agent-web",
      dashboard_version: "v0.4",
      workflow_configured: "true"
    }
  };

  const response = await requestJson(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    timeoutMs: 90000,
    body: payload
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = response.body?.error?.message || `HTTP ${response.statusCode}`;
    throw new Error(`OpenAI Responses API: ${message}`);
  }

  const outputText = extractOutputText(response.body);
  const data = parseJsonText(outputText);
  validateStructuredData(definition.schemaName.replace(/_/g, "-"), data);

  return {
    data,
    source: "openai_responses",
    model,
    response_id: response.body?.id || null
  };
}

function fallbackItemsFromSnapshot(snapshot) {
  const mapText = snapshot?.local_context?.["agent_knowledge/global_infrastructure_map.json"] || "";
  const coverageText = snapshot?.local_context?.["reports/zabbix-coverage-report.json"] || "";
  const criticalText = snapshot?.mcp?.zabbix?.get_critical_risks?.data || "";
  const incidentsText = snapshot?.mcp?.incidents_ti?.get_incidents_summary?.data || "";

  return {
    mapText,
    coverageText,
    criticalText,
    incidentsText
  };
}

function createFallbackData(kind, snapshot, warning) {
  const now = new Date().toISOString();
  const { mapText, coverageText, criticalText, incidentsText } = fallbackItemsFromSnapshot(snapshot);
  const hasNasSmart = /NasAlmeria|SMART|HDD 5/i.test(`${mapText}\n${coverageText}\n${criticalText}`);
  const hasPrinters = /impresora|printer|Zebra|Toshiba/i.test(`${mapText}\n${incidentsText}`);
  const hasBackups = /backup|PBS|Proxmox/i.test(`${mapText}\n${coverageText}`);

  if (kind === "correlation-matrix") {
    return {
      title: "Matriz estructurada Zabbix + IncidenciasTI",
      generated_at: now,
      summary:
        "Generada con fallback local a partir de snapshots read-only porque OpenAI no devolvió JSON utilizable.",
      rows: [
        {
          asset_or_service: "Impresoras / etiquetadoras",
          technical_problem: hasPrinters
            ? "Incidencias de usuario y huecos SNMP o falta de datos recientes."
            : "Requiere correlación adicional con IncidenciasTI.",
          related_incidents: [],
          zabbix_evidence: "Consultar IncidenciasTI y mapa global para detalle actualizado.",
          correlation_level: hasPrinters ? "media" : "baja",
          user_impact: hasPrinters ? "Probable impacto de usuario." : "No confirmado.",
          technical_risk: "Medio",
          priority: hasPrinters ? "alta" : "media",
          recommended_action: "Revisar tickets abiertos y completar cobertura SNMP/nombres de activo.",
          task_type: "operativa"
        },
        {
          asset_or_service: "NasAlmeria / storage / backups",
          technical_problem: hasNasSmart
            ? "Riesgo SMART/storage detectado en artefactos Zabbix."
            : "Riesgo de datos pendiente de validación.",
          related_incidents: [],
          zabbix_evidence: hasNasSmart ? "NasAlmeria, SMART o HDD 5 aparecen en el mapa." : "Sin evidencia resumida.",
          correlation_level: "baja",
          user_impact: "No reportado directamente.",
          technical_risk: hasNasSmart ? "Alto" : "Medio",
          priority: hasNasSmart ? "critica" : "alta",
          recommended_action: "Confirmar estado físico y backup antes de cualquier cambio.",
          task_type: "revision_humana"
        }
      ],
      confirmed_impact: hasPrinters ? ["Impresoras / etiquetadoras con posible impacto de usuario."] : [],
      critical_without_ticket: hasNasSmart ? ["NasAlmeria / SMART / storage."] : [],
      tickets_without_zabbix_evidence: [],
      monitoring_gaps: ["Normalizar relación activo-ticket y completar checks por bloque."]
    };
  }

  if (kind === "critical-risks") {
    return {
      title: "Riesgos críticos estructurados",
      generated_at: now,
      summary: "Generado con fallback local desde snapshots read-only.",
      risks: [
        {
          asset_or_service: hasNasSmart ? "NasAlmeria" : "NAS/storage",
          source: "zabbix",
          severity: hasNasSmart ? "critical" : "high",
          evidence: hasNasSmart ? "Se detecta referencia SMART/HDD 5 en artefactos." : "Falta evidencia actualizada.",
          impact: "Riesgo potencial sobre datos o disponibilidad.",
          recommended_action: "Validación humana y comprobación de backups antes de cambios.",
          requires_human_confirmation: true
        },
        {
          asset_or_service: "Backups",
          source: hasBackups ? "zabbix" : "unknown",
          severity: "high",
          evidence: hasBackups ? "Aparecen artefactos Proxmox/PBS/backups." : "Evidencia incompleta.",
          impact: "Puede impedir recuperación fiable.",
          recommended_action: "Revisar hosts críticos sin backup verificable.",
          requires_human_confirmation: true
        }
      ],
      top_actions: [
        {
          priority: "critical",
          action: "Confirmar NAS/storage/backups con prioridad operativa.",
          owner_type: "revision_humana",
          reason: "Riesgo de datos requiere confirmación antes de actuar."
        }
      ],
      missing_data: warning ? [warning] : []
    };
  }

  if (kind === "monitoring-gaps") {
    return {
      title: "Huecos de monitorización estructurados",
      generated_at: now,
      summary: "Generado con fallback local desde snapshots read-only.",
      gaps: [
        {
          block: "NAS",
          asset_or_service: "NAS/QNAP/Synology",
          current_coverage: "Métricas y triggers parciales.",
          missing_checks: ["SMART/RAID homogéneo", "backups/snapshots", "storage accionable"],
          priority: "high",
          recommended_action: "Completar fase NAS/SMART/RAID/storage.",
          can_automate: false
        },
        {
          block: "Impresoras",
          asset_or_service: "Impresoras y etiquetadoras",
          current_coverage: "SNMP parcial y equipos sin datos recientes.",
          missing_checks: ["estado online", "consumibles", "errores", "mapeo con tickets"],
          priority: "medium",
          recommended_action: "Normalizar SNMP y relación activo-incidencia.",
          can_automate: true
        }
      ],
      top_actions: [
        {
          priority: "high",
          action: "Completar checks faltantes en bloques con impacto o riesgo de datos.",
          owner_type: "codex_zabbix",
          reason: "El agente necesita datos accionables para priorizar."
        }
      ],
      missing_data: warning ? [warning] : []
    };
  }

  return {
    title: "Informe diario estructurado",
    generated_at: now,
    executive_summary:
      "Generado con fallback local a partir de snapshots read-only porque OpenAI no devolvió JSON utilizable.",
    overall_status: hasNasSmart ? "red" : "yellow",
    key_findings: [
      {
        title: hasNasSmart ? "Riesgo SMART/storage en NasAlmeria" : "Riesgos técnicos pendientes",
        source: hasNasSmart ? "zabbix" : "unknown",
        severity: hasNasSmart ? "critical" : "high",
        description: hasNasSmart
          ? "Los artefactos locales mantienen evidencia de alerta SMART/HDD."
          : "Falta lectura estructurada actual completa.",
        recommended_action: "Confirmar con revisión humana y validar backup antes de cambios."
      },
      {
        title: "Correlación con IncidenciasTI pendiente de estructurar",
        source: incidentsText ? "incidents_ti" : "unknown",
        severity: "medium",
        description: incidentsText
          ? "Hay resumen de IncidenciasTI disponible desde MCP."
          : "No se pudo incorporar resumen de IncidenciasTI.",
        recommended_action: "Usar matriz estructurada y revisar tickets abiertos."
      }
    ],
    top_actions: [
      {
        priority: "critical",
        action: "Validar riesgos de datos y backups.",
        owner_type: "revision_humana",
        reason: "SMART/storage/backups no deben resolverse silenciando alertas."
      },
      {
        priority: "high",
        action: "Completar cobertura por bloques peor preparados.",
        owner_type: "codex_zabbix",
        reason: "Mejora la capacidad de razonamiento del agente."
      }
    ],
    missing_data: warning ? [warning] : []
  };
}

function renderDailyMarkdown(data) {
  return `# ${data.title}

Generado: ${data.generated_at}
Estado general: ${data.overall_status}

## Resumen ejecutivo
${data.executive_summary}

## Hallazgos clave
${data.key_findings
  .map(
    (item) =>
      `- **${item.severity}** [${item.source}] ${item.title}: ${item.description}\n  Acción: ${item.recommended_action}`
  )
  .join("\n")}

## Acciones principales
${data.top_actions
  .map((item) => `- **${item.priority}** ${item.action}\n  Responsable: ${item.owner_type}. Motivo: ${item.reason}`)
  .join("\n")}

## Datos faltantes
${data.missing_data.map((item) => `- ${item}`).join("\n") || "- Sin datos faltantes declarados."}
`;
}

function renderCorrelationMarkdown(data) {
  const rows = data.rows
    .map(
      (row) =>
        `| ${row.asset_or_service} | ${row.technical_problem} | ${row.related_incidents
          .map((incident) => `${incident.id} ${incident.title} (${incident.status})`)
          .join("; ")} | ${row.correlation_level} | ${row.user_impact} | ${row.technical_risk} | ${
          row.priority
        } | ${row.recommended_action} | ${row.task_type} |`
    )
    .join("\n");

  return `# ${data.title}

Generado: ${data.generated_at}

## Resumen
${data.summary}

## Matriz
| Activo / servicio | Problema técnico | Incidencias relacionadas | Correlación | Impacto usuario | Riesgo técnico | Prioridad | Acción recomendada | Tipo de tarea |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## Impacto confirmado
${data.confirmed_impact.map((item) => `- ${item}`).join("\n") || "- Sin impacto confirmado."}

## Críticos sin ticket
${data.critical_without_ticket.map((item) => `- ${item}`).join("\n") || "- Sin críticos sin ticket declarados."}

## Tickets sin evidencia Zabbix
${data.tickets_without_zabbix_evidence.map((item) => `- ${item}`).join("\n") || "- Sin tickets sin evidencia declarados."}

## Huecos de monitorización
${data.monitoring_gaps.map((item) => `- ${item}`).join("\n") || "- Sin huecos declarados."}
`;
}

function renderRisksMarkdown(data) {
  return `# ${data.title}

Generado: ${data.generated_at}

## Resumen
${data.summary}

## Riesgos
${data.risks
  .map(
    (risk) =>
      `- **${risk.severity}** ${risk.asset_or_service} [${risk.source}]\n  Evidencia: ${risk.evidence}\n  Impacto: ${risk.impact}\n  Acción: ${risk.recommended_action}\n  Requiere confirmación humana: ${
        risk.requires_human_confirmation ? "sí" : "no"
      }`
  )
  .join("\n")}

## Acciones
${data.top_actions.map((item) => `- **${item.priority}** ${item.action}: ${item.reason}`).join("\n")}

## Datos faltantes
${data.missing_data.map((item) => `- ${item}`).join("\n") || "- Sin datos faltantes declarados."}
`;
}

function renderGapsMarkdown(data) {
  return `# ${data.title}

Generado: ${data.generated_at}

## Resumen
${data.summary}

## Huecos
${data.gaps
  .map(
    (gap) =>
      `- **${gap.priority}** ${gap.block} / ${gap.asset_or_service}\n  Cobertura actual: ${
        gap.current_coverage
      }\n  Checks faltantes: ${gap.missing_checks.join(", ")}\n  Acción: ${
        gap.recommended_action
      }\n  Automatizable: ${gap.can_automate ? "sí" : "no"}`
  )
  .join("\n")}

## Acciones
${data.top_actions.map((item) => `- **${item.priority}** ${item.action}: ${item.reason}`).join("\n")}

## Datos faltantes
${data.missing_data.map((item) => `- ${item}`).join("\n") || "- Sin datos faltantes declarados."}
`;
}

function renderMarkdown(kind, data) {
  if (kind === "correlation-matrix") {
    return renderCorrelationMarkdown(data);
  }
  if (kind === "critical-risks") {
    return renderRisksMarkdown(data);
  }
  if (kind === "monitoring-gaps") {
    return renderGapsMarkdown(data);
  }
  return renderDailyMarkdown(data);
}

export async function generateStructuredReport(kind) {
  const definition = structuredReportDefinitions[kind];
  if (!definition) {
    throw new Error("Tipo de informe estructurado no permitido.");
  }

  const snapshot = await buildReadOnlySnapshot(kind);
  let structured;
  let warning = null;

  try {
    structured = await callOpenAIStructured(definition, snapshot);
  } catch (error) {
    warning = sanitizeError(error);
    const data = createFallbackData(kind, snapshot, warning);
    validateStructuredData(kind, data);
    structured = {
      data,
      source: "local_fallback",
      model: null,
      response_id: null
    };
  }

  const markdown = renderMarkdown(kind, structured.data);
  const report = await createReport({
    type: definition.reportType,
    title: structured.data.title || definition.title,
    prompt: definition.prompt,
    response_markdown: markdown,
    created_by: "infra-agent-web-structured",
    metadata_json: {
      source: structured.source,
      model: structured.model,
      response_id: structured.response_id,
      dashboard_version: "v0.4",
      structured_kind: kind,
      structured_data: structured.data,
      warning
    }
  });

  return {
    report,
    data: structured.data,
    markdown,
    source: structured.source,
    warning
  };
}
