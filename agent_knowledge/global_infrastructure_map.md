# Global Infrastructure Map

Generado: 2026-06-02 08:26:09 CEST

## Resumen ejecutivo

Zabbix contiene 54 hosts y ya dispone de datos suficientes para empezar a construir un agente inteligente, pero la preparación es desigual por bloque. Proxmox/PBS avanzó más que el resto; NAS, SAIs, impresoras, red y servidores físicos requieren atención para que el agente no tenga una visión sesgada.

## Mapa de tipos detectados

| Tipo | Hosts |
| --- | --- |
| backup_system | 3 |
| firewall | 3 |
| idrac | 2 |
| ilo | 1 |
| network_device | 2 |
| pbs | 1 |
| printer | 16 |
| proxmox_node | 3 |
| proxmox_vm | 6 |
| qnap | 7 |
| switch | 2 |
| unknown | 2 |
| ups_sai | 2 |
| windows_server | 3 |
| zabbix_server | 1 |

## Scoring de preparación para el agente

0 = no monitorizado; 1 = disponibilidad básica; 2 = métricas básicas; 3 = métricas + triggers; 4 = datos accionables; 5 = listo para agente inteligente.

| Bloque | Score | Estado | Hosts | Unsupported | High/Disaster | Motivo |
| --- | --- | --- | --- | --- | --- | --- |
| Proxmox/PBS | 4 | datos accionables | 4 | 1 | 0 | Bloque con inventario real Proxmox/PBS, hosts técnicos e items trapper ya recibiendo datos; falta periodicidad y habilitar política. |
| NAS | 2 | métricas básicas | 7 | 24 | 3 | Hay métricas y triggers, pero persisten 24 unsupported y 14 huecos. Además hay 3 problema(s) High/Disaster activo(s). |
| Firewalls / Red perimetral | 2 | métricas básicas | 3 | 4 | 0 | Hay métricas y triggers, pero persisten 4 unsupported y 32 huecos. |
| Switches | 3 | métricas + triggers | 4 | 2 | 0 | Hay métricas y triggers, pero persisten 2 unsupported y 13 huecos. |
| SAIs | 2 | métricas básicas | 2 | 20 | 0 | Hay métricas y triggers, pero persisten 20 unsupported y 6 huecos. |
| Impresoras | 2 | métricas básicas | 16 | 20 | 0 | Hay métricas y triggers, pero persisten 20 unsupported y 28 huecos. |
| Servidores físicos | 4 | datos accionables | 3 | 0 | 0 | Hay datos y triggers sin huecos evidentes en el análisis actual. |
| Windows/Linux | 3 | métricas + triggers | 9 | 2 | 0 | Hay métricas y triggers, pero persisten 2 unsupported y 12 huecos. |
| Servicios/aplicaciones | 0 | no monitorizado | 0 | 0 | 0 | No se detectaron hosts del bloque en Zabbix. |
| Zabbix interno | 2 | métricas básicas | 1 | 13 | 0 | Hay métricas y triggers, pero persisten 13 unsupported y 4 huecos. |
| Backups | 3 | métricas + triggers | 4 | 4 | 0 | Hay métricas y triggers, pero persisten 4 unsupported y 10 huecos. |

## Hosts clasificados

