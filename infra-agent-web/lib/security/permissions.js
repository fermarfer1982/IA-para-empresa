export const ROLES = ["admin", "operator", "viewer", "display", "powerbi", "auditor"];

export const PERMISSIONS = [
  "dashboard:view",
  "agent:ask",
  "zabbix:read",
  "zabbix:action",
  "powerbi:query",
  "display:view",
  "reports:view",
  "audit:view",
  "admin:manage"
];

const ROLE_PERMISSIONS = {
  admin: PERMISSIONS,
  operator: [
    "dashboard:view",
    "agent:ask",
    "zabbix:read",
    "zabbix:action",
    "display:view",
    "reports:view"
  ],
  viewer: [
    "dashboard:view",
    "agent:ask",
    "zabbix:read",
    "display:view",
    "reports:view"
  ],
  display: ["display:view"],
  powerbi: ["dashboard:view", "agent:ask", "powerbi:query", "display:view", "reports:view"],
  auditor: ["dashboard:view", "zabbix:read", "display:view", "reports:view", "audit:view"]
};

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

export function permissionsForRoles(roles) {
  return unique(
    (Array.isArray(roles) ? roles : []).flatMap((role) => ROLE_PERMISSIONS[role] || [])
  );
}

export function hasPermission(userOrPermissions, permission) {
  const permissions = Array.isArray(userOrPermissions)
    ? userOrPermissions
    : Array.isArray(userOrPermissions?.permissions)
      ? userOrPermissions.permissions
      : [];
  return permissions.includes(permission);
}

export function isKnownPermission(permission) {
  return PERMISSIONS.includes(permission);
}

export function getRolePermissionMatrix() {
  return Object.fromEntries(
    ROLES.map((role) => [role, [...(ROLE_PERMISSIONS[role] || [])]])
  );
}
