# Auditoría de cobertura Zabbix

Generado: 2026-05-20T14:43:43+02:00
API: `http://127.0.0.1/api_jsonrpc.php`
Versión Zabbix: `7.0.26`

## Resumen ejecutivo

- Hosts analizados: 49 (49 enabled, 0 disabled).
- Templates analizados: 362.
- Problemas activos: 58.
- Items enabled unsupported: 83.
- Principales huecos: 0 hosts sin templates, 0 sin items activos, 0 sin triggers habilitados.
- Proxmox parece monitorizado: si.
- Backups: partial_or_good.

## Inventario

| Métrica | Valor |
| --- | --- |
| Hosts total | 49 |
| Hosts enabled | 49 |
| Hosts disabled | 0 |
| Grupos de hosts | 18 |
| Templates | 362 |
| Proxies | 0 |
| Interfaces | 49 |
| Interfaces agent | 16 |
| Interfaces SNMP | 33 |

## Estado general

| Área | Valor |
| --- | --- |
| Hosts enabled sin templates | 0 |
| Hosts enabled sin interfaces | 0 |
| Hosts enabled sin Zabbix agent | 33 |
| Hosts enabled sin SNMP | 16 |
| Hosts enabled sin items activos | 0 |
| Hosts enabled sin triggers habilitados | 0 |
| Hosts con triggers deshabilitados | 16 |
| Hosts con items unsupported | 23 |
| Hosts con muchos items unsupported | 3 |
| Hosts sin datos recientes | 5 |


- Actions readable/configured: 5.
- Media types readable/configured: 39.
- User groups readable: 6.
- Users with active media: 0.

## Problemas activos

| Severidad | Problemas activos |
| --- | --- |
| Disaster | 0 |
| High | 1 |
| Average | 20 |
| Warning | 20 |
| Information | 17 |
| Not classified | 0 |


Hosts con más problemas:

| Host | Problemas |
| --- | --- |
| LP-FERNANDO | 5 |
| HP LASERJET PRO M404DN GALLARZA VICTOR | 4 |
| HP LASERJET PRO 4002DN GALLARZA JULIAN JR | 4 |
| HP LASERJET PRO M404DN GALLARZA | 4 |
| PROLIANT ML350P GEN8 ILO | 3 |
| SrvPdcALM | 3 |
| SERTS | 3 |
| HP LASERJET PRO M404DN GALLARZA JORGE | 3 |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 3 |
| Zabbix server | 2 |
| NASALM1 | 2 |
| SERVER_2019_BBD | 2 |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 2 |
| SrvBackupALM | 2 |
| SRVCOPIAS | 2 |
| NasAlmeria | 2 |
| Active | 2 |
| AP2 CISCO | 1 |
| NASALM2 | 1 |
| NasRamiroA | 1 |


Problemas más antiguos:

| Severidad | Antigüedad | Host | Problema |
| --- | --- | --- | --- |
| Average | 163d 12h | LP-FERNANDO | Windows: "WbfPolicyService110" (WbfPolicyService110) is not running (startup type automatic) |
| Average | 163d 12h | LP-FERNANDO | Windows: "Intel(R) Platform License Manager Service" (Intel(R) Platform License Manager Service) is not running (startup type automatic) |
| Average | 163d 12h | LP-FERNANDO | Windows: "RstMwService" (Intel(R) Storage Middleware Service) is not running (startup type automatic) |
| Average | 153d 21h | LP-FERNANDO | Windows: Interface Realtek 8852CE WiFi 6E PCI-E NIC(Wi-Fi): Link down |
| High | 145d 1h | NasAlmeria | Faulty SMART state of HDD 5 |
| Warning | 145d 1h | NasRamiroB | Reaching threshold for pool 1 (<15%) |
| Warning | 145d 0h | NAS-CALAHORRA | Reaching threshold for pool 1 (<15%) |
| Warning | 145d 0h | Active | Windows: FS [(C:)]: Space is low (used > 80%, total 959.7GB) |
| Warning | 145d 0h | SrvPdcALM | Windows: FS [Datos(E:)]: Space is low (used > 80%, total 3072.0GB) |
| Warning | 145d 0h | SERTS | Windows: FS [(C:)]: Space is low (used > 80%, total 459.4GB) |
| Warning | 142d 3h | HP LASERJET PRO M404DN GALLARZA | Toner Black Cartridge HP CF259X is low on printer HP LASERJET PRO M404DN GALLARZA |
| Information | 142d 3h | HP LASERJET PRO M404DN GALLARZA | Cover duplexer door on printer HP LASERJET PRO M404DN GALLARZA is not closed |
| Information | 142d 3h | HP LASERJET PRO M404DN GALLARZA | Cover rear access door on printer HP LASERJET PRO M404DN GALLARZA is not closed |
| Information | 142d 3h | HP LASERJET PRO M404DN GALLARZA | Cover ink supply cover on printer HP LASERJET PRO M404DN GALLARZA is not closed |
| Information | 142d 1h | HP LASERJET PRO 4002DN GALLARZA ALFONSO | Cover duplexer door on printer HP LASERJET PRO 4002DN GALLARZA is not closed |


