# Unsupported Zabbix internal

Generado: 2026-05-20T16:16:37+02:00

## Resumen

- Items unsupported del bloque: 13.
- La mayoría son métricas internas de procesos no arrancados o capacidades no usadas.
- No se recomienda activar pollers/procesos solo para limpiar unsupported sin confirmar uso real.

## Items

| Host | ItemID | Nombre | Key | Tipo | Estado | Error | Interfaz | Template | Discovery | Último dato | Prioridad | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Zabbix server | 23267 | Utilization of snmp trapper data collector processes, in % | zabbix[process,snmp trapper,avg,busy] | Zabbix internal | enabled/unsupported | No "snmp trapper" processes started. | none | Zabbix server health | no | never | BAJO | Confirmar si se reciben traps SNMP. Si no se usan, documentar override; si se usan, revisar StartSNMPTrapper y snmptrapd. |
| Zabbix server | 34318 | Utilization of report writer internal processes, in % | zabbix[process,report writer,avg,busy] | Zabbix internal | enabled/unsupported | No "report writer" processes started. | none | Zabbix server health | no | never | BAJO | Confirmar si se usan scheduled reports. Si no se usan, documentar override; si se usan, revisar reporting services/procesos. |
| Zabbix server | 55650 | Interface enp6s18: Speed | vfs.file.contents["/sys/class/net/enp6s18/speed"] | Zabbix agent | enabled/unsupported | Value of type "double" is not suitable for value type "Numeric (unsigned)". Value "-1000000" | agent 127.0.0.1:10050 |  | sí | never | BAJO | Revisar si el item del template Zabbix server health aplica a esta instalación antes de tocarlo. |
| Zabbix server | 23261 | Utilization of ipmi poller data collector processes, in % | zabbix[process,ipmi poller,avg,busy] | Zabbix internal | enabled/unsupported | No "ipmi poller" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usan checks IPMI. Si no se usan, documentar override futuro; si se usan, revisar StartIPMIPollers/StartIPMIManagers. |
| Zabbix server | 23262 | Utilization of java poller data collector processes, in % | zabbix[process,java poller,avg,busy] | Zabbix internal | enabled/unsupported | No "java poller" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si hay JMX/Java monitorizado. Si no existe, tratar como ruido de template; si existe, revisar StartJavaPollers. |
| Zabbix server | 23328 | Utilization of vmware collector data collector processes, in % | zabbix[process,vmware collector,avg,busy] | Zabbix internal | enabled/unsupported | No "vmware collector" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usa monitorización VMware API. Si no se usa, documentar override; si se usa, revisar StartVMwareCollectors. |
| Zabbix server | 23635 | VMware cache, % used | zabbix[vmware,buffer,pused] | Zabbix internal | enabled/unsupported | No "vmware collector" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usa monitorización VMware API. Si no se usa, documentar override; si se usa, revisar StartVMwareCollectors. |
| Zabbix server | 25367 | Utilization of ipmi manager internal processes, in % | zabbix[process,ipmi manager,avg,busy] | Zabbix internal | enabled/unsupported | No "ipmi manager" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usan checks IPMI. Si no se usan, documentar override futuro; si se usan, revisar StartIPMIPollers/StartIPMIManagers. |
| Zabbix server | 34319 | Utilization of report manager internal processes, in % | zabbix[process,report manager,avg,busy] | Zabbix internal | enabled/unsupported | No "report manager" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usan scheduled reports. Si no se usan, documentar override; si se usan, revisar reporting services/procesos. |
| Zabbix server | 42235 | Number of installed packages | system.sw.packages.get | Zabbix agent | enabled/unsupported | Cannot obtain package information. | agent 127.0.0.1:10050 | Linux by Zabbix agent | no | never | MEDIO | Diagnosticar agente local con zabbix_get y revisar permisos/logs del agente para consulta de paquetes. |
| Zabbix server | 44788 | Connector queue | zabbix[connector_queue] | Zabbix internal | enabled/unsupported | connector is not initialized: please check "StartConnectors" configuration parameter | none | Zabbix server health | no | never | MEDIO | Confirmar si se usan connectors. Si no se usan, documentar override; si se usan, revisar StartConnectors. |
| Zabbix server | 44789 | Utilization of connector manager internal processes, in % | zabbix[process,connector manager,avg,busy] | Zabbix internal | enabled/unsupported | No "connector manager" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usan connectors. Si no se usan, documentar override; si se usan, revisar StartConnectors. |
| Zabbix server | 44790 | Utilization of connector worker internal processes, in % | zabbix[process,connector worker,avg,busy] | Zabbix internal | enabled/unsupported | No "connector worker" processes started. | none | Zabbix server health | no | never | MEDIO | Confirmar si se usan connectors. Si no se usan, documentar override; si se usan, revisar StartConnectors. |

## Diagnóstico por función

| Función | Diagnóstico |
| --- | --- |
| IPMI poller/manager | Solo necesario si se usan items IPMI. Si no hay IPMI real, es ruido del template Zabbix server health. |
| Java poller | Solo necesario si hay JMX/Java. Si no existe JMX, no activar StartJavaPollers solo para limpiar. |
| SNMP trapper | Solo necesario si se reciben traps SNMP. Si se monitoriza por polling SNMP normal, puede ser ruido. |
| VMware collector/cache | Solo necesario para VMware API. ESXi por SNMP no implica StartVMwareCollectors. |
| Report writer/manager | Solo necesario para scheduled reports/rendering. Confirmar uso antes de activar procesos. |
| Connector queue/manager/worker | Solo necesario si se usan connectors. Requiere revisar StartConnectors. |
| Paquetes instalados | El item system.sw.packages.get falla por obtención de paquetes; diagnosticar agente/permisos/logs antes de tocar template. |

## Cambios futuros sugeridos

- Crear documentación de capacidades Zabbix server realmente usadas.
- Crear overrides preparados para métricas internas no aplicables, sin aplicarlos aún.
- Diagnosticar `system.sw.packages.get` con `zabbix_get` y logs del agente.
