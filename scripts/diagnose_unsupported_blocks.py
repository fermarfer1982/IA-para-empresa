#!/usr/bin/env python3
"""Read-only diagnostics for unsupported Zabbix items by remediation block."""

from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import plan_zabbix_remediation as zbx


REPORTS_DIR = Path("/opt/zabbix-codex/reports")
SUMMARY_JSON = REPORTS_DIR / "unsupported-blocks-summary.json"

REPORT_PATHS = {
    "zabbix_internal": REPORTS_DIR / "unsupported-zabbix-internal.md",
    "eaton_sai": REPORTS_DIR / "unsupported-eaton-sai.md",
    "nas_qnap": REPORTS_DIR / "unsupported-nas-qnap.md",
    "printers_snmp": REPORTS_DIR / "unsupported-printers-snmp.md",
    "other": REPORTS_DIR / "unsupported-other.md",
}

EATON_HOSTS = {
    "EATON 5PX 2200 SAI ALMERIA",
    "EATON 5PX 2200 ( SAI GALLARZA )",
    "EATON 5PX 2200 SAI GALLARZA",
}

PRINTER_HINTS = [
    "printer",
    "impresora",
    "laserjet",
    "brother",
    "canon",
    "zebra",
]

NAS_HINTS = [
    "nas",
    "qnap",
    "hdd.",
    "hdd[",
    "pool.",
    "pool[",
    "volume.",
    "volume[",
    "smart",
]

SECRET_MACRO_HINTS = [
    "COMMUNITY",
    "PASS",
    "TOKEN",
    "SECRET",
    "KEY",
    "AUTH",
    "PRIV",
    "USER",
]


def masked_value(value: Any) -> str:
    text = "" if value is None else str(value)
    return f"<masked,length={len(text)}>"


def macro_entry(macro: dict[str, Any]) -> dict[str, Any]:
    name = macro.get("macro", "")
    return {
        "hostmacroid": macro.get("hostmacroid"),
        "hostid": macro.get("hostid"),
        "macro": name,
        "value": masked_value(macro.get("value", "")),
        "type": macro.get("type"),
        "secret_like": any(hint in name.upper() for hint in SECRET_MACRO_HINTS),
    }


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
    except Exception as exc:  # noqa: BLE001 - diagnostics should record partial read failures.
        errors.append({"method": method, "error": str(exc)})
        return default


def host_text(host: dict[str, Any]) -> str:
    pieces = [host.get("host", ""), host.get("name", "")]
    pieces.extend(group.get("name", "") for group in host.get("groups") or [])
    pieces.extend(template.get("name", "") or template.get("host", "") for template in host.get("parentTemplates") or [])
    return " ".join(pieces).lower()


def item_text(item: dict[str, Any]) -> str:
    return " ".join(
        [
            str(item.get("name") or ""),
            str(item.get("key_") or ""),
            str(item.get("snmp_oid") or ""),
            str(item.get("error") or ""),
        ]
    ).lower()


def block_for_item(item: dict[str, Any], host: dict[str, Any] | None) -> str:
    htext = host_text(host or {})
    itext = item_text(item)
    host_name = zbx.display_host(host)

    if host_name == "Zabbix server":
        return "zabbix_internal"

    if host_name in EATON_HOSTS or "eaton" in htext:
        return "eaton_sai"

    if "impresoras" in htext or any(hint in htext for hint in PRINTER_HINTS) or any(hint in itext for hint in ["prt", "printer"]):
        return "printers_snmp"

    if any(hint in htext for hint in NAS_HINTS) or any(hint in itext for hint in NAS_HINTS):
        return "nas_qnap"

    return "other"


def correction_priority(block: str, item: dict[str, Any], host: dict[str, Any] | None) -> str:
    text = f"{zbx.display_host(host)} {item_text(item)}".lower()
    if "nasalmeria" in text and any(word in text for word in ["smart", "hdd", "disk", "temperature"]):
        return "CRÍTICO"
    if block in {"eaton_sai", "nas_qnap"}:
        return "ALTO"
    if block == "zabbix_internal" and any(word in text for word in ["connector", "packages", "vmware", "poller", "manager"]):
        return "MEDIO"
    if block == "printers_snmp":
        return "MEDIO"
    return "BAJO"


