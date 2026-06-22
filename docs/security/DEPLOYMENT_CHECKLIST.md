# Security deployment checklist

1. Crear grupos AD y asignar usuarios.
2. Crear cuenta de servicio AD con permisos de lectura de usuarios/grupos.
3. Configurar LDAPS en Windows Server 2019.
4. Importar CA corporativa en Rocky Linux si hace falta.
5. Configurar variables de entorno del servicio `infra-agent-web.service`.
6. Definir `AUTH_SECRET` con un valor aleatorio largo.
7. Dejar `SECURITY_RBAC_ENFORCE=false` solo durante validacion inicial si se necesita despliegue gradual.
8. Ejecutar:

```bash
cd /opt/zabbix-codex/infra-agent-web
npm run test:security
npm run build
systemctl restart infra-agent-web.service
systemctl status infra-agent-web.service --no-pager
curl -s http://127.0.0.1:3010/api/health
```

9. Probar login con usuarios `admin`, `viewer`, `display`, `powerbi` y usuario sin grupo.
10. Confirmar respuestas:

- API sin sesion: `401`.
- API sin permiso: `403` si enforcement esta activo.
- Usuario `display`: accede a `/agent-display`, no al dashboard general.
- Usuario `viewer`: no ejecuta acciones Zabbix.
- Usuario `powerbi`: puede ejecutar consultas Power BI permitidas.

11. Revisar auditoria en el fichero configurado con `SECURITY_AUDIT_LOG_PATH`.
