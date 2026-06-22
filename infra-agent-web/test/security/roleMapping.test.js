const assert = require("assert");
const jiti = require("jiti")(__filename);

const { canLoginWithMappedRoles, mapAdGroupsToRoles, sanitizeUserProfile } = jiti("../../lib/security/roleMapping.js");

const config = {
  allowUnmappedUsers: false,
  ad: {
    groups: {
      admin: "CN=Infra Admins,OU=Groups,DC=example,DC=local",
      operator: "Infra Operators",
      viewer: "Infra Viewers",
      display: "Infra Display",
      powerbi: "Infra PowerBI",
      auditor: "Infra Auditors"
    }
  }
};

const groups = [
  "CN=Infra Admins,OU=Groups,DC=example,DC=local",
  "CN=Infra PowerBI,OU=Groups,DC=example,DC=local"
];

const mapped = mapAdGroupsToRoles(groups, config);
assert.deepStrictEqual(mapped.roles.sort(), ["admin", "powerbi"].sort(), "debe mapear DN completo y CN");
assert(mapped.permissions.includes("admin:manage"), "admin debe incluir permisos completos");
assert(canLoginWithMappedRoles(groups, config).allowed, "usuario con grupo permitido debe entrar");
assert(!canLoginWithMappedRoles([], config).allowed, "usuario sin grupo no debe entrar por defecto");

const permissiveConfig = { ...config, allowUnmappedUsers: true };
assert(canLoginWithMappedRoles([], permissiveConfig).allowed, "modo permisivo debe admitir sin grupos");

const profile = sanitizeUserProfile(
  {
    sAMAccountName: "jdoe",
    userPrincipalName: "jdoe@example.local",
    displayName: "John Doe",
    mail: "jdoe@example.local",
    memberOf: groups
  },
  mapped
);
assert.strictEqual(profile.username, "jdoe");
assert(profile.roles.includes("admin"));
assert(profile.permissions.includes("dashboard:view"));

console.log("roleMapping.test.js OK");
