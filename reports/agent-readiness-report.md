# Agent readiness report

## Resumen ejecutivo

Zabbix ya contiene inventario, problemas activos, templates, items, triggers, unsupported y datos de disponibilidad suficientes para una primera version del agente. La preparacion es parcial: faltan normalizar tipos de activo, criticidad, cobertura de backup/Proxmox/NAS/SAI y distinguir ruido de alertas reales de forma sistematica.

## Que necesita Zabbix para que el agente sea util

- Inventario consistente por tipo de activo, ubicacion y criticidad.
- Checks base por dominio: Proxmox, NAS, backups, SAIs, red, firewalls, servidores, impresoras y servicios.
- Alertas con severidad alineada a impacto operativo.
- Evidencia de backup y storage que permita decidir si hay riesgo de perdida de datos.
- Datos historicos recientes y unsupported reducidos para no confundir fallos reales con ruido.

## Datos ya disponibles

- Hosts conocidos: `54`.
- Templates conocidos: `362`.
- Problemas activos por severidad: `{'Average': 20, 'High': 3, 'Information': 16, 'Warning': 22}`.
- Unsupported enabled en base de conocimiento: `90`.
- Diagnostico SNMP externo: `{'conclusions': {'sin_interfaz_snmp_en_zabbix': 4, 'sin_respuesta_snmp_timeout_red_acl_equipo': 5, 'snmp_responde_checks_basicos_ok': 3, 'snmp_responde_pero_hay_oids_no_soportadas_template_mib': 6}, 'failed_unsupported_oid_probes': 15, 'snmp_not_reachable': 9, 'snmp_reachable': 9, 'targets_total': 18}`.
- Diagnostico zabbix_get local: `{'checks_failed': 1, 'checks_ok': 12, 'checks_total': 13}`.

## Datos que faltan

| Check faltante | Hosts |
| --- | --- |
| agent | 5 |
| agent_or_snmp | 2 |
| availability | 2 |
| backup | 25 |
| cpu | 2 |
| errors | 2 |
| filesystem | 5 |
| firmware | 5 |
| ha | 3 |
| interface | 2 |
| inventory | 2 |
| lan | 3 |
| memory | 3 |
| self_test | 2 |
| service | 4 |
| sessions | 3 |
| smart | 1 |
| snmp | 3 |
| storage | 1 |
| temperature | 3 |
| traffic | 3 |
| uptime | 3 |
| vpn | 3 |
| wan | 3 |

## Templates/checks faltantes

- Proxmox: comparar inventario real de nodos, VMs/CTs, datastores, PBS, backups y SMART contra Zabbix.
- NAS: SMART/RAID/pools/volumenes normalizados y acciones operativas para fallos fisicos.
- SAIs: plantilla ajustada por modelo Eaton y OIDs realmente soportadas.
- Impresoras: perfil por fabricante/modelo y decision de mantenimiento/retirada para equipos sin datos.
- Firewalls / Red perimetral: interfaces, errores, VPN, HA, CPU/RAM, firmware y backup de configuracion.
- Servidores: backup, servicios criticos, certificados, bases de datos y hardware fisico si aplica.

## Alertas que hay que disenar

- High/Disaster para perdida de datos: SMART abnormal, RAID degraded, pool lleno, backup fallido repetido, datastore critico.
- Average para degradacion: UPS en bateria, servicios criticos caidos, alta carga sostenida, filesystem alto.
- Warning/Information para mantenimiento: impresoras sin toner, firmware, reinicios, cambios de inventario.

## Automatizable

- Regenerar informes y JSON de conocimiento.
- Crear templates nuevos no asignados.
- Preparar checks auxiliares en modo no vinculado.
- Detectar hosts sin cobertura esperada y abrir propuestas de cambio.

## Requiere intervencion humana

- SMART, discos, RAID, pools, storage y backups.
- Cambios sobre templates ya usados, triggers, acciones y notificaciones.
- Deshabilitar/borrar items o hosts.
- Cambiar macros SNMP o credenciales.
- Decidir retirada o mantenimiento de impresoras.

## Hosts prioritarios

| Host | Tipo | Prioridad | Problemas | Unsupported | Faltan |
| --- | --- | --- | --- | --- | --- |
| NasAlmeria | nas | CRITICO | 2 | 4 | backup |
| NasRamiroA | nas | CRITICO | 3 | 4 | backup |
| AP1 CISCO | network | ALTO | 0 | 0 | firmware |
| AP2 CISCO | network | ALTO | 0 | 0 | firmware |
| Active | server | ALTO | 2 | 0 | backup |
| DellEMC PowerEdge R540  ALMERIA   IDRAC | server | ALTO | 0 | 0 | agent, filesystem, backup |
| EATON 5PX 2200 ( SAI GALLARZA ) | ups | ALTO | 0 | 10 | self_test |
| EATON 5PX 2200 SAI ALMERIA | ups | ALTO | 0 | 10 | self_test |
| HP V1810-48G GALLARZA | network | ALTO | 0 | 2 | interface, errors, memory |
| LP-FERNANDO | server | ALTO | 5 | 2 | backup |
| NAS-CALAHORRA | nas | ALTO | 1 | 2 | backup |
| NASALM1 | nas | ALTO | 2 | 2 | backup |
| NASALM2 | nas | ALTO | 1 | 2 | backup |
| NasGenomica | nas | ALTO | 0 | 8 | backup |
| NasRamiroB | nas | ALTO | 1 | 2 | backup |
| PBS Backup Monitoring | backup_server | ALTO | 0 | 0 | agent, filesystem, service, cpu, memory |
| PROLIANT ML350P GEN8 ILO | server | ALTO | 3 | 0 | agent, filesystem, backup, service |
| Proxmox Storage Monitoring | proxmox | ALTO | 0 | 0 | smart, service |
| SERAPLI | server | ALTO | 1 | 0 | backup |
| SERTS | server | ALTO | 3 | 0 | backup |
| SERTSBROKER | server | ALTO | 1 | 0 | backup |
| SERVER_2019_BBD | server | ALTO | 2 | 0 | backup |
| SRVCOPIAS | backup_server | ALTO | 2 | 2 |  |
| SRVPDC | server | ALTO | 1 | 0 | backup |
| SRVPLANA | server | ALTO | 0 | 0 | backup |
| SrvBackupALM | backup_server | ALTO | 2 | 2 |  |
| SrvPdcALM | server | ALTO | 3 | 0 | backup |
| Switch JL685A Almeria | network | ALTO | 1 | 0 | interface, errors, memory |
| Zabbix server | zabbix_server | ALTO | 1 | 13 | backup |
| esxibck.semillas.local | server | ALTO | 0 | 0 | agent, filesystem, service, cpu |

