# MCP Infra Agent Backend

Backend read-only para que un agente de ChatGPT consulte el estado de la infraestructura usando Zabbix como fuente central de verdad.

Este directorio no configura Zabbix, Proxmox, PBS, SharePoint ni bases de datos. Solo define herramientas de consulta, documentacion y un servidor MCP minimo por stdio.

## Componentes

- `server.py`: servidor MCP/JSON-RPC por stdio y CLI local de pruebas.
- `remote_server.py`: wrapper HTTP read-only con `/mcp`, `/healthz` y metadata para despliegue interno o reverse proxy.
- `tools.yaml`: contrato de herramientas, fuentes de datos y garantias read-only.
- `docs/agent_instructions.md`: instrucciones operativas para el agente.
- `docs/security_model.md`: modelo de seguridad.
- `docs/chatgpt_agent_setup.md`: guia de conexion con ChatGPT Agent/GPT.
- `docs/agent_builder_prompt.md`: prompt final para pegar en el agente de ChatGPT.
- `deploy/`: ejemplos de systemd y Nginx.

## Fuentes De Datos

- Zabbix API desde `/etc/zabbix-codex/zabbix.env`.
- `agent_knowledge/global_infrastructure_map.json`.
- `agent_knowledge/monitoring_gaps.json`.
- `agent_knowledge/proxmox_backup_knowledge.json`.
- `reports/zabbix-coverage-report.json`.
- `reports/zabbix-remediation-plan.json`.
- `reports/unsupported-blocks-summary.json`.
- `reports/proxmox-backup-gap-analysis.json`.
- `proxmox/proxmox-real-inventory.json`.
- `backups/pbs-real-inventory.json`.

## Herramientas Principales

- `get_infrastructure_overview`
- `get_active_problems`
- `get_critical_risks`
- `get_backup_status`
- `get_proxmox_status`
- `get_nas_status`
- `get_ups_status`
- `get_printer_status`
- `get_zabbix_internal_health`
- `get_monitoring_gaps`
- `get_global_infrastructure_map`
- `generate_daily_report`

Placeholders documentados pero no publicados en el MCP/App:

- `sharepoint_search_assets`
- `sharepoint_get_asset`
- `apps_get_status`
- `apps_get_database_health`

El registro público de herramientas para ChatGPT contiene solo las 12 herramientas de consulta anteriores, todas con `annotations.readOnlyHint: true`.

## Uso Local

Listar herramientas:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --list-tools
```

Probar resumen:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --call get_infrastructure_overview
```

Ejecutar MCP por stdio:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --stdio
```

Ejecutar wrapper HTTP interno con configuracion de `/etc/zabbix-codex/mcp-agent.env`:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/remote_server.py
```

Probar healthcheck:

```bash
curl -sS http://127.0.0.1:8765/healthz \
  -H 'Authorization: Bearer CAMBIAR'
```

Probar tools/list por HTTP:

```bash
curl -sS http://127.0.0.1:8765/mcp \
  -H 'Authorization: Bearer CAMBIAR' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Auditoria:

```text
/var/log/zabbix-codex/infra-agent-mcp.log
```

## ChatGPT Apps / Custom MCP

Para ChatGPT web, la documentacion actual requiere MCP remoto por SSE o streaming HTTP sobre HTTPS. El wrapper `remote_server.py` proporciona un endpoint HTTP MCP basico para pruebas internas; antes de exponerlo a ChatGPT hay que poner HTTPS y autenticacion delante, y validar con un cliente MCP remoto real.

Para datos internos, la opcion recomendada es:

1. Ejecutar en localhost.
2. Publicar mediante reverse proxy con TLS.
3. Proteger con OAuth/OIDC, VPN, allowlist o Secure MCP Tunnel.
4. Crear la app en ChatGPT Developer mode.
5. Refrescar herramientas y habilitar solo las read-only.

## Garantias Read-only

El servidor bloquea cualquier metodo Zabbix que no este en la lista permitida:

- `apiinfo.version`
- `host.get`
- `item.get`
- `trigger.get`
- `problem.get`

No usa `history.push`, no cierra problemas, no reconoce eventos, no crea/modifica/borra objetos y no imprime tokens.
