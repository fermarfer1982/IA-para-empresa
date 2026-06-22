#!/usr/bin/env python3
"""Build a global read-only infrastructure map for the Zabbix agent.

The script combines current Zabbix API data with previous local artifacts and
generates a global readiness map. It does not modify Zabbix, Proxmox or PBS.
"""

from __future__ import annotations

import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import plan_zabbix_remediation as zbx  # noqa: E402


BASE_DIR = Path("/opt/zabbix-codex")
ENV_FILE = Path("/etc/zabbix-codex/zabbix.env")

ARTIFACT_PATHS = {
    "coverage": BASE_DIR / "reports" / "zabbix-coverage-report.json",
    "remediation": BASE_DIR / "reports" / "zabbix-remediation-plan.json",
    "unsupported_blocks": BASE_DIR / "reports" / "unsupported-blocks-summary.json",
    "infrastructure_summary": BASE_DIR / "agent_knowledge" / "infrastructure_summary.json",
    "monitoring_gaps": BASE_DIR / "agent_knowledge" / "monitoring_gaps.json",
    "proxmox_backup_knowledge": BASE_DIR / "agent_knowledge" / "proxmox_backup_knowledge.json",
    "proxmox_inventory": BASE_DIR / "proxmox" / "proxmox-real-inventory.json",
    "pbs_inventory": BASE_DIR / "backups" / "pbs-real-inventory.json",
}

OUT_JSON = BASE_DIR / "agent_knowledge" / "global_infrastructure_map.json"
OUT_MD = BASE_DIR / "agent_knowledge" / "global_infrastructure_map.md"
READINESS_MD = BASE_DIR / "reports" / "global-monitoring-readiness.md"
ROADMAP_MD = BASE_DIR / "reports" / "global-monitoring-roadmap.md"
INFRA_SUMMARY_MD = BASE_DIR / "agent_knowledge" / "infrastructure_summary.md"
MONITORING_GAPS_JSON = BASE_DIR / "agent_knowledge" / "monitoring_gaps.json"
CHANGELOG = BASE_DIR / "reports" / "CHANGELOG.md"

TIMEOUT_STALE_SECONDS = 24 * 3600
SEVERITIES = {
    "0": "Not classified",
    "1": "Information",
    "2": "Warning",
    "3": "Average",
    "4": "High",
    "5": "Disaster",
}
ITEM_TYPES = getattr(zbx, "ITEM_TYPES", {})
INTERFACE_TYPES = getattr(zbx, "INTERFACE_TYPES", {"1": "agent", "2": "snmp", "3": "ipmi", "4": "jmx"})

BLOCKS = [
    "Proxmox/PBS",
    "NAS",
    "Firewalls / Red perimetral",
    "Switches",
    "SAIs",
    "Impresoras",
    "Servidores físicos",
    "Windows/Linux",
    "Servicios/aplicaciones",
    "Zabbix interno",
    "Backups",
]

ROADMAP_PHASES = [
    ("G1", "Estabilizar adquisición periódica Proxmox/PBS ya preparada."),
    ("G2", "NAS/SMART/RAID/storage."),
    ("G3", "SAIs/UPS."),
    ("G4", "Firewalls / Red perimetral / switches."),
    ("G5", "Impresoras."),
    ("G6", "Servidores físicos/iDRAC/iLO."),
    ("G7", "Windows/Linux y servicios críticos."),
    ("G8", "Aplicaciones, certificados, bases de datos."),
    ("G9", "Política global de alertas/notificaciones."),
    ("G10", "Agente diario inteligente."),
]


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def read_json(path: Path) -> Any:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def to_int(value: Any, default: int = 0) -> int:
    try:
        if value in {None, ""}:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def ts_text(value: Any) -> str:
    ts = to_int(value)
    if ts <= 0:
        return "never"
    return datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def text_blob(*parts: Any) -> str:
    return " ".join(str(part or "") for part in parts).lower()


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


FIREWALL_KEYWORDS = {
    "firewall",
    "firewalls",
    "fortigate",
    "fortinet",
    "mikrotik",
    "pfsense",
    "opnsense",
    "sonicwall",
    "checkpoint",
    "paloalto",
    "sophos",
    "perimetral",
    "redperimetral",
}


def firewall_inventory_text(host: dict[str, Any]) -> str:
    inventory = host.get("inventory") or {}
    if not isinstance(inventory, dict):
        return ""
    return text_blob(*[f"{key}={value}" for key, value in inventory.items() if value])


def firewall_tag_text(host: dict[str, Any]) -> str:
    tags = host.get("tags") or []
    if not isinstance(tags, list):
        return ""
    return text_blob(*[f"{tag.get('tag', '')}={tag.get('value', '')}" for tag in tags])


def is_firewall_host(host: dict[str, Any], groups: str, templates: str) -> tuple[bool, str]:
    host_name = text_blob(host.get("host"), host.get("name"))
    group_norm = norm(groups)
    template_norm = norm(templates)
    identity_norm = norm(text_blob(host.get("host"), host.get("name"), groups, templates))
    tag_norm = norm(firewall_tag_text(host))
    inventory_norm = norm(firewall_inventory_text(host))
    tag_values = [norm(str(tag.get("value", ""))) for tag in (host.get("tags") or []) if isinstance(tag, dict)]
    tag_pairs = {norm(str(tag.get("tag", ""))): norm(str(tag.get("value", ""))) for tag in (host.get("tags") or []) if isinstance(tag, dict)}

    if "firewall" in group_norm or "firewalls" in group_norm or "redperimetral" in group_norm:
        return True, "host group firewall/firewalls/red perimetral detected"
    if tag_pairs.get("role") == "firewall" or tag_pairs.get("type") == "firewall" or "firewall" in tag_norm or "firewall" in tag_values:
        return True, "tag role/type=firewall detected"
    if "firewall" in inventory_norm:
        return True, "inventory firewall keyword detected"
    if any(keyword in identity_norm for keyword in FIREWALL_KEYWORDS):
        return True, "firewall keyword/vendor detected in host/template/name"
    if any(keyword in norm(host_name) for keyword in FIREWALL_KEYWORDS):
        return True, "firewall keyword/vendor detected in host name"
    if any(keyword in template_norm for keyword in FIREWALL_KEYWORDS):
        return True, "firewall keyword/vendor detected in template name"
    return False, ""


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        return "_Sin datos._"
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(value).replace("\n", " ") for value in row) + " |")
    return "\n".join(lines)


