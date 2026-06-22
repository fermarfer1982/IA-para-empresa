# MCP/App read-only IncidenciasTI

Fecha: 2026-05-21 17:25 CEST

## Resumen ejecutivo

Se ha creado un segundo MCP/App independiente para consultar la lista SharePoint/Microsoft Lists `IncidenciasTI` mediante Microsoft Graph.

El conector es read-only por diseno:

- Publica solo 8 tools de consulta.
- Todas las tools declaran `annotations: {"readOnlyHint": true}`.
- No publica tools para crear, editar, cerrar, asignar, comentar, cambiar estado ni borrar incidencias.
- Las llamadas a Microsoft Graph estan centralizadas y solo permiten `GET`.
- `POST`, `PUT`, `PATCH` y `DELETE` contra Graph quedan bloqueados antes de ejecutar la llamada y se auditan.
- El endpoint remoto exige autenticacion bearer.

No se ha modificado SharePoint.

## Lista objetivo

- Hostname: `ramiroarnedo.sharepoint.com`
- Site path: `/Departamento de Informática`
- Site ID: `ramiroarnedo.sharepoint.com,e3fa6571-ed97-4b39-8d78-a4e498324ca6,ddd6e648-3399-4ed4-879e-0c99a63c88f1`
- List name: `IncidenciasTI`
- List path: `Lists/IncidenciasTI`

## Herramientas publicadas

- `get_incidents_schema`
- `get_incidents_summary`
- `get_open_incidents`
- `get_incidents_by_status`
- `get_recent_incidents`
- `get_incident_by_id`
- `search_incidents`
- `get_incidents_related_to_asset`

Todas son de consulta y tienen `readOnlyHint=true`.

## Datos que devuelve

Cuando existan columnas equivalentes en SharePoint, el MCP normaliza:

- `id`
- `title/asunto`
- `description/descripción`
- `status/estado`
- `created`
- `modified`
- `requester/solicitante`
- `assigned_to/técnico`
- `priority/prioridad`
- `category/categoría`
- `affected_system/sistema afectado`
- `comments/evolución`
- `url`

La tool `get_incidents_schema` permite descubrir el esquema real y ajustar el mapeo si SharePoint usa nombres internos no evidentes.

## Configuracion creada

Ficheros de proyecto:

- `/opt/zabbix-codex/mcp-incidents-ti/server.py`
- `/opt/zabbix-codex/mcp-incidents-ti/remote_server.py`
- `/opt/zabbix-codex/mcp-incidents-ti/tools.yaml`
- `/opt/zabbix-codex/mcp-incidents-ti/README.md`
- `/opt/zabbix-codex/mcp-incidents-ti/docs/security_model.md`
- `/opt/zabbix-codex/mcp-incidents-ti/docs/chatgpt_agent_setup.md`
- `/opt/zabbix-codex/mcp-incidents-ti/docs/chatgpt_developer_mode_test_plan.md`
- `/opt/zabbix-codex/mcp-incidents-ti/docs/agent_instructions.md`
- `/opt/zabbix-codex/mcp-incidents-ti/deploy/sharepoint-incidents.env.example`
- `/opt/zabbix-codex/mcp-incidents-ti/deploy/incidents-ti-mcp.env.example`
- `/opt/zabbix-codex/mcp-incidents-ti/deploy/sharepoint-incidents-ti-mcp.service.example`
- `/opt/zabbix-codex/mcp-incidents-ti/deploy/nginx-sharepoint-incidents-ti.conf.example`

Ficheros runtime:

- `/etc/zabbix-codex/sharepoint-incidents.env`
- `/etc/zabbix-codex/incidents-ti-mcp.env`
- `/var/log/zabbix-codex/incidents-ti-mcp.log`

`sharepoint-incidents.env` contiene los datos no secretos del site/list y placeholders para Graph. Aun faltan credenciales reales read-only de Microsoft Graph.

## Autenticacion

El wrapper remoto usa:

```text
Authorization: Bearer <MCP_SHARED_TOKEN>
```

Se genero un token local en `/etc/zabbix-codex/incidents-ti-mcp.env` sin imprimirlo.

Para produccion se recomienda sustituir este bearer temporal por OAuth/OIDC o Secure MCP Tunnel.

## Permisos Graph recomendados

Recomendado:

- App registration con permiso de aplicacion `Sites.Selected`.
- Concesion read al site `Departamento de Informática`.
- Sin permisos de escritura.

Evitar:

- `Sites.ReadWrite.All`
- permisos para modificar listas o elementos.

## Validaciones realizadas

