const severity = ["critical", "high", "medium", "low"];
const source = ["zabbix", "incidents_ti", "both", "unknown"];
const ownerType = ["operativa", "codex_zabbix", "documentacion_inventario", "revision_humana"];

const findingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    source: { type: "string", enum: source },
    severity: { type: "string", enum: severity },
    description: { type: "string" },
    recommended_action: { type: "string" }
  },
  required: ["title", "source", "severity", "description", "recommended_action"]
};

const actionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    priority: { type: "string", enum: severity },
    action: { type: "string" },
    owner_type: { type: "string", enum: ownerType },
    reason: { type: "string" }
  },
  required: ["priority", "action", "owner_type", "reason"]
};

export const dailySummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    generated_at: { type: "string" },
    executive_summary: { type: "string" },
    overall_status: { type: "string", enum: ["green", "yellow", "red", "unknown"] },
    key_findings: {
      type: "array",
      items: findingSchema
    },
    top_actions: {
      type: "array",
      items: actionSchema
    },
    missing_data: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "title",
    "generated_at",
    "executive_summary",
    "overall_status",
    "key_findings",
    "top_actions",
    "missing_data"
  ]
};

export const correlationMatrixSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    generated_at: { type: "string" },
    summary: { type: "string" },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_or_service: { type: "string" },
          technical_problem: { type: "string" },
          related_incidents: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                status: { type: "string" }
              },
              required: ["id", "title", "status"]
            }
          },
          zabbix_evidence: { type: "string" },
          correlation_level: {
            type: "string",
            enum: ["alta", "media", "baja", "sin_correlacion"]
          },
          user_impact: { type: "string" },
          technical_risk: { type: "string" },
          priority: { type: "string", enum: ["critica", "alta", "media", "baja"] },
          recommended_action: { type: "string" },
          task_type: {
            type: "string",
            enum: ["operativa", "codex_zabbix", "documentacion_inventario", "revision_humana"]
          }
        },
        required: [
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
        ]
      }
    },
    confirmed_impact: {
      type: "array",
      items: { type: "string" }
    },
    critical_without_ticket: {
      type: "array",
      items: { type: "string" }
    },
    tickets_without_zabbix_evidence: {
      type: "array",
      items: { type: "string" }
    },
    monitoring_gaps: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "title",
    "generated_at",
    "summary",
    "rows",
    "confirmed_impact",
    "critical_without_ticket",
    "tickets_without_zabbix_evidence",
    "monitoring_gaps"
  ]
};

export const criticalRisksSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    generated_at: { type: "string" },
    summary: { type: "string" },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_or_service: { type: "string" },
          source: { type: "string", enum: source },
          severity: { type: "string", enum: severity },
          evidence: { type: "string" },
          impact: { type: "string" },
          recommended_action: { type: "string" },
          requires_human_confirmation: { type: "boolean" }
        },
        required: [
          "asset_or_service",
          "source",
          "severity",
          "evidence",
          "impact",
          "recommended_action",
          "requires_human_confirmation"
        ]
      }
    },
    top_actions: {
      type: "array",
      items: actionSchema
    },
    missing_data: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["title", "generated_at", "summary", "risks", "top_actions", "missing_data"]
};

export const monitoringGapsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    generated_at: { type: "string" },
    summary: { type: "string" },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          block: { type: "string" },
          asset_or_service: { type: "string" },
          current_coverage: { type: "string" },
          missing_checks: {
            type: "array",
            items: { type: "string" }
          },
          priority: { type: "string", enum: severity },
          recommended_action: { type: "string" },
          can_automate: { type: "boolean" }
        },
        required: [
          "block",
          "asset_or_service",
          "current_coverage",
          "missing_checks",
          "priority",
          "recommended_action",
          "can_automate"
        ]
      }
    },
    top_actions: {
      type: "array",
      items: actionSchema
    },
    missing_data: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["title", "generated_at", "summary", "gaps", "top_actions", "missing_data"]
};

export const structuredReportDefinitions = {
  "daily-summary": {
    reportType: "daily_summary",
    title: "Informe diario estructurado",
    schemaName: "daily_summary",
    schema: dailySummarySchema,
    prompt:
      "Genera un informe diario operativo estructurado. Prioriza riesgos reales, impacto en usuarios, Zabbix, IncidenciasTI, backups, NAS, Proxmox, SAIs, red y huecos de monitorización."
  },
  "correlation-matrix": {
    reportType: "correlation_matrix",
    title: "Matriz estructurada Zabbix + IncidenciasTI",
    schemaName: "correlation_matrix",
    schema: correlationMatrixSchema,
    prompt:
      "Genera una matriz de correlación entre problemas Zabbix e incidencias IncidenciasTI. Incluye activos, problemas técnicos, incidencias relacionadas, impacto y acción recomendada."
  },
  "critical-risks": {
    reportType: "risks",
    title: "Riesgos críticos estructurados",
    schemaName: "critical_risks",
    schema: criticalRisksSchema,
    prompt:
      "Genera una lista estructurada de riesgos críticos de infraestructura. Prioriza pérdida de datos, backups, SMART, storage, NAS, Proxmox y problemas con impacto operativo."
  },
  "monitoring-gaps": {
    reportType: "monitoring_gaps",
    title: "Huecos de monitorización estructurados",
    schemaName: "monitoring_gaps",
    schema: monitoringGapsSchema,
    prompt:
      "Genera una lista estructurada de huecos de monitorización que impiden al agente razonar bien sobre la infraestructura."
  }
};
