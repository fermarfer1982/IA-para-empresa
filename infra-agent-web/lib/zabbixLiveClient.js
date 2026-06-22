import fs from "fs";
import { requestJson } from "./httpJson";

const ZABBIX_MCP_ENV = "/etc/zabbix-codex/mcp-agent.env";

function readEnvFile(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .reduce((env, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return env;
        }
        const index = trimmed.indexOf("=");
        if (index === -1) {
          return env;
        }
        const key = trimmed.slice(0, index).trim();
        const value = trimmed
          .slice(index + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        env[key] = value;
        return env;
      }, {});
  } catch {
    return {};
  }
}

function mcpBaseUrlFromEnv(env, defaultPort) {
  const host = env.MCP_BIND_HOST || "127.0.0.1";
  const port = env.MCP_BIND_PORT || defaultPort;
  return `http://${host}:${port}`;
}

function extractMcpText(result) {
  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  const content = result.content || result.result?.content;
  if (Array.isArray(content)) {
    return content.map((entry) => entry?.text || "").filter(Boolean).join("\n");
  }

  if (typeof result.text === "string") {
    return result.text;
  }

  return "";
}

function tryParseJson(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeLines(text, limit = 8) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d+$/.test(line))
    .slice(0, limit);
}

function normalizeProblemItem(item, fallbackSource = "zabbix") {
  if (!item) {
    return null;
  }

  if (typeof item === "string") {
    return {
      title: item,
      detail: "",
      priority: "unknown",
      source: fallbackSource
    };
  }

  return {
    title: String(item.title || item.asset_or_service || item.name || item.host || "").trim(),
    detail: String(item.detail || item.description || item.impact || item.evidence || item.problem || "").trim(),
    priority: String(item.priority || item.severity || item.level || "unknown").trim(),
    source: String(item.source || fallbackSource).trim()
  };
}

async function callMcpTool(toolName, args = {}) {
  const env = readEnvFile(ZABBIX_MCP_ENV);
  const token = env.MCP_SHARED_TOKEN;
  const baseUrl = mcpBaseUrlFromEnv(env, "8765");

  if (!baseUrl || !token) {
    return { ok: false, error: "MCP Zabbix no configurado." };
  }

  const response = await requestJson(`${baseUrl.replace(/\/$/, "")}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    timeoutMs: 25000,
    body: {
      jsonrpc: "2.0",
      id: `${toolName}-${Date.now()}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { ok: false, error: `HTTP ${response.statusCode}` };
  }

  if (response.body?.error) {
    return {
      ok: false,
      error: response.body.error?.message || "Error MCP Zabbix."
    };
  }

  const rawText = extractMcpText(response.body?.result);
  const parsed = tryParseJson(rawText);
  return {
    ok: true,
    raw: rawText,
    data: parsed || rawText
  };
}

function extractItems(payload, keys = ["problems", "risks", "gaps", "items", "value"]) {
  if (!payload) {
    return [];
  }

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (typeof payload === "string") {
    return summarizeLines(payload).map((line) => ({ title: line }));
  }

  if (typeof payload === "object") {
    const candidate = payload.data || payload.text || payload.summary || "";
    if (typeof candidate === "string") {
      return summarizeLines(candidate).map((line) => ({ title: line }));
    }
  }

  return [];
}

export async function getActiveProblems({ limit = 10 } = {}) {
  const result = await callMcpTool("get_active_problems", {
    limit: Math.max(1, Math.min(Number(limit) || 10, 100))
  });
  if (!result.ok) {
    return result;
  }

  const payload = result.data || {};
  const items = extractItems(payload, ["problems", "items", "value"])
    .map((item) => normalizeProblemItem(item, "zabbix"))
    .filter(Boolean)
    .slice(0, limit);

  return {
    ok: true,
    source: "Zabbix / Monitorización",
    summary: String(payload.summary || payload.text || payload.message || result.raw || "").trim(),
    total: Number(payload.total || items.length || 0),
    ordering: "live read",
    items
  };
}

export async function getCriticalRisks({ limit = 10 } = {}) {
  const result = await callMcpTool("get_critical_risks", {});
  if (!result.ok) {
    return result;
  }

  const payload = result.data || {};
  const items = extractItems(payload, ["risks", "items", "value"])
    .map((item) => normalizeProblemItem(item, "zabbix"))
    .filter(Boolean)
    .slice(0, limit);

  return {
    ok: true,
    source: "Zabbix / Monitorización",
    summary: String(payload.summary || payload.text || payload.message || result.raw || "").trim(),
    ordering: "live read",
    items
  };
}

export async function getLatestProblems({ limit = 10 } = {}) {
  const active = await getActiveProblems({ limit });
  if (!active.ok) {
    return active;
  }
  return {
    ok: true,
    source: "Zabbix / Monitorización",
    summary: active.summary,
    ordering: active.ordering,
    items: active.items.slice(0, limit)
  };
}

