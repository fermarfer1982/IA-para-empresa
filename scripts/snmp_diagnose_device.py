#!/usr/bin/env python3
"""Read-only SNMP diagnostics for devices already known by Zabbix.

The script reads Zabbix API access from /etc/zabbix-codex/zabbix.env, obtains
SNMP targets and visible macros from Zabbix, and runs safe read-only SNMP GET/WALK
queries. SNMP community values are used only in subprocess arguments and are
never written to JSON, Markdown, or stdout.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import plan_zabbix_remediation as zbx  # noqa: E402


SNMP_TIMEOUT = 2
SNMP_RETRIES = 0
MAX_WALK_LINES = 40

SYS_OIDS = {
    "sysDescr": "1.3.6.1.2.1.1.1.0",
    "sysObjectID": "1.3.6.1.2.1.1.2.0",
    "sysUpTime": "1.3.6.1.2.1.1.3.0",
}

WALK_OIDS = {
    "ifDescr": "1.3.6.1.2.1.2.2.1.2",
    "ifOperStatus": "1.3.6.1.2.1.2.2.1.8",
}

COMMUNITY_MACRO_NAMES = {
    "{$SNMP_COMMUNITY}",
    "{$SNMP_COMMUNITY_PUBLIC}",
    "{$SNMPV2_COMMUNITY}",
    "{$SNMP.V2.COMMUNITY}",
}

SECRET_MACRO_HINTS = {"COMMUNITY", "PASS", "TOKEN", "SECRET", "KEY", "AUTH", "PRIV"}


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


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
    except Exception as exc:  # noqa: BLE001 - diagnostics must continue on partial permissions.
        errors.append({"method": method, "error": str(exc)})
        return default


def mask_value(value: Any) -> str:
    text = "" if value is None else str(value)
    return f"<masked,length={len(text)}>"


def mask_macro(macro: dict[str, Any], source: str) -> dict[str, Any]:
    name = str(macro.get("macro") or "")
    return {
        "macro": name,
        "source": source,
        "hostid": macro.get("hostid"),
        "type": macro.get("type"),
        "value": mask_value(macro.get("value", "")),
        "secret_like": any(hint in name.upper() for hint in SECRET_MACRO_HINTS),
    }


def fetch_hosts(api: zbx.ZabbixApi, errors: list[dict[str, str]]) -> list[dict[str, Any]]:
    return safe_call(
        api,
        "host.get",
        {
            "output": ["hostid", "host", "name", "status", "proxyid", "maintenance_status"],
            "selectGroups": ["groupid", "name"],
            "selectParentTemplates": ["templateid", "host", "name"],
            "selectInterfaces": "extend",
            "sortfield": "host",
        },
        errors,
        [],
    )


def display_host(host: dict[str, Any]) -> str:
    return str(host.get("name") or host.get("host") or host.get("hostid") or "(unknown)")


def find_host(hosts: list[dict[str, Any]], query: str) -> dict[str, Any] | None:
    query_l = query.strip().lower()
    for host in hosts:
        if query_l in {str(host.get("host", "")).lower(), str(host.get("name", "")).lower()}:
            return host
    matches = [
        host
        for host in hosts
        if query_l in str(host.get("host", "")).lower() or query_l in str(host.get("name", "")).lower()
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def main_snmp_interface(host: dict[str, Any]) -> dict[str, Any] | None:
    interfaces = [iface for iface in host.get("interfaces") or [] if str(iface.get("type")) == "2"]
    if not interfaces:
        return None
    for iface in interfaces:
        if str(iface.get("main")) == "1":
            return iface
    return interfaces[0]


def interface_target(interface: dict[str, Any] | None) -> str:
    if not interface:
        return ""
    useip = str(interface.get("useip", "1")) == "1"
    address = str(interface.get("ip") if useip else interface.get("dns") or interface.get("ip") or "")
    port = str(interface.get("port") or "161")
    if not address:
        return ""
    return f"{address}:{port}"


def summarize_interface(interface: dict[str, Any] | None) -> dict[str, Any] | None:
    if not interface:
        return None
    return zbx.summarize_interface(interface)


def macro_candidates(api: zbx.ZabbixApi, host: dict[str, Any], errors: list[dict[str, str]]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    hostid = str(host.get("hostid") or "")
    if hostid:
        for macro in safe_call(api, "usermacro.get", {"output": "extend", "hostids": [hostid]}, errors, []):
            candidates.append({"source": "host", "macro": macro})

    templateids = [str(t.get("templateid")) for t in host.get("parentTemplates") or [] if t.get("templateid")]
    if templateids:
        for macro in safe_call(api, "usermacro.get", {"output": "extend", "hostids": templateids}, errors, []):
            candidates.append({"source": "template", "macro": macro})

    for macro in safe_call(api, "globalmacro.get", {"output": "extend"}, errors, []):
        candidates.append({"source": "global", "macro": macro})

    return candidates


def select_community(candidates: list[dict[str, Any]]) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]]]:
    masked: list[dict[str, Any]] = []
    selected_value = ""
    selected_masked: dict[str, Any] | None = None

    source_rank = {"host": 0, "template": 1, "global": 2}
    for entry in sorted(candidates, key=lambda item: source_rank.get(item["source"], 9)):
        macro = entry["macro"]
        name = str(macro.get("macro") or "")
        upper = name.upper()
        value = str(macro.get("value") or "")
        masked_entry = mask_macro(macro, entry["source"])
        masked.append(masked_entry)
        if (
            name in COMMUNITY_MACRO_NAMES
            or ("SNMP" in upper and "COMMUNITY" in upper)
            or upper.endswith("COMMUNITY}")
        ) and value and value not in {"***", "******"}:
            if not selected_value:
                selected_value = value
                selected_masked = masked_entry

    return selected_value, selected_masked, masked


def sanitize_text(text: str, secret: str) -> str:
    if secret:
        text = text.replace(secret, "<masked>")
    return text.strip()


def command_result(
    args: list[str],
    secret: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    safe_args = ["<masked>" if arg == secret and secret else arg for arg in args]
    try:
        completed = subprocess.run(  # noqa: S603 - args are explicit and no shell is used.
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        stdout = sanitize_text(completed.stdout, secret)
        stderr = sanitize_text(completed.stderr, secret)
        return {
            "ok": completed.returncode == 0 and bool(stdout) and not looks_like_snmp_failure(stdout + "\n" + stderr),
            "returncode": completed.returncode,
            "stdout": truncate(stdout, 6000),
            "stderr": truncate(stderr, 2000),
            "command": safe_args,
        }
    except FileNotFoundError:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": "command not found", "command": safe_args}
    except subprocess.TimeoutExpired as exc:
        stdout = sanitize_text(exc.stdout or "", secret)
        stderr = sanitize_text(exc.stderr or "", secret)
        return {
            "ok": False,
            "returncode": None,
            "stdout": truncate(stdout, 2000),
            "stderr": truncate(stderr or f"timeout after {timeout_seconds}s", 2000),
            "command": safe_args,
        }


def truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"\n... <truncated {len(value) - limit} chars>"


def looks_like_snmp_failure(text: str) -> bool:
    lower = text.lower()
    return any(
        token in lower
        for token in [
            "timeout",
            "no such",
            "unknown user name",
            "authentication failure",
            "authorization error",
            "decryption error",
            "not in time window",
            "unknown host",
            "no response",
        ]
    )


def snmp_get(target: str, community: str, oid: str, timeout: int) -> dict[str, Any]:
    args = [
        "snmpget",
        "-v2c",
        "-c",
        community,
        "-t",
        str(timeout),
        "-r",
        str(SNMP_RETRIES),
        "-On",
        "-OQv",
        target,
        oid,
    ]
    return command_result(args, community, timeout + 2)


def snmp_walk(target: str, community: str, oid: str, timeout: int, max_lines: int = MAX_WALK_LINES) -> dict[str, Any]:
    args = [
        "snmpwalk",
        "-v2c",
        "-c",
        community,
        "-t",
        str(timeout),
        "-r",
        str(SNMP_RETRIES),
        "-On",
        "-OQ",
        target,
        oid,
    ]
    result = command_result(args, community, timeout + 5)
    lines = result.get("stdout", "").splitlines()
    result["line_count"] = len(lines)
    if len(lines) > max_lines:
        result["stdout"] = "\n".join(lines[:max_lines]) + f"\n... <truncated {len(lines) - max_lines} lines>"
    return result


def normalize_snmp_oid(raw_oid: str) -> str:
    oid = str(raw_oid or "").strip()
    match = re.match(r"^(?:get|walk)\[(.+)]$", oid)
    if match:
        oid = match.group(1)
    oid = oid.strip().lstrip(".")
    if re.match(r"^\d+(?:\.\d+)*$", oid):
        return oid
    return ""


def fetch_unsupported_items(api: zbx.ZabbixApi, hostid: str, errors: list[dict[str, str]]) -> list[dict[str, Any]]:
    return safe_call(
        api,
        "item.get",
        {
            "output": [
                "itemid",
                "hostid",
                "name",
                "key_",
                "type",
                "snmp_oid",
                "error",
                "state",
                "status",
                "lastclock",
                "lastvalue",
                "interfaceid",
            ],
            "hostids": [hostid],
            "filter": {"state": "1", "status": "0"},
            "selectItemDiscovery": "extend",
            "selectDiscoveryRule": ["itemid", "name", "key_"],
            "sortfield": "name",
        },
        errors,
        [],
    )


def fetch_active_problems(api: zbx.ZabbixApi, hostid: str, errors: list[dict[str, str]]) -> list[dict[str, Any]]:
    return safe_call(
        api,
        "problem.get",
        {
            "output": "extend",
            "hostids": [hostid],
            "selectTags": "extend",
            "sortfield": "eventid",
            "sortorder": "DESC",
        },
        errors,
        [],
    )


def classify_result(diag: dict[str, Any]) -> str:
    if not diag.get("snmp_interface"):
        return "sin_interfaz_snmp_en_zabbix"
    if not diag.get("community_macro_selected"):
        return "sin_macro_comunidad_snmp_visible"
    sys_descr = diag.get("probes", {}).get("sysDescr", {})
    probe_text = f"{sys_descr.get('stdout', '')} {sys_descr.get('stderr', '')}".lower()
    if not sys_descr.get("ok"):
        if "timeout" in probe_text or "no response" in probe_text:
            return "sin_respuesta_snmp_timeout_red_acl_equipo"
        if any(token in probe_text for token in ["authentication", "authorization", "community", "unknown user"]):
            return "credencial_snmp_incorrecta_o_no_autorizada"
        return "snmp_no_responde_o_error_no_clasificado"
    failed_oid_probes = diag.get("failed_oid_probes") or []
    if failed_oid_probes and any(not probe.get("probe", {}).get("ok") for probe in failed_oid_probes):
        if any("no such" in f"{probe.get('probe', {}).get('stdout', '')} {probe.get('probe', {}).get('stderr', '')}".lower() for probe in failed_oid_probes):
            return "snmp_responde_pero_hay_oids_no_soportadas_template_mib"
        return "snmp_responde_pero_items_fallan_por_causa_no_clasificada"
    return "snmp_responde_checks_basicos_ok"


def compact_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "itemid": item.get("itemid"),
        "name": item.get("name"),
        "key": item.get("key_"),
        "type": zbx.ITEM_TYPES.get(str(item.get("type", "")), str(item.get("type", ""))),
        "snmp_oid": item.get("snmp_oid", ""),
        "normalized_oid": normalize_snmp_oid(str(item.get("snmp_oid") or "")),
        "error": item.get("error", ""),
        "lastclock": zbx.to_int(item.get("lastclock")),
        "lastclock_text": zbx.format_ts(item.get("lastclock")),
        "lastvalue": item.get("lastvalue", ""),
        "is_discovered": bool(item.get("itemDiscovery")),
        "discovery_rule": item.get("discoveryRule") or {},
    }


def diagnose_host(
    api: zbx.ZabbixApi,
    host: dict[str, Any],
    timeout: int = SNMP_TIMEOUT,
    failed_oid_limit: int = 6,
    include_walks: bool = True,
) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    hostid = str(host.get("hostid") or "")
    interface = main_snmp_interface(host)
    target = interface_target(interface)
    community, selected_macro, all_macros_masked = select_community(macro_candidates(api, host, errors))
    unsupported = fetch_unsupported_items(api, hostid, errors) if hostid else []
    active_problems = fetch_active_problems(api, hostid, errors) if hostid else []

    diag: dict[str, Any] = {
        "host": {
            "hostid": host.get("hostid"),
            "host": host.get("host"),
            "name": host.get("name"),
            "status": "enabled" if str(host.get("status")) == "0" else "disabled",
            "groups": [group.get("name") for group in host.get("groups") or []],
            "templates": [template.get("name") or template.get("host") for template in host.get("parentTemplates") or []],
        },
        "snmp_interface": summarize_interface(interface),
        "snmp_target": target,
        "community_macro_selected": selected_macro,
        "snmp_macros_visible_masked": all_macros_masked,
        "probes": {},
        "walks": {},
        "unsupported_items": [compact_item(item) for item in unsupported],
        "failed_oid_probes": [],
        "active_problems": [
            {
                "eventid": problem.get("eventid"),
                "name": problem.get("name"),
                "severity": zbx.SEVERITIES.get(str(problem.get("severity")), str(problem.get("severity"))),
                "clock": zbx.to_int(problem.get("clock")),
                "clock_text": zbx.format_ts(problem.get("clock")),
                "operational_data": problem.get("opdata", ""),
                "tags": problem.get("tags") or [],
            }
            for problem in active_problems
        ],
        "api_errors": errors,
    }

    if not interface or not target:
        diag["conclusion"] = classify_result(diag)
        diag["recommendation"] = "Crear o corregir la interfaz SNMP en Zabbix en una fase posterior si el activo debe monitorizarse por SNMP."
        return diag

    if not community:
        diag["conclusion"] = classify_result(diag)
        diag["recommendation"] = "Revisar macros visibles del host/template/global; no se ha podido obtener una comunidad SNMP utilizable sin exponer secretos."
        return diag

    if not shutil.which("snmpget") or not shutil.which("snmpwalk"):
        diag["conclusion"] = "herramientas_snmp_no_disponibles"
        diag["recommendation"] = "Instalar net-snmp-utils en el servidor de diagnostico antes de repetir pruebas externas read-only."
        return diag

    sys_descr = snmp_get(target, community, SYS_OIDS["sysDescr"], timeout)
    diag["probes"]["sysDescr"] = sys_descr
    if not sys_descr.get("ok"):
        diag["conclusion"] = classify_result(diag)
        diag["recommendation"] = "Verificar conectividad, ACL/firewall SNMP, estado del equipo y comunidad SNMP antes de tocar templates."
        return diag

    for name in ["sysObjectID", "sysUpTime"]:
        diag["probes"][name] = snmp_get(target, community, SYS_OIDS[name], timeout)

    if include_walks:
        for name, oid in WALK_OIDS.items():
            diag["walks"][name] = snmp_walk(target, community, oid, timeout)

    tested = 0
    for item in unsupported:
        oid = normalize_snmp_oid(str(item.get("snmp_oid") or ""))
        if not oid:
            continue
        probe = snmp_get(target, community, oid, timeout)
        diag["failed_oid_probes"].append({"item": compact_item(item), "probe": probe})
        tested += 1
        if tested >= failed_oid_limit:
            break

    diag["conclusion"] = classify_result(diag)
    if diag["conclusion"] == "snmp_responde_pero_hay_oids_no_soportadas_template_mib":
        diag["recommendation"] = "SNMP base responde; preparar ajuste de template/override por modelo, MIB o firmware para las OIDs que no existen."
    elif diag["conclusion"] == "snmp_responde_checks_basicos_ok":
        diag["recommendation"] = "SNMP base operativo; comparar gaps restantes contra templates y politica de cobertura."
    else:
        diag["recommendation"] = "Revisar detalle de pruebas antes de proponer cambios."
    return diag


def diagnose_host_by_name(
    host_name: str,
    timeout: int = SNMP_TIMEOUT,
    failed_oid_limit: int = 6,
    include_walks: bool = True,
) -> dict[str, Any]:
    api, safe_url = make_api()
    errors: list[dict[str, str]] = []
    hosts = fetch_hosts(api, errors)
    host = find_host(hosts, host_name)
    if not host:
        return {
            "host": {"name": host_name},
            "api_endpoint": safe_url,
            "api_errors": errors,
            "conclusion": "host_no_encontrado_en_zabbix",
            "recommendation": "Verificar nombre exacto del host en Zabbix.",
        }
    result = diagnose_host(api, host, timeout=timeout, failed_oid_limit=failed_oid_limit, include_walks=include_walks)
    result["api_endpoint"] = safe_url
    return result


def render_markdown(diag: dict[str, Any]) -> str:
    host = diag.get("host") or {}
    lines = [
        f"# Diagnostico SNMP read-only: {host.get('name') or host.get('host') or '(unknown)'}",
        "",
        f"- Generado: {now_text()}",
        f"- Hostid: `{host.get('hostid')}`",
        f"- Interfaz SNMP: `{diag.get('snmp_target') or 'none'}`",
        f"- Macro comunidad: `{(diag.get('community_macro_selected') or {}).get('macro', 'no visible')}`",
        f"- Conclusion: `{diag.get('conclusion')}`",
        f"- Recomendacion: {diag.get('recommendation', '')}",
        "",
        "## Pruebas basicas",
    ]
    rows = []
    for name, result in (diag.get("probes") or {}).items():
        rows.append([name, "OK" if result.get("ok") else "FAIL", result.get("stdout") or result.get("stderr") or ""])
    lines.append(zbx.md_table(["Prueba", "Estado", "Resultado"], rows))
    lines.append("## OIDs unsupported probadas")
    rows = []
    for entry in diag.get("failed_oid_probes") or []:
        item = entry.get("item") or {}
        probe = entry.get("probe") or {}
        rows.append([
            item.get("itemid"),
            item.get("name"),
            item.get("normalized_oid"),
            "OK" if probe.get("ok") else "FAIL",
            probe.get("stdout") or probe.get("stderr") or "",
        ])
    lines.append(zbx.md_table(["Item", "Nombre", "OID", "Estado", "Resultado"], rows))
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only SNMP diagnostics for one Zabbix host.")
    parser.add_argument("--host", required=True, help="Zabbix host/name to diagnose")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of Markdown")
    parser.add_argument("--timeout", type=int, default=SNMP_TIMEOUT, help="SNMP timeout in seconds")
    parser.add_argument("--failed-oid-limit", type=int, default=6, help="Unsupported OIDs to probe")
    parser.add_argument("--no-walks", action="store_true", help="Skip ifDescr/ifOperStatus walks")
    args = parser.parse_args()

    result = diagnose_host_by_name(
        args.host,
        timeout=max(args.timeout, 1),
        failed_oid_limit=max(args.failed_oid_limit, 0),
        include_walks=not args.no_walks,
    )
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
    else:
        print(render_markdown(result), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
