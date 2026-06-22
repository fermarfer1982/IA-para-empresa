#!/usr/bin/env python3
"""Prepare a read-only implementation plan for Proxmox/PBS backup checks.

The script reads existing inventories and the current Zabbix API in read-only
mode, then generates implementation plans, draft templates and dry-run metric
push helpers. It does not create, update or delete anything in Zabbix,
Proxmox or PBS.
"""

from __future__ import annotations

import json
import re
import sys
import textwrap
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import plan_zabbix_remediation as zbx  # noqa: E402


BASE_DIR = Path("/opt/zabbix-codex")
ZABBIX_ENV = Path("/etc/zabbix-codex/zabbix.env")
PROXMOX_INVENTORY = BASE_DIR / "proxmox" / "proxmox-real-inventory.json"
PBS_INVENTORY = BASE_DIR / "backups" / "pbs-real-inventory.json"
GAP_ANALYSIS = BASE_DIR / "reports" / "proxmox-backup-gap-analysis.json"
AGENT_KNOWLEDGE = BASE_DIR / "agent_knowledge" / "proxmox_backup_knowledge.json"
PLAN_MD = BASE_DIR / "implementation_plans" / "phase-5a-3-backup-checks-plan.md"
PLAN_JSON = BASE_DIR / "implementation_plans" / "phase-5a-3-backup-checks-plan.json"
PBS_TEMPLATE = BASE_DIR / "templates" / "drafts" / "backups" / "template_pbs_backup_monitoring_intelligent.yaml"
PROXMOX_TEMPLATE = BASE_DIR / "templates" / "drafts" / "proxmox" / "template_proxmox_storage_monitoring_intelligent.yaml"
PUSH_BACKUP_SCRIPT = BASE_DIR / "scripts" / "push_backup_metrics_to_zabbix.py"
PUSH_STORAGE_SCRIPT = BASE_DIR / "scripts" / "push_proxmox_storage_metrics_to_zabbix.py"
KNOWLEDGE_MD = BASE_DIR / "agent_knowledge" / "proxmox_backup_knowledge.md"
NEXT_ACTIONS_MD = BASE_DIR / "agent_knowledge" / "proxmox_next_actions.md"
CHANGELOG = BASE_DIR / "reports" / "CHANGELOG.md"

PBS_TECHNICAL_HOST = "PBS Backup Monitoring"
PROXMOX_TECHNICAL_HOST = "Proxmox Storage Monitoring"
PBS_TEMPLATE_NAME = "Template PBS Backup Monitoring Intelligent Draft"
PROXMOX_TEMPLATE_NAME = "Template Proxmox Storage Monitoring Intelligent Draft"

PBS_DATASTORE_ITEMS = [
    {"key": "pbs.datastore.usage_percent[{datastore}]", "lld_key": "pbs.datastore.usage_percent[{#DATASTORE}]", "value_type": "float", "units": "%"},
    {"key": "pbs.datastore.total_bytes[{datastore}]", "lld_key": "pbs.datastore.total_bytes[{#DATASTORE}]", "value_type": "unsigned", "units": "B"},
    {"key": "pbs.datastore.used_bytes[{datastore}]", "lld_key": "pbs.datastore.used_bytes[{#DATASTORE}]", "value_type": "unsigned", "units": "B"},
    {"key": "pbs.datastore.free_bytes[{datastore}]", "lld_key": "pbs.datastore.free_bytes[{#DATASTORE}]", "value_type": "unsigned", "units": "B"},
    {"key": "pbs.datastore.groups[{datastore}]", "lld_key": "pbs.datastore.groups[{#DATASTORE}]", "value_type": "unsigned", "units": ""},
    {"key": "pbs.datastore.snapshots[{datastore}]", "lld_key": "pbs.datastore.snapshots[{#DATASTORE}]", "value_type": "unsigned", "units": ""},
    {"key": "pbs.datastore.last_snapshot_age_hours[{datastore}]", "lld_key": "pbs.datastore.last_snapshot_age_hours[{#DATASTORE}]", "value_type": "float", "units": "h"},
]

PBS_BACKUP_ITEMS = [
    {"key": "pbs.backup.last_success_timestamp[{vmid}]", "lld_key": "pbs.backup.last_success_timestamp[{#VMID}]", "value_type": "unsigned", "units": "unixtime"},
    {"key": "pbs.backup.last_success_age_hours[{vmid}]", "lld_key": "pbs.backup.last_success_age_hours[{#VMID}]", "value_type": "float", "units": "h"},
    {"key": "pbs.backup.snapshot_count[{vmid}]", "lld_key": "pbs.backup.snapshot_count[{#VMID}]", "value_type": "unsigned", "units": ""},
    {"key": "pbs.backup.has_recent_backup[{vmid}]", "lld_key": "pbs.backup.has_recent_backup[{#VMID}]", "value_type": "unsigned", "units": ""},
    {"key": "pbs.backup.datastore[{vmid}]", "lld_key": "pbs.backup.datastore[{#VMID}]", "value_type": "text", "units": ""},
    {"key": "pbs.backup.protected_count[{vmid}]", "lld_key": "pbs.backup.protected_count[{#VMID}]", "value_type": "unsigned", "units": ""},
]

PBS_GLOBAL_ITEMS = [
    {"key": "pbs.backup.entities_total", "value_type": "unsigned", "units": ""},
    {"key": "pbs.backup.entities_without_recent_backup", "value_type": "unsigned", "units": ""},
    {"key": "pbs.backup.oldest_backup_age_hours", "value_type": "float", "units": "h"},
    {"key": "pbs.backup.collection_status", "value_type": "unsigned", "units": ""},
]

PROXMOX_STORAGE_ITEMS = [
    {"key": "proxmox.storage.usage_percent[{node},{storage}]", "lld_key": "proxmox.storage.usage_percent[{#NODE},{#STORAGE}]", "value_type": "float", "units": "%"},
    {"key": "proxmox.storage.total_bytes[{node},{storage}]", "lld_key": "proxmox.storage.total_bytes[{#NODE},{#STORAGE}]", "value_type": "unsigned", "units": "B"},
    {"key": "proxmox.storage.used_bytes[{node},{storage}]", "lld_key": "proxmox.storage.used_bytes[{#NODE},{#STORAGE}]", "value_type": "unsigned", "units": "B"},
    {"key": "proxmox.storage.free_bytes[{node},{storage}]", "lld_key": "proxmox.storage.free_bytes[{#NODE},{#STORAGE}]", "value_type": "unsigned", "units": "B"},
    {"key": "proxmox.storage.active[{node},{storage}]", "lld_key": "proxmox.storage.active[{#NODE},{#STORAGE}]", "value_type": "unsigned", "units": ""},
    {"key": "proxmox.storage.enabled[{node},{storage}]", "lld_key": "proxmox.storage.enabled[{#NODE},{#STORAGE}]", "value_type": "unsigned", "units": ""},
]

PROXMOX_BACKUP_ITEMS = [
    {"key": "proxmox.backup.jobs_total", "value_type": "unsigned", "units": ""},
    {"key": "proxmox.backup.failed_tasks_24h", "value_type": "unsigned", "units": ""},
    {"key": "proxmox.backup.failed_tasks_48h", "value_type": "unsigned", "units": ""},
    {"key": "proxmox.backup.vm_in_job[{vmid}]", "lld_key": "proxmox.backup.vm_in_job[{#VMID}]", "value_type": "unsigned", "units": ""},
    {"key": "proxmox.backup.vm_without_job[{vmid}]", "lld_key": "proxmox.backup.vm_without_job[{#VMID}]", "value_type": "unsigned", "units": ""},
]

