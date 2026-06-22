# Fase 5A - Readiness Proxmox, storage y backups

## Resumen ejecutivo

La fase queda preparada en modo read-only y se ha incorporado el inventario real disponible de Proxmox/PBS a la comparacion con Zabbix.

## Que se pudo consultar

- Zabbix API: hosts, items, triggers y problemas.
- Inventarios JSON existentes de la base del agente.
- API real de Proxmox VE: nodos, VMs, storages, cluster, jobs y tareas.
- API real de Proxmox Backup Server: version, datastores, status, groups y snapshots.

## Que no se pudo consultar

- Endpoint PBS opcional `/nodes`: `permission check failed`.

## Estado Proxmox segun Zabbix

- Hosts Proxmox en Zabbix: `2`.
- Items Proxmox/storage relacionados: `564`.
- Trigger quorum/corosync/cluster detectados: `52`.

## Estado backup segun Zabbix

- Items backup detectados: `55`.
- Triggers backup detectados: `69`.
- Hosts criticos sin backup verificable: `21`.

## Inventario real Proxmox/PBS

- Proxmox API disponible: `True`.
- PBS API disponible: `True`.
- PBS permisos limitados: `True`.
- Nodos reales detectados: `2`.
- VMs/LXCs reales detectados: `16`.
- Entidades PBS con backup detectadas: `16`.
- Jobs Proxmox backup detectados: `2`.
- Tareas Proxmox backup fallidas recientes: `9`.

## Gaps principales

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

## Templates draft creados

- `/opt/zabbix-codex/templates/drafts/proxmox/template_proxmox_agent_intelligent.yaml`
- `/opt/zabbix-codex/templates/drafts/backups/template_backup_intelligent.yaml`
- `/opt/zabbix-codex/templates/drafts/backups/template_pbs_intelligent.yaml`

## Alertas recomendadas

- Disaster: quorum perdido, storage critico inaccesible, nodo critico caido, backups criticos ausentes.
- High: backup fallido de VM critica, datastore >90%, PBS con poco espacio, SMART/RAID degradado.
- Average: datastore >80%, backup antiguo, servicio Proxmox parcial, Ceph warning.
- Warning/Information: backup tardio, snapshots antiguos, cambios de inventario.

## Riesgos

- Los 21 hosts criticos sin evidencia directa de backup siguen siendo riesgo operativo.
- Zabbix no debe ser considerado fuente completa de backups hasta mapear Proxmox/PBS/Veeam.

## Siguiente fase

Preparar checks/alertas draft para datastores PBS, edad de backup por VM/CT, jobs de backup y servicios Proxmox sin aplicar cambios todavia.
