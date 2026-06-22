#!/usr/bin/env python3
"""Read-only Zabbix monitoring coverage audit.

The script reads ZABBIX_URL and ZABBIX_TOKEN from /etc/zabbix-codex/zabbix.env,
queries the Zabbix API, and writes Markdown plus JSON reports. It never prints
or stores the token.
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
REPORT_MD = Path("/opt/zabbix-codex/reports/zabbix-coverage-report.md")
REPORT_JSON = Path("/opt/zabbix-codex/reports/zabbix-coverage-report.json")
DEFAULT_STALE_AFTER_SECONDS = 24 * 60 * 60
UNSUPPORTED_MANY_THRESHOLD = 10
TIMEOUT_SECONDS = 30

SEVERITIES = {
    "0": "Not classified",
    "1": "Information",
    "2": "Warning",
    "3": "Average",
    "4": "High",
    "5": "Disaster",
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
    "datastore",
]

STORAGE_KEYWORDS = [
    "storage",
    "datastore",
    "ceph",
    "zfs",
    "pool",
    "volume",
    "disk",
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
            "User-Agent": "zabbix-codex-coverage-audit/1.0",
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
    except Exception as exc:  # noqa: BLE001 - audit should continue on partial permissions.
        errors.append({"method": method, "error": str(exc)})
        return default


def to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def is_enabled_host(host: dict[str, Any]) -> bool:
    return str(host.get("status")) == "0"


def is_enabled_item(item: dict[str, Any]) -> bool:
    return str(item.get("status")) == "0"


def is_enabled_trigger(trigger: dict[str, Any]) -> bool:
    return str(trigger.get("status")) == "0"


def is_unsupported_item(item: dict[str, Any]) -> bool:
    return str(item.get("state")) == "1"


def format_ts(timestamp: Any) -> str:
    ts = to_int(timestamp)
    if ts <= 0:
        return "never"
    return datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def human_age(timestamp: Any, now: int) -> str:
    ts = to_int(timestamp)
    if ts <= 0:
        return "never"

    seconds = max(now - ts, 0)
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


def host_label(host: dict[str, Any]) -> str:
    visible = host.get("name") or host.get("host") or host.get("hostid")
    technical = host.get("host")
    if technical and technical != visible:
        return f"{visible} ({technical})"
    return str(visible)


def summarize_interface(interface: dict[str, Any]) -> dict[str, Any]:
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


def compact_host(host: dict[str, Any]) -> dict[str, Any]:
    return {
        "hostid": host.get("hostid"),
        "host": host.get("host"),
        "name": host.get("name"),
        "status": "enabled" if is_enabled_host(host) else "disabled",
    }


def compact_item(item: dict[str, Any], host_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    host = host_by_id.get(str(item.get("hostid")), {})
    return {
        "itemid": item.get("itemid"),
        "hostid": item.get("hostid"),
        "host": host.get("host"),
        "host_name": host.get("name"),
        "name": item.get("name"),
        "key": item.get("key_"),
        "status": "enabled" if is_enabled_item(item) else "disabled",
        "state": "unsupported" if is_unsupported_item(item) else "normal",
        "error": item.get("error", ""),
        "lastclock": to_int(item.get("lastclock")),
        "lastclock_text": format_ts(item.get("lastclock")),
        "delay": item.get("delay", ""),
    }


def compact_trigger(trigger: dict[str, Any], host_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    hosts = trigger.get("hosts") or []
    host_entries = []
    for host in hosts:
        full_host = host_by_id.get(str(host.get("hostid")), host)
        host_entries.append(compact_host(full_host))

    priority = str(trigger.get("priority", "0"))
    return {
        "triggerid": trigger.get("triggerid"),
        "description": trigger.get("description"),
        "status": "enabled" if is_enabled_trigger(trigger) else "disabled",
        "priority": to_int(priority),
        "severity": SEVERITIES.get(priority, priority),
        "value": trigger.get("value"),
        "state": trigger.get("state"),
        "hosts": host_entries,
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
            value = value.replace("|", "\\|").replace("\n", " ")
            safe_row.append(value)
        lines.append("| " + " | ".join(safe_row) + " |")
    return "\n".join(lines) + "\n"


def bullet_list(items: list[str], empty: str = "_Sin datos._") -> str:
    if not items:
        return empty + "\n"
    return "\n".join(f"- {item}" for item in items) + "\n"


def top_counter_rows(counter: Counter[str], limit: int = 20) -> list[list[Any]]:
    return [[name, count] for name, count in counter.most_common(limit)]


def collect_data() -> dict[str, Any]:
    env = load_env(ENV_FILE)
    url = api_url_from_env(env.get("ZABBIX_URL", ""))
    token = env.get("ZABBIX_TOKEN", "")
    if not token:
        raise ValueError("ZABBIX_TOKEN is empty or missing")

    stale_after_seconds = to_int(env.get("ZABBIX_STALE_AFTER_SECONDS"), DEFAULT_STALE_AFTER_SECONDS)
    now = int(time.time())
    api_errors: list[dict[str, str]] = []
    api = ZabbixApi(url, token, tls_context(env))

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
                "available",
                "snmp_available",
                "jmx_available",
                "ipmi_available",
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
    groups = safe_call(
        api,
        "hostgroup.get",
        {"output": ["groupid", "name"], "sortfield": "name"},
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
    proxies = safe_call(api, "proxy.get", {"output": "extend", "sortfield": "name"}, api_errors, [])
    items = safe_call(
        api,
        "item.get",
        {
            "output": [
                "itemid",
                "hostid",
                "name",
                "key_",
                "status",
                "state",
                "lastclock",
                "lastvalue",
                "units",
                "error",
                "delay",
                "value_type",
                "templateid",
                "interfaceid",
            ],
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
                "description",
                "status",
                "priority",
                "value",
                "state",
                "lastchange",
                "error",
            ],
            "selectHosts": ["hostid", "host", "name", "status"],
            "sortfield": "priority",
            "sortorder": "DESC",
        },
        api_errors,
        [],
    )
    problems = safe_call(
        api,
        "problem.get",
        {
            "output": [
                "eventid",
                "source",
                "object",
                "objectid",
                "clock",
                "name",
                "severity",
                "acknowledged",
                "suppressed",
            ],
            "selectTags": "extend",
            "sortfield": "eventid",
            "sortorder": "DESC",
        },
        api_errors,
        [],
    )

    actions = safe_call(
        api,
        "action.get",
        {
            "output": ["actionid", "name", "status", "eventsource"],
            "sortfield": "name",
        },
        api_errors,
        [],
    )
    media_types = safe_call(
        api,
        "mediatype.get",
        {"output": ["mediatypeid", "name", "type", "status"]},
        api_errors,
        [],
    )
    user_groups = safe_call(
        api,
        "usergroup.get",
        {
            "output": ["usrgrpid", "name", "users_status", "gui_access", "debug_mode"],
            "selectUsers": ["userid", "username", "name", "surname"],
            "sortfield": "name",
        },
        api_errors,
        [],
    )
    users = safe_call(
        api,
        "user.get",
        {
            "output": ["userid", "username", "name", "surname", "type"],
            "selectMedias": ["mediaid", "mediatypeid", "active", "severity", "period"],
            "sortfield": "username",
        },
        api_errors,
        [],
    )

    host_by_id = {str(host["hostid"]): host for host in hosts}
    template_by_id = {str(template["templateid"]): template for template in templates}

    enabled_hosts = [host for host in hosts if is_enabled_host(host)]
    disabled_hosts = [host for host in hosts if not is_enabled_host(host)]

    group_host_counts: Counter[str] = Counter()
    group_hosts: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for host in hosts:
        for group in host.get("groups") or []:
            group_name = group.get("name", f"groupid:{group.get('groupid')}")
            group_host_counts[group_name] += 1
            group_hosts[group_name].append(compact_host(host))

    template_usage: Counter[str] = Counter()
    template_hosts: dict[str, list[dict[str, Any]]] = defaultdict(list)
    templates_by_host: dict[str, list[dict[str, str]]] = {}
    for host in hosts:
        host_templates = []
        for template in host.get("parentTemplates") or []:
            template_id = str(template.get("templateid"))
            template_name = (
                template.get("name")
                or template.get("host")
                or template_by_id.get(template_id, {}).get("name")
                or template_by_id.get(template_id, {}).get("host")
                or f"templateid:{template_id}"
            )
            template_usage[template_name] += 1
            template_hosts[template_name].append(compact_host(host))
            host_templates.append(
                {
                    "templateid": template_id,
                    "host": template.get("host"),
                    "name": template_name,
                }
            )
        templates_by_host[str(host["hostid"])] = host_templates

    interfaces_by_host: dict[str, list[dict[str, Any]]] = {}
    interface_counts_by_type: Counter[str] = Counter()
    for host in hosts:
        summarized = [summarize_interface(interface) for interface in host.get("interfaces") or []]
        interfaces_by_host[str(host["hostid"])] = summarized
        for interface in summarized:
            interface_counts_by_type[interface["type"]] += 1

    def interface_availability_for_host(hostid: str, interface_type: str) -> str:
        matching = [
            interface
            for interface in interfaces_by_host.get(hostid, [])
            if interface.get("type") == interface_type
        ]
        if not matching:
            return "not_configured"

        main_interface = next((interface for interface in matching if interface.get("main")), matching[0])
        return str(main_interface.get("available") or "unknown")

    items_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    active_items_by_host: Counter[str] = Counter()
    unsupported_items_by_host: Counter[str] = Counter()
    active_unsupported_items_by_host: Counter[str] = Counter()
    recent_active_items_by_host: Counter[str] = Counter()
    last_item_clock_by_host: dict[str, int] = defaultdict(int)

    for item in items:
        hostid = str(item.get("hostid"))
        items_by_host[hostid].append(item)
        lastclock = to_int(item.get("lastclock"))
        last_item_clock_by_host[hostid] = max(last_item_clock_by_host[hostid], lastclock)

        if is_enabled_item(item):
            active_items_by_host[hostid] += 1
            if lastclock >= now - stale_after_seconds:
                recent_active_items_by_host[hostid] += 1

        if is_unsupported_item(item):
            unsupported_items_by_host[hostid] += 1
            if is_enabled_item(item):
                active_unsupported_items_by_host[hostid] += 1

    triggers_by_host: Counter[str] = Counter()
    enabled_triggers_by_host: Counter[str] = Counter()
    disabled_triggers_by_host: Counter[str] = Counter()
    trigger_by_id: dict[str, dict[str, Any]] = {}
    trigger_hosts: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for trigger in triggers:
        triggerid = str(trigger.get("triggerid"))
        trigger_by_id[triggerid] = trigger
        for host in trigger.get("hosts") or []:
            hostid = str(host.get("hostid"))
            triggers_by_host[hostid] += 1
            trigger_hosts[triggerid].append(host_by_id.get(hostid, host))
            if is_enabled_trigger(trigger):
                enabled_triggers_by_host[hostid] += 1
            else:
                disabled_triggers_by_host[hostid] += 1

    hosts_without_templates = [
        compact_host(host) for host in enabled_hosts if not templates_by_host.get(str(host["hostid"]))
    ]
    hosts_without_interfaces = [
        compact_host(host) for host in enabled_hosts if not interfaces_by_host.get(str(host["hostid"]))
    ]
    hosts_without_agent = [
        compact_host(host)
        for host in enabled_hosts
        if not any(interface["type"] == "agent" for interface in interfaces_by_host.get(str(host["hostid"]), []))
    ]
    hosts_without_snmp = [
        compact_host(host)
        for host in enabled_hosts
        if not any(interface["type"] == "snmp" for interface in interfaces_by_host.get(str(host["hostid"]), []))
    ]
    hosts_without_active_items = [
        compact_host(host) for host in enabled_hosts if active_items_by_host[str(host["hostid"])] == 0
    ]
    hosts_without_triggers = [
        compact_host(host) for host in enabled_hosts if enabled_triggers_by_host[str(host["hostid"])] == 0
    ]
    hosts_with_disabled_triggers = [
        {
            **compact_host(host),
            "disabled_triggers": disabled_triggers_by_host[str(host["hostid"])],
        }
        for host in enabled_hosts
        if disabled_triggers_by_host[str(host["hostid"])] > 0
    ]
    hosts_with_unsupported_items = [
        {
            **compact_host(host),
            "unsupported_items": unsupported_items_by_host[str(host["hostid"])],
            "active_unsupported_items": active_unsupported_items_by_host[str(host["hostid"])],
        }
        for host in enabled_hosts
        if unsupported_items_by_host[str(host["hostid"])] > 0
    ]
    hosts_with_many_unsupported = [
        host
        for host in hosts_with_unsupported_items
        if host["active_unsupported_items"] >= UNSUPPORTED_MANY_THRESHOLD
    ]
    hosts_without_recent_data = [
        {
            **compact_host(host),
            "last_item_clock": last_item_clock_by_host[str(host["hostid"])],
            "last_item_clock_text": format_ts(last_item_clock_by_host[str(host["hostid"])]),
            "last_item_age": human_age(last_item_clock_by_host[str(host["hostid"])], now),
        }
        for host in enabled_hosts
        if active_items_by_host[str(host["hostid"])] > 0
        and recent_active_items_by_host[str(host["hostid"])] == 0
    ]

    enriched_hosts = []
    for host in hosts:
        hostid = str(host["hostid"])
        enriched_hosts.append(
            {
                **compact_host(host),
                "proxyid": host.get("proxyid"),
                "availability": {
                    "agent": interface_availability_for_host(hostid, "agent"),
                    "snmp": interface_availability_for_host(hostid, "snmp"),
                    "jmx": interface_availability_for_host(hostid, "jmx"),
                    "ipmi": interface_availability_for_host(hostid, "ipmi"),
                },
                "groups": host.get("groups") or [],
                "templates": templates_by_host.get(hostid, []),
                "interfaces": interfaces_by_host.get(hostid, []),
                "item_count": len(items_by_host.get(hostid, [])),
                "active_item_count": active_items_by_host[hostid],
                "unsupported_item_count": unsupported_items_by_host[hostid],
                "active_unsupported_item_count": active_unsupported_items_by_host[hostid],
                "trigger_count": triggers_by_host[hostid],
                "enabled_trigger_count": enabled_triggers_by_host[hostid],
                "disabled_trigger_count": disabled_triggers_by_host[hostid],
                "last_item_clock": last_item_clock_by_host[hostid],
                "last_item_clock_text": format_ts(last_item_clock_by_host[hostid]),
            }
        )

    problem_severity_counts: Counter[str] = Counter()
    problems_by_host: Counter[str] = Counter()
    enriched_problems = []

    for problem in problems:
        severity_id = str(problem.get("severity", "0"))
        problem_severity_counts[SEVERITIES.get(severity_id, severity_id)] += 1
        problem_hosts = trigger_hosts.get(str(problem.get("objectid")), [])
        compact_hosts = [compact_host(host) for host in problem_hosts]

        if compact_hosts:
            for host in compact_hosts:
                problems_by_host[host["name"] or host["host"] or host["hostid"]] += 1
        else:
            problems_by_host["(unknown host)"] += 1

        enriched_problems.append(
            {
                "eventid": problem.get("eventid"),
                "objectid": problem.get("objectid"),
                "name": problem.get("name"),
                "severity": SEVERITIES.get(severity_id, severity_id),
                "severity_id": to_int(severity_id),
                "clock": to_int(problem.get("clock")),
                "clock_text": format_ts(problem.get("clock")),
                "age": human_age(problem.get("clock"), now),
                "acknowledged": str(problem.get("acknowledged", "0")) == "1",
                "suppressed": str(problem.get("suppressed", "0")) == "1",
                "hosts": compact_hosts,
                "tags": problem.get("tags") or [],
            }
        )

    problems_oldest = sorted(enriched_problems, key=lambda entry: entry["clock"])[:20]
    problems_recent = sorted(enriched_problems, key=lambda entry: entry["clock"], reverse=True)[:20]

    unsupported_items = [compact_item(item, host_by_id) for item in items if is_unsupported_item(item)]
    active_unsupported_items = [
        compact_item(item, host_by_id)
        for item in items
        if is_unsupported_item(item) and is_enabled_item(item)
    ]

    def build_entity_context(host: dict[str, Any]) -> str:
        hostid = str(host["hostid"])
        parts = [host.get("host", ""), host.get("name", "")]
        parts.extend(group.get("name", "") for group in host.get("groups") or [])
        parts.extend(template.get("name", "") or template.get("host", "") for template in templates_by_host.get(hostid, []))
        parts.extend(item.get("name", "") for item in items_by_host.get(hostid, [])[:200])
        parts.extend(item.get("key_", "") for item in items_by_host.get(hostid, [])[:200])
        return " ".join(parts)

    proxmox_hosts = []
    backup_hosts = []
    for host in hosts:
        context = build_entity_context(host)
        proxmox_match = keyword_matches(context, PROXMOX_KEYWORDS)
        backup_match = keyword_matches(context, BACKUP_KEYWORDS)
        if proxmox_match:
            proxmox_hosts.append({**compact_host(host), "matches": proxmox_match})
        if backup_match:
            backup_hosts.append({**compact_host(host), "matches": backup_match})

    proxmox_groups = [
        {"groupid": group.get("groupid"), "name": group.get("name"), "matches": keyword_matches(group.get("name", ""), PROXMOX_KEYWORDS)}
        for group in groups
        if contains_keyword(group.get("name", ""), PROXMOX_KEYWORDS)
    ]
    proxmox_templates = [
        {
            "templateid": template.get("templateid"),
            "host": template.get("host"),
            "name": template.get("name"),
            "matches": keyword_matches(" ".join([template.get("host", ""), template.get("name", "")]), PROXMOX_KEYWORDS),
            "usage_count": template_usage[template.get("name") or template.get("host")],
        }
        for template in templates
        if contains_keyword(" ".join([template.get("host", ""), template.get("name", "")]), PROXMOX_KEYWORDS)
    ]
    backup_templates = [
        {
            "templateid": template.get("templateid"),
            "host": template.get("host"),
            "name": template.get("name"),
            "matches": keyword_matches(" ".join([template.get("host", ""), template.get("name", "")]), BACKUP_KEYWORDS),
            "usage_count": template_usage[template.get("name") or template.get("host")],
        }
        for template in templates
        if contains_keyword(" ".join([template.get("host", ""), template.get("name", "")]), BACKUP_KEYWORDS)
    ]

    proxmox_items = [
        compact_item(item, host_by_id)
        for item in items
        if contains_keyword(" ".join([item.get("name", ""), item.get("key_", "")]), PROXMOX_KEYWORDS)
    ]
    backup_items = [
        compact_item(item, host_by_id)
        for item in items
        if contains_keyword(" ".join([item.get("name", ""), item.get("key_", "")]), BACKUP_KEYWORDS)
    ]
    storage_items = [
        compact_item(item, host_by_id)
        for item in items
        if contains_keyword(" ".join([item.get("name", ""), item.get("key_", "")]), STORAGE_KEYWORDS)
    ]
    proxmox_triggers = [
        compact_trigger(trigger, host_by_id)
        for trigger in triggers
        if contains_keyword(trigger.get("description", ""), PROXMOX_KEYWORDS)
    ]
    backup_triggers = [
        compact_trigger(trigger, host_by_id)
        for trigger in triggers
        if contains_keyword(trigger.get("description", ""), BACKUP_KEYWORDS)
    ]
    ceph_entities_count = sum(
        1
        for text in (
            [host.get("host", "") + " " + host.get("name", "") for host in hosts]
            + [template.get("host", "") + " " + template.get("name", "") for template in templates]
            + [item.get("name", "") + " " + item.get("key_", "") for item in items]
        )
        if "ceph" in text.lower()
    )

    proxmox_hostids = {str(host["hostid"]) for host in hosts for match in proxmox_hosts if match["hostid"] == host["hostid"]}
    proxmox_hosts_without_templates = [
        compact_host(host)
        for host in hosts
        if str(host["hostid"]) in proxmox_hostids and not templates_by_host.get(str(host["hostid"]))
    ]
    proxmox_hosts_without_active_items = [
        compact_host(host)
        for host in hosts
        if str(host["hostid"]) in proxmox_hostids and active_items_by_host[str(host["hostid"])] == 0
    ]
    proxmox_hosts_without_triggers = [
        compact_host(host)
        for host in hosts
        if str(host["hostid"]) in proxmox_hostids and enabled_triggers_by_host[str(host["hostid"])] == 0
    ]

    zabbix_server_host = next(
        (
            host
            for host in hosts
            if (host.get("host") or "").lower() == "zabbix server"
            or (host.get("name") or "").lower() == "zabbix server"
        ),
        None,
    )
    if zabbix_server_host is None:
        zabbix_server_host = next(
            (
                host
                for host in hosts
                if "zabbix server" in " ".join([host.get("host", ""), host.get("name", "")]).lower()
            ),
            None,
        )

    internal_health: dict[str, Any] = {
        "zabbix_server_host_found": zabbix_server_host is not None,
        "queue_items": [],
        "resource_items": [],
        "unsupported_internal_items": [],
    }
    if zabbix_server_host:
        hostid = str(zabbix_server_host["hostid"])
        host_items = items_by_host.get(hostid, [])
        queue_items = [
            compact_item(item, host_by_id)
            for item in host_items
            if item.get("key_", "").startswith("zabbix[queue")
        ]
        resource_items = [
            {
                **compact_item(item, host_by_id),
                "lastvalue": item.get("lastvalue", ""),
                "units": item.get("units", ""),
            }
            for item in host_items
            if item.get("key_", "").startswith(("system.cpu", "vm.memory", "vfs.fs.size", "system.uptime"))
        ][:50]
        internal_health.update(
            {
                "host": compact_host(zabbix_server_host),
                "status": "enabled" if is_enabled_host(zabbix_server_host) else "disabled",
                "agent_availability": interface_availability_for_host(hostid, "agent"),
                "snmp_availability": interface_availability_for_host(hostid, "snmp"),
                "active_item_count": active_items_by_host[hostid],
                "enabled_trigger_count": enabled_triggers_by_host[hostid],
                "unsupported_item_count": unsupported_items_by_host[hostid],
                "last_item_clock": last_item_clock_by_host[hostid],
                "last_item_clock_text": format_ts(last_item_clock_by_host[hostid]),
                "queue_items": queue_items,
                "resource_items": resource_items,
                "unsupported_internal_items": [
                    compact_item(item, host_by_id) for item in host_items if is_unsupported_item(item)
                ],
            }
        )

    users_with_media = [
        {
            "userid": user.get("userid"),
            "username": user.get("username"),
            "name": user.get("name"),
            "surname": user.get("surname"),
            "active_media_count": sum(1 for media in user.get("medias") or [] if str(media.get("active", "0")) == "0"),
            "media_count": len(user.get("medias") or []),
            "media_types": sorted({media.get("mediatypeid") for media in user.get("medias") or [] if media.get("mediatypeid")}),
        }
        for user in users
        if user.get("medias")
    ]
    notifiable_users = [user for user in users_with_media if user["active_media_count"] > 0]

    risks: list[str] = []
    if hosts_without_templates:
        risks.append(f"{len(hosts_without_templates)} enabled host(s) without templates.")
    if hosts_without_active_items:
        risks.append(f"{len(hosts_without_active_items)} enabled host(s) without active items.")
    if hosts_without_triggers:
        risks.append(f"{len(hosts_without_triggers)} enabled host(s) without enabled triggers.")
    if active_unsupported_items:
        risks.append(f"{len(active_unsupported_items)} enabled unsupported item(s).")
    if problem_severity_counts.get("Disaster", 0) or problem_severity_counts.get("High", 0):
        risks.append(
            f"{problem_severity_counts.get('Disaster', 0)} Disaster and "
            f"{problem_severity_counts.get('High', 0)} High active problem(s)."
        )
    if zabbix_server_host and internal_health.get("agent_availability") != "available":
        risks.append("The Zabbix server host agent availability is not available.")
    if not actions:
        risks.append("No actions were readable or configured, so alert delivery may be incomplete.")
    if not media_types:
        risks.append("No media types were readable or configured.")
    if proxmox_hosts or proxmox_templates or proxmox_groups:
        if not backup_items and not backup_templates:
            risks.append("Proxmox-like entities exist, but backup monitoring evidence is weak or absent.")
        if not storage_items:
            risks.append("Proxmox-like entities exist, but storage/datastore monitoring evidence was not found.")
        if ceph_entities_count == 0:
            risks.append("Proxmox-like entities exist, but no Ceph monitoring evidence was found; verify if Ceph is in use.")
    if api_errors:
        risks.append(f"{len(api_errors)} API method(s) could not be read with current permissions.")

    recommendations = {
        "CRÍTICO": [],
        "ALTO": [],
        "MEDIO": [],
        "BAJO": [],
    }

    if problem_severity_counts.get("Disaster", 0):
        recommendations["CRÍTICO"].append("Review and resolve active Disaster problems before adding new monitoring scope.")
    if hosts_without_active_items:
        recommendations["CRÍTICO"].append("Add working item coverage or disable/decommission enabled hosts with zero active items.")
    if zabbix_server_host and internal_health.get("agent_availability") != "available":
        recommendations["CRÍTICO"].append("Fix Zabbix server self-monitoring agent availability.")

    if problem_severity_counts.get("High", 0):
        recommendations["ALTO"].append("Review active High problems and confirm notification routing.")
    if hosts_without_templates:
        recommendations["ALTO"].append("Assign baseline templates to enabled hosts without templates.")
    if hosts_without_triggers:
        recommendations["ALTO"].append("Add trigger coverage for enabled hosts with items but no enabled triggers.")
    if active_unsupported_items:
        recommendations["ALTO"].append("Fix unsupported enabled items, prioritizing hosts with the largest unsupported counts.")
    if proxmox_hosts_without_templates:
        recommendations["ALTO"].append("Assign Proxmox/PVE-specific templates to Proxmox-like hosts without templates.")

    if hosts_without_recent_data:
        recommendations["MEDIO"].append(
            f"Investigate enabled hosts without item data in the last {stale_after_seconds // 3600} hour(s)."
        )
    if hosts_with_disabled_triggers:
        recommendations["MEDIO"].append("Review disabled triggers and decide whether to re-enable or remove them in a later change phase.")
    if proxmox_hosts or proxmox_templates or proxmox_groups:
        if not backup_items and not backup_templates:
            recommendations["MEDIO"].append("Add explicit PBS/vzdump/backup job monitoring if Proxmox backups are expected.")
        if not storage_items:
            recommendations["MEDIO"].append("Add storage/datastore capacity and health checks for Proxmox/PBS.")
        recommendations["MEDIO"].append("Import or compare Proxmox VM inventory to detect VMs missing as Zabbix hosts.")
    if backup_items and not backup_triggers:
        recommendations["MEDIO"].append("Add triggers for detected backup items so failed/stale backups raise alerts.")

    if hosts_without_snmp:
        recommendations["BAJO"].append("Classify hosts without SNMP and apply SNMP only where relevant, such as network/storage devices.")
    if api_errors:
        recommendations["BAJO"].append("Review API permissions for read access to actions, media types, users, and groups if needed.")
    if not recommendations["BAJO"]:
        recommendations["BAJO"].append("Keep this audit scheduled periodically and diff JSON outputs between runs.")

    backup_status = "insufficient"
    if backup_items and backup_triggers:
        backup_status = "partial_or_good"
    elif backup_items or backup_templates or backup_hosts:
        backup_status = "partial"

    data: dict[str, Any] = {
        "metadata": {
            "generated_at": datetime.fromtimestamp(now).astimezone().isoformat(),
            "zabbix_url": sanitize_url(url),
            "zabbix_version": version,
            "env_file": str(ENV_FILE),
            "stale_after_seconds": stale_after_seconds,
            "unsupported_many_threshold": UNSUPPORTED_MANY_THRESHOLD,
        },
        "inventory": {
            "hosts_total": len(hosts),
            "hosts_enabled": len(enabled_hosts),
            "hosts_disabled": len(disabled_hosts),
            "host_groups_total": len(groups),
            "templates_total": len(templates),
            "proxies_total": len(proxies),
            "interfaces_total": sum(interface_counts_by_type.values()),
            "interfaces_by_type": dict(interface_counts_by_type),
            "hosts_by_group": {
                group_name: {
                    "count": len(group_hosts[group_name]),
                    "hosts": group_hosts[group_name],
                }
                for group_name in sorted(group_hosts)
            },
            "templates_most_used": [
                {"template": name, "usage_count": count, "hosts": template_hosts[name]}
                for name, count in template_usage.most_common()
            ],
            "proxies": proxies,
        },
        "hosts": enriched_hosts,
        "groups": groups,
        "templates": [
            {
                "templateid": template.get("templateid"),
                "host": template.get("host"),
                "name": template.get("name"),
                "groups": template.get("groups") or [],
                "usage_count": template_usage[template.get("name") or template.get("host")],
            }
            for template in templates
        ],
        "coverage": {
            "hosts_without_templates": hosts_without_templates,
            "hosts_without_interfaces": hosts_without_interfaces,
            "hosts_without_zabbix_agent": hosts_without_agent,
            "hosts_without_snmp": hosts_without_snmp,
            "hosts_without_active_items": hosts_without_active_items,
            "hosts_without_enabled_triggers": hosts_without_triggers,
            "hosts_with_disabled_triggers": hosts_with_disabled_triggers,
            "hosts_with_unsupported_items": sorted(
                hosts_with_unsupported_items,
                key=lambda host: host["active_unsupported_items"],
                reverse=True,
            ),
            "hosts_with_many_unsupported_items": sorted(
                hosts_with_many_unsupported,
                key=lambda host: host["active_unsupported_items"],
                reverse=True,
            ),
            "hosts_without_recent_data": hosts_without_recent_data,
            "templates_by_host": templates_by_host,
            "interfaces_by_host": interfaces_by_host,
        },
        "items": {
            "total": len(items),
            "enabled": sum(1 for item in items if is_enabled_item(item)),
            "disabled": sum(1 for item in items if not is_enabled_item(item)),
            "unsupported_total": len(unsupported_items),
            "unsupported_enabled": len(active_unsupported_items),
            "unsupported_items": unsupported_items,
            "active_unsupported_items": active_unsupported_items,
            "unsupported_by_host": sorted(
                [
                    {
                        "hostid": hostid,
                        "host": host_by_id.get(hostid, {}).get("host"),
                        "name": host_by_id.get(hostid, {}).get("name"),
                        "unsupported_items": count,
                        "active_unsupported_items": active_unsupported_items_by_host[hostid],
                    }
                    for hostid, count in unsupported_items_by_host.items()
                ],
                key=lambda entry: entry["unsupported_items"],
                reverse=True,
            ),
        },
        "triggers": {
            "total": len(triggers),
            "enabled": sum(1 for trigger in triggers if is_enabled_trigger(trigger)),
            "disabled": sum(1 for trigger in triggers if not is_enabled_trigger(trigger)),
            "disabled_by_host": sorted(
                [
                    {
                        "hostid": hostid,
                        "host": host_by_id.get(hostid, {}).get("host"),
                        "name": host_by_id.get(hostid, {}).get("name"),
                        "disabled_triggers": count,
                    }
                    for hostid, count in disabled_triggers_by_host.items()
                ],
                key=lambda entry: entry["disabled_triggers"],
                reverse=True,
            ),
        },
        "problems": {
            "active_total": len(enriched_problems),
            "by_severity": {severity: problem_severity_counts.get(severity, 0) for severity in SEVERITIES.values()},
            "by_host": [{"host": host, "problems": count} for host, count in problems_by_host.most_common()],
            "oldest": problems_oldest,
            "recent": problems_recent,
            "disaster": [problem for problem in enriched_problems if problem["severity"] == "Disaster"],
            "high": [problem for problem in enriched_problems if problem["severity"] == "High"],
            "average": [problem for problem in enriched_problems if problem["severity"] == "Average"],
            "warning": [problem for problem in enriched_problems if problem["severity"] == "Warning"],
            "active": enriched_problems,
        },
        "internal_health": internal_health,
        "alerts": {
            "actions": actions,
            "media_types": media_types,
            "user_groups": user_groups,
            "users_with_media": users_with_media,
            "notifiable_users": notifiable_users,
            "permission_or_api_errors": [
                error
                for error in api_errors
                if error["method"] in {"action.get", "mediatype.get", "usergroup.get", "user.get"}
            ],
        },
        "proxmox": {
            "appears_monitored": bool(proxmox_hosts or proxmox_templates or proxmox_groups or proxmox_items),
            "groups": proxmox_groups,
            "hosts": proxmox_hosts,
            "templates": proxmox_templates,
            "items_count": len(proxmox_items),
            "items_sample": proxmox_items[:100],
            "triggers_count": len(proxmox_triggers),
            "triggers_sample": proxmox_triggers[:100],
            "hosts_without_templates": proxmox_hosts_without_templates,
            "hosts_without_active_items": proxmox_hosts_without_active_items,
            "hosts_without_enabled_triggers": proxmox_hosts_without_triggers,
            "storage_items_count": len(storage_items),
            "storage_items_sample": storage_items[:100],
            "backup_items_count": len(backup_items),
            "ceph_entities_count": ceph_entities_count,
            "vm_gap_detection": "requires Proxmox API/PBS inventory export; cannot be proven from Zabbix alone",
        },
        "backups": {
            "status": backup_status,
            "hosts": backup_hosts,
            "templates": backup_templates,
            "items_count": len(backup_items),
            "items_sample": backup_items[:100],
            "triggers_count": len(backup_triggers),
            "triggers_sample": backup_triggers[:100],
        },
        "risks": risks,
        "recommendations": recommendations,
        "api_errors": api_errors,
    }

    return data


def render_markdown(data: dict[str, Any]) -> str:
    metadata = data["metadata"]
    inventory = data["inventory"]
    coverage = data["coverage"]
    problems = data["problems"]
    items = data["items"]
    triggers = data["triggers"]
    internal = data["internal_health"]
    alerts = data["alerts"]
    proxmox = data["proxmox"]
    backups = data["backups"]

    severity_rows = [
        [severity, problems["by_severity"].get(severity, 0)]
        for severity in ["Disaster", "High", "Average", "Warning", "Information", "Not classified"]
    ]
    gap_rows = [
        ["Hosts enabled sin templates", len(coverage["hosts_without_templates"])],
        ["Hosts enabled sin interfaces", len(coverage["hosts_without_interfaces"])],
        ["Hosts enabled sin Zabbix agent", len(coverage["hosts_without_zabbix_agent"])],
        ["Hosts enabled sin SNMP", len(coverage["hosts_without_snmp"])],
        ["Hosts enabled sin items activos", len(coverage["hosts_without_active_items"])],
        ["Hosts enabled sin triggers habilitados", len(coverage["hosts_without_enabled_triggers"])],
        ["Hosts con triggers deshabilitados", len(coverage["hosts_with_disabled_triggers"])],
        ["Hosts con items unsupported", len(coverage["hosts_with_unsupported_items"])],
        ["Hosts con muchos items unsupported", len(coverage["hosts_with_many_unsupported_items"])],
        ["Hosts sin datos recientes", len(coverage["hosts_without_recent_data"])],
    ]

    unsupported_rows = [
        [
            entry.get("name") or entry.get("host") or entry.get("hostid"),
            entry.get("active_unsupported_items", 0),
            entry.get("unsupported_items", 0),
        ]
        for entry in items["unsupported_by_host"][:25]
    ]

    top_problem_rows = [[entry["host"], entry["problems"]] for entry in problems["by_host"][:20]]
    oldest_problem_rows = [
        [
            problem["severity"],
            problem["age"],
            ", ".join(host.get("name") or host.get("host") for host in problem.get("hosts", [])) or "(unknown)",
            problem["name"],
        ]
        for problem in problems["oldest"][:15]
    ]
    recent_problem_rows = [
        [
            problem["severity"],
            problem["age"],
            ", ".join(host.get("name") or host.get("host") for host in problem.get("hosts", [])) or "(unknown)",
            problem["name"],
        ]
        for problem in problems["recent"][:15]
    ]

    template_rows = [
        [entry["template"], entry["usage_count"]]
        for entry in inventory["templates_most_used"][:25]
    ]
    group_rows = [
        [group_name, details["count"]]
        for group_name, details in sorted(
            inventory["hosts_by_group"].items(),
            key=lambda item: item[1]["count"],
            reverse=True,
        )[:25]
    ]

    hosts_without_templates = [
        host.get("name") or host.get("host") or host.get("hostid")
        for host in coverage["hosts_without_templates"][:50]
    ]
    hosts_without_active_items = [
        host.get("name") or host.get("host") or host.get("hostid")
        for host in coverage["hosts_without_active_items"][:50]
    ]
    hosts_without_triggers = [
        host.get("name") or host.get("host") or host.get("hostid")
        for host in coverage["hosts_without_enabled_triggers"][:50]
    ]

    proxmox_gap_lines = []
    if proxmox["hosts_without_templates"]:
        proxmox_gap_lines.append(f"{len(proxmox['hosts_without_templates'])} Proxmox-like host(s) without templates.")
    if proxmox["hosts_without_active_items"]:
        proxmox_gap_lines.append(f"{len(proxmox['hosts_without_active_items'])} Proxmox-like host(s) without active items.")
    if proxmox["hosts_without_enabled_triggers"]:
        proxmox_gap_lines.append(f"{len(proxmox['hosts_without_enabled_triggers'])} Proxmox-like host(s) without enabled triggers.")
    if proxmox["backup_items_count"] == 0:
        proxmox_gap_lines.append("No backup/PBS/vzdump item evidence found for Proxmox scope.")
    if proxmox["storage_items_count"] == 0:
        proxmox_gap_lines.append("No storage/datastore item evidence found for Proxmox scope.")
    if proxmox["ceph_entities_count"] == 0:
        proxmox_gap_lines.append("No Ceph monitoring evidence found; only a gap if Ceph is used.")
    proxmox_gap_lines.append("VMs missing from Zabbix cannot be proven without a Proxmox inventory/API comparison.")

    backup_lines = [
        f"Backup coverage status: `{backups['status']}`.",
        f"Backup-related hosts: {len(backups['hosts'])}.",
        f"Backup-related templates: {len(backups['templates'])}.",
        f"Backup-related items: {backups['items_count']}.",
        f"Backup-related triggers: {backups['triggers_count']}.",
    ]
    if backups["items_count"] and not backups["triggers_count"]:
        backup_lines.append("Backup items exist but no backup triggers were detected.")
    if not backups["items_count"]:
        backup_lines.append("No backup item evidence was detected.")

    internal_lines = []
    if internal.get("zabbix_server_host_found"):
        internal_lines.extend(
            [
                f"Host: `{internal['host'].get('name') or internal['host'].get('host')}`.",
                f"Status: `{internal.get('status')}`.",
                f"Agent availability: `{internal.get('agent_availability')}`.",
                f"Active items: {internal.get('active_item_count')}.",
                f"Enabled triggers: {internal.get('enabled_trigger_count')}.",
                f"Unsupported items: {internal.get('unsupported_item_count')}.",
                f"Last item data: {internal.get('last_item_clock_text')}.",
                f"Queue items detected: {len(internal.get('queue_items') or [])}.",
                f"CPU/RAM/disk related items detected: {len(internal.get('resource_items') or [])}.",
            ]
        )
    else:
        internal_lines.append('Host "Zabbix server" not found by name.')

    actions_status = []
    actions_status.append(f"Actions readable/configured: {len(alerts['actions'])}.")
    actions_status.append(f"Media types readable/configured: {len(alerts['media_types'])}.")
    actions_status.append(f"User groups readable: {len(alerts['user_groups'])}.")
    actions_status.append(f"Users with active media: {len(alerts['notifiable_users'])}.")
    if alerts["permission_or_api_errors"]:
        actions_status.append("Some alerting/user data could not be read with current token permissions.")

    recommendation_lines = []
    for priority in ["CRÍTICO", "ALTO", "MEDIO", "BAJO"]:
        recommendation_lines.append(f"### {priority}")
        recommendation_lines.append(bullet_list(data["recommendations"].get(priority, [])))

    lines = [
        "# Auditoría de cobertura Zabbix",
        "",
        f"Generado: {metadata['generated_at']}",
        f"API: `{metadata['zabbix_url']}`",
        f"Versión Zabbix: `{metadata['zabbix_version']}`",
        "",
        "## Resumen ejecutivo",
        "",
        bullet_list(
            [
                f"Hosts analizados: {inventory['hosts_total']} ({inventory['hosts_enabled']} enabled, {inventory['hosts_disabled']} disabled).",
                f"Templates analizados: {inventory['templates_total']}.",
                f"Problemas activos: {problems['active_total']}.",
                f"Items enabled unsupported: {items['unsupported_enabled']}.",
                f"Principales huecos: {len(coverage['hosts_without_templates'])} hosts sin templates, "
                f"{len(coverage['hosts_without_active_items'])} sin items activos, "
                f"{len(coverage['hosts_without_enabled_triggers'])} sin triggers habilitados.",
                f"Proxmox parece monitorizado: {'si' if proxmox['appears_monitored'] else 'no'}.",
                f"Backups: {backups['status']}.",
            ]
        ),
        "## Inventario",
        "",
        md_table(
            ["Métrica", "Valor"],
            [
                ["Hosts total", inventory["hosts_total"]],
                ["Hosts enabled", inventory["hosts_enabled"]],
                ["Hosts disabled", inventory["hosts_disabled"]],
                ["Grupos de hosts", inventory["host_groups_total"]],
                ["Templates", inventory["templates_total"]],
                ["Proxies", inventory["proxies_total"]],
                ["Interfaces", inventory["interfaces_total"]],
                ["Interfaces agent", inventory["interfaces_by_type"].get("agent", 0)],
                ["Interfaces SNMP", inventory["interfaces_by_type"].get("snmp", 0)],
            ],
        ),
        "## Estado general",
        "",
        md_table(["Área", "Valor"], gap_rows),
        "",
        bullet_list(actions_status),
        "## Problemas activos",
        "",
        md_table(["Severidad", "Problemas activos"], severity_rows),
        "",
        "Hosts con más problemas:",
        "",
        md_table(["Host", "Problemas"], top_problem_rows),
        "",
        "Problemas más antiguos:",
        "",
        md_table(["Severidad", "Antigüedad", "Host", "Problema"], oldest_problem_rows),
        "",
        "Problemas recientes:",
        "",
        md_table(["Severidad", "Antigüedad", "Host", "Problema"], recent_problem_rows),
        "## Hosts sin buena cobertura",
        "",
        "Hosts enabled sin templates:",
        "",
        bullet_list(hosts_without_templates),
        "Hosts enabled sin items activos:",
        "",
        bullet_list(hosts_without_active_items),
        "Hosts enabled sin triggers habilitados:",
        "",
        bullet_list(hosts_without_triggers),
        "## Items unsupported",
        "",
        md_table(
            ["Métrica", "Valor"],
            [
                ["Items total", items["total"]],
                ["Items enabled", items["enabled"]],
                ["Items disabled", items["disabled"]],
                ["Unsupported total", items["unsupported_total"]],
                ["Unsupported enabled", items["unsupported_enabled"]],
                ["Hosts con muchos unsupported", len(coverage["hosts_with_many_unsupported_items"])],
            ],
        ),
        "",
        md_table(["Host", "Unsupported enabled", "Unsupported total"], unsupported_rows),
        "## Templates y grupos",
        "",
        "Templates más usados:",
        "",
        md_table(["Template", "Hosts"], template_rows),
        "",
        "Grupos con más hosts:",
        "",
        md_table(["Grupo", "Hosts"], group_rows),
        "## Proxmox",
        "",
        bullet_list(
            [
                f"Entidades Proxmox-like detectadas: {len(proxmox['hosts'])} hosts, {len(proxmox['templates'])} templates, {len(proxmox['groups'])} grupos.",
                f"Items Proxmox-like: {proxmox['items_count']}.",
                f"Triggers Proxmox-like: {proxmox['triggers_count']}.",
                f"Items storage/datastore: {proxmox['storage_items_count']}.",
                f"Entidades Ceph detectadas: {proxmox['ceph_entities_count']}.",
            ]
        ),
        "Huecos Proxmox evidentes:",
        "",
        bullet_list(proxmox_gap_lines),
        "## Backups",
        "",
        bullet_list(backup_lines),
        "## Salud del propio Zabbix",
        "",
        bullet_list(internal_lines),
        "## Riesgos detectados",
        "",
        bullet_list(data["risks"]),
        "## Recomendaciones priorizadas",
        "",
        "\n".join(recommendation_lines),
        "## Próximos pasos",
        "",
        bullet_list(
            [
                "Revisar el JSON generado para preparar scripts de corrección por lotes.",
                "Validar manualmente hosts sin templates, sin items activos y sin triggers antes de aplicar cambios.",
                "Decidir templates base por tipo de host: Linux, Proxmox/PVE, PBS, red/SNMP, storage, aplicaciones y backups.",
                "En la siguiente fase, generar propuestas de cambios sin aplicarlas: asignación de templates, creación de items/triggers y ajustes de acciones.",
            ]
        ),
    ]

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

    problems = data["problems"]["by_severity"]
    print("Zabbix coverage audit completed.")
    print(f"Hosts analyzed: {data['inventory']['hosts_total']}")
    print(f"Templates analyzed: {data['inventory']['templates_total']}")
    print(
        "Active problems: "
        f"Disaster={problems.get('Disaster', 0)}, "
        f"High={problems.get('High', 0)}, "
        f"Average={problems.get('Average', 0)}, "
        f"Warning={problems.get('Warning', 0)}"
    )
    print(f"Markdown report: {REPORT_MD}")
    print(f"JSON report: {REPORT_JSON}")
    if data["api_errors"]:
        print(f"API read warnings: {len(data['api_errors'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
