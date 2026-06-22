# Plan de pruebas - ChatGPT Developer Mode

## Preparacion

1. Confirmar que existen:

```text
/etc/zabbix-codex/sharepoint-incidents.env
/etc/zabbix-codex/incidents-ti-mcp.env
```

2. Confirmar que `MCP_REQUIRE_AUTH=true`.
3. Confirmar que el servidor escucha en `127.0.0.1:8766` o detras de HTTPS autenticado.

## Pruebas locales

```bash
cd /opt/zabbix-codex
python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py
python3 mcp-incidents-ti/server.py --self-test
python3 mcp-incidents-ti/server.py --test-block-write
python3 mcp-incidents-ti/server.py --list-tools
```

Resultado esperado:

- `tools_defined = 8`
- `all_tools_read_only = true`
- `published_write_like_tools = []`
- `graph_allowed_methods = ["GET"]`
- `blocked_ok` en la prueba de escritura.

## Pruebas HTTP

Sin token:

```bash
curl -i http://127.0.0.1:8766/healthz
```

Esperado: `401 Unauthorized`.

Con token:

```bash
curl -sS http://127.0.0.1:8766/healthz -H "Authorization: Bearer ${MCP_SHARED_TOKEN}"
```

Esperado: `ok=true`.

Tools:

```bash
curl -sS http://127.0.0.1:8766/mcp \
  -H "Authorization: Bearer ${MCP_SHARED_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Schema:

```bash
curl -sS http://127.0.0.1:8766/mcp \
  -H "Authorization: Bearer ${MCP_SHARED_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_incidents_schema","arguments":{}}}'
```

Resumen:

```bash
curl -sS http://127.0.0.1:8766/mcp \
  -H "Authorization: Bearer ${MCP_SHARED_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_incidents_summary","arguments":{"limit":10}}}'
```

## Pruebas de seguridad

- Intentar acceder sin token: debe devolver 401.
- Intentar tool inexistente como `create_incident`: debe devolver `Unknown tool`.
- Ejecutar `--test-block-write`: debe devolver `blocked_ok`.
- Revisar que `/var/log/zabbix-codex/incidents-ti-mcp.log` no contiene tokens.
- Confirmar que no hay llamadas Graph `POST`, `PUT`, `PATCH` o `DELETE` en el codigo salvo la obtencion OAuth contra Microsoft identity.

## Prueba en ChatGPT Developer Mode

1. Crear custom MCP app apuntando al endpoint HTTPS `/mcp`.
2. Configurar autenticacion.
3. Escanear tools.
4. Confirmar que las 8 tools tienen `readOnlyHint=true`.
5. Anadir la app al agente.
6. Preguntar:

```text
¿Qué incidencias TI hay abiertas ahora?
```

7. Preguntar:

```text
Cruza las incidencias abiertas con los problemas activos de Zabbix y dime qué requiere atención humana.
```

El agente debe consultar primero las tools y no inventar datos.

## Endpoint publicado actual

```text
https://sugar-parallel-owners-developers.trycloudflare.com/mcp
```

Servicio de tunel:

```text
sharepoint-incidents-ti-cloudflared.service
```

Validaciones realizadas:

- `/healthz` sin auth: `401`.
- `/healthz` con auth: `200`.
- `/mcp tools/list` con auth: 8 tools.
- Todas las tools tienen `readOnlyHint=true`.
- `get_incidents_summary`: total 190.
- `get_open_incidents`: total 54.
- `create_incident`: `Unknown tool`.
