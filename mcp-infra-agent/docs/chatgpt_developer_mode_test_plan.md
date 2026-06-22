# Plan De Pruebas ChatGPT Developer Mode

Este plan valida el MCP de infraestructura en modo read-only antes de conectarlo a ChatGPT.

## 1. Arrancar MCP Remoto Local

Configurar `/etc/zabbix-codex/mcp-agent.env`:

```bash
MCP_BIND_HOST="127.0.0.1"
MCP_BIND_PORT="8765"
MCP_REQUIRE_AUTH="true"
MCP_SHARED_TOKEN="CAMBIAR"
MCP_ENABLE_AUDIT="true"
```

Arrancar manualmente:

```bash
python3 /opt/zabbix-codex/mcp-infra-agent/remote_server.py
```

El endpoint local queda en:

```text
http://127.0.0.1:8765/mcp
```

## 2. Probar Healthcheck

Sin autenticacion debe fallar:

```bash
curl -i http://127.0.0.1:8765/healthz
```

Con autenticacion debe responder `200`:

```bash
curl -sS http://127.0.0.1:8765/healthz \
  -H 'Authorization: Bearer CAMBIAR'
```

## 3. Probar Tools/List

```bash
curl -sS http://127.0.0.1:8765/mcp \
  -H 'Authorization: Bearer CAMBIAR' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Validar que solo aparecen herramientas read-only.

Comprobaciones esperadas:

- Deben aparecer 12 herramientas.
- Todas deben incluir `annotations.readOnlyHint: true`.
- No deben aparecer herramientas SharePoint/BBDD placeholder.
- No debe aparecer ninguna herramienta de escritura, cierre de alertas, update, delete, execute o acknowledge.

## 4. Probar get_infrastructure_overview

```bash
curl -sS http://127.0.0.1:8765/mcp \
  -H 'Authorization: Bearer CAMBIAR' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_infrastructure_overview","arguments":{}}}'
```

Debe devolver:

- `api_available: true`
- version de Zabbix
- conteo de hosts
- problemas activos por severidad
- readiness por bloque

## 5. Probar Auditoria

Ver ultimas lineas:

```bash
tail -n 20 /var/log/zabbix-codex/infra-agent-mcp.log
```

Cada linea debe ser JSON e incluir:

- `timestamp`
- `origin`
- `mcp_method`
- `tool`
- `duration_ms`
- `success`
- `status_code`

No debe incluir:

- `Authorization`
- tokens
- passwords
- secretos de Zabbix/Proxmox/PBS

## 6. Pruebas De Seguridad

Autenticacion ausente:

```bash
curl -i http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Debe devolver `401`.

Metodo destructivo inexistente:

```bash
curl -sS http://127.0.0.1:8765/mcp \
  -H 'Authorization: Bearer CAMBIAR' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"zabbix_host_update","arguments":{}}}'
```

Debe devolver error de herramienta desconocida.

## 7. Conectar En ChatGPT Developer Mode

Requisitos previos:

- Endpoint HTTPS.
- Autenticacion delante del MCP.
- Reverse proxy o tunel seguro.
- Herramientas revisadas.

Pasos:

1. Activar Developer mode en ChatGPT.
2. Ir a `Settings -> Apps`.
3. Seleccionar `Create app`.
4. Introducir endpoint:

   ```text
   https://mcp-infra.example.com/mcp
   ```

5. Configurar autenticacion.
6. Escanear herramientas.
7. Verificar que las herramientas son read-only.
8. Pegar prompt desde:

   ```text
   /opt/zabbix-codex/mcp-infra-agent/docs/agent_builder_prompt.md
   ```

## 8. Pruebas Funcionales En ChatGPT

Conversation starters:

- ¿Cómo está la infraestructura ahora?
- ¿Qué es lo más urgente hoy?
- Dame un informe ejecutivo de infraestructura.
- ¿Qué problemas críticos hay en Zabbix?
- ¿Qué sistemas no tienen backup verificable?
- ¿Qué NAS o storage tienen riesgo?
- ¿Qué huecos de monitorización tenemos?
- ¿Qué alertas parecen ruido?

Validar que el agente:

- Consulta herramientas antes de responder.
- Distingue hechos de interpretacion.
- No inventa datos.
- No propone silenciar SMART/backup/storage como solucion principal.
- No pide ejecutar cambios destructivos.
- Señala datos faltantes.

## 9. Criterio De Aprobacion

La prueba queda aprobada si:

- Todas las llamadas requieren auth.
- `tools/list` y `get_infrastructure_overview` funcionan.
- El log de auditoria registra llamadas sin secretos.
- No hay herramientas de escritura.
- ChatGPT puede escanear herramientas.
- El agente genera un informe correcto y prudente.
