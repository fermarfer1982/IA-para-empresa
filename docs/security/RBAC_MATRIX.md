# RBAC matrix

La autorizacion se evalua en servidor. Ocultar botones en frontend es solo una ayuda visual.

## Roles

| Rol | Uso previsto |
| --- | --- |
| `admin` | Administracion completa |
| `operator` | Operacion de infraestructura y acciones Zabbix permitidas |
| `viewer` | Consulta de dashboard, informes y Zabbix read-only |
| `display` | Solo pantalla `/agent-display` |
| `powerbi` | Consultas Power BI y vistas relacionadas |
| `auditor` | Revision de informes y auditoria |

## Permisos

| Permiso | Admin | Operator | Viewer | Display | PowerBI | Auditor |
| --- | --- | --- | --- | --- | --- | --- |
| `dashboard:view` | Si | Si | Si | No | Si | Si |
| `agent:ask` | Si | Si | Si | No | Si | No |
| `zabbix:read` | Si | Si | Si | No | No | Si |
| `zabbix:action` | Si | Si | No | No | No | No |
| `powerbi:query` | Si | No | No | No | Si | No |
| `display:view` | Si | Si | Si | Si | Si | Si |
| `reports:view` | Si | Si | Si | No | Si | Si |
| `audit:view` | Si | No | No | No | No | Si |
| `admin:manage` | Si | No | No | No | No | No |

## Politicas

- Denegacion por defecto.
- `SECURITY_ALLOW_UNMAPPED_USERS=false` bloquea usuarios sin grupos mapeados.
- `SECURITY_RBAC_ENFORCE=false` no bloquea, pero audita lo que se habria denegado. Use solo para despliegue gradual.
