#!/usr/bin/env python3
"""Build the initial knowledge base for the future Zabbix intelligence agent.

This is a read-only data preparation script. It queries Zabbix API, reads the
previous audit/remediation/diagnostic JSON files, and writes structured JSON and
Markdown documents for agent reasoning. It does not modify Zabbix.
"""

from __future__ import annotations

import json
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
REPORTS_DIR = BASE_DIR / "reports"
DIAGNOSTICS_DIR = BASE_DIR / "diagnostics"
KNOWLEDGE_DIR = BASE_DIR / "agent_knowledge"

COVERAGE_JSON = REPORTS_DIR / "zabbix-coverage-report.json"
REMEDIATION_JSON = REPORTS_DIR / "zabbix-remediation-plan.json"
UNSUPPORTED_BLOCKS_JSON = REPORTS_DIR / "unsupported-blocks-summary.json"
SNMP_JSON = DIAGNOSTICS_DIR / "snmp-known-devices.json"
ZABBIX_GET_JSON = DIAGNOSTICS_DIR / "zabbix-get-local.json"

INFRA_JSON = KNOWLEDGE_DIR / "infrastructure_summary.json"
INFRA_MD = KNOWLEDGE_DIR / "infrastructure_summary.md"
GAPS_JSON = KNOWLEDGE_DIR / "monitoring_gaps.json"
ALERT_POLICY_MD = KNOWLEDGE_DIR / "alert_policy_draft.md"
DAILY_PROMPT_MD = KNOWLEDGE_DIR / "agent_daily_report_prompt.md"

EXTERNAL_MD = REPORTS_DIR / "external-readonly-diagnostics.md"
READINESS_MD = REPORTS_DIR / "agent-readiness-report.md"
ROADMAP_MD = REPORTS_DIR / "monitoring-implementation-roadmap.md"


ASSET_REQUIREMENTS = {
    "zabbix_server": ["agent", "zabbix_internal", "database", "web", "filesystem", "cpu", "memory", "queue", "backup"],
    "proxmox": ["api", "node", "vm_inventory", "storage", "backup", "smart", "service"],
    "backup_server": ["agent", "backup", "filesystem", "storage", "service", "cpu", "memory"],
    "nas": ["snmp", "smart", "raid", "storage", "filesystem", "backup", "temperature"],
    "ups": ["snmp", "battery", "load", "runtime", "input_output", "self_test"],
    "printer": ["snmp", "supplies", "page_counter", "error_state"],
    "network": ["snmp", "interface", "errors", "cpu", "memory", "firmware"],
    "firewall": ["snmp", "interface", "traffic", "wan", "lan", "vpn", "ha", "sessions", "cpu", "memory", "uptime", "temperature", "firmware", "backup"],
    "physical_server": ["agent", "ipmi", "smart", "raid", "filesystem", "backup", "cpu", "memory"],
    "server": ["agent", "filesystem", "backup", "service", "cpu", "memory"],
    "ap": ["snmp", "interface", "clients", "radio"],
    "unknown": ["agent_or_snmp", "availability", "inventory"],
}

SEVERITY_ORDER = {"Disaster": 5, "High": 4, "Average": 3, "Warning": 2, "Information": 1, "Not classified": 0}


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def make_api() -> tuple[zbx.ZabbixApi, str]:
    env = zbx.load_env(zbx.ENV_FILE)
    url = zbx.api_url_from_env(env.get("ZABBIX_URL", ""))
    token = env.get("ZABBIX_TOKEN", "")
    if not token:
        raise ValueError("ZABBIX_TOKEN is empty or missing")
    return zbx.ZabbixApi(url, token, zbx.tls_context(env)), zbx.sanitize_url(url)


def safe_call(
    api: zbx.ZabbixApi,
    method: str,
    params: dict[str, Any] | list[Any] | None,
    errors: list[dict[str, str]],
    default: Any,
    auth: bool = True,
) -> Any:
    try:
        return api.call(method, params, auth=auth)
    except Exception as exc:  # noqa: BLE001 - knowledge build must record partial permissions.
        errors.append({"method": method, "error": str(exc)})
        return default


