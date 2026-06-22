# Plan de correccion de monitorizacion Zabbix

Generado: 2026-05-20T15:57:19+02:00
API: `http://127.0.0.1/api_jsonrpc.php`
Version Zabbix: `7.0.26`

## Resumen ejecutivo

- Hosts enabled analizados: 49 de 49.
- Templates analizados: 362.
- Items unsupported enabled: 83 en 22 hosts.
- Problemas activos: 59 ({'Warning': 21, 'Average': 20, 'Information': 17, 'High': 1}).
- Triggers deshabilitados: 79.
- Hosts sin datos recientes: 5.
- Errores API durante el plan: 0.

## Diagnostico del problema High de SMART en NasAlmeria

| Campo | Valor |
| --- | --- |
| Nombre | Faulty SMART state of HDD 5 |
| Host | NasAlmeria |
| Severidad | High |
| Inicio | 2025-12-26 12:04:45 CET |
| Duracion | 145d 2h |
| Trigger asociado | 25766 |
| Trigger status | disabled |
| Trigger descripcion | Faulty SMART state of HDD 5 |
| Operational data | Current state: Abnormal (2) |
| Diagnostico | Parece un fallo fisico o estado SMART anomalo reportado por el NAS, no una falta de datos ni un error de consulta. |
| Recomendacion | No silenciar como primera respuesta. Confirmar estado SMART del HDD 5 en NasAlmeria, revisar logs/GUI del NAS y planificar sustitucion o migracion si el disco sigue en estado Abnormal. |


Items asociados:

| ItemID | Nombre | Key | Tipo | Ultimo valor | Ultima lectura | Estado | SNMP OID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 51469 | HDD 5: SMART Status | hdd.status[5] | SNMP agent | 2 | 2026-05-20 15:30:50 CEST | normal | 1.3.6.1.4.1.24681.1.4.1.1.1.1.5.2.1.5.5 |


Evidencias:

- Operational data: Current state: Abnormal (2)
- Associated trigger 25766 is currently disabled.
- Associated item is supported and currently returns data.
- Last item value: 2 at 2026-05-20 15:30:50 CEST.
- SNMP OID: 1.3.6.1.4.1.24681.1.4.1.1.1.1.5.2.1.5.5.

Comandos de confirmacion propuestos, no ejecutados:

- ssh <admin>@<ip-de-NasAlmeria>
- Abrir GUI QNAP: Storage & Snapshots > Disks/VJBOD > HDD 5 > SMART information
- qcli_storage -d
- qcli_storage -T force=1
- smartctl -a -d sat /dev/<disco_hdd5>
- dmesg | egrep -i 'smart|error|fail|ata|disk|hdd|ssd'

No se ha probado acceso SSH/GUI al NAS desde este servidor; no se asume que el servidor Zabbix sea el NAS.

## Items unsupported

| Causa | Items |
| --- | --- |
| otro | 30 |
| SNMP OID no encontrada | 28 |
| dependencia de template | 25 |


Top 10 unsupported mas importantes:

| Host | ItemID | Item | Key | Tipo | Causa | Error |
| --- | --- | --- | --- | --- | --- | --- |
| Zabbix server | 23261 | Utilization of ipmi poller data collector processes, in % | zabbix[process,ipmi poller,avg,busy] | Zabbix internal | dependencia de template | No "ipmi poller" processes started. |
| Zabbix server | 23262 | Utilization of java poller data collector processes, in % | zabbix[process,java poller,avg,busy] | Zabbix internal | dependencia de template | No "java poller" processes started. |
| Zabbix server | 23267 | Utilization of snmp trapper data collector processes, in % | zabbix[process,snmp trapper,avg,busy] | Zabbix internal | dependencia de template | No "snmp trapper" processes started. |
| Zabbix server | 23328 | Utilization of vmware collector data collector processes, in % | zabbix[process,vmware collector,avg,busy] | Zabbix internal | dependencia de template | No "vmware collector" processes started. |
| Zabbix server | 23635 | VMware cache, % used | zabbix[vmware,buffer,pused] | Zabbix internal | dependencia de template | No "vmware collector" processes started. |
| Zabbix server | 25367 | Utilization of ipmi manager internal processes, in % | zabbix[process,ipmi manager,avg,busy] | Zabbix internal | dependencia de template | No "ipmi manager" processes started. |
| Zabbix server | 34318 | Utilization of report writer internal processes, in % | zabbix[process,report writer,avg,busy] | Zabbix internal | dependencia de template | No "report writer" processes started. |
| Zabbix server | 34319 | Utilization of report manager internal processes, in % | zabbix[process,report manager,avg,busy] | Zabbix internal | dependencia de template | No "report manager" processes started. |
| Zabbix server | 42235 | Number of installed packages | system.sw.packages.get | Zabbix agent | otro | Cannot obtain package information. |
| Zabbix server | 44788 | Connector queue | zabbix[connector_queue] | Zabbix internal | otro | connector is not initialized: please check "StartConnectors" configuration parameter |


