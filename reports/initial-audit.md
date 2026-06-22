# Auditoria inicial Zabbix

Fecha: 2026-05-20 13:55:24 CEST  
Host auditado: `localhost`  
Workspace: `/opt/zabbix-codex`

## Alcance

Esta ejecucion fue solo de auditoria, preparacion de estructura y creacion de un script auxiliar. No se borraron ficheros, no se reiniciaron servicios y no se modifico la configuracion de Zabbix.

## Estado del servidor

| Campo | Valor |
| --- | --- |
| Sistema operativo | Rocky Linux 9.7 (Blue Onyx) |
| Kernel | 5.14.0-611.11.1.el9_7.x86_64 |
| Virtualizacion | KVM/QEMU |
| Hostname estatico | `(unset)` |
| Hostname transitorio/FQDN | `localhost` |
| IP principal detectada | `192.168.100.124/24` en `enp6s18` |
| Usuario de auditoria | `codexops` (`uid=1000`, `gid=1000`) |
| Uptime | 29 dias, 23:19 |
| Carga | 0.36, 0.36, 0.28 |
| Memoria | 7.5 GiB total, 6.4 GiB disponible |
| Swap | 7.9 GiB total, 1.0 MiB usada |
| Disco `/` | XFS, 62 GiB total, 14% usado |
| SELinux | `Disabled` |
| firewalld | `active` |
| Unidades fallidas systemd | 0 |

Puertos en escucha detectados:

| Puerto | Estado |
| --- | --- |
| `22/tcp` | SSH escuchando en IPv4/IPv6 |
| `80/tcp` | nginx escuchando en IPv4/IPv6 |
| `3306/tcp` | MariaDB escuchando en `*` |
| `10050/tcp` | Zabbix agent escuchando en IPv4/IPv6 |
| `10051/tcp` | Zabbix server escuchando en IPv4/IPv6 |

firewalld zona `public`:

- Interfaz: `enp6s18`.
- Servicios permitidos: `cockpit`, `dhcpv6-client`, `http`, `ssh`.
- Puertos permitidos: `10051/tcp`, `10050/tcp`.
- No se detecto HTTPS abierto en firewalld.

## Versiones y paquetes principales

| Componente | Version |
| --- | --- |
| Zabbix server | 7.0.26 |
| Zabbix agent | 7.0.26 |
| Zabbix web | 7.0.26 |
| MariaDB | 10.5.29-MariaDB |
| PHP-FPM | 8.0.30 |
| nginx | 1.20.1 |
| PHP CLI | No disponible en `PATH` (`php: command not found`) |
| Apache/httpd | No disponible como binario `httpd` |

Paquetes Zabbix instalados:

- `zabbix-server-mysql-7.0.26-release1.el9.x86_64`
- `zabbix-agent-7.0.26-release1.el9.x86_64`
- `zabbix-web-7.0.26-release1.el9.noarch`
- `zabbix-web-mysql-7.0.26-release1.el9.noarch`
- `zabbix-nginx-conf-7.0.26-release1.el9.noarch`
- `zabbix-sql-scripts-7.0.26-release1.el9.noarch`
- `zabbix-get-7.0.26-release1.el9.x86_64`
- `zabbix-release-7.0-5.el9.noarch`

## Servicios relacionados

| Servicio | Estado | Arranque |
| --- | --- | --- |
| `zabbix-server.service` | `active` | `enabled` |
| `zabbix-agent.service` | `active` | `enabled` |
| `nginx.service` | `active` | `enabled` |
| `php-fpm.service` | `active` | `enabled` |
| `mariadb.service` | `active` | `enabled` |

No se detectaron unit files de `zabbix-proxy`.

## Base de datos

Configuracion de `/etc/zabbix/zabbix_server.conf`:

- `DBHost=localhost`
- `DBName=zabbix`
- `DBUser=zabbix`

Configuracion del frontend en `/etc/zabbix/web/zabbix.conf.php`:

- Tipo: `MYSQL`
- Servidor: `localhost`
- Puerto: `0`
- Base de datos: `zabbix`
- Usuario: `zabbix`
- Cifrado DB: `false`

Validacion MariaDB:

- MariaDB responde localmente como root via `sudo`.
- Existe la base de datos `zabbix`.
- Tabla `zabbix.dbversion`: `mandatory=7000000`, `optional=7000030`.

## Frontend y API

