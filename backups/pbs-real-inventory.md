# Inventario real PBS read-only

- Generado: 2026-05-21 08:48:05 CEST
- Configuracion presente: `True`
- Endpoint: `https://192.168.100.5:8007`
- Acceso real PBS: `True`

## Resumen

- Datastores: `2`
- Snapshots: `469`
- Entidades con backup: `16`
- Tareas recientes: `0`
- Tareas fallidas: `0`

## Datastores
| Datastore | Path | Mount | GC | Notif | Total | Usado | Libre | Groups | Snapshots | OK | 403 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| backup | /mnt/pbs-iscsi | nonremovable | daily | notification-system | 14039480680448 | 4610525278208 | 9428938625024 | 16 | 285 | status, snapshots, gc, groups |  |
| ds-qnap-iscsi-almeria | /mnt/pbs-iscsi-almeria | nonremovable | daily | notification-system | 18876659302400 | 3741816266752 | 15134826258432 | 7 | 184 | status, snapshots, gc, groups |  |

## Ultimos backups por entidad
| Entidad | Datastore | Ultimo backup |
| --- | --- | --- |
| vm/100 | backup | 2026-05-20 21:00:13 CEST |
| vm/101 | backup | 2026-05-20 21:03:56 CEST |
| vm/102 | ds-qnap-iscsi-almeria | 2026-05-20 21:17:46 CEST |
| vm/103 | backup | 2026-05-20 22:30:05 CEST |
| vm/104 | backup | 2026-05-20 22:31:12 CEST |
| vm/105 | backup | 2026-05-20 22:41:10 CEST |
| vm/106 | backup | 2026-05-20 21:07:49 CEST |
| vm/107 | backup | 2026-05-20 21:09:58 CEST |
| vm/108 | backup | 2026-05-20 21:10:04 CEST |
| vm/109 | backup | 2026-05-20 22:44:26 CEST |
| vm/110 | backup | 2026-05-20 21:10:29 CEST |
| vm/111 | backup | 2026-05-20 21:10:49 CEST |
| vm/112 | backup | 2026-05-20 21:13:39 CEST |
| vm/113 | backup | 2026-05-20 22:45:49 CEST |
| vm/114 | backup | 2026-05-13 15:27:47 CEST |
| vm/115 | backup | 2026-05-20 21:16:27 CEST |

## Endpoints bloqueados por permisos
| Endpoint | Codigo | Contexto | Error |
| --- | --- | --- | --- |
| /nodes | 403 | nodes | permission check failed |

## Endpoints no disponibles
| Endpoint | Codigo | Contexto | Error |
| --- | --- | --- | --- |
| /admin/datastore/backup/prune | 404 | backup:prune | Path '/api2/json/admin/datastore/backup/prune' not found. |
| /admin/datastore/backup/verify | 404 | backup:verify | Path '/api2/json/admin/datastore/backup/verify' not found. |
| /admin/datastore/ds-qnap-iscsi-almeria/prune | 404 | ds-qnap-iscsi-almeria:prune | Path '/api2/json/admin/datastore/ds-qnap-iscsi-almeria/prune' not found. |
| /admin/datastore/ds-qnap-iscsi-almeria/verify | 404 | ds-qnap-iscsi-almeria:verify | Path '/api2/json/admin/datastore/ds-qnap-iscsi-almeria/verify' not found. |

