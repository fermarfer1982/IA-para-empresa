# Infra Agent Web

Aplicacion web Next.js del proyecto Infra Agent / Zabbix Codex.

Version visible actual: `v0.21.0`.

## Funciones principales

- Dashboard operativo de infraestructura.
- Chat textual y voz para consultas operativas.
- `/agent-display`: centro visual con avatar, carrusel inteligente, informe ejecutivo, resumen de infraestructura y Power BI.
- Power BI semantico con Ask Lab, DAX Lab, consultas sugeridas y vista ejecutiva.
- Comunicaciones: borradores, revision, preparacion y envio con bloqueos de seguridad.
- Firewalls / Red perimetral como categoria propia.
- Autenticacion corporativa con Active Directory, RBAC y auditoria.

## Stack

- Next.js 13 Pages Router.
- React 18.
- NextAuth/Auth.js para sesion.
- LDAP/LDAPS contra Active Directory via backend.
- SQLite local para datos runtime de la app.
- Nginx como reverse proxy HTTPS recomendado.

## Instalacion

```bash
cd /opt/zabbix-codex/infra-agent-web
npm install
```

## Desarrollo local

```bash
npm run dev:local
```

URL:

```text
http://127.0.0.1:3010
```

## Build

```bash
npm run test:security
npm run build
```

## Produccion

Servicio esperado:

```bash
systemctl status infra-agent-web.service --no-pager
```

El servicio Next.js debe escuchar en `127.0.0.1:3010`. Publicar por HTTPS mediante Nginx u otro reverse proxy interno.

## Seguridad

La app no guarda usuarios ni contrasenas propios. La identidad se valida contra Active Directory mediante LDAPS.

Variables principales:

- `AUTH_SECRET`
- `AD_URL`
- `AD_BASE_DN`
- `AD_DOMAIN`
- `AD_UPN_SUFFIX`
- `AD_BIND_DN`
- `AD_BIND_PASSWORD`
- `AD_SEARCH_FILTER`
- `AD_GROUP_ADMIN`
- `AD_GROUP_OPERATOR`
- `AD_GROUP_VIEWER`
- `AD_GROUP_DISPLAY`
- `AD_GROUP_POWERBI`
- `AD_GROUP_AUDITOR`
- `SECURITY_RBAC_ENFORCE`
- `SECURITY_ALLOW_UNMAPPED_USERS`

Documentacion completa:

```text
../docs/security/
```

## Variables de entorno

Use `.env.local` solo en entorno local o variables del servicio systemd en produccion. No subir `.env.local` a Git.

Plantilla:

```bash
cp .env.example .env.local
```

## Endpoints utiles

```bash
curl -s http://127.0.0.1:3010/api/health
curl -I http://127.0.0.1:3010/agent-display
```

## Notas de publicacion

El historial completo esta en:

```text
../reports/CHANGELOG.md
```
