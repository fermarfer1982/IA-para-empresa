const assert = require("assert");
const jiti = require("jiti")(__filename);

const { hasPermission, permissionsForRoles } = jiti("../../lib/security/permissions.js");

const adminPermissions = permissionsForRoles(["admin"]);
assert(adminPermissions.includes("admin:manage"), "admin debe gestionar administracion");
assert(adminPermissions.includes("powerbi:query"), "admin debe consultar Power BI");

const viewer = { roles: ["viewer"], permissions: permissionsForRoles(["viewer"]) };
assert(hasPermission(viewer, "dashboard:view"), "viewer debe ver dashboard");
assert(!hasPermission(viewer, "zabbix:action"), "viewer no debe ejecutar acciones Zabbix");

const display = { roles: ["display"], permissions: permissionsForRoles(["display"]) };
assert(hasPermission(display, "display:view"), "display debe ver agent-display");
assert(!hasPermission(display, "agent:ask"), "display no debe preguntar al agente");

const unknown = { roles: ["unknown"], permissions: permissionsForRoles(["unknown"]) };
assert(!hasPermission(unknown, "dashboard:view"), "roles desconocidos no deben tener permisos");

console.log("permissions.test.js OK");
