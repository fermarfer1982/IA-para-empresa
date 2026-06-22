# Portable demo kit

Este kit esta pensado para llevar el producto a otro equipo y presentarlo sin depender de los sistemas reales de la empresa.

## Idea principal

La demo debe ser generica:

- Si el cliente tiene Zabbix, se presenta como conector de monitorizacion.
- Si tiene otro sistema, se presenta como integracion adaptable.
- Si no tiene monitorizacion, se presenta con datos demo y roadmap de implantacion.

## Dos formas de demo

### Demo completa

Usa una copia sanitizada de `infra-agent-web`.

Requisitos:

- Linux, macOS o Windows con WSL.
- Node.js 20 o Docker.
- Navegador moderno.

Ventaja:

- Enseña la aplicacion real.

Limitacion:

- Algunas integraciones reales quedan apagadas si no hay credenciales.

### Demo offline

Usa un click-through HTML estatico.

Requisitos:

- Cualquier navegador.

Ventaja:

- No necesita Node, Docker, internet ni credenciales.
- Sirve para reuniones comerciales rapidas.

Limitacion:

- No ejecuta el backend real.

## Recomendacion comercial

Llevar siempre las dos:

1. Demo completa para mostrar el producto real.
2. Demo offline como respaldo si falla red, VPN, permisos o instalacion.

## Mensaje comercial generico

> La plataforma se conecta a las herramientas que ya tenga la empresa: Zabbix, GLPI, Jira, SharePoint, Power BI, ERP, bases de datos o APIs internas. Si no existe una herramienta previa, puede operar con datos demo o con un conector nuevo.
