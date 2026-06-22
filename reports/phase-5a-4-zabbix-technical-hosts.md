# Fase 5A-4 - Hosts técnicos e items trapper

Generado: 2026-05-21 09:43:13 CEST

## Resumen ejecutivo

Se han creado/verificado objetos técnicos propios para PBS, Proxmox storage y backups. No se ha modificado Proxmox, PBS, jobs, VMs, templates existentes ni acciones de notificación.

## Objetos creados o verificados

- group `Intelligent Monitoring`: created in this phase
- host `PBS Backup Monitoring`: created in this phase
- host `Proxmox Storage Monitoring`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.collection_status`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.entities_total`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.entities_without_recent_backup`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.has_recent_backup[114]`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.last_success_age_hours[114]`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.oldest_backup_age_hours`: created in this phase
- item `PBS Backup Monitoring` `pbs.backup.snapshot_count[114]`: created in this phase
- item `PBS Backup Monitoring` `pbs.datastore.groups[backup]`: created in this phase
- item `PBS Backup Monitoring` `pbs.datastore.groups[ds-qnap-iscsi-almeria]`: created in this phase
- item `PBS Backup Monitoring` `pbs.datastore.snapshots[backup]`: created in this phase
- item `PBS Backup Monitoring` `pbs.datastore.snapshots[ds-qnap-iscsi-almeria]`: created in this phase
- item `PBS Backup Monitoring` `pbs.datastore.usage_percent[backup]`: created in this phase
- item `PBS Backup Monitoring` `pbs.datastore.usage_percent[ds-qnap-iscsi-almeria]`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.backup.failed_tasks_24h`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.backup.failed_tasks_48h`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.backup.jobs_total`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.backup.vm_in_job[114]`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.backup.vm_without_job[114]`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas]`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[proxmox-gallarza,local]`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[pvereplicas,datastore-replicas]`: created in this phase
- item `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[pvereplicas,pbs-backup]`: created in this phase
- trigger `PBS Backup Monitoring` `PBS collection failed`: created disabled in this phase
- trigger `PBS Backup Monitoring` `PBS datastore backup usage >80%`: created disabled in this phase
- trigger `PBS Backup Monitoring` `PBS datastore backup usage >90%`: created disabled in this phase
- trigger `PBS Backup Monitoring` `PBS datastore ds-qnap-iscsi-almeria usage >80%`: created disabled in this phase
- trigger `PBS Backup Monitoring` `PBS datastore ds-qnap-iscsi-almeria usage >90%`: created disabled in this phase
- trigger `PBS Backup Monitoring` `ia-dify backup older than 168h`: created disabled in this phase
- trigger `PBS Backup Monitoring` `ia-dify backup older than 72h`: created disabled in this phase
- trigger `Proxmox Storage Monitoring` `Proxmox backup failed tasks 24h > 0`: created disabled in this phase
- trigger `Proxmox Storage Monitoring` `Proxmox backup failed tasks 48h > 0`: created disabled in this phase
- trigger `Proxmox Storage Monitoring` `ia-dify not present in backup job`: created disabled in this phase
- trigger `Proxmox Storage Monitoring` `proxmox-gallarza datastore-replicas >80%`: created disabled in this phase
- trigger `Proxmox Storage Monitoring` `proxmox-gallarza datastore-replicas >90%`: created disabled in this phase

## Items y valores

- `PBS Backup Monitoring` `pbs.backup.collection_status`: itemid `57065`, lastvalue `1`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.backup.entities_total`: itemid `57066`, lastvalue `16`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.backup.entities_without_recent_backup`: itemid `57067`, lastvalue `1`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.backup.has_recent_backup[114]`: itemid `57076`, lastvalue `0`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.backup.last_success_age_hours[114]`: itemid `57075`, lastvalue `186.244`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.backup.oldest_backup_age_hours`: itemid `57068`, lastvalue `186.244`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.backup.snapshot_count[114]`: itemid `57077`, lastvalue `1`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.datastore.groups[backup]`: itemid `57070`, lastvalue `16`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.datastore.groups[ds-qnap-iscsi-almeria]`: itemid `57073`, lastvalue `7`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.datastore.snapshots[backup]`: itemid `57071`, lastvalue `285`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.datastore.snapshots[ds-qnap-iscsi-almeria]`: itemid `57074`, lastvalue `184`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.datastore.usage_percent[backup]`: itemid `57069`, lastvalue `32.84`, lastclock `1779349345`, state `0`.
- `PBS Backup Monitoring` `pbs.datastore.usage_percent[ds-qnap-iscsi-almeria]`: itemid `57072`, lastvalue `19.822`, lastclock `1779349345`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.backup.failed_tasks_24h`: itemid `57079`, lastvalue `0`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.backup.failed_tasks_48h`: itemid `57080`, lastvalue `0`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.backup.jobs_total`: itemid `57078`, lastvalue `2`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.backup.vm_in_job[114]`: itemid `57085`, lastvalue `0`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.backup.vm_without_job[114]`: itemid `57086`, lastvalue `1`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas]`: itemid `57081`, lastvalue `85.467`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[proxmox-gallarza,local]`: itemid `57082`, lastvalue `70.884`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[pvereplicas,datastore-replicas]`: itemid `57083`, lastvalue `59.579`, lastclock `1779349348`, state `0`.
- `Proxmox Storage Monitoring` `proxmox.storage.usage_percent[pvereplicas,pbs-backup]`: itemid `57084`, lastvalue `33.179`, lastclock `1779349348`, state `0`.

## Triggers

Todos los triggers propios se crean en estado disabled (`status=1`) para evitar eventos/notificaciones.

- `PBS Backup Monitoring` `PBS collection failed`: status `1`, priority `4`.
- `PBS Backup Monitoring` `PBS datastore backup usage >80%`: status `1`, priority `3`.
- `PBS Backup Monitoring` `PBS datastore backup usage >90%`: status `1`, priority `4`.
- `PBS Backup Monitoring` `PBS datastore ds-qnap-iscsi-almeria usage >80%`: status `1`, priority `3`.
- `PBS Backup Monitoring` `PBS datastore ds-qnap-iscsi-almeria usage >90%`: status `1`, priority `4`.
- `PBS Backup Monitoring` `ia-dify backup older than 168h`: status `1`, priority `4`.
- `PBS Backup Monitoring` `ia-dify backup older than 72h`: status `1`, priority `3`.
- `Proxmox Storage Monitoring` `Proxmox backup failed tasks 24h > 0`: status `1`, priority `4`.
- `Proxmox Storage Monitoring` `Proxmox backup failed tasks 48h > 0`: status `1`, priority `4`.
- `Proxmox Storage Monitoring` `ia-dify not present in backup job`: status `1`, priority `4`.
- `Proxmox Storage Monitoring` `proxmox-gallarza datastore-replicas >80%`: status `1`, priority `3`.
- `Proxmox Storage Monitoring` `proxmox-gallarza datastore-replicas >90%`: status `1`, priority `4`.

## Unsupported

- Items técnicos unsupported: 0.

## Métricas

- Valores recibidos con `lastclock > 0`: 22.
- Valores pendientes sin `lastclock`: 0.

## Siguiente recomendación

Confirmar valores recibidos y, en la siguiente fase, programar el envío periódico. Mantener triggers disabled hasta validar umbrales y política de notificaciones.
