# Active Directory setup

Infra Agent Web usa Active Directory como fuente de identidad. La app no guarda contraseñas: valida usuario y clave contra AD desde backend mediante LDAPS y crea una sesion segura con cookie httpOnly.

## Grupos AD recomendados

Cree grupos de seguridad, por ejemplo:

- `InfraAgent_Admin`
- `InfraAgent_Operator`
- `InfraAgent_Viewer`
- `InfraAgent_Display`
- `InfraAgent_PowerBI`
- `InfraAgent_Auditor`

Puede configurar cada variable con el DN completo del grupo o con el nombre `CN`.

## Variables de entorno

Configure en el entorno del servicio, sin guardarlas en Git:

```bash
AUTH_SECRET=valor_largo_aleatorio
AD_URL=ldaps://dc01.empresa.local:636
AD_BASE_DN=DC=empresa,DC=local
AD_DOMAIN=EMPRESA
AD_UPN_SUFFIX=empresa.local
AD_BIND_DN=CN=svc-infra-agent,OU=Servicios,DC=empresa,DC=local
AD_BIND_PASSWORD=...
AD_SEARCH_FILTER=(|(sAMAccountName={{username}})(userPrincipalName={{username}}))
AD_GROUP_ADMIN=CN=InfraAgent_Admin,OU=Grupos,DC=empresa,DC=local
AD_GROUP_OPERATOR=CN=InfraAgent_Operator,OU=Grupos,DC=empresa,DC=local
AD_GROUP_VIEWER=CN=InfraAgent_Viewer,OU=Grupos,DC=empresa,DC=local
AD_GROUP_DISPLAY=CN=InfraAgent_Display,OU=Grupos,DC=empresa,DC=local
AD_GROUP_POWERBI=CN=InfraAgent_PowerBI,OU=Grupos,DC=empresa,DC=local
AD_GROUP_AUDITOR=CN=InfraAgent_Auditor,OU=Grupos,DC=empresa,DC=local
SECURITY_RBAC_ENFORCE=true
SECURITY_ALLOW_UNMAPPED_USERS=false
```

## LDAPS

- Use puerto `636/tcp` hacia el controlador de dominio.
- El servidor Linux debe confiar en la CA que emitio el certificado LDAPS del DC.
- No use `ldap://` en produccion. Solo se permite LDAP plano en desarrollo con `SECURITY_ALLOW_PLAIN_LDAP_DEV=true`.

## Prueba rapida

1. Reinicie `infra-agent-web.service` tras configurar variables.
2. Abra `/api/health` y confirme `authConfigured=true` y `ldapsConfigured=true`.
3. Abra `/login` e inicie sesion con un usuario miembro de un grupo permitido.
