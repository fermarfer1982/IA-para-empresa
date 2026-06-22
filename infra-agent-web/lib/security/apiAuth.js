import { getServerSession } from "next-auth/next";
import { authOptions } from "./authOptions";
import { getSecurityConfig } from "./config";
import { hasPermission } from "./permissions";
import { auditEvent, getRequestId } from "./auditLogger";

function responseJson(res, statusCode, body) {
  res.status(statusCode).json(body);
  return null;
}

export async function getRequestUser(req, res) {
  const session = await getServerSession(req, res, authOptions);
  return session?.user || null;
}

export async function requireAuth(req, res, options = {}) {
  const user = await getRequestUser(req, res);
  if (!user) {
    auditEvent({
      req,
      requestId: getRequestId(req),
      action: "access_denied",
      resource: options.resource || req.url || "api",
      allowed: false,
      details: { reason: "missing_session" }
    });
    return responseJson(res, 401, { ok: false, error: "No autenticado." });
  }
  return user;
}

export async function requirePermission(req, res, permission, options = {}) {
  const config = getSecurityConfig();
  const user = await requireAuth(req, res, options);
  if (!user) {
    return null;
  }

  const allowed = hasPermission(user, permission);
  auditEvent({
    req,
    user,
    requestId: getRequestId(req),
    action: options.action || "permission_check",
    resource: options.resource || req.url || "api",
    allowed,
    details: { permission, enforce: config.rbacEnforce }
  });

  if (!allowed && config.rbacEnforce) {
    return responseJson(res, 403, { ok: false, error: "Permiso insuficiente." });
  }

  return user;
}

export function withPermission(handler, permission, options = {}) {
  return async function securedHandler(req, res) {
    const user = await requirePermission(req, res, permission, options);
    if (!user) {
      return undefined;
    }
    req.security = { user };
    return handler(req, res);
  };
}
