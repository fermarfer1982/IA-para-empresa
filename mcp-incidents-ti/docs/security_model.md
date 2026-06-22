# Modelo de seguridad - MCP IncidenciasTI

## Principio operativo

El MCP IncidenciasTI es estrictamente de consulta. Su unica funcion es leer incidencias de la lista SharePoint/Microsoft Lists `IncidenciasTI` mediante Microsoft Graph y devolverlas al agente.

## Garantias read-only

- Todas las tools publicadas incluyen `annotations: {"readOnlyHint": true}`.
- El registro publico contiene solo tools `get`, `search` y `list`.
- No existen tools para crear, editar, cerrar, comentar, asignar, cambiar estado ni borrar incidencias.
- Todas las llamadas a Microsoft Graph pasan por `GraphClient.graph_request`.
- `GraphClient.graph_request` solo permite `GET`.
- `POST`, `PUT`, `PATCH` y `DELETE` se bloquean antes de llamar a Graph y se auditan.

Nota: la obtencion de token OAuth2 con client credentials usa `POST` contra `login.microsoftonline.com`. Esto no es una llamada a Microsoft Graph ni modifica SharePoint. Las llamadas a Graph siguen siendo exclusivamente `GET`.

## Autenticacion del MCP

El endpoint HTTP remoto exige:

```text
Authorization: Bearer <MCP_SHARED_TOKEN>
```

Configuracion:

```text
/etc/zabbix-codex/incidents-ti-mcp.env
```

Esta autenticacion por bearer compartido es adecuada solo para pruebas internas controladas. Para produccion se recomienda:

- OAuth/OIDC delante del reverse proxy.
- Secure MCP Tunnel.
- Allowlist de origen si el entorno lo permite.
- Rotacion periodica del token compartido.

## Credenciales Microsoft Graph

Configuracion:

```text
/etc/zabbix-codex/sharepoint-incidents.env
```

Permisos recomendados:

- `Sites.Selected` como permiso de aplicacion.
- Concesion read solo al site `Departamento de Informática`.
- Evitar `Sites.ReadWrite.All` y cualquier permiso de escritura.

El secreto de aplicacion o access token no debe guardarse en `/opt/zabbix-codex`.

## Auditoria

Log:

```text
/var/log/zabbix-codex/incidents-ti-mcp.log
```

Registra:

- timestamp,
- herramienta llamada,
- duracion,
- exito/error,
- llamadas Graph GET,
- intentos bloqueados por metodo no permitido.

No registra:

- tokens Graph,
- `MCP_SHARED_TOKEN`,
- `GRAPH_CLIENT_SECRET`.

## Operaciones prohibidas

El conector no debe exponer ni ejecutar:

- `POST`, `PUT`, `PATCH`, `DELETE` contra Graph,
- creacion/modificacion/borrado de elementos,
- cierre o cambio de estado de incidencias,
- asignacion de tecnicos,
- comentarios o actualizaciones,
- cambios en permisos,
- cambios en SharePoint, Zabbix, Proxmox/PBS o bases de datos.
