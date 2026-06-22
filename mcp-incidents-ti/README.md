# MCP IncidenciasTI

Backend MCP read-only para consultar la lista Microsoft Lists/SharePoint `IncidenciasTI` mediante Microsoft Graph.

## Objetivo

Permitir que el Agente Inteligente de Infraestructura cruce:

- Estado tecnico real desde el MCP de Zabbix.
- Incidencias reportadas por usuarios desde SharePoint/Microsoft Lists.
- Documentacion e inventario cuando existan otros conectores read-only.

Este MCP no crea, modifica, comenta, asigna, cierra ni borra incidencias.

## Lista objetivo

- Host: `ramiroarnedo.sharepoint.com`
- Site path: `/Departamento de Informática`
- Site ID: `ramiroarnedo.sharepoint.com,e3fa6571-ed97-4b39-8d78-a4e498324ca6,ddd6e648-3399-4ed4-879e-0c99a63c88f1`
- List name: `IncidenciasTI`
- List path: `Lists/IncidenciasTI`

## Seguridad

- Todas las tools publicadas declaran `annotations: {"readOnlyHint": true}`.
- El codigo solo usa metodos GET contra Microsoft Graph.
- Cualquier metodo Graph distinto de GET queda bloqueado antes de llamar a Graph.
- No hay tools para operaciones create/update/delete ni para cerrar/asignar/comentar incidencias.
- El servidor remoto exige `Authorization: Bearer <MCP_SHARED_TOKEN>`.
- Los secretos se leen desde `/etc/zabbix-codex` y no se guardan en el repositorio.

## Herramientas

- `get_incidents_schema`
- `get_incidents_summary`
- `get_open_incidents`
- `get_incidents_by_status`
- `get_recent_incidents`
- `get_incident_by_id`
- `search_incidents`
- `get_incidents_related_to_asset`

## Configuracion

Copiar los ejemplos desde `deploy/`:

```bash
sudo install -m 0640 -o codexops -g codexops deploy/sharepoint-incidents.env.example /etc/zabbix-codex/sharepoint-incidents.env
sudo install -m 0640 -o codexops -g codexops deploy/incidents-ti-mcp.env.example /etc/zabbix-codex/incidents-ti-mcp.env
```

Rellenar solo en `/etc/zabbix-codex/sharepoint-incidents.env`:

- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`

Permisos recomendados en Microsoft Entra/Graph:

- Preferente: `Sites.Selected` con permiso read concedido solo al site de Informatica.
- Alternativa temporal: permiso de lectura de Sites/Lists con el menor alcance que permita el tenant.
- No conceder `Sites.ReadWrite.All`.

## Validacion local

```bash
python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py
python3 mcp-incidents-ti/server.py --self-test
python3 mcp-incidents-ti/server.py --test-block-write
python3 mcp-incidents-ti/server.py --list-tools
python3 mcp-incidents-ti/server.py --call get_incidents_schema
```

Sin credenciales Graph configuradas, las tools devuelven un error estructurado `graph_available=false` sin imprimir secretos.

## Ejecucion stdio

```bash
python3 /opt/zabbix-codex/mcp-incidents-ti/server.py --stdio
```

## Ejecucion HTTP local

```bash
python3 /opt/zabbix-codex/mcp-incidents-ti/remote_server.py
```

Endpoint por defecto: `http://127.0.0.1:8766/mcp`.

## Logs

Auditoria:

```text
/var/log/zabbix-codex/incidents-ti-mcp.log
```

El log registra herramienta, timestamp, duracion, exito/error y bloqueos defensivos. No registra tokens.
