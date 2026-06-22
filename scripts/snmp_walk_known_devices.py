#!/usr/bin/env python3
"""Run read-only SNMP diagnostics for priority Zabbix devices."""

from __future__ import annotations

import json
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import plan_zabbix_remediation as zbx  # noqa: E402
import snmp_diagnose_device as snmpdiag  # noqa: E402


BASE_DIR = Path("/opt/zabbix-codex")
REPORTS_DIR = BASE_DIR / "reports"
DIAGNOSTICS_DIR = BASE_DIR / "diagnostics"
UNSUPPORTED_SUMMARY = REPORTS_DIR / "unsupported-blocks-summary.json"
SNMP_JSON = DIAGNOSTICS_DIR / "snmp-known-devices.json"
SNMP_MD = REPORTS_DIR / "external-readonly-diagnostics.md"

PRIORITY_HOSTS = [
    "NasAlmeria",
    "NasGenomica",
    "EATON 5PX 2200 SAI ALMERIA",
    "EATON 5PX 2200 ( SAI GALLARZA )",
    "HP V1810-48G GALLARZA",
]


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def host_name(entry: dict[str, Any]) -> str:
    return str(entry.get("host") or entry.get("name") or "").strip()


def collect_target_names(summary: dict[str, Any]) -> list[str]:
    names: list[str] = []

    def add(name: str) -> None:
        if name and name not in names:
            names.append(name)

    for name in PRIORITY_HOSTS:
        add(name)
    for printer in summary.get("stale_printers") or []:
        add(host_name(printer.get("host") or printer))
    for block in ["printers_snmp", "other"]:
        for item in (summary.get("blocks") or {}).get(block, []):
            add(str(item.get("host") or ""))
    return names


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    conclusions = Counter(str(result.get("conclusion") or "unknown") for result in results)
    reachable = sum(1 for result in results if (result.get("probes") or {}).get("sysDescr", {}).get("ok"))
    failed_oid_count = sum(
        1
        for result in results
        for probe in result.get("failed_oid_probes") or []
        if not (probe.get("probe") or {}).get("ok")
    )
    return {
        "targets_total": len(results),
        "snmp_reachable": reachable,
        "snmp_not_reachable": len(results) - reachable,
        "failed_unsupported_oid_probes": failed_oid_count,
        "conclusions": dict(sorted(conclusions.items())),
    }


def render_markdown(data: dict[str, Any]) -> str:
    lines = [
        "# Diagnostico externo read-only",
        "",
        "Este informe se ha generado con pruebas SNMP de solo lectura contra dispositivos ya conocidos en Zabbix. No se han modificado hosts, items, templates, triggers ni macros.",
        "",
        f"- Generado: {data['metadata']['generated_at']}",
        f"- Endpoint API: `{data['metadata']['api_endpoint']}`",
        f"- Targets diagnosticados: `{data['summary']['targets_total']}`",
        f"- SNMP reachable: `{data['summary']['snmp_reachable']}`",
        f"- SNMP not reachable: `{data['summary']['snmp_not_reachable']}`",
        "",
        "## Resumen SNMP",
    ]
    rows = []
    for result in data.get("diagnostics") or []:
        host = result.get("host") or {}
        sys_descr = (result.get("probes") or {}).get("sysDescr") or {}
        object_id = (result.get("probes") or {}).get("sysObjectID") or {}
        failed_oids = sum(1 for probe in result.get("failed_oid_probes") or [] if not (probe.get("probe") or {}).get("ok"))
        rows.append(
            [
                host.get("name") or host.get("host"),
                result.get("snmp_target") or "none",
                "OK" if sys_descr.get("ok") else "FAIL",
                object_id.get("stdout") or "",
                result.get("conclusion"),
                failed_oids,
            ]
        )
    lines.append(zbx.md_table(["Host", "Target", "SNMP", "sysObjectID", "Conclusion", "OIDs fallidas"], rows))

    lines.append("## Detalle por dispositivo")
    for result in data.get("diagnostics") or []:
        host = result.get("host") or {}
        lines.append(f"### {host.get('name') or host.get('host')}")
        lines.append("")
        lines.append(f"- Target: `{result.get('snmp_target') or 'none'}`")
        lines.append(f"- Conclusion: `{result.get('conclusion')}`")
        lines.append(f"- Recomendacion: {result.get('recommendation', '')}")
        sys_descr = (result.get("probes") or {}).get("sysDescr") or {}
        if sys_descr.get("stdout"):
            lines.append(f"- sysDescr: `{str(sys_descr.get('stdout'))[:220]}`")
        if result.get("api_errors"):
            lines.append(f"- Errores API parciales: `{len(result.get('api_errors'))}`")
        lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    api, safe_url = snmpdiag.make_api()
    api_errors: list[dict[str, str]] = []
    hosts = snmpdiag.fetch_hosts(api, api_errors)
    host_by_display = {str(host.get("name") or host.get("host")): host for host in hosts}
    summary = load_json(UNSUPPORTED_SUMMARY, {})
    target_names = collect_target_names(summary)

    results: list[dict[str, Any]] = []
    missing: list[str] = []
    for name in target_names:
        host = host_by_display.get(name) or snmpdiag.find_host(hosts, name)
        if not host:
            missing.append(name)
            continue
        if not snmpdiag.main_snmp_interface(host):
            results.append(
                {
                    "host": {
                        "hostid": host.get("hostid"),
                        "host": host.get("host"),
                        "name": host.get("name"),
                        "status": "enabled" if str(host.get("status")) == "0" else "disabled",
                    },
                    "snmp_interface": None,
                    "snmp_target": "",
                    "probes": {},
                    "walks": {},
                    "failed_oid_probes": [],
                    "active_problems": [],
                    "api_errors": [],
                    "conclusion": "sin_interfaz_snmp_en_zabbix",
                    "recommendation": "No ejecutar SNMP externo; revisar metodo de monitorizacion esperado.",
                }
            )
            continue
        results.append(snmpdiag.diagnose_host(api, host, timeout=2, failed_oid_limit=4, include_walks=True))

    data = {
        "metadata": {
            "generated_at": now_text(),
            "generated_epoch": int(time.time()),
            "api_endpoint": safe_url,
            "mode": "read-only",
            "secrets_policy": "SNMP communities and API token are never printed.",
        },
        "targets_requested": target_names,
        "targets_missing_in_zabbix": missing,
        "summary": summarize(results),
        "diagnostics": results,
        "api_errors": api_errors,
    }

    SNMP_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    SNMP_MD.write_text(render_markdown(data), encoding="utf-8")
    print(
        "SNMP diagnostics written: "
        f"{SNMP_JSON} ({data['summary']['targets_total']} targets, {data['summary']['snmp_reachable']} reachable)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