Configuracion web detectada:

- nginx escucha en `80`.
- El virtual host de Zabbix usa `root /usr/share/zabbix`.
- El endpoint API local correcto es `http://127.0.0.1/api_jsonrpc.php`.
- `http://127.0.0.1/api_jsonrpc.php` responde `apiinfo.version = 7.0.26`.
- `http://127.0.0.1/zabbix/api_jsonrpc.php` responde `File not found`.

PHP-FPM:

- Existe pool general `www` en `/run/php-fpm/www.sock`.
- Existe pool Zabbix en `/run/php-fpm/zabbix.sock`.
- nginx esta configurado actualmente con `fastcgi_pass unix:/run/php-fpm/www.sock`.

Configuracion API en `/etc/zabbix-codex/zabbix.env`:

- El fichero existe.
- `ZABBIX_URL` configurado: `https://TU-ZABBIX/zabbix/api_jsonrpc.php`
- `ZABBIX_TOKEN` configurado: si, longitud 20, valor no impreso.
- Permisos reales:
  - `/etc/zabbix-codex`: `drwxr-x--- root root`
  - `/etc/zabbix-codex/zabbix.env`: `-rw------- codexops codexops`

Resultado de pruebas API:

- La URL configurada en `ZABBIX_URL` no resuelve: `Name or service not known`.
- La API local sin token responde correctamente con version `7.0.26`.
- La validacion del token contra el endpoint local fallo con: `Invalid params.: Session terminated, re-login, please.`
- El script `scripts/zabbix_api_test.py` funciona sintacticamente, pero debe ejecutarse con `sudo` o corregir permisos del directorio `/etc/zabbix-codex` para poder leer el env desde el usuario `codexops`.

## Rutas principales

| Ruta | Uso |
| --- | --- |
| `/opt/zabbix-codex` | Workspace del proyecto |
| `/opt/zabbix-codex/scripts` | Scripts propios |
| `/opt/zabbix-codex/templates` | Templates Zabbix del proyecto |
| `/opt/zabbix-codex/inventory` | Inventario |
| `/opt/zabbix-codex/reports` | Informes del proyecto |
| `/var/log/zabbix-codex` | Logs/reportes operativos del proyecto |
| `/etc/zabbix-codex/zabbix.env` | Configuracion API/token del proyecto |
| `/etc/zabbix/zabbix_server.conf` | Configuracion Zabbix server |
| `/etc/zabbix/zabbix_agentd.conf` | Configuracion Zabbix agent |
| `/etc/zabbix/web/zabbix.conf.php` | Configuracion frontend Zabbix |
| `/etc/nginx/conf.d/zabbix.conf` | Virtual host nginx de Zabbix |
| `/etc/php-fpm.d/zabbix.conf` | Pool PHP-FPM Zabbix |
| `/usr/share/zabbix` | Codigo frontend Zabbix |
| `/var/log/zabbix` | Logs Zabbix |

## Riesgos detectados

1. `ZABBIX_URL` contiene un placeholder o ruta incorrecta (`https://TU-ZABBIX/zabbix/api_jsonrpc.php`). El endpoint local real responde en `/api_jsonrpc.php`.
2. `ZABBIX_TOKEN` esta presente, pero no valida contra la API local. Debe regenerarse o revisarse el token configurado.
3. El usuario `codexops` es propietario de `zabbix.env`, pero no puede atravesar `/etc/zabbix-codex` porque el directorio es `root:root 750`. El script requiere `sudo` en el estado actual.
4. Hostname estatico no configurado. El sistema reporta hostname transitorio `localhost`, lo cual puede afectar inventario, identificacion y correlacion de alertas.
5. SELinux esta deshabilitado. No bloquea Zabbix, pero reduce postura de seguridad del servidor.
6. MariaDB escucha en `*:3306`. firewalld no expone 3306 en la zona activa, pero conviene revisar bind-address para minimizar exposicion interna.
7. No hay HTTPS activo en nginx/firewalld para el frontend. Si el acceso sera remoto, conviene publicar TLS antes de uso operativo.
8. nginx usa el socket PHP-FPM `www.sock` aunque existe un pool especifico `zabbix.sock`. No se modifica ahora, pero merece revision para aislar recursos de frontend.
9. PHP CLI no esta instalado o no esta en `PATH`; para futuras automatizaciones puede ser util, aunque no es imprescindible para el frontend.

