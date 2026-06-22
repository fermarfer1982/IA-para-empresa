# Unsupported other

Generado: 2026-05-20T16:16:37+02:00

## Resumen

- Items unsupported fuera de bloques principales: 9.

## Items

| Host | ItemID | Nombre | Key | Tipo | Estado | Error | Interfaz | Template | Discovery | Último dato | Prioridad | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HP V1810-48G GALLARZA | 55271 | CPU utilization | system.cpu.util[hpSwitchCpuStat.0] | SNMP agent | enabled/unsupported | cannot get SNMP result: No Such Object available on this agent at this OID | snmp 192.168.100.21:161 | HP Enterprise Switch by SNMP | no | never | BAJO | Verificar si el OID existe en el modelo/firmware; ajustar discovery override o template en una fase posterior. |
| HP V1810-48G GALLARZA | 55273 | Firmware version | system.hw.firmware | SNMP agent | enabled/unsupported | cannot get SNMP result: No Such Object available on this agent at this OID | snmp 192.168.100.21:161 | HP Enterprise Switch by SNMP | no | never | BAJO | Verificar si el OID existe en el modelo/firmware; ajustar discovery override o template en una fase posterior. |
| LP-FERNANDO | 50410 | Free swap space | system.swap.free | Calculated | enabled/unsupported | Cannot evaluate function: not enough data at "last(//system.swap.size[,total]) - last(//system.swap.size[,total]) / 100 * last(//perf_counter_en["\Paging file(_Total)\% Usage"])". | none | Windows by Zabbix agent | no | never | BAJO | Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor. |
| LP-FERNANDO | 50417 | Memory utilization | vm.memory.util | Calculated | enabled/unsupported | Cannot evaluate function: not enough data at "last(//vm.memory.size[used]) / last(//vm.memory.size[total]) * 100". | none | Windows by Zabbix agent | no | never | BAJO | Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor. |
| SRVCOPIAS | 52897 | Free swap space | system.swap.free | Calculated | enabled/unsupported | Cannot evaluate function: not enough data at "last(//system.swap.size[,total]) - last(//system.swap.size[,total]) / 100 * last(//perf_counter_en["\Paging file(_Total)\% Usage"])". | none | Windows by Zabbix agent | no | never | BAJO | Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor. |
| SRVCOPIAS | 52904 | Memory utilization | vm.memory.util | Calculated | enabled/unsupported | Cannot evaluate function: not enough data at "last(//vm.memory.size[used]) / last(//vm.memory.size[total]) * 100". | none | Windows by Zabbix agent | no | never | BAJO | Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor. |
| SrvBackupALM | 52197 | Free swap space | system.swap.free | Calculated | enabled/unsupported | Cannot evaluate function: not enough data at "last(//system.swap.size[,total]) - last(//system.swap.size[,total]) / 100 * last(//perf_counter_en["\Paging file(_Total)\% Usage"])". | none | Windows by Zabbix agent | no | never | BAJO | Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor. |
| SrvBackupALM | 52204 | Memory utilization | vm.memory.util | Calculated | enabled/unsupported | Cannot evaluate function: not enough data at "last(//vm.memory.size[used]) / last(//vm.memory.size[total]) * 100". | none | Windows by Zabbix agent | no | never | BAJO | Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor. |
| proxmoxalmeria | 56395 | Interface idrac: Speed | vfs.file.contents["/sys/class/net/idrac/speed"] | Zabbix agent | enabled/unsupported | Cannot read from file: read /sys/class/net/idrac/speed: invalid argument | agent 192.168.102.230:10050 |  | sí | never | BAJO | Revisar error exacto y decidir correccion especifica por host/template. |

## Recomendación

- Revisar por host y causa antes de modificar templates.
- Priorizar storage, backups y hosts críticos sobre limpieza estética.
