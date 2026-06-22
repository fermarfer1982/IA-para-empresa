#!/usr/bin/env python3
"""Read-only MCP backend for the Zabbix infrastructure agent.

This server intentionally exposes only query tools. It reads Zabbix through
JSON-RPC and local generated artifacts under /opt/zabbix-codex. It does not
call create/update/delete methods and it never prints configured tokens.
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


BASE_DIR = Path("/opt/zabbix-codex")
ENV_FILE = Path("/etc/zabbix-codex/zabbix.env")
PROXMOX_ENV_FILE = Path("/etc/zabbix-codex/proxmox.env")
AUDIT_LOG_FILE = Path("/var/log/zabbix-codex/infra-agent-mcp.log")
API_TIMEOUT_SECONDS = 12
MAX_REPORT_CHARS_DEFAULT = 6000

ARTIFACTS = {
    "global_map": BASE_DIR / "agent_knowledge" / "global_infrastructure_map.json",
    "infrastructure_summary": BASE_DIR / "agent_knowledge" / "infrastructure_summary.json",
    "monitoring_gaps": BASE_DIR / "agent_knowledge" / "monitoring_gaps.json",
    "proxmox_backup_knowledge": BASE_DIR / "agent_knowledge" / "proxmox_backup_knowledge.json",
    "pbs_inventory": BASE_DIR / "backups" / "pbs-real-inventory.json",
    "proxmox_inventory": BASE_DIR / "proxmox" / "proxmox-real-inventory.json",
    "coverage": BASE_DIR / "reports" / "zabbix-coverage-report.json",
    "remediation": BASE_DIR / "reports" / "zabbix-remediation-plan.json",
    "unsupported_blocks": BASE_DIR / "reports" / "unsupported-blocks-summary.json",
    "phase_5a4": BASE_DIR / "reports" / "phase-5a-4-zabbix-technical-hosts.json",
    "proxmox_backup_gap": BASE_DIR / "reports" / "proxmox-backup-gap-analysis.json",
}

REPORTS = {
    "global_readiness": BASE_DIR / "reports" / "global-monitoring-readiness.md",
    "global_roadmap": BASE_DIR / "reports" / "global-monitoring-roadmap.md",
    "proxmox_backup_gap": BASE_DIR / "reports" / "proxmox-backup-gap-analysis.md",
    "agent_readiness": BASE_DIR / "reports" / "agent-readiness-report.md",
    "zabbix_internal": BASE_DIR / "reports" / "unsupported-zabbix-internal.md",
    "nas_qnap": BASE_DIR / "reports" / "unsupported-nas-qnap.md",
    "ups_sai": BASE_DIR / "reports" / "unsupported-eaton-sai.md",
    "printers": BASE_DIR / "reports" / "unsupported-printers-snmp.md",
}

READ_ONLY_ZABBIX_METHODS = {
    "apiinfo.version",
    "event.get",
    "history.get",
    "hostgroup.get",
    "host.get",
    "item.get",
    "problem.get",
    "template.get",
    "trend.get",
    "trigger.get",
}

BLOCKED_ZABBIX_METHODS = {
    "action.create",
    "action.delete",
    "action.update",
    "configuration.import",
    "event.acknowledge",
    "history.push",
    "host.create",
    "host.delete",
    "host.update",
    "host.massadd",
    "host.massremove",
    "host.massupdate",
    "hostgroup.create",
    "hostgroup.delete",
    "hostgroup.update",
    "item.create",
    "item.delete",
    "item.update",
    "maintenance.create",
    "maintenance.delete",
    "maintenance.update",
    "problem.acknowledge",
    "problem.close",
    "script.execute",
    "template.create",
    "template.delete",
    "template.update",
    "trigger.create",
    "trigger.delete",
    "trigger.update",
    "user.update",
}
WRITE_METHOD_RE = re.compile(
    r"\.(?:add|clear|close|copy|create|delete|execute|import|massadd|massremove|massupdate|push|remove|sync|update)$"
)
READ_ONLY_ANNOTATIONS = {"readOnlyHint": True}

SEVERITY_NAMES = {
    "0": "Not classified",
    "1": "Information",
    "2": "Warning",
    "3": "Average",
    "4": "High",
    "5": "Disaster",
}
SEVERITY_VALUES = {value.lower(): key for key, value in SEVERITY_NAMES.items()}


class ToolError(RuntimeError):
    """Raised when a tool cannot complete safely."""


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        line = re.sub(r"^export\s+", "", line)
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def secret_values() -> list[str]:
    values: list[str] = []
    for path in (ENV_FILE, PROXMOX_ENV_FILE):
        try:
            env = load_env(path)
        except PermissionError:
            continue
        for key, value in env.items():
            key_l = key.lower()
            if value and len(value) >= 6 and any(word in key_l for word in ("token", "secret", "pass", "password")):
                values.append(value)
    return values


def mask_secrets(text: str) -> str:
    masked = text
    for value in secret_values():
        masked = masked.replace(value, "***")
    return masked


def write_security_audit(event: dict[str, Any]) -> None:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "server": "zabbix-codex-infra-agent",
        **event,
    }
    try:
        with AUDIT_LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(mask_secrets(json.dumps(record, ensure_ascii=False, sort_keys=True)) + "\n")
    except OSError:
        return


def is_write_capable_zabbix_method(method: str) -> bool:
    return method in BLOCKED_ZABBIX_METHODS or bool(WRITE_METHOD_RE.search(method))


def api_url_from_env(raw_url: str) -> str:
    url = raw_url.rstrip("/")
    if not url:
        raise ToolError("ZABBIX_URL is missing or empty")
    if url.endswith("api_jsonrpc.php"):
        return url
    return f"{url}/api_jsonrpc.php"


def sanitize_url(url: str) -> str:
    parts = urlsplit(url)
    netloc = parts.hostname or ""
    if parts.port is not None:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def tls_context(env: dict[str, str]) -> ssl.SSLContext | None:
    verify = env.get("ZABBIX_VERIFY_TLS", "true").strip().lower()
    if verify in {"0", "false", "no", "off"}:
        return ssl._create_unverified_context()
    return None


class ZabbixClient:
    def __init__(self) -> None:
        env = load_env(ENV_FILE)
        self.url = api_url_from_env(env.get("ZABBIX_URL", ""))
        self.safe_url = sanitize_url(self.url)
        self.token = env.get("ZABBIX_TOKEN", "")
        self.context = tls_context(env)
        if not self.token:
            raise ToolError("ZABBIX_TOKEN is missing or empty")

    def call(self, method: str, params: dict[str, Any] | None = None, auth: bool = True) -> Any:
        if is_write_capable_zabbix_method(method):
            write_security_audit(
                {
                    "event": "blocked_zabbix_api_method",
                    "method": method,
                    "reason": "write_capable_or_explicitly_forbidden",
                    "success": False,
                }
            )
            raise ToolError(f"Blocked write-capable Zabbix API method: {method}")
        if method not in READ_ONLY_ZABBIX_METHODS:
            write_security_audit(
                {
                    "event": "blocked_zabbix_api_method",
                    "method": method,
                    "reason": "not_in_read_only_allowlist",
                    "success": False,
                }
            )
            raise ToolError(f"Blocked non allowlisted Zabbix API method: {method}")

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": 1,
        }
        headers = {
            "Content-Type": "application/json-rpc",
            "User-Agent": "zabbix-codex-mcp-infra-agent/0.1",
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
            with urlopen(request, timeout=API_TIMEOUT_SECONDS, context=self.context) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ToolError(mask_secrets(f"Zabbix HTTP {exc.code}: {body[:500]}")) from exc
        except URLError as exc:
            raise ToolError(mask_secrets(f"Zabbix connection error: {exc.reason}")) from exc
        except TimeoutError as exc:
            raise ToolError(f"Zabbix connection timed out after {API_TIMEOUT_SECONDS}s") from exc

        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ToolError(f"Invalid JSON from Zabbix: {exc}") from exc

        if "error" in data:
            err = data["error"]
            message = err.get("message", "Zabbix JSON-RPC error")
            details = err.get("data", "")
            raise ToolError(mask_secrets(f"{message}: {details}"))
        return data.get("result")


def now_epoch() -> int:
    return int(time.time())


def read_json(path: Path) -> Any:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {"_error": f"Invalid JSON in {path}: {exc}"}


def read_text_excerpt(path: Path, max_chars: int = MAX_REPORT_CHARS_DEFAULT) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n\n[truncated]"


def load_artifacts() -> dict[str, Any]:
    return {name: read_json(path) for name, path in ARTIFACTS.items()}


def load_report_excerpts(names: list[str], max_chars: int = MAX_REPORT_CHARS_DEFAULT) -> dict[str, str]:
    return {name: read_text_excerpt(REPORTS[name], max_chars=max_chars) for name in names if name in REPORTS}


def zabbix_or_error() -> tuple[ZabbixClient | None, str | None]:
    try:
        return ZabbixClient(), None
    except Exception as exc:  # noqa: BLE001 - surfaced as read-only status
        return None, mask_secrets(str(exc))


def severity_filter_value(value: Any) -> str | None:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if text in SEVERITY_NAMES:
        return text
    return SEVERITY_VALUES.get(text.lower())


def live_zabbix_summary() -> dict[str, Any]:
    client, error = zabbix_or_error()
    if error or client is None:
        return {"api_available": False, "error": error}

    try:
        version = client.call("apiinfo.version", auth=False)
        hosts = client.call("host.get", {"output": ["hostid", "host", "name", "status"]})
        problems = client.call(
            "problem.get",
            {
                "output": ["eventid", "objectid", "name", "severity", "clock", "opdata"],
                "sortfield": ["eventid"],
                "sortorder": "DESC",
            },
        )
    except ToolError as exc:
        return {"api_available": False, "url": client.safe_url, "error": str(exc)}

    severity_counts: dict[str, int] = {}
    for problem in problems:
        name = SEVERITY_NAMES.get(str(problem.get("severity")), str(problem.get("severity")))
        severity_counts[name] = severity_counts.get(name, 0) + 1

    return {
        "api_available": True,
        "url": client.safe_url,
        "zabbix_version": version,
        "hosts_total": len(hosts),
        "hosts_enabled": sum(1 for host in hosts if str(host.get("status")) == "0"),
        "active_problems_total": len(problems),
        "active_problems_by_severity": severity_counts,
    }


def live_problem_details(host_contains: str | None = None, severity: Any = None, limit: int = 100) -> dict[str, Any]:
    client, error = zabbix_or_error()
    if error or client is None:
        return {"api_available": False, "error": error, "problems": []}

    params: dict[str, Any] = {
        "output": ["eventid", "objectid", "name", "severity", "clock", "opdata", "acknowledged"],
        "selectTags": "extend",
        "sortfield": ["eventid"],
        "sortorder": "DESC",
    }
    sev = severity_filter_value(severity)
    if sev is not None:
        params["severities"] = [int(sev)]

    try:
        problems = client.call("problem.get", params)
        triggerids = sorted({str(problem.get("objectid")) for problem in problems if problem.get("objectid")})
        triggers_by_id: dict[str, Any] = {}
        if triggerids:
            triggers = client.call(
                "trigger.get",
                {
                    "output": ["triggerid", "description", "priority", "status"],
                    "triggerids": triggerids,
                    "selectHosts": ["hostid", "host", "name"],
                    "selectItems": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock", "error"],
                },
            )
            triggers_by_id = {str(trigger.get("triggerid")): trigger for trigger in triggers}
    except ToolError as exc:
        return {"api_available": False, "url": client.safe_url, "error": str(exc), "problems": []}

    now = now_epoch()
    out = []
    for problem in problems:
        trigger = triggers_by_id.get(str(problem.get("objectid")), {})
        hosts = trigger.get("hosts", []) or []
        host_names = [host.get("name") or host.get("host") for host in hosts]
        if host_contains:
            needle = host_contains.lower()
            haystack = " ".join(str(name or "") for name in host_names).lower()
            if needle not in haystack:
                continue
        clock = int(problem.get("clock") or 0)
        out.append(
            {
                "eventid": problem.get("eventid"),
                "name": problem.get("name"),
                "severity": SEVERITY_NAMES.get(str(problem.get("severity")), str(problem.get("severity"))),
                "clock": clock,
                "age_seconds": now - clock if clock else None,
                "hosts": host_names,
                "trigger": trigger.get("description"),
                "trigger_status": "disabled" if str(trigger.get("status")) == "1" else "enabled",
                "items": [
                    {
                        "itemid": item.get("itemid"),
                        "name": item.get("name"),
                        "key": item.get("key_"),
                        "lastvalue": item.get("lastvalue"),
                        "lastclock": item.get("lastclock"),
                        "error": item.get("error"),
                    }
                    for item in trigger.get("items", []) or []
                ],
                "operational_data": problem.get("opdata", ""),
                "tags": problem.get("tags", []) or [],
                "acknowledged": problem.get("acknowledged"),
            }
        )
        if len(out) >= limit:
            break

    return {"api_available": True, "url": client.safe_url, "problems": out, "count": len(out)}


def global_map_hosts(artifacts: dict[str, Any], host_types: list[str] | None = None) -> list[dict[str, Any]]:
    hosts = artifacts.get("global_map", {}).get("hosts", []) or []
    if host_types:
        wanted = {host_type.lower() for host_type in host_types}
        hosts = [host for host in hosts if str(host.get("probable_type", "")).lower() in wanted]
    return hosts


def compact_host(host: dict[str, Any]) -> dict[str, Any]:
    return {
        "hostid": host.get("hostid"),
        "host": host.get("host"),
        "visible_name": host.get("visible_name"),
        "probable_type": host.get("probable_type"),
        "subtype": host.get("subtype"),
        "groups": host.get("groups", []),
        "templates": host.get("templates", []),
        "interfaces": host.get("ip_dns", host.get("interfaces", [])),
        "monitoring_methods": host.get("monitoring_methods", []),
        "items_active": host.get("items_active", 0),
        "triggers_active": host.get("triggers_active", 0),
        "triggers_disabled": host.get("triggers_disabled", 0),
        "active_problems": host.get("active_problems", []),
        "unsupported_items_count": host.get("unsupported_items_count", 0),
        "last_data_text": host.get("last_data_text"),
        "criticality_inferred": host.get("criticality_inferred"),
        "coverage_current": host.get("coverage_current"),
        "gaps_detected": host.get("gaps_detected", []),
        "priority": host.get("priority"),
        "next_recommendation": host.get("next_recommendation"),
    }


def host_type_summary(artifacts: dict[str, Any], types: list[str]) -> dict[str, Any]:
    hosts = [compact_host(host) for host in global_map_hosts(artifacts, types)]
    return {
        "count": len(hosts),
        "hosts": hosts,
        "unsupported_total": sum(int(host.get("unsupported_items_count") or 0) for host in hosts),
        "active_problem_hosts": [host for host in hosts if host.get("active_problems")],
        "high_priority_hosts": [host for host in hosts if str(host.get("priority", "")).upper() in {"CRITICO", "CRÍTICO", "ALTO"}],
    }


def compact_pbs_datastore(datastore: dict[str, Any]) -> dict[str, Any]:
    status = datastore.get("status") or {}
    total = status.get("total")
    used = status.get("used")
    usage_percent = None
    if total:
        try:
            usage_percent = round((float(used or 0) / float(total)) * 100, 2)
        except (TypeError, ValueError, ZeroDivisionError):
            usage_percent = None
    config = datastore.get("config") or {}
    return {
        "name": datastore.get("name") or datastore.get("store") or config.get("name"),
        "path": datastore.get("path") or config.get("path"),
        "mount_status": datastore.get("mount-status") or (datastore.get("admin") or {}).get("mount-status"),
        "gc_schedule": datastore.get("gc-schedule") or config.get("gc-schedule"),
        "notification_mode": datastore.get("notification-mode") or config.get("notification-mode"),
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": status.get("avail"),
        "usage_percent": usage_percent,
        "groups_count": len(datastore.get("groups") or []),
        "snapshots_count": len(datastore.get("snapshots") or []),
        "endpoint_access": datastore.get("endpoint_access", {}),
    }


def compact_backup_entity(entity: dict[str, Any]) -> dict[str, Any]:
    snapshot = entity.get("snapshot") or {}
    return {
        "identity": entity.get("identity"),
        "id": entity.get("id") or entity.get("backup-id") or entity.get("vmid") or snapshot.get("backup-id"),
        "type": entity.get("type") or entity.get("backup-type") or snapshot.get("backup-type"),
        "comment": entity.get("comment") or snapshot.get("comment"),
        "datastore": entity.get("datastore") or entity.get("store"),
        "last_backup": entity.get("last_backup") or entity.get("last-backup") or entity.get("last_backup_epoch") or snapshot.get("backup-time"),
        "last_backup_text": entity.get("last_backup_text"),
        "snapshot_count": entity.get("snapshot_count") or entity.get("backup-count"),
        "age_hours": entity.get("age_hours") or entity.get("last_backup_age_hours"),
        "protected": entity.get("protected") if "protected" in entity else snapshot.get("protected"),
    }


def live_items_for_hosts(host_names: list[str], key_prefixes: list[str] | None = None) -> dict[str, Any]:
    client, error = zabbix_or_error()
    if error or client is None:
        return {"api_available": False, "error": error, "items": []}
    try:
        hosts = client.call(
            "host.get",
            {
                "output": ["hostid", "host", "name"],
                "filter": {"host": host_names},
            },
        )
        if not hosts:
            hosts = client.call(
                "host.get",
                {
                    "output": ["hostid", "host", "name"],
                    "search": {"name": " ".join(host_names)},
                },
            )
        hostids = [host["hostid"] for host in hosts]
        if not hostids:
            return {"api_available": True, "url": client.safe_url, "hosts": [], "items": []}
        items = client.call(
            "item.get",
            {
                "output": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock", "state", "error", "units"],
                "hostids": hostids,
                "filter": {"status": "0"},
                "sortfield": "key_",
            },
        )
    except ToolError as exc:
        return {"api_available": False, "url": client.safe_url, "error": str(exc), "items": []}

    if key_prefixes:
        prefixes = tuple(key_prefixes)
        items = [item for item in items if str(item.get("key_", "")).startswith(prefixes)]

    host_by_id = {host["hostid"]: host for host in hosts}
    return {
        "api_available": True,
        "url": client.safe_url,
        "hosts": hosts,
        "items": [
            {
                "host": (host_by_id.get(item.get("hostid")) or {}).get("host"),
                "name": item.get("name"),
                "key": item.get("key_"),
                "lastvalue": item.get("lastvalue"),
                "lastclock": item.get("lastclock"),
                "state": item.get("state"),
                "error": item.get("error"),
                "units": item.get("units"),
            }
            for item in items
        ],
    }


def tool_get_infrastructure_overview(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    global_map = artifacts.get("global_map", {})
    return {
        "generated_from": [
            str(ARTIFACTS["global_map"]),
            str(ARTIFACTS["monitoring_gaps"]),
            "Zabbix API read-only summary",
        ],
        "live_zabbix": live_zabbix_summary(),
        "summary": global_map.get("summary", {}),
        "type_counts": global_map.get("type_counts", {}),
        "readiness_scores": global_map.get("block_readiness_scores", {}),
        "worst_prepared_blocks": global_map.get("worst_prepared_blocks", []),
        "agent_should_know": global_map.get("agent_should_know", {}),
    }


def tool_get_active_problems(args: dict[str, Any]) -> dict[str, Any]:
    return {
        "generated_from": ["Zabbix API problem.get/trigger.get read-only"],
        **live_problem_details(
            host_contains=args.get("host_contains") or args.get("host"),
            severity=args.get("severity"),
            limit=int(args.get("limit", 100)),
        ),
    }


def tool_get_critical_risks(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    problems = live_problem_details(severity=None, limit=200)
    high_or_disaster = [
        problem
        for problem in problems.get("problems", [])
        if problem.get("severity") in {"High", "Disaster"}
    ]
    global_map = artifacts.get("global_map", {})
    nas_hosts = host_type_summary(artifacts, ["nas", "qnap", "synology"])["hosts"]
    pbs = artifacts.get("pbs_inventory", {})
    proxmox_gap = artifacts.get("proxmox_backup_gap", {})
    return {
        "generated_from": [
            "Zabbix API active problems",
            str(ARTIFACTS["global_map"]),
            str(ARTIFACTS["pbs_inventory"]),
            str(ARTIFACTS["proxmox_backup_gap"]),
        ],
        "active_high_or_disaster": high_or_disaster,
        "worst_prepared_blocks": global_map.get("worst_prepared_blocks", []),
        "nas_hosts_with_problems_or_unsupported": [
            host for host in nas_hosts if host.get("active_problems") or host.get("unsupported_items_count")
        ],
        "backup_gap_summary": proxmox_gap.get("summary", {}),
        "prioritized_backup_gaps": proxmox_gap.get("prioritized_gaps", [])[:20],
        "pbs_datastores": [compact_pbs_datastore(datastore) for datastore in pbs.get("datastores", [])],
        "risk_note": "Treat SMART/RAID/storage, failed backups, unavailable core nodes and missing backup evidence as human-confirmation risks.",
    }


def tool_get_backup_status(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    pbs = artifacts.get("pbs_inventory", {})
    gap = artifacts.get("proxmox_backup_gap", {})
    knowledge = artifacts.get("proxmox_backup_knowledge", {})
    live_pbs = live_items_for_hosts(["PBS Backup Monitoring"], ["pbs."])
    live_pve = live_items_for_hosts(["Proxmox Storage Monitoring"], ["proxmox.backup."])
    return {
        "generated_from": [
            str(ARTIFACTS["pbs_inventory"]),
            str(ARTIFACTS["proxmox_backup_gap"]),
            str(ARTIFACTS["proxmox_backup_knowledge"]),
            "Zabbix API item.get on technical hosts",
        ],
        "pbs_access": pbs.get("access"),
        "pbs_version": pbs.get("version"),
        "pbs_summary": pbs.get("summary", {}),
        "pbs_datastores": [compact_pbs_datastore(datastore) for datastore in pbs.get("datastores", [])],
        "pbs_backup_entities": [compact_backup_entity(entity) for entity in pbs.get("backup_entities", [])],
        "gap_summary": gap.get("summary", {}),
        "prioritized_gaps": gap.get("prioritized_gaps", [])[:30],
        "knowledge_summary": knowledge.get("summary", {}),
        "live_pbs_items": live_pbs,
        "live_proxmox_backup_items": live_pve,
    }


def tool_get_proxmox_status(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    proxmox = artifacts.get("proxmox_inventory", {})
    gap = artifacts.get("proxmox_backup_gap", {})
    live_storage = live_items_for_hosts(["Proxmox Storage Monitoring"], ["proxmox.storage.", "proxmox.backup."])
    return {
        "generated_from": [
            str(ARTIFACTS["proxmox_inventory"]),
            str(ARTIFACTS["proxmox_backup_gap"]),
            "Zabbix API item.get on Proxmox Storage Monitoring",
        ],
        "proxmox_access": proxmox.get("access"),
        "version": proxmox.get("version"),
        "cluster": proxmox.get("cluster", {}),
        "nodes": proxmox.get("nodes", []),
        "qemu_vms": proxmox.get("qemu_vms", []),
        "lxc_containers": proxmox.get("lxc_containers", []),
        "storages": proxmox.get("storages", []),
        "backup_jobs": proxmox.get("backup_jobs", []),
        "recent_backup_tasks": proxmox.get("recent_backup_tasks", []),
        "comparison": gap.get("comparison", {}),
        "live_storage_items": live_storage,
    }


def tool_get_nas_status(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    return {
        "generated_from": [str(ARTIFACTS["global_map"]), str(REPORTS["nas_qnap"]), "Zabbix API active problems"],
        "hosts": host_type_summary(artifacts, ["nas", "qnap", "synology"]),
        "active_problems": live_problem_details(host_contains=args.get("host_contains"), limit=100),
        "report_excerpt": load_report_excerpts(["nas_qnap"], max_chars=int(args.get("report_chars", 6000))),
    }


def tool_get_ups_status(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    return {
        "generated_from": [str(ARTIFACTS["global_map"]), str(REPORTS["ups_sai"]), "Zabbix API active problems"],
        "hosts": host_type_summary(artifacts, ["ups_sai"]),
        "active_problems": live_problem_details(host_contains=args.get("host_contains"), limit=100),
        "report_excerpt": load_report_excerpts(["ups_sai"], max_chars=int(args.get("report_chars", 6000))),
    }


def tool_get_printer_status(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    printers = host_type_summary(artifacts, ["printer"])
    stale = [
        host for host in printers["hosts"]
        if host.get("last_data_text") in {"never", None} or host.get("gaps_detected")
    ]
    return {
        "generated_from": [str(ARTIFACTS["global_map"]), str(REPORTS["printers"]), "Zabbix API active problems"],
        "hosts": printers,
        "stale_or_gap_hosts": stale,
        "active_problems": live_problem_details(host_contains=args.get("host_contains"), limit=100),
        "report_excerpt": load_report_excerpts(["printers"], max_chars=int(args.get("report_chars", 6000))),
    }


def tool_get_zabbix_internal_health(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    zabbix_hosts = host_type_summary(artifacts, ["zabbix_server"])
    return {
        "generated_from": [str(ARTIFACTS["global_map"]), str(REPORTS["zabbix_internal"]), "Zabbix API summary"],
        "live_zabbix": live_zabbix_summary(),
        "zabbix_server_hosts": zabbix_hosts,
        "report_excerpt": load_report_excerpts(["zabbix_internal"], max_chars=int(args.get("report_chars", 6000))),
    }


def tool_get_monitoring_gaps(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    global_map = artifacts.get("global_map", {})
    return {
        "generated_from": [
            str(ARTIFACTS["monitoring_gaps"]),
            str(REPORTS["global_readiness"]),
            str(REPORTS["global_roadmap"]),
            "Zabbix API read-only summary",
        ],
        "live_zabbix": live_zabbix_summary(),
        "monitoring_gaps": artifacts.get("monitoring_gaps", {}),
        "worst_prepared_blocks": global_map.get("worst_prepared_blocks", []),
        "readiness_scores": global_map.get("block_readiness_scores", {}),
        "report_excerpts": load_report_excerpts(["global_readiness", "global_roadmap"], max_chars=int(args.get("report_chars", 6000))),
    }


def tool_get_global_infrastructure_map(args: dict[str, Any]) -> dict[str, Any]:
    artifacts = load_artifacts()
    global_map = artifacts.get("global_map", {})
    host_type = args.get("host_type")
    include_hosts = bool(args.get("include_hosts", False))
    result = {
        "generated_from": [str(ARTIFACTS["global_map"]), "Zabbix API read-only summary"],
        "live_zabbix": live_zabbix_summary(),
        "metadata": global_map.get("metadata", {}),
        "summary": global_map.get("summary", {}),
        "type_counts": global_map.get("type_counts", {}),
        "readiness_scores": global_map.get("block_readiness_scores", {}),
        "sections": global_map.get("sections", {}),
        "agent_should_know": global_map.get("agent_should_know", {}),
    }
    if include_hosts or host_type:
        types = [host_type] if host_type else None
        result["hosts"] = [compact_host(host) for host in global_map_hosts(artifacts, types)]
    return result


def tool_generate_daily_report(args: dict[str, Any]) -> dict[str, Any]:
    overview = tool_get_infrastructure_overview({})
    risks = tool_get_critical_risks({})
    backups = tool_get_backup_status({})
    gaps = tool_get_monitoring_gaps({"report_chars": 2000})

    lines = [
        "# Informe diario de infraestructura",
        "",
        "## Resumen",
        f"- Zabbix API disponible: {overview.get('live_zabbix', {}).get('api_available')}",
        f"- Hosts en Zabbix: {overview.get('summary', {}).get('hosts_total')}",
        f"- Problemas activos: {overview.get('live_zabbix', {}).get('active_problems_total')}",
        f"- Unsupported items: {overview.get('summary', {}).get('unsupported_items_total')}",
        "",
        "## Riesgos criticos",
    ]
    active_high = risks.get("active_high_or_disaster", [])
    if active_high:
        for problem in active_high:
            hosts = ", ".join(problem.get("hosts", []) or [])
            lines.append(f"- {problem.get('severity')}: {problem.get('name')} ({hosts})")
    else:
        lines.append("- No hay High/Disaster activos segun la consulta actual.")

    lines.extend(
        [
            "",
            "## Backups y Proxmox/PBS",
            f"- PBS accesible en inventario local: {bool((backups.get('pbs_access') or {}).get('available'))}",
            f"- PBS con permisos limitados: {bool((backups.get('pbs_access') or {}).get('permissions_limited'))}",
            f"- Datastores PBS: {len(backups.get('pbs_datastores', []) or [])}",
            f"- Gaps priorizados de backup: {len(backups.get('prioritized_gaps', []) or [])}",
            "",
            "## Bloques peor preparados",
        ]
    )
    for block in gaps.get("worst_prepared_blocks", []):
        lines.append(
            f"- {block.get('block')}: score {block.get('score')} - {block.get('reason')}"
            if isinstance(block, dict)
            else f"- {block}"
        )

    lines.extend(
        [
            "",
            "## Recomendacion operativa",
            "Priorizar riesgos reales de datos y continuidad: NAS/SMART/RAID, backups sin evidencia, SAIs con SNMP parcial y servicios criticos sin checks dedicados.",
            "",
            "## Acciones prohibidas sin confirmacion humana",
            "- Borrar o deshabilitar hosts/items/triggers/templates.",
            "- Cerrar, silenciar o reconocer problemas.",
            "- Modificar Proxmox/PBS, jobs de backup, NAS, switches, firewalls o bases de datos.",
            "- Cambiar acciones de notificacion.",
        ]
    )
    return {
        "generated_from": [
            "get_infrastructure_overview",
            "get_critical_risks",
            "get_backup_status",
            "get_monitoring_gaps",
        ],
        "markdown": "\n".join(lines),
        "structured_summary": {
            "zabbix": overview.get("live_zabbix", {}),
            "type_counts": overview.get("type_counts", {}),
            "readiness_scores": overview.get("readiness_scores", {}),
            "active_high_or_disaster": risks.get("active_high_or_disaster", []),
            "backup_gap_summary": risks.get("backup_gap_summary", {}),
            "worst_prepared_blocks": gaps.get("worst_prepared_blocks", []),
        },
    }


TOOL_HANDLERS = {
    "get_infrastructure_overview": tool_get_infrastructure_overview,
    "get_active_problems": tool_get_active_problems,
    "get_critical_risks": tool_get_critical_risks,
    "get_backup_status": tool_get_backup_status,
    "get_proxmox_status": tool_get_proxmox_status,
    "get_nas_status": tool_get_nas_status,
    "get_ups_status": tool_get_ups_status,
    "get_printer_status": tool_get_printer_status,
    "get_zabbix_internal_health": tool_get_zabbix_internal_health,
    "get_monitoring_gaps": tool_get_monitoring_gaps,
    "get_global_infrastructure_map": tool_get_global_infrastructure_map,
    "generate_daily_report": tool_generate_daily_report,
}


TOOL_SCHEMAS = [
    {
        "name": "get_infrastructure_overview",
        "description": "Consulta read-only el resumen global de infraestructura, tipos detectados, readiness y estado vivo basico de Zabbix.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_active_problems",
        "description": "Lista en modo read-only los problemas activos desde Zabbix API, con filtro opcional por host/severidad.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host_contains": {"type": "string"},
                "severity": {"type": "string", "description": "Disaster, High, Average, Warning, Information or numeric 0-5"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_critical_risks",
        "description": "Consulta riesgos prioritarios combinando problemas High/Disaster, NAS, backups y readiness global; no modifica alertas.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_backup_status",
        "description": "Obtiene en modo read-only el estado PBS/backups desde inventarios locales y metricas tecnicas en Zabbix.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_proxmox_status",
        "description": "Consulta estado Proxmox, VMs, storage, jobs y metricas tecnicas ya disponibles en Zabbix; no llama a Proxmox.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_nas_status",
        "description": "Consulta estado NAS/QNAP/Synology, problemas, unsupported y huecos sin modificar Zabbix.",
        "inputSchema": {"type": "object", "properties": {"host_contains": {"type": "string"}, "report_chars": {"type": "integer"}}, "additionalProperties": False},
    },
    {
        "name": "get_ups_status",
        "description": "Consulta estado SAIs/UPS, SNMP, unsupported y huecos sin modificar Zabbix.",
        "inputSchema": {"type": "object", "properties": {"host_contains": {"type": "string"}, "report_chars": {"type": "integer"}}, "additionalProperties": False},
    },
    {
        "name": "get_printer_status",
        "description": "Consulta estado de impresoras, SNMP, datos antiguos y gaps sin modificar Zabbix.",
        "inputSchema": {"type": "object", "properties": {"host_contains": {"type": "string"}, "report_chars": {"type": "integer"}}, "additionalProperties": False},
    },
    {
        "name": "get_zabbix_internal_health",
        "description": "Obtiene salud interna de Zabbix, unsupported internos y resumen API en modo read-only.",
        "inputSchema": {"type": "object", "properties": {"report_chars": {"type": "integer"}}, "additionalProperties": False},
    },
    {
        "name": "get_monitoring_gaps",
        "description": "Consulta huecos de monitorizacion y roadmap global desde artefactos read-only.",
        "inputSchema": {"type": "object", "properties": {"report_chars": {"type": "integer"}}, "additionalProperties": False},
    },
    {
        "name": "get_global_infrastructure_map",
        "description": "Obtiene el mapa global estructurado; puede incluir hosts completos o filtrar por tipo sin modificar sistemas.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host_type": {"type": "string"},
                "include_hosts": {"type": "boolean", "default": False},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "generate_daily_report",
        "description": "Genera un informe diario en Markdown solo en memoria; no escribe en disco ni modifica sistemas.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]

for schema in TOOL_SCHEMAS:
    schema.setdefault("annotations", {}).update(READ_ONLY_ANNOTATIONS)


def call_tool(name: str, arguments: dict[str, Any] | None = None) -> Any:
    if name not in TOOL_HANDLERS:
        raise ToolError(f"Unknown tool: {name}")
    return TOOL_HANDLERS[name](arguments or {})


def mcp_success(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def mcp_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": mask_secrets(message)}}


def handle_mcp_request(request: dict[str, Any]) -> dict[str, Any] | None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    if request_id is None and method in {"notifications/initialized"}:
        return None

    try:
        if method == "initialize":
            return mcp_success(
                request_id,
                {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": "zabbix-codex-infra-agent", "version": "0.1.0"},
                    "capabilities": {"tools": {}},
                },
            )
        if method == "tools/list":
            return mcp_success(request_id, {"tools": TOOL_SCHEMAS})
        if method == "tools/call":
            name = params.get("name")
            arguments = params.get("arguments") or {}
            result = call_tool(name, arguments)
            return mcp_success(
                request_id,
                {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True),
                        }
                    ]
                },
            )
        return mcp_error(request_id, -32601, f"Method not found: {method}")
    except ToolError as exc:
        return mcp_error(request_id, -32000, str(exc))
    except Exception as exc:  # noqa: BLE001 - MCP must not crash on one tool call
        return mcp_error(request_id, -32603, f"Internal tool error: {exc}")


def serve_stdio() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response = mcp_error(None, -32700, f"Parse error: {exc}")
        else:
            response = handle_mcp_request(request)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only MCP backend for the Zabbix infrastructure agent")
    parser.add_argument("--stdio", action="store_true", help="Run MCP over stdio")
    parser.add_argument("--list-tools", action="store_true", help="Print tool schemas as JSON")
    parser.add_argument("--call", metavar="TOOL", help="Call one tool for local testing")
    parser.add_argument("--args", default="{}", help="JSON arguments for --call")
    parser.add_argument("--self-test", action="store_true", help="Run basic local/API checks")
    args = parser.parse_args()

    if args.stdio:
        return serve_stdio()

    if args.list_tools:
        print(json.dumps({"tools": TOOL_SCHEMAS}, indent=2, ensure_ascii=False))
        return 0

    if args.call:
        arguments = json.loads(args.args)
        result = call_tool(args.call, arguments)
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
        return 0

    if args.self_test:
        result = {
            "tools_defined": len(TOOL_SCHEMAS),
            "global_map_exists": ARTIFACTS["global_map"].exists(),
            "monitoring_gaps_exists": ARTIFACTS["monitoring_gaps"].exists(),
            "zabbix": live_zabbix_summary(),
        }
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