Hosts mas afectados:

| Host | Unsupported | Causas |
| --- | --- | --- |
| Zabbix server | 13 | dependencia de template: 10, otro: 3 |
| EATON 5PX 2200 ( SAI GALLARZA ) | 10 | SNMP OID no encontrada: 10 |
| EATON 5PX 2200 SAI ALMERIA | 10 | SNMP OID no encontrada: 10 |
| NasGenomica | 8 | otro: 7, SNMP OID no encontrada: 1 |
| ZEBRA ALMERIA | 5 | SNMP OID no encontrada: 4, otro: 1 |
| NasAlmeria | 4 | SNMP OID no encontrada: 1, otro: 3 |
| HP LASERJET PRO M404DN GALLARZA | 3 | dependencia de template: 3 |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 3 | dependencia de template: 3 |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 3 | otro: 3 |
| HP LASERJET M402DN GALLARZA SERGIO | 3 | dependencia de template: 3 |
| NAS-CALAHORRA | 2 | otro: 2 |
| SrvBackupALM | 2 | dependencia de template: 2 |
| LP-FERNANDO | 2 | dependencia de template: 2 |
| NasRamiroA | 2 | otro: 2 |
| NASALM1 | 2 | otro: 2 |

## Triggers deshabilitados

| Host | TriggerID | Trigger | Severidad | Template origen | Motivo probable |
| --- | --- | --- | --- | --- | --- |
| Template SNMP OS ESXi | 25330 | VMWare ESXi is EOL on {HOST.NAME} ({ITEM.LASTVALUE1} build {ITEM.LASTVALUE2}) (ESXi 5.5) | High |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| Template SNMP OS ESXi | 25337 | VMWare ESXi is outdated on {HOST.NAME} ({ITEM.LASTVALUE1} build {ITEM.LASTVALUE2}) (Not Latest Build) | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| esxibck.semillas.local | 25400 | VMWare ESXi is outdated on {HOST.NAME} ({ITEM.LASTVALUE1} build {ITEM.LASTVALUE2}) (Not Latest Build) | Information | VMWare ESXi is outdated on {HOST.NAME} ({ITEM.LASTVALUE1} build {ITEM.LASTVALUE2}) (Not Latest Build) | Deshabilitado heredado o ajustado desde template; revisar antes de tocar porque puede afectar a varios hosts. |
| esxibck.semillas.local | 25407 | VMWare ESXi is EOL on {HOST.NAME} ({ITEM.LASTVALUE1} build {ITEM.LASTVALUE2}) (ESXi 5.5) | High | VMWare ESXi is EOL on {HOST.NAME} ({ITEM.LASTVALUE1} build {ITEM.LASTVALUE2}) (ESXi 5.5) | Deshabilitado heredado o ajustado desde template; revisar antes de tocar porque puede afectar a varios hosts. |
| esxibck.semillas.local | 25412 | Guest Tools not running or out of date on SrvPlana_Ramiro | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| esxibck.semillas.local | 25413 | Guest Tools not running or out of date on VeeamUbuntu | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| esxibck.semillas.local | 25414 | Guest Tools not running or out of date on Serapli_Ramiro_replica | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| esxibck.semillas.local | 25415 | Guest Tools not running or out of date on SERTS2019_Ramiro_replica | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| esxibck.semillas.local | 25416 | Guest Tools not running or out of date on Active_Ramiro_replica | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| esxibck.semillas.local | 25417 | Guest Tools not running or out of date on SERTSBROKER2019_Ramiro_replica | Information |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| NasAlmeria | 25766 | Faulty SMART state of HDD 5 | High |  | No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar. |
| EATON Mistral | 27261 | LESS than 65 minutest battery remaining on {HOST.NAME} | Information |  | Posible sensor hardware no aplicable o demasiado ruidoso; revisar contra inventario fisico. |
| EATON 5PX 2200 ( SAI GALLARZA ) | 27273 | LESS than 65 minutest battery remaining on {HOST.NAME} | Information | LESS than 65 minutest battery remaining on {HOST.NAME} | Deshabilitado heredado o ajustado desde template; revisar antes de tocar porque puede afectar a varios hosts. |
| HP LASERJET PRO M404DN GALLARZA | 27291 | Input Tray 1 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP LASERJET PRO M404DN GALLARZA | 27292 | Input Tray 2 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP LASERJET PRO M404DN GALLARZA | 27298 | Output OutputBin1 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 27307 | Input Tray 1 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 27308 | Input Tray 2 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 27314 | Output OutputBin1 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 27333 | Input Tray 1 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 27334 | Input Tray 2 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 27335 | Output Output Bin on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP COLOR LASERJET E45028 GALLARZA MICAELA | 27341 | Input Tray 1 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP COLOR LASERJET E45028 GALLARZA MICAELA | 27342 | Input Tray 2 on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |
| HP COLOR LASERJET E45028 GALLARZA MICAELA | 27348 | Output Output Bin on printer {HOST.NAME} has changed | Information |  | Probable reduccion de ruido en impresoras/consumibles. |

