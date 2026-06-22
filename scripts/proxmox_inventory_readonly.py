#!/usr/bin/env python3
"""Read-only Proxmox VE inventory collector.

Reads optional credentials from /etc/zabbix-codex/proxmox.env. If the file is
missing or incomplete, the script still writes placeholder inventory files that
document the missing configuration. No write/delete API endpoints are called.
"""

from __future__ import annotations

import json
import re
import ssl
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import plan_zabbix_remediation as zbx  # noqa: E402


ENV_FILE = Path("/etc/zabbix-codex/proxmox.env")
BASE_DIR = Path("/opt/zabbix-codex")
OUT_JSON = BASE_DIR / "proxmox" / "proxmox-real-inventory.json"
OUT_MD = BASE_DIR / "proxmox" / "proxmox-real-inventory.md"
TIMEOUT_SECONDS = 20

REQUIRED_KEYS = ["PROXMOX_ENDPOINT", "PROXMOX_TOKEN_ID", "PROXMOX_TOKEN_SECRET"]
READ_ONLY_ENDPOINTS = [
    "/version",
    "/cluster/status",
    "/cluster/resources",
    "/cluster/backup",
    "/cluster/jobs",
    "/nodes",
    "/nodes/{node}/status",
    "/nodes/{node}/qemu",
    "/nodes/{node}/lxc",
    "/nodes/{node}/storage",
    "/nodes/{node}/tasks",
    "/nodes/{node}/services",
    "/nodes/{node}/disks/list",
    "/nodes/{node}/ceph/status",
]


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


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


def bool_from_env(value: str, default: bool = True) -> bool:
    if value == "":
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def sanitize_endpoint(endpoint: str) -> str:
    if not endpoint:
        return ""
    parts = urlsplit(endpoint)
    netloc = parts.hostname or ""
    if parts.port:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, "", "", ""))


def mask(value: str) -> str:
    return f"<masked,length={len(value or '')}>"


class ProxmoxClient:
    def __init__(self, endpoint: str, token_id: str, token_secret: str, verify_ssl: bool) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token_id = token_id
        self.token_secret = token_secret
        self.context = None if verify_ssl else ssl._create_unverified_context()

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        query = f"?{urlencode(params)}" if params else ""
        request = Request(
            f"{self.endpoint}/api2/json{path}{query}",
            headers={
                "Authorization": f"PVEAPIToken={self.token_id}={self.token_secret}",
                "Accept": "application/json",
                "User-Agent": "zabbix-codex-proxmox-readonly/1.0",
            },
            method="GET",
        )
        with urlopen(request, timeout=TIMEOUT_SECONDS, context=self.context) as response:
            body = json.loads(response.read().decode("utf-8"))
        return body.get("data")


def safe_get(client: ProxmoxClient, path: str, errors: list[dict[str, str]], params: dict[str, Any] | None = None) -> Any:
    try:
        return client.get(path, params=params)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        errors.append({"endpoint": path, "error": f"HTTP {exc.code}: {body[:300]}"})
    except URLError as exc:
        errors.append({"endpoint": path, "error": f"Connection error: {exc.reason}"})
    except TimeoutError:
        errors.append({"endpoint": path, "error": f"Timeout after {TIMEOUT_SECONDS}s"})
    except Exception as exc:  # noqa: BLE001 - keep inventory generation partial.
        errors.append({"endpoint": path, "error": str(exc)})
    return None


def missing_config_data(env: dict[str, str]) -> list[str]:
    if not env:
        return REQUIRED_KEYS
    return [key for key in REQUIRED_KEYS if not env.get(key)]


def backup_task(task: dict[str, Any]) -> bool:
    text = " ".join(str(task.get(key, "")) for key in ["upid", "type", "worker_type", "id", "user"]).lower()
    return any(word in text for word in ["vzdump", "backup", "pbs"])


