#!/usr/bin/env python3
"""Generate a read-only Zabbix remediation plan.

This script reads ZABBIX_URL and ZABBIX_TOKEN from /etc/zabbix-codex/zabbix.env,
queries the Zabbix API, and writes a technical remediation plan in Markdown and
JSON. It does not modify Zabbix and never prints or stores the token.
"""

from __future__ import annotations

import json
import re
import ssl
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


ENV_FILE = Path("/etc/zabbix-codex/zabbix.env")
COVERAGE_JSON = Path("/opt/zabbix-codex/reports/zabbix-coverage-report.json")
REPORT_MD = Path("/opt/zabbix-codex/reports/zabbix-remediation-plan.md")
REPORT_JSON = Path("/opt/zabbix-codex/reports/zabbix-remediation-plan.json")
TIMEOUT_SECONDS = 30
STALE_AFTER_SECONDS = 24 * 60 * 60

SEVERITIES = {
    "0": "Not classified",
    "1": "Information",
    "2": "Warning",
    "3": "Average",
    "4": "High",
    "5": "Disaster",
}

ITEM_TYPES = {
    "0": "Zabbix agent",
    "1": "SNMPv1 agent",
    "2": "Zabbix trapper",
    "3": "Simple check",
    "4": "SNMPv2 agent",
    "5": "Zabbix internal",
    "6": "SNMPv3 agent",
    "7": "Zabbix agent active",
    "8": "Aggregate",
    "9": "HTTP test",
    "10": "External check",
    "11": "Database monitor",
    "12": "IPMI agent",
    "13": "SSH agent",
    "14": "TELNET agent",
    "15": "Calculated",
    "16": "JMX agent",
    "17": "SNMP trap",
    "18": "Dependent item",
    "19": "HTTP agent",
    "20": "SNMP agent",
    "21": "Script",
    "22": "Browser",
}

INTERFACE_TYPES = {
    "1": "agent",
    "2": "snmp",
    "3": "ipmi",
    "4": "jmx",
}

AVAILABILITY = {
    "0": "unknown",
    "1": "available",
    "2": "unavailable",
}

PROXMOX_KEYWORDS = [
    "proxmox",
    "pve",
    "pbs",
    "ceph",
    "hypervisor",
]

PROXMOX_BROAD_KEYWORDS = [
    "proxmox",
    "pve",
    "pbs",
    "ceph",
    "hypervisor",
    "cluster",
    "backup",
]

BACKUP_KEYWORDS = [
    "backup",
    "pbs",
    "vzdump",
    "borg",
    "restic",
    "rsync",
    "copia",
    "copias",
    "snapshot",
]

STORAGE_KEYWORDS = [
    "storage",
    "datastore",
    "ceph",
    "zfs",
    "pool",
    "volume",
    "disk",
    "hdd",
    "ssd",
    "smart",
]

CRITICAL_GROUP_KEYWORDS = [
    "servidores",
    "server",
    "nas",
    "proxmox",
    "vmware",
    "zabbix servers",
    "servidores fisicos",
]


class ApiError(RuntimeError):
    """Raised for JSON-RPC level errors."""


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        raise FileNotFoundError(f"Environment file not found: {path}")

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        line = re.sub(r"^export\s+", "", line)
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        values[key] = value

    return values


def api_url_from_env(raw_url: str) -> str:
    url = raw_url.rstrip("/")
    if not url:
        raise ValueError("ZABBIX_URL is empty")

    if url.endswith("api_jsonrpc.php"):
        return url

    return f"{url}/api_jsonrpc.php"


def sanitize_url(url: str) -> str:
    parts = urlsplit(url)
    hostname = parts.hostname or ""
    netloc = hostname

    if parts.port is not None:
        netloc = f"{netloc}:{parts.port}"

    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def tls_context(env: dict[str, str]) -> ssl.SSLContext | None:
    verify = env.get("ZABBIX_VERIFY_TLS", "true").strip().lower()
    if verify in {"0", "false", "no", "off"}:
        return ssl._create_unverified_context()
    return None


class ZabbixApi:
    def __init__(self, url: str, token: str, context: ssl.SSLContext | None = None) -> None:
        self.url = url
        self.token = token
        self.context = context
        self.request_id = 0

    def call(self, method: str, params: dict[str, Any] | list[Any] | None = None, auth: bool = True) -> Any:
        self.request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params if params is not None else {},
            "id": self.request_id,
        }
        headers = {
            "Content-Type": "application/json-rpc",
            "User-Agent": "zabbix-codex-remediation-plan/1.0",
        }
        if auth:
            headers["Authorization"] = f"Bearer {self.token}"

        request = Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with urlopen(request, timeout=TIMEOUT_SECONDS, context=self.context) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP error {exc.code}: {body[:300]}") from exc
        except URLError as exc:
            raise RuntimeError(f"Connection error: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError(f"Connection timed out after {TIMEOUT_SECONDS}s") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid JSON response: {exc}") from exc

        if "error" in data:
            error = data["error"]
            message = error.get("message", "JSON-RPC error")
            details = error.get("data", "")
            if details:
                raise ApiError(f"{message}: {details}")
            raise ApiError(message)

        return data.get("result")


def safe_call(
    api: ZabbixApi,
    method: str,
    params: dict[str, Any] | list[Any] | None,
    errors: list[dict[str, str]],
    default: Any,
    auth: bool = True,
) -> Any:
    try:
        return api.call(method, params, auth=auth)
    except Exception as exc:  # noqa: BLE001 - plan should continue on partial permissions.
        errors.append({"method": method, "error": str(exc)})
        return default


def to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def format_ts(value: Any) -> str:
    timestamp = to_int(value)
    if timestamp <= 0:
        return "never"
    return datetime.fromtimestamp(timestamp).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def age_text(value: Any, now: int) -> str:
    timestamp = to_int(value)
    if timestamp <= 0:
        return "never"

    seconds = max(now - timestamp, 0)
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def contains_keyword(text: str, keywords: list[str]) -> bool:
    lower = text.lower()
    return any(keyword in lower for keyword in keywords)


def keyword_matches(text: str, keywords: list[str]) -> list[str]:
    lower = text.lower()
    return sorted({keyword for keyword in keywords if keyword in lower})


def item_type_name(item: dict[str, Any]) -> str:
    value = str(item.get("type", ""))
    return ITEM_TYPES.get(value, value or "unknown")


def compact_host(host: dict[str, Any] | None) -> dict[str, Any]:
    if not host:
        return {"hostid": None, "host": None, "name": None, "status": None}
    return {
        "hostid": host.get("hostid"),
        "host": host.get("host"),
        "name": host.get("name"),
        "status": "enabled" if str(host.get("status")) == "0" else "disabled",
    }


def display_host(host: dict[str, Any] | None) -> str:
    if not host:
        return "(unknown)"
    return str(host.get("name") or host.get("host") or host.get("hostid") or "(unknown)")


def summarize_interface(interface: dict[str, Any] | None) -> dict[str, Any] | None:
    if not interface:
        return None
    iface_type = str(interface.get("type", ""))
    return {
        "interfaceid": interface.get("interfaceid"),
        "type": INTERFACE_TYPES.get(iface_type, iface_type or "unknown"),
        "main": str(interface.get("main", "0")) == "1",
        "useip": str(interface.get("useip", "0")) == "1",
        "ip": interface.get("ip", ""),
        "dns": interface.get("dns", ""),
        "port": interface.get("port", ""),
        "available": AVAILABILITY.get(str(interface.get("available", "")), str(interface.get("available", ""))),
        "error": interface.get("error", ""),
    }


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        return "_Sin datos._\n"
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        safe_row = []
        for cell in row:
            value = "" if cell is None else str(cell)
            safe_row.append(value.replace("|", "\\|").replace("\n", " "))
        lines.append("| " + " | ".join(safe_row) + " |")
    return "\n".join(lines) + "\n"


