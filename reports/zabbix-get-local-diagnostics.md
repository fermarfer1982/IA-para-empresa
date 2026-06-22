# Diagnostico zabbix_get local

Pruebas read-only ejecutadas contra la interfaz agent del host `Zabbix server` conocida por Zabbix.

- Generado: 2026-05-20 22:00:40 CEST
- Target: `127.0.0.1:10050`
- Checks ejecutados: `13`

## Resultados
| Key | Estado | Salida | Estado item Zabbix |
| --- | --- | --- | --- |
| agent.ping | OK | 1 | normal |
| system.uname | OK | Linux localhost.localdomain 5.14.0-611.11.1.el9_7.x86_64 #1 SMP PREEMPT_DYNAMIC Wed Dec 3 13:51:50 UTC 2025 x86_64 | normal |
| vfs.fs.discovery | OK | [{"{#FSNAME}":"/proc","{#FSTYPE}":"proc","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/sys","{#FSTYPE}":"sysfs","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/dev","{#FSTYPE}":"devtmpfs","{#FSOPTIONS}":"rw,seclabel,nosuid,size=4096k,nr_inodes=977492,mode=755,inode64"},{"{#FSNAME}":"/sys/kernel/security","{#FSTYPE}":"securityfs","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/dev/shm","{#FSTYPE}":"tmpfs","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,inode64"},{"{#FSNAME}":"/dev/pts","{#FSTYPE}":"devpts","{#FSOPTIONS}":"rw,seclabel,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000"},{"{#FSNAME}":"/run","{#FSTYPE}":"tmpfs","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,size=1573128k,nr_inodes=819200,mode=755,inode64"},{"{#FSNAME}":"/sys/fs/cgroup","{#FSTYPE}":"cgroup2","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot"},{"{#FSNAME}":"/sys/fs/pstore","{#FSTYPE}":"pstore","{#FSOPTIONS}":"rw,seclabel,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/sys/fs/bpf","{#FSTYPE}":"bpf","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime,mode=700"},{"{#FSNAME}":"/sys/kernel/config","{#FSTYPE}":"configfs","{#FSOPTIONS}":"rw,nosuid,nodev,noexec,relatime"},{"{#FSNAME}":"/","{#FSTYPE}":"xfs","{#FSOPTIONS}":"rw,seclabel,relatime,attr2,inode64,logbufs=8,logbsize=32k,noquota"},{"{#FSNAME}":"/sys/fs/selinux","{#FSTYP ... <truncated 1729 chars> | sin item directo |
| net.if.discovery | OK | [{"{#IFNAME}":"lo"},{"{#IFNAME}":"enp6s18"}] | sin item directo |
| system.sw.packages.get | FAIL | ZBX_NOTSUPPORTED: Cannot obtain package information. | unsupported |
| proc.num[zabbix_server] | OK | 52 | sin item directo |
| proc.num[zabbix_agentd] | OK | 13 | sin item directo |
| proc.num[zabbix_agent2] | OK | 0 | sin item directo |
| proc.num[snmptrapd] | OK | 0 | sin item directo |
| proc.num[java] | OK | 0 | sin item directo |
| proc.num[nginx] | OK | 3 | sin item directo |
| proc.num[php-fpm] | OK | 15 | sin item directo |
| proc.num[mariadbd] | OK | 1 | sin item directo |

