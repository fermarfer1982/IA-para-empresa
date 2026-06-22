# Próximas acciones - Proxmox/PBS/backups

Actualizado: 2026-05-21 09:24:55 CEST

## Preparado en esta fase

- Plan de implementación en `/opt/zabbix-codex/implementation_plans/phase-5a-3-backup-checks-plan.md` y `/opt/zabbix-codex/implementation_plans/phase-5a-3-backup-checks-plan.json`.
- Template draft PBS en `/opt/zabbix-codex/templates/drafts/backups/template_pbs_backup_monitoring_intelligent.yaml`.
- Template draft Proxmox storage en `/opt/zabbix-codex/templates/drafts/proxmox/template_proxmox_storage_monitoring_intelligent.yaml`.
- Scripts dry-run de métricas en `/opt/zabbix-codex/scripts/push_backup_metrics_to_zabbix.py` y `/opt/zabbix-codex/scripts/push_proxmox_storage_metrics_to_zabbix.py`.

## Cambios seguros para siguiente fase

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

## Orden recomendado

1. Resolver decisiones de Fernando.
2. Ejecutar dry-run de scripts y revisar métricas.
3. Importar templates nuevos no asignados si se autoriza.
4. Crear hosts técnicos si se autoriza.
5. Crear/asignar items trapper y validar recepción.
6. Programar `push_*` con timer/cron.
7. Activar triggers por prioridad tras validar umbrales.

## 2026-05-21 09:38:33 CEST - Fase 5A-4

Zabbix ya tiene hosts técnicos para empezar a recibir métricas estructuradas de PBS/Proxmox:

- `PBS Backup Monitoring`
- `Proxmox Storage Monitoring`

Los items trapper mínimos fueron creados/verificados y los triggers propios quedaron disabled para no generar notificaciones. La siguiente tarea es consolidar envío periódico y después activar triggers/notificaciones por decisión humana.
