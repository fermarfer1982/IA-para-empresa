#!/usr/bin/env python3
"""Authenticated HTTP wrapper for the IncidenciasTI read-only MCP server."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import server as mcp_stdio  # noqa: E402


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8766
SERVER_NAME = "sharepoint-incidents-ti"
SERVER_VERSION = "0.1.0"
MCP_ENV_FILE = Path("/etc/zabbix-codex/incidents-ti-mcp.env")
AUDIT_LOG_FILE = Path("/var/log/zabbix-codex/incidents-ti-mcp.log")
CONFIG_KEYS = {
    "MCP_BIND_HOST",
    "MCP_BIND_PORT",
    "MCP_REQUIRE_AUTH",
    "MCP_SHARED_TOKEN",
    "MCP_ENABLE_AUDIT",
    "MCP_AUDIT_LOG",
}


def load_config() -> dict[str, str]:
    config = {}
    for key in CONFIG_KEYS:
        if key in os.environ:
            config[key] = os.environ[key]
    if MCP_ENV_FILE.exists():
        config.update(mcp_stdio.load_env(MCP_ENV_FILE))
    return config


def bool_value(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def is_loopback(host: str) -> bool:
    return host in {"127.0.0.1", "::1", "localhost"}


class HttpServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], token: str | None, require_auth: bool, audit_enabled: bool, audit_log: Path) -> None:
        super().__init__(address, Handler)
        self.token = token
        self.require_auth = require_auth
        self.audit_enabled = audit_enabled
        self.audit_log = audit_log
        self.started_at = int(time.time())

    def audit(self, event: dict[str, Any]) -> None:
        if not self.audit_enabled:
            return
        record = {"timestamp": datetime.now(timezone.utc).isoformat(), "server": SERVER_NAME, **event}
        try:
            with self.audit_log.open("a", encoding="utf-8") as handle:
                handle.write(mcp_stdio.mask_secrets(json.dumps(record, ensure_ascii=False, sort_keys=True)) + "\n")
        except OSError as exc:
            sys.stderr.write(f"audit_log_error={mcp_stdio.mask_secrets(str(exc))}\n")


class Handler(BaseHTTPRequestHandler):
    server: HttpServer

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"{self.log_date_time_string()} {self.address_string()} {mcp_stdio.mask_secrets(fmt % args)}\n")

    def origin(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        return forwarded or self.client_address[0]

    def audit(self, start: float, method: str, tool: str, success: bool, status_code: int, error: str = "") -> None:
        self.server.audit(
            {
                "origin": self.origin(),
                "http_method": self.command,
                "path": urlparse(self.path).path,
                "mcp_method": method,
                "tool": tool,
                "duration_ms": round((time.perf_counter() - start) * 1000, 3),
                "success": success,
                "status_code": status_code,
                "error": mcp_stdio.mask_secrets(error)[:500] if error else "",
            }
        )

    def send_json(self, status: int, data: Any, headers: dict[str, str] | None = None) -> None:
        payload = json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def authorized(self) -> bool:
        if not self.server.require_auth:
            return True
        if not self.server.token:
            return False
        return self.headers.get("Authorization", "") == f"Bearer {self.server.token}"

    def require_auth(self, start: float, method: str, tool: str) -> bool:
        if self.authorized():
            return True
        self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized", "message": "Missing or invalid bearer token"}, {"WWW-Authenticate": 'Bearer realm="sharepoint-incidents-ti"'})
        self.audit(start, method, tool, False, HTTPStatus.UNAUTHORIZED, "unauthorized")
        return False

    def metadata(self) -> dict[str, Any]:
        return {
            "name": SERVER_NAME,
            "version": SERVER_VERSION,
            "description": "Read-only MCP server for SharePoint/Microsoft Lists IncidenciasTI.",
            "read_only": True,
            "transport": {"streamable_http_endpoint": "/mcp", "healthcheck": "/healthz", "metadata": ["/metadata", "/.well-known/mcp.json"]},
            "auth": {"required": self.server.require_auth, "scheme": "Bearer", "note": "Temporary bearer auth for internal tests; use OAuth/OIDC or Secure MCP Tunnel for production."},
            "audit": {"enabled": self.server.audit_enabled, "log": str(self.server.audit_log), "secrets_logged": False},
            "tools": [tool["name"] for tool in mcp_stdio.TOOL_SCHEMAS],
            "forbidden": ["Graph non-GET methods", "create/edit/close/assign/comment/delete incidents", "SharePoint writes"],
        }

    def do_GET(self) -> None:  # noqa: N802
        start = time.perf_counter()
        path = urlparse(self.path).path
        if path in {"/", "/metadata", "/.well-known/mcp.json", "/healthz", "/mcp"}:
            if not self.require_auth(start, "http.get", path.strip("/") or "metadata"):
                return
        if path == "/healthz":
            self.send_json(HTTPStatus.OK, {"ok": True, "name": SERVER_NAME, "version": SERVER_VERSION, "read_only": True, "auth_required": self.server.require_auth, "audit_enabled": self.server.audit_enabled, "uptime_seconds": int(time.time()) - self.server.started_at})
            self.audit(start, "http.get", "healthz", True, HTTPStatus.OK)
            return
        if path in {"/", "/metadata", "/.well-known/mcp.json"}:
            self.send_json(HTTPStatus.OK, self.metadata())
            self.audit(start, "http.get", "metadata", True, HTTPStatus.OK)
            return
        if path == "/mcp":
            self.send_json(HTTPStatus.OK, {"message": "MCP streamable HTTP endpoint. Send JSON-RPC requests with POST.", "metadata": self.metadata()})
            self.audit(start, "http.get", "mcp", True, HTTPStatus.OK)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": path})
        self.audit(start, "http.get", "not_found", False, HTTPStatus.NOT_FOUND, "not_found")

    def do_POST(self) -> None:  # noqa: N802
        start = time.perf_counter()
        path = urlparse(self.path).path
        if path != "/mcp":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": path})
            self.audit(start, "http.post", "not_found", False, HTTPStatus.NOT_FOUND, "not_found")
            return
        if not self.require_auth(start, "http.post", "mcp"):
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            self.audit(start, "http.post", "mcp", False, HTTPStatus.BAD_REQUEST, "invalid_content_length")
            return
        if length <= 0 or length > 2_000_000:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_body_size"})
            self.audit(start, "http.post", "mcp", False, HTTPStatus.BAD_REQUEST, "invalid_body_size")
            return
        try:
            request = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"Parse error: {exc}"}})
            self.audit(start, "jsonrpc.parse", "mcp", False, HTTPStatus.BAD_REQUEST, str(exc))
            return
        if isinstance(request, list):
            responses = []
            for item in request:
                item_start = time.perf_counter()
                response = mcp_stdio.handle_mcp_request(item) if isinstance(item, dict) else {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
                if response is not None:
                    responses.append(response)
                method = str(item.get("method", "")) if isinstance(item, dict) else "invalid"
                tool = str((item.get("params") or {}).get("name") or method or "notification") if isinstance(item, dict) else "invalid"
                success = response is None or "error" not in response
                error = "" if success else str((response.get("error") or {}).get("message", "error"))
                self.audit(item_start, method, tool, success, HTTPStatus.OK, error)
            self.send_json(HTTPStatus.OK, responses)
            return
        if not isinstance(request, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}})
            self.audit(start, "invalid", "invalid", False, HTTPStatus.BAD_REQUEST, "Invalid request")
            return
        response = mcp_stdio.handle_mcp_request(request)
        method = str(request.get("method", ""))
        tool = str((request.get("params") or {}).get("name") or method or "notification")
        success = response is None or "error" not in response
        error = "" if success else str((response.get("error") or {}).get("message", "error"))
        if response is None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.audit(start, method, tool, success, HTTPStatus.NO_CONTENT, error)
            return
        self.send_json(HTTPStatus.OK, response)
        self.audit(start, method, tool, success, HTTPStatus.OK, error)


def main() -> int:
    config = load_config()
    parser = argparse.ArgumentParser(description="HTTP wrapper for IncidenciasTI read-only MCP")
    parser.add_argument("--host", default=config.get("MCP_BIND_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(config.get("MCP_BIND_PORT", DEFAULT_PORT)))
    args = parser.parse_args()
    token = config.get("MCP_SHARED_TOKEN", "")
    require_auth = bool_value(config.get("MCP_REQUIRE_AUTH"), True) or bool(token)
    audit_enabled = bool_value(config.get("MCP_ENABLE_AUDIT"), True)
    audit_log = Path(config.get("MCP_AUDIT_LOG", str(AUDIT_LOG_FILE)))
    if not is_loopback(args.host) and not require_auth:
        print("ERROR: refusing to bind outside localhost without auth enabled", file=sys.stderr)
        return 2
    if require_auth and not token:
        print("ERROR: auth requested but MCP_SHARED_TOKEN is not set", file=sys.stderr)
        return 2
    httpd = HttpServer((args.host, args.port), token, require_auth, audit_enabled, audit_log)
    print(f"{SERVER_NAME} listening on http://{args.host}:{args.port}/mcp read_only=true auth_required={require_auth} audit_enabled={audit_enabled}", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
