#!/usr/bin/env python3
"""Implement Phase 5A-4 technical Zabbix hosts and trapper items.

Allowed scope:
- create one technical host group if missing,
- create two technical hosts if missing,
- create own trapper items on those hosts,
- create own disabled triggers,
- verify received values.

The script never touches Proxmox/PBS and does not create notification actions.
It does not update or delete existing Zabbix objects.
"""

from __future__ import annotations

import argparse
import json
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
ZABBIX_ENV = Path("/etc/zabbix-codex/zabbix.env")
BACKUP_JSON = BASE_DIR / "backups" / "zabbix-before-phase-5a-4.json"
PRECHECK_MD = BASE_DIR / "reports" / "phase-5a-4-precheck.md"
REPORT_JSON = BASE_DIR / "reports" / "phase-5a-4-zabbix-technical-hosts.json"
REPORT_MD = BASE_DIR / "reports" / "phase-5a-4-zabbix-technical-hosts.md"
CHANGELOG = BASE_DIR / "reports" / "CHANGELOG.md"
KNOWLEDGE_MD = BASE_DIR / "agent_knowledge" / "proxmox_backup_knowledge.md"
NEXT_ACTIONS_MD = BASE_DIR / "agent_knowledge" / "proxmox_next_actions.md"
INFRA_SUMMARY_MD = BASE_DIR / "agent_knowledge" / "infrastructure_summary.md"

GROUP_NAME = "Intelligent Monitoring"
PBS_HOST = "PBS Backup Monitoring"
PROXMOX_HOST = "Proxmox Storage Monitoring"
PBS_TEMPLATE_NAME = "Template PBS Backup Monitoring Intelligent Draft"
PROXMOX_TEMPLATE_NAME = "Template Proxmox Storage Monitoring Intelligent Draft"

SEVERITY = {
    "Average": 3,
    "High": 4,
    "Disaster": 5,
}

ITEM_TYPE_TRAPPER = 2
VALUE_FLOAT = 0
VALUE_UNSIGNED = 3

