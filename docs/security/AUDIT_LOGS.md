# Audit logs

La capa de seguridad registra eventos en JSONL. Ruta por defecto:

```text
/var/log/zabbix-codex/infra-agent-web-audit.jsonl
```

Puede cambiarse con:

```bash
SECURITY_AUDIT_LOG_PATH=/var/log/zabbix-codex/infra-agent-web-audit.jsonl
```

## Eventos registrados

- `login_success`
- `login_failed`
- `logout`
- `access_denied`
- `permission_check`
- `agent_query`
- `powerbi_query`
- acciones futuras de Zabbix/configuracion cuando se conecten a helpers RBAC.

## Formato

Cada linea JSON contiene:

- `timestamp`
- `requestId`
- `user`
- `roles`
- `action`
- `resource`
- `allowed`
- `ip`
- `userAgent`
- `details`

No se guardan contrasenas, tokens, cookies, cabeceras `Authorization`, secretos ni connection strings.

## Retencion recomendada

- Retener 90 dias para operacion normal.
- Proteger el fichero con permisos de sistema.
- Rotar con `logrotate` si el volumen crece.
- Copiar a SIEM corporativo si existe.

Ejemplo de revision:

```bash
tail -n 50 /var/log/zabbix-codex/infra-agent-web-audit.jsonl
```
