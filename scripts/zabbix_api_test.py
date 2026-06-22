#!/usr/bin/env python3
"""Validate Zabbix API connectivity using /etc/zabbix-codex/zabbix.env."""

from __future__ import annotations

import json
import os
import re
import ssl
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


ENV_FILE = Path("/etc/zabbix-codex/zabbix.env")
TIMEOUT_SECONDS = 10


class ApiError(RuntimeError):
    """Raised for JSON-RPC level errors."""


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        raise FileNotFoundError(f"Environment file not found: {path}")

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        line = re.sub(r"^export\s+", "", line)
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        values[key] = value

    return values


def sanitize_url(url: str) -> str:
    parts = urlsplit(url)
    hostname = parts.hostname or ""
    netloc = hostname

    if parts.port is not None:
        netloc = f"{netloc}:{parts.port}"

    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def api_url_from_env(raw_url: str) -> str:
    url = raw_url.rstrip("/")
    if not url:
        raise ValueError("ZABBIX_URL is empty")

    if url.endswith("api_jsonrpc.php"):
        return url

    return f"{url}/api_jsonrpc.php"


def tls_context(env: dict[str, str]) -> ssl.SSLContext | None:
    verify = env.get("ZABBIX_VERIFY_TLS", "true").strip().lower()
    if verify in {"0", "false", "no", "off"}:
        return ssl._create_unverified_context()

    return None


def json_rpc(
    url: str,
    method: str,
    params: dict[str, Any] | list[Any] | None = None,
    token: str | None = None,
    context: ssl.SSLContext | None = None,
) -> Any:
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params if params is not None else {},
        "id": 1,
    }

    headers = {
        "Content-Type": "application/json-rpc",
        "User-Agent": "zabbix-codex-api-test/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS, context=context) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP error {exc.code}: {body[:300]}") from exc
    except URLError as exc:
        raise RuntimeError(f"Connection error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError(f"Connection timed out after {TIMEOUT_SECONDS}s") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON response: {exc}") from exc

    if "error" in data:
        error = data["error"]
        message = error.get("message", "JSON-RPC error")
        details = error.get("data", "")
        if details:
            raise ApiError(f"{message}: {details}")
        raise ApiError(message)

    return data.get("result")


def main() -> int:
    try:
        env = load_env(ENV_FILE)
        url = api_url_from_env(env.get("ZABBIX_URL", ""))
        token = env.get("ZABBIX_TOKEN", "")

        if not token:
            raise ValueError("ZABBIX_TOKEN is empty or missing")

        context = tls_context(env)

        version = json_rpc(url, "apiinfo.version", context=context)
        host_sample = json_rpc(
            url,
            "host.get",
            {"output": ["hostid", "host"], "limit": 1},
            token=token,
            context=context,
        )

        print(f"Zabbix API URL: {sanitize_url(url)}")
        print(f"Zabbix version: {version}")
        print(f"Token loaded: yes (length={len(token)}, value not printed)")
        print(f"Token validation: OK (host.get returned {len(host_sample)} sample host(s))")
        return 0
    except PermissionError as exc:
        print(f"ERROR: Permission denied reading {ENV_FILE}: {exc}", file=sys.stderr)
        print("Hint: run with sudo or adjust /etc/zabbix-codex permissions.", file=sys.stderr)
    except (FileNotFoundError, ValueError, RuntimeError, ApiError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)

    return 1


if __name__ == "__main__":
    sys.exit(main())
