# Productizacion de infra-agent

Esta carpeta esta separada del servicio en produccion. No la carga `infra-agent-web`, no modifica `systemd` y no contiene secretos.

Objetivo:

- Preparar una version reutilizable del proyecto para demos y futuras implantaciones en otras empresas.
- Separar el nucleo del producto de la configuracion especifica de cada cliente.
- Evitar tocar la instancia actual de produccion mientras se define el empaquetado.

## Estructura propuesta

- `tenant-template/`: configuracion base para un cliente nuevo.
- `demo-template/`: reglas y datos esperados para una demo sin datos reales.
- `commercial-template/`: paquete base de demo/venta con configuracion, guion y datos sinteticos.
- `release-package/`: checklist para preparar una entrega instalable.
- `scripts/`: utilidades de empaquetado seguro.
- `dist/`: salida generada para copias sanitizadas.

## Estrategia recomendada

1. Mantener `infra-agent-web` como producto base.
2. Extraer configuracion por empresa a un fichero de tenant.
3. Crear un modo demo con datos sinteticos o anonimizados.
4. Empaquetar por cliente sin copiar secretos ni bases de datos reales.
5. Automatizar despliegues solo cuando la separacion cliente/producto este validada.

## Regla de seguridad

No copiar a demos ni entregas:

- `.env.local`
- bases SQLite reales
- logs de produccion
- tokens
- secretos Graph/OpenAI/Power BI/Zabbix
- datos personales reales
- endpoints internos no necesarios para demo

## Proximo paso tecnico sugerido

Crear una capa de configuracion leida por el frontend/backend, por ejemplo:

- `config/tenant.config.json`
- `config/features.config.json`
- `config/branding.config.json`

La instancia de produccion debe seguir usando su configuracion actual hasta que esta capa este probada en un entorno separado.

## Copia sanitizada preparada

Se puede generar una copia comercial de `infra-agent-web` sin tocar produccion:

```bash
productization/scripts/create-sanitized-template.sh
```

Salida por defecto:

```text
productization/dist/infra-agent-web-template
```

La copia excluye:

- `.env.local`,
- `.next`,
- `node_modules`,
- contenido de `data/`,
- logs,
- temporales.

Ademas sustituye `config/powerbi-models.json` por un modelo demo placeholder para no copiar workspace/dataset IDs reales.

Tambien incorpora dentro de la copia la carpeta `productization/` con:

- `.env.template`,
- configuracion de branding,
- configuracion de modulos,
- datos demo sinteticos,
- guion comercial,
- notas de despliegue.
- demo portable offline,
- perfil generico de conectores demo.

En la raiz de la copia tambien deja:

- `Dockerfile.demo`,
- `docker-compose.demo.yml`.

Si el destino ya existe, el script se detiene para no pisar una copia anterior.