class Api:
    def __init__(self) -> None:
        env = zbx.load_env(ENV_FILE)
        self.client = zbx.ZabbixApi(zbx.api_url_from_env(env["ZABBIX_URL"]), env["ZABBIX_TOKEN"], zbx.tls_context(env))

    def call(self, method: str, params: dict[str, Any] | None = None, auth: bool = True) -> Any:
        return self.client.call(method, params or {}, auth=auth)


def load_artifacts() -> dict[str, Any]:
    return {name: read_json(path) for name, path in ARTIFACT_PATHS.items()}


def collect_zabbix() -> dict[str, Any]:
    api = Api()
    data: dict[str, Any] = {"api_errors": []}
    data["version"] = api.call("apiinfo.version", auth=False)
    data["hosts"] = api.call(
        "host.get",
        {
            "output": ["hostid", "host", "name", "status", "proxyid"],
            "selectGroups": ["groupid", "name"],
            "selectInterfaces": "extend",
            "selectParentTemplates": ["templateid", "host", "name"],
            "selectTags": "extend",
            "selectInventory": "extend",
        },
    )
    hostids = [host["hostid"] for host in data["hosts"]]
    data["items"] = api.call(
        "item.get",
        {
            "output": ["itemid", "hostid", "name", "key_", "type", "status", "state", "lastclock", "lastvalue", "error", "value_type", "units"],
            "hostids": hostids,
        },
    )
    data["triggers"] = api.call(
        "trigger.get",
        {
            "output": ["triggerid", "description", "priority", "status", "value"],
            "selectHosts": ["hostid", "host", "name"],
            "selectItems": ["itemid", "hostid", "key_", "name"],
        },
    )
    data["problems"] = api.call(
        "problem.get",
        {
            "output": ["eventid", "objectid", "name", "severity", "clock", "opdata", "acknowledged"],
            "selectTags": "extend",
            "sortfield": ["eventid"],
            "sortorder": "DESC",
        },
    )
    return data


def group_by_host(zdata: dict[str, Any]) -> dict[str, Any]:
    by_host: dict[str, Any] = {}
    for host in zdata["hosts"]:
        hostid = host["hostid"]
        by_host[hostid] = {
            "host": host,
            "items": [],
            "triggers": [],
            "problems": [],
        }
    for item in zdata["items"]:
        by_host.setdefault(item["hostid"], {"items": [], "triggers": [], "problems": [], "host": {}})["items"].append(item)
    trigger_hosts: dict[str, list[str]] = {}
    for trigger in zdata["triggers"]:
        hostids = [host["hostid"] for host in trigger.get("hosts", [])]
        trigger_hosts[trigger["triggerid"]] = hostids
        for hostid in hostids:
            by_host.setdefault(hostid, {"items": [], "triggers": [], "problems": [], "host": {}})["triggers"].append(trigger)
    for problem in zdata["problems"]:
        for hostid in trigger_hosts.get(str(problem.get("objectid")), []):
            by_host.setdefault(hostid, {"items": [], "triggers": [], "problems": [], "host": {}})["problems"].append(problem)
    return by_host


def real_proxmox_vm_names(artifacts: dict[str, Any]) -> dict[str, dict[str, Any]]:
    inv = artifacts.get("proxmox_inventory") or {}
    result: dict[str, dict[str, Any]] = {}
    for vm in (inv.get("qemu_vms") or []) + (inv.get("lxc_containers") or []):
        name = str(vm.get("name", ""))
        vmid = str(vm.get("vmid", ""))
        if name:
            result[norm(name)] = vm
        if vmid:
            result[vmid] = vm
    return result