- `python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py`: OK.
- `python3 mcp-incidents-ti/server.py --self-test`: OK, 8 tools, todas read-only.
- `python3 mcp-incidents-ti/server.py --list-tools`: OK.
- `python3 mcp-incidents-ti/server.py --test-block-write`: `blocked_ok`.
- `/healthz` sin autenticacion: `401`.
- `/healthz` con autenticacion: `200`.
- `/mcp tools/list` con autenticacion: `200`, 8 tools, todas `readOnlyHint=true`.
- Tool inexistente `create_incident`: rechazada como `Unknown tool`.
- `get_open_incidents`, `search_incidents`, `get_incident_by_id` y `get_incidents_related_to_asset`: fallan de forma segura por falta de credenciales Graph y devuelven `graph_available=false`.
- Escaneo de secretos en el repo: sin hits del token MCP generado.

## Limitacion actual

No hay credenciales Graph reales configuradas todavia:

- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`

Por eso no se pudo validar en vivo:

- `get_incidents_schema`
- `get_incidents_summary`
- `get_open_incidents`
- `get_incident_by_id` con ID real
- `search_incidents`

Las tools fallan de forma segura con `graph_available=false` y no imprimen secretos.

## Como conectarlo a ChatGPT

1. Configurar credenciales Graph read-only en `/etc/zabbix-codex/sharepoint-incidents.env`.
2. Arrancar el MCP remoto en `127.0.0.1:8766` o detras de HTTPS.
3. Exponerlo mediante reverse proxy HTTPS o tunnel seguro.
4. En ChatGPT Workspace / Apps / Create, crear custom MCP app apuntando a `/mcp`.
5. Configurar autenticacion bearer temporal u OAuth/OIDC.
6. Escanear tools y verificar que solo aparecen las 8 tools read-only.
7. Anadirlo al agente junto al MCP de Zabbix.

## Proximos pasos

1. Crear app registration de Microsoft Graph con permisos minimos read-only.
2. Rellenar `/etc/zabbix-codex/sharepoint-incidents.env`.
3. Ejecutar `get_incidents_schema` para descubrir nombres internos reales.
4. Ajustar mapeo de columnas si la lista usa nombres internos no reconocidos.
5. Validar resumen, abiertas, busqueda y detalle por ID real.
6. Publicar el endpoint mediante HTTPS autenticado para ChatGPT Developer Mode.

## Validacion real Graph - 2026-05-21 18:15 CEST

Estado:

- `/etc/zabbix-codex/sharepoint-incidents.env`: existe, propietario `codexops:codexops`, permisos `600`.
- Variables obligatorias presentes sin imprimir secretos:
  - `GRAPH_TENANT_ID`
  - `GRAPH_CLIENT_ID`
  - `GRAPH_CLIENT_SECRET`
  - `SHAREPOINT_HOSTNAME`
  - `SHAREPOINT_SITE_PATH`
  - `SHAREPOINT_SITE_ID`
  - `SHAREPOINT_LIST_NAME`
- Autenticacion Microsoft Graph con client credentials: OK.
- Acceso read-only a lista `IncidenciasTI`: OK.
- `list_id`: `b4972fd0-8714-4cf1-bbb2-62b9809a6414`.
- `webUrl`: `https://ramiroarnedo.sharepoint.com/Departamento%20de%20Inform%C3%A1tica/Lists/IncidenciasTI`.
- Columnas detectadas: 93.
- Items devueltos por Graph: 0.

Tools:

- `get_incidents_schema`: OK.
- `get_incidents_summary`: OK, total `0`.
- `get_open_incidents`: OK, total `0`.
- `get_recent_incidents`: OK, total `0`.
- `search_incidents`: OK, total `0`.
- `get_incidents_by_status`: no ejecutable con datos reales porque no hay estados detectados.
- `get_incident_by_id`: no ejecutable con ID real porque Graph no devuelve items.

Mapeo real aplicado:

- `title`: `Title`
- `description`: `Descripci_x00f3_n`
- `status`: `Estado`
- `requester`: `Author`
- `modified_by`: `Editor`
- `priority`: `Prioridad`
- `category`: `Categor_x00ed_a`
- `affected_system`: `Equipo_x002f_Puesto`
- `location`: `Ubicaci_x00f3_n_x002f_Puesto_x00`
- `comments`: `Resoluci_x00f3_n`
- `closed_at`: `Fechadecierre`

Servicio:

- Instalado `/etc/systemd/system/sharepoint-incidents-ti-mcp.service`.
- Servicio activo y habilitado.
- Escucha solo en `127.0.0.1:8766`.
- `/healthz` sin auth: `401`.
- `/healthz` con auth: `200`.
- `/mcp tools/list` con auth: 8 tools, todas `readOnlyHint=true`.

