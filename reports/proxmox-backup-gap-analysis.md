# Analisis de gaps Proxmox, storage y backups

- Generado: 2026-05-21 08:49:05 CEST
- Zabbix version: `7.0.26`
- Acceso Proxmox API: `True`
- Acceso PBS API: `True`

## Datos obtenidos desde Zabbix

- Hosts Proxmox en Zabbix: `2`
- Hosts tipo VM/servidor en Zabbix: `18`
- Items storage detectados: `564`
- Items backup detectados: `55`
- Triggers backup detectados: `69`
- Hosts criticos sin evidencia directa de backup: `21`

| Host | Tipo | Templates |
| --- | --- | --- |
| proxmox-gallarza | proxmox | Linux by Zabbix agent |
| proxmoxalmeria | proxmox | Linux by Zabbix agent |

## Diferencias Zabbix vs Proxmox/PBS

- Nodos reales ausentes en Zabbix: `1`
- VMs/LXCs reales ausentes en Zabbix: `11`
- Storages reales sin check de capacidad: `6`
- PBS entidades sin evidencia Zabbix: `16`
- Hosts Zabbix tipo VM/servidor no encontrados en Proxmox real: `12`
- VMs/LXCs sin job de backup Proxmox: `1`
- Tareas Proxmox backup fallidas recientes: `9`

## Hosts criticos sin backup verificable

| Host | Grupos | Nota |
| --- | --- | --- |
| Active | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| DellEMC PowerEdge R540  ALMERIA   IDRAC | SERVIDORES FISICOS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| iDRAC-3897C03 GALLARZA | SERVIDORES FISICOS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NAS-CALAHORRA | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NASALM1 | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NASALM2 | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NasAlmeria | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NasGenomica | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NasRamiroA | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| NasRamiroB | NAS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| PROLIANT ML350P GEN8 ILO | SERVIDORES FISICOS | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SERAPLI | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SERTS | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SERTSBROKER | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SERVER_2019_BBD | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SRVPDC | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SRVPLANA | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| SrvPdcALM | Servidores | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| Zabbix server | Zabbix servers | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| proxmox-gallarza | PROXMOX | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |
| proxmoxalmeria | PROXMOX | Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central. |

## Gaps prioritarios

| Prioridad | Area | Hallazgo | Recomendacion |
| --- | --- | --- | --- |
| ALTO | Backups | 16 entidades PBS con backup no tienen evidencia directa equivalente en Zabbix. | Crear checks por VM/CT o mapa job->activo para que el agente pueda verificar cobertura de backup. |
| ALTO | Backups | 1 entidades PBS tienen backup mas antiguo de 48h. | Revisar jobs y criticidad; crear alerta por edad maxima de backup. |
| ALTO | Backups | 21 hosts criticos sin evidencia directa de backup. | Verificar si estan cubiertos por Veeam/PBS/vzdump y crear checks por job o por host. |
| MEDIO | Proxmox | Servicios Proxmox sin check claro: pveproxy, pvedaemon, pvestatd, corosync | Preparar items de servicios pveproxy/pvedaemon/pvestatd/corosync en template draft. |
| ALTO | Storage | 6 storages reales sin check de capacidad detectable. | Crear o vincular checks de capacidad por datastore tras confirmar inventario real. |
| ALTO | Storage | 8 datastores reales sin trigger de espacio detectable. | Crear triggers de uso >80%/>90% por datastore. |
| ALTO | Backups | 9 tareas de backup Proxmox recientes con error. | Revisar tareas vzdump fallidas y crear alerta por job/tarea fallida. |
| ALTO | Backups | 1 VMs/LXCs no aparecen en jobs de backup Proxmox. | Confirmar criticidad y añadirlas a job o documentar exclusion. |
| ALTO | Backups | 1 VMs/LXCs sin backup individual OK en ultimas 48h segun tareas disponibles. | Validar contra PBS/Veeam y jobs completos; crear check de edad por VM. |