## Proximos pasos recomendados

1. Corregir `/etc/zabbix-codex/zabbix.env` con el endpoint real, probablemente `http://127.0.0.1/api_jsonrpc.php` para uso local o la URL publica definitiva si se usara remotamente.
2. Crear o regenerar un API token valido de Zabbix con permisos de lectura suficientes para inventario, hosts, templates, triggers, items y problemas.
3. Ajustar permisos de `/etc/zabbix-codex` para que `codexops` pueda leer `zabbix.env` sin `sudo`, o documentar que los scripts API se ejecutan con `sudo`.
4. Definir hostname estatico del servidor.
5. Revisar exposicion de MariaDB y decidir si debe escuchar solo en localhost.
6. Decidir si el frontend debe exponerse con HTTPS.
7. En la siguiente fase, construir inventario desde API: hosts, grupos, templates enlazados, items deshabilitados, triggers deshabilitados, problemas activos y proxies.

## Comandos principales ejecutados

```bash
pwd
ls -la
test -f AGENTS.md && sed -n '1,220p' AGENTS.md || true
find . -maxdepth 2 -type f | sort
cat /etc/os-release
hostnamectl
hostname -f
ip -brief addr
id
rpm -qa 'zabbix*' 'php*' 'httpd*' 'nginx*' 'mariadb*' 'mysql*' 'postgresql*' | sort
bash -lc 'for b in zabbix_server zabbix_proxy zabbix_agentd zabbix_agent2; do if command -v "$b" >/dev/null 2>&1; then "$b" -V 2>&1 | sed -n "1,4p"; fi; done'
php -v
httpd -v
nginx -v
sudo -n awk -F= '/^[[:space:]]*DB(Name|User|Host|Port|Socket|TLSConnect|TLSCAFile|TLSCertFile|TLSKeyFile)=/ {print $1"="$2}' /etc/zabbix/zabbix_server.conf
sudo -n awk '/^[[:space:]]*\$DB\[/ && $0 !~ /PASSWORD/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); print $0}' /etc/zabbix/web/zabbix.conf.php
sudo -n awk 'BEGIN{FS="="} /^[[:space:]]*#/ || /^[[:space:]]*$/ {next} {line=$0; sub(/^[[:space:]]*export[[:space:]]+/, "", line); pos=index(line, "="); if (pos == 0) next; key=substr(line,1,pos-1); val=substr(line,pos+1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", key); gsub(/^[[:space:]]+|[[:space:]]+$/, "", val); if (key ~ /(TOKEN|PASS|SECRET|KEY)/) printf "%s=<masked,length=%d>\n", key, length(val); else printf "%s=%s\n", key, val}' /etc/zabbix-codex/zabbix.env
systemctl --no-pager --plain list-units --type=service --all 'zabbix*' 'nginx*' 'php-fpm*' 'mariadb*' 'mysql*' 'httpd*'
systemctl --no-pager --plain is-active zabbix-server zabbix-agent nginx php-fpm mariadb
systemctl --no-pager --plain is-enabled zabbix-server zabbix-agent nginx php-fpm mariadb
ss -lntup
sudo -n firewall-cmd --list-all
sudo -n mariadb -NBe 'SELECT VERSION(); SHOW DATABASES LIKE "zabbix";'
sudo -n mariadb -NBe 'SELECT mandatory,optional FROM zabbix.dbversion;'
curl --max-time 5 -sS -X POST -H 'Content-Type: application/json-rpc' -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}' http://127.0.0.1/api_jsonrpc.php
sudo -n python3 -c 'import importlib.util; spec=importlib.util.spec_from_file_location("zapi", "scripts/zabbix_api_test.py"); z=importlib.util.module_from_spec(spec); spec.loader.exec_module(z); env=z.load_env(z.ENV_FILE); token=env.get("ZABBIX_TOKEN", ""); url="http://127.0.0.1/api_jsonrpc.php"; version=z.json_rpc(url, "apiinfo.version"); sample=z.json_rpc(url, "host.get", {"output": ["hostid", "host"], "limit": 1}, token=token); print(f"Local API version: {version}"); print(f"Token validation against local endpoint: OK ({len(sample)} sample host(s))")'
python3 -m py_compile scripts/zabbix_api_test.py
python3 scripts/zabbix_api_test.py
sudo -n python3 scripts/zabbix_api_test.py
```
