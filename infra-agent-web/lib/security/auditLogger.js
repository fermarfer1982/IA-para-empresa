import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getSecurityConfig } from "./config";

function requestIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req?.socket?.remoteAddress || "";
}

function safeString(value, maxLength = 300) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/access_token[=:][^\s&]+/gi, "access_token=[redacted]")
    .replace(/client_secret[=:][^\s&]+/gi, "client_secret=[redacted]")
    .slice(0, maxLength);
}

function safeDetails(details) {
  if (!details || typeof details !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !/password|secret|token|cookie|authorization|connection/i.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? safeString(value) : value])
  );
}

function fallbackRequestId() {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getRequestId(req) {
  const existing = req?.headers?.["x-request-id"];
  if (safeString(existing, 80)) {
    return safeString(existing, 80);
  }

  try {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (error) {
    console.warn("[security-audit] crypto.randomUUID fallo, usando fallback", {
      error: safeString(error?.message, 120)
    });
  }

  return fallbackRequestId();
}

export function auditEvent({
  req = null,
  requestId = null,
  user = null,
  action,
  resource = "",
  allowed = false,
  details = {}
}) {
  const config = getSecurityConfig();
  const event = {
    timestamp: new Date().toISOString(),
    requestId: requestId || getRequestId(req),
    user: user?.userPrincipalName || user?.email || user?.username || user?.userId || "anonymous",
    roles: Array.isArray(user?.roles) ? user.roles : [],
    action: safeString(action, 120),
    resource: safeString(resource, 220),
    allowed: Boolean(allowed),
    ip: requestIp(req),
    userAgent: safeString(req?.headers?.["user-agent"], 240),
    details: safeDetails(details)
  };

  try {
    fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
    fs.appendFileSync(config.auditLogPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.warn("[security-audit] no se pudo escribir auditoria", {
      action: event.action,
      resource: event.resource,
      allowed: event.allowed,
      error: safeString(error?.message, 120)
    });
  }

  return event;
}
