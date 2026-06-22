# Monitoring implementation roadmap

## Fase 5A: Proxmox, storage y backups

Comparar Zabbix contra Proxmox/PBS, cerrar huecos de VMs, datastores, snapshots, backups y SMART de nodos.

## Fase 5B: NAS, SMART y RAID

Normalizar QNAP/NAS, validar NasAlmeria HDD 5, pools, volumenes, RAID y temperatura.

## Fase 5C: SAIs/UPS

Ajustar templates Eaton por modelo/MIB, conservar solo OIDs soportadas y definir severidades de bateria/carga/autotest.

## Fase 5D: Firewalls / Red perimetral y switches

Inventario de red, interfaces, errores, VPN/HA si aplica, firmware y backup de configuracion.

## Fase 5E: impresoras

Clasificar impresoras activas, retiradas o sin SNMP; plantilla por modelo y alertas de consumibles.

## Fase 5F: servidores fisicos

Agente, filesystem, servicios, hardware, RAID, SMART, backups y actualizaciones.

## Fase 5G: servicios de aplicacion

HTTP, certificados, bases de datos, procesos, logs y dependencias de negocio.

## Fase 5H: politica de alertas y notificaciones

Severidades, ventanas, escalados, grupos notificables y reduccion de ruido.

## Fase 5I: agente diario inteligente sobre Zabbix

Generador diario de estado, riesgos, huecos, recomendaciones y propuestas de cambio.