def collect_inventory(env: dict[str, str]) -> dict[str, Any]:
    missing = missing_config_data(env)
    metadata = {
        "generated_at": now_text(),
        "generated_epoch": int(time.time()),
        "mode": "read-only",
        "config_file": str(ENV_FILE),
        "config_present": ENV_FILE.exists(),
        "endpoint": sanitize_endpoint(env.get("PROXMOX_ENDPOINT", "")),
        "token_id": mask(env.get("PROXMOX_TOKEN_ID", "")) if env.get("PROXMOX_TOKEN_ID") else "",
        "verify_ssl": bool_from_env(env.get("PROXMOX_VERIFY_SSL", "true")),
        "read_only_endpoints": READ_ONLY_ENDPOINTS,
    }
    if missing:
        return {
            "metadata": metadata,
            "access": {
                "available": False,
                "reason": "missing_or_incomplete_config",
                "missing_keys": missing,
                "required_config": {
                    "path": str(ENV_FILE),
                    "keys": [
                        "PROXMOX_ENDPOINT",
                        "PROXMOX_TOKEN_ID",
                        "PROXMOX_TOKEN_SECRET",
                        "PROXMOX_VERIFY_SSL",
                    ],
                    "minimum_read_privileges": [
                        "Sys.Audit",
                        "VM.Audit",
                        "Datastore.Audit",
                        "SDN.Audit if SDN is used",
                    ],
                },
            },
            "summary": empty_summary(),
            "version": None,
            "cluster_status": [],
            "nodes": [],
            "resources": [],
            "qemu_vms": [],
            "lxc_containers": [],
            "storages": [],
            "backup_jobs": [],
            "recent_backup_tasks": [],
            "ceph": {"detected": False, "status_by_node": []},
            "services_by_node": {},
            "physical_disks_by_node": {},
            "api_errors": [],
        }

    errors: list[dict[str, str]] = []
    client = ProxmoxClient(
        env["PROXMOX_ENDPOINT"],
        env["PROXMOX_TOKEN_ID"],
        env["PROXMOX_TOKEN_SECRET"],
        bool_from_env(env.get("PROXMOX_VERIFY_SSL", "true")),
    )
    version = safe_get(client, "/version", errors)
    cluster_status = safe_get(client, "/cluster/status", errors) or []
    resources = safe_get(client, "/cluster/resources", errors) or []
    nodes = safe_get(client, "/nodes", errors) or []
    backup_jobs = safe_get(client, "/cluster/backup", errors) or []
    cluster_jobs = safe_get(client, "/cluster/jobs", errors) or []

    qemu_vms: list[dict[str, Any]] = []
    lxc_containers: list[dict[str, Any]] = []
    storages: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    ceph_status: list[dict[str, Any]] = []
    services_by_node: dict[str, Any] = {}
    physical_disks_by_node: dict[str, Any] = {}
    node_status: dict[str, Any] = {}

    for node in nodes:
        node_name = str(node.get("node") or "")
        if not node_name:
            continue
        node_path = quote(node_name, safe="")
        node_status[node_name] = safe_get(client, f"/nodes/{node_path}/status", errors)
        for vm in safe_get(client, f"/nodes/{node_path}/qemu", errors) or []:
            vm["node"] = node_name
            qemu_vms.append(vm)
        for ct in safe_get(client, f"/nodes/{node_path}/lxc", errors) or []:
            ct["node"] = node_name
            lxc_containers.append(ct)
        for storage in safe_get(client, f"/nodes/{node_path}/storage", errors) or []:
            storage["node"] = node_name
            storages.append(storage)
        node_tasks = safe_get(client, f"/nodes/{node_path}/tasks", errors, params={"limit": 100}) or []
        for task in node_tasks:
            task["node"] = node_name
            tasks.append(task)
        services_by_node[node_name] = safe_get(client, f"/nodes/{node_path}/services", errors)
        physical_disks_by_node[node_name] = safe_get(client, f"/nodes/{node_path}/disks/list", errors)
        ceph = safe_get(client, f"/nodes/{node_path}/ceph/status", errors)
        if ceph is not None:
            ceph_status.append({"node": node_name, "status": ceph})

    recent_backup_tasks = [task for task in tasks if backup_task(task)]
    data = {
        "metadata": metadata,
        "access": {"available": True, "reason": "ok", "missing_keys": []},
        "summary": {
            "nodes_total": len(nodes),
            "qemu_vms_total": len(qemu_vms),
            "lxc_containers_total": len(lxc_containers),
            "storages_total": len(storages),
            "cluster_resources_total": len(resources),
            "backup_jobs_total": len(backup_jobs),
            "cluster_jobs_total": len(cluster_jobs),
            "recent_backup_tasks_total": len(recent_backup_tasks),
            "ceph_detected": bool(ceph_status),
            "api_errors_total": len(errors),
        },
        "version": version,
        "cluster_status": cluster_status,
        "nodes": nodes,
        "node_status": node_status,
        "resources": resources,
        "qemu_vms": qemu_vms,
        "lxc_containers": lxc_containers,
        "storages": storages,
        "backup_jobs": backup_jobs,
        "cluster_jobs": cluster_jobs,
        "recent_backup_tasks": recent_backup_tasks,
        "ceph": {"detected": bool(ceph_status), "status_by_node": ceph_status},
        "services_by_node": services_by_node,
        "physical_disks_by_node": physical_disks_by_node,
        "api_errors": errors,
    }
    return data


