# Checklist antes de presentar

## Equipo demo

- La app arranca en `http://127.0.0.1:3020`.
- El navegador abre sin certificados ni VPN.
- Hay una copia offline de respaldo.
- El equipo no depende de la red del cliente.

## Seguridad

- `DEMO_MODE=true`.
- `COMMUNICATIONS_DISABLE_REAL_SEND=true`.
- `DEMO_DISABLE_EXTERNAL_WRITES=true`.
- No hay `.env.local` real.
- No hay base SQLite real.
- No hay logs reales.
- No hay tokens reales.

## Guion

- Dashboard operativo.
- Incidencias demo.
- Comunicaciones con borrador demo.
- Power BI con preguntas demo.
- Voz opcional.
- Explicacion de conectores.

## Preguntas esperadas

- Que pasa si no tengo Zabbix.
- Que pasa si uso Jira/GLPI/ServiceNow.
- Que pasa si no tengo Power BI.
- Donde quedan los datos.
- Que permisos necesita.
- Como se auditan los envios.
- Que se puede automatizar y que no.