DECISIONS_FROM_FERNANDO = [
    "¿ia-dify debe tener backup?",
    "¿Cuál es la criticidad de cada VM?",
    "¿Qué VMs deben alertar si backup >24h, >48h o >72h?",
    "¿Qué datastores son críticos?",
    "¿Debemos crear host técnico PBS Backup Monitoring?",
    "¿Debemos crear host técnico Proxmox Storage Monitoring?",
    "¿Se permite importar templates nuevos no asignados?",
    "¿Se permite crear items trapper en hosts técnicos?",
]


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def ensure_dirs() -> None:
    for path in [
        PLAN_MD.parent,
        PBS_TEMPLATE.parent,
        PROXMOX_TEMPLATE.parent,
        PUSH_BACKUP_SCRIPT.parent,
        KNOWLEDGE_MD.parent,
        CHANGELOG.parent,
    ]:
        path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, text: str, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    if executable:
        path.chmod(0o750)


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def percent(used: Any, total: Any) -> float:
    total_f = to_float(total)
    if total_f <= 0:
        return 0.0
    return round((to_float(used) / total_f) * 100, 1)


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


def pbs_entity_vmid(entity: dict[str, Any]) -> str:
    identity = str(entity.get("identity", ""))
    if "/" in identity:
        return identity.split("/", 1)[1]
    snapshot = entity.get("snapshot") or {}
    return str(snapshot.get("backup-id", entity.get("backup-id", "")))


def entity_comment(entity: dict[str, Any]) -> str:
    snapshot = entity.get("snapshot") or {}
    return str(snapshot.get("comment") or entity.get("comment") or "")


def backup_entities_without_recent_backup(entities: list[dict[str, Any]], hours: int = 48) -> list[dict[str, Any]]:
    cutoff = int(time.time()) - hours * 3600
    stale = []
    for entity in entities:
        last_epoch = to_int(entity.get("last_backup_epoch") or (entity.get("snapshot") or {}).get("backup-time"))
        if not last_epoch or last_epoch < cutoff:
            stale.append(entity)
    return stale


def oldest_backup_age_hours(entities: list[dict[str, Any]]) -> float:
    now = int(time.time())
    epochs = [to_int(entity.get("last_backup_epoch") or (entity.get("snapshot") or {}).get("backup-time")) for entity in entities]
    epochs = [epoch for epoch in epochs if epoch > 0]
    if not epochs:
        return 0.0
    return round((now - min(epochs)) / 3600, 1)


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        return "_Sin datos._"
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(value).replace("\n", " ") for value in row) + " |")
    return "\n".join(lines)


def stable_uuid(name: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"zabbix-codex:{name}").hex


def yaml_quote(value: Any) -> str:
    text = str(value)
    text = text.replace("\\", "\\\\").replace("'", "''")
    return f"'{text}'"


def yaml_scalar(value: Any, indent: int = 0) -> str:
    prefix = " " * indent
    text = str(value)
    if "\n" in text:
        lines = text.rstrip().splitlines()
        return prefix + "|\n" + "\n".join(prefix + "  " + line for line in lines)
    return prefix + yaml_quote(text)


def item_value_type(value_type: str) -> str:
    return {
        "float": "FLOAT",
        "unsigned": "UNSIGNED",
        "text": "TEXT",
    }.get(value_type, "TEXT")


def zabbix_readonly_snapshot() -> dict[str, Any]:
    result: dict[str, Any] = {
        "api_access": False,
        "version": None,
        "hosts_total": 0,
        "templates_total": 0,
        "technical_hosts": {
            PBS_TECHNICAL_HOST: {"exists": False, "hostid": None},
            PROXMOX_TECHNICAL_HOST: {"exists": False, "hostid": None},
        },
        "draft_templates_existing": [],
        "existing_metric_items": [],
        "api_errors": [],
    }

    if not ZABBIX_ENV.exists():
        result["api_errors"].append({"stage": "env", "error": f"Missing {ZABBIX_ENV}"})
        return result

    try:
        env = zbx.load_env(ZABBIX_ENV)
        api = zbx.ZabbixApi(zbx.api_url_from_env(env["ZABBIX_URL"]), env["ZABBIX_TOKEN"], zbx.tls_context(env))
        result["version"] = api.call("apiinfo.version", auth=False)
        hosts = api.call(
            "host.get",
            {
                "output": ["hostid", "host", "name", "status"],
                "selectGroups": ["groupid", "name"],
                "selectParentTemplates": ["templateid", "host", "name"],
                "selectTags": "extend",
            },
        )
        templates = api.call("template.get", {"output": ["templateid", "host", "name"]})
        items = api.call(
            "item.get",
            {
                "output": ["itemid", "hostid", "name", "key_", "type", "value_type", "status"],
                "searchByAny": True,
                "search": {
                    "key_": [
                        "pbs.",
                        "proxmox.storage.",
                        "proxmox.backup.",
                    ]
                },
                "selectHosts": ["hostid", "host", "name"],
                "limit": 500,
            },
        )
        result["api_access"] = True
        result["hosts_total"] = len(hosts)
        result["templates_total"] = len(templates)
        host_by_name = {str(host.get("name") or host.get("host")): host for host in hosts}
        for name in [PBS_TECHNICAL_HOST, PROXMOX_TECHNICAL_HOST]:
            host = host_by_name.get(name)
            if host:
                result["technical_hosts"][name] = {"exists": True, "hostid": host.get("hostid")}
        for template in templates:
            template_name = str(template.get("name") or template.get("host"))
            if template_name in {PBS_TEMPLATE_NAME, PROXMOX_TEMPLATE_NAME}:
                result["draft_templates_existing"].append(template)
        result["existing_metric_items"] = items
    except Exception as exc:  # noqa: BLE001 - keep plan generation usable when API is unavailable.
        result["api_errors"].append({"stage": "api", "error": str(exc)})

    return result


def storage_rows(storages: list[dict[str, Any]]) -> list[list[Any]]:
    rows = []
    for storage in sorted(storages, key=lambda item: (str(item.get("node")), str(item.get("storage")))):
        usage = percent(storage.get("used"), storage.get("total"))
        rows.append([
            storage.get("node", ""),
            storage.get("storage", ""),
            storage.get("type", ""),
            f"{usage:.1f}%",
            storage.get("active", ""),
            storage.get("enabled", ""),
        ])
    return rows


def datastore_rows(datastores: list[dict[str, Any]]) -> list[list[Any]]:
    rows = []
    for datastore in datastores:
        status = datastore.get("status") or {}
        rows.append([
            datastore.get("name", ""),
            datastore.get("path", ""),
            f"{percent(status.get('used'), status.get('total')):.1f}%",
            len(datastore.get("groups") or []),
            len(datastore.get("snapshots") or []),
            datastore.get("gc-schedule", ""),
        ])
    return rows