def collect_zabbix() -> dict[str, Any]:
    api, safe_url = make_api()
    errors: list[dict[str, str]] = []
    version = safe_call(api, "apiinfo.version", {}, errors, "unknown", auth=False)
    hosts = safe_call(
        api,
        "host.get",
        {
            "output": ["hostid", "host", "name", "status", "proxyid", "maintenance_status"],
            "selectGroups": ["groupid", "name"],
            "selectParentTemplates": ["templateid", "host", "name"],
            "selectInterfaces": "extend",
            "selectTags": "extend",
            "selectInventory": "extend",
            "sortfield": "host",
        },
        errors,
        [],
    )
    templates = safe_call(api, "template.get", {"output": ["templateid", "host", "name"]}, errors, [])
    items = safe_call(
        api,
        "item.get",
        {
            "output": [
                "itemid",
                "hostid",
                "name",
                "key_",
                "type",
                "status",
                "state",
                "error",
                "lastclock",
                "lastvalue",
                "interfaceid",
                "snmp_oid",
                "templateid",
            ],
        },
        errors,
        [],
    )
    triggers = safe_call(
        api,
        "trigger.get",
        {
            "output": ["triggerid", "description", "priority", "status", "value", "lastchange", "templateid", "opdata"],
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItems": ["itemid", "hostid", "name", "key_", "lastclock", "lastvalue"],
            "selectTags": "extend",
        },
        errors,
        [],
    )
    problems = safe_call(
        api,
        "problem.get",
        {"output": "extend", "selectTags": "extend", "sortfield": "eventid", "sortorder": "DESC"},
        errors,
        [],
    )
    return {
        "api_endpoint": safe_url,
        "version": version,
        "hosts": hosts,
        "templates": templates,
        "items": items,
        "triggers": triggers,
        "problems": problems,
        "api_errors": errors,
    }


def text_for_host(host: dict[str, Any]) -> str:
    parts = [host.get("host", ""), host.get("name", "")]
    parts.extend(group.get("name", "") for group in host.get("groups") or [])
    parts.extend(template.get("name", "") or template.get("host", "") for template in host.get("parentTemplates") or [])
    parts.extend(f"{tag.get('tag', '')}={tag.get('value', '')}" for tag in host.get("tags") or [])
    inventory = host.get("inventory") or {}
    if isinstance(inventory, dict):
        parts.extend(f"{key}={value}" for key, value in inventory.items() if value)
    return " ".join(str(part) for part in parts).lower()


def norm(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


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
    "palo alto",
    "paloalto",
    "sophos",
    "perimetral",
    "red perimetral",
}


def infer_asset_type(host: dict[str, Any]) -> str:
    text = text_for_host(host)
    name = str(host.get("name") or host.get("host") or "").lower()
    groups = " ".join(group.get("name", "") for group in host.get("groups") or [])
    templates = " ".join(template.get("name") or template.get("host", "") for template in host.get("parentTemplates") or [])
    group_norm = norm(groups)
    tag_pairs = {str(tag.get("tag", "")).strip().lower(): str(tag.get("value", "")).strip().lower() for tag in host.get("tags") or [] if isinstance(tag, dict)}
    inventory_text = text_for_host({"host": "", "name": "", "groups": [], "parentTemplates": [], "tags": [], "inventory": host.get("inventory") or {}})
    if name == "zabbix server":
        return "zabbix_server"
    if any(word in text for word in ["proxmox", " pve", "proxmox ve"]):
        return "proxmox"
    if any(word in text for word in ["srvbackup", "srvcopias", "backup", "veeam", "pbs"]):
        return "backup_server"
    if any(word in text for word in ["nas", "qnap"]):
        return "nas"
    if any(word in text for word in ["sai", "ups", "eaton"]):
        return "ups"
    if any(word in text for word in ["impresora", "printer", "laserjet", "brother", "canon", "zebra"]):
        return "printer"
    if "firewall" in group_norm or "firewalls" in group_norm or "redperimetral" in group_norm:
        return "firewall"
    if tag_pairs.get("role") == "firewall" or tag_pairs.get("type") == "firewall":
        return "firewall"
    if "firewall" in inventory_text or any(keyword.replace(" ", "") in text.replace(" ", "") for keyword in FIREWALL_KEYWORDS):
        return "firewall"
    if any(word in text for word in ["switch", "hp v", "cisco", "router"]):
        return "network"
    if " ap" in f" {text}" or "access point" in text:
        return "ap"
    if any(word in text for word in ["windows", "linux", "server", "servidores", "active", "srv"]):
        return "server"
    return "unknown"


def infer_location(host: dict[str, Any]) -> str:
    text = text_for_host(host).upper()
    for location in ["ALMERIA", "GALLARZA", "CALAHORRA", "RAMIRO", "GENOMICA"]:
        if location in text:
            return location.title()
    return ""


