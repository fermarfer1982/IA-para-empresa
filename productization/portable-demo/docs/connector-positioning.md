# Posicionamiento de conectores

## Mensaje tecnico

El producto no depende de Zabbix. Zabbix es un conector posible.

La arquitectura comercial debe presentarse asi:

- Monitorizacion: Zabbix, Prometheus, PRTG, Centreon, Datadog, Nagios, API propia o demo.
- Incidencias: SharePoint, Jira, GLPI, ServiceNow, Freshservice, Excel/CSV o demo.
- BI: Power BI, SQL, Excel, ERP, API de ventas o demo.
- Comunicaciones: Microsoft Graph, SMTP corporativo, borradores locales o demo.
- Directorio: Entra ID, LDAP, CSV o demo.

## Niveles de integracion

- Nivel 0: demo sin integraciones reales.
- Nivel 1: lectura de datos.
- Nivel 2: acciones asistidas con confirmacion.
- Nivel 3: automatizaciones controladas.

## Como hablar de Zabbix

Frase recomendada:

> En nuestra instalacion usamos Zabbix, pero la capa de monitorizacion esta pensada para conectarse a la herramienta que use cada cliente.

## Si el cliente no tiene monitorizacion

Frase recomendada:

> Podemos empezar con un inventario ligero, checks basicos y datos demo, y despues conectar o desplegar una herramienta de monitorizacion si aporta valor.
