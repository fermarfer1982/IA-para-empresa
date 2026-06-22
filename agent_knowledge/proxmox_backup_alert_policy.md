# Politica de severidades Proxmox, storage y backups

## Disaster

- Cluster Proxmox sin quorum.
- Storage critico inaccesible.
- Todos los backups criticos ausentes.
- Nodo Proxmox critico caido.
- Ceph cluster en estado critico.

## High

- Backup fallido de VM critica.
- Datastore por encima del 90%.
- VM critica caida.
- PBS datastore con poco espacio.
- SMART o RAID degradado.

## Average

- Datastore por encima del 80%.
- Backup antiguo.
- Servicio Proxmox reiniciado o caido parcialmente.
- Ceph warning.
- Alto I/O wait.

## Warning

- Backup tardio.
- Crecimiento de storage.
- Snapshots antiguos.
- VM no critica apagada.

## Information

- Eventos recuperados.
- Cambios de inventario.
- Nuevas VMs detectadas.
