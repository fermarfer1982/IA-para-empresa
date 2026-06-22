import { getSecurityConfig } from "./config";
import { permissionsForRoles, ROLES } from "./permissions";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function extractCnFromDn(value) {
  const text = String(value || "");
  const match = text.match(/(?:^|,)cn=([^,]+)/i);
  return match ? match[1] : text;
}

function groupMatches(userGroup, configuredGroup) {
  const userValue = normalize(userGroup);
  const configuredValue = normalize(configuredGroup);
  if (!userValue || !configuredValue) {
    return false;
  }
  if (userValue === configuredValue) {
    return true;
  }
  const userCn = normalize(extractCnFromDn(userGroup));
  const configuredCn = normalize(extractCnFromDn(configuredGroup));
  return Boolean(userCn && configuredCn && userCn === configuredCn);
}

export function mapAdGroupsToRoles(memberOf, config = getSecurityConfig()) {
  const groups = Array.isArray(memberOf) ? memberOf : [];
  const roles = ROLES.filter((role) => {
    const configuredGroup = config.ad.groups[role];
    return configuredGroup && groups.some((group) => groupMatches(group, configuredGroup));
  });
  const permissions = permissionsForRoles(roles);
  return { roles, permissions };
}

export function canLoginWithMappedRoles(memberOf, config = getSecurityConfig()) {
  const mapped = mapAdGroupsToRoles(memberOf, config);
  if (mapped.roles.length > 0) {
    return { allowed: true, ...mapped };
  }
  return {
    allowed: config.allowUnmappedUsers,
    roles: [],
    permissions: []
  };
}

export function sanitizeUserProfile(profile, mapped) {
  const id = String(profile.userPrincipalName || profile.sAMAccountName || "").trim();
  const username = String(profile.sAMAccountName || id || "").trim();
  const displayName = String(profile.displayName || username || id || "").trim();
  const email = String(profile.mail || profile.userPrincipalName || "").trim();

  return {
    id,
    userId: id,
    name: displayName,
    username,
    userPrincipalName: String(profile.userPrincipalName || "").trim(),
    displayName,
    email,
    roles: Array.isArray(mapped.roles) ? mapped.roles : [],
    permissions: Array.isArray(mapped.permissions) ? mapped.permissions : []
  };
}