| Host | Tipo | Subtipo | Prioridad | Criticidad | Items | Triggers | Unsupported | Problems | Cobertura | Faltan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NasAlmeria | qnap | nas_qnap | CRITICO | critica | 96 | 45 | 4 | 2 | parcial | backup |
| NasRamiroA | qnap | nas_qnap | CRITICO | critica | 70 | 33 | 4 | 3 | parcial | backup |
| PROLIANT ML350P GEN8 ILO | ilo | hp_out_of_band | ALTO | media-alta | 147 | 167 | 0 | 3 | buena |  |
| PBS Backup Monitoring | pbs | technical_backup_metrics_host | ALTO | alta | 13 | 0 | 0 | 0 | sin_datos_recientes | api, job |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | printer | snmp_printer | ALTO | baja | 52 | 6 | 3 | 3 | sin_datos_recientes |  |
| HP LASERJET PRO 4002DN GALLARZA JULIAN JR | printer | snmp_printer | ALTO | baja | 52 | 6 | 2 | 4 | parcial |  |
| HP LASERJET PRO M404DN GALLARZA | printer | snmp_printer | ALTO | baja | 52 | 6 | 3 | 4 | sin_datos_recientes |  |
| HP LASERJET PRO M404DN GALLARZA JORGE | printer | snmp_printer | ALTO | baja | 52 | 6 | 0 | 3 | buena |  |
| HP LASERJET PRO M404DN GALLARZA VICTOR | printer | snmp_printer | ALTO | baja | 52 | 6 | 0 | 4 | buena |  |
| ZEBRA ALMERIA | printer | snmp_printer | ALTO | baja | 8 | 1 | 5 | 0 | parcial | toner, paper |
| Proxmox Storage Monitoring | proxmox_node | technical_storage_metrics_host | ALTO | alta | 9 | 0 | 0 | 0 | sin_datos_recientes | availability, api, cpu, memory, quorum |
| proxmox-gallarza | proxmox_node | hypervisor | ALTO | alta | 353 | 107 | 0 | 0 | parcial | api, quorum, job, backup |
| proxmoxalmeria | proxmox_node | hypervisor | ALTO | alta | 230 | 94 | 1 | 0 | parcial | api, storage, quorum, job, backup |
| SERTS | proxmox_vm | windows_vm | ALTO | media-alta | 117 | 83 | 0 | 3 | parcial | backup |
| NAS-CALAHORRA | qnap | nas_qnap | ALTO | alta | 100 | 48 | 2 | 1 | parcial | backup |
| NASALM1 | qnap | nas_qnap | ALTO | alta | 61 | 29 | 2 | 2 | parcial | backup |
| NASALM2 | qnap | nas_qnap | ALTO | alta | 61 | 29 | 2 | 1 | parcial | backup |
| NasGenomica | qnap | nas_qnap | ALTO | alta | 145 | 72 | 8 | 0 | parcial | backup |
| NasRamiroB | qnap | nas_qnap | ALTO | alta | 70 | 33 | 2 | 1 | parcial | backup |
| EATON 5PX 2200 SAI ALMERIA | ups_sai | ups_snmp | ALTO | media-alta | 16 | 11 | 10 | 0 | parcial | load, self_test |
| EATON 5PX 2200 SAI GALLARZA | ups_sai | ups_snmp | ALTO | media-alta | 16 | 11 | 10 | 0 | parcial | load, self_test |
| LP-FERNANDO | windows_server | windows_or_service_host | ALTO | media-alta | 160 | 116 | 2 | 5 | parcial | updates, backup |
| SrvPdcALM | windows_server | windows_or_service_host | ALTO | media-alta | 127 | 85 | 0 | 3 | parcial | backup |
| Zabbix server | zabbix_server | zabbix_internal | ALTO | alta | 160 | 88 | 13 | 1 | parcial | queue, processes, backup |
| SRVCOPIAS | backup_system | backup_server | MEDIO | alta | 144 | 110 | 2 | 2 | parcial | job |
| SrvBackupALM | backup_system | backup_server | MEDIO | alta | 140 | 106 | 2 | 2 | parcial | job |
| esxibck.semillas.local | backup_system | backup_server | MEDIO | alta | 33 | 18 | 0 | 0 | parcial | availability, service, job |
| pfSense-La-Plana | firewall | security_gateway | MEDIO | alta | 110 | 45 | 2 | 1 | parcial | snmp, traffic, wan, lan, vpn |
| pfSense-almeria | firewall | security_gateway | MEDIO | alta | 110 | 45 | 2 | 1 | parcial | snmp, traffic, wan, lan, vpn |
| pfSenseGallarza | firewall | security_gateway | MEDIO | alta | 124 | 45 | 0 | 0 | parcial | snmp, traffic, wan, lan, vpn |
| AP1 | network_device | access_point_or_network | MEDIO | media-alta | 62 | 26 | 0 | 0 | parcial | traffic, firmware |
| AP2 | network_device | access_point_or_network | MEDIO | media-alta | 62 | 26 | 0 | 0 | parcial | traffic, firmware |
| BROTHER HL-L2370DN series | printer | snmp_printer | MEDIO | baja | 8 | 1 | 0 | 0 | parcial | toner, paper |
| BROTHER HL-L2375DW series | printer | snmp_printer | MEDIO | baja | 8 | 1 | 0 | 0 | parcial | toner, paper |
| BROTHER HL-L2445DW | printer | snmp_printer | MEDIO | baja | 8 | 1 | 0 | 0 | sin_datos_recientes | toner, paper |
| BROTHER HL-L8360CDW series | printer | snmp_printer | MEDIO | baja | 8 | 1 | 1 | 0 | parcial | toner, paper |
| CANON iR-ADV C3830 | printer | snmp_printer | MEDIO | baja | 8 | 1 | 0 | 0 | sin_datos_recientes | toner, paper |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | printer | snmp_printer | MEDIO | baja | 61 | 6 | 3 | 2 | parcial | toner |
| HP COLOR LASERJET E45028 GALLARZA INTERNACIONAL | printer | snmp_printer | MEDIO | baja | 61 | 6 | 0 | 0 | parcial | toner |
| HP COLOR LASERJET E45028 GALLARZA MICAELA | printer | snmp_printer | MEDIO | baja | 61 | 6 | 0 | 0 | parcial | toner |
| HP COLOR LASERJET E45028 GALLARZA PRODUCCIONES | printer | snmp_printer | MEDIO | baja | 61 | 6 | 0 | 0 | parcial | toner |
| HP LASERJET M402DN GALLARZA SERGIO | printer | snmp_printer | MEDIO | baja | 34 | 2 | 3 | 1 | sin_datos_recientes |  |
| Active | proxmox_vm | windows_vm | MEDIO | media-alta | 108 | 74 | 0 | 2 | parcial | backup |
| SERAPLI | proxmox_vm | windows_vm | MEDIO | media-alta | 136 | 94 | 0 | 1 | parcial | backup |
| SERTSBROKER | proxmox_vm | windows_vm | MEDIO | media-alta | 118 | 84 | 0 | 1 | parcial | backup |
| SERVER_2019_BBD | proxmox_vm | windows_vm | MEDIO | media-alta | 117 | 83 | 0 | 2 | parcial | backup |
| SRVPDC | proxmox_vm | windows_vm | MEDIO | media-alta | 119 | 85 | 0 | 1 | parcial | backup |
| HP V1810-48G GALLARZA | switch | ethernet_switch | MEDIO | media-alta | 15 | 9 | 2 | 0 | parcial | interface, traffic, errors, uplinks |
| Switch JL685A Almeria | switch | ethernet_switch | MEDIO | media-alta | 15 | 9 | 0 | 1 | parcial | interface, traffic, errors, uplinks |
| FICHADOR ALMERIA | unknown | unknown | MEDIO | media | 3 | 3 | 0 | 0 | parcial | inventory |
| FICHADOR GALLARZA | unknown | unknown | MEDIO | media | 3 | 3 | 0 | 0 | parcial | inventory |
| SRVPLANA | windows_server | windows_or_service_host | MEDIO | media-alta | 130 | 88 | 0 | 0 | parcial | updates, backup |
| DellEMC PowerEdge R540  ALMERIA   IDRAC | idrac | dell_out_of_band | BAJO | media-alta | 121 | 87 | 0 | 0 | buena |  |
| DellEMC PowerEdge R540 GALLARZA   IDRAC | idrac | dell_out_of_band | BAJO | media-alta | 108 | 83 | 0 | 0 | buena |  |