Problemas recientes:

| Severidad | Antigüedad | Host | Problema |
| --- | --- | --- | --- |
| Average | 14m | PROLIANT ML350P GEN8 ILO | HP iLO: Slot 0: Disk array controller is in warning state |
| Warning | 14m | PROLIANT ML350P GEN8 ILO | HP iLO: #0: Disk array cache controller is not in optimal state |
| Average | 15m | PROLIANT ML350P GEN8 ILO | HP iLO: #0: Disk array cache controller battery is in critical state! |
| Average | 2h 16m | Zabbix server | Zabbix server: Utilization of unreachable poller processes over 75% |
| Information | 2h 37m | Zabbix server | Zabbix server: Version has changed (new version: 7.0.26) |
| Warning | 10h 57m | NASALM1 | Disk latency is high (>30 for 15m) |
| Information | 5d 1h | AP2 CISCO | Cisco IOS: Interface Gi0(): Ethernet has changed to lower speed than it was before |
| Warning | 13d 15h | SrvPdcALM | Windows: FS [(C:)]: Space is low (used > 80%, total 79.4GB) |
| Average | 23d 18h | SERTS | Windows: FS [(C:)]: Space is critically low (used > 90%, total 459.4GB) |
| Warning | 29d 6h | SERVER_2019_BBD | Windows: FS [(C:)]: Space is low (used > 80%, total 59.4GB) |
| Warning | 57d 0h | HP LASERJET PRO M404DN GALLARZA VICTOR | Toner Black Cartridge HP CF259X is low on printer HP LASERJET PRO M404DN GALLARZA VICTOR |
| Warning | 71d 23h | HP COLOR LASERJET E45028 GALLARZA INFORMATICA | Toner 43 61 72 74 75 63 68 6F 20 63 69 61 6E 20 48 50 20 34 31 35 41 20 28 57 32 30 33 31 41 29 00  is low on printer HP COLOR LASERJET E45028 GALLARZA INFORMATICA |
| Warning | 75d 5h | HP LASERJET PRO 4002DN GALLARZA JULIAN JR | Toner Black Cartridge HP W1490X is low on printer HP LASERJET PRO 4002DN GALLARZA JULIAN JR |
| Average | 83d 22h | SrvBackupALM | Windows: Zabbix agent is not available (for 3m) |
| Average | 83d 22h | SRVCOPIAS | Windows: Zabbix agent is not available (for 3m) |

## Hosts sin buena cobertura

Hosts enabled sin templates:

_Sin datos._

Hosts enabled sin items activos:

_Sin datos._

Hosts enabled sin triggers habilitados:

_Sin datos._

## Items unsupported

| Métrica | Valor |
| --- | --- |
| Items total | 12776 |
| Items enabled | 12744 |
| Items disabled | 32 |
| Unsupported total | 113 |
| Unsupported enabled | 83 |
| Hosts con muchos unsupported | 3 |


