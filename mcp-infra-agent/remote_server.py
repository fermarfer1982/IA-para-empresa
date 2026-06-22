#!/usr/bin/env python3
"""HTTP wrapper for the read-only infrastructure MCP server.

This exposes the same MCP JSON-RPC handlers from server.py over HTTP for
internal testing and reverse-proxy deployment. It does not implement writes and
does not expose secrets. For public ChatGPT app deployment, put this behind
HTTPS and OAuth/reverse-proxy authentication, or replace it with an official
MCP SDK/FastMCP streaming HTTP/SSE server when that dependency is available.
"""

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
DEFAULT_PORT = 8765
SERVER_NAME = "zabbix-codex-infra-agent"
SERVER_VERSION = "0.1.0"
MCP_AGENT_ENV = Path("/etc/zabbix-codex/mcp-agent.env")
AUDIT_LOG_FILE = Path("/var/log/zabbix-codex/infra-agent-mcp.log")
CONFIG_KEYS = {
    "MCP_BIND_HOST",
    "MCP_BIND_PORT",
    "MCP_REQUIRE_AUTH",
    "MCP_SHARED_TOKEN",
    "MCP_ENABLE_AUDIT",
    "MCP_AUDIT_LOG",
    "MCP_INFRA_AGENT_HOST",
    "MCP_INFRA_AGENT_PORT",
    "MCP_INFRA_AGENT_BEARER_TOKEN",
}


def is_loopback(host: str) -> bool:
    return host in {"127.0.0.1", "::1", "localhost"}


def json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")


def bool_value(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def load_remote_config() -> dict[str, str]:
    config: dict[str, str] = {}
    if MCP_AGENT_ENV.exists():
        config.update(mcp_stdio.load_env(MCP_AGENT_ENV))
    for key in CONFIG_KEYS:
        if key in os.environ:
            config[key] = os.environ[key]
    return config


class InfraMcpHttpServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        bearer_token: str | None,
        require_auth: bool,
        audit_enabled: bool,
        audit_log: Path,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.bearer_token = bearer_token
        self.require_auth = require_auth
        self.audit_enabled = audit_enabled
        self.audit_log = audit_log
        self.started_at = int(time.time())

    def audit(self, event: dict[str, Any]) -> None:
        if not self.audit_enabled:
            return
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "server": SERVER_NAME,
            **event,
        }
        text = mcp_stdio.mask_secrets(json.dumps(record, ensure_ascii=False, sort_keys=True))
        try:
            with self.audit_log.open("a", encoding="utf-8") as handle:
                handle.write(text + "\n")
        except OSError as exc:
            sys.stderr.write(f"audit_log_error={mcp_stdio.mask_secrets(str(exc))}\n")