## NAS/QNAP

- Hosts detectados: 7.
- Hosts: NAS-CALAHORRA, NASALM1, NASALM2, NasAlmeria, NasGenomica, NasRamiroA, NasRamiroB.
- Huecos: Checks faltantes frecuentes: backup(7); 24 items unsupported en el bloque.; Falta cerrar el modelo de SMART/RAID/storage/backups de NAS; NasAlmeria mantiene alerta SMART real..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| NasAlmeria | qnap | CRITICO | 2 | 4 | backup, unsupported_items | Atender primero los problemas High/Disaster activos y confirmar impacto operativo. |
| NasRamiroA | qnap | CRITICO | 3 | 4 | backup, unsupported_items | Atender primero los problemas High/Disaster activos y confirmar impacto operativo. |
| NAS-CALAHORRA | qnap | ALTO | 1 | 2 | backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| NASALM1 | qnap | ALTO | 2 | 2 | backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| NASALM2 | qnap | ALTO | 1 | 2 | backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| NasGenomica | qnap | ALTO | 0 | 8 | backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| NasRamiroB | qnap | ALTO | 1 | 2 | backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |

## Firewalls / Red perimetral

- Hosts detectados: 3.
- Hosts: pfSense-almeria, pfSense-La-Plana, pfSenseGallarza.
- Huecos: Checks faltantes frecuentes: snmp(3), traffic(3), wan(3), lan(3), vpn(3), ha(3), uptime(3), sessions(3); 4 items unsupported en el bloque.; Firewall detectado, pero faltan métricas SNMP/plantillas/triggers para evaluación completa..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| pfSense-almeria | firewall | MEDIO | 1 | 2 | snmp, traffic, wan, lan, vpn | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| pfSense-La-Plana | firewall | MEDIO | 1 | 2 | snmp, traffic, wan, lan, vpn | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| pfSenseGallarza | firewall | MEDIO | 0 | 0 | snmp, traffic, wan, lan, vpn | Firewall detectado, pero faltan métricas SNMP/plantillas/triggers para evaluación completa: snmp, traffic, wan, lan, vpn, ha, uptime, sessions |

