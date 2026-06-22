import fs from "fs";
import path from "path";
import { requestJson } from "./httpJson";

const PROJECT_ROOT = "/opt/zabbix-codex";
const ZABBIX_MCP_ENV = "/etc/zabbix-codex/mcp-agent.env";
const INCIDENTS_MCP_ENV = "/etc/zabbix-codex/incidents-ti-mcp.env";

const LOCAL_CONTEXT_FILES = [
  "agent_knowledge/global_infrastructure_map.json",
  "agent_knowledge/monitoring_gaps.json",
  "agent_knowledge/proxmox_backup_knowledge.json",
  "reports/zabbix-coverage-report.json",
  "reports/global-monitoring-readiness.md",
  "reports/proxmox-backup-gap-analysis.md"
];

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

function trimValue(value, maxChars = 9000) {
  if (value == null) {
    return value;
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function loadLocalContext() {
  const context = {};

  for (const relativePath of LOCAL_CONTEXT_FILES) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    try {
      const raw = fs.readFileSync(absolutePath, "utf8");
      context[relativePath] = trimValue(raw, 14000);
    } catch {
      context[relativePath] = null;
    }
  }

  return context;
}

function extractMcpText(result) {
  if (!result) {
    return null;
  }

  const content = result.content || result.result?.content;
  if (!Array.isArray(content)) {
    return result;
  }

  return content
    .map((entry) => entry?.text || "")
    .filter(Boolean)
    .join("\n");
}

async function callMcpTool(baseUrl, token, toolName, args = {}) {
  if (!baseUrl || !token) {
    return { ok: false, error: "MCP no configurado." };
  }

  const response = await requestJson(`${baseUrl.replace(/\/$/, "")}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    timeoutMs: 20000,
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
    return {
      ok: false,
      error: `HTTP ${response.statusCode}`
    };
  }

  if (response.body?.error) {
    return {
      ok: false,
      error: response.body.error?.message || "Error MCP."
    };
  }

  return {
    ok: true,
    data: trimValue(extractMcpText(response.body?.result), 12000)
  };
}

function mcpBaseUrlFromEnv(env, defaultPort) {
  const host = env.MCP_BIND_HOST || "127.0.0.1";
  const port = env.MCP_BIND_PORT || defaultPort;
  return `http://${host}:${port}`;
}

export async function buildReadOnlySnapshot(kind) {
  const zabbixEnv = readEnvFile(ZABBIX_MCP_ENV);
  const incidentsEnv = readEnvFile(INCIDENTS_MCP_ENV);
  const zabbixToken = zabbixEnv.MCP_SHARED_TOKEN;
  const incidentsToken = incidentsEnv.MCP_SHARED_TOKEN;

  const zabbixBaseUrl = mcpBaseUrlFromEnv(zabbixEnv, "8765");
  const incidentsBaseUrl = mcpBaseUrlFromEnv(incidentsEnv, "8766");

  const zabbixCalls = [
    ["get_infrastructure_overview", {}],
    ["get_active_problems", { limit: 50 }],
    ["get_critical_risks", {}],
    ["get_monitoring_gaps", { report_chars: 9000 }]
  ];

  const incidentCalls = [
    ["get_incidents_summary", { limit: 20 }],
    ["get_open_incidents", { limit: 25 }],
    ["get_recent_incidents", { days: 14, limit: 20 }]
  ];

  const [zabbixResults, incidentResults] = await Promise.all([
    Promise.all(
      zabbixCalls.map(async ([tool, args]) => [tool, await callMcpTool(zabbixBaseUrl, zabbixToken, tool, args)])
    ),
    Promise.all(
      incidentCalls.map(async ([tool, args]) => [
        tool,
        await callMcpTool(incidentsBaseUrl, incidentsToken, tool, args)
      ])
    )
  ]);

  return {
    generated_at: new Date().toISOString(),
    kind,
    mcp: {
      zabbix: Object.fromEntries(zabbixResults),
      incidents_ti: Object.fromEntries(incidentResults)
    },
    local_context: loadLocalContext()
  };
}