| Host | Unsupported enabled | Unsupported total |
| --- | --- | --- |
| PROLIANT ML350P GEN8 ILO | 0 | 22 |
| Zabbix server | 13 | 13 |
| LP-FERNANDO | 2 | 10 |
| EATON 5PX 2200 ( SAI GALLARZA ) | 10 | 10 |
| EATON 5PX 2200 SAI ALMERIA | 10 | 10 |
| NasGenomica | 8 | 8 |
| ZEBRA ALMERIA | 5 | 5 |
| NasAlmeria | 4 | 4 |
| HP LASERJET PRO M404DN GALLARZA | 3 | 3 |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 3 | 3 |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 3 | 3 |
| HP LASERJET M402DN GALLARZA SERGIO | 3 | 3 |
| NasRamiroA | 2 | 2 |
| NASALM1 | 2 | 2 |
| NASALM2 | 2 | 2 |
| NAS-CALAHORRA | 2 | 2 |
| SrvBackupALM | 2 | 2 |
| SRVCOPIAS | 2 | 2 |
| HP LASERJET PRO 4002DN GALLARZA JULIAN JR | 2 | 2 |
| HP V1810-48G GALLARZA | 2 | 2 |
| NasRamiroB | 1 | 1 |
| BROTHER HL-L8360CDW series | 1 | 1 |
| proxmoxalmeria | 1 | 1 |

## Templates y grupos

Templates más usados:

| Template | Hosts |
| --- | --- |
| Universal Printer | 16 |
| Windows by Zabbix agent | 11 |
| SNMP QNAP | 7 |
| Linux by Zabbix agent | 3 |
| Cisco IOS by SNMP | 2 |
| Dell iDRAC by SNMP | 2 |
| EATON Mistral | 2 |
| Template Module ICMP Ping | 2 |
| HP Enterprise Switch by SNMP | 2 |
| HP iLO by SNMP | 1 |
| Zabbix server health | 1 |
| Template SNMP OS ESXi | 1 |


Grupos con más hosts:

| Grupo | Hosts |
| --- | --- |
| Impresoras | 16 |
| Servidores | 10 |
| NAS | 7 |
| SERVIDORES FISICOS | 3 |
| AP | 2 |
| FICHADORES | 2 |
| PROXMOX | 2 |
| SAI | 2 |
| SWITCHES | 2 |
| Discovered hosts | 1 |
| Servidores / VMware ESXi | 1 |
| Zabbix servers | 1 |

## Proxmox

- Entidades Proxmox-like detectadas: 5 hosts, 17 templates, 2 grupos.
- Items Proxmox-like: 358.
- Triggers Proxmox-like: 83.
- Items storage/datastore: 1325.
- Entidades Ceph detectadas: 52.

Huecos Proxmox evidentes:

- VMs missing from Zabbix cannot be proven without a Proxmox inventory/API comparison.

## Backups

- Backup coverage status: `partial_or_good`.
- Backup-related hosts: 2.
- Backup-related templates: 4.
- Backup-related items: 64.
- Backup-related triggers: 26.

## Salud del propio Zabbix

- Host: `Zabbix server`.
- Status: `enabled`.
- Agent availability: `available`.
- Active items: 160.
- Enabled triggers: 88.
- Unsupported items: 13.
- Last item data: 2026-05-20 14:43:40 CEST.
- Queue items detected: 2.
- CPU/RAM/disk related items detected: 22.

## Riesgos detectados

- 83 enabled unsupported item(s).
- 0 Disaster and 1 High active problem(s).

## Recomendaciones priorizadas

### CRÍTICO
_Sin datos._

### ALTO
- Review active High problems and confirm notification routing.
- Fix unsupported enabled items, prioritizing hosts with the largest unsupported counts.

### MEDIO
- Investigate enabled hosts without item data in the last 24 hour(s).
- Review disabled triggers and decide whether to re-enable or remove them in a later change phase.
- Import or compare Proxmox VM inventory to detect VMs missing as Zabbix hosts.

### BAJO
- Classify hosts without SNMP and apply SNMP only where relevant, such as network/storage devices.

## Próximos pasos

- Revisar el JSON generado para preparar scripts de corrección por lotes.
- Validar manualmente hosts sin templates, sin items activos y sin triggers antes de aplicar cambios.
- Decidir templates base por tipo de host: Linux, Proxmox/PVE, PBS, red/SNMP, storage, aplicaciones y backups.
- En la siguiente fase, generar propuestas de cambios sin aplicarlas: asignación de templates, creación de items/triggers y ajustes de acciones.
