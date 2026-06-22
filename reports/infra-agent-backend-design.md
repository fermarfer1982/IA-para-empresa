# Diseno Backend MCP/API Read-only Para Agente De Infraestructura

## Resumen Ejecutivo

Se ha preparado un backend MCP inicial en `/opt/zabbix-codex/mcp-infra-agent` para que un agente de ChatGPT consulte el estado de la infraestructura usando Zabbix como fuente central de verdad.

El backend es read-only: consulta Zabbix API con metodos `.get`, lee artefactos locales ya generados y devuelve datos estructurados para razonamiento operativo. No modifica Zabbix, Proxmox, PBS, SharePoint ni bases de datos.

## Arquitectura Propuesta

```text
ChatGPT Agent/GPT
        |
        | MCP stdio
        v
/opt/zabbix-codex/mcp-infra-agent/server.py
        |
        | read-only
        +-- Zabbix API: apiinfo.version, host.get, item.get, trigger.get, problem.get
        +-- agent_knowledge/*.json
        +-- reports/*.json / reports/*.md
        +-- proxmox/proxmox-real-inventory.json
        +-- backups/pbs-real-inventory.json
```

## Herramientas Creadas/Diseñadas

| Herramienta | Uso | Datos principales |
| --- | --- | --- |
| `get_infrastructure_overview` | Vision global de infraestructura | Zabbix API, `global_infrastructure_map.json`, `monitoring_gaps.json` |
| `get_active_problems` | Problemas activos y contexto | Zabbix API `problem.get`, `trigger.get` |
| `get_critical_risks` | Riesgos prioritarios | Problemas High/Disaster, mapa global, PBS, gap analysis |
| `get_backup_status` | Estado backups/PBS | PBS inventory, gap analysis, knowledge, items tecnicos Zabbix |
| `get_proxmox_status` | Estado Proxmox/storage | Proxmox inventory, gap analysis, items tecnicos Zabbix |
| `get_nas_status` | NAS/QNAP/Synology | Mapa global, informe NAS, problemas activos |
| `get_ups_status` | SAIs/UPS | Mapa global, informe Eaton/UPS, problemas activos |
| `get_printer_status` | Impresoras | Mapa global, informe impresoras, problemas activos |
| `get_zabbix_internal_health` | Salud de Zabbix | Zabbix API, mapa global, informe interno |
| `get_monitoring_gaps` | Huecos y roadmap | `monitoring_gaps.json`, readiness, roadmap |
| `get_global_infrastructure_map` | Mapa estructurado completo | `global_infrastructure_map.json`, Zabbix API |
| `generate_daily_report` | Informe diario en Markdown | Composicion de herramientas read-only |

Placeholders preparados pero no integrados:

- `sharepoint_search_assets`
- `sharepoint_get_asset`
- `apps_get_status`
- `apps_get_database_health`

## Modelo De Seguridad

- No hay metodos de escritura en Zabbix.
- `server.py` bloquea cualquier metodo Zabbix no incluido en allowlist.
- No se imprimen tokens.
- No se llama directamente a Proxmox/PBS desde este backend.
- SharePoint y bases de datos quedan como placeholders hasta tener credenciales read-only y revision de seguridad.

## Conexion Con ChatGPT Agent/GPT

Configurar el servidor MCP local con:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --stdio
```

El GPT/Agent debe arrancar su analisis con:

1. `get_infrastructure_overview`
2. `get_active_problems`
3. `get_critical_risks`
4. Herramientas especificas por bloque segun el riesgo detectado.
5. `generate_daily_report` para salida ejecutiva.

## Proximos Pasos

1. Validar el servidor MCP desde un cliente MCP real.
2. Programar refresco periodico de artefactos `agent_knowledge`.
3. Definir politica de usuarios/permisos del agente.
4. Anadir auditoria de llamadas.
5. Integrar SharePoint en modo read-only.
6. Integrar aplicaciones y bases de datos con consultas permitidas.
7. Exponer HTTP solo si hay autenticacion, TLS y control de acceso.
