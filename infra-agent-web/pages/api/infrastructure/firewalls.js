import { getFirewallStatus } from "../../../lib/firewallStatus";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  try {
    const status = await getFirewallStatus({ limit: 20 });
    return res.status(200).json({
      ok: true,
      count: status.count || 0,
      hosts: status.hosts || [],
      source: status.source || "agent_knowledge/global_infrastructure_map.json",
      generatedAt: status.generatedAt || new Date().toISOString(),
      category: status.category || "Firewalls / Red perimetral",
      block: "Firewalls / Red perimetral",
      gaps: status.gaps || [],
      activeProblems: status.activeProblems || [],
      summary: status.summary || {},
      reason: status.reason || null
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      count: 0,
      hosts: [],
      source: "agent_knowledge/global_infrastructure_map.json",
      generatedAt: new Date().toISOString(),
      category: "Firewalls / Red perimetral",
      block: "Firewalls / Red perimetral",
      gaps: [],
      activeProblems: [],
      reason: error?.message || "No se pudo leer el estado de firewalls."
    });
  }
}
