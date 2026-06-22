# Infra Agent commercial template

Esta carpeta describe como convertir la instancia actual en una base comercial reutilizable sin tocar produccion.

## Que incluye

- Configuracion de tenant.
- Branding.
- Modulos activos.
- `.env` de referencia sin secretos.
- Guion de demo comercial.
- Datos demo sinteticos.
- Checklist de seguridad y despliegue.

## Que no incluye

- Secretos.
- `.env.local`.
- Base SQLite real.
- Logs de produccion.
- Tokens.
- Configuracion real de clientes.

## Flujo recomendado

1. Generar una copia sanitizada con `productization/scripts/create-sanitized-template.sh`.
2. Revisar el resultado en `productization/dist/`.
3. Crear un tenant desde `config/tenant.config.example.json`.
4. Preparar datos demo o anonimizados.
5. Levantar la copia en un puerto distinto al de produccion.
6. Validar el guion de demo.

## Modos de uso

- Demo comercial: datos sinteticos, envio real desactivado, conectores write desactivados.
- Piloto cliente: conectores reales en read-only y Power BI del cliente si hay permisos.
- Implantacion productiva: configuracion y permisos revisados por cliente, con secretos fuera del repositorio.

## Regla principal

La plantilla comercial se prepara fuera de `infra-agent-web` y se copia a un entorno separado. La instancia de produccion no debe usarse como entorno de demo externo.
