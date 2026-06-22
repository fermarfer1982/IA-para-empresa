# Conexion Con ChatGPT Agents / Custom MCP App

Este backend tiene dos piezas:

- `server.py`: MCP local por stdio, ya validado.
- `remote_server.py`: wrapper HTTP read-only para pruebas internas y despliegue detras de reverse proxy.

Segun la documentacion actual de OpenAI, las apps/conectores MCP remotos para ChatGPT usan SSE o streaming HTTP y deben publicarse con HTTPS. Para datos internos sensibles se recomienda OAuth o un tunel seguro, no una exposicion publica sin autenticacion.

## A. Modo Local/Dev

Uso recomendado para desarrollo y pruebas desde el propio servidor:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --stdio
```

Validaciones:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --list-tools
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --self-test
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --call get_infrastructure_overview
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --call get_active_problems --args '{"severity":"High","limit":5}'
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --call generate_daily_report
```

Handshake MCP local:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 /opt/zabbix-codex/mcp-infra-agent/server.py --stdio
```

## B. Modo Servidor Interno

Para una prueba interna HTTP local:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/remote_server.py
```

Healthcheck:

```bash
curl -sS http://127.0.0.1:8765/healthz \
  -H 'Authorization: Bearer CAMBIAR'
```

Metadata:

```bash
curl -sS http://127.0.0.1:8765/.well-known/mcp.json \
  -H 'Authorization: Bearer CAMBIAR'
```

Tools/list por HTTP:

```bash
curl -sS http://127.0.0.1:8765/mcp \
  -H 'Authorization: Bearer CAMBIAR' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

El wrapper lee `/etc/zabbix-codex/mcp-agent.env`:

```text
MCP_BIND_HOST="127.0.0.1"
MCP_BIND_PORT="8765"
MCP_REQUIRE_AUTH="true"
MCP_SHARED_TOKEN="CAMBIAR"
MCP_ENABLE_AUDIT="true"
```

`CAMBIAR` es solo valor temporal de pruebas. Antes de exponer el endpoint, sustituirlo por un valor fuerte o usar OAuth/OIDC/Secure MCP Tunnel.

Auditoria:

```text
/var/log/zabbix-codex/infra-agent-mcp.log
```

Ficheros de despliegue:

- `/opt/zabbix-codex/mcp-infra-agent/deploy/zabbix-infra-mcp.service.example`
- `/opt/zabbix-codex/mcp-infra-agent/deploy/nginx-mcp-infra-agent.conf.example`

Recomendaciones:

- Ejecutar como usuario `codexops`.
- Escuchar en `127.0.0.1`.
- Exponer via Nginx solo con HTTPS.
- Poner OAuth/OIDC, VPN, allowlist de IP o Secure MCP Tunnel delante antes de conectar ChatGPT.
- Registrar logs en journald/Nginx sin tokens.

## C. Modo ChatGPT Custom MCP App

Requisitos de alto nivel:

- URL HTTPS accesible para ChatGPT.
- Transporte MCP remoto compatible: SSE o streaming HTTP.
- Herramientas con descripciones claras.
- Autenticacion: OAuth recomendado. No usar una URL publica sin autenticacion para datos internos.
- App creada desde ChatGPT web con Developer mode habilitado.

Pasos en ChatGPT:

1. Activar Developer mode en ChatGPT: Settings -> Apps -> Advanced settings -> Developer mode.
2. Abrir Settings -> Apps.
3. Seleccionar Create app.
4. Introducir la URL MCP remota HTTPS, por ejemplo:

   ```text
   https://mcp-infra.example.com/mcp
   ```

   Si se usa SSE con un SDK MCP/FastMCP, la URL puede ser:

   ```text
   https://mcp-infra.example.com/sse/
   ```

5. Configurar autenticacion:
   - Recomendado: OAuth/OIDC.
   - Para pruebas controladas: No Authentication solo si el endpoint esta protegido por VPN/tunel/allowlist y no es publico.
6. Escanear/refrescar herramientas.
7. Revisar que solo aparecen 12 herramientas read-only con `annotations.readOnlyHint: true`.
8. Crear el agente y pegar las instrucciones de `docs/agent_builder_prompt.md`.
9. Anadir conversation starters.
10. Probar:
    - "Usa el MCP de infraestructura y dime que problemas High hay ahora."
    - "Genera un informe diario usando `generate_daily_report`."

## Estado Del Wrapper Remoto Actual

`remote_server.py` proporciona:

- `GET /healthz`
- `GET /metadata`
- `GET /.well-known/mcp.json`
- `POST /mcp`
- soporte JSON-RPC MCP para `initialize`, `tools/list` y `tools/call`
- modo localhost por defecto
- bearer token obligatorio si `MCP_REQUIRE_AUTH=true`
- auditoria JSON lines sin tokens

No sustituye una revision final con un cliente ChatGPT real. Si ChatGPT exige SSE estricto en el workspace, instalar una libreria MCP compatible y adaptar el transporte:

```bash
python3 -m pip install mcp fastmcp
```

Despues, portar los handlers de `server.py` a un servidor FastMCP con transporte `sse` o `streamable-http`.

## Prompt Base Del GPT/Agent

Usar el contenido completo de:

```text
/opt/zabbix-codex/mcp-infra-agent/docs/agent_builder_prompt.md
```

## Referencias Oficiales Consultadas

- OpenAI MCP para ChatGPT Apps/API: `https://developers.openai.com/api/docs/mcp`
- OpenAI Developer mode: `https://developers.openai.com/api/docs/guides/developer-mode`
- OpenAI remote MCP/connectors: `https://developers.openai.com/api/docs/guides/tools-connectors-mcp`