def vm_rows(vms: list[dict[str, Any]], job_vmids: set[str], stale_entities: list[dict[str, Any]]) -> list[list[Any]]:
    stale_by_vmid = {pbs_entity_vmid(entity): entity for entity in stale_entities}
    rows = []
    for vm in sorted(vms, key=lambda item: to_int(item.get("vmid"))):
        vmid = str(vm.get("vmid", ""))
        rows.append([
            vmid,
            vm.get("name", ""),
            vm.get("node", ""),
            vm.get("status", ""),
            "sí" if vmid in job_vmids else "no",
            "sí" if vmid in stale_by_vmid else "no",
        ])
    return rows


def build_plan(
    proxmox: dict[str, Any],
    pbs: dict[str, Any],
    gaps: dict[str, Any],
    knowledge: dict[str, Any],
    zabbix_snapshot: dict[str, Any],
) -> dict[str, Any]:
    qemu_vms = proxmox.get("qemu_vms") or []
    lxcs = proxmox.get("lxc_containers") or []
    real_vms = qemu_vms + lxcs
    storages = proxmox.get("storages") or []
    backup_jobs = proxmox.get("backup_jobs") or []
    recent_tasks = proxmox.get("recent_backup_tasks") or []
    pbs_datastores = pbs.get("datastores") or []
    backup_entities = pbs.get("backup_entities") or []
    gap_summary = gaps.get("summary") or {}

    job_vmids = backup_job_vmids(backup_jobs)
    vmids_real = {str(vm.get("vmid", "")) for vm in real_vms if str(vm.get("vmid", ""))}
    vms_without_job = [vm for vm in real_vms if str(vm.get("vmid", "")) not in job_vmids]
    stale_entities = backup_entities_without_recent_backup(backup_entities, hours=48)
    storages_over_80 = [storage for storage in storages if percent(storage.get("used"), storage.get("total")) >= 80]

    pbs_access = bool((pbs.get("access") or {}).get("available", pbs.get("access") is True))
    proxmox_access = bool((proxmox.get("access") or {}).get("available", proxmox.get("access") is True))

    immediate_findings = [
        {
            "priority": "ALTO",
            "area": "Backups",
            "finding": f"{len(stale_entities)} entidad(es) PBS sin backup reciente >48h.",
            "evidence": [
                {
                    "identity": entity.get("identity"),
                    "vmid": pbs_entity_vmid(entity),
                    "comment": entity_comment(entity),
                    "datastore": entity.get("datastore"),
                    "last_backup": entity.get("last_backup_text"),
                }
                for entity in stale_entities
            ],
            "recommended_action": "Crear check pbs.backup.last_success_age_hours por VM/CT y confirmar criticidad.",
            "requires_human_confirmation": True,
        },
        {
            "priority": "ALTO",
            "area": "Backups",
            "finding": f"{len(vms_without_job)} VM/LXC no aparece(n) en jobs de backup Proxmox.",
            "evidence": [
                {"vmid": vm.get("vmid"), "name": vm.get("name"), "node": vm.get("node"), "status": vm.get("status")}
                for vm in vms_without_job
            ],
            "recommended_action": "Confirmar si deben entrar en jobs de backup o quedar documentadas como exclusión.",
            "requires_human_confirmation": True,
        },
        {
            "priority": "ALTO",
            "area": "Backups",
            "finding": f"{gap_summary.get('pve_failed_backup_tasks_total', 0)} tareas recientes de backup Proxmox con error.",
            "evidence": {
                "failed_tasks_24h": failed_tasks_since(recent_tasks, 24),
                "failed_tasks_48h": failed_tasks_since(recent_tasks, 48),
            },
            "recommended_action": "Crear alerta proxmox.backup.failed_tasks_24h/48h y revisar los errores de vzdump.",
            "requires_human_confirmation": True,
        },
        {
            "priority": "ALTO",
            "area": "Storage",
            "finding": f"{len(storages_over_80)} storage(s) Proxmox por encima del 80%.",
            "evidence": [
                {
                    "node": storage.get("node"),
                    "storage": storage.get("storage"),
                    "usage_percent": percent(storage.get("used"), storage.get("total")),
                }
                for storage in storages_over_80
            ],
            "recommended_action": "Crear triggers >80/>90/>95; proxmox-gallarza/datastore-replicas requiere seguimiento inmediato.",
            "requires_human_confirmation": True,
        },
        {
            "priority": "ALTO",
            "area": "Backups",
            "finding": f"{gap_summary.get('critical_hosts_without_backup_evidence', 0)} hosts críticos sin backup verificable directo en Zabbix.",
            "evidence": "Dato procedente del análisis de gaps; requiere mapeo humano activo->VM/job/PBS/Veeam.",
            "recommended_action": "Añadir modelo de cobertura de backup por host crítico.",
            "requires_human_confirmation": True,
        },
    ]

    architecture = {
        "recommended": "LLD + trapper items + zabbix_sender, con hosts técnicos separados.",
        "technical_hosts": [
            {
                "name": PBS_TECHNICAL_HOST,
                "purpose": "Centralizar métricas calculadas de PBS, datastores y edad de backups por VM/CT.",
                "status_in_zabbix": zabbix_snapshot["technical_hosts"][PBS_TECHNICAL_HOST],
            },
            {
                "name": PROXMOX_TECHNICAL_HOST,
                "purpose": "Centralizar métricas calculadas de storage Proxmox y estado de jobs/tareas de backup.",
                "status_in_zabbix": zabbix_snapshot["technical_hosts"][PROXMOX_TECHNICAL_HOST],
            },
        ],
        "implementation_choice": [
            {
                "option": "zabbix_sender + trapper items",
                "decision": "recomendada",
                "reason": "Reduce carga del Zabbix server, evita exponer credenciales PBS/PVE al frontend y permite controlar errores de recolección.",
            },
            {
                "option": "LLD",
                "decision": "recomendada",
                "reason": "Permite descubrir datastores, storages y VMIDs sin crear manualmente cada item.",
            },
            {
                "option": "dependent items",
                "decision": "segunda iteración",
                "reason": "Útiles si se decide enviar un JSON maestro, pero los trapper individuales son más simples para la primera implementación.",
            },
            {
                "option": "external checks",
                "decision": "no recomendada como base",
                "reason": "Mezcla credenciales y ejecución externa dentro de Zabbix server; peor trazabilidad para el agente.",
            },
            {
                "option": "Zabbix API",
                "decision": "solo para crear hosts/templates/items en una fase aprobada",
                "reason": "No debe usarse para enviar valores operativos salvo casos puntuales.",
            },
        ],
        "safe_rollout": [
            "Importar templates nuevos no asignados cuando Fernando lo confirme.",
            "Crear hosts técnicos cuando Fernando lo confirme.",
            "Asignar templates a hosts técnicos.",
            "Ejecutar push scripts en dry-run y comparar métricas.",
            "Activar envío con zabbix_sender y programar timer/cron.",
            "Activar triggers tras validar umbrales y criticidad.",
        ],
    }

    plan = {
        "metadata": {
            "generated_at": now_text(),
            "mode": "preparation-only",
            "read_only": True,
            "no_changes_applied_to": ["Zabbix", "Proxmox", "PBS"],
        },
        "zabbix_current": zabbix_snapshot,
        "proxmox_current": {
            "api_access": proxmox_access,
            "nodes_total": len(proxmox.get("nodes") or []),
            "qemu_vms_total": len(qemu_vms),
            "lxc_total": len(lxcs),
            "storages_total": len(storages),
            "backup_jobs_total": len(backup_jobs),
            "failed_backup_tasks_total": gap_summary.get("pve_failed_backup_tasks_total", sum(1 for task in recent_tasks if failed_task(task))),
            "vms_without_backup_job": vms_without_job,
            "storages_over_80": storages_over_80,
        },
        "pbs_current": {
            "api_access": pbs_access,
            "version": (pbs.get("version") or {}).get("version") if isinstance(pbs.get("version"), dict) else pbs.get("version"),
            "datastores_total": len(pbs_datastores),
            "snapshots_total": (pbs.get("summary") or {}).get("snapshots_total", 0),
            "backup_entities_total": len(backup_entities),
            "entities_without_recent_backup_48h": stale_entities,
        },
        "architecture": architecture,
        "metrics": {
            "pbs": {
                "per_datastore": PBS_DATASTORE_ITEMS,
                "per_vm_ct": PBS_BACKUP_ITEMS,
                "global": PBS_GLOBAL_ITEMS,
            },
            "proxmox": {
                "per_storage": PROXMOX_STORAGE_ITEMS,
                "backup": PROXMOX_BACKUP_ITEMS,
            },
        },
        "triggers": {
            "pbs": [
                {"name": "Datastore usage > 80%", "severity": "Average", "expression": "pbs.datastore.usage_percent[{datastore}] > 80"},
                {"name": "Datastore usage > 90%", "severity": "High", "expression": "pbs.datastore.usage_percent[{datastore}] > 90"},
                {"name": "Datastore usage > 95% si datastore crítico", "severity": "Disaster", "expression": "pbs.datastore.usage_percent[{datastore}] > 95"},
                {"name": "VM crítica sin backup reciente > 24/48h", "severity": "High", "expression": "pbs.backup.last_success_age_hours[{vmid}] > threshold"},
                {"name": "VM no crítica sin backup reciente > 72h", "severity": "Average", "expression": "pbs.backup.last_success_age_hours[{vmid}] > 72"},
                {"name": "ia-dify backup antiguo", "severity": "High o Average según criticidad", "expression": "pbs.backup.last_success_age_hours[114] > threshold"},
                {"name": "No se puede consultar PBS", "severity": "High", "expression": "pbs.backup.collection_status = 0"},
                {"name": "No hay snapshots recientes", "severity": "High", "expression": "pbs.backup.oldest_backup_age_hours o snapshots recientes fuera de umbral"},
            ],
            "proxmox": [
                {"name": "Storage > 80%", "severity": "Average", "expression": "proxmox.storage.usage_percent[{node},{storage}] > 80"},
                {"name": "Storage > 90%", "severity": "High", "expression": "proxmox.storage.usage_percent[{node},{storage}] > 90"},
                {"name": "Storage > 95% si crítico", "severity": "Disaster", "expression": "proxmox.storage.usage_percent[{node},{storage}] > 95"},
                {"name": "proxmox-gallarza/datastore-replicas > 80%", "severity": "Average ahora, High si sigue creciendo o es crítico", "expression": "proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas] > 80"},
                {"name": "Backup tasks failed > 0 últimas 24/48h", "severity": "High", "expression": "proxmox.backup.failed_tasks_24h > 0 o proxmox.backup.failed_tasks_48h > 0"},
                {"name": "VM crítica sin job de backup", "severity": "High", "expression": "proxmox.backup.vm_without_job[{vmid}] = 1"},
                {"name": "VM no crítica sin job de backup", "severity": "Average", "expression": "proxmox.backup.vm_without_job[{vmid}] = 1"},
                {"name": "PVE API no accesible", "severity": "High", "expression": "proxmox.collection_status = 0"},
            ],
        },
        "immediate_findings": immediate_findings,
        "safe_changes_next_phase": [
            "Importar templates nuevos como borradores no asignados.",
            "Crear hosts técnicos sin interfaces si se confirma.",
            "Crear items trapper en hosts técnicos si se confirma.",
            "Ejecutar scripts push_* en dry-run desde cron/systemd timer de prueba.",
            "Añadir documentación de mapeo VMID->host crítico.",
        ],
        "human_confirmation_required": [
            "Crear hosts técnicos en Zabbix.",
            "Importar templates nuevos.",
            "Asignar templates a hosts técnicos.",
            "Crear items/triggers activos.",
            "Activar envío de métricas con zabbix_sender.",
            "Definir criticidad de VMs, datastores y políticas de backup.",
            "Añadir ia-dify a jobs de backup o documentar su exclusión.",
            "Cambiar jobs de backup Proxmox/PBS.",
        ],
        "decisions_needed_from_fernando": DECISIONS_FROM_FERNANDO,
        "source_context": {
            "proxmox_inventory": str(PROXMOX_INVENTORY),
            "pbs_inventory": str(PBS_INVENTORY),
            "gap_analysis": str(GAP_ANALYSIS),
            "agent_knowledge": str(AGENT_KNOWLEDGE),
            "previous_knowledge_keys": list(knowledge.keys()),
        },
    }
    return plan


