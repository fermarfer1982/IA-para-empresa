import { getPublicSecurityStatus } from "../../lib/security/config";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const security = getPublicSecurityStatus();
  return res.status(200).json({
    ok: true,
    service: "infra-agent-web",
    generatedAt: new Date().toISOString(),
    security: {
      rbacEnforce: security.rbacEnforce,
      allowUnmappedUsers: security.allowUnmappedUsers,
      authConfigured: security.authConfigured,
      ldapsConfigured: security.ldapsConfigured,
      validationOk: security.validation.ok,
      warnings: security.validation.warnings.map((item) => item.replace(/AD_BIND_PASSWORD.*/, "AD_BIND_PASSWORD no configurado."))
    }
  });
}