def item_category(item: dict[str, Any]) -> set[str]:
    text = f"{item.get('name', '')} {item.get('key_', '')} {item.get('snmp_oid', '')}".lower()
    item_type = str(item.get("type", ""))
    categories: set[str] = set()
    if item_type in {"0", "7"} or "agent.ping" in text:
        categories.add("agent")
    if item_type in {"1", "4", "6", "20"} or item.get("snmp_oid"):
        categories.add("snmp")
    if item_type == "5" or text.startswith("zabbix[") or "zabbix[" in text:
        categories.add("zabbix_internal")
    if any(word in text for word in ["cpu", "processor", "load"]):
        categories.add("cpu")
    if any(word in text for word in ["memory", "mem", "vm.memory"]):
        categories.add("memory")
    if any(word in text for word in ["vfs.fs", "filesystem", "disk space", "free size", "volume"]):
        categories.add("filesystem")
    if any(word in text for word in ["storage", "datastore", "pool", "zfs", "ceph"]):
        categories.add("storage")
    if any(word in text for word in ["smart", "hdd", "ssd", "disk", "temperature"]):
        categories.update({"smart", "temperature"})
    if any(word in text for word in ["raid", "array"]):
        categories.add("raid")
    if any(word in text for word in ["backup", "veeam", "pbs", "vzdump", "borg", "restic", "rsync", "copia"]):
        categories.add("backup")
    if any(word in text for word in ["proxmox", "pve", "cluster", "node"]):
        categories.update({"api", "node"})
    if any(word in text for word in ["vm", "guest", "virtual machine"]):
        categories.add("vm_inventory")
    if any(word in text for word in ["service.info", "proc.num", "systemd", "service"]):
        categories.add("service")
    if any(word in text for word in ["battery", "runtime", "ups", "input voltage", "output voltage", "load"]):
        categories.update({"battery", "runtime", "input_output", "load"})
    if "self-test" in text or "self test" in text:
        categories.add("self_test")
    if any(word in text for word in ["ifoperstatus", "net.if", "interface", "port"]):
        categories.add("interface")
    if any(word in text for word in ["error", "crc", "discard"]):
        categories.add("errors")
    if any(word in text for word in ["firmware"]):
        categories.add("firmware")
    if any(word in text for word in ["supply", "toner", "marker", "page", "counter", "printer error"]):
        categories.update({"supplies", "page_counter", "error_state"})
    if any(word in text for word in ["web", "http", "nginx", "ssl", "certificate", "cert"]):
        categories.add("web")
    if any(word in text for word in ["mysql", "mariadb", "postgres", "database", "db.odbc"]):
        categories.add("database")
    if "queue" in text:
        categories.add("queue")
    return categories


def summarize_interface(interface: dict[str, Any]) -> dict[str, Any]:
    return zbx.summarize_interface(interface) or {}


def host_priority(asset_type: str, active_problems: list[dict[str, Any]], unsupported: list[dict[str, Any]], missing: list[str]) -> str:
    severities = [zbx.SEVERITIES.get(str(problem.get("severity")), str(problem.get("severity"))) for problem in active_problems]
    if any(severity in {"Disaster", "High"} for severity in severities):
        return "CRITICO"
    if asset_type in {"zabbix_server", "proxmox", "nas", "backup_server", "firewall"} and (unsupported or missing):
        return "ALTO"
    if asset_type in {"ups", "network", "physical_server", "server"} and (unsupported or missing):
        return "ALTO"
    if asset_type in {"printer", "ap"} and (unsupported or missing):
        return "MEDIO"
    if unsupported or missing:
        return "MEDIO"
    return "BAJO"


def criticality(asset_type: str, priority: str) -> str:
    if priority == "CRITICO":
        return "critica"
    if asset_type in {"zabbix_server", "proxmox", "nas", "backup_server", "firewall"}:
        return "alta"
    if asset_type in {"ups", "network", "server", "physical_server"}:
        return "media-alta"
    if asset_type in {"printer", "ap"}:
        return "media"
    return "baja"


def coverage_recommendation(asset_type: str, missing: list[str], unsupported: list[dict[str, Any]], active_problems: list[dict[str, Any]]) -> str:
    if active_problems and any(str(problem.get("severity")) in {"4", "5"} for problem in active_problems):
        return "Priorizar investigacion operativa de problemas High/Disaster antes de limpieza de cobertura."
    if missing:
        return "Completar checks faltantes: " + ", ".join(missing[:8])
    if unsupported:
        return "Resolver unsupported relevantes para recuperar confianza de alertas."
    if asset_type == "printer":
        return "Mantener monitorizacion basica SNMP y revisar obsolescencia periodicamente."
    return "Cobertura base razonable; normalizar documentacion y politica de alertas."


def gap_description(asset_type: str, check: str) -> str:
    descriptions = {
        "backup": "No hay evidencia directa suficiente de control de backup.",
        "smart": "No hay evidencia suficiente de SMART/discos.",
        "raid": "No hay evidencia suficiente de RAID o estado de array.",
        "vm_inventory": "No hay inventario comparado de VMs/containers.",
        "api": "No hay evidencia suficiente de API/endpoint especifico.",
        "self_test": "No hay evidencia de autotest del SAI.",
        "supplies": "No hay evidencia completa de consumibles.",
        "firewall": "Firewall detectado, pero faltan métricas SNMP/plantillas/triggers para evaluación completa.",
        "traffic": "No hay evidencia suficiente de tráfico de interfaz o throughput.",
        "wan": "No hay evidencia suficiente de WAN primaria o estado de enlace exterior.",
        "lan": "No hay evidencia suficiente de LAN interna o interfaces relevantes.",
        "uptime": "No hay evidencia suficiente de uptime/arranque.",
        "ha": "No hay evidencia suficiente de HA/failover del firewall.",
    }
    return descriptions.get(check, f"Falta cobertura esperada para {asset_type}: {check}.")


