#!/usr/bin/env python3
"""Read-only active Zabbix problem detail viewer."""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

import plan_zabbix_remediation as zbx


def make_api() -> tuple[zbx.ZabbixApi, str]:
    env = zbx.load_env(zbx.ENV_FILE)
    url = zbx.api_url_from_env(env.get("ZABBIX_URL", ""))
    token = env.get("ZABBIX_TOKEN", "")
    if not token:
        raise ValueError("ZABBIX_TOKEN is empty or missing")
    return zbx.ZabbixApi(url, token, zbx.tls_context(env)), zbx.sanitize_url(url)


def severity_id(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    for sid, name in zbx.SEVERITIES.items():
        if normalized == sid or normalized == name.lower():
            return sid
    raise ValueError(f"Unknown severity: {value}")


def collect() -> dict[str, Any]:
    api, url = make_api()
    version = api.call("apiinfo.version", {}, auth=False)
    hosts = api.call(
        "host.get",
        {
            "output": ["hostid", "host", "name", "status"],
            "selectGroups": ["groupid", "name"],
            "sortfield": "host",
        },
    )
    triggers = api.call(
        "trigger.get",
        {
            "output": ["triggerid", "description", "status", "priority", "value", "lastchange", "comments", "templateid", "opdata"],
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItems": ["itemid", "hostid", "name", "key_", "snmp_oid", "lastclock", "lastvalue", "error", "state", "type", "interfaceid"],
            "selectTags": "extend",
        },
    )
    problems = api.call(
        "problem.get",
        {
            "output": "extend",
            "selectTags": "extend",
            "selectAcknowledges": "extend",
            "selectSuppressionData": "extend",
            "sortfield": "eventid",
            "sortorder": "DESC",
        },
    )
    return {
        "url": url,
        "version": version,
        "hosts": hosts,
        "triggers": triggers,
        "problems": problems,
    }


def problem_entry(
    problem: dict[str, Any],
    trigger: dict[str, Any] | None,
    host_by_id: dict[str, dict[str, Any]],
    now: int,
) -> dict[str, Any]:
    hosts = [host_by_id.get(str(host.get("hostid")), host) for host in (trigger or {}).get("hosts") or []]
    items = []
    for item in (trigger or {}).get("items") or []:
        items.append(
            {
                "itemid": item.get("itemid"),
                "hostid": item.get("hostid"),
                "name": item.get("name"),
                "key": item.get("key_"),
                "type": zbx.item_type_name(item),
                "state": "unsupported" if str(item.get("state")) == "1" else "normal",
                "error": item.get("error", ""),
                "lastvalue": item.get("lastvalue"),
                "lastclock": zbx.to_int(item.get("lastclock")),
                "lastclock_text": zbx.format_ts(item.get("lastclock")),
                "snmp_oid": item.get("snmp_oid", ""),
            }
        )
    return {
        "eventid": problem.get("eventid"),
        "name": problem.get("name"),
        "severity": zbx.SEVERITIES.get(str(problem.get("severity", "0")), str(problem.get("severity", "0"))),
        "severity_id": str(problem.get("severity", "0")),
        "clock": zbx.to_int(problem.get("clock")),
        "clock_text": zbx.format_ts(problem.get("clock")),
        "duration": zbx.age_text(problem.get("clock"), now),
        "operational_data": problem.get("opdata", ""),
        "acknowledged": str(problem.get("acknowledged", "0")) == "1",
        "suppressed": str(problem.get("suppressed", "0")) == "1",
        "tags": problem.get("tags") or [],
        "trigger": {
            "triggerid": (trigger or {}).get("triggerid"),
            "description": (trigger or {}).get("description"),
            "status": "enabled" if trigger and str(trigger.get("status")) == "0" else "disabled" if trigger else None,
            "severity": zbx.SEVERITIES.get(str((trigger or {}).get("priority", "0")), str((trigger or {}).get("priority", "0"))),
            "opdata": (trigger or {}).get("opdata", ""),
            "comments": (trigger or {}).get("comments", ""),
        },
        "hosts": [zbx.compact_host(host) for host in hosts],
        "items": items,
    }


def filter_entries(entries: list[dict[str, Any]], host_filter: str | None, severity_filter: str | None) -> list[dict[str, Any]]:
    result = []
    host_filter_lower = host_filter.lower() if host_filter else None
    for entry in entries:
        if severity_filter and entry["severity_id"] != severity_filter:
            continue
        if host_filter_lower:
            host_names = " ".join(
                str(host.get("name") or host.get("host") or "") for host in entry.get("hosts", [])
            ).lower()
            if host_filter_lower not in host_names:
                continue
        result.append(entry)
    return result


def render_text(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return "No active problems matched the filters.\n"
    lines = []
    for entry in entries:
        host_names = ", ".join(host.get("name") or host.get("host") or "(unknown)" for host in entry.get("hosts", []))
        tags = ", ".join(f"{tag.get('tag')}={tag.get('value')}" for tag in entry.get("tags", []))
        lines.extend(
            [
                f"EventID: {entry['eventid']}",
                f"Problem: {entry['name']}",
                f"Host: {host_names or '(unknown)'}",
                f"Severity: {entry['severity']}",
                f"Started: {entry['clock_text']} ({entry['duration']})",
                f"Operational data: {entry['operational_data']}",
                f"Trigger: {entry['trigger']['triggerid']} [{entry['trigger']['status']}] {entry['trigger']['description']}",
                f"Tags: {tags or '-'}",
                "Items:",
            ]
        )
        if entry.get("items"):
            for item in entry["items"]:
                lines.append(
                    "  - {itemid} {name} | key={key} | type={type} | value={lastvalue} | last={lastclock_text} | state={state}".format(
                        **item
                    )
                )
        else:
            lines.append("  - none readable")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Show active Zabbix problems with trigger and item details.")
    parser.add_argument("--host", help="Filter by host visible or technical name.")
    parser.add_argument("--severity", help="Filter by severity name or id, e.g. High or 4.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of text.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        sev = severity_id(args.severity)
        data = collect()
    except (FileNotFoundError, ValueError, RuntimeError, zbx.ApiError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    now = int(time.time())
    host_by_id = {str(host["hostid"]): host for host in data["hosts"]}
    trigger_by_id = {str(trigger["triggerid"]): trigger for trigger in data["triggers"]}
    entries = [
        problem_entry(problem, trigger_by_id.get(str(problem.get("objectid"))), host_by_id, now)
        for problem in data["problems"]
    ]
    entries = filter_entries(entries, args.host, sev)

    if args.json:
        print(json.dumps(entries, indent=2, ensure_ascii=False))
    else:
        print(render_text(entries), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