## Switches

- Hosts detectados: 4.
- Hosts: AP1, AP2, HP V1810-48G GALLARZA, Switch JL685A Almeria.
- Huecos: Checks faltantes frecuentes: traffic(4), firmware(2), interface(2), errors(2), uplinks(2); 2 items unsupported en el bloque..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| AP1 | network_device | MEDIO | 0 | 0 | traffic, firmware | Completar checks faltantes: traffic, firmware |
| AP2 | network_device | MEDIO | 0 | 0 | traffic, firmware | Completar checks faltantes: traffic, firmware |
| HP V1810-48G GALLARZA | switch | MEDIO | 0 | 2 | interface, traffic, errors, uplinks, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| Switch JL685A Almeria | switch | MEDIO | 1 | 0 | interface, traffic, errors, uplinks | Completar checks faltantes: interface, traffic, errors, uplinks |

## SAIs/UPS

- Hosts detectados: 2.
- Hosts: EATON 5PX 2200 SAI ALMERIA, EATON 5PX 2200 SAI GALLARZA.
- Huecos: Checks faltantes frecuentes: load(2), self_test(2); 20 items unsupported en el bloque.; SAIs Eaton tienen OIDs no soportadas; falta validar MIB/modelo/firmware y self-test/autonomía..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| EATON 5PX 2200 SAI ALMERIA | ups_sai | ALTO | 0 | 10 | load, self_test, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| EATON 5PX 2200 SAI GALLARZA | ups_sai | ALTO | 0 | 10 | load, self_test, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |

## Impresoras