def build_host_entries(zdata: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    now = int(time.time())
    host_by_id = {str(host.get("hostid")): host for host in zdata["hosts"]}
    items_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unsupported_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in zdata["items"]:
        hostid = str(item.get("hostid"))
        items_by_host[hostid].append(item)
        if str(item.get("status")) == "0" and str(item.get("state")) == "1":
            unsupported_by_host[hostid].append(item)

    trigger_by_id = {str(trigger.get("triggerid")): trigger for trigger in zdata["triggers"]}
    problems_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for problem in zdata["problems"]:
        trigger = trigger_by_id.get(str(problem.get("objectid")))
        if not trigger:
            continue
        for host in trigger.get("hosts") or []:
            problems_by_host[str(host.get("hostid"))].append(problem)

    entries: list[dict[str, Any]] = []
    gap_rows: list[dict[str, Any]] = []
    for host in zdata["hosts"]:
        hostid = str(host.get("hostid"))
        asset_type = infer_asset_type(host)
        all_categories: set[str] = set()
        enabled_items = [item for item in items_by_host[hostid] if str(item.get("status")) == "0"]
        for item in enabled_items:
            all_categories.update(item_category(item))
        requirements = ASSET_REQUIREMENTS.get(asset_type, ASSET_REQUIREMENTS["unknown"])
        missing = [check for check in requirements if check not in all_categories]
        unsupported = unsupported_by_host.get(hostid, [])
        active_problems = problems_by_host.get(hostid, [])
        priority = host_priority(asset_type, active_problems, unsupported, missing)
        problem_summary = []
        for problem in active_problems:
            severity = zbx.SEVERITIES.get(str(problem.get("severity")), str(problem.get("severity")))
            problem_summary.append(
                {
                    "eventid": problem.get("eventid"),
                    "name": problem.get("name"),
                    "severity": severity,
                    "clock": zbx.to_int(problem.get("clock")),
                    "clock_text": zbx.format_ts(problem.get("clock")),
                    "duration": zbx.age_text(problem.get("clock"), now),
                    "operational_data": problem.get("opdata", ""),
                    "tags": problem.get("tags") or [],
                }
            )
        problem_summary.sort(key=lambda p: (-SEVERITY_ORDER.get(str(p.get("severity")), 0), p.get("clock", 0)))
        unsupported_summary = [
            {
                "itemid": item.get("itemid"),
                "name": item.get("name"),
                "key": item.get("key_"),
                "type": zbx.ITEM_TYPES.get(str(item.get("type", "")), str(item.get("type", ""))),
                "error": item.get("error", ""),
                "lastclock": zbx.to_int(item.get("lastclock")),
                "lastclock_text": zbx.format_ts(item.get("lastclock")),
            }
            for item in unsupported[:25]
        ]
        host_entry = {
            "hostid": host.get("hostid"),
            "host": host.get("host"),
            "name": host.get("name"),
            "status": "enabled" if str(host.get("status")) == "0" else "disabled",
            "asset_type": asset_type,
            "ip_dns": [
                {
                    "type": zbx.INTERFACE_TYPES.get(str(iface.get("type")), str(iface.get("type"))),
                    "ip": iface.get("ip", ""),
                    "dns": iface.get("dns", ""),
                    "port": iface.get("port", ""),
                    "available": zbx.AVAILABILITY.get(str(iface.get("available")), str(iface.get("available"))),
                }
                for iface in host.get("interfaces") or []
            ],
            "location": infer_location(host),
            "criticality_inferred": criticality(asset_type, priority),
            "monitoring_methods": sorted(
                {
                    zbx.INTERFACE_TYPES.get(str(iface.get("type")), str(iface.get("type")))
                    for iface in host.get("interfaces") or []
                }
                | {category for category in all_categories if category in {"agent", "snmp", "zabbix_internal", "api", "web"}}
            ),
            "templates": [template.get("name") or template.get("host") for template in host.get("parentTemplates") or []],
            "groups": [group.get("name") for group in host.get("groups") or []],
            "active_problems": problem_summary,
            "unsupported_relevant": unsupported_summary,
            "checks_existing": sorted(all_categories),
            "checks_missing": missing,
            "coverage_recommendation": coverage_recommendation(asset_type, missing, unsupported, active_problems),
            "priority": priority,
            "requires_human_action": priority in {"CRITICO", "ALTO"} or any(
                check in {"backup", "smart", "raid", "self_test", "vm_inventory"} for check in missing
            ),
            "can_automate": priority not in {"CRITICO"} and not any(check in {"smart", "raid", "backup"} for check in missing),
        }
        entries.append(host_entry)
        for check in missing:
            gap_rows.append(
                {
                    "hostid": host.get("hostid"),
                    "host": host.get("name") or host.get("host"),
                    "asset_type": asset_type,
                    "missing_check": check,
                    "description": gap_description(asset_type, check),
                    "priority": priority,
                    "requires_human_action": host_entry["requires_human_action"],
                    "can_automate": host_entry["can_automate"],
                }
            )
    entries.sort(key=lambda item: ({"CRITICO": 0, "ALTO": 1, "MEDIO": 2, "BAJO": 3}.get(item["priority"], 9), item["name"] or item["host"]))
    return entries, {"gap_rows": gap_rows, "host_by_id": host_by_id}


def build_monitoring_gaps(host_entries: list[dict[str, Any]], external: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    by_priority = Counter(entry["priority"] for entry in host_entries)
    by_asset = Counter(entry["asset_type"] for entry in host_entries)
    gaps_by_check = Counter(gap["missing_check"] for gap in external["gap_rows"])
    unsupported_blocks = ((previous.get("unsupported_blocks") or {}).get("summary") or {}).get("blocks", {})
    stale_printers = (previous.get("unsupported_blocks") or {}).get("stale_printers") or []
    remediation = previous.get("remediation") or {}
    return {
        "metadata": {"generated_at": now_text(), "mode": "read-only"},
        "summary": {
            "hosts_total": len(host_entries),
            "hosts_by_priority": dict(sorted(by_priority.items())),
            "hosts_by_asset_type": dict(sorted(by_asset.items())),
            "missing_checks_by_type": dict(sorted(gaps_by_check.items())),
            "unsupported_blocks": unsupported_blocks,
            "stale_printers_total": len(stale_printers),
        },
        "critical_or_high_hosts": [
            entry
            for entry in host_entries
            if entry["priority"] in {"CRITICO", "ALTO"} or any(p["severity"] in {"Disaster", "High"} for p in entry["active_problems"])
        ],
        "gaps": external["gap_rows"],
        "stale_printers": stale_printers,
        "proxmox_gaps": (remediation.get("proxmox") or {}).get("evidence_summary", {}),
        "backup_gaps": (remediation.get("backups") or {}).get("critical_hosts_without_direct_backup_evidence", []),
        "human_confirmation_required": (previous.get("unsupported_blocks") or {}).get("human_confirmation_required_changes")
        or remediation.get("human_confirmation_required_changes")
        or [],
    }


def build_infrastructure_summary(zdata: dict[str, Any], host_entries: list[dict[str, Any]], gaps: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    active_by_severity = Counter()
    for entry in host_entries:
        for problem in entry["active_problems"]:
            active_by_severity[problem["severity"]] += 1
    unsupported_total = sum(len(entry["unsupported_relevant"]) for entry in host_entries)
    return {
        "metadata": {
            "generated_at": now_text(),
            "generated_epoch": int(time.time()),
            "api_endpoint": zdata["api_endpoint"],
            "zabbix_version": zdata["version"],
            "mode": "read-only",
            "source_files": {
                "coverage": str(COVERAGE_JSON),
                "remediation": str(REMEDIATION_JSON),
                "unsupported_blocks": str(UNSUPPORTED_BLOCKS_JSON),
                "snmp_diagnostics": str(SNMP_JSON),
                "zabbix_get_diagnostics": str(ZABBIX_GET_JSON),
            },
        },
        "summary": {
            "hosts_total": len(host_entries),
            "templates_total": len(zdata["templates"]),
            "items_total": len(zdata["items"]),
            "triggers_total": len(zdata["triggers"]),
            "active_problems_by_severity": dict(sorted(active_by_severity.items())),
            "unsupported_enabled_total": unsupported_total,
            "hosts_requiring_human_action": sum(1 for entry in host_entries if entry["requires_human_action"]),
            "hosts_can_automate": sum(1 for entry in host_entries if entry["can_automate"]),
            "agent_readiness": "partial",
        },
        "hosts": host_entries,
        "monitoring_gaps_summary": gaps["summary"],
        "external_diagnostics_summary": {
            "snmp": (previous.get("snmp") or {}).get("summary", {}),
            "zabbix_get": (previous.get("zabbix_get") or {}).get("summary", {}),
        },
        "api_errors": zdata["api_errors"],
    }


def render_infra_md(infra: dict[str, Any]) -> str:
    lines = [
        "# Infrastructure summary for Zabbix agent",
        "",
        f"- Generado: {infra['metadata']['generated_at']}",
        f"- Zabbix version: `{infra['metadata']['zabbix_version']}`",
        f"- Hosts: `{infra['summary']['hosts_total']}`",
        f"- Templates: `{infra['summary']['templates_total']}`",
        f"- Agent readiness: `{infra['summary']['agent_readiness']}`",
        "",
        "## Hosts prioritarios",
    ]
    rows = []
    for entry in infra["hosts"][:25]:
        rows.append(
            [
                entry["name"] or entry["host"],
                entry["asset_type"],
                entry["priority"],
                entry["criticality_inferred"],
                len(entry["active_problems"]),
                len(entry["unsupported_relevant"]),
                ", ".join(entry["checks_missing"][:6]),
            ]
        )
    lines.append(zbx.md_table(["Host", "Tipo", "Prioridad", "Criticidad", "Problemas", "Unsupported", "Faltan"], rows))
    return "\n".join(lines) + "\n"


def render_external_md(previous: dict[str, Any]) -> str:
    snmp = previous.get("snmp") or {}
    zget = previous.get("zabbix_get") or {}
    lines = [
        "# Diagnostico externo read-only",
        "",
        "Resumen consolidado de pruebas externas read-only. No se han aplicado cambios en Zabbix ni en los dispositivos.",
        "",
        "## SNMP externo",
    ]
    if snmp:
        summary = snmp.get("summary") or {}
        lines.extend(
            [
                f"- Targets diagnosticados: `{summary.get('targets_total', 0)}`",
                f"- SNMP reachable: `{summary.get('snmp_reachable', 0)}`",
                f"- SNMP not reachable: `{summary.get('snmp_not_reachable', 0)}`",
                "",
            ]
        )
        rows = []
        for result in snmp.get("diagnostics") or []:
            host = result.get("host") or {}
            rows.append(
                [
                    host.get("name") or host.get("host"),
                    result.get("snmp_target") or "",
                    "OK" if (result.get("probes") or {}).get("sysDescr", {}).get("ok") else "FAIL",
                    result.get("conclusion"),
                    result.get("recommendation"),
                ]
            )
        lines.append(zbx.md_table(["Host", "Target", "SNMP", "Conclusion", "Recomendacion"], rows))
    else:
        lines.append("_No existe diagnostico SNMP externo todavia._\n")

    lines.append("## zabbix_get local")
    if zget:
        summary = zget.get("summary") or {}
        lines.extend(
            [
                f"- Checks OK: `{summary.get('checks_ok', 0)}/{summary.get('checks_total', 0)}`",
                f"- Target: `{(zget.get('target') or {}).get('server')}:{(zget.get('target') or {}).get('port')}`",
                "",
            ]
        )
        rows = []
        for check in zget.get("checks") or []:
            result = check.get("result") or {}
            rows.append([check.get("key"), "OK" if result.get("ok") else "FAIL", result.get("stdout_sample") or result.get("stderr") or ""])
        lines.append(zbx.md_table(["Key", "Estado", "Salida"], rows))
    else:
        lines.append("_No existe diagnostico zabbix_get local todavia._\n")
    return "\n".join(lines) + "\n"


def render_readiness_md(infra: dict[str, Any], gaps: dict[str, Any], previous: dict[str, Any]) -> str:
    high_hosts = [entry for entry in infra["hosts"] if entry["priority"] in {"CRITICO", "ALTO"}]
    lines = [
        "# Agent readiness report",
        "",
        "## Resumen ejecutivo",
        "",
        "Zabbix ya contiene inventario, problemas activos, templates, items, triggers, unsupported y datos de disponibilidad suficientes para una primera version del agente. La preparacion es parcial: faltan normalizar tipos de activo, criticidad, cobertura de backup/Proxmox/NAS/SAI y distinguir ruido de alertas reales de forma sistematica.",
        "",
        "## Que necesita Zabbix para que el agente sea util",
        "",
        "- Inventario consistente por tipo de activo, ubicacion y criticidad.",
        "- Checks base por dominio: Proxmox, NAS, backups, SAIs, red, firewalls, servidores, impresoras y servicios.",
        "- Alertas con severidad alineada a impacto operativo.",
        "- Evidencia de backup y storage que permita decidir si hay riesgo de perdida de datos.",
        "- Datos historicos recientes y unsupported reducidos para no confundir fallos reales con ruido.",
        "",
        "## Datos ya disponibles",
        "",
        f"- Hosts conocidos: `{infra['summary']['hosts_total']}`.",
        f"- Templates conocidos: `{infra['summary']['templates_total']}`.",
        f"- Problemas activos por severidad: `{infra['summary']['active_problems_by_severity']}`.",
        f"- Unsupported enabled en base de conocimiento: `{infra['summary']['unsupported_enabled_total']}`.",
        f"- Diagnostico SNMP externo: `{(previous.get('snmp') or {}).get('summary', {})}`.",
        f"- Diagnostico zabbix_get local: `{(previous.get('zabbix_get') or {}).get('summary', {})}`.",
        "",
        "## Datos que faltan",
        "",
    ]
    missing_rows = Counter(gap["missing_check"] for gap in gaps["gaps"])
    lines.append(zbx.md_table(["Check faltante", "Hosts"], [[name, count] for name, count in sorted(missing_rows.items())]))
    lines.extend(
        [
            "## Templates/checks faltantes",
            "",
            "- Proxmox: comparar inventario real de nodos, VMs/CTs, datastores, PBS, backups y SMART contra Zabbix.",
            "- NAS: SMART/RAID/pools/volumenes normalizados y acciones operativas para fallos fisicos.",
            "- SAIs: plantilla ajustada por modelo Eaton y OIDs realmente soportadas.",
            "- Impresoras: perfil por fabricante/modelo y decision de mantenimiento/retirada para equipos sin datos.",
        "- Firewalls / Red perimetral: interfaces, errores, VPN, HA, CPU/RAM, firmware y backup de configuracion.",
            "- Servidores: backup, servicios criticos, certificados, bases de datos y hardware fisico si aplica.",
            "",
            "## Alertas que hay que disenar",
            "",
            "- High/Disaster para perdida de datos: SMART abnormal, RAID degraded, pool lleno, backup fallido repetido, datastore critico.",
            "- Average para degradacion: UPS en bateria, servicios criticos caidos, alta carga sostenida, filesystem alto.",
            "- Warning/Information para mantenimiento: impresoras sin toner, firmware, reinicios, cambios de inventario.",
            "",
            "## Automatizable",
            "",
            "- Regenerar informes y JSON de conocimiento.",
            "- Crear templates nuevos no asignados.",
            "- Preparar checks auxiliares en modo no vinculado.",
            "- Detectar hosts sin cobertura esperada y abrir propuestas de cambio.",
            "",
            "## Requiere intervencion humana",
            "",
            "- SMART, discos, RAID, pools, storage y backups.",
            "- Cambios sobre templates ya usados, triggers, acciones y notificaciones.",
            "- Deshabilitar/borrar items o hosts.",
            "- Cambiar macros SNMP o credenciales.",
            "- Decidir retirada o mantenimiento de impresoras.",
            "",
            "## Hosts prioritarios",
            "",
        ]
    )
    lines.append(
        zbx.md_table(
            ["Host", "Tipo", "Prioridad", "Problemas", "Unsupported", "Faltan"],
            [
                [
                    entry["name"] or entry["host"],
                    entry["asset_type"],
                    entry["priority"],
                    len(entry["active_problems"]),
                    len(entry["unsupported_relevant"]),
                    ", ".join(entry["checks_missing"][:5]),
                ]
                for entry in high_hosts[:30]
            ],
        )
    )
    return "\n".join(lines) + "\n"


def render_roadmap_md() -> str:
    phases = [
        ("Fase 5A: Proxmox, storage y backups", "Comparar Zabbix contra Proxmox/PBS, cerrar huecos de VMs, datastores, snapshots, backups y SMART de nodos."),
        ("Fase 5B: NAS, SMART y RAID", "Normalizar QNAP/NAS, validar NasAlmeria HDD 5, pools, volumenes, RAID y temperatura."),
        ("Fase 5C: SAIs/UPS", "Ajustar templates Eaton por modelo/MIB, conservar solo OIDs soportadas y definir severidades de bateria/carga/autotest."),
        ("Fase 5D: Firewalls / Red perimetral y switches", "Inventario de red, interfaces, errores, VPN/HA si aplica, firmware y backup de configuracion."),
        ("Fase 5E: impresoras", "Clasificar impresoras activas, retiradas o sin SNMP; plantilla por modelo y alertas de consumibles."),
        ("Fase 5F: servidores fisicos", "Agente, filesystem, servicios, hardware, RAID, SMART, backups y actualizaciones."),
        ("Fase 5G: servicios de aplicacion", "HTTP, certificados, bases de datos, procesos, logs y dependencias de negocio."),
        ("Fase 5H: politica de alertas y notificaciones", "Severidades, ventanas, escalados, grupos notificables y reduccion de ruido."),
        ("Fase 5I: agente diario inteligente sobre Zabbix", "Generador diario de estado, riesgos, huecos, recomendaciones y propuestas de cambio."),
    ]
    lines = ["# Monitoring implementation roadmap", ""]
    for title, text in phases:
        lines.extend([f"## {title}", "", text, ""])
    return "\n".join(lines)


def render_alert_policy_md() -> str:
    return """# Politica inicial de alertas Zabbix

Esta politica es un borrador para que el futuro agente priorice alertas sin silenciarlas automaticamente.

## Disaster

- NAS/SMART/RAID: RAID failed, volumen inaccesible, pool critico sin margen, multiples discos con SMART abnormal.
- Proxmox/storage: cluster sin quorum, datastore critico, nodo productivo caido con VMs criticas.
- Backups: backups criticos ausentes durante varios ciclos con riesgo de perdida de datos.
- Firewalls: firewall principal caido, HA caida total, perdida de conectividad WAN critica.
- Bases de datos/servicios: base de datos principal caida, servicio core indisponible.

## High

- NAS/SMART/RAID: un disco con SMART abnormal, RAID degraded, pool al 0% o por debajo de umbral critico.
- Proxmox: API no disponible, nodo caido, storage sin espacio, PBS inaccesible.
- Backups: ultimo backup fallido en sistemas criticos o repositorio sin espacio.
- SAIs: equipo en bateria prolongada, bateria degradada, runtime bajo.
- Servidores fisicos: RAID degradado, disco fisico con fallo predictivo, filesystem critico.
- Certificados: certificado critico vencido o a menos de 3 dias.

## Average

- Servicios importantes caidos pero con alternativa o bajo impacto inmediato.
- CPU/RAM/disco alto sostenido.
- UPS con carga alta, temperatura anomala o autotest fallido no critico.
- Firewall/VPN degradado pero no caido.
- Impresora critica sin respuesta SNMP durante horario laboral.

## Warning

- Consumibles de impresora bajos.
- Latencia, errores de interfaz o reinicios no criticos.
- Certificados con vencimiento proximo.
- Backups con retraso leve en sistemas no criticos.

## Information

- Cambios de inventario, reinicios esperados, nuevas VMs/hosts descubiertos.
- Versiones de firmware o paquetes pendientes de revisar.
- Alertas de documentacion o normalizacion.
"""


def render_daily_prompt_md() -> str:
    return """# Prompt base para agente diario sobre Zabbix

Eres el agente diario de monitorizacion. Zabbix es la fuente central de verdad.

## Entradas

- Lee `agent_knowledge/infrastructure_summary.json`.
- Lee `agent_knowledge/monitoring_gaps.json`.
- Lee los informes en `reports/` cuando necesites contexto historico.
- Nunca imprimas tokens, comunidades SNMP ni secretos.

## Prioridad de analisis

1. Problemas Disaster y High activos.
2. Riesgos de perdida de datos: SMART, RAID, pools, datastores, backups.
3. Infraestructura base: Zabbix server, Proxmox, NAS, firewalls, SAIs, backups.
4. Hosts con unsupported que bloquean alertas importantes.
5. Hosts sin datos recientes o cobertura incompleta.
6. Ruido tecnico y limpieza documental.

## Como distinguir critico de ruido

- Critico: hay valor reciente, trigger coherente y posible impacto real en datos, disponibilidad o seguridad.
- Ruido: item unsupported por proceso no usado, OID inexistente en modelo concreto, impresora retirada o check no aplicable.
- Duda: deja evidencia, pide confirmacion humana y no propongas silenciar como primera solucion.

## Informe diario

Incluye resumen ejecutivo, alertas criticas, cambios desde ayer, huecos de monitorizacion, recomendaciones priorizadas y acciones que requieren confirmacion humana.

## Nunca hacer sin confirmacion humana

- Borrar o deshabilitar hosts, items, triggers, templates o acciones.
- Cerrar o silenciar problemas.
- Cambiar macros, credenciales o comunidades SNMP.
- Modificar alertas/notificaciones en produccion.
- Tocar SMART, RAID, storage, backups, Proxmox o firewalls.
"""


def main() -> int:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)

    zdata = collect_zabbix()
    previous = {
        "coverage": load_json(COVERAGE_JSON, {}),
        "remediation": load_json(REMEDIATION_JSON, {}),
        "unsupported_blocks": load_json(UNSUPPORTED_BLOCKS_JSON, {}),
        "snmp": load_json(SNMP_JSON, {}),
        "zabbix_get": load_json(ZABBIX_GET_JSON, {}),
    }
    host_entries, external = build_host_entries(zdata)
    gaps = build_monitoring_gaps(host_entries, external, previous)
    infra = build_infrastructure_summary(zdata, host_entries, gaps, previous)

    INFRA_JSON.write_text(json.dumps(infra, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    INFRA_MD.write_text(render_infra_md(infra), encoding="utf-8")
    GAPS_JSON.write_text(json.dumps(gaps, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    ALERT_POLICY_MD.write_text(render_alert_policy_md(), encoding="utf-8")
    DAILY_PROMPT_MD.write_text(render_daily_prompt_md(), encoding="utf-8")
    EXTERNAL_MD.write_text(render_external_md(previous), encoding="utf-8")
    READINESS_MD.write_text(render_readiness_md(infra, gaps, previous), encoding="utf-8")
    ROADMAP_MD.write_text(render_roadmap_md(), encoding="utf-8")

    print(
        "Agent knowledge base written: "
        f"{INFRA_JSON} ({infra['summary']['hosts_total']} hosts, readiness={infra['summary']['agent_readiness']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
