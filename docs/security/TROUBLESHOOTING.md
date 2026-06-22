# Security troubleshooting

## `/login` no valida usuarios

Revise:

- `AD_URL` usa `ldaps://...:636`.
- El servidor confia en la CA del controlador de dominio.
- `AD_BIND_DN` y `AD_BIND_PASSWORD` son correctos.
- `AD_BASE_DN` apunta al arbol donde estan los usuarios.
- `AD_SEARCH_FILTER` contiene `{{username}}`.

Use `/api/health` para confirmar si la configuracion basica esta presente. No expone secretos.

## Usuario entra en AD pero no en la app

- Compruebe que pertenece a uno de los grupos configurados.
- Revise `AD_GROUP_*`.
- Si necesita validar sin bloquear, use temporalmente `SECURITY_RBAC_ENFORCE=false`.
- No active `SECURITY_ALLOW_UNMAPPED_USERS=true` en produccion salvo excepcion documentada.

## API devuelve 401

No hay sesion valida. Inicie sesion en `/login` o envie cookie de sesion en la peticion.

## API devuelve 403

La sesion existe, pero el usuario no tiene el permiso requerido. Revise `docs/security/RBAC_MATRIX.md`.

## LDAPS falla por certificado

En Rocky Linux, instale la CA corporativa en el almacen de confianza del sistema y reinicie el servicio. No baje a LDAP plano en produccion.

## Auditoria no escribe

- Revise permisos de escritura de `SECURITY_AUDIT_LOG_PATH`.
- Compruebe que existe el directorio padre.
- Revise `journalctl -u infra-agent-web.service` para warnings seguros.