## Hosts sin datos recientes

| Host | Grupo | Metodo | Interfaz | Ultimo dato | Tipo | Propuesta |
| --- | --- | --- | --- | --- | --- | --- |
| BROTHER HL-L2445DW | Impresoras | snmp | snmp 192.168.102.221:161 unavailable | never | impresora/SNMP | Corregir si sigue instalada; pasar a mantenimiento o retirar en una fase confirmada si el equipo ya no existe. |
| CANON iR-ADV C3830 | Impresoras | snmp | snmp 192.168.100.106:161 unavailable | never | impresora/SNMP | Corregir si sigue instalada; pasar a mantenimiento o retirar en una fase confirmada si el equipo ya no existe. |
| HP LASERJET M402DN GALLARZA SERGIO | Impresoras | snmp | snmp 192.168.100.169:161 unavailable | never | impresora/SNMP | Corregir si sigue instalada; pasar a mantenimiento o retirar en una fase confirmada si el equipo ya no existe. |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | Impresoras | snmp | snmp 192.168.100.162:161 unavailable | never | impresora/SNMP | Corregir si sigue instalada; pasar a mantenimiento o retirar en una fase confirmada si el equipo ya no existe. |
| HP LASERJET PRO M404DN GALLARZA | Impresoras | snmp | snmp 192.168.100.221:161 unavailable | never | impresora/SNMP | Corregir si sigue instalada; pasar a mantenimiento o retirar en una fase confirmada si el equipo ya no existe. |

## Proxmox

- Hosts relacionados: 4.
- Templates relacionados: 3.
- Items relacionados: 2.
- Triggers relacionados: 11.
- PBS detectado: no.
- Backups detectados: si.
- Storage/datastore detectado: si.
- Ceph detectado: no.
- SMART detectado: si.
- No demostrable desde Zabbix sin comparar contra Proxmox API.

Hosts Proxmox-like:

| Host | Nombre | Coincidencias |
| --- | --- | --- |
| SRVCOPIAS | SRVCOPIAS | pve |
| SrvBackupALM | SrvBackupALM | pve |
| proxmox-gallarza | proxmox-gallarza | proxmox |
| proxmoxalmeria | proxmoxalmeria | proxmox |


Templates Proxmox-like:

| Template | Nombre | Coincidencias |
| --- | --- | --- |
| Ceph by Zabbix agent 2 | Ceph by Zabbix agent 2 | ceph |
| Proxmox VE by HTTP | Proxmox VE by HTTP | proxmox |
| VMware Hypervisor | VMware Hypervisor | hypervisor |

## Backups

- Items relacionados con backup: 10.
- Triggers relacionados con backup: 26.
- Hosts con evidencia directa de backup: 3.
- Hosts criticos sin evidencia directa de backup: 21.

Hosts con evidencia directa de backup:

| Host |
| --- |
| SRVCOPIAS |
| SrvBackupALM |
| esxibck.semillas.local |


Hosts criticos sin evidencia directa de backup:

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

## Plan priorizado

### CRÍTICO

| Accion propuesta | Objeto | Riesgo | Beneficio | Cambio Zabbix | Cambio externo | Automatizable | Comando/API aproximado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Confirmar y tratar fallo SMART reportado; preparar sustitucion o migracion si el NAS confirma estado anomalo. | NasAlmeria: Faulty SMART state of HDD 5 | Riesgo de fallo de disco, degradacion RAID o perdida de datos si se ignora. | Reduce riesgo de perdida de datos y elimina una alerta High persistente por causa fisica. | no | si | parcial | ssh/GUI NAS para validar SMART; despues, si procede, mantenimiento fisico fuera de Zabbix. |


### ALTO

