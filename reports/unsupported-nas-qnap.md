# Unsupported NAS/QNAP

Generado: 2026-05-20T16:16:37+02:00

## Resumen

- Items unsupported del bloque: 21.
- Incluye items SMART, discos, pools, volúmenes y SNMP QNAP.
- NasAlmeria requiere atención operativa por SMART HDD 5.

## Items unsupported NAS/QNAP

| Host | ItemID | Nombre | Key | Tipo | Estado | Error | Interfaz | Template | Discovery | Último dato | Prioridad | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NAS-CALAHORRA | 52016 | HDD 3: State | hdd.state[3] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-5" | snmp 192.168.100.82:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NAS-CALAHORRA | 52017 | HDD 4: State | hdd.state[4] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-5" | snmp 192.168.100.82:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NASALM1 | 51749 | CPU Temperature | cpu.temp | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.102.200:161 | SNMP QNAP | no | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NASALM1 | 51829 | Volume 1: Status | volume.status[1] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "Ready" | snmp 192.168.102.200:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NASALM2 | 51834 | CPU Temperature | cpu.temp | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.102.201:161 | SNMP QNAP | no | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NASALM2 | 51895 | Volume 1: Status | volume.status[1] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "Ready" | snmp 192.168.102.201:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasAlmeria | 51487 | Pool 1: Status | pool.status[1] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.102.234:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasAlmeria | 51496 | Volume 1: Status | volume.status[1] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "Ready" | snmp 192.168.102.234:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 51260 | Volume 1: Status | volume.status[1] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "Ready" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 51261 | Volume 2: Status | volume.status[2] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "Ready" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 51272 | FAN 3: Name | fan.name[3] | SNMP agent | enabled/unsupported | No Such Instance currently exists at this OID | snmp 192.168.102.242:161 |  | sí | never | ALTO | Validar OID QNAP por modelo/firmware; puede ser discovery desactualizado o disco/volumen ausente. |
| NasGenomica | 51316 | HDD 7: State | hdd.state[7] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-5" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 51317 | HDD 8: State | hdd.state[8] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-5" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 56613 | HDD 9: State | hdd.state[9] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-5" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 56614 | HDD 9: SMART Status | hdd.status[9] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasGenomica | 56615 | HDD 9: Temperature | hdd.temp[9] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.102.242:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasRamiroA | 51525 | CPU Temperature | cpu.temp | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.100.80:161 | SNMP QNAP | no | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasRamiroA | 51613 | Volume 1: Status | volume.status[1] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "Ready" | snmp 192.168.100.80:161 |  | sí | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasRamiroB | 51629 | CPU Temperature | cpu.temp | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.100.81:161 | SNMP QNAP | no | never | ALTO | Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico. |
| NasAlmeria | 51464 | HDD 5: State | hdd.state[5] | SNMP agent | enabled/unsupported | No Such Instance currently exists at this OID | snmp 192.168.102.234:161 |  | sí | never | CRÍTICO | Confirmar estado físico del HDD 5 en GUI/SSH QNAP; no silenciar alerta SMART como solución principal. |
| NasAlmeria | 51474 | HDD 5: Temperature | hdd.temp[5] | SNMP agent | enabled/unsupported | Value of type "string" is not suitable for value type "Numeric (unsigned)". Value "-1" | snmp 192.168.102.234:161 |  | sí | never | CRÍTICO | Confirmar estado físico del HDD 5 en GUI/SSH QNAP; no silenciar alerta SMART como solución principal. |

## NasAlmeria HDD 5

| Campo | Valor |
| --- | --- |
| Problema | Faulty SMART state of HDD 5 |
| Severidad | High |
| Inicio | 2025-12-26 12:04:45 CET |
| Duración | 145d 3h |
| Operational data | Current state: Abnormal (2) |
| Trigger | 25766 / disabled / Faulty SMART state of HDD 5 |
| Item | 51469 / HDD 5: SMART Status / hdd.status[5] |
| Último valor | 2 |
| Último dato | 2026-05-20 16:00:51 CEST |
| Diagnóstico | El item SMART hdd.status[5] devuelve datos recientes con valor 2/Abnormal. Esto apunta a estado SMART/fallo fisico reportado por el NAS, no a fallo de Zabbix. |

### Historial reciente SMART

| Clock | Valor |
| --- | --- |
| 2026-05-20 16:00:51 CEST | 2 |
| 2026-05-20 15:30:50 CEST | 2 |
| 2026-05-20 15:00:49 CEST | 2 |
| 2026-05-20 14:30:50 CEST | 2 |
| 2026-05-20 14:00:50 CEST | 2 |
| 2026-05-20 13:30:51 CEST | 2 |
| 2026-05-20 13:00:51 CEST | 2 |
| 2026-05-20 12:30:50 CEST | 2 |
| 2026-05-20 12:00:51 CEST | 2 |
| 2026-05-20 11:30:42 CEST | 2 |
| 2026-05-20 11:00:51 CEST | 2 |
| 2026-05-20 10:30:45 CEST | 2 |
| 2026-05-20 10:00:52 CEST | 2 |
| 2026-05-20 09:30:42 CEST | 2 |
| 2026-05-20 09:00:55 CEST | 2 |
| 2026-05-20 08:30:52 CEST | 2 |
| 2026-05-20 08:00:50 CEST | 2 |
| 2026-05-20 07:30:42 CEST | 2 |
| 2026-05-20 07:00:47 CEST | 2 |
| 2026-05-20 06:30:52 CEST | 2 |

### Acción operativa recomendada para NasAlmeria

- No silenciar ni cerrar. Confirmar en GUI/SSH QNAP, revisar RAID/storage pool y planificar sustitucion del HDD 5 si el NAS confirma el fallo.
- No cerrar, silenciar ni tratar como limpieza de Zabbix hasta confirmar estado físico.
- Validar HDD 5 en GUI/SSH QNAP y revisar estado RAID/storage pool antes de cualquier cambio.

Comandos propuestos, no ejecutados:

- ssh <admin>@<ip-de-NasAlmeria>
- GUI QNAP: Storage & Snapshots > Disks/VJBOD > HDD 5 > SMART information
- qcli_storage -d
- qcli_storage -T force=1
- smartctl -a -d sat /dev/<disco_hdd5>
- dmesg | egrep -i 'smart|error|fail|ata|disk|hdd|ssd'
