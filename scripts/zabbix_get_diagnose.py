#!/usr/bin/env python3
"""Read-only local zabbix_get diagnostics for the Zabbix agent."""

from __future__ import annotations

import hashlib
import json
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


BASE_DIR = Path("/opt/zabbix-codex")
DIAGNOSTICS_DIR = BASE_DIR / "diagnostics"
REPORTS_DIR = BASE_DIR / "reports"
LOCAL_JSON = DIAGNOSTICS_DIR / "zabbix-get-local.json"
LOCAL_MD = REPORTS_DIR / "zabbix-get-local-diagnostics.md"

CHECKS = [
    ("agent.ping", "Agent ping"),
    ("system.uname", "Kernel/OS"),
    ("vfs.fs.discovery", "Filesystem discovery"),
    ("net.if.discovery", "Network interface discovery"),
    ("system.sw.packages.get", "Installed packages inventory"),
    ("proc.num[zabbix_server]", "zabbix_server process count"),
    ("proc.num[zabbix_agentd]", "zabbix_agentd process count"),
    ("proc.num[zabbix_agent2]", "zabbix_agent2 process count"),
    ("proc.num[snmptrapd]", "snmptrapd process count"),
    ("proc.num[java]", "java process count"),
    ("proc.num[nginx]", "nginx process count"),
    ("proc.num[php-fpm]", "php-fpm process count"),
    ("proc.num[mariadbd]", "mariadbd process count"),
]


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
    except Exception as exc:  # noqa: BLE001 - diagnostics should continue on partial permissions.
        errors.append({"method": method, "error": str(exc)})
        return default


def fetch_zabbix_server(api: zbx.ZabbixApi, errors: list[dict[str, str]]) -> dict[str, Any] | None:
    hosts = safe_call(
        api,
        "host.get",
        {
            "output": ["hostid", "host", "name", "status"],
            "selectInterfaces": "extend",
            "selectGroups": ["groupid", "name"],
            "selectParentTemplates": ["templateid", "host", "name"],
            "search": {"host": "Zabbix server"},
        },
        errors,
        [],
    )
    for host in hosts:
        if str(host.get("host") or "").lower() == "zabbix server" or str(host.get("name") or "").lower() == "zabbix server":
            return host
    return hosts[0] if hosts else None


def agent_interface(host: dict[str, Any] | None) -> dict[str, Any] | None:
    if not host:
        return None
    interfaces = [iface for iface in host.get("interfaces") or [] if str(iface.get("type")) == "1"]
    if not interfaces:
        return None
    for iface in interfaces:
        if str(iface.get("main")) == "1":
            return iface
    return interfaces[0]


def interface_target(interface: dict[str, Any] | None) -> tuple[str, str]:
    if not interface:
        return "127.0.0.1", "10050"
    useip = str(interface.get("useip", "1")) == "1"
    address = str(interface.get("ip") if useip else interface.get("dns") or interface.get("ip") or "127.0.0.1")
    return address or "127.0.0.1", str(interface.get("port") or "10050")


def run_zabbix_get(server: str, port: str, key: str, timeout: int = 8) -> dict[str, Any]:
    args = ["zabbix_get", "-s", server, "-p", port, "-k", key, "-t", str(timeout)]
    try:
        completed = subprocess.run(  # noqa: S603 - args are explicit and no shell is used.
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout + 2,
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        return compact_output(completed.returncode, stdout, stderr, args)
    except FileNotFoundError:
        return compact_output(None, "", "zabbix_get command not found", args)
    except subprocess.TimeoutExpired as exc:
        return compact_output(None, exc.stdout or "", exc.stderr or f"timeout after {timeout}s", args)


def compact_output(returncode: int | None, stdout: str, stderr: str, args: list[str]) -> dict[str, Any]:
    stdout = stdout.strip()
    stderr = stderr.strip()
    output_hash = hashlib.sha256(stdout.encode("utf-8")).hexdigest() if stdout else ""
    parsed_hint: dict[str, Any] = {}
    if stdout.startswith("[") or stdout.startswith("{"):
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, list):
                parsed_hint["json_type"] = "list"
                parsed_hint["json_count"] = len(parsed)
            elif isinstance(parsed, dict):
                parsed_hint["json_type"] = "dict"
                parsed_hint["json_keys"] = sorted(list(parsed.keys()))[:20]
        except json.JSONDecodeError:
            parsed_hint["json_parse_error"] = True
    return {
        "ok": returncode == 0 and bool(stdout),
        "returncode": returncode,
        "stdout_length": len(stdout),
        "stdout_sha256": output_hash,
        "stdout_sample": stdout[:1400] + (f"\n... <truncated {len(stdout) - 1400} chars>" if len(stdout) > 1400 else ""),
        "stderr": stderr[:1000],
        "command": args,
        **parsed_hint,
    }


