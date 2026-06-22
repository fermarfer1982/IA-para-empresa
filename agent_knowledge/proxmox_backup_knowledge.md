# Knowledge base - Proxmox, PBS y backups

Actualizado: 2026-05-21 09:24:55 CEST

## Qué sabe Zabbix ahora

- Hosts totales visibles por API: 49.
- Templates totales visibles por API: 362.
- Items existentes relacionados con `pbs.*`/`proxmox.*`: 0.
- Proxmox real: 2 nodos, 16 VMs, 0 LXCs, 8 storages.
- PBS real: 2 datastores, 469 snapshots, 16 entidades con backup.

## Cómo debe razonar el agente

- Priorizar pérdida de datos, backups ausentes, storages >90%, APIs no consultables y VM crítica sin backup.
- Tratar `proxmox-gallarza/datastore-replicas` como gap de capacidad inmediato mientras esté >80%.
- Tratar `ia-dify`/VMID 114 como pendiente de decisión: no está en job Proxmox y su último backup PBS es antiguo.
- Separar problemas reales de cobertura insuficiente: una VM con backup en PBS pero sin evidencia en Zabbix es un gap de observabilidad.

## Hallazgos que debe vigilar

- ALTO / Backups: 1 entidad(es) PBS sin backup reciente >48h.
- ALTO / Backups: 1 VM/LXC no aparece(n) en jobs de backup Proxmox.
- ALTO / Backups: 9 tareas recientes de backup Proxmox con error.
- ALTO / Storage: 1 storage(s) Proxmox por encima del 80%.
- ALTO / Backups: 21 hosts críticos sin backup verificable directo en Zabbix.

## Automatizable

- Recolectar métricas PBS/Proxmox y enviarlas a trapper items.
- Generar LLD para datastores, storages y VMIDs.
- Calcular edad de último backup por VM/CT.
- Calcular `vm_without_job` a partir de jobs Proxmox.
- Calcular errores recientes de backup Proxmox.

## Requiere intervención humana

- Definir criticidad por VM/host.
- Decidir si `ia-dify` debe tener backup.
- Confirmar hosts técnicos y thresholds.
- Importar templates, crear hosts, asignar templates y activar triggers.
- Modificar jobs de backup o política PBS.

## Decisiones que necesito de Fernando

- ¿ia-dify debe tener backup?
- ¿Cuál es la criticidad de cada VM?
- ¿Qué VMs deben alertar si backup >24h, >48h o >72h?
- ¿Qué datastores son críticos?
- ¿Debemos crear host técnico PBS Backup Monitoring?
- ¿Debemos crear host técnico Proxmox Storage Monitoring?
- ¿Se permite importar templates nuevos no asignados?
- ¿Se permite crear items trapper en hosts técnicos?

## 2026-05-21 09:38:33 CEST - Fase 5A-4

Zabbix ya tiene hosts técnicos para empezar a recibir métricas estructuradas de PBS/Proxmox:

- `PBS Backup Monitoring`
- `Proxmox Storage Monitoring`

Los items trapper mínimos fueron creados/verificados y los triggers propios quedaron disabled para no generar notificaciones. La siguiente tarea es consolidar envío periódico y después activar triggers/notificaciones por decisión humana.