Seguridad:

- Solo se han hecho llamadas `GET` contra Microsoft Graph.
- La prueba defensiva de `POST` contra Graph devuelve `blocked_ok`.
- No se ha modificado SharePoint.
- No se han impreso secretos.
- Auditoria revisada sin `Authorization`, `Bearer`, `access_token` ni `client_secret`.

## Revision permisos Graph - 2026-05-21 18:24 CEST

Resultado:

- El access token emitido para el MCP es `idtyp=app`.
- El token contiene `roles=["Sites.Read.All"]`.
- No contiene `Sites.Selected`, `Lists.SelectedOperations.Selected` ni `scp` delegado.
- El `client_id` del token coincide con el `GRAPH_CLIENT_ID` configurado.
- Con `Sites.Read.All`, el consentimiento de administrador esta efectivo porque el rol aparece en el token app-only.
- Con este modelo no hace falta grant especifico a site/lista para leer `IncidenciasTI`.

Comprobaciones read-only:

- `GET /sites/{site_id}/permissions`: `403 accessDenied` con el token actual. No bloquea lectura de lista; indica que la app no tiene privilegios administrativos para listar permisos del site.
- `GET /sites/{site_id}/lists/{list_id}/permissions` en v1.0: no disponible para este recurso (`Resource not found for the segment 'permissions'`).
- `GET https://graph.microsoft.com/beta/sites/{site_id}/lists/{list_id}/permissions`: OK, 7 permisos devueltos.
- No hay permiso beta de lista que apunte al `GRAPH_CLIENT_ID` del MCP.
- `GET /sites/{site_id}/lists/{list_id}`: OK.
- `GET /sites/{site_id}/lists/{list_id}/items`: OK, 0 items.

Conclusion:

- Estado actual: lectura funcional por `Sites.Read.All`.
- Riesgo: permiso demasiado amplio para el objetivo final, porque permite leer items/documentos de todos los site collections accesibles por ese permiso.
- Objetivo recomendado: migrar a `Lists.SelectedOperations.Selected` con grant `read` sobre la lista `IncidenciasTI`, o como alternativa menos granular `Sites.Selected` con grant `read` sobre el site.

Comando preparado para grant read a lista, no ejecutado:

```bash
source /etc/zabbix-codex/sharepoint-incidents.env
curl -sS -X POST \
  "https://graph.microsoft.com/beta/sites/${SHAREPOINT_SITE_ID}/lists/b4972fd0-8714-4cf1-bbb2-62b9809a6414/permissions" \
  -H "Authorization: Bearer ${GRANT_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "grantedToV2": {
      "application": {
        "id": "'"${GRAPH_CLIENT_ID}"'",
        "displayName": "MCP IncidenciasTI"
      }
    },
    "roles": ["read"]
  }'
```

Notas:

- `GRANT_ACCESS_TOKEN` debe ser de una identidad administrativa/granting app con permisos suficientes para crear permisos de lista. No debe ser el token runtime del MCP.
- Antes de usar este modelo, quitar `Sites.Read.All` del MCP y conceder/admin-consent a `Lists.SelectedOperations.Selected`.
- Tras crear el grant, volver a validar token, schema, summary y items.

## Diagnostico items IncidenciasTI - 2026-05-21 18:45 CEST

Motivo:

- La UI de SharePoint muestra elementos reales, pero una validacion anterior habia devuelto `0` items.

Resultado:

- La lista consultada por Graph es la correcta.
- `id`: `b4972fd0-8714-4cf1-bbb2-62b9809a6414`.
- `displayName`: `IncidenciasTI`.
- `name`: `IncidenciasTI`.
- `webUrl`: `https://ramiroarnedo.sharepoint.com/Departamento%20de%20Inform%C3%A1tica/Lists/IncidenciasTI`.
- La URL anterior corresponde a la base de la lista visible en UI; `AllItems.aspx` es la vista dentro de esa misma lista.
- `createdDateTime`: `2025-11-25T22:48:15Z`.
- `lastModifiedDateTime`: `2026-05-21T16:35:33Z`.
- `template`: `genericList`.
- `hidden`: `false`.
- `contentTypesEnabled`: `false`.
- `itemCount`: no aparece en la respuesta Graph de lista.

Listas candidatas encontradas en el site:

- `IncidenciasTI`
  - id `b4972fd0-8714-4cf1-bbb2-62b9809a6414`
  - template `genericList`
  - webUrl `https://ramiroarnedo.sharepoint.com/Departamento%20de%20Inform%C3%A1tica/Lists/IncidenciasTI`
