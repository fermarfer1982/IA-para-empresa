# Inventario real Proxmox VE read-only

- Generado: 2026-05-20 22:38:15 CEST
- Configuracion presente: `True`
- Endpoint: `https://192.168.100.2:8006`
- Acceso real Proxmox: `True`

## Resumen

- Nodos: `2`
- VMs QEMU: `16`
- Contenedores LXC: `0`
- Storages: `8`
- Jobs backup: `2`
- Tareas recientes de backup: `65`
- Ceph detectado: `False`

## Nodos
| Nodo | Status | CPU | Mem | Uptime |
| --- | --- | --- | --- | --- |
| pvereplicas | online | 0.0453674255986857 | 123441991680 | 4854329 |
| proxmox-gallarza | online | 0.128138444744108 | 120375267328 | 4739652 |

## VMs
| VMID | Nombre | Nodo | Status | CPU | Mem |
| --- | --- | --- | --- | --- | --- |
| 101 | ERPNext | pvereplicas | running | 0 | 7085950976 |
| 107 | JBrowse-Linux | pvereplicas | running | 0 | 1460358144 |
| 110 | UBUNTU-VPN-WIREGUARD | pvereplicas | running | 0 | 4633179136 |
| 115 | APP-Comerciales | pvereplicas | running | 0 | 8316788736 |
| 112 | windows10pruebas | pvereplicas | running | 0 | 17085385728 |
| 106 | Srvwebservice | pvereplicas | running | 0 | 8717596672 |
| 108 | incidencias-devoluciones | pvereplicas | running | 0 | 6303997952 |
| 114 | ia-dify | pvereplicas | running | 0 | 21497505792 |
| 111 | MONITORIZACION-ZABBIX-LINUX | pvereplicas | running | 0.0444113653744602 | 8171476992 |
| 100 | ActiveRamiro | pvereplicas | running | 0 | 8847190016 |
| 102 | srvpdcRamiro | pvereplicas | running | 0 | 8748550144 |
| 113 | proxmox-server-backup | proxmox-gallarza | running | 0 | 13059761152 |
| 104 | SERTS2019Ramiro | proxmox-gallarza | running | 0 | 33868627968 |
| 103 | SERTSBROKER2019Ramiro | proxmox-gallarza | running | 0 | 17303801856 |
| 105 | SerapliRamiro | proxmox-gallarza | running | 0 | 25940269056 |
| 109 | windows-server-2019-BBDD | proxmox-gallarza | running | 0.0371086944695659 | 8655477760 |

## LXCs
_Sin datos._

## Storages
| Nodo | Storage | Tipo | Activo | Total | Usado | Disponible |
| --- | --- | --- | --- | --- | --- | --- |
| pvereplicas | local | dir | 1 | 2848923975680 | 262144 | 2848923713536 |
| pvereplicas | pbs-backup | pbs | 1 | 14039480680448 | 4658140770304 | 9381323132928 |
| pvereplicas | qnap-iso | cifs | 1 | 3445894283264 | 67642417152 | 3378251866112 |
| pvereplicas | datastore-replicas | zfspool | 1 | 7048207983656 | 4199284218592 | 2848923765064 |
| proxmox-gallarza | pbs-backup | pbs | 1 | 14039480680448 | 4658291732480 | 9381172170752 |
| proxmox-gallarza | local | dir | 1 | 6504787968 | 4610842624 | 1541836800 |
| proxmox-gallarza | datastore-replicas | zfspool | 1 | 3695819358208 | 3158698975232 | 537120382976 |
| proxmox-gallarza | qnap-iso | cifs | 1 | 3445894283264 | 67642417152 | 3378251866112 |

## Errores API parciales
| Endpoint | Error |
| --- | --- |
| /nodes/pvereplicas/ceph/status | HTTP 500: {"data":null,"message":"binary not installed: /usr/bin/ceph-mon\n"} |
| /nodes/proxmox-gallarza/ceph/status | HTTP 500: {"message":"binary not installed: /usr/bin/ceph-mon\n","data":null} |