PBS_ITEMS = [
    {"key": "pbs.backup.collection_status", "name": "PBS backup collection status", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.backup.entities_total", "name": "PBS backup entities total", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.backup.entities_without_recent_backup", "name": "PBS backup entities without recent backup", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.backup.oldest_backup_age_hours", "name": "PBS oldest backup age hours", "value_type": VALUE_FLOAT, "units": "h"},
    {"key": "pbs.datastore.usage_percent[backup]", "name": "PBS datastore backup usage percent", "value_type": VALUE_FLOAT, "units": "%"},
    {"key": "pbs.datastore.groups[backup]", "name": "PBS datastore backup groups", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.datastore.snapshots[backup]", "name": "PBS datastore backup snapshots", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.datastore.usage_percent[ds-qnap-iscsi-almeria]", "name": "PBS datastore ds-qnap-iscsi-almeria usage percent", "value_type": VALUE_FLOAT, "units": "%"},
    {"key": "pbs.datastore.groups[ds-qnap-iscsi-almeria]", "name": "PBS datastore ds-qnap-iscsi-almeria groups", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.datastore.snapshots[ds-qnap-iscsi-almeria]", "name": "PBS datastore ds-qnap-iscsi-almeria snapshots", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.backup.last_success_age_hours[114]", "name": "PBS ia-dify backup age hours", "value_type": VALUE_FLOAT, "units": "h"},
    {"key": "pbs.backup.has_recent_backup[114]", "name": "PBS ia-dify has recent backup", "value_type": VALUE_UNSIGNED},
    {"key": "pbs.backup.snapshot_count[114]", "name": "PBS ia-dify snapshot count", "value_type": VALUE_UNSIGNED},
]

PROXMOX_ITEMS = [
    {"key": "proxmox.backup.jobs_total", "name": "Proxmox backup jobs total", "value_type": VALUE_UNSIGNED},
    {"key": "proxmox.backup.failed_tasks_24h", "name": "Proxmox backup failed tasks 24h", "value_type": VALUE_UNSIGNED},
    {"key": "proxmox.backup.failed_tasks_48h", "name": "Proxmox backup failed tasks 48h", "value_type": VALUE_UNSIGNED},
    {"key": "proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas]", "name": "Proxmox proxmox-gallarza datastore-replicas usage percent", "value_type": VALUE_FLOAT, "units": "%"},
    {"key": "proxmox.storage.usage_percent[proxmox-gallarza,local]", "name": "Proxmox proxmox-gallarza local usage percent", "value_type": VALUE_FLOAT, "units": "%"},
    {"key": "proxmox.storage.usage_percent[pvereplicas,datastore-replicas]", "name": "Proxmox pvereplicas datastore-replicas usage percent", "value_type": VALUE_FLOAT, "units": "%"},
    {"key": "proxmox.storage.usage_percent[pvereplicas,pbs-backup]", "name": "Proxmox pvereplicas pbs-backup usage percent", "value_type": VALUE_FLOAT, "units": "%"},
    {"key": "proxmox.backup.vm_in_job[114]", "name": "Proxmox ia-dify VM in backup job", "value_type": VALUE_UNSIGNED},
    {"key": "proxmox.backup.vm_without_job[114]", "name": "Proxmox ia-dify VM without backup job", "value_type": VALUE_UNSIGNED},
]

PBS_TRIGGERS = [
    {"description": "PBS collection failed", "expression": f"last(/{PBS_HOST}/pbs.backup.collection_status)=0", "priority": SEVERITY["High"]},
    {"description": "PBS datastore backup usage >80%", "expression": f"last(/{PBS_HOST}/pbs.datastore.usage_percent[backup])>80", "priority": SEVERITY["Average"]},
    {"description": "PBS datastore backup usage >90%", "expression": f"last(/{PBS_HOST}/pbs.datastore.usage_percent[backup])>90", "priority": SEVERITY["High"]},
    {"description": "PBS datastore ds-qnap-iscsi-almeria usage >80%", "expression": f"last(/{PBS_HOST}/pbs.datastore.usage_percent[ds-qnap-iscsi-almeria])>80", "priority": SEVERITY["Average"]},
    {"description": "PBS datastore ds-qnap-iscsi-almeria usage >90%", "expression": f"last(/{PBS_HOST}/pbs.datastore.usage_percent[ds-qnap-iscsi-almeria])>90", "priority": SEVERITY["High"]},
    {"description": "ia-dify backup older than 72h", "expression": f"last(/{PBS_HOST}/pbs.backup.last_success_age_hours[114])>72", "priority": SEVERITY["Average"]},
    {"description": "ia-dify backup older than 168h", "expression": f"last(/{PBS_HOST}/pbs.backup.last_success_age_hours[114])>168", "priority": SEVERITY["High"]},
]

PROXMOX_TRIGGERS = [
    {"description": "Proxmox backup failed tasks 24h > 0", "expression": f"last(/{PROXMOX_HOST}/proxmox.backup.failed_tasks_24h)>0", "priority": SEVERITY["High"]},
    {"description": "Proxmox backup failed tasks 48h > 0", "expression": f"last(/{PROXMOX_HOST}/proxmox.backup.failed_tasks_48h)>0", "priority": SEVERITY["High"]},
    {"description": "proxmox-gallarza datastore-replicas >80%", "expression": f"last(/{PROXMOX_HOST}/proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas])>80", "priority": SEVERITY["Average"]},
    {"description": "proxmox-gallarza datastore-replicas >90%", "expression": f"last(/{PROXMOX_HOST}/proxmox.storage.usage_percent[proxmox-gallarza,datastore-replicas])>90", "priority": SEVERITY["High"]},
    {"description": "ia-dify not present in backup job", "expression": f"last(/{PROXMOX_HOST}/proxmox.backup.vm_without_job[114])=1", "priority": SEVERITY["High"]},
]


def now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def api_client() -> zbx.ZabbixApi:
    env = zbx.load_env(ZABBIX_ENV)
    return zbx.ZabbixApi(zbx.api_url_from_env(env["ZABBIX_URL"]), env["ZABBIX_TOKEN"], zbx.tls_context(env))


def call(api: zbx.ZabbixApi, method: str, params: Any | None = None) -> Any:
    return api.call(method, params if params is not None else {})


def zabbix_version(api: zbx.ZabbixApi) -> str:
    return str(api.call("apiinfo.version", auth=False))


def get_group(api: zbx.ZabbixApi) -> dict[str, Any] | None:
    groups = call(api, "hostgroup.get", {"output": "extend", "filter": {"name": [GROUP_NAME]}})
    return groups[0] if groups else None


def get_host(api: zbx.ZabbixApi, host_name: str) -> dict[str, Any] | None:
    hosts = call(
        api,
        "host.get",
        {
            "output": "extend",
            "filter": {"host": [host_name]},
            "selectGroups": ["groupid", "name"],
            "selectInterfaces": "extend",
            "selectParentTemplates": ["templateid", "host", "name"],
            "selectTags": "extend",
        },
    )
    return hosts[0] if hosts else None


def get_templates(api: zbx.ZabbixApi) -> list[dict[str, Any]]:
    return call(
        api,
        "template.get",
        {
            "output": ["templateid", "host", "name"],
            "filter": {"host": [PBS_TEMPLATE_NAME, PROXMOX_TEMPLATE_NAME]},
        },
    )


def get_host_items(api: zbx.ZabbixApi, hostid: str) -> list[dict[str, Any]]:
    return call(
        api,
        "item.get",
        {
            "output": ["itemid", "hostid", "name", "key_", "type", "value_type", "status", "state", "error", "lastclock", "lastvalue", "units"],
            "hostids": [hostid],
            "filter": {"type": str(ITEM_TYPE_TRAPPER)},
            "sortfield": "key_",
        },
    )


def get_host_triggers(api: zbx.ZabbixApi, hostid: str) -> list[dict[str, Any]]:
    return call(
        api,
        "trigger.get",
        {
            "output": ["triggerid", "description", "expression", "priority", "status", "value"],
            "hostids": [hostid],
            "expandExpression": True,
            "sortfield": "description",
        },
    )


def collect_precheck(api: zbx.ZabbixApi) -> dict[str, Any]:
    hosts = {name: get_host(api, name) for name in [PBS_HOST, PROXMOX_HOST]}
    precheck: dict[str, Any] = {
        "metadata": {
            "generated_at": now_text(),
            "mode": "before-phase-5a-4",
            "zabbix_version": zabbix_version(api),
        },
        "group": get_group(api),
        "hosts": hosts,
        "templates": get_templates(api),
        "items": {},
        "triggers": {},
        "planned": {
            "group": GROUP_NAME,
            "hosts": [PBS_HOST, PROXMOX_HOST],
            "items": {
                PBS_HOST: PBS_ITEMS,
                PROXMOX_HOST: PROXMOX_ITEMS,
            },
            "triggers_disabled": {
                PBS_HOST: PBS_TRIGGERS,
                PROXMOX_HOST: PROXMOX_TRIGGERS,
            },
        },
    }
    for name, host in hosts.items():
        if host:
            precheck["items"][name] = get_host_items(api, host["hostid"])
            precheck["triggers"][name] = get_host_triggers(api, host["hostid"])
        else:
            precheck["items"][name] = []
            precheck["triggers"][name] = []
    return precheck


def render_precheck(precheck: dict[str, Any]) -> str:
    host_lines = []
    for name, host in precheck["hosts"].items():
        if host:
            host_lines.append(f"- `{name}`: ya existía (`hostid={host['hostid']}`).")
        else:
            host_lines.append(f"- `{name}`: no existía antes de la fase.")
    group = precheck.get("group")
    group_line = f"ya existía (`groupid={group['groupid']}`)" if group else "no existía antes de la fase"
    return f"""# Precheck Fase 5A-4

Generado: {precheck['metadata']['generated_at']}

## Grupo técnico

- `{GROUP_NAME}`: {group_line}.

## Hosts técnicos

{chr(10).join(host_lines)}

## Templates propios

- Templates propios encontrados antes de la fase: {len(precheck.get('templates') or [])}.
- En esta fase se crearán items directos en hosts técnicos; no se importarán templates existentes ni se tocarán templates ya usados.

## Alcance autorizado

- Crear grupo técnico si falta.
- Crear hosts técnicos si faltan.
- Crear items trapper propios.
- Crear triggers propios en estado disabled.
- Enviar métricas de prueba.

Backup JSON: `{BACKUP_JSON}`
"""


def ensure_group(api: zbx.ZabbixApi, actions: list[dict[str, Any]], verify_only: bool) -> dict[str, Any] | None:
    group = get_group(api)
    if group or verify_only:
        return group
    result = call(api, "hostgroup.create", {"name": GROUP_NAME})
    group = {"groupid": result["groupids"][0], "name": GROUP_NAME}
    actions.append({"object": "group", "name": GROUP_NAME, "action": "created", "groupid": group["groupid"]})
    return group


def ensure_host(api: zbx.ZabbixApi, host_name: str, groupid: str, actions: list[dict[str, Any]], verify_only: bool) -> dict[str, Any] | None:
    host = get_host(api, host_name)
    if host or verify_only:
        return host
    params: dict[str, Any] = {
        "host": host_name,
        "name": host_name,
        "groups": [{"groupid": groupid}],
        "tags": [{"tag": "managed_by", "value": "zabbix-codex"}, {"tag": "phase", "value": "5A-4"}],
    }
    try:
        result = call(api, "host.create", params)
        used_interface = False
    except zbx.ApiError:
        params["interfaces"] = [
            {
                "type": 1,
                "main": 1,
                "useip": 1,
                "ip": "127.0.0.1",
                "dns": "",
                "port": "10050",
            }
        ]
        result = call(api, "host.create", params)
        used_interface = True
    hostid = result["hostids"][0]
    actions.append({"object": "host", "name": host_name, "action": "created", "hostid": hostid, "interface_127001": used_interface})
    return get_host(api, host_name)


def ensure_item(
    api: zbx.ZabbixApi,
    host: dict[str, Any],
    item: dict[str, Any],
    actions: list[dict[str, Any]],
    verify_only: bool,
) -> dict[str, Any] | None:
    existing = [row for row in get_host_items(api, host["hostid"]) if row.get("key_") == item["key"]]
    if existing or verify_only:
        return existing[0] if existing else None
    params = {
        "hostid": host["hostid"],
        "name": item["name"],
        "key_": item["key"],
        "type": ITEM_TYPE_TRAPPER,
        "value_type": item["value_type"],
        "delay": "0",
        "status": 0,
        "units": item.get("units", ""),
        "description": "Created by zabbix-codex Phase 5A-4. Technical trapper item for intelligent monitoring.",
        "tags": [{"tag": "managed_by", "value": "zabbix-codex"}, {"tag": "phase", "value": "5A-4"}],
    }
    result = call(api, "item.create", params)
    actions.append({"object": "item", "host": host["host"], "key": item["key"], "action": "created", "itemid": result["itemids"][0]})
    created = [row for row in get_host_items(api, host["hostid"]) if row.get("key_") == item["key"]]
    return created[0] if created else None


def ensure_trigger(
    api: zbx.ZabbixApi,
    host: dict[str, Any],
    trigger: dict[str, Any],
    actions: list[dict[str, Any]],
    verify_only: bool,
) -> dict[str, Any] | None:
    existing = [row for row in get_host_triggers(api, host["hostid"]) if row.get("description") == trigger["description"]]
    if existing or verify_only:
        return existing[0] if existing else None
    params = {
        "description": trigger["description"],
        "expression": trigger["expression"],
        "priority": trigger["priority"],
        "status": 1,
        "manual_close": 1,
        "tags": [{"tag": "managed_by", "value": "zabbix-codex"}, {"tag": "phase", "value": "5A-4"}, {"tag": "notification", "value": "disabled"}],
    }
    result = call(api, "trigger.create", params)
    actions.append({"object": "trigger", "host": host["host"], "description": trigger["description"], "action": "created_disabled", "triggerid": result["triggerids"][0]})
    created = [row for row in get_host_triggers(api, host["hostid"]) if row.get("description") == trigger["description"]]
    return created[0] if created else None


def verify_state(api: zbx.ZabbixApi, hosts: dict[str, dict[str, Any] | None]) -> dict[str, Any]:
    verified: dict[str, Any] = {"group": get_group(api), "hosts": {}, "items": {}, "triggers": {}, "unsupported": []}
    for name, host in hosts.items():
        if not host:
            verified["hosts"][name] = {"exists": False}
            continue
        host = get_host(api, name)
        verified["hosts"][name] = {"exists": True, "hostid": host["hostid"], "status": host.get("status")}
        items = get_host_items(api, host["hostid"])
        triggers = get_host_triggers(api, host["hostid"])
        verified["items"][name] = items
        verified["triggers"][name] = triggers
        for item in items:
            if str(item.get("state")) == "1":
                verified["unsupported"].append(item)
    return verified


def infer_created_in_phase(precheck: dict[str, Any], verification: dict[str, Any]) -> dict[str, Any]:
    created = {
        "group": False,
        "hosts": [],
        "items": {},
        "triggers": {},
    }
    if precheck:
        created["group"] = precheck.get("group") is None and verification.get("group") is not None
        for host_name, current in (verification.get("hosts") or {}).items():
            before_host = (precheck.get("hosts") or {}).get(host_name)
            if before_host is None and current.get("exists"):
                created["hosts"].append(host_name)
            before_item_keys = {item.get("key_") for item in (precheck.get("items") or {}).get(host_name, [])}
            current_items = (verification.get("items") or {}).get(host_name, [])
            created["items"][host_name] = [
                item for item in current_items
                if item.get("key_") not in before_item_keys
                and item.get("key_") in {row["key"] for row in PBS_ITEMS + PROXMOX_ITEMS}
            ]
            before_trigger_names = {trigger.get("description") for trigger in (precheck.get("triggers") or {}).get(host_name, [])}
            current_triggers = (verification.get("triggers") or {}).get(host_name, [])
            created["triggers"][host_name] = [
                trigger for trigger in current_triggers
                if trigger.get("description") not in before_trigger_names
                and trigger.get("description") in {row["description"] for row in PBS_TRIGGERS + PROXMOX_TRIGGERS}
            ]
    return created


def render_report(report: dict[str, Any]) -> str:
    created = report.get("actions", [])
    created_in_phase = report.get("created_in_phase") or {}
    verify = report.get("verification", {})
    phase_created_lines = []
    if created_in_phase.get("group"):
        phase_created_lines.append(f"- group `{GROUP_NAME}`: created in this phase")
    for host in created_in_phase.get("hosts") or []:
        phase_created_lines.append(f"- host `{host}`: created in this phase")
    for host, items in (created_in_phase.get("items") or {}).items():
        for item in items:
            phase_created_lines.append(f"- item `{host}` `{item.get('key_')}`: created in this phase")
    for host, triggers in (created_in_phase.get("triggers") or {}).items():
        for trigger in triggers:
            phase_created_lines.append(f"- trigger `{host}` `{trigger.get('description')}`: created disabled in this phase")
    item_lines = []
    for host, items in (verify.get("items") or {}).items():
        for item in items:
            item_lines.append(
                f"- `{host}` `{item.get('key_')}`: itemid `{item.get('itemid')}`, "
                f"lastvalue `{item.get('lastvalue')}`, lastclock `{item.get('lastclock')}`, state `{item.get('state')}`."
            )
    trigger_lines = []
    for host, triggers in (verify.get("triggers") or {}).items():
        for trigger in triggers:
            if str(trigger.get("description", "")).startswith(("PBS", "Proxmox", "proxmox", "ia-dify")):
                trigger_lines.append(
                    f"- `{host}` `{trigger.get('description')}`: status `{trigger.get('status')}`, priority `{trigger.get('priority')}`."
                )
    return f"""# Fase 5A-4 - Hosts técnicos e items trapper

Generado: {report['metadata']['generated_at']}

## Resumen ejecutivo

Se han creado/verificado objetos técnicos propios para PBS, Proxmox storage y backups. No se ha modificado Proxmox, PBS, jobs, VMs, templates existentes ni acciones de notificación.

## Objetos creados o verificados

{chr(10).join(phase_created_lines) or chr(10).join(f"- {row['object']} `{row.get('name') or row.get('key') or row.get('description')}`: {row['action']}" for row in created) or "- No se crearon objetos nuevos en esta ejecución."}

## Items y valores

{chr(10).join(item_lines) if item_lines else "- Sin items verificados."}

## Triggers

Todos los triggers propios se crean en estado disabled (`status=1`) para evitar eventos/notificaciones.

{chr(10).join(trigger_lines) if trigger_lines else "- Sin triggers propios verificados."}

## Unsupported

- Items técnicos unsupported: {len(verify.get('unsupported') or [])}.

## Métricas

- Valores recibidos con `lastclock > 0`: {report.get('metrics', {}).get('received_count', 0)}.
- Valores pendientes sin `lastclock`: {report.get('metrics', {}).get('pending_count', 0)}.

## Siguiente recomendación

Confirmar valores recibidos y, en la siguiente fase, programar el envío periódico. Mantener triggers disabled hasta validar umbrales y política de notificaciones.
"""


def update_knowledge(report: dict[str, Any]) -> None:
    entry = f"""

## {report['metadata']['generated_at']} - Fase 5A-4

Zabbix ya tiene hosts técnicos para empezar a recibir métricas estructuradas de PBS/Proxmox:

- `{PBS_HOST}`
- `{PROXMOX_HOST}`

Los items trapper mínimos fueron creados/verificados y los triggers propios quedaron disabled para no generar notificaciones. La siguiente tarea es consolidar envío periódico y después activar triggers/notificaciones por decisión humana.
"""
    for path in [KNOWLEDGE_MD, NEXT_ACTIONS_MD, INFRA_SUMMARY_MD]:
        previous = path.read_text(encoding="utf-8") if path.exists() else f"# {path.name}\n"
        if "Fase 5A-4" not in previous[-1500:]:
            write_text(path, previous.rstrip() + entry)


def update_changelog(report: dict[str, Any]) -> None:
    previous = CHANGELOG.read_text(encoding="utf-8") if CHANGELOG.exists() else "# CHANGELOG\n"
    entry = f"""

## {report['metadata']['generated_at']} - Fase 5A-4 hosts técnicos PBS/Proxmox

- Backup/precheck: `{BACKUP_JSON}` y `{PRECHECK_MD}`.
- Informe final: `{REPORT_MD}` y `{REPORT_JSON}`.
- Creados/verificados grupo `{GROUP_NAME}`, hosts `{PBS_HOST}` y `{PROXMOX_HOST}`.
- Creados/verificados items trapper mínimos y triggers propios disabled.
- No se crearon acciones de notificación.
- No se modificó Proxmox, PBS, VMs, jobs, templates existentes ni triggers existentes.
"""
    write_text(CHANGELOG, previous.rstrip() + entry)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 5A-4 controlled Zabbix implementation.")
    parser.add_argument("--verify-only", action="store_true", help="Only verify/report current state; do not create missing objects.")
    parser.add_argument("--skip-changelog", action="store_true")
    args = parser.parse_args()

    api = api_client()
    actions: list[dict[str, Any]] = []

    if not args.verify_only:
        precheck = collect_precheck(api)
        write_json(BACKUP_JSON, precheck)
        write_text(PRECHECK_MD, render_precheck(precheck))

    group = ensure_group(api, actions, args.verify_only)
    if not group and args.verify_only:
        raise RuntimeError(f"Missing group {GROUP_NAME}")

    hosts: dict[str, dict[str, Any] | None] = {}
    for host_name in [PBS_HOST, PROXMOX_HOST]:
        hosts[host_name] = ensure_host(api, host_name, group["groupid"], actions, args.verify_only) if group else None

    if hosts.get(PBS_HOST):
        for item in PBS_ITEMS:
            ensure_item(api, hosts[PBS_HOST], item, actions, args.verify_only)
        for trigger in PBS_TRIGGERS:
            ensure_trigger(api, hosts[PBS_HOST], trigger, actions, args.verify_only)

    if hosts.get(PROXMOX_HOST):
        for item in PROXMOX_ITEMS:
            ensure_item(api, hosts[PROXMOX_HOST], item, actions, args.verify_only)
        for trigger in PROXMOX_TRIGGERS:
            ensure_trigger(api, hosts[PROXMOX_HOST], trigger, actions, args.verify_only)

    time.sleep(1)
    verification = verify_state(api, hosts)
    precheck_data = read_json(BACKUP_JSON)
    created_in_phase = infer_created_in_phase(precheck_data, verification)
    all_items = [item for items in verification.get("items", {}).values() for item in items]
    metric_items = [
        item for item in all_items
        if item.get("key_") in {row["key"] for row in PBS_ITEMS + PROXMOX_ITEMS}
    ]
    report = {
        "metadata": {
            "generated_at": now_text(),
            "mode": "verify-only" if args.verify_only else "apply-controlled",
            "zabbix_version": zabbix_version(api),
        },
        "actions": actions,
        "created_in_phase": created_in_phase,
        "precheck": {
            "backup_json": str(BACKUP_JSON),
            "precheck_md": str(PRECHECK_MD),
        },
        "verification": verification,
        "metrics": {
            "expected_count": len(PBS_ITEMS) + len(PROXMOX_ITEMS),
            "received_count": sum(1 for item in metric_items if int(item.get("lastclock") or 0) > 0),
            "pending_count": sum(1 for item in metric_items if int(item.get("lastclock") or 0) == 0),
            "failed_count": sum(1 for item in metric_items if str(item.get("state")) == "1"),
        },
        "safety": {
            "notifications_created": False,
            "actions_created": False,
            "existing_templates_modified": False,
            "existing_triggers_modified": False,
            "proxmox_modified": False,
            "pbs_modified": False,
        },
    }
    write_json(REPORT_JSON, report)
    write_text(REPORT_MD, render_report(report))
    update_knowledge(report)
    if not args.skip_changelog and not args.verify_only:
        update_changelog(report)

    print(json.dumps({
        "status": "ok",
        "mode": report["metadata"]["mode"],
        "actions": len(actions),
        "expected_items": report["metrics"]["expected_count"],
        "received_count": report["metrics"]["received_count"],
        "pending_count": report["metrics"]["pending_count"],
        "unsupported": len(verification.get("unsupported") or []),
        "report": str(REPORT_JSON),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