def bullet_list(items: list[str], empty: str = "_Sin datos._") -> str:
    if not items:
        return empty + "\n"
    return "\n".join(f"- {item}" for item in items) + "\n"


def classify_unsupported(item: dict[str, Any]) -> str:
    error = str(item.get("error") or "").lower()
    key = str(item.get("key_") or "").lower()
    name = str(item.get("name") or "").lower()
    type_name = item_type_name(item).lower()
    snmp_context = "snmp" in type_name or bool(item.get("snmp_oid"))

    if "no \"" in error and "processes started" in error:
        return "dependencia de template"
    if "{$" in error or "macro" in error:
        return "macro ausente"
    if "timeout" in error or "timed out" in error:
        return "timeout"
    if any(token in error for token in ["authentication", "authorization", "community", "usm", "securityname", "wrong digest"]):
        return "credenciales/comunidad SNMP"
    if snmp_context and any(token in error for token in ["no such", "nosuch", "oid", "mib", "subtree", "no more variables"]):
        return "SNMP OID no encontrada"
    if any(token in error for token in ["cannot connect", "connection refused", "network is unreachable", "no route", "host unavailable", "unreachable"]):
        return "equipo apagado/no accesible"
    if any(token in error for token in ["no such file", "cannot execute", "permission denied", "not found", "script", "command"]):
        return "script/comando inexistente"
    if "unsupported item key" in error or ("not supported" in error and ("agent" in type_name or key)):
        return "key de agente no soportada"
    if item_type_name(item) == "Dependent item" or "master item" in error or "dependent" in error:
        return "dependencia de template"
    if "cannot evaluate function" in error or "not enough data" in error:
        return "dependencia de template"
    if "not supported" in error:
        return "key de agente no soportada"
    if any(token in name + " " + key for token in ["ipmi poller", "java poller", "snmp trapper", "odbc poller"]):
        return "dependencia de template"
    return "otro"


def likely_unsupported_action(category: str, item: dict[str, Any]) -> str:
    key = str(item.get("key_") or "")
    name = str(item.get("name") or "")
    if category == "SNMP OID no encontrada":
        return "Verificar si el OID existe en el modelo/firmware; ajustar discovery override o template en una fase posterior."
    if category == "timeout":
        return "Comprobar latencia/conectividad y timeout del item/template; no deshabilitar sin confirmar."
    if category == "credenciales/comunidad SNMP":
        return "Validar comunidad SNMPv2/SNMPv3, ACL del dispositivo y macros del host/template."
    if category == "macro ausente":
        return "Completar macro requerida en host/template o retirar el bloque dependiente si no aplica."
    if category == "script/comando inexistente":
        return "Instalar o corregir el script/UserParameter requerido antes de modificar el item."
    if category == "key de agente no soportada":
        return "Comprobar version del agente, sistema operativo y template aplicado."
    if category == "dependencia de template":
        return "Revisar si el template monitoriza procesos o capacidades no habilitadas en este servidor."
    if category == "equipo apagado/no accesible":
        return "Confirmar disponibilidad del equipo y ruta de red desde Zabbix server/proxy."
    if "smart" in (key + " " + name).lower():
        return "Validar estado fisico del disco antes de tocar el item o trigger."
    return "Revisar error exacto y decidir correccion especifica por host/template."


def unsupported_score(item: dict[str, Any], host: dict[str, Any] | None, category: str, host_count: int) -> int:
    text = " ".join(
        [
            str(item.get("name") or ""),
            str(item.get("key_") or ""),
            str(item.get("error") or ""),
            display_host(host),
        ]
    ).lower()
    score = host_count
    if any(word in text for word in ["smart", "disk", "hdd", "ssd", "raid", "battery", "ups", "power", "backup", "proxmox", "ceph"]):
        score += 20
    if display_host(host).lower() == "zabbix server":
        score += 18
    if category in {"credenciales/comunidad SNMP", "timeout", "equipo apagado/no accesible"}:
        score += 12
    if category in {"macro ausente", "script/comando inexistente", "key de agente no soportada"}:
        score += 8
    if to_int(item.get("lastclock")) == 0:
        score += 2
    return score


def item_discovery_status(item: dict[str, Any]) -> dict[str, Any]:
    discovery = item.get("itemDiscovery")
    discovery_rule = item.get("discoveryRule")
    if isinstance(discovery, list):
        discovery_present = bool(discovery)
        discovery_data = discovery[0] if discovery else {}
    else:
        discovery_present = bool(discovery)
        discovery_data = discovery or {}
    if isinstance(discovery_rule, list):
        rule_present = bool(discovery_rule)
        rule_data = discovery_rule[0] if discovery_rule else {}
    else:
        rule_present = bool(discovery_rule)
        rule_data = discovery_rule or {}
    return {
        "is_discovered": discovery_present or rule_present or str(item.get("flags")) in {"1", "4"},
        "item_discovery": discovery_data,
        "discovery_rule": rule_data,
    }


