# Global Monitoring Readiness

Generado: 2026-06-02 08:26:09 CEST

## Resumen

- Hosts: 54
- Unsupported enabled: 90
- Problemas activos por severidad: {"Average": 20, "Warning": 22, "Information": 15, "High": 3}

## Scoring por bloque

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

## Bloques peor preparados

| Bloque | Score | Estado | Motivo |
| --- | --- | --- | --- |
| Servicios/aplicaciones | 0 | no monitorizado | No se detectaron hosts del bloque en Zabbix. |
| NAS | 2 | métricas básicas | Hay métricas y triggers, pero persisten 24 unsupported y 14 huecos. Además hay 3 problema(s) High/Disaster activo(s). |
| SAIs | 2 | métricas básicas | Hay métricas y triggers, pero persisten 20 unsupported y 6 huecos. |
| Impresoras | 2 | métricas básicas | Hay métricas y triggers, pero persisten 20 unsupported y 28 huecos. |
| Zabbix interno | 2 | métricas básicas | Hay métricas y triggers, pero persisten 13 unsupported y 4 huecos. |
| Firewalls / Red perimetral | 2 | métricas básicas | Hay métricas y triggers, pero persisten 4 unsupported y 32 huecos. |

## Hosts prioritarios

| Host | Tipo | Prioridad | Cobertura | Gaps |
| --- | --- | --- | --- | --- |
| PROLIANT ML350P GEN8 ILO | ilo | ALTO | buena |  |
| PBS Backup Monitoring | pbs | ALTO | sin_datos_recientes | api, job, stale_or_no_recent_data |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | printer | ALTO | sin_datos_recientes | unsupported_items, stale_or_no_recent_data |
| HP LASERJET PRO 4002DN GALLARZA JULIAN JR | printer | ALTO | parcial | unsupported_items |
| HP LASERJET PRO M404DN GALLARZA | printer | ALTO | sin_datos_recientes | unsupported_items, stale_or_no_recent_data |
| HP LASERJET PRO M404DN GALLARZA JORGE | printer | ALTO | buena |  |
| HP LASERJET PRO M404DN GALLARZA VICTOR | printer | ALTO | buena |  |
| ZEBRA ALMERIA | printer | ALTO | parcial | toner, paper, unsupported_items |
| Proxmox Storage Monitoring | proxmox_node | ALTO | sin_datos_recientes | availability, api, cpu, memory, quorum |
| proxmox-gallarza | proxmox_node | ALTO | parcial | api, quorum, job, backup |
| proxmoxalmeria | proxmox_node | ALTO | parcial | api, storage, quorum, job, backup |
| SERTS | proxmox_vm | ALTO | parcial | backup |
| NAS-CALAHORRA | qnap | ALTO | parcial | backup, unsupported_items |
| NASALM1 | qnap | ALTO | parcial | backup, unsupported_items |
| NASALM2 | qnap | ALTO | parcial | backup, unsupported_items |
| NasAlmeria | qnap | CRITICO | parcial | backup, unsupported_items |
| NasGenomica | qnap | ALTO | parcial | backup, unsupported_items |
| NasRamiroA | qnap | CRITICO | parcial | backup, unsupported_items |
| NasRamiroB | qnap | ALTO | parcial | backup, unsupported_items |
| EATON 5PX 2200 SAI ALMERIA | ups_sai | ALTO | parcial | load, self_test, unsupported_items |
| EATON 5PX 2200 SAI GALLARZA | ups_sai | ALTO | parcial | load, self_test, unsupported_items |
| LP-FERNANDO | windows_server | ALTO | parcial | updates, backup, unsupported_items |
| SrvPdcALM | windows_server | ALTO | parcial | backup |
| Zabbix server | zabbix_server | ALTO | parcial | queue, processes, backup, unsupported_items |