def match_proxmox_vm(host: dict[str, Any], vm_map: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    host_norm = norm(str(host.get("host", "")))
    name_norm = norm(str(host.get("name", "")))
    candidates = [host_norm, name_norm]
    for candidate in candidates:
        if candidate in vm_map:
            return vm_map[candidate]
    for vm_key, vm in vm_map.items():
        if not vm_key.isdigit() and len(vm_key) >= 5:
            if any(candidate and (candidate in vm_key or vm_key in candidate) for candidate in candidates):
                return vm
    return None


def interface_summary(interfaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for iface in interfaces:
        itype = INTERFACE_TYPES.get(str(iface.get("type")), str(iface.get("type", "")))
        avail = {"0": "unknown", "1": "available", "2": "unavailable"}.get(str(iface.get("available")), str(iface.get("available", "")))
        out.append(
            {
                "type": itype,
                "ip": iface.get("ip", ""),
                "dns": iface.get("dns", ""),
                "port": iface.get("port", ""),
                "main": str(iface.get("main")) == "1",
                "useip": str(iface.get("useip")) == "1",
                "available": avail,
                "error": iface.get("error", ""),
            }
        )
    return out


def monitoring_methods(items: list[dict[str, Any]], interfaces: list[dict[str, Any]]) -> list[str]:
    methods = {iface["type"] for iface in interface_summary(interfaces)}
    for item in items:
        if str(item.get("status")) != "0":
            continue
        item_type = ITEM_TYPES.get(str(item.get("type")), str(item.get("type")))
        low = item_type.lower()
        if "agent" in low:
            methods.add("agent")
        elif "snmp" in low:
            methods.add("snmp")
        elif "ipmi" in low:
            methods.add("ipmi")
        elif "http" in low:
            methods.add("http")
        elif "trapper" in low:
            methods.add("trapper")
        elif "external" in low:
            methods.add("external")
        elif "calculated" in low:
            methods.add("calculated")
        elif "dependent" in low:
            methods.add("dependent")
        elif "internal" in low:
            methods.add("zabbix_internal")
    return sorted(methods)


def checks_existing(items: list[dict[str, Any]], methods: list[str]) -> list[str]:
    text = text_blob(" ".join(methods), " ".join(f"{item.get('key_', '')} {item.get('name', '')}" for item in items if str(item.get("status")) == "0"))
    checks = set(methods)
    patterns = {
        "availability": r"agent\.ping|icmpping|available|status",
        "cpu": r"cpu|processor|load",
        "memory": r"memory|vm\.memory|ram",
        "filesystem": r"vfs\.fs|filesystem|free space|disk space",
        "storage": r"storage|datastore|pool|volume|zfs",
        "smart": r"smart|hdd|disk health|predict",
        "raid": r"raid|array|controller",
        "temperature": r"temperature|temp|thermal",
        "hardware": r"hardware|idrac|ilo|sensor|chassis|system board",
        "fans": r"fan",
        "power": r"power|psu|supply",
        "interface": r"net\.if|interface|ifhc|ifin|ifout|traffic",
        "errors": r"crc|error|discard|dropped",
        "battery": r"battery",
        "load": r"\bload\b|ups.*load",
        "runtime": r"runtime|autonomy|remaining",
        "input_output": r"input|output|voltage",
        "self_test": r"self.?test|test result",
        "toner": r"toner|cartridge|supply",
        "paper": r"paper|tray",
        "backup": r"backup|veeam|vzdump|pbs|snapshot|restore",
        "service": r"service\.info|proc\.num|service",
        "updates": r"update|package|patch",
        "logs": r"log\[|eventlog",
        "web": r"web|http|response|ssl",
        "certificate": r"cert|certificate|ssl",
        "database": r"mysql|mssql|postgres|database|db ",
        "vpn": r"vpn|wireguard|ipsec",
        "sessions": r"session|conntrack|connections",
        "quorum": r"quorum|cluster",
        "job": r"job|task",
    }
    for check, pattern in patterns.items():
        if re.search(pattern, text):
            checks.add(check)
    return sorted(checks)


def infer_location(*parts: str) -> str:
    text = " ".join(parts).lower()
    locations = [
        ("almeria", "Almeria"),
        ("gallarza", "Gallarza"),
        ("calahorra", "Calahorra"),
        ("ramiro", "Ramiro"),
        ("genomica", "Genomica"),
    ]
    for needle, value in locations:
        if needle in text:
            return value
    return ""


def classify_host(host: dict[str, Any], items: list[dict[str, Any]], vm_map: dict[str, dict[str, Any]]) -> tuple[str, str, str]:
    groups = " ".join(group.get("name", "") for group in host.get("groups", []))
    templates = " ".join(template.get("name") or template.get("host", "") for template in host.get("parentTemplates", []))
    item_text = " ".join((item.get("key_", "") + " " + item.get("name", "")) for item in items[:400])
    identity = text_blob(host.get("host"), host.get("name"), groups, templates)
    text = text_blob(identity, item_text)
    vm_match = match_proxmox_vm(host, vm_map)
    real_node_names = {"proxmox-gallarza", "pvereplicas", "proxmoxalmeria"}
    host_identity = norm(str(host.get("host", "")))
    firewall_match, firewall_reason = is_firewall_host(host, groups, templates)

    if str(host.get("host")) == "PBS Backup Monitoring":
        return "pbs", "technical_backup_metrics_host", "technical host created for PBS backup metrics"
    if str(host.get("host")) == "Proxmox Storage Monitoring":
        return "proxmox_node", "technical_storage_metrics_host", "technical host created for Proxmox storage metrics"
    if "zabbix server" in identity:
        return "zabbix_server", "zabbix_internal", "Zabbix server name/template detected"
    if "idrac" in identity:
        return "idrac", "dell_out_of_band", "iDRAC name/template detected"
    if " ilo" in f" {identity}" or "proliant" in identity:
        return "ilo", "hp_out_of_band", "iLO/ProLiant name/template detected"
    if "veeam" in text or "srvbackup" in identity or "srvcopias" in identity or "esxibck" in identity:
        return "backup_system", "backup_server", "backup/Veeam keyword detected"
    if "pbs" in identity or "proxmox backup" in identity:
        return "pbs", "backup_server", "PBS keyword detected"
    if host_identity in real_node_names or "proxmox" in identity or "hypervisor" in identity:
        return "proxmox_node", "hypervisor", "Proxmox/PVE keyword detected"
    if vm_match:
        subtype = "windows_vm" if re.search(r"windows|server_2019|serts|sr?pdc|active", text) else "linux_or_application_vm"
        return "proxmox_vm", subtype, f"matches Proxmox VM {vm_match.get('vmid')} {vm_match.get('name')}"
    if "qnap" in identity or "snmp qnap" in identity:
        return "qnap", "nas_qnap", "QNAP template/name detected"
    if "synology" in identity:
        return "synology", "nas_synology", "Synology name/template detected"
    if " nas" in f" {identity}" or "nas-" in identity or "nasalm" in identity:
        return "nas", "generic_nas", "NAS group/name detected"
    if "sai" in identity or "ups" in identity or "eaton" in identity:
        return "ups_sai", "ups_snmp", "UPS/SAI/Eaton detected"
    if "impresora" in identity or "laserjet" in identity or "brother" in identity or "printer" in identity or "canon" in identity or "zebra" in identity:
        return "printer", "snmp_printer", "printer group/name detected"
    if firewall_match:
        return "firewall", "security_gateway", firewall_reason
    if "router" in identity or "mikrotik" in identity or "edgerouter" in identity:
        return "router", "router", "router keyword detected"
    if "switch" in identity or "v1810" in identity or "procurve" in identity:
        return "switch", "ethernet_switch", "switch keyword/template detected"
    if " cisco" in f" {identity}" or "ap " in f" {groups.lower()} ":
        return "network_device", "access_point_or_network", "Cisco/AP network device detected"
    if "windows" in text or "mssql" in text or "service.info" in text:
        return "windows_server", "windows_or_service_host", "Windows/service checks detected"
    if "linux" in text or "system.uname" in text or "linux by zabbix agent" in text:
        return "linux_server", "linux_agent", "Linux template/agent checks detected"
    if "database" in text or "mysql" in text or "postgres" in text or "mssql" in text:
        return "database", "database_service", "database keyword detected"
    if "http" in text or "web" in text or "ssl" in text:
        return "web_service", "http_or_tls_service", "HTTP/web keyword detected"
    if "erpnext" in text or "dify" in text or "jbrowse" in text:
        return "application", "application_vm_or_service", "application name detected"
    if "servidores fisicos" in text or "poweredge" in text or "server" in text:
        return "physical_server", "physical_or_server", "server/physical group detected"
    return "unknown", "unknown", "not enough naming/template/interface evidence"


def expected_checks(asset_type: str) -> list[str]:
    mapping = {
        "qnap": ["availability", "snmp", "smart", "raid", "storage", "temperature", "backup"],
        "synology": ["availability", "snmp", "smart", "raid", "storage", "temperature", "backup"],
        "nas": ["availability", "snmp", "smart", "raid", "storage", "temperature", "backup"],
        "firewall": [
            "availability",
            "snmp",
            "interface",
            "traffic",
            "wan",
            "lan",
            "vpn",
            "ha",
            "cpu",
            "memory",
            "uptime",
            "sessions",
            "temperature",
            "firmware",
        ],
        "router": ["availability", "snmp", "interface", "traffic", "wan", "lan", "vpn", "cpu", "memory", "uptime"],
        "switch": ["availability", "snmp", "interface", "traffic", "errors", "uplinks"],
        "network_device": ["availability", "snmp", "interface", "traffic", "errors", "firmware"],
        "ups_sai": ["availability", "snmp", "battery", "load", "runtime", "input_output", "self_test"],
        "printer": ["availability", "snmp", "toner", "paper", "errors"],
        "idrac": ["availability", "hardware", "raid", "smart", "temperature", "fans", "power"],
        "ilo": ["availability", "hardware", "raid", "smart", "temperature", "fans", "power"],
        "physical_server": ["availability", "agent", "ipmi", "hardware", "raid", "smart", "filesystem", "backup"],
        "windows_server": ["availability", "agent", "cpu", "memory", "filesystem", "service", "updates", "logs", "backup"],
        "linux_server": ["availability", "agent", "cpu", "memory", "filesystem", "service", "updates", "logs", "backup"],
        "proxmox_vm": ["availability", "agent", "cpu", "memory", "filesystem", "service", "backup"],
        "proxmox_node": ["availability", "api", "cpu", "memory", "storage", "quorum", "job", "backup"],
        "pbs": ["availability", "api", "storage", "backup", "job"],
        "backup_system": ["availability", "service", "job", "backup", "storage"],
        "database": ["availability", "database", "service", "backup", "storage"],
        "web_service": ["availability", "web", "certificate", "response_time"],
        "application": ["availability", "web", "service", "database", "backup"],
        "zabbix_server": ["availability", "zabbix_internal", "queue", "database", "processes", "filesystem", "backup"],
    }
    return mapping.get(asset_type, ["availability", "inventory"])


def infer_criticality(asset_type: str, problems: list[dict[str, Any]], groups: list[str], host_text: str) -> str:
    if any(str(problem.get("severity")) in {"4", "5"} for problem in problems):
        return "critica"
    if asset_type in {"zabbix_server", "proxmox_node", "pbs", "backup_system", "firewall", "nas", "qnap", "synology"}:
        return "alta"
    if asset_type in {"idrac", "ilo", "physical_server", "windows_server", "linux_server", "proxmox_vm", "database", "application"}:
        return "media-alta"
    if asset_type in {"switch", "router", "ups_sai", "network_device"}:
        return "media-alta"
    if asset_type == "printer":
        return "baja"
    if "critico" in " ".join(groups).lower() or "bbd" in host_text.lower():
        return "alta"
    return "media"


def priority_for_host(criticality: str, unsupported: int, problems: list[dict[str, Any]], missing: list[str], stale: bool) -> str:
    if any(str(problem.get("severity")) in {"4", "5"} for problem in problems):
        return "CRITICO"
    if criticality in {"critica", "alta"} and ("backup" in missing or "smart" in missing or stale):
        return "ALTO"
    if unsupported >= 5 or len(problems) >= 3:
        return "ALTO"
    if missing or unsupported:
        return "MEDIO"
    return "BAJO"


def coverage_status(active_items: int, enabled_triggers: int, missing: list[str], unsupported: int, lastclock: int) -> str:
    if active_items == 0:
        return "sin_monitorizacion"
    if lastclock <= 0:
        return "sin_datos_recientes"
    if enabled_triggers == 0:
        return "metricas_sin_triggers"
    if unsupported or missing:
        return "parcial"
    return "buena"


def recommendation(asset_type: str, missing: list[str], unsupported: int, problems: list[dict[str, Any]], stale: bool) -> str:
    if any(str(problem.get("severity")) in {"4", "5"} for problem in problems):
        return "Atender primero los problemas High/Disaster activos y confirmar impacto operativo."
    if stale:
        return "Confirmar si el activo sigue en servicio y corregir conectividad/IP/SNMP/agente antes de ampliar checks."
    if unsupported:
        return "Corregir items unsupported que bloquean datos accionables antes de añadir más cobertura."
    if missing:
        if asset_type == "firewall":
            return "Firewall detectado, pero faltan métricas SNMP/plantillas/triggers para evaluación completa: " + ", ".join(missing[:8])
        return "Completar checks faltantes: " + ", ".join(missing[:8])
    if asset_type == "unknown":
        return "Completar inventario: tipo de activo, ubicación, criticidad, responsable y método de monitorización."
    return "Mantener cobertura y documentar dependencias/criticidad para el agente."


def build_host_entries(zdata: dict[str, Any], artifacts: dict[str, Any]) -> list[dict[str, Any]]:
    grouped = group_by_host(zdata)
    vm_map = real_proxmox_vm_names(artifacts)
    now = int(time.time())
    entries = []
    for hostid, bundle in grouped.items():
        host = bundle["host"]
        if not host:
            continue
        items = bundle["items"]
        triggers = bundle["triggers"]
        problems = bundle["problems"]
        groups = [group.get("name", "") for group in host.get("groups", [])]
        templates = [template.get("name") or template.get("host", "") for template in host.get("parentTemplates", [])]
        interfaces = interface_summary(host.get("interfaces", []))
        methods = monitoring_methods(items, host.get("interfaces", []))
        active_items = [item for item in items if str(item.get("status")) == "0"]
        unsupported_items = [item for item in active_items if str(item.get("state")) == "1"]
        enabled_triggers = [trigger for trigger in triggers if str(trigger.get("status")) == "0"]
        disabled_triggers = [trigger for trigger in triggers if str(trigger.get("status")) == "1"]
        lastclock = max([to_int(item.get("lastclock")) for item in active_items] or [0])
        asset_type, subtype, classification_reason = classify_host(host, active_items, vm_map)
        existing = checks_existing(active_items, methods)
        expected = expected_checks(asset_type)
        missing = [check for check in expected if check not in existing]
        host_text = text_blob(host.get("host"), host.get("name"), " ".join(groups), " ".join(templates))
        location = infer_location(host_text)
        criticality = infer_criticality(asset_type, problems, groups, host_text)
        stale = lastclock <= 0 or (now - lastclock > TIMEOUT_STALE_SECONDS)
        priority = priority_for_host(criticality, len(unsupported_items), problems, missing, stale)
        entry = {
            "hostid": hostid,
            "host": host.get("host"),
            "visible_name": host.get("name"),
            "status": "enabled" if str(host.get("status")) == "0" else "disabled",
            "probable_type": asset_type,
            "subtype": subtype,
            "classification_reason": classification_reason,
            "groups": groups,
            "templates": templates,
            "interfaces": interfaces,
            "ip_dns": [{"ip": iface["ip"], "dns": iface["dns"], "type": iface["type"], "port": iface["port"], "available": iface["available"]} for iface in interfaces],
            "monitoring_methods": methods,
            "items_active": len(active_items),
            "triggers_active": len(enabled_triggers),
            "triggers_disabled": len(disabled_triggers),
            "active_problems": [
                {
                    "eventid": problem.get("eventid"),
                    "name": problem.get("name"),
                    "severity": SEVERITIES.get(str(problem.get("severity")), str(problem.get("severity"))),
                    "clock": to_int(problem.get("clock")),
                    "clock_text": ts_text(problem.get("clock")),
                    "operational_data": problem.get("opdata", ""),
                    "tags": problem.get("tags", []),
                }
                for problem in problems
            ],
            "unsupported_items": [
                {
                    "itemid": item.get("itemid"),
                    "name": item.get("name"),
                    "key": item.get("key_"),
                    "error": item.get("error", ""),
                    "lastclock": to_int(item.get("lastclock")),
                    "lastclock_text": ts_text(item.get("lastclock")),
                    "type": ITEM_TYPES.get(str(item.get("type")), str(item.get("type"))),
                }
                for item in unsupported_items
            ],
            "unsupported_items_count": len(unsupported_items),
            "last_data_clock": lastclock,
            "last_data_text": ts_text(lastclock),
            "location_inferred": location,
            "criticality_inferred": criticality,
            "checks_existing": existing,
            "checks_missing": missing,
            "coverage_current": coverage_status(len(active_items), len(enabled_triggers), missing, len(unsupported_items), lastclock),
            "gaps_detected": missing + (["unsupported_items"] if unsupported_items else []) + (["stale_or_no_recent_data"] if stale else []),
            "priority": priority,
            "next_recommendation": recommendation(asset_type, missing, len(unsupported_items), problems, stale),
        }
        entries.append(entry)
    return sorted(entries, key=lambda item: (item["probable_type"], item["host"].lower()))


def block_hosts(hosts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    return {
        "Proxmox/PBS": [h for h in hosts if h["probable_type"] in {"proxmox_node", "pbs"}],
        "NAS": [h for h in hosts if h["probable_type"] in {"nas", "qnap", "synology"}],
        "Firewalls / Red perimetral": [h for h in hosts if h["probable_type"] in {"firewall", "router"}],
        "Switches": [h for h in hosts if h["probable_type"] in {"switch", "network_device"}],
        "SAIs": [h for h in hosts if h["probable_type"] == "ups_sai"],
        "Impresoras": [h for h in hosts if h["probable_type"] == "printer"],
        "Servidores físicos": [h for h in hosts if h["probable_type"] in {"physical_server", "idrac", "ilo"}],
        "Windows/Linux": [h for h in hosts if h["probable_type"] in {"windows_server", "linux_server", "proxmox_vm"}],
        "Servicios/aplicaciones": [h for h in hosts if h["probable_type"] in {"web_service", "application", "database"}],
        "Zabbix interno": [h for h in hosts if h["probable_type"] == "zabbix_server"],
        "Backups": [h for h in hosts if h["probable_type"] in {"backup_system", "pbs"}],
    }


def score_block(name: str, hosts: list[dict[str, Any]], artifacts: dict[str, Any]) -> dict[str, Any]:
    if not hosts:
        return {"score": 0, "label": "no monitorizado", "reason": "No se detectaron hosts del bloque en Zabbix."}
    total = len(hosts)
    with_data = sum(1 for host in hosts if host["last_data_clock"] > 0)
    with_triggers = sum(1 for host in hosts if host["triggers_active"] > 0)
    unsupported = sum(host["unsupported_items_count"] for host in hosts)
    gaps = sum(len(host["gaps_detected"]) for host in hosts)
    high = sum(1 for host in hosts for problem in host["active_problems"] if problem["severity"] in {"High", "Disaster"})
    if name == "Proxmox/PBS" and artifacts.get("proxmox_backup_knowledge"):
        base = 4
        reason = "Bloque con inventario real Proxmox/PBS, hosts técnicos e items trapper ya recibiendo datos; falta periodicidad y habilitar política."
    elif with_data == 0:
        base = 1
        reason = "Hay hosts, pero no hay datos recientes suficientes."
    elif with_triggers == 0:
        base = 2
        reason = "Hay métricas, pero faltan triggers accionables."
    elif unsupported or gaps:
        base = 2 if unsupported > total else 3
        reason = f"Hay métricas y triggers, pero persisten {unsupported} unsupported y {gaps} huecos."
    else:
        base = 4
        reason = "Hay datos y triggers sin huecos evidentes en el análisis actual."
    if high and base < 4:
        reason += f" Además hay {high} problema(s) High/Disaster activo(s)."
    label = {
        0: "no monitorizado",
        1: "disponibilidad básica",
        2: "métricas básicas",
        3: "métricas + triggers",
        4: "datos accionables",
        5: "listo para agente inteligente",
    }[base]
    return {
        "score": base,
        "label": label,
        "hosts": total,
        "hosts_with_data": with_data,
        "hosts_with_triggers": with_triggers,
        "unsupported_items": unsupported,
        "high_or_disaster_problems": high,
        "reason": reason,
    }


def detect_block_holes(block: str, hosts: list[dict[str, Any]], artifacts: dict[str, Any]) -> list[str]:
    holes: list[str] = []
    missing_counter = Counter(check for host in hosts for check in host["checks_missing"])
    unsupported = sum(host["unsupported_items_count"] for host in hosts)
    stale = [host["host"] for host in hosts if "stale_or_no_recent_data" in host["gaps_detected"]]
    if missing_counter:
        holes.append("Checks faltantes frecuentes: " + ", ".join(f"{k}({v})" for k, v in missing_counter.most_common(8)))
    if unsupported:
        holes.append(f"{unsupported} items unsupported en el bloque.")
    if stale:
        holes.append(f"Hosts sin datos recientes: {', '.join(stale[:8])}.")
    if block == "NAS":
        holes.append("Falta cerrar el modelo de SMART/RAID/storage/backups de NAS; NasAlmeria mantiene alerta SMART real.")
    if block == "SAIs":
        holes.append("SAIs Eaton tienen OIDs no soportadas; falta validar MIB/modelo/firmware y self-test/autonomía.")
    if block == "Impresoras":
        holes.append("Hay impresoras SNMP sin datos recientes; falta confirmar si siguen en servicio o cambiaron IP/SNMP.")
    if block == "Firewalls / Red perimetral":
        if not hosts:
            holes.append("No hay firewalls/red perimetral claramente clasificados; falta inventario y templates WAN/VPN/sesiones.")
        elif any(host["checks_missing"] for host in hosts):
            holes.append("Firewall detectado, pero faltan métricas SNMP/plantillas/triggers para evaluación completa.")
    if block == "Servicios/aplicaciones":
        app_like = []
        for vm in (artifacts.get("proxmox_inventory") or {}).get("qemu_vms", []) or []:
            name = str(vm.get("name", ""))
            if re.search(r"erp|dify|jbrowse|incidencias|app|web|service", name, re.IGNORECASE):
                app_like.append(f"{name}({vm.get('vmid')})")
        if app_like:
            holes.append(
                "Hay VMs Proxmox con pinta de aplicación sin bloque aplicativo dedicado en Zabbix: "
                + ", ".join(app_like[:10])
                + "."
            )
        elif not hosts:
            holes.append("No se detectaron web checks, certificados, bases de datos o aplicaciones como bloque propio.")
    if block == "Backups":
        summary = (artifacts.get("proxmox_backup_knowledge") or {}).get("summary", {})
        if summary.get("critical_hosts_without_backup_evidence"):
            holes.append(f"{summary['critical_hosts_without_backup_evidence']} hosts críticos sin evidencia directa de backup.")
    return holes


def build_sections(hosts: list[dict[str, Any]], artifacts: dict[str, Any]) -> dict[str, Any]:
    blocks = block_hosts(hosts)
    sections = {}
    for block, block_list in blocks.items():
        sections[block] = {
            "hosts": [host["host"] for host in block_list],
            "count": len(block_list),
            "holes": detect_block_holes(block, block_list, artifacts),
            "top_priority_hosts": [
                {
                    "host": host["host"],
                    "type": host["probable_type"],
                    "priority": host["priority"],
                    "problems": len(host["active_problems"]),
                    "unsupported": host["unsupported_items_count"],
                    "gaps": host["gaps_detected"][:8],
                    "recommendation": host["next_recommendation"],
                }
                for host in sorted(block_list, key=lambda item: {"CRITICO": 0, "ALTO": 1, "MEDIO": 2, "BAJO": 3}[item["priority"]])[:10]
            ],
        }
    return sections


def build_global_map(zdata: dict[str, Any], artifacts: dict[str, Any]) -> dict[str, Any]:
    hosts = build_host_entries(zdata, artifacts)
    type_counts = Counter(host["probable_type"] for host in hosts)
    blocks = block_hosts(hosts)
    readiness = {block: score_block(block, block_hosts_list, artifacts) for block, block_hosts_list in blocks.items()}
    sections = build_sections(hosts, artifacts)
    problems_by_severity = Counter(problem["severity"] for host in hosts for problem in host["active_problems"])
    worst_blocks = sorted(
        [{"block": block, **score} for block, score in readiness.items()],
        key=lambda item: (item["score"], -item.get("unsupported_items", 0), -item.get("high_or_disaster_problems", 0)),
    )
    data = {
        "metadata": {
            "generated_at": now_text(),
            "mode": "read-only global infrastructure map",
            "zabbix_version": zdata.get("version"),
            "artifacts_used": {name: str(path) for name, path in ARTIFACT_PATHS.items() if path.exists()},
        },
        "summary": {
            "hosts_total": len(hosts),
            "hosts_enabled": sum(1 for host in hosts if host["status"] == "enabled"),
            "items_active_total": sum(host["items_active"] for host in hosts),
            "triggers_active_total": sum(host["triggers_active"] for host in hosts),
            "unsupported_items_total": sum(host["unsupported_items_count"] for host in hosts),
            "active_problems_by_severity": dict(problems_by_severity),
            "types": dict(type_counts),
        },
        "type_counts": dict(type_counts),
        "hosts": hosts,
        "block_readiness_scores": readiness,
        "sections": sections,
        "worst_prepared_blocks": worst_blocks[:6],
        "roadmap": [{"phase": phase, "description": description} for phase, description in ROADMAP_PHASES],
        "agent_should_know": {
            "asset_map": "Cada host tiene tipo probable, subtipo, ubicación, IP/DNS, métodos, templates y grupos.",
            "criticality": "La criticidad se infiere de tipo, grupos y problemas High/Disaster; debe confirmarse humanamente.",
            "dependencies": "Proxmox/PBS/backups ya aportan relaciones VMID/job/datastore; faltan dependencias completas NAS/red/servicios.",
            "coverage": "El mapa expone checks existentes y faltantes por host y por bloque.",
            "active_problems": "Se recogen problemas activos con severidad, hora y operational data.",
            "noise_vs_real": "Unsupported/stale se separa de problemas reales; NasAlmeria SMART se mantiene como alerta real.",
            "gaps": "Cada host y bloque incluye huecos y recomendación.",
            "forbidden_without_confirmation": [
                "borrar/deshabilitar hosts, items, triggers, templates o macros",
                "cerrar/silenciar problemas",
                "modificar jobs de backup, Proxmox/PBS, NAS, firewalls o switches",
                "activar notificaciones globales",
                "reiniciar servicios",
            ],
        },
        "risk_if_only_proxmox": [
            "NAS/SMART/RAID/storage seguirían con alertas reales y huecos de backup sin priorización global.",
            "SAIs Eaton mantendrían OIDs unsupported y posible falta de self-test/autonomía fiable.",
            "Impresoras sin datos podrían ocultar activos retirados o SNMP roto.",
            "Switches / firewalls / red perimetral quedarían sin modelo de WAN/VPN/uplinks/errores CRC.",
            "Servidores físicos/iDRAC/iLO quedarían sin visión completa de RAID, fuentes, ventiladores y hardware.",
            "Windows/Linux y aplicaciones seguirían sin mapa de servicios críticos, updates, logs y backups.",
        ],
    }
    return data


def render_host_table(hosts: list[dict[str, Any]], limit: int = 80) -> str:
    rows = []
    for host in sorted(hosts, key=lambda item: ({"CRITICO": 0, "ALTO": 1, "MEDIO": 2, "BAJO": 3}[item["priority"]], item["probable_type"], item["host"]))[:limit]:
        rows.append(
            [
                host["host"],
                host["probable_type"],
                host["subtype"],
                host["priority"],
                host["criticality_inferred"],
                host["items_active"],
                host["triggers_active"],
                host["unsupported_items_count"],
                len(host["active_problems"]),
                host["coverage_current"],
                ", ".join(host["checks_missing"][:5]),
            ]
        )
    return md_table(["Host", "Tipo", "Subtipo", "Prioridad", "Criticidad", "Items", "Triggers", "Unsupported", "Problems", "Cobertura", "Faltan"], rows)


def render_block_scores(scores: dict[str, Any]) -> str:
    rows = [
        [block, score["score"], score["label"], score.get("hosts", 0), score.get("unsupported_items", 0), score.get("high_or_disaster_problems", 0), score["reason"]]
        for block, score in scores.items()
    ]
    return md_table(["Bloque", "Score", "Estado", "Hosts", "Unsupported", "High/Disaster", "Motivo"], rows)


def render_sections(data: dict[str, Any]) -> str:
    titles = [
        ("NAS/QNAP", "NAS"),
        ("Firewalls / Red perimetral", "Firewalls / Red perimetral"),
        ("Switches", "Switches"),
        ("SAIs/UPS", "SAIs"),
        ("Impresoras", "Impresoras"),
        ("Servidores físicos/iDRAC/iLO", "Servidores físicos"),
        ("Windows/Linux", "Windows/Linux"),
        ("Proxmox/PBS/backups", "Proxmox/PBS"),
        ("Servicios/aplicaciones", "Servicios/aplicaciones"),
        ("Zabbix interno", "Zabbix interno"),
    ]
    parts = []
    sections = data["sections"]
    for title, key in titles:
        section = sections.get(key, {"count": 0, "hosts": [], "holes": [], "top_priority_hosts": []})
        rows = [
            [host["host"], host["type"], host["priority"], host["problems"], host["unsupported"], ", ".join(host["gaps"][:5]), host["recommendation"]]
            for host in section.get("top_priority_hosts", [])
        ]
        parts.append(
            f"""## {title}

- Hosts detectados: {section.get('count', 0)}.
- Hosts: {', '.join(section.get('hosts', [])[:20]) if section.get('hosts') else 'ninguno clasificado claramente'}.
- Huecos: {'; '.join(section.get('holes', [])) if section.get('holes') else 'sin huecos destacados en este análisis'}.

{md_table(['Host', 'Tipo', 'Prioridad', 'Problems', 'Unsupported', 'Gaps', 'Recomendación'], rows)}
"""
        )
    return "\n".join(parts)


def render_global_md(data: dict[str, Any]) -> str:
    type_rows = [[key, value] for key, value in sorted(data["type_counts"].items())]
    risk_lines = "\n".join(f"- {item}" for item in data["risk_if_only_proxmox"])
    know = data["agent_should_know"]
    know_lines = "\n".join(f"- **{key}**: {value}" for key, value in know.items() if key != "forbidden_without_confirmation")
    forbidden = "\n".join(f"- {item}" for item in know["forbidden_without_confirmation"])
    return f"""# Global Infrastructure Map

Generado: {data['metadata']['generated_at']}

## Resumen ejecutivo

Zabbix contiene {data['summary']['hosts_total']} hosts y ya dispone de datos suficientes para empezar a construir un agente inteligente, pero la preparación es desigual por bloque. Proxmox/PBS avanzó más que el resto; NAS, SAIs, impresoras, red y servidores físicos requieren atención para que el agente no tenga una visión sesgada.

## Mapa de tipos detectados

{md_table(['Tipo', 'Hosts'], type_rows)}

## Scoring de preparación para el agente

0 = no monitorizado; 1 = disponibilidad básica; 2 = métricas básicas; 3 = métricas + triggers; 4 = datos accionables; 5 = listo para agente inteligente.

{render_block_scores(data['block_readiness_scores'])}

## Hosts clasificados

{render_host_table(data['hosts'])}

{render_sections(data)}

## Qué debe saber el agente inteligente

{know_lines}

Acciones prohibidas sin confirmación humana:

{forbidden}

## Riesgos de seguir solo con Proxmox

{risk_lines}
"""


def render_readiness_md(data: dict[str, Any]) -> str:
    worst = data["worst_prepared_blocks"]
    worst_rows = [[item["block"], item["score"], item["label"], item["reason"]] for item in worst]
    high_hosts = [
        host for host in data["hosts"]
        if host["priority"] in {"CRITICO", "ALTO"}
    ][:30]
    rows = [[host["host"], host["probable_type"], host["priority"], host["coverage_current"], ", ".join(host["gaps_detected"][:5])] for host in high_hosts]
    return f"""# Global Monitoring Readiness

Generado: {data['metadata']['generated_at']}

## Resumen

- Hosts: {data['summary']['hosts_total']}
- Unsupported enabled: {data['summary']['unsupported_items_total']}
- Problemas activos por severidad: {json.dumps(data['summary']['active_problems_by_severity'], ensure_ascii=False)}

## Scoring por bloque

{render_block_scores(data['block_readiness_scores'])}

## Bloques peor preparados

{md_table(['Bloque', 'Score', 'Estado', 'Motivo'], worst_rows)}

## Hosts prioritarios

{md_table(['Host', 'Tipo', 'Prioridad', 'Cobertura', 'Gaps'], rows)}
"""


def render_roadmap_md(data: dict[str, Any]) -> str:
    rows = [[item["phase"], item["description"]] for item in data["roadmap"]]
    return f"""# Roadmap global de monitorización

Generado: {data['metadata']['generated_at']}

El objetivo es equilibrar la preparación de todos los bloques antes de delegar decisiones al agente diario.

{md_table(['Fase', 'Objetivo'], rows)}

## Prioridad inmediata

1. Mantener Proxmox/PBS como bloque avanzado, pero sin convertirlo en único foco.
2. Pasar a NAS/SMART/RAID/storage por riesgo directo de datos.
3. Corregir SAIs/UPS porque son soporte eléctrico de la infraestructura.
4. Completar red, firewalls y switches para entender dependencias.
5. Cerrar impresoras, servidores físicos, Windows/Linux y servicios.
"""


def update_infrastructure_summary(data: dict[str, Any]) -> None:
    worst = ", ".join(f"{item['block']}={item['score']}" for item in data["worst_prepared_blocks"][:5])
    text = f"""# Infrastructure summary for Zabbix agent

Generado: {data['metadata']['generated_at']}

- Zabbix version: `{data['metadata']['zabbix_version']}`
- Hosts: `{data['summary']['hosts_total']}`
- Unsupported items: `{data['summary']['unsupported_items_total']}`
- Bloques peor preparados: {worst}

## Tipos

{md_table(['Tipo', 'Hosts'], [[k, v] for k, v in sorted(data['type_counts'].items())])}

## Scoring global

{render_block_scores(data['block_readiness_scores'])}

## Próximo foco recomendado

No seguir únicamente con Proxmox/PBS. El siguiente bloque debe ser NAS/SMART/RAID/storage, seguido por SAIs/UPS y red.
"""
    write_text(INFRA_SUMMARY_MD, text)


def update_monitoring_gaps(data: dict[str, Any]) -> None:
    previous = read_json(MONITORING_GAPS_JSON)
    if not isinstance(previous, dict):
        previous = {}
    previous["global_readiness"] = {
        "generated_at": data["metadata"]["generated_at"],
        "type_counts": data["type_counts"],
        "block_scores": data["block_readiness_scores"],
        "worst_prepared_blocks": data["worst_prepared_blocks"],
        "risk_if_only_proxmox": data["risk_if_only_proxmox"],
    }
    previous["global_roadmap"] = data["roadmap"]
    write_json(MONITORING_GAPS_JSON, previous)


def update_changelog(data: dict[str, Any]) -> None:
    previous = CHANGELOG.read_text(encoding="utf-8") if CHANGELOG.exists() else "# CHANGELOG\n"
    entry = f"""

## {data['metadata']['generated_at']} - Mapa global de infraestructura para agente Zabbix

- Creado script read-only: `/opt/zabbix-codex/scripts/build_global_infra_map.py`.
- Generados:
  - `{OUT_JSON}`
  - `{OUT_MD}`
  - `{READINESS_MD}`
  - `{ROADMAP_MD}`
- Actualizados:
  - `{INFRA_SUMMARY_MD}`
  - `{MONITORING_GAPS_JSON}`
- No se modificó Zabbix, Proxmox, PBS, hosts, templates, items, triggers, macros ni acciones.
- Comandos principales:
  - `python3 -m py_compile scripts/build_global_infra_map.py`
  - `python3 scripts/build_global_infra_map.py`
  - `python3 -m json.tool agent_knowledge/global_infrastructure_map.json`
"""
    write_text(CHANGELOG, previous.rstrip() + entry)


def main() -> int:
    artifacts = load_artifacts()
    zdata = collect_zabbix()
    data = build_global_map(zdata, artifacts)
    write_json(OUT_JSON, data)
    write_text(OUT_MD, render_global_md(data))
    write_text(READINESS_MD, render_readiness_md(data))
    write_text(ROADMAP_MD, render_roadmap_md(data))
    update_infrastructure_summary(data)
    update_monitoring_gaps(data)
    update_changelog(data)
    print(json.dumps({
        "status": "ok",
        "read_only": True,
        "hosts": data["summary"]["hosts_total"],
        "type_counts": data["type_counts"],
        "scores": {block: score["score"] for block, score in data["block_readiness_scores"].items()},
        "outputs": [str(OUT_JSON), str(OUT_MD), str(READINESS_MD), str(ROADMAP_MD)],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
