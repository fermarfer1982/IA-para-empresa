#!/usr/bin/env python3
"""Dry-run by default: prepare Proxmox storage/backup metrics for Zabbix."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

BASE_DIR = Path("/opt/zabbix-codex")
ENV_FILE = Path("/etc/zabbix-codex/proxmox.env")
ZABBIX_ENV_FILE = Path("/etc/zabbix-codex/zabbix.env")
DEFAULT_INVENTORY = BASE_DIR / "proxmox" / "proxmox-real-inventory.json"
PROXMOX_INVENTORY_SCRIPT = BASE_DIR / "scripts" / "proxmox_inventory_readonly.py"
DEFAULT_HOST = "Proxmox Storage Monitoring"


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^export\s+", "", line)
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def api_url_from_env(raw_url: str) -> str:
    url = raw_url.rstrip("/")
    if url.endswith("api_jsonrpc.php"):
        return url
    return f"{url}/api_jsonrpc.php"


def sanitize_url(url: str) -> str:
    parts = urlsplit(url)
    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def zabbix_api_call(env: dict[str, str], method: str, params: Any, auth: bool = True) -> Any:
    if not env.get("ZABBIX_URL") or not env.get("ZABBIX_TOKEN"):
        raise RuntimeError(f"Missing ZABBIX_URL/ZABBIX_TOKEN in {ZABBIX_ENV_FILE}")
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    }
    headers = {
        "Content-Type": "application/json-rpc",
        "User-Agent": "zabbix-codex-push-proxmox-metrics/1.0",
    }
    if auth:
        headers["Authorization"] = f"Bearer {env['ZABBIX_TOKEN']}"
    request = Request(
        api_url_from_env(env["ZABBIX_URL"]),
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"Zabbix API HTTP {exc.code} at {sanitize_url(api_url_from_env(env['ZABBIX_URL']))}") from exc
    except URLError as exc:
        raise RuntimeError(f"Zabbix API connection error: {exc.reason}") from exc
    if "error" in body:
        error = body["error"]
        raise RuntimeError(f"Zabbix API error {error.get('code')}: {error.get('message')} {error.get('data', '')}")
    return body.get("result")


def existing_item_map(zabbix_env: dict[str, str], host: str) -> dict[str, dict[str, Any]]:
    hosts = zabbix_api_call(zabbix_env, "host.get", {"output": ["hostid", "host", "name"], "filter": {"host": [host]}})
    if not hosts:
        hosts = zabbix_api_call(zabbix_env, "host.get", {"output": ["hostid", "host", "name"], "filter": {"name": [host]}})
    if not hosts:
        return {}
    hostid = hosts[0]["hostid"]
    items = zabbix_api_call(
        zabbix_env,
        "item.get",
        {
            "output": ["itemid", "key_", "name", "value_type", "state", "status"],
            "hostids": [hostid],
            "filter": {"type": "2"},
        },
    )
    return {item["key_"]: item for item in items}


def filter_existing_metrics(
    metrics: list[tuple[str, str, Any]],
    item_map: dict[str, dict[str, Any]],
) -> tuple[list[tuple[str, str, Any]], list[tuple[str, str, Any]]]:
    accepted = []
    skipped = []
    for metric_item in metrics:
        if metric_item[1] in item_map:
            accepted.append(metric_item)
        else:
            skipped.append(metric_item)
    return accepted, skipped


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def usage_percent(storage: dict[str, Any]) -> float:
    if storage.get("used_fraction") is not None:
        return round(to_float(storage.get("used_fraction")) * 100, 3)
    total = to_float(storage.get("total"))
    if total <= 0:
        return 0.0
    return round((to_float(storage.get("used")) / total) * 100, 3)


def metric(host: str, key: str, value: Any) -> tuple[str, str, Any]:
    return host, key, value


def backup_job_vmids(jobs: list[dict[str, Any]]) -> set[str]:
    vmids: set[str] = set()
    for job in jobs:
        raw = str(job.get("vmid", "") or "")
        for part in re.split(r"[\s,;]+", raw):
            if part.strip().isdigit():
                vmids.add(part.strip())
    return vmids


def failed_task(task: dict[str, Any]) -> bool:
    status = str(task.get("status", "")).strip()
    return bool(status) and status.upper() != "OK"


def failed_tasks_since(tasks: list[dict[str, Any]], hours: int) -> int:
    cutoff = int(time.time()) - hours * 3600
    return sum(1 for task in tasks if failed_task(task) and to_int(task.get("starttime")) >= cutoff)


def collect_metrics(inventory: dict[str, Any], host: str) -> list[tuple[str, str, Any]]:
    metrics: list[tuple[str, str, Any]] = []
    storages = inventory.get("storages") or []
    vms = (inventory.get("qemu_vms") or []) + (inventory.get("lxc_containers") or [])
    jobs = inventory.get("backup_jobs") or []
    tasks = inventory.get("recent_backup_tasks") or []
    job_vmids = backup_job_vmids(jobs)

    metrics.append(metric(host, "proxmox.collection_status", 1 if storages else 0))
    metrics.append(metric(host, "proxmox.storage.discovery", json.dumps({"data": [
        {
            "{#NODE}": str(storage.get("node", "")),
            "{#STORAGE}": str(storage.get("storage", "")),
            "{#TYPE}": str(storage.get("type", "")),
        }
        for storage in storages
    ]}, separators=(",", ":"))))

    for storage in storages:
        node = str(storage.get("node", ""))
        name = str(storage.get("storage", ""))
        metrics.extend([
            metric(host, f"proxmox.storage.usage_percent[{node},{name}]", usage_percent(storage)),
            metric(host, f"proxmox.storage.total_bytes[{node},{name}]", to_int(storage.get("total"))),
            metric(host, f"proxmox.storage.used_bytes[{node},{name}]", to_int(storage.get("used"))),
            metric(host, f"proxmox.storage.free_bytes[{node},{name}]", to_int(storage.get("avail"))),
            metric(host, f"proxmox.storage.active[{node},{name}]", to_int(storage.get("active"))),
            metric(host, f"proxmox.storage.enabled[{node},{name}]", to_int(storage.get("enabled"))),
        ])

    metrics.extend([
        metric(host, "proxmox.backup.jobs_total", len(jobs)),
        metric(host, "proxmox.backup.failed_tasks_24h", failed_tasks_since(tasks, 24)),
        metric(host, "proxmox.backup.failed_tasks_48h", failed_tasks_since(tasks, 48)),
    ])

    metrics.append(metric(host, "proxmox.backup.vm.discovery", json.dumps({"data": [
        {
            "{#VMID}": str(vm.get("vmid", "")),
            "{#VMNAME}": str(vm.get("name", "")),
            "{#NODE}": str(vm.get("node", "")),
        }
        for vm in vms
    ]}, separators=(",", ":"))))

    for vm in vms:
        vmid = str(vm.get("vmid", ""))
        in_job = 1 if vmid in job_vmids else 0
        metrics.extend([
            metric(host, f"proxmox.backup.vm_in_job[{vmid}]", in_job),
            metric(host, f"proxmox.backup.vm_without_job[{vmid}]", 0 if in_job else 1),
        ])
    return metrics


def format_sender_value(value: Any) -> str:
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def sender_lines(metrics: list[tuple[str, str, Any]]) -> str:
    return "\n".join(f'"{host}" {key} {format_sender_value(value)}' for host, key, value in metrics) + "\n"


def send_metrics(metrics: list[tuple[str, str, Any]], server: str, port: int, sender_bin: str) -> int:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
        handle.write(sender_lines(metrics))
        temp_path = handle.name
    try:
        result = subprocess.run(
            [sender_bin, "-z", server, "-p", str(port), "-i", temp_path],
            text=True,
            capture_output=True,
            check=False,
        )
        if result.stdout:
            print(result.stdout.strip())
        if result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
        return result.returncode
    finally:
        Path(temp_path).unlink(missing_ok=True)


def parse_sender_info(info: str, total: int) -> dict[str, Any]:
    processed = None
    failed = None
    match = re.search(r"processed:\s*(\d+);\s*failed:\s*(\d+);", info)
    if match:
        processed = int(match.group(1))
        failed = int(match.group(2))
    return {
        "processed": processed if processed is not None else "unknown",
        "failed": failed if failed is not None else "unknown",
        "total": total,
        "info": info,
    }


def send_metrics_native(metrics: list[tuple[str, str, Any]], server: str, port: int) -> int:
    clock = int(time.time())
    payload = {
        "request": "sender data",
        "data": [
            {
                "host": host,
                "key": key,
                "value": str(value),
                "clock": clock,
            }
            for host, key, value in metrics
        ],
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    packet = b"ZBXD\x01" + struct.pack("<Q", len(body)) + body
    with socket.create_connection((server, port), timeout=10) as sock:
        sock.sendall(packet)
        header = sock.recv(13)
        if len(header) != 13 or not header.startswith(b"ZBXD\x01"):
            raise RuntimeError("Invalid Zabbix sender response header")
        length = struct.unpack("<Q", header[5:13])[0]
        chunks = []
        received = 0
        while received < length:
            chunk = sock.recv(min(65536, length - received))
            if not chunk:
                break
            chunks.append(chunk)
            received += len(chunk)
    response = json.loads(b"".join(chunks).decode("utf-8"))
    info = str(response.get("info", ""))
    summary = parse_sender_info(info, len(metrics))
    summary["method"] = "native_sender_protocol"
    summary["response"] = response.get("response")
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary.get("failed") in {0, "0"} and response.get("response") == "success" else 2


def push_history_api(
    metrics: list[tuple[str, str, Any]],
    zabbix_env: dict[str, str],
    item_map: dict[str, dict[str, Any]],
) -> int:
    clock = int(time.time())
    history = []
    missing = []
    for _host, key, value in metrics:
        item = item_map.get(key)
        if not item:
            missing.append(key)
            continue
        history.append({"itemid": item["itemid"], "clock": clock, "value": str(value)})
    if not history:
        print(json.dumps({"method": "history.push", "processed": 0, "failed": len(metrics), "reason": "no matching itemids"}, ensure_ascii=False))
        return 2
    result = zabbix_api_call(zabbix_env, "history.push", history)
    processed = int(result.get("processed", len(history))) if isinstance(result, dict) else len(history)
    failed = len(history) - processed + len(missing)
    print(json.dumps({"method": "history.push", "processed": processed, "failed": failed, "total": len(metrics)}, ensure_ascii=False))
    return 0 if failed == 0 else 2


def send_metrics_auto(
    metrics: list[tuple[str, str, Any]],
    server: str,
    port: int,
    sender_bin: str,
    method: str,
    zabbix_env: dict[str, str],
    item_map: dict[str, dict[str, Any]],
) -> int:
    if method in {"sender", "auto"} and shutil.which(sender_bin):
        rc = send_metrics(metrics, server, port, sender_bin)
        print(json.dumps({"method": "zabbix_sender", "processed": "see zabbix_sender output", "failed": "see zabbix_sender output", "total": len(metrics)}, ensure_ascii=False))
        return rc
    if method == "sender":
        print(f"zabbix_sender not found: {sender_bin}", file=sys.stderr)
        return 127
    if method in {"native", "auto"}:
        return send_metrics_native(metrics, server, port)
    return push_history_api(metrics, zabbix_env, item_map)


def refresh_inventory() -> int:
    result = subprocess.run(
        [sys.executable, str(PROXMOX_INVENTORY_SCRIPT)],
        cwd=str(BASE_DIR),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare/send Proxmox metrics to Zabbix trapper items.")
    parser.add_argument("--inventory-json", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--server", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=10051)
    parser.add_argument("--sender-bin", default="zabbix_sender")
    parser.add_argument("--method", choices=["auto", "sender", "native", "api"], default="auto")
    parser.add_argument("--send", action="store_true", help="Actually send metrics. Default is dry-run.")
    parser.add_argument("--refresh-inventory", action="store_true", help="Refresh Proxmox inventory with the read-only collector before preparing metrics.")
    parser.add_argument("--limit", type=int, default=0, help="Limit printed dry-run metrics.")
    parser.add_argument("--all-metrics", action="store_true", help="Do not filter to existing Zabbix trapper items.")
    parser.add_argument("--json", action="store_true", help="Print metrics as JSON in dry-run.")
    args = parser.parse_args()

    env = load_env(ENV_FILE)
    zabbix_env = load_env(ZABBIX_ENV_FILE)
    if not env:
        print(f"warning: {ENV_FILE} not found; using existing inventory only", file=sys.stderr)
    if args.refresh_inventory:
        rc = refresh_inventory()
        if rc != 0:
            return rc
    inventory = read_json(args.inventory_json)
    metrics = collect_metrics(inventory, args.host)
    skipped: list[tuple[str, str, Any]] = []
    item_map: dict[str, dict[str, Any]] = {}
    if not args.all_metrics:
        item_map = existing_item_map(zabbix_env, args.host)
        metrics, skipped = filter_existing_metrics(metrics, item_map)
    if args.limit:
        metrics = metrics[: args.limit]

    if args.send:
        return send_metrics_auto(metrics, args.server, args.port, args.sender_bin, args.method, zabbix_env, item_map)

    print(f"DRY-RUN: {len(metrics)} Proxmox metrics prepared for host {args.host}.")
    if skipped:
        print(f"DRY-RUN: {len(skipped)} metrics skipped because matching Zabbix items do not exist.")
    if args.json:
        print(json.dumps([{"host": h, "key": k, "value": v} for h, k, v in metrics], indent=2, ensure_ascii=False))
    else:
        for host, key, value in metrics:
            print(f"{host} {key} {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