def render_plan_md(plan: dict[str, Any], proxmox: dict[str, Any], pbs: dict[str, Any]) -> str:
    pbs_current = plan["pbs_current"]
    proxmox_current = plan["proxmox_current"]
    immediate = plan["immediate_findings"]
    job_vmids = backup_job_vmids(proxmox.get("backup_jobs") or [])
    stale_entities = pbs_current["entities_without_recent_backup_48h"]

    decision_lines = "\n".join(f"- {item}" for item in DECISIONS_FROM_FERNANDO)
    immediate_lines = "\n".join(
        f"- **{item['priority']} / {item['area']}**: {item['finding']} Acción: {item['recommended_action']}"
        for item in immediate
    )
    pbs_metric_lines = "\n".join(
        f"- `{item['key']}`" for item in PBS_DATASTORE_ITEMS + PBS_BACKUP_ITEMS + PBS_GLOBAL_ITEMS
    )
    proxmox_metric_lines = "\n".join(
        f"- `{item['key']}`" for item in PROXMOX_STORAGE_ITEMS + PROXMOX_BACKUP_ITEMS
    )
    pbs_trigger_lines = "\n".join(
        f"- {trigger['severity']}: {trigger['name']} (`{trigger['expression']}`)"
        for trigger in plan["triggers"]["pbs"]
    )
    proxmox_trigger_lines = "\n".join(
        f"- {trigger['severity']}: {trigger['name']} (`{trigger['expression']}`)"
        for trigger in plan["triggers"]["proxmox"]
    )

    return f"""# Fase 5A-3 - Plan de implementación de checks PBS/Proxmox

Generado: {plan['metadata']['generated_at']}

## Resumen ejecutivo

Esta fase deja preparada una implementación revisable para que Zabbix almacene métricas estructuradas de PBS, Proxmox storage y backups. No se ha modificado Zabbix, Proxmox ni PBS.

- PBS API: {'OK' if pbs_current['api_access'] else 'no disponible'}.
- Proxmox API: {'OK' if proxmox_current['api_access'] else 'no disponible'}.
- PBS datastores: {pbs_current['datastores_total']}; snapshots: {pbs_current['snapshots_total']}; entidades con backup: {pbs_current['backup_entities_total']}.
- Proxmox VMs: {proxmox_current['qemu_vms_total']}; LXCs: {proxmox_current['lxc_total']}; storages: {proxmox_current['storages_total']}; jobs de backup: {proxmox_current['backup_jobs_total']}.
- Entidades PBS sin backup reciente >48h: {len(stale_entities)}.
- VMs/LXCs sin job Proxmox: {len(proxmox_current['vms_without_backup_job'])}.
- Tareas recientes de backup Proxmox con error: {proxmox_current['failed_backup_tasks_total']}.

## Arquitectura recomendada

Arquitectura base: **LLD + items trapper + `zabbix_sender` + hosts técnicos separados**.

- Host técnico propuesto: `{PBS_TECHNICAL_HOST}`.
- Host técnico propuesto: `{PROXMOX_TECHNICAL_HOST}`.
- Los scripts recolectan Proxmox/PBS con credenciales de `/etc/zabbix-codex/proxmox.env` y envían valores a Zabbix solo con `--send`.
- El modo por defecto de los scripts es dry-run.
- Zabbix API queda reservada para una fase posterior aprobada de creación/importación.
- External checks no se recomiendan como base porque moverían credenciales y carga operativa al servidor Zabbix.

## Estado PBS

{md_table(['Datastore', 'Path', 'Uso', 'Groups', 'Snapshots', 'GC'], datastore_rows(pbs.get('datastores') or []))}

## Estado Proxmox storage

{md_table(['Nodo', 'Storage', 'Tipo', 'Uso', 'Activo', 'Enabled'], storage_rows(proxmox.get('storages') or []))}

## Estado VM/backup

{md_table(['VMID', 'Nombre', 'Nodo', 'Estado', 'En job PVE', 'Backup PBS >48h'], vm_rows((proxmox.get('qemu_vms') or []) + (proxmox.get('lxc_containers') or []), job_vmids, stale_entities))}

## Métricas PBS propuestas

{pbs_metric_lines}

## Métricas Proxmox propuestas

{proxmox_metric_lines}

## Triggers PBS propuestos

{pbs_trigger_lines}

## Triggers Proxmox propuestos

{proxmox_trigger_lines}

## Hallazgos inmediatos

{immediate_lines}

## Cambios seguros para la siguiente fase

{chr(10).join(f"- {item}" for item in plan['safe_changes_next_phase'])}

## Cambios que requieren confirmación humana

{chr(10).join(f"- {item}" for item in plan['human_confirmation_required'])}

## Decisiones que necesito de Fernando

{decision_lines}

## Ficheros generados

- `{PLAN_JSON}`
- `{PBS_TEMPLATE}`
- `{PROXMOX_TEMPLATE}`
- `{PUSH_BACKUP_SCRIPT}`
- `{PUSH_STORAGE_SCRIPT}`
- `{NEXT_ACTIONS_MD}`
"""


