# Infrastructure summary for Zabbix agent

Generado: 2026-06-02 08:26:09 CEST

- Zabbix version: `7.0.26`
- Hosts: `54`
- Unsupported items: `90`
- Bloques peor preparados: Servicios/aplicaciones=0, NAS=2, SAIs=2, Impresoras=2, Zabbix interno=2

## Tipos

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

## Scoring global

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

## Próximo foco recomendado

No seguir únicamente con Proxmox/PBS. El siguiente bloque debe ser NAS/SMART/RAID/storage, seguido por SAIs/UPS y red.