def recommended_action(block: str, entry: dict[str, Any]) -> str:
    key = entry.get("key", "")
    error = entry.get("error", "")
    name = entry.get("name", "")
    host = entry.get("host", "")
    category = entry.get("cause_category", "")
    text = f"{host} {name} {key} {error}".lower()

    if block == "zabbix_internal":
        if any(part in key for part in ["ipmi poller", "ipmi manager"]):
            return "Confirmar si se usan checks IPMI. Si no se usan, documentar override futuro; si se usan, revisar StartIPMIPollers/StartIPMIManagers."
        if "java poller" in key:
            return "Confirmar si hay JMX/Java monitorizado. Si no existe, tratar como ruido de template; si existe, revisar StartJavaPollers."
        if "snmp trapper" in key:
            return "Confirmar si se reciben traps SNMP. Si no se usan, documentar override; si se usan, revisar StartSNMPTrapper y snmptrapd."
        if "vmware" in key:
            return "Confirmar si se usa monitorización VMware API. Si no se usa, documentar override; si se usa, revisar StartVMwareCollectors."
        if "report writer" in key or "report manager" in key:
            return "Confirmar si se usan scheduled reports. Si no se usan, documentar override; si se usan, revisar reporting services/procesos."
        if "connector" in key:
            return "Confirmar si se usan connectors. Si no se usan, documentar override; si se usan, revisar StartConnectors."
        if key == "system.sw.packages.get":
            return "Diagnosticar agente local con zabbix_get y revisar permisos/logs del agente para consulta de paquetes."
        return "Revisar si el item del template Zabbix server health aplica a esta instalación antes de tocarlo."

    if block == "eaton_sai":
        if category == "SNMP OID no encontrada":
            return "Validar OID con snmpwalk contra el SAI y comparar MIB/modelo/firmware; probable template no ajustado al modelo."
        if category == "timeout":
            return "Comprobar latencia, ACL y timeout SNMP antes de tocar macros o template."
        if category == "credenciales/comunidad SNMP":
            return "Validar macro/comunidad SNMP en host/template sin exponer valor."
        return "Contrastar MIB Eaton soportada por el equipo y preparar override por OID no soportada si se confirma."

    if block == "nas_qnap":
        if "nasalmeria" in host.lower() and any(word in text for word in ["hdd 5", "hdd.status", "smart", "hdd.temp", "hdd.state"]):
            return "Confirmar estado físico del HDD 5 en GUI/SSH QNAP; no silenciar alerta SMART como solución principal."
        if category == "SNMP OID no encontrada":
            return "Validar OID QNAP por modelo/firmware; puede ser discovery desactualizado o disco/volumen ausente."
        if "value of type" in error.lower():
            return "Revisar valuemap/tipo de dato del item descubierto; el NAS devuelve cadena o -1 donde el template espera numérico."
        return "Revisar SNMP QNAP, storage/discovery y triggers relacionados antes de aplicar cambios."

    if block == "printers_snmp":
        if category == "SNMP OID no encontrada":
            return "Confirmar si la impresora soporta Printer-MIB para ese OID; preparar override por modelo si no aplica."
        if "not enough data" in error.lower():
            return "Primero recuperar items base SNMP; los calculados fallan por falta de datos de bandejas/consumibles."
        return "Comprobar IP, SNMP y modelo antes de decidir mantenimiento o retirada."

    return zbx.likely_unsupported_action(category, {"key_": key, "name": name, "error": error})


def build_item_entry(
    item: dict[str, Any],
    host_by_id: dict[str, dict[str, Any]],
    interface_by_id: dict[str, dict[str, Any]],
    item_by_id: dict[str, dict[str, Any]],
    object_by_hostid: dict[str, dict[str, Any]],
    now: int,
    block: str,
) -> dict[str, Any]:
    host = host_by_id.get(str(item.get("hostid")))
    base = zbx.compact_item(item, host_by_id, interface_by_id, item_by_id, object_by_hostid, now)
    base["block"] = block
    base["correction_priority"] = correction_priority(block, item, host)
    base["recommended_action"] = recommended_action(block, base)
    interface = base.get("interface") or {}
    base["interface_summary"] = (
        f"{interface.get('type', 'none')} {interface.get('ip') or interface.get('dns') or ''}:{interface.get('port') or ''}"
        if interface
        else "none"
    )
    base["parent_template"] = ""
    if base.get("template_chain"):
        base["parent_template"] = base["template_chain"][0].get("template") or ""
    return base