- Hosts detectados: 16.
- Hosts: BROTHER HL-L2370DN series, BROTHER HL-L2375DW series, BROTHER HL-L2445DW, BROTHER HL-L8360CDW series, CANON iR-ADV C3830, HP COLOR LASERJET E45028 GALLARZA INFORMATICA, HP COLOR LASERJET E45028 GALLARZA INTERNACIONAL, HP COLOR LASERJET E45028 GALLARZA MICAELA, HP COLOR LASERJET E45028 GALLARZA PRODUCCIONES, HP LASERJET M402DN GALLARZA SERGIO, HP LASERJET PRO 4002DN GALLARZA ALFONSO, HP LASERJET PRO 4002DN GALLARZA JULIAN JR, HP LASERJET PRO M404DN GALLARZA, HP LASERJET PRO M404DN GALLARZA JORGE, HP LASERJET PRO M404DN GALLARZA VICTOR, ZEBRA ALMERIA.
- Huecos: Checks faltantes frecuentes: toner(10), paper(6); 20 items unsupported en el bloque.; Hosts sin datos recientes: BROTHER HL-L2445DW, CANON iR-ADV C3830, HP LASERJET M402DN GALLARZA SERGIO, HP LASERJET PRO 4002DN GALLARZA ALFONSO, HP LASERJET PRO M404DN GALLARZA.; Hay impresoras SNMP sin datos recientes; falta confirmar si siguen en servicio o cambiaron IP/SNMP..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | printer | ALTO | 3 | 3 | unsupported_items, stale_or_no_recent_data | Confirmar si el activo sigue en servicio y corregir conectividad/IP/SNMP/agente antes de ampliar checks. |
| HP LASERJET PRO 4002DN GALLARZA JULIAN JR | printer | ALTO | 4 | 2 | unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| HP LASERJET PRO M404DN GALLARZA | printer | ALTO | 4 | 3 | unsupported_items, stale_or_no_recent_data | Confirmar si el activo sigue en servicio y corregir conectividad/IP/SNMP/agente antes de ampliar checks. |
| HP LASERJET PRO M404DN GALLARZA JORGE | printer | ALTO | 3 | 0 |  | Mantener cobertura y documentar dependencias/criticidad para el agente. |
| HP LASERJET PRO M404DN GALLARZA VICTOR | printer | ALTO | 4 | 0 |  | Mantener cobertura y documentar dependencias/criticidad para el agente. |
| ZEBRA ALMERIA | printer | ALTO | 0 | 5 | toner, paper, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| BROTHER HL-L2370DN series | printer | MEDIO | 0 | 0 | toner, paper | Completar checks faltantes: toner, paper |
| BROTHER HL-L2375DW series | printer | MEDIO | 0 | 0 | toner, paper | Completar checks faltantes: toner, paper |
| BROTHER HL-L2445DW | printer | MEDIO | 0 | 0 | toner, paper, stale_or_no_recent_data | Confirmar si el activo sigue en servicio y corregir conectividad/IP/SNMP/agente antes de ampliar checks. |
| BROTHER HL-L8360CDW series | printer | MEDIO | 0 | 1 | toner, paper, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |

## Servidores físicos/iDRAC/iLO

- Hosts detectados: 3.
- Hosts: DellEMC PowerEdge R540  ALMERIA   IDRAC, DellEMC PowerEdge R540 GALLARZA   IDRAC, PROLIANT ML350P GEN8 ILO.
- Huecos: sin huecos destacados en este análisis.

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| PROLIANT ML350P GEN8 ILO | ilo | ALTO | 3 | 0 |  | Mantener cobertura y documentar dependencias/criticidad para el agente. |
| DellEMC PowerEdge R540  ALMERIA   IDRAC | idrac | BAJO | 0 | 0 |  | Mantener cobertura y documentar dependencias/criticidad para el agente. |
| DellEMC PowerEdge R540 GALLARZA   IDRAC | idrac | BAJO | 0 | 0 |  | Mantener cobertura y documentar dependencias/criticidad para el agente. |

## Windows/Linux

- Hosts detectados: 9.
- Hosts: Active, SERAPLI, SERTS, SERTSBROKER, SERVER_2019_BBD, SRVPDC, LP-FERNANDO, SrvPdcALM, SRVPLANA.
- Huecos: Checks faltantes frecuentes: backup(9), updates(2); 2 items unsupported en el bloque..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| SERTS | proxmox_vm | ALTO | 3 | 0 | backup | Completar checks faltantes: backup |
| LP-FERNANDO | windows_server | ALTO | 5 | 2 | updates, backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |
| SrvPdcALM | windows_server | ALTO | 3 | 0 | backup | Completar checks faltantes: backup |
| Active | proxmox_vm | MEDIO | 2 | 0 | backup | Completar checks faltantes: backup |
| SERAPLI | proxmox_vm | MEDIO | 1 | 0 | backup | Completar checks faltantes: backup |
| SERTSBROKER | proxmox_vm | MEDIO | 1 | 0 | backup | Completar checks faltantes: backup |
| SERVER_2019_BBD | proxmox_vm | MEDIO | 2 | 0 | backup | Completar checks faltantes: backup |
| SRVPDC | proxmox_vm | MEDIO | 1 | 0 | backup | Completar checks faltantes: backup |
| SRVPLANA | windows_server | MEDIO | 0 | 0 | updates, backup | Completar checks faltantes: updates, backup |