def render_pbs_template() -> str:
    template = PBS_TEMPLATE_NAME
    datastore_items = []
    for item in PBS_DATASTORE_ITEMS:
        name = item["lld_key"].split("[", 1)[0].replace("pbs.datastore.", "").replace("_", " ")
        datastore_items.append(f"""          - uuid: {stable_uuid('pbs-ds-' + item['lld_key'])}
            name: 'PBS datastore {{#DATASTORE}}: {name}'
            type: TRAP
            key: {yaml_quote(item['lld_key'])}
            delay: '0'
            value_type: {item_value_type(item['value_type'])}
            units: {yaml_quote(item['units'])}
            tags:
              - tag: component
                value: pbs-datastore""")
    backup_items = []
    for item in PBS_BACKUP_ITEMS:
        name = item["lld_key"].split("[", 1)[0].replace("pbs.backup.", "").replace("_", " ")
        backup_items.append(f"""          - uuid: {stable_uuid('pbs-vm-' + item['lld_key'])}
            name: 'PBS backup {{#VMID}}: {name}'
            type: TRAP
            key: {yaml_quote(item['lld_key'])}
            delay: '0'
            value_type: {item_value_type(item['value_type'])}
            units: {yaml_quote(item['units'])}
            tags:
              - tag: component
                value: pbs-backup""")
    global_items = []
    for item in PBS_GLOBAL_ITEMS:
        global_items.append(f"""        - uuid: {stable_uuid('pbs-global-' + item['key'])}
          name: '{item['key']}'
          type: TRAP
          key: {yaml_quote(item['key'])}
          delay: '0'
          value_type: {item_value_type(item['value_type'])}
          units: {yaml_quote(item['units'])}
          tags:
            - tag: component
              value: pbs-global""")

    return f"""zabbix_export:
  version: '7.0'
  template_groups:
    - uuid: {stable_uuid('Templates/Zabbix Codex Drafts')}
      name: 'Templates/Zabbix Codex Drafts'
  templates:
    - uuid: {stable_uuid(template)}
      template: {yaml_quote(template)}
      name: {yaml_quote(template)}
      description: |
        DRAFT. Do not import or assign without human confirmation.
        Recommended technical host: {PBS_TECHNICAL_HOST}.
        Metrics are expected as trapper values sent by scripts/push_backup_metrics_to_zabbix.py.
        Required macros tune datastore usage and backup-age thresholds.
      groups:
        - name: 'Templates/Zabbix Codex Drafts'
      macros:
        - macro: '{{$PBS.DATASTORE.PUSED.AVERAGE}}'
          value: '80'
        - macro: '{{$PBS.DATASTORE.PUSED.HIGH}}'
          value: '90'
        - macro: '{{$PBS.DATASTORE.PUSED.DISASTER}}'
          value: '95'
        - macro: '{{$PBS.BACKUP.MAXAGE.CRITICAL.HIGH}}'
          value: '48'
        - macro: '{{$PBS.BACKUP.MAXAGE.NONCRIT.AVERAGE}}'
          value: '72'
      items:
{chr(10).join(global_items)}
      triggers:
        - uuid: {stable_uuid('pbs-collection-down')}
          expression: 'last(/{template}/pbs.backup.collection_status)=0'
          name: 'PBS API cannot be collected'
          priority: HIGH
          tags:
            - tag: component
              value: pbs-api
      discovery_rules:
        - uuid: {stable_uuid('pbs-datastore-discovery')}
          name: 'PBS datastore discovery'
          type: TRAP
          key: pbs.datastore.discovery
          delay: '0'
          lifetime: 30d
          item_prototypes:
{chr(10).join(datastore_items)}
          trigger_prototypes:
            - uuid: {stable_uuid('pbs-ds-average')}
              expression: 'last(/{template}/pbs.datastore.usage_percent[{{#DATASTORE}}])>{{$PBS.DATASTORE.PUSED.AVERAGE}}'
              name: 'PBS datastore {{#DATASTORE}} usage > 80%'
              priority: AVERAGE
            - uuid: {stable_uuid('pbs-ds-high')}
              expression: 'last(/{template}/pbs.datastore.usage_percent[{{#DATASTORE}}])>{{$PBS.DATASTORE.PUSED.HIGH}}'
              name: 'PBS datastore {{#DATASTORE}} usage > 90%'
              priority: HIGH
            - uuid: {stable_uuid('pbs-ds-disaster')}
              expression: 'last(/{template}/pbs.datastore.usage_percent[{{#DATASTORE}}])>{{$PBS.DATASTORE.PUSED.DISASTER}}'
              name: 'PBS datastore {{#DATASTORE}} usage > 95%'
              priority: DISASTER
        - uuid: {stable_uuid('pbs-backup-discovery')}
          name: 'PBS VM/CT backup discovery'
          type: TRAP
          key: pbs.backup.discovery
          delay: '0'
          lifetime: 30d
          item_prototypes:
{chr(10).join(backup_items)}
          trigger_prototypes:
            - uuid: {stable_uuid('pbs-critical-backup-age')}
              expression: 'last(/{template}/pbs.backup.last_success_age_hours[{{#VMID}}])>{{$PBS.BACKUP.MAXAGE.CRITICAL.HIGH}}'
              name: 'PBS backup {{#VMID}} older than critical threshold'
              priority: HIGH
            - uuid: {stable_uuid('pbs-no-recent-backup')}
              expression: 'last(/{template}/pbs.backup.has_recent_backup[{{#VMID}}])=0'
              name: 'PBS backup {{#VMID}} has no recent backup'
              priority: AVERAGE
"""


