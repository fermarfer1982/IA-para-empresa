#!/usr/bin/env python3
"""Read-only Proxmox Backup Server inventory collector."""

from __future__ import annotations

import json
import re
import ssl
import sys
import time
from collections import defaultdict
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
OUT_JSON = BASE_DIR / "backups" / "pbs-real-inventory.json"
OUT_MD = BASE_DIR / "backups" / "pbs-real-inventory.md"
TIMEOUT_SECONDS = 20

REQUIRED_KEYS = ["PBS_ENDPOINT", "PBS_TOKEN_ID", "PBS_TOKEN_SECRET"]
READ_ONLY_ENDPOINTS = [
    "/version",
    "/nodes",
    "/nodes/{node}/tasks",
    "/admin/datastore",
    "/admin/datastore/{store}/status",
    "/admin/datastore/{store}/snapshots",
    "/admin/datastore/{store}/gc",
    "/admin/datastore/{store}/groups",
    "/admin/datastore/{store}/prune",
    "/admin/datastore/{store}/verify",
    "/config/datastore",
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


def pbs_auth_header(token_id: str, token_secret: str) -> str:
    """Build the exact PBS API token authorization header value.

    Required format:
    Authorization: PBSAPIToken=<PBS_TOKEN_ID>:<PBS_TOKEN_SECRET>
    """
    return f"PBSAPIToken={token_id}:{token_secret}"


def masked_auth_header(token_id: str, token_secret: str) -> str:
    return f"PBSAPIToken={mask(token_id)}:{mask(token_secret)}"


class PbsClient:
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
                "Authorization": pbs_auth_header(self.token_id, self.token_secret),
                "Accept": "application/json",
                "User-Agent": "zabbix-codex-pbs-readonly/1.0",
            },
            method="GET",
        )
        with urlopen(request, timeout=TIMEOUT_SECONDS, context=self.context) as response:
            body = json.loads(response.read().decode("utf-8"))
        return body.get("data")

    def probe(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = f"?{urlencode(params)}" if params else ""
        url = f"{self.endpoint}/api2/json{path}{query}"
        request = Request(
            url,
            headers={
                "Authorization": pbs_auth_header(self.token_id, self.token_secret),
                "Accept": "application/json",
                "User-Agent": "zabbix-codex-pbs-readonly/1.0",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=TIMEOUT_SECONDS, context=self.context) as response:
                body = json.loads(response.read().decode("utf-8"))
                return {
                    "ok": True,
                    "status_code": response.status,
                    "endpoint": path,
                    "data": body.get("data"),
                    "error": "",
                }
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            return {
                "ok": False,
                "status_code": exc.code,
                "endpoint": path,
                "data": None,
                "error": body[:300],
            }
        except URLError as exc:
            return {
                "ok": False,
                "status_code": None,
                "endpoint": path,
                "data": None,
                "error": f"Connection error: {exc.reason}",
            }
        except TimeoutError:
            return {
                "ok": False,
                "status_code": None,
                "endpoint": path,
                "data": None,
                "error": f"Timeout after {TIMEOUT_SECONDS}s",
            }
        except Exception as exc:  # noqa: BLE001 - inventory must continue on partial PBS permissions.
            return {
                "ok": False,
                "status_code": None,
                "endpoint": path,
                "data": None,
                "error": str(exc),
            }


def safe_get(client: PbsClient, path: str, errors: list[dict[str, str]], params: dict[str, Any] | None = None) -> Any:
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


def empty_summary() -> dict[str, int]:
    return {
        "datastores_total": 0,
        "snapshots_total": 0,
        "protected_snapshots_total": 0,
        "backup_entities_total": 0,
        "tasks_total": 0,
        "failed_tasks_total": 0,
        "api_errors_total": 0,
    }


def endpoint_summary(probe: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": bool(probe.get("ok")),
        "status_code": probe.get("status_code"),
        "endpoint": probe.get("endpoint"),
        "error": probe.get("error", ""),
    }


def record_probe(
    probe: dict[str, Any],
    permissions_missing: list[dict[str, Any]],
    endpoint_not_available: list[dict[str, Any]],
    warnings: list[str],
    api_errors: list[dict[str, Any]],
    optional: bool = False,
    context: str = "",
) -> None:
    if probe.get("ok"):
        return
    status = probe.get("status_code")
    entry = {
        "endpoint": probe.get("endpoint"),
        "status_code": status,
        "error": probe.get("error", ""),
        "context": context,
        "optional": optional,
    }
    if status == 403:
        permissions_missing.append(entry)
        warnings.append(f"Permiso insuficiente en endpoint opcional {probe.get('endpoint')}" if optional else f"Permiso insuficiente en {probe.get('endpoint')}")
    elif status == 404:
        endpoint_not_available.append(entry)
    else:
        api_errors.append(entry)
        if optional:
            warnings.append(f"Endpoint opcional no disponible: {probe.get('endpoint')} ({probe.get('error', '')})")


def datastore_name(entry: dict[str, Any]) -> str:
    return str(entry.get("store") or entry.get("name") or entry.get("id") or "").strip()


def merge_datastores(admin_datastores: list[dict[str, Any]], config_datastores: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for entry in admin_datastores:
        name = datastore_name(entry)
        if not name:
            continue
        current = merged.setdefault(name, {"name": name, "admin": {}, "config": {}})
        current["admin"] = entry
    for entry in config_datastores:
        name = datastore_name(entry)
        if not name:
            continue
        current = merged.setdefault(name, {"name": name, "admin": {}, "config": {}})
        current["config"] = entry

    datastores: list[dict[str, Any]] = []
    for name, values in sorted(merged.items()):
        admin = values.get("admin") or {}
        config = values.get("config") or {}
        datastores.append(
            {
                "name": name,
                "store": name,
                "path": config.get("path") or admin.get("path") or "",
                "mount-status": config.get("mount-status") or config.get("mount_status") or admin.get("mount-status") or admin.get("mount_status") or "",
                "gc-schedule": config.get("gc-schedule") or config.get("gc_schedule") or admin.get("gc-schedule") or admin.get("gc_schedule") or "",
                "notification-mode": config.get("notification-mode") or config.get("notification_mode") or admin.get("notification-mode") or admin.get("notification_mode") or "",
                "admin": admin,
                "config": config,
                "status": None,
                "groups": [],
                "snapshots": [],
                "gc": None,
                "prune": None,
                "verify": None,
                "endpoint_access": {},
            }
        )
    return datastores


def snapshot_time(snapshot: dict[str, Any]) -> int:
    for key in ["backup-time", "backup_time", "time"]:
        try:
            value = int(snapshot.get(key) or 0)
            if value > 0:
                return value
        except (TypeError, ValueError):
            continue
    return 0


def backup_identity(snapshot: dict[str, Any]) -> str:
    backup_type = str(snapshot.get("backup-type") or snapshot.get("backup_type") or snapshot.get("backup-type") or "")
    backup_id = str(snapshot.get("backup-id") or snapshot.get("backup_id") or snapshot.get("backup-id") or "")
    if backup_type or backup_id:
        return f"{backup_type}/{backup_id}".strip("/")
    return str(snapshot.get("backup-group") or snapshot.get("backup_group") or snapshot.get("id") or "unknown")


def collect_inventory(env: dict[str, str]) -> dict[str, Any]:
    missing = missing_config_data(env)
    metadata = {
        "generated_at": now_text(),
        "generated_epoch": int(time.time()),
        "mode": "read-only",
        "config_file": str(ENV_FILE),
        "config_present": ENV_FILE.exists(),
        "endpoint": sanitize_endpoint(env.get("PBS_ENDPOINT", "")),
        "token_id": mask(env.get("PBS_TOKEN_ID", "")) if env.get("PBS_TOKEN_ID") else "",
        "authorization_header_format": masked_auth_header(env.get("PBS_TOKEN_ID", ""), env.get("PBS_TOKEN_SECRET", "")),
        "verify_ssl": bool_from_env(env.get("PBS_VERIFY_SSL", "true")),
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
                    "keys": ["PBS_ENDPOINT", "PBS_TOKEN_ID", "PBS_TOKEN_SECRET", "PBS_VERIFY_SSL"],
                    "minimum_read_privileges": ["Datastore.Audit", "Datastore.Read", "Sys.Audit"],
                },
            },
            "summary": empty_summary(),
            "version": None,
            "nodes": [],
            "datastores": [],
            "datastore_status": {},
            "snapshots_by_datastore": {},
            "backup_entities": [],
            "recent_tasks": [],
            "failed_tasks": [],
            "jobs": {"prune": [], "verify": [], "sync": [], "garbage_collection": []},
            "api_errors": [],
        }

    errors: list[dict[str, str]] = []
    api_errors: list[dict[str, Any]] = []
    permissions_missing: list[dict[str, Any]] = []
    endpoint_not_available: list[dict[str, Any]] = []
    warnings: list[str] = []
    client = PbsClient(
        env["PBS_ENDPOINT"],
        env["PBS_TOKEN_ID"],
        env["PBS_TOKEN_SECRET"],
        bool_from_env(env.get("PBS_VERIFY_SSL", "true")),
    )
    version_probe = client.probe("/version")
    record_probe(version_probe, permissions_missing, endpoint_not_available, warnings, api_errors)
    version = version_probe.get("data") if version_probe.get("ok") else None

    nodes_probe = client.probe("/nodes")
    record_probe(nodes_probe, permissions_missing, endpoint_not_available, warnings, api_errors, optional=True, context="nodes")
    nodes = nodes_probe.get("data") if nodes_probe.get("ok") and isinstance(nodes_probe.get("data"), list) else []

    admin_probe = client.probe("/admin/datastore")
    record_probe(admin_probe, permissions_missing, endpoint_not_available, warnings, api_errors, context="admin_datastore")
    config_probe = client.probe("/config/datastore")
    record_probe(config_probe, permissions_missing, endpoint_not_available, warnings, api_errors, context="config_datastore")
    admin_datastores = admin_probe.get("data") if admin_probe.get("ok") and isinstance(admin_probe.get("data"), list) else []
    config_datastores = config_probe.get("data") if config_probe.get("ok") and isinstance(config_probe.get("data"), list) else []
    datastores = merge_datastores(admin_datastores, config_datastores)

    # Global job endpoints are not required for PBS inventory in this phase.
    prune_jobs: list[dict[str, Any]] = []
    verify_jobs: list[dict[str, Any]] = []
    sync_jobs: list[dict[str, Any]] = []
    gc_jobs: list[dict[str, Any]] = []

    datastore_status: dict[str, Any] = {}
    snapshots_by_datastore: dict[str, list[dict[str, Any]]] = {}
    groups_by_datastore: dict[str, list[dict[str, Any]]] = {}
    entity_latest: dict[str, dict[str, Any]] = {}
    protected_count = 0

    for datastore in datastores:
        store_name = datastore_name(datastore)
        if not store_name:
            continue
        store_path = quote(store_name, safe="")
        probes = {
            "status": client.probe(f"/admin/datastore/{store_path}/status"),
            "snapshots": client.probe(f"/admin/datastore/{store_path}/snapshots"),
            "gc": client.probe(f"/admin/datastore/{store_path}/gc"),
            "groups": client.probe(f"/admin/datastore/{store_path}/groups"),
            "prune": client.probe(f"/admin/datastore/{store_path}/prune"),
            "verify": client.probe(f"/admin/datastore/{store_path}/verify"),
        }
        for key, probe in probes.items():
            datastore["endpoint_access"][key] = endpoint_summary(probe)
            record_probe(
                probe,
                permissions_missing,
                endpoint_not_available,
                warnings,
                api_errors,
                optional=True,
                context=f"{store_name}:{key}",
            )
        status = probes["status"].get("data") if probes["status"].get("ok") else None
        snapshots = probes["snapshots"].get("data") if probes["snapshots"].get("ok") and isinstance(probes["snapshots"].get("data"), list) else []
        groups = probes["groups"].get("data") if probes["groups"].get("ok") and isinstance(probes["groups"].get("data"), list) else []
        datastore["status"] = status
        datastore["snapshots"] = snapshots
        datastore["groups"] = groups
        datastore["gc"] = probes["gc"].get("data") if probes["gc"].get("ok") else None
        datastore["prune"] = probes["prune"].get("data") if probes["prune"].get("ok") else None
        datastore["verify"] = probes["verify"].get("data") if probes["verify"].get("ok") else None
        datastore_status[store_name] = status
        snapshots_by_datastore[store_name] = snapshots
        groups_by_datastore[store_name] = groups
        for snapshot in snapshots:
            identity = backup_identity(snapshot)
            when = snapshot_time(snapshot)
            protected_count += 1 if snapshot.get("protected") else 0
            latest = entity_latest.get(identity)
            if latest is None or when > latest["last_backup_epoch"]:
                entity_latest[identity] = {
                    "identity": identity,
                    "datastore": store_name,
                    "last_backup_epoch": when,
                    "last_backup_text": zbx.format_ts(when),
                    "snapshot": snapshot,
                }
        for group in groups:
            identity = backup_identity(group)
            entity_latest.setdefault(
                identity,
                {
                    "identity": identity,
                    "datastore": store_name,
                    "last_backup_epoch": 0,
                    "last_backup_text": "unknown",
                    "snapshot": {},
                    "group": group,
                },
            )

    recent_tasks: list[dict[str, Any]] = []
    for node in nodes:
        node_name = str(node.get("node") or node.get("name") or "")
        if not node_name:
            continue
        for task in safe_get(client, f"/nodes/{quote(node_name, safe='')}/tasks", errors, params={"limit": 100}) or []:
            task["node"] = node_name
            recent_tasks.append(task)
    failed_tasks = [task for task in recent_tasks if str(task.get("status", "")).upper() not in {"", "OK", "RUNNING"}]

    backup_entities = sorted(entity_latest.values(), key=lambda item: item["identity"])
    all_errors = [
        {"endpoint": entry.get("endpoint"), "error": f"HTTP {entry.get('status_code')}: {entry.get('error')}"}
        for entry in [*api_errors, *permissions_missing, *endpoint_not_available]
    ]
    auth_failed = any("HTTP 401" in str(error.get("error", "")) for error in all_errors)
    permission_limited = bool(permissions_missing)
    available = not auth_failed and (version is not None or bool(nodes) or bool(datastores))
    if auth_failed:
        access_reason = "authentication_failed"
    elif permission_limited:
        access_reason = "partial_permissions"
    elif not available:
        access_reason = "api_unreachable_or_no_readable_resources"
    else:
        access_reason = "ok"

    return {
        "metadata": metadata,
        "access": {
            "available": available,
            "reason": access_reason,
            "permissions_limited": permission_limited,
            "missing_keys": [],
            "first_error": (permissions_missing or api_errors or endpoint_not_available or [None])[0],
            "required_config": {
                "path": str(ENV_FILE),
                "keys": ["PBS_ENDPOINT", "PBS_TOKEN_ID", "PBS_TOKEN_SECRET", "PBS_VERIFY_SSL"],
                "minimum_read_privileges": ["Datastore.Audit", "Datastore.Read", "Sys.Audit"],
            },
        },
        "summary": {
            "datastores_total": len(datastores),
            "datastores_detected": len(datastores),
            "snapshots_total": sum(len(values) for values in snapshots_by_datastore.values()),
            "protected_snapshots_total": protected_count,
            "backup_entities_total": len(backup_entities),
            "groups_total": sum(len(values) for values in groups_by_datastore.values()),
            "tasks_total": len(recent_tasks),
            "failed_tasks_total": len(failed_tasks),
            "permissions_missing_total": len(permissions_missing),
            "endpoint_not_available_total": len(endpoint_not_available),
            "api_errors_total": len(api_errors),
        },
        "version": version,
        "nodes": nodes,
        "admin_datastore_raw": admin_datastores,
        "config_datastore_raw": config_datastores,
        "datastores_detected": len(datastores),
        "datastores": datastores,
        "datastore_status": datastore_status,
        "snapshots_by_datastore": snapshots_by_datastore,
        "groups_by_datastore": groups_by_datastore,
        "backup_entities": backup_entities,
        "recent_tasks": recent_tasks,
        "failed_tasks": failed_tasks,
        "jobs": {"prune": prune_jobs, "verify": verify_jobs, "sync": sync_jobs, "garbage_collection": gc_jobs},
        "permissions_missing": permissions_missing,
        "endpoint_not_available": endpoint_not_available,
        "warnings": sorted(set(warnings)),
        "api_errors": api_errors,
    }


def render_markdown(data: dict[str, Any]) -> str:
    lines = [
        "# Inventario real PBS read-only",
        "",
        f"- Generado: {data['metadata']['generated_at']}",
        f"- Configuracion presente: `{data['metadata']['config_present']}`",
        f"- Endpoint: `{data['metadata'].get('endpoint') or 'no configurado'}`",
        f"- Acceso real PBS: `{data['access']['available']}`",
        "",
    ]
    if not data["access"]["available"]:
        reason = data["access"].get("reason", "unknown")
        first_error = (data["access"].get("first_error") or {}).get("error")
        if reason == "missing_or_incomplete_config":
            diagnostic = "No existe configuracion PBS completa en `/etc/zabbix-codex/proxmox.env`. La fase continua usando solo datos de Zabbix."
        elif first_error:
            diagnostic = f"La configuracion PBS existe, pero la API devolvio: `{first_error}`."
        else:
            diagnostic = f"La configuracion PBS existe, pero no se pudo obtener inventario. Motivo: `{reason}`."
        lines.extend(
            [
                "## Datos pendientes de Proxmox/PBS",
                "",
                diagnostic,
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
            f"- Datastores: `{summary['datastores_total']}`",
            f"- Snapshots: `{summary['snapshots_total']}`",
            f"- Entidades con backup: `{summary['backup_entities_total']}`",
            f"- Tareas recientes: `{summary['tasks_total']}`",
            f"- Tareas fallidas: `{summary['failed_tasks_total']}`",
            "",
            "## Datastores",
        ]
    )
    rows = []
    for datastore in data["datastores"]:
        name = datastore.get("name") or datastore.get("store")
        status = datastore.get("status") or {}
        endpoint_access = datastore.get("endpoint_access") or {}
        accessible = ", ".join(key for key, value in endpoint_access.items() if value.get("ok"))
        blocked = ", ".join(key for key, value in endpoint_access.items() if value.get("status_code") == 403)
        rows.append(
            [
                name,
                datastore.get("path", ""),
                datastore.get("mount-status", ""),
                datastore.get("gc-schedule", ""),
                datastore.get("notification-mode", ""),
                status.get("total", ""),
                status.get("used", ""),
                status.get("avail", ""),
                len(datastore.get("groups") or []),
                len(datastore.get("snapshots") or []),
                accessible,
                blocked,
            ]
        )
    lines.append(zbx.md_table(["Datastore", "Path", "Mount", "GC", "Notif", "Total", "Usado", "Libre", "Groups", "Snapshots", "OK", "403"], rows))
    lines.append("## Ultimos backups por entidad")
    lines.append(zbx.md_table(["Entidad", "Datastore", "Ultimo backup"], [[e["identity"], e["datastore"], e["last_backup_text"]] for e in data["backup_entities"][:100]]))
    if data.get("failed_tasks"):
        lines.append("## Tareas fallidas recientes")
        lines.append(zbx.md_table(["Nodo", "Worker", "Status", "Inicio"], [[t.get("node"), t.get("worker_type") or t.get("type"), t.get("status"), zbx.format_ts(t.get("starttime"))] for t in data["failed_tasks"]]))
    if data.get("permissions_missing"):
        lines.append("## Endpoints bloqueados por permisos")
        lines.append(zbx.md_table(["Endpoint", "Codigo", "Contexto", "Error"], [[e.get("endpoint"), e.get("status_code"), e.get("context"), e.get("error")] for e in data["permissions_missing"]]))
    if data.get("endpoint_not_available"):
        lines.append("## Endpoints no disponibles")
        lines.append(zbx.md_table(["Endpoint", "Codigo", "Contexto", "Error"], [[e.get("endpoint"), e.get("status_code"), e.get("context"), e.get("error")] for e in data["endpoint_not_available"]]))
    if data.get("api_errors"):
        lines.append("## Errores API parciales")
        lines.append(zbx.md_table(["Endpoint", "Codigo", "Contexto", "Error"], [[e.get("endpoint"), e.get("status_code"), e.get("context"), e.get("error")] for e in data["api_errors"]]))
    return "\n".join(lines) + "\n"


def main() -> int:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    env = load_env(ENV_FILE)
    data = collect_inventory(env)
    OUT_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    OUT_MD.write_text(render_markdown(data), encoding="utf-8")
    print(
        "PBS inventory written: "
        f"{OUT_JSON} (access={data['access']['available']}, datastores={data['summary']['datastores_total']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