| Accion propuesta | Objeto | Riesgo | Beneficio | Cambio Zabbix | Cambio externo | Automatizable | Comando/API aproximado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Corregir items unsupported enabled por causa, empezando por Zabbix server, SAIs y storage/NAS. | 83 items unsupported enabled en 22 hosts | Los fallos en items clave dejan huecos ciegos o generan falsas conclusiones sobre disponibilidad. | Recupera datos de salud, reduce ruido y mejora fiabilidad de triggers. | si | si | parcial | API posterior: item.get para confirmar; host.update/template.update solo tras confirmacion humana. |
| Validar cobertura real de backups en hosts criticos sin evidencia directa en Zabbix. | 21 hosts criticos sin evidencia directa de backup | Backups incompletos o no verificados pueden impedir recuperacion ante incidente. | Permite mapear RPO/RTO y crear checks por servidor o por job central. | si | si | parcial | API posterior: crear template/check preparado; fuera de Zabbix: consultar PBS/vzdump/borg/restic/rsync. |
| Comparar inventario real Proxmox/PBS con hosts Zabbix para detectar VMs, datastores o nodos no cubiertos. | 4 hosts Proxmox-like detectados | Zabbix no puede demostrar por si solo que todas las VMs y datastores existen como objetos monitorizados. | Cierra huecos de monitorizacion en virtualizacion, storage, backups y Ceph. | si | si | si | Script futuro: consultar Proxmox API /nodes, /cluster/resources, /storage y comparar con host.get. |


### MEDIO

| Accion propuesta | Objeto | Riesgo | Beneficio | Cambio Zabbix | Cambio externo | Automatizable | Comando/API aproximado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Revisar hosts sin datos recientes y decidir corregir SNMP/agente, mantenimiento o retirada confirmada. | 5 hosts sin datos recientes | Inventario obsoleto o conectividad rota produce huecos silenciosos. | Aclara si los equipos siguen en servicio y recupera datos frescos. | si | si | parcial | Comprobacion futura: zabbix_get/snmpwalk/ping por host; API posterior solo tras clasificacion. |
| Revisar triggers deshabilitados por host/template antes de reactivarlos o documentarlos. | 79 triggers deshabilitados | Triggers deshabilitados pueden ocultar fallos reales; reactivarlos sin revision puede generar ruido. | Permite recuperar deteccion util sin inundar alertas. | si | no | no | API posterior con confirmacion: trigger.update status=0 solo para triggerids aprobados. |


### BAJO

| Accion propuesta | Objeto | Riesgo | Beneficio | Cambio Zabbix | Cambio externo | Automatizable | Comando/API aproximado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normalizar documentacion operativa, nombres y mapa de cobertura por grupo. | Repositorio zabbix-codex e informes | Bajo; no afecta a monitorizacion en tiempo real. | Facilita fases posteriores y reduce errores manuales. | no | no | si | Crear/actualizar Markdown y scripts auxiliares en /opt/zabbix-codex sin tocar Zabbix. |


## Cambios seguros para aplicar automáticamente en la siguiente fase

| Cambio | Riesgo | Cambio Zabbix | Cambio externo | Comando/API aproximado |
| --- | --- | --- | --- | --- |
| Crear scripts auxiliares de diagnostico read-only para SMART/QNAP, SNMP y Proxmox inventory diff. | bajo | no | no | Crear scripts en /opt/zabbix-codex/scripts y ejecutarlos en modo consulta. |
| Crear informes adicionales por grupo: unsupported, triggers disabled, backups y Proxmox. | bajo | no | no | Leer zabbix-remediation-plan.json y generar Markdown/CSV. |
| Crear templates nuevos no asignados o drafts de checks preparados para backups/Proxmox. | bajo-medio | si | no | template.create sin vincular a hosts; no activar alertas ni enlazar templates. |
| Crear checks preparados pero no vinculados para validar PBS/vzdump/restic/borg/rsync. | bajo | no | no | Generar scripts y documentar UserParameters sin desplegarlos aun. |

## Cambios que requieren confirmación humana

- Borrar o deshabilitar items unsupported.
- Modificar templates usados por hosts existentes.
- Cambiar triggers existentes o reactivar triggers deshabilitados.
- Tocar alertas, acciones, media types o destinatarios.
- Silenciar, cerrar manualmente o reconocer como solucion un problema SMART/disco.
- Cambios fisicos o logicos sobre SMART/discos/RAID/NAS.
- Cambios en jobs, retencion o validacion de backups.
- Cambios en Proxmox, PBS, Ceph, datastores, nodos o VMs.
- Modificar macros SNMP/credenciales en hosts o templates.

## Proximos pasos

- Validar manualmente el SMART High de NasAlmeria en el NAS antes de cualquier cambio en Zabbix.
- Preparar diagnosticos read-only por causa de unsupported: Zabbix server internal, Eaton/SNMP, NAS/SMART e impresoras.
- Cruzar inventario Proxmox/PBS real contra Zabbix antes de crear o vincular checks.
- Preparar una lista de cambios candidatos para aprobacion humana con IDs exactos de items/triggers/templates.