def collect() -> dict[str, Any]:
    now = int(time.time())
    api, safe_url = make_api()
    errors: list[dict[str, str]] = []

    version = safe_call(api, "apiinfo.version", {}, errors, "unknown", auth=False)
    hosts = safe_call(
        api,
        "host.get",
        {
            "output": ["hostid", "host", "name", "status", "proxyid"],
            "selectGroups": ["groupid", "name"],
            "selectParentTemplates": ["templateid", "host", "name"],
            "selectInterfaces": ["interfaceid", "type", "main", "useip", "ip", "dns", "port", "available", "error"],
            "sortfield": "host",
        },
        errors,
        [],
    )
    if not hosts:
        raise RuntimeError(f"API returned no hosts; refusing to write empty diagnostics. Errors: {errors}")

    templates = safe_call(
        api,
        "template.get",
        {"output": ["templateid", "host", "name"], "selectGroups": ["groupid", "name"], "sortfield": "host"},
        errors,
        [],
    )
    all_items = safe_call(
        api,
        "item.get",
        {
            "output": [
                "itemid",
                "type",
                "snmp_oid",
                "hostid",
                "name",
                "key_",
                "delay",
                "status",
                "value_type",
                "units",
                "templateid",
                "interfaceid",
                "description",
                "master_itemid",
                "flags",
                "state",
                "error",
                "lastclock",
                "lastvalue",
                "prevvalue",
            ],
        },
        errors,
        [],
    )
    unsupported_raw = safe_call(
        api,
        "item.get",
        {
            "output": "extend",
            "filter": {"state": "1", "status": "0"},
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItemDiscovery": "extend",
            "selectDiscoveryRule": ["itemid", "name", "key_"],
        },
        errors,
        [],
    )
    triggers = safe_call(
        api,
        "trigger.get",
        {
            "output": ["triggerid", "description", "status", "priority", "value", "lastchange", "comments", "templateid", "opdata"],
            "selectHosts": ["hostid", "host", "name", "status"],
            "selectItems": ["itemid", "hostid", "name", "key_", "snmp_oid", "lastclock", "lastvalue", "error", "state", "type", "interfaceid"],
            "selectTags": "extend",
        },
        errors,
        [],
    )
    problems = safe_call(
        api,
        "problem.get",
        {
            "output": "extend",
            "selectTags": "extend",
            "sortfield": "eventid",
            "sortorder": "DESC",
        },
        errors,
        [],
    )

    host_by_id = {str(host["hostid"]): host for host in hosts}
    template_by_id = {str(template["templateid"]): template for template in templates}
    object_by_hostid = {**template_by_id, **host_by_id}
    item_by_id = {str(item["itemid"]): item for item in all_items}
    interface_by_id: dict[str, dict[str, Any]] = {}
    for host in hosts:
        for interface in host.get("interfaces") or []:
            interface_by_id[str(interface.get("interfaceid"))] = interface

    block_items: dict[str, list[dict[str, Any]]] = {key: [] for key in REPORT_PATHS}
    for item in unsupported_raw:
        host = host_by_id.get(str(item.get("hostid")))
        block = block_for_item(item, host)
        entry = build_item_entry(item, host_by_id, interface_by_id, item_by_id, object_by_hostid, now, block)
        block_items[block].append(entry)

    for entries in block_items.values():
        entries.sort(key=lambda entry: (entry["correction_priority"], entry["host"], entry["itemid"]))

    hostids_for_macros = sorted(
        {
            str(host.get("hostid"))
            for block in ["eaton_sai", "nas_qnap"]
            for item in block_items[block]
            for host in [host_by_id.get(str(item.get("hostid")))]
            if host
        }
    )
    templateids_for_macros = sorted(
        {
            str(template.get("templateid"))
            for hostid in hostids_for_macros
            for template in host_by_id.get(hostid, {}).get("parentTemplates") or []
        }
    )
    macro_hostids = [hostid for hostid in hostids_for_macros + templateids_for_macros if hostid]
    macros = safe_call(
        api,
        "usermacro.get",
        {"output": ["hostmacroid", "hostid", "macro", "value", "type"], "hostids": macro_hostids},
        errors,
        [],
    ) if macro_hostids else []
    macros_by_hostid: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for macro in macros:
        macros_by_hostid[str(macro.get("hostid"))].append(macro_entry(macro))

    trigger_by_id = {str(trigger.get("triggerid")): trigger for trigger in triggers}
    active_problem_entries = []
    for problem in problems:
        trigger = trigger_by_id.get(str(problem.get("objectid")), {})
        active_problem_entries.append(
            {
                "eventid": problem.get("eventid"),
                "name": problem.get("name"),
                "severity": zbx.SEVERITIES.get(str(problem.get("severity", "0")), str(problem.get("severity", "0"))),
                "clock": zbx.to_int(problem.get("clock")),
                "clock_text": zbx.format_ts(problem.get("clock")),
                "duration": zbx.age_text(problem.get("clock"), now),
                "operational_data": problem.get("opdata", ""),
                "tags": problem.get("tags") or [],
                "triggerid": problem.get("objectid"),
                "trigger": trigger.get("description", ""),
                "hosts": [zbx.compact_host(host_by_id.get(str(host.get("hostid")), host)) for host in trigger.get("hosts") or []],
            }
        )

    disabled_triggers = []
    for trigger in triggers:
        if str(trigger.get("status")) != "1":
            continue
        disabled_triggers.append(
            {
                "triggerid": trigger.get("triggerid"),
                "description": trigger.get("description"),
                "severity": zbx.SEVERITIES.get(str(trigger.get("priority", "0")), str(trigger.get("priority", "0"))),
                "hosts": [zbx.compact_host(host_by_id.get(str(host.get("hostid")), host)) for host in trigger.get("hosts") or []],
                "items": [{"itemid": item.get("itemid"), "name": item.get("name"), "key": item.get("key_")} for item in trigger.get("items") or []],
                "probable_reason": zbx.probable_disabled_trigger_reason(trigger),
            }
        )

    coverage = zbx.load_coverage()
    stale_hosts = coverage.get("coverage", {}).get("hosts_without_recent_data", []) if coverage else []
    stale_hostids = {str(host.get("hostid")) for host in stale_hosts}
    stale_printers = []
    for hostid in stale_hostids:
        host = host_by_id.get(hostid)
        if not host:
            continue
        htext = host_text(host)
        if "impresoras" not in htext and not any(hint in htext for hint in PRINTER_HINTS):
            continue
        interfaces = [zbx.summarize_interface(interface) for interface in host.get("interfaces") or []]
        coverage_entry = next((entry for entry in stale_hosts if str(entry.get("hostid")) == hostid), {})
        stale_printers.append(
            {
                "host": zbx.compact_host(host),
                "groups": host.get("groups") or [],
                "interfaces": interfaces,
                "last_item_clock": coverage_entry.get("last_item_clock", 0),
                "last_item_clock_text": coverage_entry.get("last_item_clock_text", "never"),
                "diagnosis": "SNMP unavailable and no recent data; possible powered off, retired, changed IP, ACL/firewall issue, or SNMP disabled.",
                "proposal": "Confirmar existencia/IP/SNMP. Mantener si sigue en servicio, corregir IP/SNMP si cambió, pasar a mantenimiento o retirar solo con confirmación humana.",
            }
        )

    nasalmeria = next((host for host in hosts if zbx.display_host(host).lower() == "nasalmeria"), None)
    nasalmeria_detail = build_nasalmeria_detail(api, errors, now, host_by_id, interface_by_id, trigger_by_id, problems, all_items, disabled_triggers)

    data = {
        "metadata": {
            "generated_at": datetime.fromtimestamp(now).astimezone().isoformat(),
            "zabbix_url": safe_url,
            "zabbix_version": version,
            "read_only": True,
        },
        "summary": {
            "unsupported_total": len(unsupported_raw),
            "blocks": {block: len(items) for block, items in block_items.items()},
            "active_problems_total": len(problems),
            "disabled_triggers_total": len(disabled_triggers),
            "stale_printers_total": len(stale_printers),
            "api_errors_total": len(errors),
        },
        "blocks": block_items,
        "macros_masked_by_hostid": dict(macros_by_hostid),
        "active_problems": active_problem_entries,
        "disabled_triggers": disabled_triggers,
        "stale_printers": stale_printers,
        "nasalmeria_hdd5": nasalmeria_detail,
        "safe_automatic_changes_next_phase": [
            "Crear scripts read-only de snmpwalk/zabbix_get parametrizados por host sin cambiar Zabbix.",
            "Generar CSV/Markdown por bloque para revisión humana.",
            "Crear borradores de templates/checks no vinculados para backups, Proxmox y QNAP.",
            "Documentar overrides candidatos sin aplicarlos.",
        ],
        "human_confirmation_required_changes": [
            "Deshabilitar, borrar o modificar items unsupported.",
            "Cambiar templates usados por hosts existentes.",
            "Cambiar macros SNMP/credenciales.",
            "Reactivar o modificar triggers deshabilitados.",
            "Cerrar, silenciar o reconocer como solucion la alerta SMART de NasAlmeria.",
            "Ejecutar cambios físicos sobre discos, RAID o NAS.",
            "Cambiar configuración de Zabbix server, reiniciar servicios o activar pollers.",
            "Modificar backups, Proxmox, PBS, Ceph, datastores, nodos o VMs.",
        ],
        "api_errors": errors,
    }
    return data