def fetch_matching_items(api: zbx.ZabbixApi, hostid: str, keys: list[str], errors: list[dict[str, str]]) -> dict[str, Any]:
    items = safe_call(
        api,
        "item.get",
        {
            "output": ["itemid", "name", "key_", "type", "status", "state", "error", "lastclock", "lastvalue"],
            "hostids": [hostid],
            "filter": {"key_": keys},
        },
        errors,
        [],
    )
    return {str(item.get("key_")): item for item in items}


def render_markdown(data: dict[str, Any]) -> str:
    lines = [
        "# Diagnostico zabbix_get local",
        "",
        "Pruebas read-only ejecutadas contra la interfaz agent del host `Zabbix server` conocida por Zabbix.",
        "",
        f"- Generado: {data['metadata']['generated_at']}",
        f"- Target: `{data['target']['server']}:{data['target']['port']}`",
        f"- Checks ejecutados: `{len(data['checks'])}`",
        "",
        "## Resultados",
    ]
    rows = []
    for check in data.get("checks") or []:
        result = check.get("result") or {}
        item = check.get("zabbix_item") or {}
        rows.append(
            [
                check.get("key"),
                "OK" if result.get("ok") else "FAIL",
                result.get("stdout_sample") or result.get("stderr") or "",
                "unsupported" if str(item.get("state")) == "1" else ("normal" if item else "sin item directo"),
            ]
        )
    lines.append(zbx.md_table(["Key", "Estado", "Salida", "Estado item Zabbix"], rows))
    return "\n".join(lines) + "\n"


def main() -> int:
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    api, safe_url = make_api()
    errors: list[dict[str, str]] = []
    host = fetch_zabbix_server(api, errors)
    interface = agent_interface(host)
    server, port = interface_target(interface)
    keys = [key for key, _label in CHECKS]
    items_by_key = fetch_matching_items(api, str((host or {}).get("hostid") or ""), keys, errors) if host else {}

    checks = []
    if not shutil.which("zabbix_get"):
        for key, label in CHECKS:
            checks.append(
                {
                    "key": key,
                    "label": label,
                    "result": compact_output(None, "", "zabbix_get command not found", ["zabbix_get", "-k", key]),
                    "zabbix_item": items_by_key.get(key),
                }
            )
    else:
        for key, label in CHECKS:
            checks.append(
                {
                    "key": key,
                    "label": label,
                    "result": run_zabbix_get(server, port, key),
                    "zabbix_item": items_by_key.get(key),
                }
            )

    data = {
        "metadata": {
            "generated_at": now_text(),
            "generated_epoch": int(time.time()),
            "api_endpoint": safe_url,
            "mode": "read-only",
        },
        "host": {
            "hostid": (host or {}).get("hostid"),
            "host": (host or {}).get("host"),
            "name": (host or {}).get("name"),
            "status": "enabled" if str((host or {}).get("status")) == "0" else "disabled",
        },
        "target": {
            "server": server,
            "port": port,
            "interface": zbx.summarize_interface(interface) if interface else None,
        },
        "summary": {
            "checks_total": len(checks),
            "checks_ok": sum(1 for check in checks if (check.get("result") or {}).get("ok")),
            "checks_failed": sum(1 for check in checks if not (check.get("result") or {}).get("ok")),
        },
        "checks": checks,
        "api_errors": errors,
    }

    LOCAL_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    LOCAL_MD.write_text(render_markdown(data), encoding="utf-8")
    print(
        "zabbix_get diagnostics written: "
        f"{LOCAL_JSON} ({data['summary']['checks_ok']}/{data['summary']['checks_total']} checks OK)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
