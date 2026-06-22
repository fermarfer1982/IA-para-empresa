const DEFAULT_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function text(value) {
  return String(value || "").trim();
}

function bool(value, fallback = false) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "si", "sí"].includes(normalized);
}

function productionDefault(value, developmentFallback = false) {
  if (value !== undefined) {
    return bool(value, developmentFallback);
  }
  return process.env.NODE_ENV === "production" ? true : developmentFallback;
}

export function getSecurityConfig() {
  return {
    authSecret: text(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
    rbacEnforce: productionDefault(process.env.SECURITY_RBAC_ENFORCE, false),
    allowUnmappedUsers: bool(process.env.SECURITY_ALLOW_UNMAPPED_USERS, false),
    allowPlainLdapInDevelopment: bool(process.env.SECURITY_ALLOW_PLAIN_LDAP_DEV, false),
    auditLogPath:
      text(process.env.SECURITY_AUDIT_LOG_PATH) ||
      "/var/log/zabbix-codex/infra-agent-web-audit.jsonl",
    loginRateLimitWindowMs: Number(process.env.SECURITY_LOGIN_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000),
    loginRateLimitMaxAttempts: Number(process.env.SECURITY_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5),
    sessionMaxAgeSeconds: Number(process.env.SECURITY_SESSION_MAX_AGE_SECONDS || DEFAULT_SESSION_MAX_AGE_SECONDS),
    ad: {
      url: text(process.env.AD_URL),
      baseDn: text(process.env.AD_BASE_DN),
      domain: text(process.env.AD_DOMAIN),
      upnSuffix: text(process.env.AD_UPN_SUFFIX),
      bindDn: text(process.env.AD_BIND_DN),
      bindPassword: text(process.env.AD_BIND_PASSWORD),
      searchFilter: text(process.env.AD_SEARCH_FILTER) || "(|(sAMAccountName={{username}})(userPrincipalName={{username}}))",
      groups: {
        admin: text(process.env.AD_GROUP_ADMIN),
        operator: text(process.env.AD_GROUP_OPERATOR),
        viewer: text(process.env.AD_GROUP_VIEWER),
        display: text(process.env.AD_GROUP_DISPLAY),
        powerbi: text(process.env.AD_GROUP_POWERBI),
        auditor: text(process.env.AD_GROUP_AUDITOR)
      }
    }
  };
}

export function isAuthConfigured(config = getSecurityConfig()) {
  return Boolean(
    config.authSecret &&
      config.ad.url &&
      config.ad.baseDn &&
      config.ad.bindDn &&
      config.ad.bindPassword
  );
}

export function validateSecurityStartupConfig(config = getSecurityConfig()) {
  const warnings = [];
  if (!config.authSecret) warnings.push("AUTH_SECRET no configurado.");
  if (!config.ad.url) warnings.push("AD_URL no configurado.");
  if (!config.ad.baseDn) warnings.push("AD_BASE_DN no configurado.");
  if (!config.ad.bindDn) warnings.push("AD_BIND_DN no configurado.");
  if (!config.ad.bindPassword) warnings.push("AD_BIND_PASSWORD no configurado.");
  if (config.ad.url && !config.ad.url.toLowerCase().startsWith("ldaps://")) {
    const allowPlain =
      config.allowPlainLdapInDevelopment ||
      String(process.env.SECURITY_ALLOW_PLAIN_LDAP_TEMP || "").toLowerCase() === "true";
    if (!allowPlain) {
      warnings.push("AD_URL debe usar LDAPS en producción.");
    }
  }
  return {
    ok: warnings.length === 0,
    warnings
  };
}

export function getPublicSecurityStatus(config = getSecurityConfig()) {
  const validation = validateSecurityStartupConfig(config);
  return {
    rbacEnforce: config.rbacEnforce,
    allowUnmappedUsers: config.allowUnmappedUsers,
    authConfigured: isAuthConfigured(config),
    ldapsConfigured: config.ad.url.toLowerCase().startsWith("ldaps://"),
    validation
  };
}