def build_nasalmeria_detail(
    api: zbx.ZabbixApi,
    errors: list[dict[str, str]],
    now: int,
    host_by_id: dict[str, dict[str, Any]],
    interface_by_id: dict[str, dict[str, Any]],
    trigger_by_id: dict[str, dict[str, Any]],
    problems: list[dict[str, Any]],
    all_items: list[dict[str, Any]],
    disabled_triggers: list[dict[str, Any]],
) -> dict[str, Any]:
    nasalmeria = next((host for host in host_by_id.values() if zbx.display_host(host).lower() == "nasalmeria"), None)
    if not nasalmeria:
        return {"found": False}

    hostid = str(nasalmeria.get("hostid"))
    related_items = [
        item
        for item in all_items
        if str(item.get("hostid")) == hostid
        and any(word in " ".join([str(item.get("name", "")), str(item.get("key_", "")), str(item.get("snmp_oid", ""))]).lower() for word in ["hdd", "smart", "disk", "pool", "volume"])
    ]
    hdd5_items = [
        item
        for item in related_items
        if "hdd 5" in str(item.get("name", "")).lower()
        or "[5]" in str(item.get("key_", "")).lower()
        or str(item.get("key_", "")).lower().endswith("5]")
    ]
    smart_item = next(
        (
            item
            for item in hdd5_items
            if str(item.get("key_", "")) == "hdd.status[5]"
            or "smart status" in str(item.get("name", "")).lower()
        ),
        None,
    )
    smart_history = []
    if smart_item:
        smart_history = safe_call(
            api,
            "history.get",
            {
                "output": "extend",
                "history": zbx.to_int(smart_item.get("value_type")),
                "itemids": [smart_item.get("itemid")],
                "sortfield": "clock",
                "sortorder": "DESC",
                "limit": 20,
            },
            errors,
            [],
        )
        for entry in smart_history:
            entry["clock_text"] = zbx.format_ts(entry.get("clock"))

    high_problem = next(
        (
            problem
            for problem in problems
            if str(problem.get("severity")) == "4"
            and "smart" in str(problem.get("name", "")).lower()
            and str(problem.get("objectid")) in trigger_by_id
            and any(str(host.get("hostid")) == hostid for host in trigger_by_id[str(problem.get("objectid"))].get("hosts") or [])
        ),
        None,
    )
    trigger = trigger_by_id.get(str(high_problem.get("objectid"))) if high_problem else None
    event_history = []
    if trigger:
        event_history = safe_call(
            api,
            "event.get",
            {
                "output": ["eventid", "clock", "name", "severity", "value", "objectid"],
                "source": 0,
                "object": 0,
                "objectids": [trigger.get("triggerid")],
                "sortfield": "clock",
                "sortorder": "ASC",
                "limit": 5,
            },
            errors,
            [],
        )
        for event in event_history:
            event["clock_text"] = zbx.format_ts(event.get("clock"))

    return {
        "found": True,
        "host": zbx.compact_host(nasalmeria),
        "interfaces": [zbx.summarize_interface(interface) for interface in nasalmeria.get("interfaces") or []],
        "active_high_problem": {
            "eventid": high_problem.get("eventid") if high_problem else None,
            "name": high_problem.get("name") if high_problem else None,
            "severity": zbx.SEVERITIES.get(str(high_problem.get("severity", "")), str(high_problem.get("severity", ""))) if high_problem else None,
            "clock": zbx.to_int(high_problem.get("clock")) if high_problem else None,
            "clock_text": zbx.format_ts(high_problem.get("clock")) if high_problem else None,
            "duration": zbx.age_text(high_problem.get("clock"), now) if high_problem else None,
            "operational_data": high_problem.get("opdata") if high_problem else None,
            "tags": high_problem.get("tags") if high_problem else [],
        },
        "trigger": {
            "triggerid": trigger.get("triggerid") if trigger else None,
            "description": trigger.get("description") if trigger else None,
            "status": "enabled" if trigger and str(trigger.get("status")) == "0" else "disabled" if trigger else None,
            "severity": zbx.SEVERITIES.get(str(trigger.get("priority", "")), str(trigger.get("priority", ""))) if trigger else None,
            "comments": trigger.get("comments", "") if trigger else "",
            "opdata": trigger.get("opdata", "") if trigger else "",
        },
        "smart_item": describe_plain_item(smart_item, interface_by_id),
        "hdd5_items": [describe_plain_item(item, interface_by_id) for item in hdd5_items],
        "storage_items_sample": [describe_plain_item(item, interface_by_id) for item in related_items[:80]],
        "smart_history_recent": smart_history,
        "event_history_sample": event_history,
        "disabled_triggers_related": [
            trigger
            for trigger in disabled_triggers
            if any(str(host.get("hostid")) == hostid for host in trigger.get("hosts") or [])
            and any(word in f"{trigger.get('description', '')} {' '.join(item.get('name', '') for item in trigger.get('items', []))}".lower() for word in ["smart", "hdd", "disk", "pool", "volume"])
        ],
        "diagnosis": "El item SMART hdd.status[5] devuelve datos recientes con valor 2/Abnormal. Esto apunta a estado SMART/fallo fisico reportado por el NAS, no a fallo de Zabbix.",
        "operational_recommendation": "No silenciar ni cerrar. Confirmar en GUI/SSH QNAP, revisar RAID/storage pool y planificar sustitucion del HDD 5 si el NAS confirma el fallo.",
        "confirmation_commands_not_executed": [
            "ssh <admin>@<ip-de-NasAlmeria>",
            "GUI QNAP: Storage & Snapshots > Disks/VJBOD > HDD 5 > SMART information",
            "qcli_storage -d",
            "qcli_storage -T force=1",
            "smartctl -a -d sat /dev/<disco_hdd5>",
            "dmesg | egrep -i 'smart|error|fail|ata|disk|hdd|ssd'",
        ],
    }


