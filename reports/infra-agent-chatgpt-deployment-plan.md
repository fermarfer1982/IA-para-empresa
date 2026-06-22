# Plan De Despliegue ChatGPT Para MCP Infra Agent

## Estado Actual

El backend MCP read-only ya existe en:

- `/opt/zabbix-codex/mcp-infra-agent/server.py`
- `/opt/zabbix-codex/mcp-infra-agent/remote_server.py`

El modo local stdio esta validado. El wrapper HTTP remoto se ha preparado para pruebas internas con:

- `GET /healthz`
- `GET /metadata`
- `GET /.well-known/mcp.json`
- `POST /mcp`
- autenticacion temporal `Authorization: Bearer <MCP_SHARED_TOKEN>`
- auditoria JSON lines en `/var/log/zabbix-codex/infra-agent-mcp.log`
- `annotations.readOnlyHint: true` en todas las herramientas publicadas

El servidor mantiene las herramientas en modo read-only y solo consulta Zabbix API con metodos `.get` permitidos o artefactos locales.

## Que Funciona

- Handshake MCP local por stdio.
- `tools/list`.
- `get_infrastructure_overview`.
- `get_active_problems`.
- `generate_daily_report`.
- Wrapper HTTP interno por `127.0.0.1:8765`.
- Metadata y healthcheck.
- Autenticacion bearer temporal.
- Auditoria de llamadas sin tokens.
- Registro publico reducido a 12 herramientas de consulta.
- Placeholders SharePoint/BBDD no publicados.
- Documentacion de seguridad y prompt del agente.

## Que Falta

- Validacion con un cliente ChatGPT real.
- HTTPS publico o tunel seguro.
- Autenticacion OAuth/OIDC delante del endpoint remoto.
- Confirmar si el workspace exige SSE estricto o acepta streaming HTTP con respuestas JSON-RPC por POST.
- Si exige SSE estricto, instalar una libreria MCP compatible (`mcp`/`fastmcp`) y portar los handlers.
- Confirmar en ChatGPT Agent Builder que las herramientas aparecen como read-only tras refrescar/reescanear.

## Como Desplegarlo

### 1. Local/dev

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/server.py --stdio
```

### 2. Servidor interno

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/remote_server.py
```

Healthcheck:

```bash
curl -sS http://127.0.0.1:8765/healthz -H 'Authorization: Bearer CAMBIAR'
```

### 3. systemd

Usar como base:

```text
/opt/zabbix-codex/mcp-infra-agent/deploy/zabbix-infra-mcp.service.example
```

Copiar a `/etc/systemd/system/zabbix-infra-mcp.service` solo cuando se apruebe activar el servicio.

### 4. Reverse proxy

Usar como base:

```text
/opt/zabbix-codex/mcp-infra-agent/deploy/nginx-mcp-infra-agent.conf.example
```

Requisitos:

- HTTPS.
- OAuth/OIDC, VPN, allowlist o Secure MCP Tunnel.
- Logs sin tokens.
- No publicar directamente el proceso Python a Internet.
- Cambiar `MCP_SHARED_TOKEN="CAMBIAR"` antes de cualquier prueba fuera de localhost.
- Para produccion, sustituir bearer temporal por OAuth/OIDC o Secure MCP Tunnel.

### 5. ChatGPT Custom MCP App

1. Activar Developer mode en ChatGPT.
2. Ir a Settings -> Apps.
3. Crear app.
4. Configurar endpoint HTTPS:

   ```text
   https://mcp-infra.example.com/mcp
   ```

5. Configurar autenticacion.
6. Escanear/refrescar herramientas.
7. Confirmar que todas son read-only y muestran `readOnlyHint`.
8. Pegar el prompt de:

   ```text
   /opt/zabbix-codex/mcp-infra-agent/docs/agent_builder_prompt.md
   ```

9. Probar las conversation starters.

## Riesgos

- Exponer datos internos de infraestructura si se publica sin autenticacion.
- Prompt injection desde otras fuentes conectadas al mismo agente.
- Datos obsoletos si no se refrescan artefactos `agent_knowledge`.
- Confusion entre recomendaciones y acciones si se anaden tools de escritura en el futuro.
- Falsa seguridad si se usa No Authentication fuera de un entorno controlado.

## Seguridad

- Mantener solo herramientas read-only.
- Separar este MCP de cualquier MCP con acciones de escritura.
- Aplicar principio de minimo privilegio al token Zabbix.
- Usar HTTPS y OAuth/OIDC para ChatGPT.
- Usar allowlist/VPN/tunel seguro cuando sea posible.
- Revisar logs periodicamente.
- No incluir tokens ni secretos en tool descriptions, metadata o respuestas.
- Auditar llamadas MCP y revisar que no aparecen cabeceras `Authorization`.

## Pasos Para Probar En ChatGPT

1. Validar localmente:

   ```bash
   python3 /opt/zabbix-codex/mcp-infra-agent/server.py --self-test
   ```

2. Validar HTTP interno:

   ```bash
   curl -sS http://127.0.0.1:8765/healthz -H 'Authorization: Bearer CAMBIAR'
   curl -sS http://127.0.0.1:8765/mcp -H 'Authorization: Bearer CAMBIAR' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```

3. Publicar temporalmente por HTTPS protegido.
4. Crear app en ChatGPT Developer mode.
5. Refrescar tools.
6. Probar:

   - "¿Qué problemas críticos hay en Zabbix?"
   - "Dame un informe ejecutivo de infraestructura."
   - "¿Qué sistemas no tienen backup verificable?"

## Decision Actual

El backend esta listo para pruebas locales e internas. Para exposicion directa a ChatGPT web falta decidir el mecanismo de autenticacion y validar el transporte remoto exacto del workspace: streaming HTTP con `/mcp` o SSE con `/sse/`.
