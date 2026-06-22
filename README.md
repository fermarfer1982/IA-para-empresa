# Infra Agent Web / Zabbix Codex

Proyecto de agente inteligente para monitorizacion de infraestructura, operaciones IT y analitica ejecutiva. Combina una aplicacion Next.js, endpoints server-side, artefactos de conocimiento, scripts de auditoria Zabbix/Proxmox/PBS y MCPs read-only para operar sobre datos reales sin exponer credenciales al navegador.

Version visible actual de la capa web: `v0.21.0`.

## Que incluye

- `infra-agent-web/`: aplicacion Next.js/Node para dashboard, chat operativo, Agent Display, Power BI y Comunicaciones.
- `scripts/`: auditorias, inventarios y generadores de artefactos de monitorizacion.
- `agent_knowledge/`: mapas y resumenes estructurados usados por el agente.
- `reports/`: changelog, auditorias y reportes tecnicos del proyecto.
- `mcp-infra-agent/`: MCP read-only para infraestructura/Zabbix.
- `mcp-incidents-ti/`: MCP read-only para IncidenciasTI.
- `productization/`: plantillas para demo, tenant, comercializacion y empaquetado.
- `docs/security/`: documentacion de autenticacion Active Directory, RBAC y auditoria.

## Capacidades principales

- Centro visual `/agent-display` con avatar, modo presentacion inteligente, informe ejecutivo, estado de infraestructura y bloque Power BI.
- Integracion Power BI sobre modelo semantico existente, con consultas sugeridas y resultados resumidos.
- Chat/voz operativa para infraestructura, firewalls, riesgos, huecos de monitorizacion e informes.
- Soporte explicito para Firewalls / Red perimetral.
- Borradores y revision de Comunicaciones con bloqueo de envio si falta destinatario/email o dominio permitido.
- Generacion de informes, readiness y roadmap de monitorizacion.
- Seguridad corporativa con Active Directory, RBAC y auditoria JSONL.

## Seguridad v0.21.0

La app no gestiona usuarios locales. La identidad procede de Active Directory mediante LDAPS y la autorizacion se resuelve con grupos AD mapeados a roles internos.

Roles internos:

- `admin`
- `operator`
- `viewer`
- `display`
- `powerbi`
- `auditor`

Permisos destacados:

- `dashboard:view`
- `agent:ask`
- `zabbix:read`
- `zabbix:action`
- `powerbi:query`
- `display:view`
- `reports:view`
- `audit:view`
- `admin:manage`

Documentacion:

- `docs/security/AD_SETUP.md`
- `docs/security/RBAC_MATRIX.md`
- `docs/security/DEPLOYMENT_CHECKLIST.md`
- `docs/security/AUDIT_LOGS.md`
- `docs/security/TROUBLESHOOTING.md`

## Variables de entorno

No subas credenciales al repositorio. Usa variables de entorno del servicio o `.env.local` local, que queda ignorado por Git.

Variables principales de seguridad:

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

Otros ejemplos estan en `infra-agent-web/.env.example`.

## Desarrollo local

```bash
cd infra-agent-web
npm install
npm run dev:local
```

URL local:

```text
http://127.0.0.1:3010
```

## Build y validacion

```bash
cd infra-agent-web
npm run test:security
npm run build
```

Produccion en el servidor actual:

```bash
systemctl restart infra-agent-web.service
systemctl status infra-agent-web.service --no-pager
```

Endpoints utiles:

```bash
curl -s http://127.0.0.1:3010/api/health
curl -I http://127.0.0.1:3010/agent-display
```

## Despliegue

Arquitectura recomendada:

```text
Navegador interno -> HTTPS/Nginx -> Next.js 127.0.0.1:3010
```

Next.js debe escuchar solo en localhost y Nginx debe terminar TLS. No expongas `3010/tcp` directamente en LAN.

## Demo / producto

El directorio `productization/` contiene material para preparar demos y paquetes reutilizables:

- `productization/demo-template/`
- `productization/commercial-template/`
- `productization/tenant-template/`
- `productization/client-onboarding-checklist.md`

Para demos comerciales, usa datos anonimizados y evita incluir `agent_knowledge/`, `reports/` o inventarios reales si el repositorio va a ser publico.

## Politica de secretos

El repositorio ignora:

- `.env.local` y variantes locales.
- `node_modules/`.
- `.next/`.
- bases SQLite/runtime.
- logs.
- caches Python.

Antes de publicar fuera de GitHub privado, revisa que no haya nombres internos, IPs, inventarios reales o reportes sensibles.

## Changelog

El historial detallado esta en:

```text
reports/CHANGELOG.md
```