def render_proxmox_template() -> str:
    template = PROXMOX_TEMPLATE_NAME
    storage_items = []
    for item in PROXMOX_STORAGE_ITEMS:
        name = item["lld_key"].split("[", 1)[0].replace("proxmox.storage.", "").replace("_", " ")
        storage_items.append(f"""          - uuid: {stable_uuid('pve-storage-' + item['lld_key'])}
            name: 'Proxmox {{#NODE}}/{{#STORAGE}}: {name}'
            type: TRAP
            key: {yaml_quote(item['lld_key'])}
            delay: '0'
            value_type: {item_value_type(item['value_type'])}
            units: {yaml_quote(item['units'])}
            tags:
              - tag: component
                value: proxmox-storage""")
    vm_items = []
    for item in PROXMOX_BACKUP_ITEMS:
        if "lld_key" not in item:
            continue
        name = item["lld_key"].split("[", 1)[0].replace("proxmox.backup.", "").replace("_", " ")
        vm_items.append(f"""          - uuid: {stable_uuid('pve-vm-' + item['lld_key'])}
            name: 'Proxmox backup {{#VMID}}: {name}'
            type: TRAP
            key: {yaml_quote(item['lld_key'])}
            delay: '0'
            value_type: {item_value_type(item['value_type'])}
            tags:
              - tag: component
                value: proxmox-backup""")
    global_items = []
    for item in PROXMOX_BACKUP_ITEMS:
        if "lld_key" in item:
            continue
        global_items.append(f"""        - uuid: {stable_uuid('pve-global-' + item['key'])}
          name: '{item['key']}'
          type: TRAP
          key: {yaml_quote(item['key'])}
          delay: '0'
          value_type: {item_value_type(item['value_type'])}
          units: {yaml_quote(item['units'])}
          tags:
            - tag: component
              value: proxmox-backup""")
    global_items.append(f"""        - uuid: {stable_uuid('pve-collection-status')}
          name: 'proxmox.collection_status'
          type: TRAP
          key: proxmox.collection_status
          delay: '0'
          value_type: UNSIGNED
          tags:
            - tag: component
              value: proxmox-api""")

    return f"""zabbix_export:
  version: '7.0'
  template_groups:
    - uuid: {stable_uuid('Templates/Zabbix Codex Drafts')}
      name: 'Templates/Zabbix Codex Drafts'
  templates:
    - uuid: {stable_uuid(template)}
      template: {yaml_quote(template)}
      name: {yaml_quote(template)}
      description: |
        DRAFT. Do not import or assign without human confirmation.
        Recommended technical host: {PROXMOX_TECHNICAL_HOST}.
        Metrics are expected as trapper values sent by scripts/push_proxmox_storage_metrics_to_zabbix.py.
      groups:
        - name: 'Templates/Zabbix Codex Drafts'
      macros:
        - macro: '{{$PROXMOX.STORAGE.PUSED.AVERAGE}}'
          value: '80'
        - macro: '{{$PROXMOX.STORAGE.PUSED.HIGH}}'
          value: '90'
        - macro: '{{$PROXMOX.STORAGE.PUSED.DISASTER}}'
          value: '95'
      items:
{chr(10).join(global_items)}
      triggers:
        - uuid: {stable_uuid('pve-api-down')}
          expression: 'last(/{template}/proxmox.collection_status)=0'
          name: 'Proxmox API cannot be collected'
          priority: HIGH
        - uuid: {stable_uuid('pve-failed-backups-24h')}
          expression: 'last(/{template}/proxmox.backup.failed_tasks_24h)>0'
          name: 'Proxmox backup tasks failed in last 24h'
          priority: HIGH
      discovery_rules:
        - uuid: {stable_uuid('pve-storage-discovery')}
          name: 'Proxmox storage discovery'
          type: TRAP
          key: proxmox.storage.discovery
          delay: '0'
          lifetime: 30d
          item_prototypes:
{chr(10).join(storage_items)}
          trigger_prototypes:
            - uuid: {stable_uuid('pve-storage-average')}
              expression: 'last(/{template}/proxmox.storage.usage_percent[{{#NODE}},{{#STORAGE}}])>{{$PROXMOX.STORAGE.PUSED.AVERAGE}}'
              name: 'Proxmox storage {{#NODE}}/{{#STORAGE}} usage > 80%'
              priority: AVERAGE
            - uuid: {stable_uuid('pve-storage-high')}
              expression: 'last(/{template}/proxmox.storage.usage_percent[{{#NODE}},{{#STORAGE}}])>{{$PROXMOX.STORAGE.PUSED.HIGH}}'
              name: 'Proxmox storage {{#NODE}}/{{#STORAGE}} usage > 90%'
              priority: HIGH
            - uuid: {stable_uuid('pve-storage-disaster')}
              expression: 'last(/{template}/proxmox.storage.usage_percent[{{#NODE}},{{#STORAGE}}])>{{$PROXMOX.STORAGE.PUSED.DISASTER}}'
              name: 'Proxmox storage {{#NODE}}/{{#STORAGE}} usage > 95%'
              priority: DISASTER
        - uuid: {stable_uuid('pve-backup-vm-discovery')}
          name: 'Proxmox backup VM discovery'
          type: TRAP
          key: proxmox.backup.vm.discovery
          delay: '0'
          lifetime: 30d
          item_prototypes:
{chr(10).join(vm_items)}
          trigger_prototypes:
            - uuid: {stable_uuid('pve-vm-without-job')}
              expression: 'last(/{template}/proxmox.backup.vm_without_job[{{#VMID}}])=1'
              name: 'Proxmox VM {{#VMID}} is not included in a backup job'
              priority: AVERAGE
"""