def template_chain_for_item(item: dict[str, Any], item_by_id: dict[str, dict[str, Any]], object_by_hostid: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    chain = []
    current = item
    seen: set[str] = set()
    while str(current.get("templateid", "0")) not in {"", "0"}:
        parent_id = str(current.get("templateid"))
        if parent_id in seen:
            break
        seen.add(parent_id)
        parent = item_by_id.get(parent_id)
        if not parent:
            chain.append({"itemid": parent_id, "resolved": False})
            break
        owner = object_by_hostid.get(str(parent.get("hostid")), {})
        chain.append(
            {
                "itemid": parent.get("itemid"),
                "name": parent.get("name"),
                "key": parent.get("key_"),
                "hostid": parent.get("hostid"),
                "template": owner.get("name") or owner.get("host") or parent.get("hostid"),
                "resolved": True,
            }
        )
        current = parent
    return chain


def template_chain_for_trigger(trigger: dict[str, Any], trigger_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    chain = []
    current = trigger
    seen: set[str] = set()
    while str(current.get("templateid", "0")) not in {"", "0"}:
        parent_id = str(current.get("templateid"))
        if parent_id in seen:
            break
        seen.add(parent_id)
        parent = trigger_by_id.get(parent_id)
        if not parent:
            chain.append({"triggerid": parent_id, "resolved": False})
            break
        chain.append(
            {
                "triggerid": parent.get("triggerid"),
                "description": parent.get("description"),
                "priority": SEVERITIES.get(str(parent.get("priority", "0")), str(parent.get("priority", "0"))),
                "resolved": True,
            }
        )
        current = parent
    return chain


def probable_disabled_trigger_reason(trigger: dict[str, Any]) -> str:
    text = " ".join(
        [
            str(trigger.get("description") or ""),
            " ".join(str(item.get("name") or "") for item in trigger.get("items") or []),
            " ".join(str(item.get("key_") or "") for item in trigger.get("items") or []),
        ]
    ).lower()
    if str(trigger.get("templateid", "0")) not in {"", "0"}:
        return "Deshabilitado heredado o ajustado desde template; revisar antes de tocar porque puede afectar a varios hosts."
    if any(word in text for word in ["toner", "cover", "printer", "cartridge", "door"]):
        return "Probable reduccion de ruido en impresoras/consumibles."
    if any(word in text for word in ["fan", "temperature", "battery", "array", "controller", "power supply"]):
        return "Posible sensor hardware no aplicable o demasiado ruidoso; revisar contra inventario fisico."
    if any(word in text for word in ["interface", "link down", "speed"]):
        return "Posible interfaz no usada o evento ruidoso; revisar si el puerto deberia monitorizarse."
    return "No deducible por API; revisar historial/auditoria de cambios de Zabbix antes de habilitar."


def compact_item(
    item: dict[str, Any],
    host_by_id: dict[str, dict[str, Any]],
    interface_by_id: dict[str, dict[str, Any]],
    item_by_id: dict[str, dict[str, Any]],
    object_by_hostid: dict[str, dict[str, Any]],
    now: int,
) -> dict[str, Any]:
    host = host_by_id.get(str(item.get("hostid")))
    category = classify_unsupported(item)
    discovery = item_discovery_status(item)
    interface = summarize_interface(interface_by_id.get(str(item.get("interfaceid"))))
    template_chain = template_chain_for_item(item, item_by_id, object_by_hostid)
    return {
        "itemid": item.get("itemid"),
        "hostid": item.get("hostid"),
        "host": display_host(host),
        "name": item.get("name"),
        "key": item.get("key_"),
        "type": item_type_name(item),
        "type_id": item.get("type"),
        "interface": interface,
        "templateid": item.get("templateid"),
        "inherited_from_template": str(item.get("templateid", "0")) not in {"", "0"},
        "template_chain": template_chain,
        "error": item.get("error", ""),
        "cause_category": category,
        "recommended_diagnosis": likely_unsupported_action(category, item),
        "lastclock": to_int(item.get("lastclock")),
        "lastclock_text": format_ts(item.get("lastclock")),
        "lastclock_age": age_text(item.get("lastclock"), now),
        "lastvalue": item.get("lastvalue", ""),
        "status": "enabled" if str(item.get("status")) == "0" else "disabled",
        "state": "unsupported" if str(item.get("state")) == "1" else "normal",
        "delay": item.get("delay", ""),
        "snmp_oid": item.get("snmp_oid", ""),
        "flags": item.get("flags"),
        "is_discovered": discovery["is_discovered"],
        "item_discovery": discovery["item_discovery"],
        "discovery_rule": discovery["discovery_rule"],
    }


def recommendation(
    priority: str,
    action: str,
    obj: str,
    risk: str,
    benefit: str,
    requires_zabbix_change: bool,
    requires_external_change: bool,
    can_automate: str,
    approximate_command_or_api: str,
) -> dict[str, Any]:
    return {
        "priority": priority,
        "action": action,
        "object": obj,
        "risk": risk,
        "benefit": benefit,
        "requires_zabbix_change": requires_zabbix_change,
        "requires_external_change": requires_external_change,
        "can_automate": can_automate,
        "approximate_command_or_api": approximate_command_or_api,
    }


def load_coverage() -> dict[str, Any]:
    if not COVERAGE_JSON.exists():
        return {}
    with COVERAGE_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def collect_data() -> dict[str, Any]:
    env = load_env(ENV_FILE)
    url = api_url_from_env(env.get("ZABBIX_URL", ""))
    token = env.get("ZABBIX_TOKEN", "")
    if not token:
        raise ValueError("ZABBIX_TOKEN is empty or missing")

    now = int(time.time())
    api_errors: list[dict[str, str]] = []
    api = ZabbixApi(url, token, tls_context(env))
    coverage = load_coverage()

    version = safe_call(api, "apiinfo.version", {}, api_errors, "unknown", auth=False)
    hosts = safe_call(
        api,
        "host.get",
        {
            "output": [
                "hostid",
                "host",
                "name",
                "status",
                "proxyid",
                "maintenance_status",
            ],
            "selectGroups": ["groupid", "name"],
            "selectParentTemplates": ["templateid", "host", "name"],
            "selectInterfaces": [
                "interfaceid",
                "type",
                "main",
                "useip",
                "ip",
                "dns",
                "port",
                "available",
                "error",
            ],
            "sortfield": "host",
        },
        api_errors,
        [],
    )
    templates = safe_call(
        api,
        "template.get",
        {
            "output": ["templateid", "host", "name"],
            "selectGroups": ["groupid", "name"],
            "sortfield": "host",
        },
        api_errors,
        [],
    )
    items = safe_call(
        api,
        "item.get",
        {
            "output": [
                "itemid",
                "type",
                "snmp_oid",
                "hostid",
                "name",
                "key_",
                "delay",
                "status",
                "value_type",
                "units",
                "templateid",
                "interfaceid",
                "description",
                "master_itemid",
                "flags",
                "state",
                "error",
                "lastclock",
                "lastvalue",
                "prevvalue",
            ],
        },
        api_errors,
        [],
    )
    unsupported_items_raw = safe_call(
        api,
        "item.get",
        {
            "output": "extend",
            "filter": {"state": "1", "status": "0"},
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItemDiscovery": "extend",
            "selectDiscoveryRule": ["itemid", "name", "key_"],
        },
        api_errors,
        [],
    )
    triggers = safe_call(
        api,
        "trigger.get",
        {
            "output": [
                "triggerid",
                "expression",
                "description",
                "status",
                "priority",
                "value",
                "lastchange",
                "comments",
                "error",
                "templateid",
                "type",
                "state",
                "flags",
                "opdata",
            ],
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItems": ["itemid", "hostid", "name", "key_", "snmp_oid", "lastclock", "lastvalue", "error", "state", "type", "interfaceid"],
            "selectTags": "extend",
        },
        api_errors,
        [],
    )
    problems = safe_call(
        api,
        "problem.get",
        {
            "output": "extend",
            "selectTags": "extend",
            "selectAcknowledges": "extend",
            "selectSuppressionData": "extend",
            "sortfield": "eventid",
            "sortorder": "DESC",
        },
        api_errors,
        [],
    )

    host_by_id = {str(host["hostid"]): host for host in hosts}
    template_by_id = {str(template["templateid"]): template for template in templates}
    object_by_hostid = {**template_by_id, **host_by_id}
    item_by_id = {str(item["itemid"]): item for item in items}
    trigger_by_id = {str(trigger["triggerid"]): trigger for trigger in triggers}
    interface_by_id: dict[str, dict[str, Any]] = {}
    interfaces_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for host in hosts:
        for interface in host.get("interfaces") or []:
            interface_by_id[str(interface.get("interfaceid"))] = interface
            interfaces_by_host[str(host.get("hostid"))].append(summarize_interface(interface) or {})

    items_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    last_item_clock_by_host: dict[str, int] = defaultdict(int)
    active_recent_items_by_host: Counter[str] = Counter()
    for item in items:
        hostid = str(item.get("hostid"))
        if hostid not in host_by_id:
            continue
        items_by_host[hostid].append(item)
        lastclock = to_int(item.get("lastclock"))
        last_item_clock_by_host[hostid] = max(last_item_clock_by_host[hostid], lastclock)
        if str(item.get("status")) == "0" and lastclock >= now - STALE_AFTER_SECONDS:
            active_recent_items_by_host[hostid] += 1

    unsupported_host_counts = Counter(str(item.get("hostid")) for item in unsupported_items_raw)
    unsupported_items = []
    for item in unsupported_items_raw:
        host = host_by_id.get(str(item.get("hostid")))
        entry = compact_item(item, host_by_id, interface_by_id, item_by_id, object_by_hostid, now)
        entry["importance_score"] = unsupported_score(
            item,
            host,
            entry["cause_category"],
            unsupported_host_counts[str(item.get("hostid"))],
        )
        unsupported_items.append(entry)
    unsupported_items.sort(key=lambda entry: entry["importance_score"], reverse=True)

    unsupported_by_cause: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unsupported_by_host: dict[str, dict[str, Any]] = {}
    for entry in unsupported_items:
        unsupported_by_cause[entry["cause_category"]].append(entry)
        host_key = str(entry["hostid"])
        unsupported_by_host.setdefault(
            host_key,
            {
                "hostid": entry["hostid"],
                "host": entry["host"],
                "count": 0,
                "items": [],
                "causes": Counter(),
            },
        )
        unsupported_by_host[host_key]["count"] += 1
        unsupported_by_host[host_key]["items"].append(entry)
        unsupported_by_host[host_key]["causes"][entry["cause_category"]] += 1

    unsupported_by_host_list = []
    for host_entry in unsupported_by_host.values():
        host_entry["causes"] = dict(host_entry["causes"])
        unsupported_by_host_list.append(host_entry)
    unsupported_by_host_list.sort(key=lambda entry: entry["count"], reverse=True)

    enriched_triggers = []
    disabled_triggers = []
    for trigger in triggers:
        trigger_hosts = [compact_host(host_by_id.get(str(host.get("hostid")), host)) for host in trigger.get("hosts") or []]
        chain = template_chain_for_trigger(trigger, trigger_by_id)
        item_names = [
            {
                "itemid": item.get("itemid"),
                "name": item.get("name"),
                "key": item.get("key_"),
                "hostid": item.get("hostid"),
                "lastvalue": item.get("lastvalue"),
                "lastclock": to_int(item.get("lastclock")),
                "lastclock_text": format_ts(item.get("lastclock")),
            }
            for item in trigger.get("items") or []
        ]
        trigger_entry = {
            "triggerid": trigger.get("triggerid"),
            "description": trigger.get("description"),
            "status": "enabled" if str(trigger.get("status")) == "0" else "disabled",
            "severity": SEVERITIES.get(str(trigger.get("priority", "0")), str(trigger.get("priority", "0"))),
            "priority": to_int(trigger.get("priority")),
            "value": trigger.get("value"),
            "lastchange": to_int(trigger.get("lastchange")),
            "lastchange_text": format_ts(trigger.get("lastchange")),
            "opdata": trigger.get("opdata", ""),
            "comments": trigger.get("comments", ""),
            "error": trigger.get("error", ""),
            "templateid": trigger.get("templateid"),
            "inherited_from_template": str(trigger.get("templateid", "0")) not in {"", "0"},
            "template_chain": chain,
            "hosts": trigger_hosts,
            "items": item_names,
            "tags": trigger.get("tags") or [],
        }
        enriched_triggers.append(trigger_entry)
        if trigger_entry["status"] == "disabled":
            trigger_entry["probable_reason"] = probable_disabled_trigger_reason(trigger)
            disabled_triggers.append(trigger_entry)

    problems_by_trigger = {str(problem.get("objectid")): problem for problem in problems}
    high_problems = []
    for problem in problems:
        if str(problem.get("severity")) != "4":
            continue
        trigger = trigger_by_id.get(str(problem.get("objectid")), {})
        trigger_entry = next(
            (entry for entry in enriched_triggers if str(entry["triggerid"]) == str(problem.get("objectid"))),
            {},
        )
        problem_hosts = trigger_entry.get("hosts") or [compact_host(host) for host in trigger.get("hosts") or []]
        associated_items = []
        for item in trigger.get("items") or []:
            associated_items.append(
                {
                    "itemid": item.get("itemid"),
                    "name": item.get("name"),
                    "key": item.get("key_"),
                    "type": item_type_name(item),
                    "interface": summarize_interface(interface_by_id.get(str(item.get("interfaceid")))),
                    "lastvalue": item.get("lastvalue"),
                    "lastclock": to_int(item.get("lastclock")),
                    "lastclock_text": format_ts(item.get("lastclock")),
                    "error": item.get("error", ""),
                    "state": "unsupported" if str(item.get("state")) == "1" else "normal",
                    "snmp_oid": item.get("snmp_oid", ""),
                }
            )
        text = " ".join(
            [
                str(problem.get("name") or ""),
                str(problem.get("opdata") or ""),
                str(trigger.get("description") or ""),
                " ".join(item.get("name", "") for item in trigger.get("items") or []),
                " ".join(item.get("key_", "") for item in trigger.get("items") or []),
            ]
        ).lower()
        related_flags = {
            "smart": "smart" in text,
            "disk": any(word in text for word in ["disk", "hdd", "ssd", "drive"]),
            "temperature": "temperature" in text or "temp" in text,
            "predictive_failure": any(word in text for word in ["predict", "faulty", "failed", "abnormal"]),
            "physical_error": any(word in text for word in ["faulty", "failed", "abnormal", "smart", "disk"]),
        }
        evidence_points = []
        if problem.get("opdata"):
            evidence_points.append(f"Operational data: {problem.get('opdata')}")
        if trigger_entry:
            evidence_points.append(
                f"Associated trigger {trigger_entry.get('triggerid')} is currently {trigger_entry.get('status')}."
            )
        if associated_items:
            item = associated_items[0]
            if item["state"] == "normal" and not item["error"]:
                evidence_points.append("Associated item is supported and currently returns data.")
            if item["lastvalue"] not in {"", None}:
                evidence_points.append(f"Last item value: {item['lastvalue']} at {item['lastclock_text']}.")
            if item.get("snmp_oid"):
                evidence_points.append(f"SNMP OID: {item['snmp_oid']}.")
        if related_flags["smart"] and associated_items and associated_items[0]["state"] == "normal":
            diagnosis = (
                "Parece un fallo fisico o estado SMART anomalo reportado por el NAS, no una falta de datos ni un error de consulta."
            )
        elif associated_items and associated_items[0]["state"] == "unsupported":
            diagnosis = "Puede estar afectado por error de consulta porque el item asociado esta unsupported."
        else:
            diagnosis = "Requiere validacion manual; la API no permite descartar completamente un falso positivo."

        high_problems.append(
            {
                "eventid": problem.get("eventid"),
                "name": problem.get("name"),
                "severity": SEVERITIES.get(str(problem.get("severity", "0")), str(problem.get("severity", "0"))),
                "clock": to_int(problem.get("clock")),
                "clock_text": format_ts(problem.get("clock")),
                "duration": age_text(problem.get("clock"), now),
                "acknowledged": str(problem.get("acknowledged", "0")) == "1",
                "suppressed": str(problem.get("suppressed", "0")) == "1",
                "operational_data": problem.get("opdata", ""),
                "tags": problem.get("tags") or [],
                "hosts": problem_hosts,
                "trigger": trigger_entry,
                "associated_items": associated_items,
                "related_flags": related_flags,
                "evidence": evidence_points,
                "diagnosis": diagnosis,
                "operational_recommendation": (
                    "No silenciar como primera respuesta. Confirmar estado SMART del HDD 5 en NasAlmeria, revisar logs/GUI del NAS y planificar sustitucion o migracion si el disco sigue en estado Abnormal."
                ),
                "confirmation_commands_not_executed": [
                    "ssh <admin>@<ip-de-NasAlmeria>",
                    "Abrir GUI QNAP: Storage & Snapshots > Disks/VJBOD > HDD 5 > SMART information",
                    "qcli_storage -d",
                    "qcli_storage -T force=1",
                    "smartctl -a -d sat /dev/<disco_hdd5>",
                    "dmesg | egrep -i 'smart|error|fail|ata|disk|hdd|ssd'",
                ],
                "access_note": "No se ha probado acceso SSH/GUI al NAS desde este servidor; no se asume que el servidor Zabbix sea el NAS.",
            }
        )

    hosts_without_recent_data = []
    coverage_stale = {
        str(entry.get("hostid")): entry
        for entry in (coverage.get("coverage", {}).get("hosts_without_recent_data", []) if coverage else [])
    }
    for hostid, coverage_entry in coverage_stale.items():
        host = host_by_id.get(hostid)
        if not host:
            continue
        interfaces = interfaces_by_host.get(hostid, [])
        method = "agent" if any(interface.get("type") == "agent" for interface in interfaces) else "snmp" if any(interface.get("type") == "snmp" for interface in interfaces) else "other"
        host_text = " ".join(
            [
                display_host(host),
                " ".join(group.get("name", "") for group in host.get("groups") or []),
                " ".join(template.get("name", "") or template.get("host", "") for template in host.get("parentTemplates") or []),
            ]
        ).lower()
        if "printer" in host_text or "impresora" in host_text or any(vendor in host_text for vendor in ["hp ", "brother", "canon", "zebra"]):
            classification = "impresora/SNMP"
            proposal = "Corregir si sigue instalada; pasar a mantenimiento o retirar en una fase confirmada si el equipo ya no existe."
        elif method == "agent":
            classification = "agent"
            proposal = "Comprobar agente, firewall y disponibilidad del host."
        elif method == "snmp":
            classification = "snmp"
            proposal = "Comprobar SNMP, comunidad, ACL y disponibilidad del equipo."
        else:
            classification = "otro"
            proposal = "Clasificar manualmente antes de cambiar monitorizacion."
        hosts_without_recent_data.append(
            {
                "host": compact_host(host),
                "groups": host.get("groups") or [],
                "interfaces": interfaces,
                "monitoring_method": method,
                "classification": classification,
                "last_item_clock": coverage_entry.get("last_item_clock", last_item_clock_by_host.get(hostid, 0)),
                "last_item_clock_text": coverage_entry.get("last_item_clock_text", format_ts(last_item_clock_by_host.get(hostid, 0))),
                "proposal": proposal,
            }
        )

    def host_context(host: dict[str, Any]) -> str:
        hostid = str(host.get("hostid"))
        parts = [host.get("host", ""), host.get("name", "")]
        parts.extend(group.get("name", "") for group in host.get("groups") or [])
        parts.extend(template.get("name", "") or template.get("host", "") for template in host.get("parentTemplates") or [])
        parts.extend(item.get("name", "") for item in items_by_host.get(hostid, [])[:200])
        parts.extend(item.get("key_", "") for item in items_by_host.get(hostid, [])[:200])
        return " ".join(parts)

    proxmox_hosts = [
        {**compact_host(host), "matches": keyword_matches(host_context(host), PROXMOX_KEYWORDS)}
        for host in hosts
        if contains_keyword(host_context(host), PROXMOX_KEYWORDS)
    ]
    proxmox_templates = [
        {
            "templateid": template.get("templateid"),
            "host": template.get("host"),
            "name": template.get("name"),
            "matches": keyword_matches(" ".join([template.get("host", ""), template.get("name", "")]), PROXMOX_KEYWORDS),
        }
        for template in templates
        if contains_keyword(" ".join([template.get("host", ""), template.get("name", "")]), PROXMOX_KEYWORDS)
    ]
    proxmox_items = [
        {
            "itemid": item.get("itemid"),
            "host": display_host(host_by_id.get(str(item.get("hostid")))),
            "name": item.get("name"),
            "key": item.get("key_"),
            "lastclock": to_int(item.get("lastclock")),
            "lastclock_text": format_ts(item.get("lastclock")),
        }
        for item in items
        if str(item.get("hostid")) in host_by_id
        and contains_keyword(" ".join([item.get("name", ""), item.get("key_", "")]), PROXMOX_KEYWORDS)
    ]
    proxmox_triggers = [
        {
            "triggerid": trigger.get("triggerid"),
            "description": trigger.get("description"),
            "severity": SEVERITIES.get(str(trigger.get("priority", "0")), str(trigger.get("priority", "0"))),
            "hosts": [display_host(host_by_id.get(str(host.get("hostid")), host)) for host in trigger.get("hosts") or []],
            "status": "enabled" if str(trigger.get("status")) == "0" else "disabled",
        }
        for trigger in triggers
        if contains_keyword(trigger.get("description", ""), PROXMOX_KEYWORDS)
    ]

    backup_items = [
        {
            "itemid": item.get("itemid"),
            "hostid": item.get("hostid"),
            "host": display_host(host_by_id.get(str(item.get("hostid")))),
            "name": item.get("name"),
            "key": item.get("key_"),
            "status": "enabled" if str(item.get("status")) == "0" else "disabled",
            "state": "unsupported" if str(item.get("state")) == "1" else "normal",
            "lastclock": to_int(item.get("lastclock")),
            "lastclock_text": format_ts(item.get("lastclock")),
        }
        for item in items
        if str(item.get("hostid")) in host_by_id
        and contains_keyword(" ".join([item.get("name", ""), item.get("key_", "")]), BACKUP_KEYWORDS)
    ]
    backup_triggers = [
        {
            "triggerid": trigger.get("triggerid"),
            "description": trigger.get("description"),
            "severity": SEVERITIES.get(str(trigger.get("priority", "0")), str(trigger.get("priority", "0"))),
            "hosts": [display_host(host_by_id.get(str(host.get("hostid")), host)) for host in trigger.get("hosts") or []],
            "status": "enabled" if str(trigger.get("status")) == "0" else "disabled",
        }
        for trigger in triggers
        if contains_keyword(trigger.get("description", ""), BACKUP_KEYWORDS)
    ]
    backup_hostids = {str(item.get("hostid")) for item in backup_items}
    for trigger in backup_triggers:
        for host_name in trigger["hosts"]:
            for hostid, host in host_by_id.items():
                if display_host(host) == host_name:
                    backup_hostids.add(hostid)

    critical_hosts_without_backup = []
    for host in hosts:
        hostid = str(host.get("hostid"))
        group_text = " ".join(group.get("name", "") for group in host.get("groups") or []).lower()
        host_text = " ".join([host.get("host", ""), host.get("name", ""), group_text]).lower()
        if any(keyword in host_text for keyword in CRITICAL_GROUP_KEYWORDS) and hostid not in backup_hostids:
            critical_hosts_without_backup.append(
                {
                    "host": compact_host(host),
                    "groups": host.get("groups") or [],
                    "note": "Sin evidencia directa de items/triggers de backup en este host; puede estar cubierto por un servidor de backup central.",
                }
            )

    recommendations: dict[str, list[dict[str, Any]]] = {"CRÍTICO": [], "ALTO": [], "MEDIO": [], "BAJO": []}
    for problem in high_problems:
        if problem["related_flags"].get("smart") or problem["related_flags"].get("physical_error"):
            recommendations["CRÍTICO"].append(
                recommendation(
                    "CRÍTICO",
                    "Confirmar y tratar fallo SMART reportado; preparar sustitucion o migracion si el NAS confirma estado anomalo.",
                    f"{', '.join(display_host(host) for host in problem['hosts'])}: {problem['name']}",
                    "Riesgo de fallo de disco, degradacion RAID o perdida de datos si se ignora.",
                    "Reduce riesgo de perdida de datos y elimina una alerta High persistente por causa fisica.",
                    False,
                    True,
                    "parcial",
                    "ssh/GUI NAS para validar SMART; despues, si procede, mantenimiento fisico fuera de Zabbix.",
                )
            )
    if unsupported_items:
        recommendations["ALTO"].append(
            recommendation(
                "ALTO",
                "Corregir items unsupported enabled por causa, empezando por Zabbix server, SAIs y storage/NAS.",
                f"{len(unsupported_items)} items unsupported enabled en {len(unsupported_by_host_list)} hosts",
                "Los fallos en items clave dejan huecos ciegos o generan falsas conclusiones sobre disponibilidad.",
                "Recupera datos de salud, reduce ruido y mejora fiabilidad de triggers.",
                True,
                True,
                "parcial",
                "API posterior: item.get para confirmar; host.update/template.update solo tras confirmacion humana.",
            )
        )
    if backup_items and critical_hosts_without_backup:
        recommendations["ALTO"].append(
            recommendation(
                "ALTO",
                "Validar cobertura real de backups en hosts criticos sin evidencia directa en Zabbix.",
                f"{len(critical_hosts_without_backup)} hosts criticos sin evidencia directa de backup",
                "Backups incompletos o no verificados pueden impedir recuperacion ante incidente.",
                "Permite mapear RPO/RTO y crear checks por servidor o por job central.",
                True,
                True,
                "parcial",
                "API posterior: crear template/check preparado; fuera de Zabbix: consultar PBS/vzdump/borg/restic/rsync.",
            )
        )
    if proxmox_hosts:
        recommendations["ALTO"].append(
            recommendation(
                "ALTO",
                "Comparar inventario real Proxmox/PBS con hosts Zabbix para detectar VMs, datastores o nodos no cubiertos.",
                f"{len(proxmox_hosts)} hosts Proxmox-like detectados",
                "Zabbix no puede demostrar por si solo que todas las VMs y datastores existen como objetos monitorizados.",
                "Cierra huecos de monitorizacion en virtualizacion, storage, backups y Ceph.",
                True,
                True,
                "si",
                "Script futuro: consultar Proxmox API /nodes, /cluster/resources, /storage y comparar con host.get.",
            )
        )
    if hosts_without_recent_data:
        recommendations["MEDIO"].append(
            recommendation(
                "MEDIO",
                "Revisar hosts sin datos recientes y decidir corregir SNMP/agente, mantenimiento o retirada confirmada.",
                f"{len(hosts_without_recent_data)} hosts sin datos recientes",
                "Inventario obsoleto o conectividad rota produce huecos silenciosos.",
                "Aclara si los equipos siguen en servicio y recupera datos frescos.",
                True,
                True,
                "parcial",
                "Comprobacion futura: zabbix_get/snmpwalk/ping por host; API posterior solo tras clasificacion.",
            )
        )
    if disabled_triggers:
        recommendations["MEDIO"].append(
            recommendation(
                "MEDIO",
                "Revisar triggers deshabilitados por host/template antes de reactivarlos o documentarlos.",
                f"{len(disabled_triggers)} triggers deshabilitados",
                "Triggers deshabilitados pueden ocultar fallos reales; reactivarlos sin revision puede generar ruido.",
                "Permite recuperar deteccion util sin inundar alertas.",
                True,
                False,
                "no",
                "API posterior con confirmacion: trigger.update status=0 solo para triggerids aprobados.",
            )
        )
    recommendations["BAJO"].append(
        recommendation(
            "BAJO",
            "Normalizar documentacion operativa, nombres y mapa de cobertura por grupo.",
            "Repositorio zabbix-codex e informes",
            "Bajo; no afecta a monitorizacion en tiempo real.",
            "Facilita fases posteriores y reduce errores manuales.",
            False,
            False,
            "si",
            "Crear/actualizar Markdown y scripts auxiliares en /opt/zabbix-codex sin tocar Zabbix.",
        )
    )

    safe_changes = [
        {
            "change": "Crear scripts auxiliares de diagnostico read-only para SMART/QNAP, SNMP y Proxmox inventory diff.",
            "risk": "bajo",
            "requires_zabbix_change": False,
            "requires_external_change": False,
            "approximate_command_or_api": "Crear scripts en /opt/zabbix-codex/scripts y ejecutarlos en modo consulta.",
        },
        {
            "change": "Crear informes adicionales por grupo: unsupported, triggers disabled, backups y Proxmox.",
            "risk": "bajo",
            "requires_zabbix_change": False,
            "requires_external_change": False,
            "approximate_command_or_api": "Leer zabbix-remediation-plan.json y generar Markdown/CSV.",
        },
        {
            "change": "Crear templates nuevos no asignados o drafts de checks preparados para backups/Proxmox.",
            "risk": "bajo-medio",
            "requires_zabbix_change": True,
            "requires_external_change": False,
            "approximate_command_or_api": "template.create sin vincular a hosts; no activar alertas ni enlazar templates.",
        },
        {
            "change": "Crear checks preparados pero no vinculados para validar PBS/vzdump/restic/borg/rsync.",
            "risk": "bajo",
            "requires_zabbix_change": False,
            "requires_external_change": False,
            "approximate_command_or_api": "Generar scripts y documentar UserParameters sin desplegarlos aun.",
        },
    ]

    human_confirmation_changes = [
        "Borrar o deshabilitar items unsupported.",
        "Modificar templates usados por hosts existentes.",
        "Cambiar triggers existentes o reactivar triggers deshabilitados.",
        "Tocar alertas, acciones, media types o destinatarios.",
        "Silenciar, cerrar manualmente o reconocer como solucion un problema SMART/disco.",
        "Cambios fisicos o logicos sobre SMART/discos/RAID/NAS.",
        "Cambios en jobs, retencion o validacion de backups.",
        "Cambios en Proxmox, PBS, Ceph, datastores, nodos o VMs.",
        "Modificar macros SNMP/credenciales en hosts o templates.",
    ]

    problem_counts = Counter(SEVERITIES.get(str(problem.get("severity", "0")), str(problem.get("severity", "0"))) for problem in problems)
    cause_counts = {cause: len(entries) for cause, entries in unsupported_by_cause.items()}

    data = {
        "metadata": {
            "generated_at": datetime.fromtimestamp(now).astimezone().isoformat(),
            "zabbix_url": sanitize_url(url),
            "zabbix_version": version,
            "env_file": str(ENV_FILE),
            "coverage_json": str(COVERAGE_JSON),
            "read_only": True,
        },
        "summary": {
            "hosts_enabled": sum(1 for host in hosts if str(host.get("status")) == "0"),
            "hosts_total": len(hosts),
            "templates_total": len(templates),
            "items_total": len([item for item in items if str(item.get("hostid")) in host_by_id]),
            "unsupported_enabled_total": len(unsupported_items),
            "unsupported_hosts_total": len(unsupported_by_host_list),
            "disabled_triggers_total": len(disabled_triggers),
            "active_problems_total": len(problems),
            "active_problems_by_severity": dict(problem_counts),
            "hosts_without_recent_data_total": len(hosts_without_recent_data),
            "api_errors_total": len(api_errors),
        },
        "high_problems": high_problems,
        "nasalmeria_smart_diagnosis": next(
            (
                problem
                for problem in high_problems
                if "nasalmeria" in " ".join(display_host(host).lower() for host in problem.get("hosts", []))
                and problem["related_flags"].get("smart")
            ),
            None,
        ),
        "unsupported": {
            "total": len(unsupported_items),
            "by_cause_counts": cause_counts,
            "by_cause": {cause: entries for cause, entries in unsupported_by_cause.items()},
            "by_host": unsupported_by_host_list,
            "top_important": unsupported_items[:25],
        },
        "disabled_triggers": {
            "total": len(disabled_triggers),
            "triggers": disabled_triggers,
            "by_host": sorted(
                [
                    {"host": host, "disabled_triggers": count}
                    for host, count in Counter(
                        display_host(host) for trigger in disabled_triggers for host in trigger.get("hosts", [])
                    ).items()
                ],
                key=lambda entry: entry["disabled_triggers"],
                reverse=True,
            ),
        },
        "hosts_without_recent_data": hosts_without_recent_data,
        "proxmox": {
            "hosts": proxmox_hosts,
            "templates": proxmox_templates,
            "items_count": len(proxmox_items),
            "items_sample": proxmox_items[:100],
            "triggers_count": len(proxmox_triggers),
            "triggers_sample": proxmox_triggers[:100],
            "evidence_summary": {
                "appears_monitored": bool(proxmox_hosts or proxmox_templates or proxmox_items or proxmox_triggers),
                "pbs_evidence": any("pbs" in " ".join([item["name"] or "", item["key"] or ""]).lower() for item in proxmox_items)
                or any("pbs" in (template.get("name") or template.get("host") or "").lower() for template in proxmox_templates),
                "backup_evidence": bool(backup_items or backup_triggers),
                "datastore_storage_evidence": any(
                    contains_keyword(" ".join([item.get("name") or "", item.get("key_") or ""]), STORAGE_KEYWORDS)
                    for item in items
                    if str(item.get("hostid")) in host_by_id
                ),
                "ceph_evidence": any(
                    "ceph" in " ".join([item.get("name") or "", item.get("key_") or ""]).lower()
                    for item in items
                    if str(item.get("hostid")) in host_by_id
                ),
                "smart_evidence": any(
                    "smart" in " ".join([item.get("name") or "", item.get("key_") or ""]).lower()
                    for item in items
                    if str(item.get("hostid")) in host_by_id
                ),
                "broad_keyword_note": "Se excluyen coincidencias genericas de 'cluster' del listado principal para evitar falsos positivos no Proxmox.",
                "vm_inventory_gap": "No demostrable desde Zabbix sin comparar contra Proxmox API.",
            },
        },
        "backups": {
            "items_count": len(backup_items),
            "items_sample": backup_items[:100],
            "triggers_count": len(backup_triggers),
            "triggers_sample": backup_triggers[:100],
            "hosts_with_backup_evidence": sorted(
                {
                    display_host(host_by_id.get(hostid))
                    for hostid in backup_hostids
                    if hostid in host_by_id
                }
            ),
            "critical_hosts_without_direct_backup_evidence": critical_hosts_without_backup,
        },
        "recommendations": recommendations,
        "safe_automatic_changes_next_phase": safe_changes,
        "human_confirmation_required_changes": human_confirmation_changes,
        "api_errors": api_errors,
    }
    return data


def render_recommendation_table(entries: list[dict[str, Any]]) -> str:
    return md_table(
        [
            "Accion propuesta",
            "Objeto",
            "Riesgo",
            "Beneficio",
            "Cambio Zabbix",
            "Cambio externo",
            "Automatizable",
            "Comando/API aproximado",
        ],
        [
            [
                entry["action"],
                entry["object"],
                entry["risk"],
                entry["benefit"],
                "si" if entry["requires_zabbix_change"] else "no",
                "si" if entry["requires_external_change"] else "no",
                entry["can_automate"],
                entry["approximate_command_or_api"],
            ]
            for entry in entries
        ],
    )


def render_markdown(data: dict[str, Any]) -> str:
    summary = data["summary"]
    high = data["nasalmeria_smart_diagnosis"]
    unsupported = data["unsupported"]
    disabled = data["disabled_triggers"]
    proxmox = data["proxmox"]
    backups = data["backups"]

    high_rows = []
    if high:
        high_rows = [
            ["Nombre", high["name"]],
            ["Host", ", ".join(display_host(host) for host in high["hosts"])],
            ["Severidad", high["severity"]],
            ["Inicio", high["clock_text"]],
            ["Duracion", high["duration"]],
            ["Trigger asociado", high.get("trigger", {}).get("triggerid", "")],
            ["Trigger status", high.get("trigger", {}).get("status", "")],
            ["Trigger descripcion", high.get("trigger", {}).get("description", "")],
            ["Operational data", high["operational_data"]],
            ["Diagnostico", high["diagnosis"]],
            ["Recomendacion", high["operational_recommendation"]],
        ]

    high_items_rows = []
    if high:
        for item in high.get("associated_items", []):
            high_items_rows.append(
                [
                    item.get("itemid"),
                    item.get("name"),
                    item.get("key"),
                    item.get("type"),
                    item.get("lastvalue"),
                    item.get("lastclock_text"),
                    item.get("state"),
                    item.get("snmp_oid"),
                ]
            )

    top_unsupported_rows = [
        [
            entry["host"],
            entry["itemid"],
            entry["name"],
            entry["key"],
            entry["type"],
            entry["cause_category"],
            entry["error"],
        ]
        for entry in unsupported["top_important"][:10]
    ]
    unsupported_host_rows = [
        [
            entry["host"],
            entry["count"],
            ", ".join(f"{cause}: {count}" for cause, count in entry["causes"].items()),
        ]
        for entry in unsupported["by_host"][:15]
    ]
    cause_rows = [
        [cause, count]
        for cause, count in sorted(unsupported["by_cause_counts"].items(), key=lambda item: item[1], reverse=True)
    ]
    disabled_rows = [
        [
            ", ".join(display_host(host) for host in trigger.get("hosts", [])),
            trigger["triggerid"],
            trigger["description"],
            trigger["severity"],
            trigger.get("template_chain", [{}])[0].get("description", "") if trigger.get("template_chain") else "",
            trigger.get("probable_reason", ""),
        ]
        for trigger in disabled["triggers"][:25]
    ]
    stale_rows = [
        [
            display_host(entry["host"]),
            ", ".join(group.get("name", "") for group in entry.get("groups", [])),
            entry["monitoring_method"],
            "; ".join(
                f"{iface.get('type')} {iface.get('ip') or iface.get('dns')}:{iface.get('port')} {iface.get('available')}"
                for iface in entry.get("interfaces", [])
            ),
            entry["last_item_clock_text"],
            entry["classification"],
            entry["proposal"],
        ]
        for entry in data["hosts_without_recent_data"]
    ]
    proxmox_host_rows = [[entry["host"], entry["name"], ", ".join(entry["matches"])] for entry in proxmox["hosts"]]
    proxmox_template_rows = [[entry["host"], entry["name"], ", ".join(entry["matches"])] for entry in proxmox["templates"][:25]]
    backup_host_rows = [[host] for host in backups["hosts_with_backup_evidence"]]
    critical_no_backup_rows = [
        [
            display_host(entry["host"]),
            ", ".join(group.get("name", "") for group in entry.get("groups", [])),
            entry["note"],
        ]
        for entry in backups["critical_hosts_without_direct_backup_evidence"][:30]
    ]
    safe_rows = [
        [
            entry["change"],
            entry["risk"],
            "si" if entry["requires_zabbix_change"] else "no",
            "si" if entry["requires_external_change"] else "no",
            entry["approximate_command_or_api"],
        ]
        for entry in data["safe_automatic_changes_next_phase"]
    ]

    lines = [
        "# Plan de correccion de monitorizacion Zabbix",
        "",
        f"Generado: {data['metadata']['generated_at']}",
        f"API: `{data['metadata']['zabbix_url']}`",
        f"Version Zabbix: `{data['metadata']['zabbix_version']}`",
        "",
        "## Resumen ejecutivo",
        "",
        bullet_list(
            [
                f"Hosts enabled analizados: {summary['hosts_enabled']} de {summary['hosts_total']}.",
                f"Templates analizados: {summary['templates_total']}.",
                f"Items unsupported enabled: {summary['unsupported_enabled_total']} en {summary['unsupported_hosts_total']} hosts.",
                f"Problemas activos: {summary['active_problems_total']} ({summary['active_problems_by_severity']}).",
                f"Triggers deshabilitados: {summary['disabled_triggers_total']}.",
                f"Hosts sin datos recientes: {summary['hosts_without_recent_data_total']}.",
                f"Errores API durante el plan: {summary['api_errors_total']}.",
            ]
        ),
        "## Diagnostico del problema High de SMART en NasAlmeria",
        "",
        md_table(["Campo", "Valor"], high_rows),
        "",
        "Items asociados:",
        "",
        md_table(["ItemID", "Nombre", "Key", "Tipo", "Ultimo valor", "Ultima lectura", "Estado", "SNMP OID"], high_items_rows),
        "",
        "Evidencias:",
        "",
        bullet_list(high.get("evidence", []) if high else []),
        "Comandos de confirmacion propuestos, no ejecutados:",
        "",
        bullet_list(high.get("confirmation_commands_not_executed", []) if high else []),
        high.get("access_note", "") if high else "",
        "",
        "## Items unsupported",
        "",
        md_table(["Causa", "Items"], cause_rows),
        "",
        "Top 10 unsupported mas importantes:",
        "",
        md_table(["Host", "ItemID", "Item", "Key", "Tipo", "Causa", "Error"], top_unsupported_rows),
        "",
        "Hosts mas afectados:",
        "",
        md_table(["Host", "Unsupported", "Causas"], unsupported_host_rows),
        "## Triggers deshabilitados",
        "",
        md_table(["Host", "TriggerID", "Trigger", "Severidad", "Template origen", "Motivo probable"], disabled_rows),
        "## Hosts sin datos recientes",
        "",
        md_table(["Host", "Grupo", "Metodo", "Interfaz", "Ultimo dato", "Tipo", "Propuesta"], stale_rows),
        "## Proxmox",
        "",
        bullet_list(
            [
                f"Hosts relacionados: {len(proxmox['hosts'])}.",
                f"Templates relacionados: {len(proxmox['templates'])}.",
                f"Items relacionados: {proxmox['items_count']}.",
                f"Triggers relacionados: {proxmox['triggers_count']}.",
                f"PBS detectado: {'si' if proxmox['evidence_summary']['pbs_evidence'] else 'no'}.",
                f"Backups detectados: {'si' if proxmox['evidence_summary']['backup_evidence'] else 'no'}.",
                f"Storage/datastore detectado: {'si' if proxmox['evidence_summary']['datastore_storage_evidence'] else 'no'}.",
                f"Ceph detectado: {'si' if proxmox['evidence_summary']['ceph_evidence'] else 'no'}.",
                f"SMART detectado: {'si' if proxmox['evidence_summary']['smart_evidence'] else 'no'}.",
                proxmox["evidence_summary"]["vm_inventory_gap"],
            ]
        ),
        "Hosts Proxmox-like:",
        "",
        md_table(["Host", "Nombre", "Coincidencias"], proxmox_host_rows),
        "",
        "Templates Proxmox-like:",
        "",
        md_table(["Template", "Nombre", "Coincidencias"], proxmox_template_rows),
        "## Backups",
        "",
        bullet_list(
            [
                f"Items relacionados con backup: {backups['items_count']}.",
                f"Triggers relacionados con backup: {backups['triggers_count']}.",
                f"Hosts con evidencia directa de backup: {len(backups['hosts_with_backup_evidence'])}.",
                f"Hosts criticos sin evidencia directa de backup: {len(backups['critical_hosts_without_direct_backup_evidence'])}.",
            ]
        ),
        "Hosts con evidencia directa de backup:",
        "",
        md_table(["Host"], backup_host_rows),
        "",
        "Hosts criticos sin evidencia directa de backup:",
        "",
        md_table(["Host", "Grupos", "Nota"], critical_no_backup_rows),
        "## Plan priorizado",
        "",
    ]

    for priority in ["CRÍTICO", "ALTO", "MEDIO", "BAJO"]:
        lines.extend([f"### {priority}", "", render_recommendation_table(data["recommendations"].get(priority, [])), ""])

    lines.extend(
        [
            "## Cambios seguros para aplicar automáticamente en la siguiente fase",
            "",
            md_table(["Cambio", "Riesgo", "Cambio Zabbix", "Cambio externo", "Comando/API aproximado"], safe_rows),
            "## Cambios que requieren confirmación humana",
            "",
            bullet_list(data["human_confirmation_required_changes"]),
            "## Proximos pasos",
            "",
            bullet_list(
                [
                    "Validar manualmente el SMART High de NasAlmeria en el NAS antes de cualquier cambio en Zabbix.",
                    "Preparar diagnosticos read-only por causa de unsupported: Zabbix server internal, Eaton/SNMP, NAS/SMART e impresoras.",
                    "Cruzar inventario Proxmox/PBS real contra Zabbix antes de crear o vincular checks.",
                    "Preparar una lista de cambios candidatos para aprobacion humana con IDs exactos de items/triggers/templates.",
                ]
            ),
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def write_reports(data: dict[str, Any]) -> None:
    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_MD.write_text(render_markdown(data), encoding="utf-8")


def main() -> int:
    try:
        data = collect_data()
        write_reports(data)
    except PermissionError as exc:
        print(f"ERROR: Permission denied: {exc}", file=sys.stderr)
        return 1
    except (FileNotFoundError, ValueError, RuntimeError, ApiError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    high = data.get("nasalmeria_smart_diagnosis")
    print("Zabbix remediation plan generated.")
    print(f"Hosts enabled analyzed: {data['summary']['hosts_enabled']}")
    print(f"Unsupported enabled items: {data['summary']['unsupported_enabled_total']}")
    print(f"Active problems: {data['summary']['active_problems_total']}")
    if high:
        print(f"High SMART diagnosis: {high['diagnosis']}")
    print(f"Markdown report: {REPORT_MD}")
    print(f"JSON report: {REPORT_JSON}")
    if data["api_errors"]:
        print(f"API read warnings: {len(data['api_errors'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
