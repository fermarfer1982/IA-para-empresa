# Modelo De Seguridad

## Principio Basico

El backend es read-only por diseno. Su funcion es consultar Zabbix y artefactos locales para informar a un agente inteligente, no aplicar cambios.

## Secretos

Los secretos se leen desde:

- `/etc/zabbix-codex/zabbix.env`
- `/etc/zabbix-codex/proxmox.env` solo para enmascarado preventivo de errores

No se guardan secretos en `/opt/zabbix-codex/mcp-infra-agent` y no se imprimen tokens completos.

## Zabbix API

Metodos permitidos:

- `apiinfo.version`
- `host.get`
- `item.get`
- `trigger.get`
- `problem.get`

Metodos prohibidos:

- `*.create`
- `*.update`
- `*.delete`
- `history.push`
- `problem.close`
- `problem.acknowledge`
- `action.*` de escritura
- cualquier metodo no listado explicitamente como permitido

`server.py` valida el metodo antes de llamar a Zabbix.

## Proxmox/PBS

Este backend no llama directamente a Proxmox ni PBS. Lee inventarios previamente generados:

- `/opt/zabbix-codex/proxmox/proxmox-real-inventory.json`
- `/opt/zabbix-codex/backups/pbs-real-inventory.json`

La integracion directa Proxmox/PBS queda fuera de este backend MCP inicial.

## SharePoint Y Bases De Datos

Las integraciones existen solo como placeholders documentados, no publicados en el registro público MCP/App:

- `sharepoint_search_assets`
- `sharepoint_get_asset`
- `apps_get_status`
- `apps_get_database_health`

Antes de activarlas hace falta:

- Credenciales read-only.
- Revision de permisos.
- Lista cerrada de consultas permitidas.
- Registro de auditoria.
- Politica de minimizacion de datos.

## Riesgos Residuales

- Los reportes locales podrian estar desactualizados si no se regeneran periodicamente.
- Zabbix puede contener datos incompletos si hay unsupported o hosts sin datos.
- El agente no debe convertir una recomendacion en cambio operativo sin confirmacion humana.

## Recomendacion De Despliegue

- Ejecutar el servidor MCP con un usuario sin privilegios administrativos.
- Restringir permisos de lectura a `/etc/zabbix-codex/zabbix.env`.
- No exponer el proceso MCP en red publica.
- Preferir stdio/local runner frente a HTTP hasta completar autenticacion, auditoria y control de acceso.

## Exposicion Remota

Para ChatGPT Apps/custom MCP:

- Usar HTTPS.
- Preferir OAuth/OIDC o Secure MCP Tunnel.
- Mantener el backend escuchando en `127.0.0.1` y publicar solo a traves de reverse proxy.
- No usar "No Authentication" salvo en pruebas con VPN/tunel/allowlist estricta.
- Revisar en ChatGPT que todas las tools son read-only antes de habilitarlas.
- No anadir herramientas de escritura al mismo servidor que usa el agente operativo.

## Autenticacion Temporal De Pruebas

`remote_server.py` soporta autenticacion temporal con:

```text
Authorization: Bearer <MCP_SHARED_TOKEN>
```

El token se define en:

```text
/etc/zabbix-codex/mcp-agent.env
```

Esto es solo para pruebas internas. Para produccion con ChatGPT se recomienda OAuth/OIDC, Secure MCP Tunnel o un proxy de acceso corporativo.

## Auditoria

Las llamadas remotas se registran en:

```text
/var/log/zabbix-codex/infra-agent-mcp.log
```

Campos registrados:

- timestamp
- origen
- metodo HTTP
- metodo MCP
- herramienta
- duracion
- exito/error
- codigo HTTP

No se registran cabeceras `Authorization`, tokens, passwords ni secretos.