def render_push_backup_script() -> str:
    return r'''#!/usr/bin/env python3
"""Dry-run by default: prepare PBS backup metrics for Zabbix trapper items."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

BASE_DIR = Path("/opt/zabbix-codex")
ENV_FILE = Path("/etc/zabbix-codex/proxmox.env")
DEFAULT_INVENTORY = BASE_DIR / "backups" / "pbs-real-inventory.json"
PBS_INVENTORY_SCRIPT = BASE_DIR / "scripts" / "pbs_inventory_readonly.py"
DEFAULT_HOST = "PBS Backup Monitoring"


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


def usage_percent(used: Any, total: Any) -> float:
    total_f = to_float(total)
    if total_f <= 0:
        return 0.0
    return round((to_float(used) / total_f) * 100, 3)


def metric(host: str, key: str, value: Any) -> tuple[str, str, Any]:
    return host, key, value


def pbs_entity_vmid(entity: dict[str, Any]) -> str:
    identity = str(entity.get("identity", ""))
    if "/" in identity:
        return identity.split("/", 1)[1]
    snapshot = entity.get("snapshot") or {}
    return str(snapshot.get("backup-id") or entity.get("backup-id") or "")


def collect_metrics(inventory: dict[str, Any], host: str, recent_hours: int) -> list[tuple[str, str, Any]]:
    now = int(time.time())
    metrics: list[tuple[str, str, Any]] = []
    datastores = inventory.get("datastores") or []
    entities = inventory.get("backup_entities") or []
    cutoff = now - recent_hours * 3600

    metrics.append(metric(host, "pbs.backup.collection_status", 1 if datastores else 0))
    metrics.append(metric(host, "pbs.datastore.discovery", json.dumps({"data": [
        {"{#DATASTORE}": ds.get("name", ""), "{#PATH}": ds.get("path", "")}
        for ds in datastores
    ]}, separators=(",", ":"))))

    for ds in datastores:
        name = str(ds.get("name", ""))
        status = ds.get("status") or {}
        snapshots = ds.get("snapshots") or []
        groups = ds.get("groups") or []
        last_snapshot = max((to_int(snap.get("backup-time")) for snap in snapshots), default=0)
        age_hours = round((now - last_snapshot) / 3600, 3) if last_snapshot else 0
        metrics.extend([
            metric(host, f"pbs.datastore.usage_percent[{name}]", usage_percent(status.get("used"), status.get("total"))),
            metric(host, f"pbs.datastore.total_bytes[{name}]", to_int(status.get("total"))),
            metric(host, f"pbs.datastore.used_bytes[{name}]", to_int(status.get("used"))),
            metric(host, f"pbs.datastore.free_bytes[{name}]", to_int(status.get("avail"))),
            metric(host, f"pbs.datastore.groups[{name}]", len(groups)),
            metric(host, f"pbs.datastore.snapshots[{name}]", len(snapshots)),
            metric(host, f"pbs.datastore.last_snapshot_age_hours[{name}]", age_hours),
        ])

    metrics.append(metric(host, "pbs.backup.discovery", json.dumps({"data": [
        {
            "{#VMID}": pbs_entity_vmid(entity),
            "{#BACKUP_ID}": pbs_entity_vmid(entity),
            "{#BACKUP_TYPE}": str((entity.get("snapshot") or {}).get("backup-type", "")),
            "{#DATASTORE}": str(entity.get("datastore", "")),
            "{#COMMENT}": str((entity.get("snapshot") or {}).get("comment", "")),
        }
        for entity in entities if pbs_entity_vmid(entity)
    ]}, separators=(",", ":"))))

    stale = 0
    oldest_age = 0.0
    for entity in entities:
        vmid = pbs_entity_vmid(entity)
        if not vmid:
            continue
        last_epoch = to_int(entity.get("last_backup_epoch") or (entity.get("snapshot") or {}).get("backup-time"))
        age_hours = round((now - last_epoch) / 3600, 3) if last_epoch else 0
        oldest_age = max(oldest_age, age_hours)
        has_recent = 1 if last_epoch >= cutoff else 0
        if not has_recent:
            stale += 1
        snapshot = entity.get("snapshot") or {}
        protected = 1 if snapshot.get("protected") else 0
        metrics.extend([
            metric(host, f"pbs.backup.last_success_timestamp[{vmid}]", last_epoch),
            metric(host, f"pbs.backup.last_success_age_hours[{vmid}]", age_hours),
            metric(host, f"pbs.backup.snapshot_count[{vmid}]", to_int(entity.get("snapshot_count"), 1)),
            metric(host, f"pbs.backup.has_recent_backup[{vmid}]", has_recent),
            metric(host, f"pbs.backup.datastore[{vmid}]", str(entity.get("datastore", ""))),
            metric(host, f"pbs.backup.protected_count[{vmid}]", protected),
        ])

    metrics.extend([
        metric(host, "pbs.backup.entities_total", len(entities)),
        metric(host, "pbs.backup.entities_without_recent_backup", stale),
        metric(host, "pbs.backup.oldest_backup_age_hours", round(oldest_age, 3)),
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


def refresh_inventory() -> int:
    result = subprocess.run(
        [sys.executable, str(PBS_INVENTORY_SCRIPT)],
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
    parser = argparse.ArgumentParser(description="Prepare/send PBS backup metrics to Zabbix trapper items.")
    parser.add_argument("--inventory-json", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--recent-hours", type=int, default=48)
    parser.add_argument("--server", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=10051)
    parser.add_argument("--sender-bin", default="zabbix_sender")
    parser.add_argument("--send", action="store_true", help="Actually send with zabbix_sender. Default is dry-run.")
    parser.add_argument("--refresh-inventory", action="store_true", help="Refresh PBS inventory with the read-only collector before preparing metrics.")
    parser.add_argument("--limit", type=int, default=0, help="Limit printed dry-run metrics.")
    parser.add_argument("--json", action="store_true", help="Print metrics as JSON in dry-run.")
    args = parser.parse_args()

    env = load_env(ENV_FILE)
    if not env:
        print(f"warning: {ENV_FILE} not found; using existing inventory only", file=sys.stderr)
    if args.refresh_inventory:
        rc = refresh_inventory()
        if rc != 0:
            return rc
    inventory = read_json(args.inventory_json)
    metrics = collect_metrics(inventory, args.host, args.recent_hours)

    if args.send:
        return send_metrics(metrics, args.server, args.port, args.sender_bin)

    shown = metrics[: args.limit] if args.limit else metrics
    print(f"DRY-RUN: {len(metrics)} PBS metrics prepared for host {args.host}.")
    if args.json:
        print(json.dumps([{"host": h, "key": k, "value": v} for h, k, v in shown], indent=2, ensure_ascii=False))
    else:
        for host, key, value in shown:
            print(f"{host} {key} {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def render_push_storage_script() -> str:
    return r'''#!/usr/bin/env python3
"""Dry-run by default: prepare Proxmox storage/backup metrics for Zabbix."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

BASE_DIR = Path("/opt/zabbix-codex")
ENV_FILE = Path("/etc/zabbix-codex/proxmox.env")
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
    parser.add_argument("--send", action="store_true", help="Actually send with zabbix_sender. Default is dry-run.")
    parser.add_argument("--refresh-inventory", action="store_true", help="Refresh Proxmox inventory with the read-only collector before preparing metrics.")
    parser.add_argument("--limit", type=int, default=0, help="Limit printed dry-run metrics.")
    parser.add_argument("--json", action="store_true", help="Print metrics as JSON in dry-run.")
    args = parser.parse_args()

    env = load_env(ENV_FILE)
    if not env:
        print(f"warning: {ENV_FILE} not found; using existing inventory only", file=sys.stderr)
    if args.refresh_inventory:
        rc = refresh_inventory()
        if rc != 0:
            return rc
    inventory = read_json(args.inventory_json)
    metrics = collect_metrics(inventory, args.host)

    if args.send:
        return send_metrics(metrics, args.server, args.port, args.sender_bin)

    shown = metrics[: args.limit] if args.limit else metrics
    print(f"DRY-RUN: {len(metrics)} Proxmox metrics prepared for host {args.host}.")
    if args.json:
        print(json.dumps([{"host": h, "key": k, "value": v} for h, k, v in shown], indent=2, ensure_ascii=False))
    else:
        for host, key, value in shown:
            print(f"{host} {key} {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def render_knowledge_md(plan: dict[str, Any]) -> str:
    immediate = "\n".join(
        f"- {item['priority']} / {item['area']}: {item['finding']}"
        for item in plan["immediate_findings"]
    )
    decisions = "\n".join(f"- {item}" for item in DECISIONS_FROM_FERNANDO)
    return f"""# Knowledge base - Proxmox, PBS y backups