def empty_summary() -> dict[str, int | bool]:
    return {
        "nodes_total": 0,
        "qemu_vms_total": 0,
        "lxc_containers_total": 0,
        "storages_total": 0,
        "cluster_resources_total": 0,
        "backup_jobs_total": 0,
        "cluster_jobs_total": 0,
        "recent_backup_tasks_total": 0,
        "ceph_detected": False,
        "api_errors_total": 0,
    }


def render_markdown(data: dict[str, Any]) -> str:
    lines = [
        "# Inventario real Proxmox VE read-only",
        "",
        f"- Generado: {data['metadata']['generated_at']}",
        f"- Configuracion presente: `{data['metadata']['config_present']}`",
        f"- Endpoint: `{data['metadata'].get('endpoint') or 'no configurado'}`",
        f"- Acceso real Proxmox: `{data['access']['available']}`",
        "",
    ]
    if not data["access"]["available"]:
        lines.extend(
            [
                "## Datos pendientes de Proxmox/PBS",
                "",
                "No existe configuracion completa en `/etc/zabbix-codex/proxmox.env`. La fase continua usando solo datos de Zabbix.",
                "",
                "Claves necesarias:",
                "",
                zbx.bullet_list(data["access"]["required_config"]["keys"]),
                "Privilegios minimos recomendados:",
                "",
                zbx.bullet_list(data["access"]["required_config"]["minimum_read_privileges"]),
            ]
        )
        return "\n".join(lines) + "\n"

    summary = data["summary"]
    lines.extend(
        [
            "## Resumen",
            "",
            f"- Nodos: `{summary['nodes_total']}`",
            f"- VMs QEMU: `{summary['qemu_vms_total']}`",
            f"- Contenedores LXC: `{summary['lxc_containers_total']}`",
            f"- Storages: `{summary['storages_total']}`",
            f"- Jobs backup: `{summary['backup_jobs_total']}`",
            f"- Tareas recientes de backup: `{summary['recent_backup_tasks_total']}`",
            f"- Ceph detectado: `{summary['ceph_detected']}`",
            "",
            "## Nodos",
        ]
    )
    lines.append(zbx.md_table(["Nodo", "Status", "CPU", "Mem", "Uptime"], [[n.get("node"), n.get("status"), n.get("cpu"), n.get("mem"), n.get("uptime")] for n in data["nodes"]]))
    lines.append("## VMs")
    lines.append(zbx.md_table(["VMID", "Nombre", "Nodo", "Status", "CPU", "Mem"], [[v.get("vmid"), v.get("name"), v.get("node"), v.get("status"), v.get("cpu"), v.get("mem")] for v in data["qemu_vms"]]))
    lines.append("## LXCs")
    lines.append(zbx.md_table(["VMID", "Nombre", "Nodo", "Status", "CPU", "Mem"], [[c.get("vmid"), c.get("name"), c.get("node"), c.get("status"), c.get("cpu"), c.get("mem")] for c in data["lxc_containers"]]))
    lines.append("## Storages")
    lines.append(zbx.md_table(["Nodo", "Storage", "Tipo", "Activo", "Total", "Usado", "Disponible"], [[s.get("node"), s.get("storage"), s.get("type"), s.get("active"), s.get("total"), s.get("used"), s.get("avail")] for s in data["storages"]]))
    if data.get("api_errors"):
        lines.append("## Errores API parciales")
        lines.append(zbx.md_table(["Endpoint", "Error"], [[e.get("endpoint"), e.get("error")] for e in data["api_errors"]]))
    return "\n".join(lines) + "\n"


def main() -> int:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    env = load_env(ENV_FILE)
    data = collect_inventory(env)
    OUT_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    OUT_MD.write_text(render_markdown(data), encoding="utf-8")
    print(
        "Proxmox inventory written: "
        f"{OUT_JSON} (access={data['access']['available']}, nodes={data['summary']['nodes_total']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
