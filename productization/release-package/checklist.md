# Checklist de paquete comercial

## Antes de copiar o entregar

- Verificar que no se incluye `.env.local`.
- Verificar que no se incluye `infra-agent-web/data/infra-agent.db` real.
- Verificar que no se incluyen logs de produccion.
- Verificar que no se incluyen secretos ni tokens.
- Verificar que el modo demo desactiva envio real.
- Verificar que SharePoint y Zabbix estan en modo solo lectura para demo.

## Configuracion por cliente

- Crear `tenant.config.json` desde `tenant-template/tenant.config.example.json`.
- Definir branding.
- Definir modulos activos.
- Definir dominios permitidos para email.
- Definir conectores disponibles.
- Definir plantillas de comunicacion.
- Definir modelo Power BI o dataset demo.

## Validacion funcional

- Arranca la aplicacion.
- Carga dashboard.
- Carga Comunicaciones.
- Crea borrador en modo demo.
- Bloquea envio real si `disable_real_email_send=true`.
- Carga Power BI demo.
- Ejecuta consulta Power BI demo.
- Voz no ejecuta acciones destructivas.

## Entregables minimos

- Codigo del producto sin secretos.
- Configuracion de ejemplo.
- Guia de instalacion.
- Guia de demo.
- Checklist de seguridad.
- Matriz de modulos incluidos.
