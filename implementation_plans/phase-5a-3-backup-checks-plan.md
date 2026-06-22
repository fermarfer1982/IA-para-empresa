# Fase 5A-3 - Plan de implementación de checks PBS/Proxmox

Generado: 2026-05-21 09:24:55 CEST

## Resumen ejecutivo

Esta fase deja preparada una implementación revisable para que Zabbix almacene métricas estructuradas de PBS, Proxmox storage y backups. No se ha modificado Zabbix, Proxmox ni PBS.

- PBS API: OK.
- Proxmox API: OK.
- PBS datastores: 2; snapshots: 469; entidades con backup: 16.
- Proxmox VMs: 16; LXCs: 0; storages: 8; jobs de backup: 2.
- Entidades PBS sin backup reciente >48h: 1.
- VMs/LXCs sin job Proxmox: 1.
- Tareas recientes de backup Proxmox con error: 9.

## Arquitectura recomendada

Arquitectura base: **LLD + items trapper + `zabbix_sender` + hosts técnicos separados**.

- Host técnico propuesto: `PBS Backup Monitoring`.
- Host técnico propuesto: `Proxmox Storage Monitoring`.
- Los scripts recolectan Proxmox/PBS con credenciales de `/etc/zabbix-codex/proxmox.env` y envían valores a Zabbix solo con `--send`.
- El modo por defecto de los scripts es dry-run.
- Zabbix API queda reservada para una fase posterior aprobada de creación/importación.
- External checks no se recomiendan como base porque moverían credenciales y carga operativa al servidor Zabbix.

## Estado PBS

| Datastore | Path | Uso | Groups | Snapshots | GC |
| --- | --- | --- | --- | --- | --- |
| backup | /mnt/pbs-iscsi | 32.8% | 16 | 285 | daily |
| ds-qnap-iscsi-almeria | /mnt/pbs-iscsi-almeria | 19.8% | 7 | 184 | daily |

## Estado Proxmox storage

| Nodo | Storage | Tipo | Uso | Activo | Enabled |
| --- | --- | --- | --- | --- | --- |
| proxmox-gallarza | datastore-replicas | zfspool | 85.5% | 1 | 1 |
| proxmox-gallarza | local | dir | 70.9% | 1 | 1 |
| proxmox-gallarza | pbs-backup | pbs | 33.2% | 1 | 1 |
| proxmox-gallarza | qnap-iso | cifs | 2.0% | 1 | 1 |
| pvereplicas | datastore-replicas | zfspool | 59.6% | 1 | 1 |
| pvereplicas | local | dir | 0.0% | 1 | 1 |
| pvereplicas | pbs-backup | pbs | 33.2% | 1 | 1 |
| pvereplicas | qnap-iso | cifs | 2.0% | 1 | 1 |

## Estado VM/backup

| VMID | Nombre | Nodo | Estado | En job PVE | Backup PBS >48h |
| --- | --- | --- | --- | --- | --- |
| 100 | ActiveRamiro | pvereplicas | running | sí | no |
| 101 | ERPNext | pvereplicas | running | sí | no |
| 102 | srvpdcRamiro | pvereplicas | running | sí | no |
| 103 | SERTSBROKER2019Ramiro | proxmox-gallarza | running | sí | no |
| 104 | SERTS2019Ramiro | proxmox-gallarza | running | sí | no |
| 105 | SerapliRamiro | proxmox-gallarza | running | sí | no |
| 106 | Srvwebservice | pvereplicas | running | sí | no |
| 107 | JBrowse-Linux | pvereplicas | running | sí | no |
| 108 | incidencias-devoluciones | pvereplicas | running | sí | no |
| 109 | windows-server-2019-BBDD | proxmox-gallarza | running | sí | no |
| 110 | UBUNTU-VPN-WIREGUARD | pvereplicas | running | sí | no |
| 111 | MONITORIZACION-ZABBIX-LINUX | pvereplicas | running | sí | no |
| 112 | windows10pruebas | pvereplicas | running | sí | no |
| 113 | proxmox-server-backup | proxmox-gallarza | running | sí | no |
| 114 | ia-dify | pvereplicas | running | no | sí |
| 115 | APP-Comerciales | pvereplicas | running | sí | no |

## Métricas PBS propuestas

- `pbs.datastore.usage_percent[{datastore}]`
- `pbs.datastore.total_bytes[{datastore}]`
- `pbs.datastore.used_bytes[{datastore}]`
- `pbs.datastore.free_bytes[{datastore}]`
- `pbs.datastore.groups[{datastore}]`
- `pbs.datastore.snapshots[{datastore}]`
- `pbs.datastore.last_snapshot_age_hours[{datastore}]`
- `pbs.backup.last_success_timestamp[{vmid}]`
- `pbs.backup.last_success_age_hours[{vmid}]`
- `pbs.backup.snapshot_count[{vmid}]`
- `pbs.backup.has_recent_backup[{vmid}]`
- `pbs.backup.datastore[{vmid}]`
- `pbs.backup.protected_count[{vmid}]`
- `pbs.backup.entities_total`
- `pbs.backup.entities_without_recent_backup`
- `pbs.backup.oldest_backup_age_hours`
- `pbs.backup.collection_status`

## Métricas Proxmox propuestas