Actualizado: {plan['metadata']['generated_at']}

## Qué sabe Zabbix ahora

- Hosts totales visibles por API: {plan['zabbix_current'].get('hosts_total')}.
- Templates totales visibles por API: {plan['zabbix_current'].get('templates_total')}.
- Items existentes relacionados con `pbs.*`/`proxmox.*`: {len(plan['zabbix_current'].get('existing_metric_items') or [])}.
- Proxmox real: {plan['proxmox_current']['nodes_total']} nodos, {plan['proxmox_current']['qemu_vms_total']} VMs, {plan['proxmox_current']['lxc_total']} LXCs, {plan['proxmox_current']['storages_total']} storages.
- PBS real: {plan['pbs_current']['datastores_total']} datastores, {plan['pbs_current']['snapshots_total']} snapshots, {plan['pbs_current']['backup_entities_total']} entidades con backup.

## Cómo debe razonar el agente

- Priorizar pérdida de datos, backups ausentes, storages >90%, APIs no consultables y VM crítica sin backup.
- Tratar `proxmox-gallarza/datastore-replicas` como gap de capacidad inmediato mientras esté >80%.
- Tratar `ia-dify`/VMID 114 como pendiente de decisión: no está en job Proxmox y su último backup PBS es antiguo.
- Separar problemas reales de cobertura insuficiente: una VM con backup en PBS pero sin evidencia en Zabbix es un gap de observabilidad.

## Hallazgos que debe vigilar

{immediate}

## Automatizable

- Recolectar métricas PBS/Proxmox y enviarlas a trapper items.
- Generar LLD para datastores, storages y VMIDs.
- Calcular edad de último backup por VM/CT.
- Calcular `vm_without_job` a partir de jobs Proxmox.
- Calcular errores recientes de backup Proxmox.

## Requiere intervención humana

- Definir criticidad por VM/host.
- Decidir si `ia-dify` debe tener backup.
- Confirmar hosts técnicos y thresholds.
- Importar templates, crear hosts, asignar templates y activar triggers.
- Modificar jobs de backup o política PBS.

## Decisiones que necesito de Fernando

{decisions}
"""


def render_next_actions_md(plan: dict[str, Any]) -> str:
    safe = "\n".join(f"- {item}" for item in plan["safe_changes_next_phase"])
    human = "\n".join(f"- {item}" for item in plan["human_confirmation_required"])
    return f"""# Próximas acciones - Proxmox/PBS/backups

Actualizado: {plan['metadata']['generated_at']}

## Preparado en esta fase

- Plan de implementación en `{PLAN_MD}` y `{PLAN_JSON}`.
- Template draft PBS en `{PBS_TEMPLATE}`.
- Template draft Proxmox storage en `{PROXMOX_TEMPLATE}`.
- Scripts dry-run de métricas en `{PUSH_BACKUP_SCRIPT}` y `{PUSH_STORAGE_SCRIPT}`.

## Cambios seguros para siguiente fase

{safe}

## Cambios que requieren confirmación humana

{human}

## Orden recomendado

1. Resolver decisiones de Fernando.
2. Ejecutar dry-run de scripts y revisar métricas.
3. Importar templates nuevos no asignados si se autoriza.
4. Crear hosts técnicos si se autoriza.
5. Crear/asignar items trapper y validar recepción.
6. Programar `push_*` con timer/cron.
7. Activar triggers por prioridad tras validar umbrales.
"""


def append_changelog(plan: dict[str, Any]) -> None:
    entry = f"""

## {plan['metadata']['generated_at']} - Fase 5A-3 preparación de checks PBS/Proxmox

- Creado plan de implementación: `{PLAN_MD}` y `{PLAN_JSON}`.
- Creados templates draft no importados:
  - `{PBS_TEMPLATE}`
  - `{PROXMOX_TEMPLATE}`
- Creados scripts dry-run:
  - `{PUSH_BACKUP_SCRIPT}`
  - `{PUSH_STORAGE_SCRIPT}`
- Actualizada knowledge base:
  - `{KNOWLEDGE_MD}`
  - `{NEXT_ACTIONS_MD}`
- Comandos principales:
  - `python3 scripts/prepare_zabbix_backup_checks.py`
  - `python3 -m py_compile scripts/prepare_zabbix_backup_checks.py scripts/push_backup_metrics_to_zabbix.py scripts/push_proxmox_storage_metrics_to_zabbix.py`
  - `python3 scripts/push_backup_metrics_to_zabbix.py --limit 5`
  - `python3 scripts/push_proxmox_storage_metrics_to_zabbix.py --limit 5`
- Cambios aplicados solo en ficheros locales de preparación; no se modificó Zabbix, Proxmox ni PBS.
"""
    previous = CHANGELOG.read_text(encoding="utf-8") if CHANGELOG.exists() else "# CHANGELOG\n"
    write_text(CHANGELOG, previous.rstrip() + entry)


def main() -> int:
    ensure_dirs()
    proxmox = read_json(PROXMOX_INVENTORY)
    pbs = read_json(PBS_INVENTORY)
    gaps = read_json(GAP_ANALYSIS)
    knowledge = read_json(AGENT_KNOWLEDGE)
    zabbix_snapshot = zabbix_readonly_snapshot()
    plan = build_plan(proxmox, pbs, gaps, knowledge, zabbix_snapshot)

    write_json(PLAN_JSON, plan)
    write_text(PLAN_MD, render_plan_md(plan, proxmox, pbs))
    write_text(PBS_TEMPLATE, render_pbs_template())
    write_text(PROXMOX_TEMPLATE, render_proxmox_template())
    write_text(PUSH_BACKUP_SCRIPT, render_push_backup_script(), executable=True)
    write_text(PUSH_STORAGE_SCRIPT, render_push_storage_script(), executable=True)
    write_text(KNOWLEDGE_MD, render_knowledge_md(plan))
    write_text(NEXT_ACTIONS_MD, render_next_actions_md(plan))
    append_changelog(plan)

    print(json.dumps({
        "status": "ok",
        "read_only": True,
        "plan_json": str(PLAN_JSON),
        "plan_md": str(PLAN_MD),
        "zabbix_api_access": plan["zabbix_current"].get("api_access"),
        "pbs_datastores": plan["pbs_current"].get("datastores_total"),
        "proxmox_storages": plan["proxmox_current"].get("storages_total"),
        "generated_files": [
            str(PLAN_JSON),
            str(PLAN_MD),
            str(PBS_TEMPLATE),
            str(PROXMOX_TEMPLATE),
            str(PUSH_BACKUP_SCRIPT),
            str(PUSH_STORAGE_SCRIPT),
            str(KNOWLEDGE_MD),
            str(NEXT_ACTIONS_MD),
        ],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