def describe_plain_item(item: dict[str, Any] | None, interface_by_id: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if not item:
        return None
    return {
        "itemid": item.get("itemid"),
        "name": item.get("name"),
        "key": item.get("key_"),
        "type": zbx.item_type_name(item),
        "status": "enabled" if str(item.get("status")) == "0" else "disabled",
        "state": "unsupported" if str(item.get("state")) == "1" else "normal",
        "error": item.get("error", ""),
        "snmp_oid": item.get("snmp_oid", ""),
        "lastvalue": item.get("lastvalue"),
        "lastclock": zbx.to_int(item.get("lastclock")),
        "lastclock_text": zbx.format_ts(item.get("lastclock")),
        "interface": zbx.summarize_interface(interface_by_id.get(str(item.get("interfaceid")))),
    }


def render_items_table(items: list[dict[str, Any]]) -> str:
    return zbx.md_table(
        ["Host", "ItemID", "Nombre", "Key", "Tipo", "Estado", "Error", "Interfaz", "Template", "Discovery", "Último dato", "Prioridad", "Acción"],
        [
            [
                item.get("host"),
                item.get("itemid"),
                item.get("name"),
                item.get("key"),
                item.get("type"),
                f"{item.get('status')}/{item.get('state')}",
                item.get("error"),
                item.get("interface_summary"),
                item.get("parent_template"),
                "sí" if item.get("is_discovered") else "no",
                item.get("lastclock_text"),
                item.get("correction_priority"),
                item.get("recommended_action"),
            ]
            for item in items
        ],
    )


def render_zabbix_internal(data: dict[str, Any]) -> str:
    items = data["blocks"]["zabbix_internal"]
    lines = [
        "# Unsupported Zabbix internal",
        "",
        f"Generado: {data['metadata']['generated_at']}",
        "",
        "## Resumen",
        "",
        zbx.bullet_list(
            [
                f"Items unsupported del bloque: {len(items)}.",
                "La mayoría son métricas internas de procesos no arrancados o capacidades no usadas.",
                "No se recomienda activar pollers/procesos solo para limpiar unsupported sin confirmar uso real.",
            ]
        ),
        "## Items",
        "",
        render_items_table(items),
        "## Diagnóstico por función",
        "",
    ]
    function_notes = [
        ("IPMI poller/manager", "Solo necesario si se usan items IPMI. Si no hay IPMI real, es ruido del template Zabbix server health."),
        ("Java poller", "Solo necesario si hay JMX/Java. Si no existe JMX, no activar StartJavaPollers solo para limpiar."),
        ("SNMP trapper", "Solo necesario si se reciben traps SNMP. Si se monitoriza por polling SNMP normal, puede ser ruido."),
        ("VMware collector/cache", "Solo necesario para VMware API. ESXi por SNMP no implica StartVMwareCollectors."),
        ("Report writer/manager", "Solo necesario para scheduled reports/rendering. Confirmar uso antes de activar procesos."),
        ("Connector queue/manager/worker", "Solo necesario si se usan connectors. Requiere revisar StartConnectors."),
        ("Paquetes instalados", "El item system.sw.packages.get falla por obtención de paquetes; diagnosticar agente/permisos/logs antes de tocar template."),
    ]
    lines.append(zbx.md_table(["Función", "Diagnóstico"], function_notes))
    lines.extend(
        [
            "## Cambios futuros sugeridos",
            "",
            zbx.bullet_list(
                [
                    "Crear documentación de capacidades Zabbix server realmente usadas.",
                    "Crear overrides preparados para métricas internas no aplicables, sin aplicarlos aún.",
                    "Diagnosticar `system.sw.packages.get` con `zabbix_get` y logs del agente.",
                ]
            ),
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def render_eaton(data: dict[str, Any]) -> str:
    items = data["blocks"]["eaton_sai"]
    hosts = defaultdict(list)
    for item in items:
        hosts[item["hostid"]].append(item)
    lines = [
        "# Unsupported Eaton SAI",
        "",
        f"Generado: {data['metadata']['generated_at']}",
        "",
        "## Resumen",
        "",
        zbx.bullet_list(
            [
                f"Items unsupported del bloque: {len(items)}.",
                "Los errores son principalmente OIDs no soportadas por SNMP.",
                "Esto apunta a MIB/modelo/firmware distinto o template no ajustado, no necesariamente a credenciales malas.",
            ]
        ),
        "## Items",
        "",
        render_items_table(items),
        "## Propuesta por SAI",
        "",
    ]
    rows = []
    for hostid, host_items in hosts.items():
        sample = host_items[0]
        macros = data["macros_masked_by_hostid"].get(str(hostid), [])
        rows.append(
            [
                sample["host"],
                sample.get("interface_summary"),
                len(host_items),
                ", ".join(sorted(Counter(item["cause_category"] for item in host_items))),
                ", ".join(macro["macro"] for macro in macros) or "sin macros host visibles",
                "Ejecutar snmpwalk read-only contra la IP del SAI, comparar OIDs fallidas con MIB Eaton/modelo y preparar override por modelo si no aplican.",
            ]
        )
    lines.append(zbx.md_table(["Host", "Interfaz", "Unsupported", "Causas", "Macros visibles (valores enmascarados)", "Propuesta"], rows))
    return "\n".join(lines).rstrip() + "\n"


def render_nas(data: dict[str, Any]) -> str:
    items = data["blocks"]["nas_qnap"]
    nas = data["nasalmeria_hdd5"]
    lines = [
        "# Unsupported NAS/QNAP",
        "",
        f"Generado: {data['metadata']['generated_at']}",
        "",
        "## Resumen",
        "",
        zbx.bullet_list(
            [
                f"Items unsupported del bloque: {len(items)}.",
                "Incluye items SMART, discos, pools, volúmenes y SNMP QNAP.",
                "NasAlmeria requiere atención operativa por SMART HDD 5.",
            ]
        ),
        "## Items unsupported NAS/QNAP",
        "",
        render_items_table(items),
        "## NasAlmeria HDD 5",
        "",
    ]
    if nas.get("found"):
        smart = nas.get("smart_item") or {}
        problem = nas.get("active_high_problem") or {}
        trigger = nas.get("trigger") or {}
        lines.append(
            zbx.md_table(
                ["Campo", "Valor"],
                [
                    ["Problema", problem.get("name")],
                    ["Severidad", problem.get("severity")],
                    ["Inicio", problem.get("clock_text")],
                    ["Duración", problem.get("duration")],
                    ["Operational data", problem.get("operational_data")],
                    ["Trigger", f"{trigger.get('triggerid')} / {trigger.get('status')} / {trigger.get('description')}"],
                    ["Item", f"{smart.get('itemid')} / {smart.get('name')} / {smart.get('key')}"],
                    ["Último valor", smart.get("lastvalue")],
                    ["Último dato", smart.get("lastclock_text")],
                    ["Diagnóstico", nas.get("diagnosis")],
                ],
            )
        )
        lines.extend(
            [
                "### Historial reciente SMART",
                "",
                zbx.md_table(
                    ["Clock", "Valor"],
                    [[entry.get("clock_text"), entry.get("value")] for entry in nas.get("smart_history_recent", [])[:20]],
                ),
                "### Acción operativa recomendada para NasAlmeria",
                "",
                zbx.bullet_list(
                    [
                        nas.get("operational_recommendation", ""),
                        "No cerrar, silenciar ni tratar como limpieza de Zabbix hasta confirmar estado físico.",
                        "Validar HDD 5 en GUI/SSH QNAP y revisar estado RAID/storage pool antes de cualquier cambio.",
                    ]
                ),
                "Comandos propuestos, no ejecutados:",
                "",
                zbx.bullet_list(nas.get("confirmation_commands_not_executed", [])),
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def render_printers(data: dict[str, Any]) -> str:
    items = data["blocks"]["printers_snmp"]
    stale = data["stale_printers"]
    lines = [
        "# Unsupported printers SNMP",
        "",
        f"Generado: {data['metadata']['generated_at']}",
        "",
        "## Resumen",
        "",
        zbx.bullet_list(
            [
                f"Items unsupported del bloque: {len(items)}.",
                f"Impresoras sin datos recientes: {len(stale)}.",
                "La propuesta es confirmar existencia/IP/SNMP antes de pasar a mantenimiento o retirar.",
            ]
        ),
        "## Items unsupported",
        "",
        render_items_table(items),
        "## Impresoras sin datos recientes",
        "",
        zbx.md_table(
            ["Host", "Grupo", "Interfaz", "Último dato", "Diagnóstico", "Propuesta"],
            [
                [
                    zbx.display_host(entry["host"]),
                    ", ".join(group.get("name", "") for group in entry.get("groups", [])),
                    "; ".join(
                        f"{iface.get('type')} {iface.get('ip') or iface.get('dns')}:{iface.get('port')} {iface.get('available')}"
                        for iface in entry.get("interfaces", [])
                        if iface
                    ),
                    entry.get("last_item_clock_text"),
                    entry.get("diagnosis"),
                    entry.get("proposal"),
                ]
                for entry in stale
            ],
        ),
    ]
    return "\n".join(lines).rstrip() + "\n"


def render_other(data: dict[str, Any]) -> str:
    items = data["blocks"]["other"]
    lines = [
        "# Unsupported other",
        "",
        f"Generado: {data['metadata']['generated_at']}",
        "",
        "## Resumen",
        "",
        zbx.bullet_list([f"Items unsupported fuera de bloques principales: {len(items)}."]),
        "## Items",
        "",
        render_items_table(items),
        "## Recomendación",
        "",
        zbx.bullet_list(
            [
                "Revisar por host y causa antes de modificar templates.",
                "Priorizar storage, backups y hosts críticos sobre limpieza estética.",
            ]
        ),
    ]
    return "\n".join(lines).rstrip() + "\n"


def write_reports(data: dict[str, Any]) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    renderers = {
        "zabbix_internal": render_zabbix_internal,
        "eaton_sai": render_eaton,
        "nas_qnap": render_nas,
        "printers_snmp": render_printers,
        "other": render_other,
    }
    for block, path in REPORT_PATHS.items():
        path.write_text(renderers[block](data), encoding="utf-8")
    SUMMARY_JSON.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    try:
        data = collect()
        write_reports(data)
    except (FileNotFoundError, ValueError, RuntimeError, zbx.ApiError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("Unsupported block diagnostics generated.")
    print(f"Unsupported items: {data['summary']['unsupported_total']}")
    print(f"Blocks: {data['summary']['blocks']}")
    print(f"JSON report: {SUMMARY_JSON}")
    if data["api_errors"]:
        print(f"API read warnings: {len(data['api_errors'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
