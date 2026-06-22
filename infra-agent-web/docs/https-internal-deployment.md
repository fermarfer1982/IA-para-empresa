# HTTPS interno para infra-agent-web

La consola ChatKit debe servirse desde `localhost` o desde HTTPS valido. El acceso por IP LAN en HTTP no es suficiente para ChatKit.

## Arquitectura aplicada

- Next.js escucha solo en `127.0.0.1:3010`.
- Nginx expone HTTPS interno en `443/tcp`.
- Dominio interno principal: `agente-infra.local`.
- Alias: `infra-agent.local`.
- `OPENAI_API_KEY` y `OPENAI_WORKFLOW_ID` permanecen en `/opt/zabbix-codex/infra-agent-web/.env.local`.
- Nginx no conoce ni expone secretos.
- Caddy era la preferencia inicial, pero no estaba disponible en este servidor; se aplico Nginx como alternativa.

## DNS o hosts de clientes

Los equipos cliente deben resolver:

```text
192.168.100.124 agente-infra.local infra-agent.local
```

Puede hacerse en DNS interno o en el fichero `hosts` del cliente.

## Certificado

Se usa un certificado interno para la demo. Para evitar avisos del navegador y asegurar contexto seguro completo, instalar el certificado o CA interna en los equipos cliente como confiable.

Ficheros en el servidor:

```text
/etc/pki/tls/certs/infra-agent-web.crt
/etc/pki/tls/private/infra-agent-web.key
```

No copiar la clave privada a clientes.

## Comandos de validacion

```bash
systemctl status infra-agent-web.service --no-pager
curl http://127.0.0.1:3010
curl -k https://agente-infra.local
```

## Seguridad

- No abrir `3010/tcp` en firewall.
- Mantener solo `443/tcp` para acceso web interno.
- Mantener SSH.
- No declarar secretos con prefijo `NEXT_PUBLIC_`.
- No tocar MCPs, Zabbix ni SharePoint desde esta consola.
- En Rocky/RHEL, Nginx puede necesitar `httpd_can_network_connect=on` para hacer proxy a `127.0.0.1:3010`.
