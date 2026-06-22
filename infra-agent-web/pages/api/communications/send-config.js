function text(value) {
  return String(value || "").trim();
}

function parseAllowedDomains(value) {
  return text(value)
    .split(/[,\s;]+/)
    .map((domain) => domain.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  return res.status(200).json({
    ok: true,
    allowed_domains: parseAllowedDomains(process.env.EMAIL_ALLOWED_DOMAINS),
    from_user_configured: Boolean(text(process.env.GRAPH_MAIL_FROM_USER))
  });
}
