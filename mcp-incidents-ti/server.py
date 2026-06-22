#!/usr/bin/env python3
"""Read-only MCP backend for SharePoint/Microsoft Lists IncidenciasTI.

The server exposes query-only tools for Microsoft Graph list data. All Graph
requests are forced through GET. The MCP tool registry contains no create,
update, delete, close, assign or comment operations.
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


BASE_DIR = Path("/opt/zabbix-codex")
ENV_FILE = Path("/etc/zabbix-codex/sharepoint-incidents.env")
MCP_ENV_FILE = Path("/etc/zabbix-codex/incidents-ti-mcp.env")
AUDIT_LOG_FILE = Path("/var/log/zabbix-codex/incidents-ti-mcp.log")
GRAPH_TIMEOUT_SECONDS = 20
GRAPH_BASE_URL_DEFAULT = "https://graph.microsoft.com/v1.0"
TOKEN_SCOPE_DEFAULT = "https://graph.microsoft.com/.default"
SITE_ID_DEFAULT = "ramiroarnedo.sharepoint.com,e3fa6571-ed97-4b39-8d78-a4e498324ca6,ddd6e648-3399-4ed4-879e-0c99a63c88f1"
SITE_HOSTNAME_DEFAULT = "ramiroarnedo.sharepoint.com"
SITE_PATH_DEFAULT = "/Departamento de Informática"
LIST_NAME_DEFAULT = "IncidenciasTI"
LIST_PATH_DEFAULT = "Lists/IncidenciasTI"
READ_ONLY_ANNOTATIONS = {"readOnlyHint": True}

GRAPH_ALLOWED_METHODS = {"GET"}
GRAPH_BLOCKED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
FORBIDDEN_TOOL_WORDS = {
    "add",
    "assign",
    "close",
    "comment",
    "create",
    "delete",
    "disable",
    "edit",
    "modify",
    "patch",
    "post",
    "put",
    "remove",
    "resolve",
    "silence",
    "update",
    "write",
}

STATUS_OPEN = {"abierta", "abierto", "open", "new", "nuevo", "nueva", "pendiente"}
STATUS_PROGRESS = {"en curso", "encurso", "in progress", "progress", "trabajando", "proceso"}
STATUS_CLOSED = {"cerrada", "cerrado", "closed", "resuelta", "resuelto", "finalizada", "finalizado"}
URGENT_PRIORITY = {"alta", "high", "urgente", "urgent", "critica", "crítica", "critical"}

FIELD_ALIASES = {
    "title": ["title", "titulo", "título", "asunto", "subject", "nombre"],
    "description": ["description", "descripcion", "descripción", "detalle", "detalles", "descripciondelproblema", "problema"],
    "status": ["estado", "status", "state", "situacion", "situación"],
    "requester": ["solicitante", "requester", "usuario", "user", "peticionario", "createdby", "creadopor", "autor", "author"],
    "creator_name": ["creadopornombre", "creatorname", "createdbyname", "authorname", "creador", "createdbydisplayname"],
    "creator_email": ["creadoporemail", "creatoremail", "createdbyemail", "authoremail", "creadoremail"],
    "assigned_to": ["tecnico", "técnico", "assignedto", "asignado", "asignadaa", "responsable"],
    "modified_by": ["modificadopor", "editor"],
    "priority": ["prioridad", "priority", "urgencia", "impacto"],
    "category": ["categoria", "categoría", "category", "tipo", "area", "área"],
    "affected_system": ["sistemaafectado", "sistema", "host", "equipo", "equipopuesto", "aplicacion", "aplicación", "servicio", "asset"],
    "location": ["ubicacion", "ubicación", "ubicacionpuesto", "dondeocurre"],
    "comments": ["comentarios", "comments", "evolucion", "evolución", "seguimiento", "notas", "resolucion", "resolución"],
    "closed_at": ["fechadecierre", "closedat", "closeddate"],
}

REAL_LIST_FIELD_DEFAULTS = {
    "title": "Title",
    "description": "Descripci_x00f3_n",
    "status": "Estado",
    "requester": "Author",
    "modified_by": "Editor",
    "priority": "Prioridad",
    "category": "Categor_x00ed_a",
    "affected_system": "Equipo_x002f_Puesto",
    "location": "Ubicaci_x00f3_n_x002f_Puesto_x00",
    "comments": "Resoluci_x00f3_n",
    "closed_at": "Fechadecierre",
}


class ToolError(RuntimeError):
    """Raised when a tool cannot complete safely."""


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        line = re.sub(r"^export\s+", "", line)
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def merged_env() -> dict[str, str]:
    env = {
        "GRAPH_BASE_URL": GRAPH_BASE_URL_DEFAULT,
        "GRAPH_SCOPE": TOKEN_SCOPE_DEFAULT,
        "SHAREPOINT_SITE_ID": SITE_ID_DEFAULT,
        "SHAREPOINT_HOSTNAME": SITE_HOSTNAME_DEFAULT,
        "SHAREPOINT_SITE_PATH": SITE_PATH_DEFAULT,
        "SHAREPOINT_LIST_NAME": LIST_NAME_DEFAULT,
        "SHAREPOINT_LIST_PATH": LIST_PATH_DEFAULT,
    }
    env.update(load_env(ENV_FILE))
    return env


def secret_values() -> list[str]:
    values: list[str] = []
    for path in (ENV_FILE, MCP_ENV_FILE):
        try:
            env = load_env(path)
        except PermissionError:
            continue
        for key, value in env.items():
            key_l = key.lower()
            if value and value != "CAMBIAR" and len(value) >= 6 and any(word in key_l for word in ("token", "secret", "pass", "password", "client_secret")):
                values.append(value)
    return values


def mask_secrets(text: str) -> str:
    masked = text
    for value in secret_values():
        masked = masked.replace(value, "***")
    return masked


def audit(event: dict[str, Any]) -> None:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "server": "sharepoint-incidents-ti-mcp",
        **event,
    }
    try:
        with AUDIT_LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(mask_secrets(json.dumps(record, ensure_ascii=False, sort_keys=True)) + "\n")
    except OSError:
        return


def norm(text: Any) -> str:
    raw = str(text or "").strip().lower()
    raw = raw.replace("_x00e1_", "a").replace("_x00e9_", "e").replace("_x00ed_", "i").replace("_x00f3_", "o").replace("_x00fa_", "u")
    raw = raw.replace("_x00c1_", "a").replace("_x00c9_", "e").replace("_x00cd_", "i").replace("_x00d3_", "o").replace("_x00da_", "u")
    trans = str.maketrans("áéíóúüñç", "aeiouunc")
    return re.sub(r"[^a-z0-9]+", "", raw.translate(trans))


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return ", ".join(as_text(item) for item in value if as_text(item))
    if isinstance(value, dict):
        for key in ("displayName", "email", "lookupValue", "title", "name", "Value"):
            if key in value and value[key]:
                return as_text(value[key])
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def first_text(*values: Any) -> str:
    for value in values:
        text = as_text(value).strip()
        if text:
            return text
    return ""


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value)
    try:
        if text.endswith("Z"):
            return datetime.fromisoformat(text[:-1] + "+00:00")
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def dt_text(value: Any) -> str:
    dt = parse_dt(value)
    if not dt:
        return str(value or "")
    return dt.astimezone().isoformat()


class GraphClient:
    def __init__(self) -> None:
        self.env = merged_env()
        self.base_url = self.env.get("GRAPH_BASE_URL", GRAPH_BASE_URL_DEFAULT).rstrip("/")
        self.site_id = self.env.get("SHAREPOINT_SITE_ID", SITE_ID_DEFAULT)
        self.hostname = self.env.get("SHAREPOINT_HOSTNAME", SITE_HOSTNAME_DEFAULT)
        self.site_path = self.env.get("SHAREPOINT_SITE_PATH", SITE_PATH_DEFAULT)
        self.list_name = self.env.get("SHAREPOINT_LIST_NAME", LIST_NAME_DEFAULT)
        self.list_path = self.env.get("SHAREPOINT_LIST_PATH", LIST_PATH_DEFAULT)
        self._token: str | None = None
        self._list_id: str | None = self._clean(self.env.get("SHAREPOINT_LIST_ID", ""))

    @staticmethod
    def _clean(value: str | None) -> str:
        if not value or value.strip().upper() in {"CAMBIAR", "REPLACE_ME", "TODO"}:
            return ""
        return value.strip()

    def missing_config(self) -> list[str]:
        if self._clean(self.env.get("GRAPH_ACCESS_TOKEN", "")):
            return []
        missing = []
        for key in ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"):
            if not self._clean(self.env.get(key, "")):
                missing.append(key)
        return missing

    def config_status(self) -> dict[str, Any]:
        return {
            "config_file": str(ENV_FILE),
            "site_id": self.site_id,
            "hostname": self.hostname,
            "site_path": self.site_path,
            "list_name": self.list_name,
            "list_path": self.list_path,
            "list_id_configured": bool(self._list_id),
            "graph_base_url": self.base_url,
            "missing_keys": self.missing_config(),
            "secrets_printed": False,
        }

    def access_token(self) -> str:
        if self._token:
            return self._token
        direct_token = self._clean(self.env.get("GRAPH_ACCESS_TOKEN", ""))
        if direct_token:
            self._token = direct_token
            return self._token

        missing = self.missing_config()
        if missing:
            raise ToolError("Microsoft Graph credentials are not configured: " + ", ".join(missing))

        tenant_id = self._clean(self.env.get("GRAPH_TENANT_ID", ""))
        client_id = self._clean(self.env.get("GRAPH_CLIENT_ID", ""))
        client_secret = self._clean(self.env.get("GRAPH_CLIENT_SECRET", ""))
        scope = self.env.get("GRAPH_SCOPE", TOKEN_SCOPE_DEFAULT)
        token_url = f"https://login.microsoftonline.com/{quote(tenant_id)}/oauth2/v2.0/token"
        body = urlencode(
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": scope,
                "grant_type": "client_credentials",
            }
        ).encode("utf-8")
        request = Request(
            token_url,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "zabbix-codex-incidents-mcp/0.1"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=GRAPH_TIMEOUT_SECONDS, context=ssl.create_default_context()) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            raise ToolError(mask_secrets(f"Microsoft identity token request failed HTTP {exc.code}: {payload[:500]}")) from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise ToolError(mask_secrets(f"Microsoft identity token request failed: {exc}")) from exc

        token = data.get("access_token")
        if not token:
            raise ToolError("Microsoft identity token response did not include access_token")
        self._token = token
        return self._token

    def graph_request(self, method: str, path_or_url: str, params: dict[str, Any] | None = None) -> Any:
        method_u = method.upper()
        if method_u not in GRAPH_ALLOWED_METHODS:
            audit(
                {
                    "event": "blocked_graph_method",
                    "method": method_u,
                    "path": path_or_url,
                    "reason": "only_GET_allowed",
                    "success": False,
                }
            )
            raise ToolError(f"Blocked non-read-only Microsoft Graph method: {method_u}")
        if method_u in GRAPH_BLOCKED_METHODS:
            audit(
                {
                    "event": "blocked_graph_method",
                    "method": method_u,
                    "path": path_or_url,
                    "reason": "write_method_forbidden",
                    "success": False,
                }
            )
            raise ToolError(f"Blocked write-capable Microsoft Graph method: {method_u}")

        if path_or_url.startswith("https://"):
            url = path_or_url
            if params:
                separator = "&" if "?" in url else "?"
                url += separator + urlencode(params)
        else:
            url = self.base_url + "/" + path_or_url.lstrip("/")
            if params:
                url += "?" + urlencode(params)

        split = urlsplit(url)
        if split.netloc and split.netloc != urlsplit(self.base_url).netloc:
            raise ToolError(f"Blocked Graph URL outside configured host: {split.netloc}")

        request = Request(
            url,
            headers={
                "Authorization": f"Bearer {self.access_token()}",
                "Accept": "application/json",
                "User-Agent": "zabbix-codex-incidents-mcp/0.1",
            },
            method="GET",
        )
        start = time.perf_counter()
        try:
            with urlopen(request, timeout=GRAPH_TIMEOUT_SECONDS, context=ssl.create_default_context()) as response:
                raw = response.read().decode("utf-8")
                data = json.loads(raw) if raw else {}
        except HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            audit(
                {
                    "event": "graph_get",
                    "method": method_u,
                    "path": split.path,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 3),
                    "success": False,
                    "status_code": exc.code,
                    "error": mask_secrets(payload[:500]),
                }
            )
            raise ToolError(mask_secrets(f"Microsoft Graph GET failed HTTP {exc.code}: {payload[:500]}")) from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            audit(
                {
                    "event": "graph_get",
                    "method": method_u,
                    "path": split.path,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 3),
                    "success": False,
                    "error": mask_secrets(str(exc)),
                }
            )
            raise ToolError(mask_secrets(f"Microsoft Graph GET failed: {exc}")) from exc

        audit(
            {
                "event": "graph_get",
                "method": method_u,
                "path": split.path,
                "duration_ms": round((time.perf_counter() - start) * 1000, 3),
                "success": True,
                "status_code": 200,
            }
        )
        return data

    def graph_get(self, path_or_url: str, params: dict[str, Any] | None = None) -> Any:
        return self.graph_request("GET", path_or_url, params=params)

    def paged_get(self, path: str, params: dict[str, Any] | None = None, max_items: int = 1000) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        data = self.graph_get(path, params=params)
        while True:
            batch = data.get("value", []) if isinstance(data, dict) else []
            items.extend(batch)
            if len(items) >= max_items:
                return items[:max_items]
            next_link = data.get("@odata.nextLink") if isinstance(data, dict) else None
            if not next_link:
                return items
            data = self.graph_get(next_link)

    def list_id(self) -> str:
        if self._list_id:
            return self._list_id

        encoded_name = quote(self.list_name, safe="")
        try:
            data = self.graph_get(f"/sites/{quote(self.site_id, safe=',')}/lists/{encoded_name}")
            candidate = data.get("id")
            if candidate:
                self._list_id = candidate
                return candidate
        except ToolError:
            pass

        lists = self.paged_get(f"/sites/{quote(self.site_id, safe=',')}/lists", params={"$select": "id,displayName,name,webUrl"}, max_items=500)
        wanted = norm(self.list_name)
        path_wanted = norm(self.list_path)
        for item in lists:
            if norm(item.get("displayName")) == wanted or norm(item.get("name")) == wanted or path_wanted in norm(item.get("webUrl", "")):
                self._list_id = str(item["id"])
                return self._list_id
        raise ToolError(f"List not found in site: {self.list_name}")

    def columns(self) -> list[dict[str, Any]]:
        list_id = self.list_id()
        columns = self.paged_get(
            f"/sites/{quote(self.site_id, safe=',')}/lists/{quote(list_id)}/columns",
            params={"$select": "id,name,displayName,description,hidden,readOnly,required,indexed,columnGroup,text,choice,personOrGroup,lookup,dateTime,number,boolean"},
            max_items=1000,
        )
        return columns

    def schema_mapping(self) -> dict[str, str]:
        columns = self.columns()
        lookup: dict[str, str] = {}
        for column in columns:
            names = [column.get("name", ""), column.get("displayName", "")]
            normalized = {norm(name) for name in names if name}
            for canonical, aliases in FIELD_ALIASES.items():
                if canonical not in lookup and any(norm(alias) in normalized for alias in aliases):
                    lookup[canonical] = str(column.get("name") or column.get("displayName"))
        available = {str(column.get("name") or "") for column in columns}
        for canonical, internal_name in REAL_LIST_FIELD_DEFAULTS.items():
            if canonical not in lookup and internal_name in available:
                lookup[canonical] = internal_name
        return lookup

    def items(self, max_items: int = 1000) -> list[dict[str, Any]]:
        list_id = self.list_id()
        return self.paged_get(
            f"/sites/{quote(self.site_id, safe=',')}/lists/{quote(list_id)}/items",
            params={"$expand": "fields", "$top": min(max_items, 999)},
            max_items=max_items,
        )

    def item_by_id(self, item_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]+", str(item_id)):
            raise ToolError("Invalid incident_id format")
        list_id = self.list_id()
        return self.graph_get(f"/sites/{quote(self.site_id, safe=',')}/lists/{quote(list_id)}/items/{quote(str(item_id))}", params={"$expand": "fields"})


def graph_tool_error(exc: Exception) -> dict[str, Any]:
    client = GraphClient()
    return {
        "ok": False,
        "graph_available": False,
        "error": mask_secrets(str(exc)),
        "configuration": client.config_status(),
        "read_only": True,
        "required_next_step": "Configure read-only Microsoft Graph credentials in /etc/zabbix-codex/sharepoint-incidents.env.",
    }


def normalize_incident(item: dict[str, Any], mapping: dict[str, str] | None = None, include_raw: bool = False) -> dict[str, Any]:
    fields = item.get("fields", {}) or {}
    fields_raw = item.get("fields_raw", {}) or {}
    list_item_raw = item.get("list_item_raw", {}) or {}
    created_by = list_item_raw.get("createdBy", {}) or {}
    created_by_user = created_by.get("user", {}) or {}
    fields_lookup = {}
    for source in (fields, fields_raw):
        if isinstance(source, dict):
            fields_lookup.update(source)
    mapping = mapping or {}

    def field(canonical: str) -> Any:
        key = mapping.get(canonical)
        if key and key in fields_lookup:
            return fields_lookup.get(key)
        aliases = FIELD_ALIASES.get(canonical, [])
        by_norm = {norm(k): k for k in fields_lookup}
        for alias in aliases:
            real_key = by_norm.get(alias)
            if real_key:
                return fields_lookup.get(real_key)
        return None

    creator_name = first_text(
        field("creator_name"),
        fields_lookup.get("CreadoPorNombre"),
        fields_lookup.get("CreadoPorNombre"),
        created_by_user.get("displayName"),
        item.get("createdBy", {}).get("user", {}).get("displayName") if isinstance(item.get("createdBy"), dict) else None,
        fields_lookup.get("Author"),
        field("requester"),
    )
    creator_email = first_text(
        field("creator_email"),
        fields_lookup.get("CreadoPorEmail"),
        fields_lookup.get("CreadoPorEmail"),
        created_by_user.get("email"),
        item.get("createdBy", {}).get("user", {}).get("email") if isinstance(item.get("createdBy"), dict) else None,
        fields_lookup.get("AuthorEmail"),
    )
    title = field("title") or fields_lookup.get("Title") or fields_lookup.get("LinkTitle") or item.get("name")
    status = as_text(field("status"))
    result = {
        "id": item.get("id"),
        "title": as_text(title),
        "description": as_text(field("description")),
        "status": status,
        "created": dt_text(item.get("createdDateTime") or fields_lookup.get("Created")),
        "modified": dt_text(item.get("lastModifiedDateTime") or fields_lookup.get("Modified")),
        "requester": as_text(field("requester")),
        "created_by_name": creator_name,
        "created_by_email": creator_email,
        "creator_name": creator_name,
        "creator_email": creator_email,
        "assigned_to": as_text(field("assigned_to")),
        "modified_by": as_text(field("modified_by")),
        "priority": as_text(field("priority")),
        "category": as_text(field("category")),
        "affected_system": as_text(field("affected_system")),
        "location": as_text(field("location")),
        "comments": as_text(field("comments")),
        "closed_at": dt_text(field("closed_at")),
        "url": item.get("webUrl", ""),
    }
    if include_raw:
        result["fields_raw"] = fields
        result["list_item_raw"] = {key: value for key, value in item.items() if key != "fields"}
    return result


def status_bucket(status: str) -> str:
    text = status.strip().lower()
    n = norm(text)
    if text in STATUS_OPEN or n in STATUS_OPEN:
        return "open"
    if text in STATUS_PROGRESS or n in STATUS_PROGRESS:
        return "in_progress"
    if text in STATUS_CLOSED or n in STATUS_CLOSED:
        return "closed"
    return "other"


def incident_matches_text(incident: dict[str, Any], query: str) -> bool:
    q = norm(query)
    haystack = norm(
        " ".join(
            as_text(incident.get(key, ""))
            for key in ("id", "title", "description", "status", "requester", "assigned_to", "priority", "category", "affected_system", "comments")
        )
    )
    return bool(q and q in haystack)


def sort_recent(incidents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(incidents, key=lambda item: parse_dt(item.get("modified")) or parse_dt(item.get("created")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


def get_client_data(max_items: int = 1000) -> tuple[GraphClient, dict[str, str], list[dict[str, Any]]]:
    client = GraphClient()
    mapping = client.schema_mapping()
    raw_items = client.items(max_items=max_items)
    incidents = [normalize_incident(item, mapping=mapping) for item in raw_items]
    return client, mapping, incidents


def tool_get_incidents_schema(args: dict[str, Any]) -> dict[str, Any]:
    try:
        client = GraphClient()
        columns = client.columns()
        mapping = client.schema_mapping()
        return {
            "ok": True,
            "read_only": True,
            "site_id": client.site_id,
            "list_name": client.list_name,
            "list_id": client.list_id(),
            "columns": [
                {
                    "id": column.get("id"),
                    "name": column.get("name"),
                    "displayName": column.get("displayName"),
                    "description": column.get("description", ""),
                    "hidden": column.get("hidden", False),
                    "readOnly": column.get("readOnly", False),
                    "required": column.get("required", False),
                    "indexed": column.get("indexed", False),
                    "type": next((key for key in ("text", "choice", "personOrGroup", "lookup", "dateTime", "number", "boolean") if key in column), "unknown"),
                }
                for column in columns
            ],
            "field_mapping": mapping,
        }
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def tool_get_incidents_summary(args: dict[str, Any]) -> dict[str, Any]:
    try:
        _, _, incidents = get_client_data(max_items=int(args.get("max_items", 1000)))
        counts = {"open": 0, "in_progress": 0, "closed": 0, "other": 0}
        status_values: dict[str, int] = {}
        for incident in incidents:
            status = incident.get("status", "")
            counts[status_bucket(status)] += 1
            status_values[status or "(empty)"] = status_values.get(status or "(empty)", 0) + 1
        urgent = [incident for incident in incidents if norm(incident.get("priority")) in {norm(x) for x in URGENT_PRIORITY}]
        return {
            "ok": True,
            "read_only": True,
            "total": len(incidents),
            "counts": counts,
            "status_values": status_values,
            "latest": sort_recent(incidents)[: int(args.get("limit", 10))],
            "urgent_candidates": sort_recent(urgent)[: int(args.get("limit", 10))],
        }
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def filter_optional(incidents: list[dict[str, Any]], args: dict[str, Any]) -> list[dict[str, Any]]:
    filters = {
        "assigned_to": args.get("assigned_to"),
        "category": args.get("category"),
        "priority": args.get("priority"),
    }
    result = incidents
    for key, value in filters.items():
        if value:
            wanted = norm(value)
            result = [incident for incident in result if wanted in norm(incident.get(key, ""))]
    return result


def tool_get_open_incidents(args: dict[str, Any]) -> dict[str, Any]:
    try:
        _, _, incidents = get_client_data()
        result = [incident for incident in incidents if status_bucket(incident.get("status", "")) == "open"]
        result = sort_recent(filter_optional(result, args))
        return {"ok": True, "read_only": True, "count": len(result), "incidents": result[: int(args.get("limit", 50))]}
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def tool_get_incidents_by_status(args: dict[str, Any]) -> dict[str, Any]:
    status = str(args.get("status", "")).strip()
    if not status:
        return {"ok": False, "read_only": True, "error": "status is required"}
    try:
        _, _, incidents = get_client_data()
        wanted = norm(status)
        result = [incident for incident in incidents if wanted == norm(incident.get("status")) or wanted == status_bucket(incident.get("status", ""))]
        result = sort_recent(result)
        return {"ok": True, "read_only": True, "status": status, "count": len(result), "incidents": result[: int(args.get("limit", 100))]}
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def tool_get_recent_incidents(args: dict[str, Any]) -> dict[str, Any]:
    days = int(args.get("days", 7))
    limit = int(args.get("limit", 50))
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(days, 0))
    try:
        _, _, incidents = get_client_data()
        result = []
        for incident in incidents:
            modified = parse_dt(incident.get("modified"))
            created = parse_dt(incident.get("created"))
            if (modified and modified.astimezone(timezone.utc) >= cutoff) or (created and created.astimezone(timezone.utc) >= cutoff):
                result.append(incident)
        return {"ok": True, "read_only": True, "days": days, "count": len(result), "incidents": sort_recent(result)[:limit]}
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def tool_get_incident_by_id(args: dict[str, Any]) -> dict[str, Any]:
    incident_id = str(args.get("incident_id", "")).strip()
    if not incident_id:
        return {"ok": False, "read_only": True, "error": "incident_id is required"}
    try:
        client = GraphClient()
        mapping = client.schema_mapping()
        item = client.item_by_id(incident_id)
        return {"ok": True, "read_only": True, "incident": normalize_incident(item, mapping=mapping, include_raw=True)}
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def tool_search_incidents(args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query", "")).strip()
    if not query:
        return {"ok": False, "read_only": True, "error": "query is required"}
    try:
        _, _, incidents = get_client_data()
        result = [incident for incident in incidents if incident_matches_text(incident, query)]
        return {"ok": True, "read_only": True, "query": query, "count": len(result), "incidents": sort_recent(result)[: int(args.get("limit", 50))]}
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


def tool_get_incidents_related_to_asset(args: dict[str, Any]) -> dict[str, Any]:
    asset = str(args.get("asset_name", "")).strip()
    if not asset:
        return {"ok": False, "read_only": True, "error": "asset_name is required"}
    try:
        _, _, incidents = get_client_data()
        result = [incident for incident in incidents if incident_matches_text(incident, asset)]
        return {"ok": True, "read_only": True, "asset_name": asset, "count": len(result), "incidents": sort_recent(result)[: int(args.get("limit", 50))]}
    except Exception as exc:  # noqa: BLE001
        return graph_tool_error(exc)


TOOL_HANDLERS = {
    "get_incidents_schema": tool_get_incidents_schema,
    "get_incidents_summary": tool_get_incidents_summary,
    "get_open_incidents": tool_get_open_incidents,
    "get_incidents_by_status": tool_get_incidents_by_status,
    "get_recent_incidents": tool_get_recent_incidents,
    "get_incident_by_id": tool_get_incident_by_id,
    "search_incidents": tool_search_incidents,
    "get_incidents_related_to_asset": tool_get_incidents_related_to_asset,
}

TOOL_SCHEMAS = [
    {
        "name": "get_incidents_schema",
        "description": "Obtiene en modo read-only columnas disponibles de la lista IncidenciasTI, nombres internos, nombres visibles y mapeo inicial.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_incidents_summary",
        "description": "Consulta en modo read-only resumen de IncidenciasTI: conteo por estado, ultimas incidencias y posibles urgentes.",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 100}}, "additionalProperties": False},
    },
    {
        "name": "get_open_incidents",
        "description": "Lista en modo read-only incidencias abiertas, con filtros opcionales por tecnico, categoria o prioridad.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 200},
                "assigned_to": {"type": "string"},
                "category": {"type": "string"},
                "priority": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_incidents_by_status",
        "description": "Obtiene en modo read-only incidencias filtradas por estado.",
        "inputSchema": {"type": "object", "properties": {"status": {"type": "string"}, "limit": {"type": "integer", "default": 100, "minimum": 1, "maximum": 500}}, "required": ["status"], "additionalProperties": False},
    },
    {
        "name": "get_recent_incidents",
        "description": "Lista en modo read-only incidencias creadas o modificadas recientemente.",
        "inputSchema": {"type": "object", "properties": {"days": {"type": "integer", "default": 7, "minimum": 0, "maximum": 365}, "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 500}}, "additionalProperties": False},
    },
    {
        "name": "get_incident_by_id",
        "description": "Obtiene en modo read-only el detalle completo de una incidencia por ID.",
        "inputSchema": {"type": "object", "properties": {"incident_id": {"type": "string"}}, "required": ["incident_id"], "additionalProperties": False},
    },
    {
        "name": "search_incidents",
        "description": "Busca en modo read-only incidencias por texto en titulo, descripcion, sistema, usuario, categoria y otros campos disponibles.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 500}}, "required": ["query"], "additionalProperties": False},
    },
    {
        "name": "get_incidents_related_to_asset",
        "description": "Busca en modo read-only incidencias relacionadas con un host, sistema, NAS, aplicacion o activo.",
        "inputSchema": {"type": "object", "properties": {"asset_name": {"type": "string"}, "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 500}}, "required": ["asset_name"], "additionalProperties": False},
    },
]

for schema in TOOL_SCHEMAS:
    schema.setdefault("annotations", {}).update(READ_ONLY_ANNOTATIONS)


def validate_read_only_registry() -> dict[str, Any]:
    write_like_tools = []
    missing_annotations = []
    for tool in TOOL_SCHEMAS:
        name = str(tool.get("name", ""))
        words = {part for part in re.split(r"[^a-z0-9]+", name.lower()) if part}
        if words & FORBIDDEN_TOOL_WORDS:
            write_like_tools.append(name)
        if tool.get("annotations", {}).get("readOnlyHint") is not True:
            missing_annotations.append(name)
    return {
        "ok": not write_like_tools and not missing_annotations,
        "tools_defined": len(TOOL_SCHEMAS),
        "all_tools_read_only": not missing_annotations,
        "missing_read_only_annotations": missing_annotations,
        "published_write_like_tools": write_like_tools,
        "graph_allowed_methods": sorted(GRAPH_ALLOWED_METHODS),
        "graph_blocked_methods": sorted(GRAPH_BLOCKED_METHODS),
        "read_only": True,
    }


def call_tool(name: str, arguments: dict[str, Any] | None = None) -> Any:
    start = time.perf_counter()
    success = False
    error = ""
    try:
        if name not in TOOL_HANDLERS:
            raise ToolError(f"Unknown tool: {name}")
        result = TOOL_HANDLERS[name](arguments or {})
        success = True
        return result
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
        raise
    finally:
        audit(
            {
                "event": "tool_call",
                "tool": name,
                "duration_ms": round((time.perf_counter() - start) * 1000, 3),
                "success": success,
                "error": mask_secrets(error)[:500] if error else "",
            }
        )


def mcp_success(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def mcp_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": mask_secrets(message)}}


def handle_mcp_request(request: dict[str, Any]) -> dict[str, Any] | None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    if request_id is None and method in {"notifications/initialized"}:
        return None
    try:
        if method == "initialize":
            return mcp_success(
                request_id,
                {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": "sharepoint-incidents-ti", "version": "0.1.0"},
                    "capabilities": {"tools": {}},
                },
            )
        if method == "tools/list":
            return mcp_success(request_id, {"tools": TOOL_SCHEMAS})
        if method == "tools/call":
            name = params.get("name")
            arguments = params.get("arguments") or {}
            result = call_tool(name, arguments)
            return mcp_success(request_id, {"content": [{"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True)}]})
        return mcp_error(request_id, -32601, f"Method not found: {method}")
    except ToolError as exc:
        return mcp_error(request_id, -32000, str(exc))
    except Exception as exc:  # noqa: BLE001
        return mcp_error(request_id, -32603, f"Internal tool error: {exc}")


def serve_stdio() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response = mcp_error(None, -32700, f"Parse error: {exc}")
        else:
            response = handle_mcp_request(request)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only MCP backend for SharePoint IncidenciasTI")
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--list-tools", action="store_true")
    parser.add_argument("--call", metavar="TOOL")
    parser.add_argument("--args", default="{}")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--test-block-write", action="store_true")
    args = parser.parse_args()

    if args.stdio:
        return serve_stdio()
    if args.list_tools:
        print(json.dumps({"tools": TOOL_SCHEMAS}, indent=2, ensure_ascii=False))
        return 0
    if args.call:
        result = call_tool(args.call, json.loads(args.args))
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
        return 0
    if args.self_test:
        client = GraphClient()
        registry = validate_read_only_registry()
        result = {
            **registry,
            "configuration": client.config_status(),
            "graph_configured": not client.missing_config(),
        }
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
        return 0
    if args.test_block_write:
        try:
            GraphClient().graph_request("POST", "/sites")
        except ToolError:
            print("blocked_ok")
            return 0
        print("blocked_failed")
        return 1

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
