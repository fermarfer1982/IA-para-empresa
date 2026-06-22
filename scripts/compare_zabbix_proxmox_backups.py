#!/usr/bin/env python3
"""Compare Zabbix coverage with Proxmox/PBS read-only inventories."""

from __future__ import annotations

import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import plan_zabbix_remediation as zbx  # noqa: E402


BASE_DIR = Path("/opt/zabbix-codex")
REPORTS_DIR = BASE_DIR / "reports"
PROXMOX_DIR = BASE_DIR / "proxmox"
BACKUPS_DIR = BASE_DIR / "backups"
KNOWLEDGE_DIR = BASE_DIR / "agent_knowledge"

PVE_JSON = PROXMOX_DIR / "proxmox-real-inventory.json"
PBS_JSON = BACKUPS_DIR / "pbs-real-inventory.json"
INFRA_JSON = KNOWLEDGE_DIR / "infrastructure_summary.json"
GAPS_JSON = KNOWLEDGE_DIR / "monitoring_gaps.json"
REMEDIATION_JSON = REPORTS_DIR / "zabbix-remediation-plan.json"

OUT_JSON = REPORTS_DIR / "proxmox-backup-gap-analysis.json"
OUT_MD = REPORTS_DIR / "proxmox-backup-gap-analysis.md"
KNOWLEDGE_JSON = KNOWLEDGE_DIR / "proxmox_backup_knowledge.json"
KNOWLEDGE_MD = KNOWLEDGE_DIR / "proxmox_backup_knowledge.md"
READINESS_MD = REPORTS_DIR / "phase-5a-proxmox-backups-readiness.md"

BACKUP_KEYWORDS = ["backup", "pbs", "vzdump", "veeam", "borg", "restic", "rsync", "copia", "copias", "snapshot"]
STORAGE_KEYWORDS = ["storage", "datastore", "zfs", "ceph", "pool", "disk", "smart", "raid"]
PROXMOX_KEYWORDS = ["proxmox", "pve", "pvedaemon", "pveproxy", "pvestatd", "corosync", "ceph"]
SERVICE_KEYS = ["pveproxy", "pvedaemon", "pvestatd", "corosync"]


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


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
    except Exception as exc:  # noqa: BLE001 - read-only analysis should continue on partial permissions.
        errors.append({"method": method, "error": str(exc)})
        return default


def collect_zabbix() -> dict[str, Any]:
    api, safe_url = make_api()
    errors: list[dict[str, str]] = []
    version = safe_call(api, "apiinfo.version", {}, errors, "unknown", auth=False)
    hosts = safe_call(
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
    items = safe_call(
        api,
        "item.get",
        {
            "output": [
                "itemid",
                "hostid",
                "name",
                "key_",
                "type",
                "status",
                "state",
                "error",
                "lastclock",
                "lastvalue",
                "snmp_oid",
                "templateid",
            ],
        },
        errors,
        [],
    )
    triggers = safe_call(
        api,
        "trigger.get",
        {
            "output": ["triggerid", "description", "priority", "status", "value", "lastchange", "templateid", "opdata"],
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItems": ["itemid", "hostid", "name", "key_"],
            "selectTags": "extend",
        },
        errors,
        [],
    )
    problems = safe_call(
        api,
        "problem.get",
        {"output": "extend", "selectTags": "extend", "sortfield": "eventid", "sortorder": "DESC"},
        errors,
        [],
    )
    return {
        "api_endpoint": safe_url,
        "version": version,
        "hosts": hosts,
        "items": items,
        "triggers": triggers,
        "problems": problems,
        "api_errors": errors,
    }


def text_host(host: dict[str, Any]) -> str:
    parts = [host.get("host", ""), host.get("name", "")]
    parts.extend(group.get("name", "") for group in host.get("groups") or [])
    parts.extend(template.get("name", "") or template.get("host", "") for template in host.get("parentTemplates") or [])
    return " ".join(str(part) for part in parts).lower()


def text_item(item: dict[str, Any]) -> str:
    return f"{item.get('name', '')} {item.get('key_', '')} {item.get('snmp_oid', '')}".lower()


def text_trigger(trigger: dict[str, Any]) -> str:
    return f"{trigger.get('description', '')} {trigger.get('opdata', '')}".lower()


def display_host(host: dict[str, Any]) -> str:
    return str(host.get("name") or host.get("host") or host.get("hostid"))


def normalize_name(value: str) -> str:
    value = value.lower().strip()
    value = value.split(".")[0]
    value = re.sub(r"[^a-z0-9]+", "", value)
    return value


def names_match(left: str, right: str) -> bool:
    a = normalize_name(left)
    b = normalize_name(right)
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) >= 6 and (a in b or b in a):
        return True
    return False


def contains_any(text: str, keywords: list[str]) -> bool:
    text = text.lower()
    return any(keyword in text for keyword in keywords)


def host_asset_type(host: dict[str, Any], infra_by_id: dict[str, dict[str, Any]]) -> str:
    from_knowledge = infra_by_id.get(str(host.get("hostid")))
    if from_knowledge:
        return str(from_knowledge.get("asset_type") or "unknown")
    text = text_host(host)
    if "proxmox" in text or " pve" in f" {text}":
        return "proxmox"
    if any(word in text for word in ["backup", "srvcopias", "srvbackup", "veeam"]):
        return "backup_server"
    if "nas" in text:
        return "nas"
    if any(word in text for word in ["sai", "ups", "eaton"]):
        return "ups"
    if any(word in text for word in ["impresora", "printer", "laserjet", "brother", "canon"]):
        return "printer"
    return "server"


