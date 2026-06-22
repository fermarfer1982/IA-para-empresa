# Diagnostico externo read-only

Resumen consolidado de pruebas externas read-only. No se han aplicado cambios en Zabbix ni en los dispositivos.

## SNMP externo
- Targets diagnosticados: `18`
- SNMP reachable: `9`
- SNMP not reachable: `9`

| Host | Target | SNMP | Conclusion | Recomendacion |
| --- | --- | --- | --- | --- |
| NasAlmeria | 192.168.102.234:161 | OK | snmp_responde_pero_hay_oids_no_soportadas_template_mib | SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen. |
| NasGenomica | 192.168.102.242:161 | OK | snmp_responde_pero_hay_oids_no_soportadas_template_mib | SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen. |
| EATON 5PX 2200 SAI ALMERIA | 192.168.102.235:161 | OK | snmp_responde_pero_hay_oids_no_soportadas_template_mib | SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen. |
| EATON 5PX 2200 ( SAI GALLARZA ) | 192.168.100.24:161 | OK | snmp_responde_pero_hay_oids_no_soportadas_template_mib | SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen. |
| HP V1810-48G GALLARZA | 192.168.100.21:161 | OK | snmp_responde_pero_hay_oids_no_soportadas_template_mib | SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen. |
| HP LASERJET M402DN GALLARZA SERGIO | 192.168.100.169:161 | FAIL | sin_respuesta_snmp_timeout_red_acl_equipo | Verificar conectividad, ACL/firewall SNMP, estado del equipo y comunidad SNMP antes de tocar templates. |
| HP LASERJET PRO M404DN GALLARZA | 192.168.100.221:161 | FAIL | sin_respuesta_snmp_timeout_red_acl_equipo | Verificar conectividad, ACL/firewall SNMP, estado del equipo y comunidad SNMP antes de tocar templates. |
| HP LASERJET PRO 4002DN GALLARZA ALFONSO | 192.168.100.162:161 | FAIL | sin_respuesta_snmp_timeout_red_acl_equipo | Verificar conectividad, ACL/firewall SNMP, estado del equipo y comunidad SNMP antes de tocar templates. |
| BROTHER HL-L2445DW | 192.168.102.221:161 | FAIL | sin_respuesta_snmp_timeout_red_acl_equipo | Verificar conectividad, ACL/firewall SNMP, estado del equipo y comunidad SNMP antes de tocar templates. |
| CANON iR-ADV C3830 | 192.168.100.106:161 | FAIL | sin_respuesta_snmp_timeout_red_acl_equipo | Verificar conectividad, ACL/firewall SNMP, estado del equipo y comunidad SNMP antes de tocar templates. |
| BROTHER HL-L8360CDW series | 192.168.102.243:161 | OK | snmp_responde_checks_basicos_ok | SNMP base operativo; comparar gaps restantes contra templates y politica de cobertura. |
| HP COLOR LASERJET E45028 GALLARZA INFORMATICA | 192.168.100.220:161 | OK | snmp_responde_checks_basicos_ok | SNMP base operativo; comparar gaps restantes contra templates y politica de cobertura. |
| HP LASERJET PRO 4002DN GALLARZA JULIAN JR | 192.168.100.136:161 | OK | snmp_responde_checks_basicos_ok | SNMP base operativo; comparar gaps restantes contra templates y politica de cobertura. |
| ZEBRA ALMERIA | 192.168.102.210:161 | OK | snmp_responde_pero_hay_oids_no_soportadas_template_mib | SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen. |
| LP-FERNANDO |  | FAIL | sin_interfaz_snmp_en_zabbix | No ejecutar SNMP externo; revisar metodo de monitorizacion esperado. |
| SRVCOPIAS |  | FAIL | sin_interfaz_snmp_en_zabbix | No ejecutar SNMP externo; revisar metodo de monitorizacion esperado. |
| SrvBackupALM |  | FAIL | sin_interfaz_snmp_en_zabbix | No ejecutar SNMP externo; revisar metodo de monitorizacion esperado. |
| proxmoxalmeria |  | FAIL | sin_interfaz_snmp_en_zabbix | No ejecutar SNMP externo; revisar metodo de monitorizacion esperado. |

## zabbix_get local
- Checks OK: `12/13`
- Target: `127.0.0.1:10050`

| Key | Estado | Salida |
| --- | --- | --- |
| agent.ping | OK | 1 |
| system.uname | OK | Linux localhost.localdomain 5.14.0-611.11.1.el9_7.x86_64 #1 SMP PREEMPT_DYNAMIC Wed Dec 3 13:51:50 UTC 2025 x86_64 |
| vfs.fs.discovery | OK | [{"{#FSNAME}":"/proc","{#FSTYPE}":"proc","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/sys","{#FSTYPE}":"sysfs","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/dev","{#FSTYPE}":"devtmpfs","{#FSOPTIONS}":"rw,seclabel,nosuid,size=4096k,nr_inodes=977492,mode=755,inode64"},{"{#FSNAME}":"/sys/kernel/security","{#FSTYPE}":"securityfs","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/dev/shm","{#FSTYPE}":"tmpfs","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,inode64"},{"{#FSNAME}":"/dev/pts","{#FSTYPE}":"devpts","{#FSOPTIONS}":"rw,seclabel,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000"},{"{#FSNAME}":"/run","{#FSTYPE}":"tmpfs","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,size=1573128k,nr_inodes=819200,mode=755,inode64"},{"{#FSNAME}":"/sys/fs/cgroup","{#FSTYPE}":"cgroup2","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot"},{"{#FSNAME}":"/sys/fs/pstore","{#FSTYPE}":"pstore","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/sys/fs/bpf","{#FSTYPE}":"bpf","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime,mode=700"},{"{#FSNAME}":"/sys/kernel/config","{#FSTYPE}":"configfs","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/","{#FSTYPE}":"xfs","{#FSOPTIONS}":"rw,seclabel,relatime,attr2,inode64,logbufs=8,logbsize=32k,noquota"},{"{#FSNAME}":"/sys/fs/selinux","{#FSTYP ... <truncated 1729 chars> |
| net.if.discovery | OK | [{"{#IFNAME}":"lo"},{"{#IFNAME}":"enp6s18"}] |
| system.sw.packages.get | FAIL | ZBX_NOTSUPPORTED: Cannot obtain package information. |
| proc.num[zabbix_server] | OK | 52 |
| proc.num[zabbix_agentd] | OK | 13 |
| proc.num[zabbix_agent2] | OK | 0 |
| proc.num[snmptrapd] | OK | 0 |
| proc.num[java] | OK | 0 |
| proc.num[nginx] | OK | 3 |
| proc.num[php-fpm] | OK | 15 |
| proc.num[mariadbd] | OK | 1 |

