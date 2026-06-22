import { requestJson } from "../../../lib/httpJson";

const OPENAI_REALTIME_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "marin";
const DEFAULT_REALTIME_VOICES = ["marin", "cedar"];
const DEFAULT_RESPONSE_STYLE = "operativo";
const RESPONSE_STYLES = {
  operativo:
    "Estilo operativo: directo, orientado a acciones, prioriza impacto y siguiente paso.",
  ejecutivo:
    "Estilo ejecutivo: resume impacto, riesgos y decisiones; evita detalle tecnico salvo que sea necesario.",
  breve:
    "Estilo breve: responde en una o dos frases, solo con lo esencial.",
  tecnico:
    "Estilo tecnico: incluye evidencias, sistemas afectados y criterios de diagnostico sin alargarte."
};
const AVATAR_THEMES = ["default", "robot", "tecnico", "empresa"];

function configuredVoices() {
  const values = String(process.env.OPENAI_REALTIME_VOICES || "")
    .split(",")
    .map((voice) => voice.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_REALTIME_VOICES, ...values]));
}

function sanitizeIdentifier(value, fallback, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  if (allowedValues.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function sanitizeAvatarName(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .trim()
    .slice(0, 40);
}

function buildInstructions(style, avatarTheme, avatarName) {
  const styleInstruction = RESPONSE_STYLES[style] || RESPONSE_STYLES[DEFAULT_RESPONSE_STYLE];
  const nameInstruction = avatarName
    ? `El avatar puede presentarse como "${avatarName}".`
    : "No inventes un nombre propio para el avatar.";
  const themeInstruction = `Tema visual configurado: ${avatarTheme}. Esto solo afecta a la presentación visual, no a los datos ni permisos.`;
  return `${REALTIME_INSTRUCTIONS}\n\n${styleInstruction}\n${nameInstruction}\n${themeInstruction}\nLa voz es generada por IA. No imites a personas reales.`;
}

const REALTIME_INSTRUCTIONS = `Eres la voz del Agente Inteligente de Infraestructura. Responde de forma breve, operativa y clara. Usa solo las herramientas internas del backend; nunca llames directamente a Zabbix, SharePoint ni MCPs.

Mapeo de intenciones:
- "Dame incidencias abiertas", "qué tickets están abiertos" -> voice_open_incidents.
- "Qué incidencias están en curso", "qué tiene pendiente soporte" -> voice_incidents_in_progress.
- "Qué riesgos críticos hay", "qué es crítico ahora" -> voice_critical_risks.
- "Cómo están los NAS", "cómo están los backups", "hay riesgo de pérdida de datos" -> voice_storage_backup_status.
- "Qué huecos de monitorización tenemos", "qué falta monitorizar" -> voice_monitoring_gaps.
- "Qué hacemos hoy", "dame acciones recomendadas", "qué priorizamos esta mañana" -> voice_today_actions.
- "Busca incidencias de impresoras", "qué pasa con Seedtek", "qué sabes de NasAlmeria" -> voice_search con q.
- "Busca el correo de Fernando.", "Busca destinatarios de dirección.", "Busca usuarios del departamento de informática." -> voice_directory_search con q.
- Si el usuario quiere redactar un borrador para una persona concreta, busca primero en la libreta si necesitas resolver el destinatario.
- "Última incidencia", "último ticket", "incidencia más reciente", "última incidencia de usuario", "última incidencia TI", "última incidencia modificada", "último problema", "alertas activas", "problemas activos", "problemas Zabbix", "monitorización", "host caído", "latencia", "disco", "NAS", "backup", "UPS/SAI", "qué es lo más urgente", "resumen operativo", "estado general", "riesgos críticos", "cruza Zabbix e IncidenciasTI", "relaciona incidencias con problemas técnicos", "busca si esta incidencia puede estar relacionada con Zabbix", "prepara email al creador", "prepara un email al creador de esta incidencia", "prepara correo al creador", "envía directamente un correo al creador", "manda directamente el email al creador", "envíalo ya sin revisar", "manda el correo directamente" -> voice_ops_query con question.
- "Firewalls", "firewalls", "estado de los firewalls", "qué firewalls tenemos", "que firewalls tenemos", "pfSense", "firewall de Almería", "firewall de La Plana", "firewall de Gallarza", "red perimetral" -> voice_ops_query con question.
- "Genera el informe de hoy" -> voice_run_daily_report.
- "Enséñame el informe de hoy", "muéstrame el informe de hoy" -> voice_today_report.
- "Muéstrame la última matriz", "enséñame la matriz" -> voice_latest_matrix.
- "Enséñame el gráfico de incidencias", "muéstrame incidencias por estado" -> voice_show_incident_chart.
- "Enséñame riesgos por prioridad", "muéstrame el gráfico de riesgos" -> voice_analytics_summary.
- "Dame el briefing de mañana", "hazme el resumen de hoy", "qué tengo que revisar primero" -> voice_morning_briefing.
- "Muéstrame el análisis", "compara hoy con ayer", "qué ha cambiado desde el último informe", "enséñame evolución de huecos" -> voice_analytics_summary.
- "Prepara el informe ejecutivo" -> voice_prepare_executive_report. No descargues nada automaticamente.
- "Prepara el informe técnico" -> voice_prepare_technical_report. No descargues nada automaticamente.
- "Prepara el informe operativo" -> voice_prepare_operational_report. No descargues nada automaticamente.
- "Prepara la matriz para exportar" -> voice_prepare_matrix_export. No descargues nada automaticamente.
- Consultas Power BI soportadas por voz: "Cuánto hemos vendido", "Cuánto hemos vendido este año en enero", "Ventas este mes", "Ventas año pasado", "Total de ventas", "Cuántas unidades hemos vendido", "Cuántas unidades hemos vendido en enero", "Total de unidades", "Ventas por cliente", "Ventas por artículo en marzo", "Ventas por familia", "Ventas por representante", "Ventas por tipo", "Ventas por especie", "Top 10 clientes por ventas este año", "Top 10 productos por ventas", "Unidades por producto", "Ventas por mes", "Unidades por mes" y "Ventas este mes vs mes pasado". -> voice_powerbi_query con question.
- Si una consulta encaja con Power BI y es segura, usa voice_powerbi_query con una pregunta natural breve. Nunca inventes DAX libre.
- Cuando una consulta Power BI sea de tabla, responde con un resumen breve y di que el detalle ya está en pantalla. No leas toda la tabla por voz.
- "Prepara un correo para dirección con el informe ejecutivo." -> voice_prepare_communication_draft con template_id ejecutivo_direccion y los argumentos necesarios; crea solo el borrador y no envía nada.
- "Prepara correo para Fernando", "manda un correo a Fernando", "dile a Fernando que mañana Moisés traerá el almuerzo", "avisa a Fernando de que..." -> voice_prepare_communication_draft. Pon el nombre detectado en recipient_label o recipient_query y el mensaje en message. El servidor resolverá el email en la libreta corporativa; no inventes destinatarios.
- "Prepara un aviso técnico para sistemas sobre los riesgos críticos." -> voice_prepare_communication_draft con template_id aviso_riesgo_critico o tecnico_sistemas, según el contexto; crea solo el borrador y no envía nada.
- "Prepara un mensaje para el usuario final sobre la incidencia X." -> voice_prepare_communication_draft con template_id usuario_final; crea solo el borrador y no envía nada.
- "Prepara un correo para proveedor sobre NasAlmeria." -> voice_prepare_communication_draft con template_id proveedor; crea solo el borrador y no envía nada.
- "Prepara un seguimiento de incidencia." -> voice_prepare_communication_draft con template_id seguimiento_incidencia; crea solo el borrador y no envía nada. Si el usuario dice "al creador", "envía directamente" o pide el email del creador, usa voice_ops_query; nunca voice_prepare_communication_draft.
- "Prepara el envío del correo." -> voice_prepare_email_send; abre la confirmación visual de un borrador email revisado y no envía nada.
- Después de crear un borrador por voz, pregunta si quiere enviarlo directamente o revisarlo antes. Para respuestas como "revisarlo", "editar antes", "abrirlo", "no enviarlo todavía", "enviarlo directamente", "mándalo", "envíalo", "enviar ahora", "confirmo el envío", "sí confirmo", "cancela", "mejor no" -> voice_communication_draft_decision con action adecuada.
- Si el usuario dice "envíalo", "mandalo" o similar sin una confirmación explícita, nunca envíes inmediatamente. Primero usa voice_communication_draft_decision con action request_direct_send para pedir confirmación final. Solo action confirm_direct_send puede enviar, y únicamente si la frase incluye "confirmo" o "confirmo el envío".
- Para confirmación final de envío, "sí", "vale" u "ok" no son suficientes. Si el usuario no dice "confirmo", usa action cancel o pide confirmación clara, pero no confirm_direct_send.
- "Marca este borrador como revisado" -> voice_manage_communication_drafts con action mark_selected_reviewed; solo cambia estado local.
- "Muéstrame borradores pendientes" -> voice_manage_communication_drafts con action show_pending; solo filtra la vista local.
- "Descarta el último borrador" -> voice_manage_communication_drafts con action discard_latest; solo cambia estado local.
- "Qué borradores están listos para revisión" -> voice_manage_communication_drafts con action show_ready; solo filtra la vista local.
- "Qué informe le paso a dirección" -> voice_report_direction.
- "Qué informe uso para sistemas" -> voice_report_systems.
- "Dónde descargo el informe", "donde estan las descargas" -> voice_export_help.
- Para preguntas generales sobre estado actual o urgencias -> get_dashboard_latest.
- Si el usuario pide actualizar o refrescar el panel -> refresh_dashboard.

No modifiques sistemas. No cierres incidencias. No cambies Zabbix. Si algo requiere acción humana, dilo claramente.`;

const VOICE_TOOLS = [
  {
    type: "function",
    name: "get_dashboard_latest",
    description:
      "Consulta el estado actual del dashboard interno desde informes estructurados ya guardados. Úsalo solo para consultas generales del dashboard; para IncidenciasTI y Zabbix separados usa voice_ops_query.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "refresh_dashboard",
    description:
      "Actualiza el dashboard generando informe diario, matriz de correlación, riesgos críticos y huecos de monitorización. Úsalo solo cuando el usuario pida actualizar o refrescar el dashboard.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "generate_daily_summary",
    description: "Genera un informe diario estructurado y lo guarda en SQLite.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "generate_correlation_matrix",
    description: "Genera una matriz de correlación estructurada entre Zabbix e IncidenciasTI.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "generate_critical_risks",
    description: "Genera un informe estructurado de riesgos críticos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "generate_monitoring_gaps",
    description: "Genera un informe estructurado de huecos de monitorización.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_open_incidents",
    description:
      "Obtiene incidencias abiertas desde los informes estructurados internos. Úsalo para preguntas sobre incidencias o tickets abiertos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_incidents_in_progress",
    description:
      "Obtiene incidencias en curso desde los informes estructurados internos. Úsalo para preguntas sobre soporte pendiente o incidencias en curso.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_critical_risks",
    description:
      "Obtiene riesgos críticos desde dashboard e informes estructurados. Úsalo para preguntas como qué es crítico ahora.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_storage_backup_status",
    description:
      "Obtiene estado resumido de NAS, storage, backups y riesgo de pérdida de datos desde informes estructurados internos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_monitoring_gaps",
    description:
      "Obtiene huecos de monitorización desde informes estructurados internos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_today_actions",
    description:
      "Obtiene acciones recomendadas para hoy desde dashboard e informes estructurados internos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_run_daily_report",
    description:
      "Genera el informe diario completo usando endpoints internos: resumen diario, matriz de correlación, riesgos críticos y huecos. Guarda los informes en SQLite.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_today_report",
    description:
      "Consulta el último informe diario guardado y si corresponde a hoy. No genera informes nuevos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_latest_matrix",
    description:
      "Consulta la última matriz de correlación guardada desde informes estructurados internos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_show_incident_chart",
    description:
      "Prepara la vista visual de matriz/graficos para mostrar incidencias por estado desde los informes estructurados internos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_show_risk_chart",
    description:
      "Prepara la vista visual de matriz/graficos para mostrar riesgos por prioridad desde los informes estructurados internos.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_morning_briefing",
    description:
      "Obtiene un briefing operativo breve desde dashboard, informe de hoy, matriz, riesgos, incidencias y huecos guardados internamente.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_search",
    description:
      "Busca un activo, sistema o término en los informes estructurados internos. Úsalo para preguntas como impresoras, Seedtek o NasAlmeria.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Término de búsqueda, por ejemplo impresoras, Seedtek o NasAlmeria."
        }
      },
      required: ["q"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_directory_search",
    description:
      "Busca usuarios corporativos activos en la libreta read-only. Úsalo para nombres, departamentos, puestos o correos. No envía nada ni modifica la libreta.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Texto a buscar, por ejemplo Fernando, dirección o informática."
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10
        }
      },
      required: ["q"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_analytics_summary",
    description:
      "Obtiene análisis visual avanzado, comparativa hoy vs informe anterior, evolución y gráficos desde SQLite interno.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_analytics_reports",
    description:
      "Obtiene resumen ligero de informes de los últimos 7 días desde SQLite interno.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_prepare_executive_report",
    description:
      "Prepara la interfaz para descargar manualmente el informe ejecutivo. No inicia descargas, no envia correos y no modifica sistemas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_prepare_technical_report",
    description:
      "Prepara la interfaz para descargar manualmente el informe tecnico. No inicia descargas, no envia correos y no modifica sistemas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_prepare_operational_report",
    description:
      "Prepara la interfaz para descargar manualmente el informe operativo diario. No inicia descargas, no envia correos y no modifica sistemas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_prepare_matrix_export",
    description:
      "Prepara la vista Matriz para que la persona descargue CSV, HTML, Markdown o JSON manualmente. No inicia descargas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_powerbi_query",
    description:
      "Ejecuta una consulta Power BI controlada sobre administracion_ventas usando el router seguro y capabilities existentes. No permite DAX libre ni consultas fuera del catálogo soportado.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Pregunta natural sobre ventas o unidades, por ejemplo cuánto hemos vendido este año, ventas por cliente o unidades este mes."
        }
      },
      required: ["question"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_ops_query",
    description:
      "Ejecuta una consulta operativa controlada sobre IncidenciasTI y/o Zabbix sin mezclar causas. Puede devolver última incidencia, último problema Zabbix, resumen separado o posible correlación con evidencia.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Pregunta natural sobre IncidenciasTI o Zabbix, por ejemplo última incidencia, último problema Zabbix o qué es lo más urgente."
        }
      },
      required: ["question"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_prepare_communication_draft",
    description:
      "Prepara un borrador de comunicación local para email o Teams a partir de informes, riesgos o incidencias. No envía nada y solo devuelve un borrador revisable. No uses esta herramienta para correos al creador de una incidencia; para ese caso usa voice_ops_query.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["email", "teams"]
        },
        intent: {
          type: "string"
        },
        recipient_label: {
          type: "string"
        },
        recipient_email: {
          type: "string"
        },
        source_type: {
          type: "string",
          enum: ["daily_report", "matrix", "incident", "risk", "manual"]
        },
        source_report_id: {
          type: "string"
        },
        source_incident_id: {
          type: "string"
        },
        subject: {
          type: "string"
        },
        message: {
          type: "string"
        },
        recipient_query: {
          type: "string"
        },
        requestedRecipientName: {
          type: "string"
        },
        template_id: {
          type: "string"
        },
        custom_context: {
          type: "object",
          additionalProperties: true
        }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_prepare_email_send",
    description:
      "Abre la confirmación visual del envío de un borrador de correo revisado. No envía nada y solo lleva a la vista de comunicaciones.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_communication_draft_decision",
    description:
      "Gestiona la decisión oral posterior a crear un borrador de comunicación: revisarlo, solicitar envío directo, confirmar envío directo o cancelar. Solo confirma envío si el usuario dice explícitamente confirmo.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["review", "request_direct_send", "confirm_direct_send", "cancel"]
        },
        transcript: {
          type: "string"
        }
      },
      required: ["action", "transcript"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_manage_communication_drafts",
    description:
      "Gestiona borradores de comunicación locales para mostrar pendientes, listar listos para revisión o marcar el borrador seleccionado como revisado. No envía nada.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "show_pending",
            "show_ready",
            "mark_selected_reviewed",
            "mark_selected_ready",
            "discard_latest",
            "mark_selected_copied"
          ]
        },
        intent: {
          type: "string"
        },
        note: {
          type: "string"
        }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_report_direction",
    description:
      "Prepara la interfaz y explica qué informe conviene pasar a dirección. No inicia descargas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_report_systems",
    description:
      "Prepara la interfaz y explica qué informe conviene usar para sistemas. No inicia descargas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "voice_export_help",
    description:
      "Explica donde estan los botones de descarga de informe, matriz, analisis e historico. No inicia descargas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export default async function handler(req, res) {
  const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const defaultVoice = String(process.env.OPENAI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE)
    .trim()
    .toLowerCase();
  const voices = configuredVoices();
  const safeDefaultVoice = voices.includes(defaultVoice) ? defaultVoice : voices[0];

  if (req.method === "GET") {
    return res.status(200).json({
      model,
      default_voice: safeDefaultVoice,
      voices,
      response_styles: Object.keys(RESPONSE_STYLES),
      default_response_style: DEFAULT_RESPONSE_STYLE,
      avatar_themes: AVATAR_THEMES,
      default_avatar_theme: "default"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const requestedVoice = req.body?.voice;
  const requestedStyle = req.body?.response_style;
  const requestedAvatarTheme = req.body?.avatar_theme;
  const voice = sanitizeIdentifier(requestedVoice, safeDefaultVoice, voices);
  const responseStyle = sanitizeIdentifier(
    requestedStyle,
    DEFAULT_RESPONSE_STYLE,
    Object.keys(RESPONSE_STYLES)
  );
  const avatarTheme = sanitizeIdentifier(requestedAvatarTheme, "default", AVATAR_THEMES);
  const avatarName = sanitizeAvatarName(req.body?.avatar_name);

  if (!apiKey) {
    return res.status(500).json({
      error: "Falta OPENAI_API_KEY en el backend."
    });
  }

  try {
    const openaiResponse = await requestJson(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      timeoutMs: 30000,
      body: {
        expires_after: {
          anchor: "created_at",
          seconds: 600
        },
        session: {
          type: "realtime",
          model,
          instructions: buildInstructions(responseStyle, avatarTheme, avatarName),
          tools: VOICE_TOOLS,
          tool_choice: "auto",
          audio: {
            output: {
              voice
            }
          }
        }
      }
    });

    if (openaiResponse.statusCode < 200 || openaiResponse.statusCode >= 300) {
      const requestId =
        openaiResponse.body?.request_id || openaiResponse.body?.error?.request_id;
      return res.status(502).json({
        error: "OpenAI no pudo crear la sesión Realtime.",
        request_id: requestId || undefined
      });
    }

    const clientSecret =
      openaiResponse.body?.value || openaiResponse.body?.client_secret?.value;
    const expiresAt =
      openaiResponse.body?.expires_at || openaiResponse.body?.client_secret?.expires_at;

    if (!clientSecret) {
      return res.status(502).json({
        error: "OpenAI no devolvió client secret efímero para Realtime."
      });
    }

    return res.status(200).json({
      client_secret: clientSecret,
      expires_at: expiresAt || null,
      model,
      voice,
      response_style: responseStyle,
      avatar_theme: avatarTheme,
      avatar_name: avatarName || null,
      available_voices: voices
    });
  } catch (error) {
    return res.status(502).json({
      error: error?.message || "Error conectando con OpenAI Realtime."
    });
  }
}
