import { Client } from "ldapts";
import { getSecurityConfig, validateSecurityStartupConfig } from "./config";

function text(value) {
  return String(value || "").trim();
}

function ldapEscape(value) {
  return text(value).replace(/[\0()*\\]/g, (char) => {
    if (char === "\0") return "\\00";
    if (char === "(") return "\\28";
    if (char === ")") return "\\29";
    if (char === "*") return "\\2a";
    if (char === "\\") return "\\5c";
    return char;
  });
}

function usernameParts(input, config) {
  const raw = text(input);
  const withoutDomain = raw.includes("\\") ? raw.split("\\").pop() : raw;
  const sam = withoutDomain.includes("@") ? withoutDomain.split("@")[0] : withoutDomain;
  const upn = withoutDomain.includes("@")
    ? withoutDomain
    : config.ad.upnSuffix
      ? `${sam}@${config.ad.upnSuffix}`
      : "";
  return { raw, sam, upn };
}

function normalizeMemberOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [text(value)].filter(Boolean);
}

function entryValue(entry, key) {
  const value = entry?.[key];
  if (Array.isArray(value)) return text(value[0]);
  return text(value);
}

function sanitizeLdapError(error) {
  const message = text(error?.message || error);
  if (/certificate|tls|ssl/i.test(message)) {
    return "No se pudo validar la conexión segura LDAPS.";
  }
  if (/invalid credentials|80090308|52e/i.test(message)) {
    return "Credenciales no válidas.";
  }
  if (/timeout|connect/i.test(message)) {
    return "No se pudo conectar con Active Directory.";
  }
  return "No se pudo validar el usuario en Active Directory.";
}

function buildSearchFilter(template, parts) {
  return template
    .replaceAll("{{username}}", ldapEscape(parts.raw))
    .replaceAll("{{samAccountName}}", ldapEscape(parts.sam))
    .replaceAll("{{userPrincipalName}}", ldapEscape(parts.upn || parts.raw));
}

function createClient(config) {
  return new Client({
    url: config.ad.url,
    timeout: 8000,
    connectTimeout: 5000
  });
}

export async function authenticateWithActiveDirectory(username, password, options = {}) {
  const config = options.config || getSecurityConfig();
  const validation = validateSecurityStartupConfig(config);
  if (!validation.ok) {
    throw new Error("Active Directory no está configurado para login.");
  }
  if (!text(username) || !text(password)) {
    throw new Error("Usuario o contraseña no válidos.");
  }
  if (!config.ad.url.toLowerCase().startsWith("ldaps://")) {
    const allowPlain =
      config.allowPlainLdapInDevelopment ||
      String(process.env.SECURITY_ALLOW_PLAIN_LDAP_TEMP || "").toLowerCase() === "true";
    if (!allowPlain) {
      throw new Error("LDAPS es obligatorio para autenticación Active Directory.");
    }
  }

  const parts = usernameParts(username, config);
  const filter = buildSearchFilter(config.ad.searchFilter, parts);
  const client = createClient(config);

  try {
    await client.bind(config.ad.bindDn, config.ad.bindPassword);
    const result = await client.search(config.ad.baseDn, {
      scope: "sub",
      filter,
      sizeLimit: 2,
      attributes: ["dn", "sAMAccountName", "userPrincipalName", "displayName", "mail", "memberOf"]
    });
    const entries = result.searchEntries || [];
    if (entries.length !== 1) {
      throw new Error(entries.length > 1 ? "Búsqueda AD ambigua." : "Usuario no encontrado.");
    }

    const entry = entries[0];
    const userDn = text(entry.dn);
    if (!userDn) {
      throw new Error("Usuario sin DN válido.");
    }

    await client.bind(userDn, password);

    return {
      dn: userDn,
      sAMAccountName: entryValue(entry, "sAMAccountName") || parts.sam,
      userPrincipalName: entryValue(entry, "userPrincipalName") || parts.upn,
      displayName: entryValue(entry, "displayName") || parts.sam,
      mail: entryValue(entry, "mail"),
      memberOf: normalizeMemberOf(entry.memberOf)
    };
  } catch (error) {
    throw new Error(sanitizeLdapError(error));
  } finally {
    await client.unbind().catch(() => {});
  }
}

export function __test__ldapEscape(value) {
  return ldapEscape(value);
}