class Handler(BaseHTTPRequestHandler):
    server: InfraMcpHttpServer

    def log_message(self, fmt: str, *args: Any) -> None:
        sanitized = mcp_stdio.mask_secrets(fmt % args)
        sys.stderr.write(f"{self.log_date_time_string()} {self.address_string()} {sanitized}\n")

    def _origin(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        return forwarded or self.client_address[0]

    def _audit(self, start: float, method: str, tool: str, success: bool, status_code: int, error: str = "") -> None:
        self.server.audit(
            {
                "origin": self._origin(),
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

    def _send_json(self, status: int, data: Any, extra_headers: dict[str, str] | None = None) -> None:
        payload = json_bytes(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def _send_no_content(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _metadata(self) -> dict[str, Any]:
        return {
            "name": SERVER_NAME,
            "version": SERVER_VERSION,
            "description": "Read-only MCP server for Zabbix infrastructure state.",
            "read_only": True,
            "transport": {
                "streamable_http_endpoint": "/mcp",
                "healthcheck": "/healthz",
                "metadata": ["/metadata", "/.well-known/mcp.json"],
            },
            "auth": {
                "required": self.server.require_auth,
                "scheme": "Bearer" if self.server.require_auth else "none",
                "note": "Temporary shared-token auth for internal tests. Use OAuth/OIDC or Secure MCP Tunnel before production exposure.",
            },
            "audit": {
                "enabled": self.server.audit_enabled,
                "log": str(self.server.audit_log),
                "secrets_logged": False,
            },
            "tools": [tool["name"] for tool in mcp_stdio.TOOL_SCHEMAS],
            "forbidden": [
                "Zabbix create/update/delete",
                "history.push",
                "problem.close",
                "problem.acknowledge",
                "Proxmox/PBS writes",
                "SharePoint writes",
                "database writes",
            ],
        }

    def _authorized(self) -> bool:
        if not self.server.require_auth:
            return True
        expected = self.server.bearer_token
        if not expected:
            return False
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {expected}"

    def _require_authorized(self, start: float, method: str, tool: str) -> bool:
        if self._authorized():
            return True
        self._send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "unauthorized", "message": "Missing or invalid bearer token"},
            {"WWW-Authenticate": 'Bearer realm="zabbix-codex-infra-agent"'},
        )
        self._audit(start, method, tool, False, HTTPStatus.UNAUTHORIZED, "unauthorized")
        return False

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        start = time.perf_counter()
        path = urlparse(self.path).path
        if path in {"/", "/metadata", "/.well-known/mcp.json", "/healthz", "/mcp"}:
            if not self._require_authorized(start, "http.get", path.strip("/") or "metadata"):
                return
        if path == "/healthz":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION,
                    "read_only": True,
                    "auth_required": self.server.require_auth,
                    "audit_enabled": self.server.audit_enabled,
                    "uptime_seconds": int(time.time()) - self.server.started_at,
                },
            )
            self._audit(start, "http.get", "healthz", True, HTTPStatus.OK)
            return
        if path in {"/", "/metadata", "/.well-known/mcp.json"}:
            self._send_json(HTTPStatus.OK, self._metadata())
            self._audit(start, "http.get", "metadata", True, HTTPStatus.OK)
            return
        if path == "/mcp":
            self._send_json(
                HTTPStatus.OK,
                {
                    "message": "MCP streamable HTTP endpoint. Send JSON-RPC requests with POST.",
                    "metadata": self._metadata(),
                },
            )
            self._audit(start, "http.get", "mcp", True, HTTPStatus.OK)
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": path})
        self._audit(start, "http.get", "not_found", False, HTTPStatus.NOT_FOUND, "not_found")

    def do_POST(self) -> None:  # noqa: N802
        start = time.perf_counter()
        path = urlparse(self.path).path
        if path != "/mcp":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": path})
            self._audit(start, "http.post", "not_found", False, HTTPStatus.NOT_FOUND, "not_found")
            return
        if not self._require_authorized(start, "http.post", "mcp"):
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            self._audit(start, "http.post", "mcp", False, HTTPStatus.BAD_REQUEST, "invalid_content_length")
            return

        if content_length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "empty_body"})
            self._audit(start, "http.post", "mcp", False, HTTPStatus.BAD_REQUEST, "empty_body")
            return
        if content_length > 2_000_000:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large"})
            self._audit(start, "http.post", "mcp", False, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body_too_large")
            return

        raw = self.rfile.read(content_length)
        try:
            request = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"Parse error: {exc}"}})
            self._audit(start, "jsonrpc.parse", "mcp", False, HTTPStatus.BAD_REQUEST, str(exc))
            return

        if isinstance(request, list):
            responses = []
            for item in request:
                item_start = time.perf_counter()
                if not isinstance(item, dict):
                    response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
                    responses.append(response)
                    self._audit(item_start, "invalid", "invalid", False, HTTPStatus.OK, "Invalid request")
                    continue
                response = mcp_stdio.handle_mcp_request(item)
                if response is not None:
                    responses.append(response)
                method = str(item.get("method", ""))
                tool = str((item.get("params") or {}).get("name") or method or "notification")
                success = response is None or "error" not in response
                error = "" if success else str((response.get("error") or {}).get("message", "error"))
                self._audit(item_start, method, tool, success, HTTPStatus.OK, error)
            self._send_json(HTTPStatus.OK, responses)
            return

        if not isinstance(request, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}})
            self._audit(start, "invalid", "invalid", False, HTTPStatus.BAD_REQUEST, "Invalid request")
            return

        response = mcp_stdio.handle_mcp_request(request)
        method = str(request.get("method", ""))
        tool = str((request.get("params") or {}).get("name") or method or "notification")
        success = response is None or "error" not in response
        error = "" if success else str((response.get("error") or {}).get("message", "error"))
        if response is None:
            self._send_no_content()
            self._audit(start, method, tool, success, HTTPStatus.NO_CONTENT, error)
            return
        self._send_json(HTTPStatus.OK, response)
        self._audit(start, method, tool, success, HTTPStatus.OK, error)


def main() -> int:
    config = load_remote_config()
    parser = argparse.ArgumentParser(description="HTTP wrapper for the read-only Zabbix infrastructure MCP server")
    default_host = config.get("MCP_BIND_HOST") or config.get("MCP_INFRA_AGENT_HOST") or DEFAULT_HOST
    default_port = int(config.get("MCP_BIND_PORT") or config.get("MCP_INFRA_AGENT_PORT") or DEFAULT_PORT)
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--port", type=int, default=default_port)
    parser.add_argument("--require-bearer-token", action="store_true", help="Require Authorization: Bearer <token>")
    args = parser.parse_args()

    token = config.get("MCP_SHARED_TOKEN") or config.get("MCP_INFRA_AGENT_BEARER_TOKEN")
    require_auth = args.require_bearer_token or bool_value(config.get("MCP_REQUIRE_AUTH"), False) or bool(token)
    audit_enabled = bool_value(config.get("MCP_ENABLE_AUDIT"), True)
    audit_log = Path(config.get("MCP_AUDIT_LOG") or AUDIT_LOG_FILE)

    if not is_loopback(args.host) and not require_auth:
        print(
            "ERROR: refusing to bind outside localhost without auth enabled",
            file=sys.stderr,
        )
        return 2
    if require_auth and not token:
        print("ERROR: auth requested but MCP_SHARED_TOKEN is not set", file=sys.stderr)
        return 2

    httpd = InfraMcpHttpServer((args.host, args.port), Handler, token, require_auth, audit_enabled, audit_log)
    print(
        f"{SERVER_NAME} listening on http://{args.host}:{args.port}/mcp read_only=true auth_required={require_auth} audit_enabled={audit_enabled}",
        file=sys.stderr,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