def compact_host(host: dict[str, Any], infra_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "hostid": host.get("hostid"),
        "host": host.get("host"),
        "name": host.get("name"),
        "status": "enabled" if str(host.get("status")) == "0" else "disabled",
        "asset_type": host_asset_type(host, infra_by_id),
        "groups": [group.get("name") for group in host.get("groups") or []],
        "templates": [template.get("name") or template.get("host") for template in host.get("parentTemplates") or []],
        "interfaces": [zbx.summarize_interface(interface) for interface in host.get("interfaces") or []],
    }


def compact_item(item: dict[str, Any], host_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    host = host_by_id.get(str(item.get("hostid")), {})
    return {
        "itemid": item.get("itemid"),
        "host": display_host(host) if host else item.get("hostid"),
        "name": item.get("name"),
        "key": item.get("key_"),
        "type": zbx.ITEM_TYPES.get(str(item.get("type", "")), str(item.get("type", ""))),
        "status": "enabled" if str(item.get("status")) == "0" else "disabled",
        "state": "unsupported" if str(item.get("state")) == "1" else "normal",
        "lastclock": zbx.to_int(item.get("lastclock")),
        "lastclock_text": zbx.format_ts(item.get("lastclock")),
        "lastvalue": item.get("lastvalue", ""),
        "error": item.get("error", ""),
    }


def compact_trigger(trigger: dict[str, Any]) -> dict[str, Any]:
    return {
        "triggerid": trigger.get("triggerid"),
        "description": trigger.get("description"),
        "severity": zbx.SEVERITIES.get(str(trigger.get("priority")), str(trigger.get("priority"))),
        "status": "enabled" if str(trigger.get("status")) == "0" else "disabled",
        "hosts": [host.get("name") or host.get("host") for host in trigger.get("hosts") or []],
    }


def analyze_zabbix(zdata: dict[str, Any], infra: dict[str, Any], gaps: dict[str, Any]) -> dict[str, Any]:
    infra_by_id = {str(host.get("hostid")): host for host in infra.get("hosts", [])}
    host_by_id = {str(host.get("hostid")): host for host in zdata["hosts"]}
    items_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in zdata["items"]:
        items_by_host[str(item.get("hostid"))].append(item)

    proxmox_hosts = []
    vm_like_hosts = []
    backup_evidence_hosts = set()
    storage_items = []
    backup_items = []
    proxmox_items = []

    for host in zdata["hosts"]:
        asset_type = host_asset_type(host, infra_by_id)
        htext = text_host(host)
        compact = compact_host(host, infra_by_id)
        if asset_type == "proxmox" or contains_any(htext, PROXMOX_KEYWORDS):
            proxmox_hosts.append(compact)
        if asset_type in {"server", "backup_server", "proxmox"} or contains_any(htext, ["srv", "server", "windows", "linux"]):
            vm_like_hosts.append(compact)
        for item in items_by_host[str(host.get("hostid"))]:
            itext = text_item(item)
            if contains_any(itext, BACKUP_KEYWORDS):
                backup_items.append(compact_item(item, host_by_id))
                backup_evidence_hosts.add(str(host.get("hostid")))
            if contains_any(itext, STORAGE_KEYWORDS):
                storage_items.append(compact_item(item, host_by_id))
            if contains_any(itext, PROXMOX_KEYWORDS):
                proxmox_items.append(compact_item(item, host_by_id))

    backup_triggers = [compact_trigger(trigger) for trigger in zdata["triggers"] if contains_any(text_trigger(trigger), BACKUP_KEYWORDS)]
    storage_triggers = [compact_trigger(trigger) for trigger in zdata["triggers"] if contains_any(text_trigger(trigger), STORAGE_KEYWORDS)]
    quorum_triggers = [compact_trigger(trigger) for trigger in zdata["triggers"] if contains_any(text_trigger(trigger), ["quorum", "corosync", "cluster"])]
    service_checks = {
        service: {
            "items": [compact_item(item, host_by_id) for item in zdata["items"] if service in text_item(item)],
            "triggers": [compact_trigger(trigger) for trigger in zdata["triggers"] if service in text_trigger(trigger)],
        }
        for service in SERVICE_KEYS
    }
    ceph_evidence = {
        "items": [compact_item(item, host_by_id) for item in zdata["items"] if "ceph" in text_item(item)],
        "triggers": [compact_trigger(trigger) for trigger in zdata["triggers"] if "ceph" in text_trigger(trigger)],
    }
    smart_evidence = {
        "items": [compact_item(item, host_by_id) for item in zdata["items"] if contains_any(text_item(item), ["smart", "raid", "disk", "hdd", "ssd"])],
        "triggers": [compact_trigger(trigger) for trigger in zdata["triggers"] if contains_any(text_trigger(trigger), ["smart", "raid", "disk", "hdd", "ssd"])],
    }

    backup_gaps = gaps.get("backup_gaps") or []
    if not backup_gaps:
        backup_gaps = [
            {
                "host": {"hostid": entry.get("hostid"), "host": entry.get("host"), "name": entry.get("name")},
                "groups": [{"name": group} for group in entry.get("groups") or []],
                "note": "Sin evidencia directa de backup en base de conocimiento.",
            }
            for entry in infra.get("hosts", [])
            if "backup" in (entry.get("checks_missing") or []) and entry.get("priority") in {"CRITICO", "ALTO"}
        ]

    return {
        "proxmox_hosts": proxmox_hosts,
        "vm_like_hosts": vm_like_hosts,
        "storage_items": storage_items,
        "storage_triggers": storage_triggers,
        "backup_items": backup_items,
        "backup_triggers": backup_triggers,
        "backup_evidence_hostids": sorted(backup_evidence_hosts),
        "critical_hosts_without_backup_evidence": backup_gaps,
        "quorum_triggers": quorum_triggers,
        "service_checks": service_checks,
        "ceph_evidence": {
            "items_count": len(ceph_evidence["items"]),
            "triggers_count": len(ceph_evidence["triggers"]),
            "items_sample": ceph_evidence["items"][:25],
            "triggers_sample": ceph_evidence["triggers"][:25],
        },
        "smart_evidence": {
            "items_count": len(smart_evidence["items"]),
            "triggers_count": len(smart_evidence["triggers"]),
            "items_sample": smart_evidence["items"][:25],
            "triggers_sample": smart_evidence["triggers"][:25],
        },
    }


def real_node_names(pve: dict[str, Any]) -> list[str]:
    return [str(node.get("node")) for node in pve.get("nodes") or [] if node.get("node")]


def real_vm_names(pve: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for kind, source in [("qemu", pve.get("qemu_vms") or []), ("lxc", pve.get("lxc_containers") or [])]:
        for vm in source:
            rows.append(
                {
                    "kind": kind,
                    "vmid": vm.get("vmid"),
                    "name": vm.get("name") or str(vm.get("vmid")),
                    "node": vm.get("node"),
                    "status": vm.get("status"),
                }
            )
    return rows


def storage_id(storage: dict[str, Any]) -> str:
    return str(storage.get("storage") or storage.get("id") or storage.get("name") or "")


def compare_real_vs_zabbix(zbx_analysis: dict[str, Any], pve: dict[str, Any], pbs: dict[str, Any]) -> dict[str, Any]:
    pve_access = bool((pve.get("access") or {}).get("available"))
    pbs_access = bool((pbs.get("access") or {}).get("available"))
    zbx_host_norm = {normalize_name(host.get("name") or host.get("host") or ""): host for host in zbx_analysis["vm_like_hosts"] + zbx_analysis["proxmox_hosts"]}
    zbx_proxmox_norm = {normalize_name(host.get("name") or host.get("host") or ""): host for host in zbx_analysis["proxmox_hosts"]}

    nodes_missing = []
    vms_missing = []
    stopped_vms = []
    storages_without_capacity = []
    datastores_without_trigger = []
    zabbix_vm_like_not_in_proxmox = []
    pve_failed_backup_tasks = []
    pve_backup_jobs = pve.get("backup_jobs") or []
    pve_backup_job_vmids = backup_job_vmids(pve_backup_jobs)
    pve_backup_tasks = pve.get("recent_backup_tasks") or []
    pve_recent_success_by_vmid = recent_successful_backup_by_vmid(pve_backup_tasks)
    pve_backup_tasks_failed = failed_tasks(pve_backup_tasks)
    vms_without_backup_job = []
    vms_without_recent_backup = []
    if pve_access:
        real_nodes = real_node_names(pve)
        real_vms = real_vm_names(pve)
        real_vm_names_norm = [str(vm.get("name") or "") for vm in real_vms]
        for node in real_nodes:
            if normalize_name(node) not in zbx_proxmox_norm and normalize_name(node) not in zbx_host_norm:
                nodes_missing.append(node)
        for host in zbx_analysis["vm_like_hosts"]:
            hname = str(host.get("name") or host.get("host") or "")
            if hname and not any(names_match(hname, real_name) for real_name in real_vm_names_norm + real_nodes):
                zabbix_vm_like_not_in_proxmox.append(host)
        for vm in real_vms:
            vm_name = str(vm.get("name") or "")
            vmid = str(vm.get("vmid") or "")
            matched = any(names_match(vm_name, host.get("name") or host.get("host") or "") for host in zbx_analysis["vm_like_hosts"])
            matched = matched or normalize_name(vmid) in zbx_host_norm
            if not matched:
                vm["possible_zabbix_matches"] = possible_matches(vm_name, zbx_analysis["vm_like_hosts"])
                vms_missing.append(vm)
            if str(vm.get("status", "")).lower() not in {"running", ""}:
                stopped_vms.append(vm)
            if vmid and vmid not in pve_backup_job_vmids:
                vms_without_backup_job.append(vm)
            last_success = pve_recent_success_by_vmid.get(vmid, 0)
            if vmid and (not last_success or int(time.time()) - last_success > 48 * 3600):
                vm_copy = dict(vm)
                vm_copy["last_successful_backup_epoch"] = last_success
                vm_copy["last_successful_backup_text"] = zbx.format_ts(last_success)
                vms_without_recent_backup.append(vm_copy)
        storage_text = "\n".join(f"{item.get('host')} {item.get('name')} {item.get('key')}" for item in zbx_analysis["storage_items"]).lower()
        trigger_text = "\n".join(f"{trigger.get('description')}" for trigger in zbx_analysis["storage_triggers"]).lower()
        for storage in pve.get("storages") or []:
            sid = storage_id(storage)
            if sid and sid.lower() not in storage_text:
                storages_without_capacity.append(storage)
            if sid and sid.lower() not in trigger_text:
                datastores_without_trigger.append(storage)
        pve_failed_backup_tasks = pve_backup_tasks_failed

    pbs_backup_entities = pbs.get("backup_entities") or []
    backup_entities_without_zabbix = []
    old_backups = []
    now = int(time.time())
    if pbs_access:
        zbx_text = "\n".join(f"{item.get('host')} {item.get('name')} {item.get('key')}" for item in zbx_analysis["backup_items"]).lower()
        for entity in pbs_backup_entities:
            identity = str(entity.get("identity") or "")
            if identity and normalize_name(identity) not in normalize_name(zbx_text):
                backup_entities_without_zabbix.append(entity)
            last_epoch = zbx.to_int(entity.get("last_backup_epoch"))
            if last_epoch and now - last_epoch > 48 * 3600:
                old_backups.append(entity)

        recent_pbs_vmids = recent_pbs_backup_vmids(pbs_backup_entities, max_age_seconds=48 * 3600)
        if recent_pbs_vmids:
            vms_without_recent_backup = [
                vm for vm in vms_without_recent_backup if str(vm.get("vmid") or "") not in recent_pbs_vmids
            ]

    return {
        "real_access": {"proxmox": pve_access, "pbs": pbs_access},
        "nodes_real": real_node_names(pve) if pve_access else [],
        "nodes_missing_in_zabbix": nodes_missing,
        "vms_lxcs_real": real_vm_names(pve) if pve_access else [],
        "vms_lxcs_missing_in_zabbix": vms_missing,
        "zabbix_vm_like_hosts_not_in_real_proxmox": zabbix_vm_like_not_in_proxmox,
        "vms_lxcs_stopped_requires_validation": stopped_vms,
        "storages_without_capacity_check": storages_without_capacity,
        "datastores_without_space_trigger": datastores_without_trigger,
        "pve_backup_jobs": pve_backup_jobs,
        "pve_backup_job_vmids": sorted(pve_backup_job_vmids, key=lambda value: int(value) if value.isdigit() else value),
        "pve_failed_backup_tasks": pve_failed_backup_tasks,
        "pve_vms_without_backup_job": vms_without_backup_job,
        "pve_vms_without_recent_backup_48h": vms_without_recent_backup,
        "pbs_backup_entities": pbs_backup_entities if pbs_access else [],
        "pbs_backup_entities_without_zabbix_evidence": backup_entities_without_zabbix,
        "pbs_backups_older_than_48h": old_backups,
        "pbs_failed_tasks": pbs.get("failed_tasks") or [],
    }


def possible_matches(vm_name: str, hosts: list[dict[str, Any]]) -> list[str]:
    matches = []
    for host in hosts:
        hname = str(host.get("name") or host.get("host") or "")
        if names_match(vm_name, hname):
            matches.append(hname)
    return matches[:5]


def backup_job_vmids(jobs: list[dict[str, Any]]) -> set[str]:
    vmids: set[str] = set()
    for job in jobs:
        for part in str(job.get("vmid") or "").split(","):
            value = part.strip()
            if value:
                vmids.add(value)
    return vmids


def failed_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [task for task in tasks if str(task.get("status", "")).upper() not in {"", "OK", "RUNNING"}]


def recent_successful_backup_by_vmid(tasks: list[dict[str, Any]]) -> dict[str, int]:
    latest: dict[str, int] = {}
    for task in tasks:
        vmid = str(task.get("id") or "")
        if not vmid:
            continue
        if str(task.get("status", "")).upper() != "OK":
            continue
        timestamp = zbx.to_int(task.get("endtime") or task.get("starttime"))
        if timestamp > latest.get(vmid, 0):
            latest[vmid] = timestamp
    return latest


def recent_pbs_backup_vmids(entities: list[dict[str, Any]], max_age_seconds: int) -> set[str]:
    now = int(time.time())
    vmids: set[str] = set()
    for entity in entities:
        identity = str(entity.get("identity") or "")
        match = re.match(r"^(?:vm|ct)/(\d+)$", identity)
        if not match:
            continue
        last_epoch = zbx.to_int(entity.get("last_backup_epoch"))
        if last_epoch and now - last_epoch <= max_age_seconds:
            vmids.add(match.group(1))
    return vmids


def priority_gaps(zbx_analysis: dict[str, Any], comparison: dict[str, Any], pve: dict[str, Any], pbs: dict[str, Any]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []

    def add(priority: str, area: str, finding: str, recommendation: str, human: bool = True, automatic: bool = False) -> None:
        gaps.append(
            {
                "priority": priority,
                "area": area,
                "finding": finding,
                "recommendation": recommendation,
                "requires_human_confirmation": human,
                "can_prepare_automatically": automatic,
            }
        )

    if not comparison["real_access"]["proxmox"]:
        add("ALTO", "Proxmox", "No hay acceso real a Proxmox API.", "Configurar /etc/zabbix-codex/proxmox.env con token read-only para comparar nodos, VMs, storages y jobs.", human=True, automatic=False)
    if not comparison["real_access"]["pbs"]:
        add("ALTO", "PBS", "No hay acceso real a PBS API.", "Configurar datos PBS en /etc/zabbix-codex/proxmox.env para verificar backups reales, datastores y snapshots.", human=True, automatic=False)
    else:
        pbs_summary = pbs.get("summary") or {}
        relevant_permissions_missing = [
            entry for entry in pbs.get("permissions_missing") or [] if entry.get("endpoint") != "/nodes"
        ]
        if pbs_summary.get("datastores_total", 0) == 0:
            add("ALTO", "PBS", "PBS API autentica, pero no se han detectado datastores.", "Revisar permisos ACL del token PBS: Datastore.Audit y Datastore.Read sobre los datastores reales.", human=True, automatic=False)
        elif relevant_permissions_missing:
            add("ALTO", "PBS", f"PBS API autentica, pero {len(relevant_permissions_missing)} endpoints de datastore/snapshot estan bloqueados.", "Revisar permisos ACL del token PBS para inventario completo de backups.", human=True, automatic=False)
        if comparison["pbs_backup_entities_without_zabbix_evidence"]:
            add("ALTO", "Backups", f"{len(comparison['pbs_backup_entities_without_zabbix_evidence'])} entidades PBS con backup no tienen evidencia directa equivalente en Zabbix.", "Crear checks por VM/CT o mapa job->activo para que el agente pueda verificar cobertura de backup.", human=True, automatic=True)
        if comparison["pbs_backups_older_than_48h"]:
            add("ALTO", "Backups", f"{len(comparison['pbs_backups_older_than_48h'])} entidades PBS tienen backup mas antiguo de 48h.", "Revisar jobs y criticidad; crear alerta por edad maxima de backup.", human=True, automatic=True)
    if zbx_analysis["critical_hosts_without_backup_evidence"]:
        add("ALTO", "Backups", f"{len(zbx_analysis['critical_hosts_without_backup_evidence'])} hosts criticos sin evidencia directa de backup.", "Verificar si estan cubiertos por Veeam/PBS/vzdump y crear checks por job o por host.", human=True, automatic=True)
    if not zbx_analysis["quorum_triggers"]:
        add("ALTO", "Proxmox", "No hay trigger claro de quorum/corosync/cluster en Zabbix.", "Preparar check de quorum y alerta High/Disaster para cluster Proxmox.", human=True, automatic=True)
    service_missing = [name for name, checks in zbx_analysis["service_checks"].items() if not checks["items"] and not checks["triggers"]]
    if service_missing:
        add("MEDIO", "Proxmox", "Servicios Proxmox sin check claro: " + ", ".join(service_missing), "Preparar items de servicios pveproxy/pvedaemon/pvestatd/corosync en template draft.", human=True, automatic=True)
    if comparison["storages_without_capacity_check"]:
        add("ALTO", "Storage", f"{len(comparison['storages_without_capacity_check'])} storages reales sin check de capacidad detectable.", "Crear o vincular checks de capacidad por datastore tras confirmar inventario real.", human=True, automatic=True)
    if comparison["datastores_without_space_trigger"]:
        add("ALTO", "Storage", f"{len(comparison['datastores_without_space_trigger'])} datastores reales sin trigger de espacio detectable.", "Crear triggers de uso >80%/>90% por datastore.", human=True, automatic=True)
    if comparison["pve_failed_backup_tasks"]:
        add("ALTO", "Backups", f"{len(comparison['pve_failed_backup_tasks'])} tareas de backup Proxmox recientes con error.", "Revisar tareas vzdump fallidas y crear alerta por job/tarea fallida.", human=True, automatic=False)
    if comparison["pve_vms_without_backup_job"]:
        add("ALTO", "Backups", f"{len(comparison['pve_vms_without_backup_job'])} VMs/LXCs no aparecen en jobs de backup Proxmox.", "Confirmar criticidad y añadirlas a job o documentar exclusion.", human=True, automatic=False)
    if comparison["pve_vms_without_recent_backup_48h"]:
        add("ALTO", "Backups", f"{len(comparison['pve_vms_without_recent_backup_48h'])} VMs/LXCs sin backup individual OK en ultimas 48h segun tareas disponibles.", "Validar contra PBS/Veeam y jobs completos; crear check de edad por VM.", human=True, automatic=True)
    if comparison["pbs_failed_tasks"]:
        add("ALTO", "Backups", f"{len(comparison['pbs_failed_tasks'])} tareas PBS fallidas recientes.", "Revisar fallos PBS y crear triggers de tareas fallidas.", human=True, automatic=False)
    if (pve.get("summary") or {}).get("ceph_detected") and not zbx_analysis["ceph_evidence"]["triggers_count"]:
        add("ALTO", "Ceph", "Ceph detectado en Proxmox sin triggers claros en Zabbix.", "Preparar checks Ceph health/quorum/OSD/mon.", human=True, automatic=True)
    if not zbx_analysis["smart_evidence"]["triggers_count"]:
        add("ALTO", "SMART/RAID", "No hay triggers SMART/RAID claros asociados a Proxmox/storage.", "Preparar checks SMART/RAID para nodos fisicos antes de asignar templates.", human=True, automatic=True)
    return gaps


def build_analysis() -> dict[str, Any]:
    infra = load_json(INFRA_JSON, {})
    gaps = load_json(GAPS_JSON, {})
    remediation = load_json(REMEDIATION_JSON, {})
    pve = load_json(PVE_JSON, {})
    pbs = load_json(PBS_JSON, {})
    zdata = collect_zabbix()
    zbx_analysis = analyze_zabbix(zdata, infra, gaps)
    comparison = compare_real_vs_zabbix(zbx_analysis, pve, pbs)
    gaps_prioritized = priority_gaps(zbx_analysis, comparison, pve, pbs)
    return {
        "metadata": {
            "generated_at": now_text(),
            "generated_epoch": int(time.time()),
            "mode": "read-only",
            "zabbix_api_endpoint": zdata["api_endpoint"],
            "zabbix_version": zdata["version"],
            "source_files": {
                "pve_inventory": str(PVE_JSON),
                "pbs_inventory": str(PBS_JSON),
                "infrastructure_summary": str(INFRA_JSON),
                "monitoring_gaps": str(GAPS_JSON),
            },
        },
        "summary": {
            "zabbix_hosts_total": len(zdata["hosts"]),
            "zabbix_proxmox_hosts": len(zbx_analysis["proxmox_hosts"]),
            "zabbix_vm_like_hosts": len(zbx_analysis["vm_like_hosts"]),
            "zabbix_storage_items": len(zbx_analysis["storage_items"]),
            "zabbix_backup_items": len(zbx_analysis["backup_items"]),
            "zabbix_backup_triggers": len(zbx_analysis["backup_triggers"]),
            "critical_hosts_without_backup_evidence": len(zbx_analysis["critical_hosts_without_backup_evidence"]),
            "proxmox_api_access": comparison["real_access"]["proxmox"],
            "pbs_api_access": comparison["real_access"]["pbs"],
            "real_nodes_total": len(comparison["nodes_real"]),
            "real_vms_lxcs_total": len(comparison["vms_lxcs_real"]),
            "real_pbs_backup_entities_total": len(comparison["pbs_backup_entities"]),
            "pve_backup_jobs_total": len(comparison["pve_backup_jobs"]),
            "pve_failed_backup_tasks_total": len(comparison["pve_failed_backup_tasks"]),
            "pve_vms_without_backup_job_total": len(comparison["pve_vms_without_backup_job"]),
            "pve_vms_without_recent_backup_48h_total": len(comparison["pve_vms_without_recent_backup_48h"]),
            "zabbix_vm_like_hosts_not_in_real_proxmox_total": len(comparison["zabbix_vm_like_hosts_not_in_real_proxmox"]),
            "prioritized_gaps_total": len(gaps_prioritized),
        },
        "zabbix": zbx_analysis,
        "real_inventory": {
            "proxmox": {
                "access": pve.get("access", {}),
                "summary": pve.get("summary", {}),
                "version": pve.get("version"),
            },
            "pbs": {
                "access": pbs.get("access", {}),
                "summary": pbs.get("summary", {}),
                "version": pbs.get("version"),
            },
        },
        "comparison": comparison,
        "prioritized_gaps": gaps_prioritized,
        "pending_configuration": pending_configuration(pve, pbs),
        "previous_context": {
            "remediation_proxmox": remediation.get("proxmox", {}),
            "remediation_backups": remediation.get("backups", {}),
        },
        "api_errors": zdata["api_errors"],
    }


def pending_configuration(pve: dict[str, Any], pbs: dict[str, Any]) -> list[dict[str, Any]]:
    pending = []
    if not (pve.get("access") or {}).get("available"):
        pending.append(
            {
                "system": "Proxmox VE",
                "file": "/etc/zabbix-codex/proxmox.env",
                "required_keys": ["PROXMOX_ENDPOINT", "PROXMOX_TOKEN_ID", "PROXMOX_TOKEN_SECRET", "PROXMOX_VERIFY_SSL"],
                "minimum_privileges": ["Sys.Audit", "VM.Audit", "Datastore.Audit"],
            }
        )
    if not (pbs.get("access") or {}).get("available"):
        pending.append(
            {
                "system": "Proxmox Backup Server",
                "file": "/etc/zabbix-codex/proxmox.env",
                "required_keys": ["PBS_ENDPOINT", "PBS_TOKEN_ID", "PBS_TOKEN_SECRET", "PBS_VERIFY_SSL"],
                "minimum_privileges": ["Datastore.Audit", "Datastore.Read", "Sys.Audit"],
            }
        )
    return pending


def render_gap_report(data: dict[str, Any]) -> str:
    lines = [
        "# Analisis de gaps Proxmox, storage y backups",
        "",
        f"- Generado: {data['metadata']['generated_at']}",
        f"- Zabbix version: `{data['metadata']['zabbix_version']}`",
        f"- Acceso Proxmox API: `{data['summary']['proxmox_api_access']}`",
        f"- Acceso PBS API: `{data['summary']['pbs_api_access']}`",
        "",
        "## Datos obtenidos desde Zabbix",
        "",
        f"- Hosts Proxmox en Zabbix: `{data['summary']['zabbix_proxmox_hosts']}`",
        f"- Hosts tipo VM/servidor en Zabbix: `{data['summary']['zabbix_vm_like_hosts']}`",
        f"- Items storage detectados: `{data['summary']['zabbix_storage_items']}`",
        f"- Items backup detectados: `{data['summary']['zabbix_backup_items']}`",
        f"- Triggers backup detectados: `{data['summary']['zabbix_backup_triggers']}`",
        f"- Hosts criticos sin evidencia directa de backup: `{data['summary']['critical_hosts_without_backup_evidence']}`",
        "",
    ]
    lines.append(zbx.md_table(["Host", "Tipo", "Templates"], [[h["name"] or h["host"], h["asset_type"], ", ".join(h["templates"][:4])] for h in data["zabbix"]["proxmox_hosts"]]))
    if data["pending_configuration"]:
        lines.extend(["## Datos pendientes de Proxmox/PBS", ""])
        rows = []
        for item in data["pending_configuration"]:
            rows.append([item["system"], item["file"], ", ".join(item["required_keys"]), ", ".join(item["minimum_privileges"])])
        lines.append(zbx.md_table(["Sistema", "Fichero", "Claves", "Privilegios minimos"], rows))

    lines.extend(
        [
            "## Diferencias Zabbix vs Proxmox/PBS",
            "",
            f"- Nodos reales ausentes en Zabbix: `{len(data['comparison']['nodes_missing_in_zabbix'])}`",
            f"- VMs/LXCs reales ausentes en Zabbix: `{len(data['comparison']['vms_lxcs_missing_in_zabbix'])}`",
            f"- Storages reales sin check de capacidad: `{len(data['comparison']['storages_without_capacity_check'])}`",
            f"- PBS entidades sin evidencia Zabbix: `{len(data['comparison']['pbs_backup_entities_without_zabbix_evidence'])}`",
            f"- Hosts Zabbix tipo VM/servidor no encontrados en Proxmox real: `{len(data['comparison']['zabbix_vm_like_hosts_not_in_real_proxmox'])}`",
            f"- VMs/LXCs sin job de backup Proxmox: `{len(data['comparison']['pve_vms_without_backup_job'])}`",
            f"- Tareas Proxmox backup fallidas recientes: `{len(data['comparison']['pve_failed_backup_tasks'])}`",
            "",
            "## Hosts criticos sin backup verificable",
            "",
        ]
    )
    lines.append(
        zbx.md_table(
            ["Host", "Grupos", "Nota"],
            [
                [
                    (entry.get("host") or {}).get("name") or (entry.get("host") or {}).get("host"),
                    ", ".join(group.get("name", "") for group in entry.get("groups") or []),
                    entry.get("note", ""),
                ]
                for entry in data["zabbix"]["critical_hosts_without_backup_evidence"]
            ],
        )
    )
    lines.extend(["## Gaps prioritarios", ""])
    lines.append(zbx.md_table(["Prioridad", "Area", "Hallazgo", "Recomendacion"], [[g["priority"], g["area"], g["finding"], g["recommendation"]] for g in data["prioritized_gaps"]]))
    return "\n".join(lines) + "\n"


def render_knowledge_md(data: dict[str, Any]) -> str:
    missing_lines = []
    pbs_access = ((data.get("real_inventory") or {}).get("pbs") or {}).get("access") or {}
    pbs_summary = ((data.get("real_inventory") or {}).get("pbs") or {}).get("summary") or {}
    if not data["summary"]["proxmox_api_access"]:
        missing_lines.append("- Acceso/API read-only de Proxmox.")
    if not data["summary"]["pbs_api_access"]:
        missing_lines.append("- Acceso/API read-only de PBS valido.")
    elif pbs_summary.get("datastores_total", 0) == 0 or data["summary"]["real_pbs_backup_entities_total"] == 0:
        missing_lines.append("- Permisos PBS suficientes para version/API basica, pero insuficientes para datastores, snapshots y tareas.")
    elif pbs_access.get("permissions_limited"):
        missing_lines.append("- Permiso PBS opcional para `/nodes` si se quieren tareas por nodo; datastores y snapshots ya son legibles.")
    missing_lines.extend(
        [
            "- Checks de servicios Proxmox, datastores, PBS, backup age y fallos.",
            "- Evidencia de backup por host critico o por job central con mapeo explicito.",
            "- Criticidad de VMs/LXCs para priorizar alertas.",
        ]
    )
    lines = [
        "# Knowledge base Proxmox, storage y backups",
        "",
        "## Que sabe Zabbix ahora",
        "",
        f"- Hosts Proxmox: `{data['summary']['zabbix_proxmox_hosts']}`.",
        f"- Items storage: `{data['summary']['zabbix_storage_items']}`.",
        f"- Items backup: `{data['summary']['zabbix_backup_items']}`.",
        f"- Triggers backup: `{data['summary']['zabbix_backup_triggers']}`.",
        f"- Hosts criticos sin backup verificable: `{data['summary']['critical_hosts_without_backup_evidence']}`.",
        f"- Jobs Proxmox backup reales: `{data['summary'].get('pve_backup_jobs_total', 0)}`.",
        f"- Tareas Proxmox backup fallidas recientes: `{data['summary'].get('pve_failed_backup_tasks_total', 0)}`.",
        "",
        "## Que falta",
        "",
        *missing_lines,
        "",
        "## Como debe razonar el agente",
        "",
        "- Priorizar primero perdida de datos: storage, SMART/RAID, backups ausentes/fallidos y quorum.",
        "- Distinguir falta de evidencia en Zabbix de fallo real: si no hay API real, marcar como pendiente, no como caido.",
        "- Considerar Proxmox/PBS sin monitorizacion completa como riesgo ALTO aunque no haya problema activo.",
        "- Nunca recomendar silenciar alertas de storage o backup como solucion principal.",
        "",
        "## Requiere intervencion humana",
        "",
        "- Decidir criticidad de VMs/LXCs.",
        "- Confirmar alcance real de backups y retencion.",
        "- Cambios en jobs PBS/vzdump/Veeam.",
        "- Cambios en templates existentes, triggers o macros.",
        "",
        "## Puede prepararse automaticamente",
        "",
        "- Regenerar inventarios e informes.",
        "- Crear templates draft no asignados.",
        "- Preparar scripts de comparacion y checks pasivos/trapper sin vincular.",
    ]
    return "\n".join(lines) + "\n"


def render_readiness_md(data: dict[str, Any]) -> str:
    if data["summary"]["proxmox_api_access"] or data["summary"]["pbs_api_access"]:
        summary_text = "La fase queda preparada en modo read-only y se ha incorporado el inventario real disponible de Proxmox/PBS a la comparacion con Zabbix."
    else:
        summary_text = "La fase queda preparada en modo read-only. Zabbix aporta datos parciales de Proxmox/storage/backups, pero no existe acceso real Proxmox/PBS configurado, por lo que la comparacion contra inventario real queda pendiente."
    consulted = [
        "- Zabbix API: hosts, items, triggers y problemas.",
        "- Inventarios JSON existentes de la base del agente.",
    ]
    not_consulted = []
    if data["summary"]["proxmox_api_access"]:
        consulted.append("- API real de Proxmox VE: nodos, VMs, storages, cluster, jobs y tareas.")
    else:
        not_consulted.append("- API real de Proxmox VE.")
    pbs_access = ((data.get("real_inventory") or {}).get("pbs") or {}).get("access") or {}
    pbs_first_error = (pbs_access.get("first_error") or {}).get("error")
    pbs_summary = ((data.get("real_inventory") or {}).get("pbs") or {}).get("summary") or {}
    if data["summary"]["pbs_api_access"] and pbs_summary.get("datastores_total", 0) > 0:
        consulted.append("- API real de Proxmox Backup Server: version, datastores, status, groups y snapshots.")
        if pbs_access.get("permissions_limited") and pbs_first_error:
            not_consulted.append(f"- Endpoint PBS opcional `{(pbs_access.get('first_error') or {}).get('endpoint')}`: `{pbs_first_error}`.")
    elif data["summary"]["pbs_api_access"] and not pbs_access.get("permissions_limited"):
        consulted.append("- API real de Proxmox Backup Server: datastores, snapshots, jobs y tareas.")
    elif data["summary"]["pbs_api_access"]:
        consulted.append("- API real de Proxmox Backup Server: version/API basica.")
        if pbs_first_error:
            not_consulted.append(f"- Inventario completo PBS de nodos/datastores/snapshots/tareas: `{pbs_first_error}`.")
    else:
        if pbs_first_error:
            not_consulted.append(f"- API real de Proxmox Backup Server: `{pbs_first_error}`.")
        else:
            not_consulted.append("- API real de Proxmox Backup Server.")
    risks = [
        f"- Los {data['summary']['critical_hosts_without_backup_evidence']} hosts criticos sin evidencia directa de backup siguen siendo riesgo operativo.",
        "- Zabbix no debe ser considerado fuente completa de backups hasta mapear Proxmox/PBS/Veeam.",
    ]
    if not data["summary"]["pbs_api_access"]:
        risks.insert(0, "- Sin PBS API valida no se puede probar cobertura completa de snapshots, retencion, verify, prune y datastores PBS.")

    lines = [
        "# Fase 5A - Readiness Proxmox, storage y backups",
        "",
        "## Resumen ejecutivo",
        "",
        summary_text,
        "",
        "## Que se pudo consultar",
        "",
        *consulted,
        "",
        "## Que no se pudo consultar",
        "",
        *(not_consulted or ["- Sin bloqueos de consulta detectados."]),
        "",
        "## Estado Proxmox segun Zabbix",
        "",
        f"- Hosts Proxmox en Zabbix: `{data['summary']['zabbix_proxmox_hosts']}`.",
        f"- Items Proxmox/storage relacionados: `{data['summary']['zabbix_storage_items']}`.",
        f"- Trigger quorum/corosync/cluster detectados: `{len(data['zabbix']['quorum_triggers'])}`.",
        "",
        "## Estado backup segun Zabbix",
        "",
        f"- Items backup detectados: `{data['summary']['zabbix_backup_items']}`.",
        f"- Triggers backup detectados: `{data['summary']['zabbix_backup_triggers']}`.",
        f"- Hosts criticos sin backup verificable: `{data['summary']['critical_hosts_without_backup_evidence']}`.",
        "",
        "## Inventario real Proxmox/PBS",
        "",
        f"- Proxmox API disponible: `{data['summary']['proxmox_api_access']}`.",
        f"- PBS API disponible: `{data['summary']['pbs_api_access']}`.",
        f"- PBS permisos limitados: `{bool(pbs_access.get('permissions_limited'))}`.",
        f"- Nodos reales detectados: `{data['summary']['real_nodes_total']}`.",
        f"- VMs/LXCs reales detectados: `{data['summary']['real_vms_lxcs_total']}`.",
        f"- Entidades PBS con backup detectadas: `{data['summary']['real_pbs_backup_entities_total']}`.",
        f"- Jobs Proxmox backup detectados: `{data['summary'].get('pve_backup_jobs_total', 0)}`.",
        f"- Tareas Proxmox backup fallidas recientes: `{data['summary'].get('pve_failed_backup_tasks_total', 0)}`.",
        "",
        "## Gaps principales",
        "",
    ]
    lines.append(zbx.md_table(["Prioridad", "Area", "Hallazgo", "Recomendacion"], [[g["priority"], g["area"], g["finding"], g["recommendation"]] for g in data["prioritized_gaps"]]))
    lines.extend(
        [
            "## Templates draft creados",
            "",
            "- `/opt/zabbix-codex/templates/drafts/proxmox/template_proxmox_agent_intelligent.yaml`",
            "- `/opt/zabbix-codex/templates/drafts/backups/template_backup_intelligent.yaml`",
            "- `/opt/zabbix-codex/templates/drafts/backups/template_pbs_intelligent.yaml`",
            "",
            "## Alertas recomendadas",
            "",
            "- Disaster: quorum perdido, storage critico inaccesible, nodo critico caido, backups criticos ausentes.",
            "- High: backup fallido de VM critica, datastore >90%, PBS con poco espacio, SMART/RAID degradado.",
            "- Average: datastore >80%, backup antiguo, servicio Proxmox parcial, Ceph warning.",
            "- Warning/Information: backup tardio, snapshots antiguos, cambios de inventario.",
            "",
        "## Riesgos",
        "",
        *risks,
        "",
        "## Siguiente fase",
        "",
        "Preparar checks/alertas draft para datastores PBS, edad de backup por VM/CT, jobs de backup y servicios Proxmox sin aplicar cambios todavia.",
    ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    data = build_analysis()
    OUT_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    OUT_MD.write_text(render_gap_report(data), encoding="utf-8")
    KNOWLEDGE_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    KNOWLEDGE_MD.write_text(render_knowledge_md(data), encoding="utf-8")
    READINESS_MD.write_text(render_readiness_md(data), encoding="utf-8")
    print(
        "Proxmox/PBS gap analysis written: "
        f"{OUT_JSON} (pve_access={data['summary']['proxmox_api_access']}, "
        f"pbs_access={data['summary']['pbs_api_access']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
