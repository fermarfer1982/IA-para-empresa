# Politica inicial de alertas Zabbix

Esta politica es un borrador para que el futuro agente priorice alertas sin silenciarlas automaticamente.

## Disaster

- NAS/SMART/RAID: RAID failed, volumen inaccesible, pool critico sin margen, multiples discos con SMART abnormal.
- Proxmox/storage: cluster sin quorum, datastore critico, nodo productivo caido con VMs criticas.
- Backups: backups criticos ausentes durante varios ciclos con riesgo de perdida de datos.
- Firewalls: firewall principal caido, HA caida total, perdida de conectividad WAN critica.
- Bases de datos/servicios: base de datos principal caida, servicio core indisponible.

## High

- NAS/SMART/RAID: un disco con SMART abnormal, RAID degraded, pool al 0% o por debajo de umbral critico.
- Proxmox: API no disponible, nodo caido, storage sin espacio, PBS inaccesible.
- Backups: ultimo backup fallido en sistemas criticos o repositorio sin espacio.
- SAIs: equipo en bateria prolongada, bateria degradada, runtime bajo.
- Servidores fisicos: RAID degradado, disco fisico con fallo predictivo, filesystem critico.
- Certificados: certificado critico vencido o a menos de 3 dias.

## Average

- Servicios importantes caidos pero con alternativa o bajo impacto inmediato.
- CPU/RAM/disco alto sostenido.
- UPS con carga alta, temperatura anomala o autotest fallido no critico.
- Firewall/VPN degradado pero no caido.
- Impresora critica sin respuesta SNMP durante horario laboral.

## Warning

- Consumibles de impresora bajos.
- Latencia, errores de interfaz o reinicios no criticos.
- Certificados con vencimiento proximo.
- Backups con retraso leve en sistemas no criticos.

## Information

- Cambios de inventario, reinicios esperados, nuevas VMs/hosts descubiertos.
- Versiones de firmware o paquetes pendientes de revisar.
- Alertas de documentacion o normalizacion.