## Proxmox/PBS/backups

- Hosts detectados: 4.
- Hosts: PBS Backup Monitoring, Proxmox Storage Monitoring, proxmox-gallarza, proxmoxalmeria.
- Huecos: Checks faltantes frecuentes: api(4), job(3), quorum(3), backup(2), availability(1), cpu(1), memory(1), storage(1); 1 items unsupported en el bloque.; Hosts sin datos recientes: PBS Backup Monitoring, Proxmox Storage Monitoring..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| PBS Backup Monitoring | pbs | ALTO | 0 | 0 | api, job, stale_or_no_recent_data | Confirmar si el activo sigue en servicio y corregir conectividad/IP/SNMP/agente antes de ampliar checks. |
| Proxmox Storage Monitoring | proxmox_node | ALTO | 0 | 0 | availability, api, cpu, memory, quorum | Confirmar si el activo sigue en servicio y corregir conectividad/IP/SNMP/agente antes de ampliar checks. |
| proxmox-gallarza | proxmox_node | ALTO | 0 | 0 | api, quorum, job, backup | Completar checks faltantes: api, quorum, job, backup |
| proxmoxalmeria | proxmox_node | ALTO | 0 | 1 | api, storage, quorum, job, backup | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |

## Servicios/aplicaciones

- Hosts detectados: 0.
- Hosts: ninguno clasificado claramente.
- Huecos: Hay VMs Proxmox con pinta de aplicación sin bloque aplicativo dedicado en Zabbix: ERPNext(101), JBrowse-Linux(107), APP-Comerciales(115), Srvwebservice(106), incidencias-devoluciones(108), ia-dify(114)..

_Sin datos._

## Zabbix interno

- Hosts detectados: 1.
- Hosts: Zabbix server.
- Huecos: Checks faltantes frecuentes: queue(1), processes(1), backup(1); 13 items unsupported en el bloque..

| Host | Tipo | Prioridad | Problems | Unsupported | Gaps | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| Zabbix server | zabbix_server | ALTO | 1 | 13 | queue, processes, backup, unsupported_items | Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura. |


## Qué debe saber el agente inteligente

- **asset_map**: Cada host tiene tipo probable, subtipo, ubicación, IP/DNS, métodos, templates y grupos.
- **criticality**: La criticidad se infiere de tipo, grupos y problemas High/Disaster; debe confirmarse humanamente.
- **dependencies**: Proxmox/PBS/backups ya aportan relaciones VMID/job/datastore; faltan dependencias completas NAS/red/servicios.
- **coverage**: El mapa expone checks existentes y faltantes por host y por bloque.
- **active_problems**: Se recogen problemas activos con severidad, hora y operational data.
- **noise_vs_real**: Unsupported/stale se separa de problemas reales; NasAlmeria SMART se mantiene como alerta real.
- **gaps**: Cada host y bloque incluye huecos y recomendación.

Acciones prohibidas sin confirmación humana:

- borrar/deshabilitar hosts, items, triggers, templates o macros
- cerrar/silenciar problemas
- modificar jobs de backup, Proxmox/PBS, NAS, firewalls o switches
- activar notificaciones globales
- reiniciar servicios

## Riesgos de seguir solo con Proxmox

- NAS/SMART/RAID/storage seguirían con alertas reales y huecos de backup sin priorización global.
- SAIs Eaton mantendrían OIDs unsupported y posible falta de self-test/autonomía fiable.
- Impresoras sin datos podrían ocultar activos retirados o SNMP roto.
- Switches / firewalls / red perimetral quedarían sin modelo de WAN/VPN/uplinks/errores CRC.
- Servidores físicos/iDRAC/iLO quedarían sin visión completa de RAID, fuentes, ventiladores y hardware.
- Windows/Linux y aplicaciones seguirían sin mapa de servicios críticos, updates, logs y backups.
