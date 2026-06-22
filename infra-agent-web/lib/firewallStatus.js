import fs from "fs";
import path from "path";
import { getActiveProblems } from "./zabbixLiveClient";

const PROJECT_ROOT = "/opt/zabbix-codex";
const GLOBAL_MAP_PATH = path.join(PROJECT_ROOT, "agent_knowledge", "global_infrastructure_map.json");
const INFRA_SUMMARY_PATH = path.join(PROJECT_ROOT, "agent_knowledge", "infrastructure_summary.json");
const MONITORING_GAPS_PATH = path.join(PROJECT_ROOT, "agent_knowledge", "monitoring_gaps.json");

const FIREWALL_KEYWORDS = [
  "firewall",
  "firewalls",
  "pfSense",
  "fortigate",
  "fortinet",
  "mikrotik",
  "pfsense",
  "opnsense",
  "sonicwall",
  "checkpoint",
  "palo alto",
  "paloalto",
  "sophos",
  "red perimetral"
];

function readJson(pathname) {
  try {
    if (!fs.existsSync(pathname)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueStrings(values, limit = 12) {
  const seen = new Set();
  const result = [];
  for (const raw of values.flat ? values.flat() : values) {
    const text = String(raw || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function isFirewallHost(host) {
  const text = normalizeText(
    [
      host?.host,
      host?.visible_name,
      host?.classification_reason,
      host?.subtype,
      ...(host?.groups || []),
      ...(host?.templates || []),
      ...(host?.ip_dns || []).map((iface) => `${iface?.ip || ""} ${iface?.dns || ""}`),
      JSON.stringify(host?.inventory || {})
    ].join(" ")
  );
  return FIREWALL_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)));
}

export function getFirewallInventory() {
  const map = readJson(GLOBAL_MAP_PATH);
  const section = map?.sections?.["Firewalls / Red perimetral"] || map?.sections?.["Firewalls/routers"] || null;
  const hosts = Array.isArray(section?.hosts) ? section.hosts : [];
  const firewallHosts =
    Array.isArray(map?.hosts)
      ? map.hosts.filter((host) => host?.probable_type === "firewall" || isFirewallHost(host))
      : [];

  const dedupedHosts = uniqueStrings([...hosts, ...firewallHosts.map((host) => host?.host || host?.visible_name)], 20);
  const generatedAt = map?.metadata?.generated_at || null;
  const source = "agent_knowledge/global_infrastructure_map.json";

  if (!map) {
    return {
      ok: false,
      count: 0,
      hosts: [],
      source,
      generatedAt: null,
      reason: "Archivo de mapa global no disponible."
    };
  }

  if (!section) {
    return {
      ok: false,
      count: 0,
      hosts: [],
      source,
      generatedAt,
      reason: "La categoría Firewalls / Red perimetral no existe en el mapa cargado."
    };
  }

  return {
    ok: true,
    count: firewallHosts.length || dedupedHosts.length,
    hosts: dedupedHosts.length ? dedupedHosts : firewallHosts.map((host) => host?.host || host?.visible_name).filter(Boolean),
    source,
    generatedAt,
    category: "Firewalls / Red perimetral",
    block: "Firewalls / Red perimetral",
    section
  };
}

export function getFirewallMonitoringGaps() {
  const gaps = readJson(MONITORING_GAPS_PATH);
  const firewallGaps = [];

  for (const gap of Array.isArray(gaps?.gaps) ? gaps.gaps : []) {
    if (
      normalizeText(gap?.asset_type) === "firewall" ||
      normalizeText(gap?.block) === "firewalls / red perimetral" ||
      normalizeText(gap?.block) === "firewalls/routers" ||
      normalizeText(gap?.description).includes("firewall") ||
      normalizeText(gap?.host).includes("pfsense")
    ) {
      firewallGaps.push({
        host: gap?.host || "",
        asset_type: gap?.asset_type || "firewall",
        missing_check: gap?.missing_check || "",
        description: gap?.description || "",
        priority: gap?.priority || "medium",
        requires_human_action: Boolean(gap?.requires_human_action),
        can_automate: Boolean(gap?.can_automate)
      });
    }
  }

  return {
    ok: Boolean(gaps),
    generatedAt: gaps?.metadata?.generated_at || null,
    count: firewallGaps.length,
    gaps: firewallGaps,
    source: "agent_knowledge/monitoring_gaps.json"
  };
}

export async function getFirewallActiveProblems({ limit = 20 } = {}) {
  const result = await getActiveProblems({ limit: Math.max(1, Math.min(Number(limit) || 20, 50)) });
  if (!result.ok) {
    return {
      ok: false,
      source: "Zabbix / Monitorización",
      items: [],
      summary: result.error || "No se pudieron consultar problemas activos.",
      total: 0
    };
  }

  const inventory = getFirewallInventory();
  const hosts = inventory.hosts || [];
  const hostPatterns = hosts.flatMap((host) => [host, String(host || "").split(".")[0]]);
  const filtered = (result.items || []).filter((item) => {
    const haystack = normalizeText([item?.title, item?.detail, item?.source].join(" "));
    return FIREWALL_KEYWORDS.some((keyword) => haystack.includes(normalizeText(keyword))) ||
      hostPatterns.some((host) => host && haystack.includes(normalizeText(host)));
  });

  return {
    ok: true,
    source: "Zabbix / Monitorización",
    summary: filtered.length
      ? `Hay ${filtered.length} problemas activos relacionados con firewalls o red perimetral.`
      : "No hay problemas activos filtrados específicamente para firewalls.",
    total: filtered.length,
    generatedAt: new Date().toISOString(),
    items: filtered.slice(0, limit)
  };
}

export async function getFirewallStatus({ limit = 20 } = {}) {
  const inventory = getFirewallInventory();
  const gaps = getFirewallMonitoringGaps();
  const activeProblems = await getFirewallActiveProblems({ limit });

  return {
    ok: inventory.ok,
    count: inventory.count,
    hosts: inventory.hosts,
    source: inventory.source,
    generatedAt: inventory.generatedAt || activeProblems.generatedAt || new Date().toISOString(),
    category: inventory.category || "Firewalls / Red perimetral",
    gaps: gaps.gaps || [],
    activeProblems: activeProblems.items || [],
    summary: {
      count: inventory.count,
      activeProblems: activeProblems.total || 0,
      gaps: (gaps.gaps || []).length,
      status: activeProblems.total
        ? "warning"
        : (gaps.gaps || []).length
          ? "warning"
          : "ok"
    },
    reason: inventory.reason || null
  };
}