- `Incidencias Transportes`
  - id `a87dab37-4379-4ce1-bdef-f0adef6dbfad`
  - template `genericList`
  - webUrl `https://ramiroarnedo.sharepoint.com/Departamento%20de%20Inform%C3%A1tica/Lists/Incidencias%20Transportes`

Pruebas crudas read-only:

- `GET /sites/{site_id}/lists/{list_id}/items`: OK, 190 items.
- `GET /sites/{site_id}/lists/{list_id}/items?$top=5`: OK, 5 items y `@odata.nextLink`.
- `GET /sites/{site_id}/lists/{list_id}/items?$top=5&$expand=fields`: OK, 5 items con campos.
- `GET /sites/{site_id}/lists/{list_id}/items?$top=5&$expand=fields($select=Title,Descripci_x00f3_n,Estado,Prioridad,Equipo_x002f_Puesto)`: OK.
- v1.0 y beta funcionan para lectura.

Titulos visibles confirmados:

- `La impresora se aturulla`: encontrado, id `22`, estado `Cerrado`.
- `Entrega de tablet a Premejora Calahorra`: encontrado, id `23`, estado `Cerrado`.
- `Premejora Calahorra`: encontrado por busqueda.

Tools MCP tras reiniciar servicio:

- `get_incidents_summary`: OK, total `190`.
- Estados:
  - `Abierto`: 54
  - `En curso`: 5
  - `Cerrado`: 130
  - `Pendiente de usuario`: 1
- `get_open_incidents`: OK, total `54`.
- `get_recent_incidents` ultimos 30 dias: OK, total `35`.
- `get_incidents_by_status` `Abierto`: OK, total `54`.
- `get_incidents_by_status` `En curso`: OK, total `5`.
- `get_incident_by_id` con id `22`: OK.

Causa tecnica encontrada:

- La lista y permisos no eran el problema.
- Graph lee correctamente los items.
- Se corrigio una incidencia del wrapper diagnostico: cuando `graph_request` recibia una URL absoluta y tambien `params`, ignoraba esos parametros. Esto hacia que algunas pruebas crudas fueran ambiguas.
- El servicio MCP fue reiniciado para cargar el codigo actualizado.

Seguridad:

- No se hicieron cambios en SharePoint.
- No se crearon grants.
- No se crearon, editaron, cerraron, asignaron ni borraron incidencias.
- Solo llamadas GET contra Microsoft Graph.
- Auditoria sin `Authorization`, `Bearer`, `access_token` ni `client_secret`.

## Publicacion HTTPS para ChatGPT Developer Mode - 2026-05-21 18:50 CEST

Estado:

- Servicio MCP local: `sharepoint-incidents-ti-mcp.service`.
- Endpoint local: `http://127.0.0.1:8766/mcp`.
- Tunel HTTPS: `sharepoint-incidents-ti-cloudflared.service`.
- Endpoint publico HTTPS:

```text
https://sugar-parallel-owners-developers.trycloudflare.com/mcp
```

Validaciones externas:

- `/healthz` sin auth: `401`.
- `/healthz` con bearer auth: `200`.
- `/mcp tools/list` con bearer auth: 8 tools exactas.
- Todas las tools publicadas tienen `annotations.readOnlyHint=true`.
- `get_incidents_summary`: OK, total `190`.
- `get_open_incidents`: OK, total `54`.
- Tool inexistente `create_incident`: rechazada como `Unknown tool`.

Tools publicadas:

- `get_incidents_schema`
- `get_incidents_summary`
- `get_open_incidents`
- `get_incidents_by_status`
- `get_recent_incidents`
- `get_incident_by_id`
- `search_incidents`
- `get_incidents_related_to_asset`

Datos para ChatGPT Developer Mode:

- Nombre: `IncidenciasTI ReadOnly`
- Descripcion: `Conector read-only para consultar incidencias de usuarios registradas en la lista SharePoint IncidenciasTI. Permite consultar resumen, estados, incidencias abiertas, recientes, detalle por ID, busqueda y relacion con activos o sistemas, sin modificar SharePoint.`
- URL: `https://sugar-parallel-owners-developers.trycloudflare.com/mcp`
- Autenticacion: `Bearer token`
- Token: leer de `/etc/zabbix-codex/incidents-ti-mcp.env`, variable `MCP_SHARED_TOKEN`. No se imprime ni se guarda en reports.

Nota:

- Es un Cloudflare Quick Tunnel. Si el servicio de tunel se reinicia, la URL puede cambiar.
- Para uso estable, crear Cloudflare named tunnel o reverse proxy HTTPS con dominio controlado.
- Se mantiene `Sites.Read.All`; la migracion a `Lists.SelectedOperations.Selected` queda como hardening posterior.
