# Conexion a ChatGPT Agents / custom MCP app

## Estado del conector

El MCP IncidenciasTI esta preparado como conector read-only. Puede ejecutarse por stdio para desarrollo local o como endpoint HTTP autenticado para ChatGPT Developer Mode / custom MCP app.

## Modo local/dev

Validacion:

```bash
cd /opt/zabbix-codex
python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py
python3 mcp-incidents-ti/server.py --self-test
python3 mcp-incidents-ti/server.py --list-tools
python3 mcp-incidents-ti/server.py --test-block-write
```

Ejecucion stdio:

```bash
python3 /opt/zabbix-codex/mcp-incidents-ti/server.py --stdio
```

## Modo servidor interno

1. Configurar `/etc/zabbix-codex/sharepoint-incidents.env` con credenciales Graph read-only.
2. Configurar `/etc/zabbix-codex/incidents-ti-mcp.env` con `MCP_REQUIRE_AUTH=true` y token compartido.
3. Instalar el servicio systemd desde `deploy/sharepoint-incidents-ti-mcp.service.example`.
4. Mantener escucha en `127.0.0.1:8766` o red interna controlada.
5. Exponer por reverse proxy HTTPS solo si hay autenticacion y politica de acceso clara.

Comprobaciones:

```bash
curl -sS http://127.0.0.1:8766/healthz -H "Authorization: Bearer ${MCP_SHARED_TOKEN}"
curl -sS http://127.0.0.1:8766/mcp -H "Authorization: Bearer ${MCP_SHARED_TOKEN}" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Modo ChatGPT custom MCP app

Requisitos:

- Endpoint HTTPS accesible por ChatGPT o tunnel seguro.
- Autenticacion obligatoria.
- Tool descriptors con `readOnlyHint=true`.
- No publicar tools de escritura.

Pasos generales:

1. Desplegar `remote_server.py` detras de HTTPS.
2. Proteger el endpoint con bearer temporal, OAuth/OIDC o Secure MCP Tunnel.
3. En ChatGPT Workspace settings / Apps / Create, crear una app MCP apuntando al endpoint `/mcp`.
4. Configurar el metodo de autenticacion elegido.
5. Ejecutar el escaneo de tools.
6. Verificar que aparecen solo las 8 tools de consulta.
7. Confirmar que el editor del agente marca las tools como read-only.
8. Anadir la app al agente junto al MCP de Zabbix.

## Datos actuales para Developer Mode

Nombre recomendado:

```text
IncidenciasTI ReadOnly
```

Descripcion:

```text
Conector read-only para consultar incidencias de usuarios registradas en la lista SharePoint IncidenciasTI. Permite consultar resumen, estados, incidencias abiertas, recientes, detalle por ID, busqueda y relacion con activos o sistemas, sin modificar SharePoint.
```

Endpoint HTTPS:

```text
https://sugar-parallel-owners-developers.trycloudflare.com/mcp
```

Autenticacion:

```text
Bearer token
```

Token:

```text
/etc/zabbix-codex/incidents-ti-mcp.env -> MCP_SHARED_TOKEN
```

No imprimir ni pegar el token en documentos o logs. Pegar solo en el campo secreto de autenticacion de ChatGPT Developer Mode.

Nota: el endpoint actual usa Cloudflare Quick Tunnel. Si el servicio `sharepoint-incidents-ti-cloudflared.service` se reinicia, la URL puede cambiar. Para una URL estable de produccion, migrar a Cloudflare named tunnel o dominio HTTPS controlado.

## Prompt recomendado del agente

Usa tambien `docs/agent_instructions.md`.

Regla central: antes de responder sobre incidencias reales, consulta el MCP IncidenciasTI. Antes de responder sobre estado tecnico, consulta el MCP de Zabbix. Separa hechos observados, interpretacion y recomendaciones.