- `proxmox.storage.usage_percent[{node},{storage}]`
- `proxmox.storage.total_bytes[{node},{storage}]`
- `proxmox.storage.used_bytes[{node},{storage}]`
- `proxmox.storage.free_bytes[{node},{storage}]`
- `proxmox.storage.active[{node},{storage}]`
- `proxmox.storage.enabled[{node},{storage}]`
- `proxmox.backup.jobs_total`
- `proxmox.backup.failed_tasks_24h`
- `proxmox.backup.failed_tasks_48h`
- `proxmox.backup.vm_in_job[{vmid}]`
- `proxmox.backup.vm_without_job[{vmid}]`

## Triggers PBS propuestos

- Average: Datastore usage > 80% (`pbs.datastore.usage_percent[{datastore}] > 80`)
- High: Datastore usage > 90% (`pbs.datastore.usage_percent[{datastore}] > 90`)
- Disaster: Datastore usage > 95% si datastore crítico (`pbs.datastore.usage_percent[{datastore}] > 95`)
- High: VM crítica sin backup reciente > 24/48h (`pbs.backup.last_success_age_hours[{vmid}] > threshold`)
- Average: VM no crítica sin backup reciente > 72h (`pbs.backup.last_success_age_hours[{vmid}] > 72`)
- High o Average según criticidad: ia-dify backup antiguo (`pbs.backup.last_success_age_hours[114] > threshold`)
- High: No se puede consultar PBS (`pbs.backup.collection_status = 0`)
- High: No hay snapshots recientes (`pbs.backup.oldest_backup_age_hours o snapshots recientes fuera de umbral`)

## Triggers Proxmox propuestos

- Average: Storage > 80% (`proxmox.storage.usage_percent[{node},{storage}] > 80`)
- High: Storage > 90% (`proxmox.storage.usage_percent[{node},{storage}] > 90`)
- Disaster: Storage > 95% si crítico (`proxmox.storage.usage_percent[{node},{storage}] > 95`)
- Average ahora, High si sigue creciendo o es crítico: proxmox-gallarza/datastore-replicas > 80% (`proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas] > 80`)
- High: Backup tasks failed > 0 últimas 24/48h (`proxmox.backup.failed_tasks_24h > 0 o proxmox.backup.failed_tasks_48h > 0`)
- High: VM crítica sin job de backup (`proxmox.backup.vm_without_job[{vmid}] = 1`)
- Average: VM no crítica sin job de backup (`proxmox.backup.vm_without_job[{vmid}] = 1`)
- High: PVE API no accesible (`proxmox.collection_status = 0`)

## Hallazgos inmediatos

- **ALTO / Backups**: 1 entidad(es) PBS sin backup reciente >48h. Acción: Crear check pbs.backup.last_success_age_hours por VM/CT y confirmar criticidad.
- **ALTO / Backups**: 1 VM/LXC no aparece(n) en jobs de backup Proxmox. Acción: Confirmar si deben entrar en jobs de backup o quedar documentadas como exclusión.
- **ALTO / Backups**: 9 tareas recientes de backup Proxmox con error. Acción: Crear alerta proxmox.backup.failed_tasks_24h/48h y revisar los errores de vzdump.
- **ALTO / Storage**: 1 storage(s) Proxmox por encima del 80%. Acción: Crear triggers >80/>90/>95; proxmox-gallarza/datastore-replicas requiere seguimiento inmediato.
- **ALTO / Backups**: 21 hosts críticos sin backup verificable directo en Zabbix. Acción: Añadir modelo de cobertura de backup por host crítico.

## Cambios seguros para la siguiente fase

- Importar templates nuevos como borradores no asignados.
- Crear hosts técnicos sin interfaces si se confirma.
- Crear items trapper en hosts técnicos si se confirma.
- Ejecutar scripts push_* en dry-run desde cron/systemd timer de prueba.
- Añadir documentación de mapeo VMID->host crítico.

## Cambios que requieren confirmación humana

- Crear hosts técnicos en Zabbix.
- Importar templates nuevos.
- Asignar templates a hosts técnicos.
- Crear items/triggers activos.
- Activar envío de métricas con zabbix_sender.
- Definir criticidad de VMs, datastores y políticas de backup.
- Añadir ia-dify a jobs de backup o documentar su exclusión.
- Cambiar jobs de backup Proxmox/PBS.

## Decisiones que necesito de Fernando

- ¿ia-dify debe tener backup?
- ¿Cuál es la criticidad de cada VM?
- ¿Qué VMs deben alertar si backup >24h, >48h o >72h?
- ¿Qué datastores son críticos?
- ¿Debemos crear host técnico PBS Backup Monitoring?
- ¿Debemos crear host técnico Proxmox Storage Monitoring?
- ¿Se permite importar templates nuevos no asignados?
- ¿Se permite crear items trapper en hosts técnicos?

## Ficheros generados

- `/opt/zabbix-codex/implementation_plans/phase-5a-3-backup-checks-plan.json`
- `/opt/zabbix-codex/templates/drafts/backups/template_pbs_backup_monitoring_intelligent.yaml`
- `/opt/zabbix-codex/templates/drafts/proxmox/template_proxmox_storage_monitoring_intelligent.yaml`
- `/opt/zabbix-codex/scripts/push_backup_metrics_to_zabbix.py`
- `/opt/zabbix-codex/scripts/push_proxmox_storage_metrics_to_zabbix.py`
- `/opt/zabbix-codex/agent_knowledge/proxmox_next_actions.md`
