import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/health"
];

const API_PERMISSION_RULES = [
  { pattern: /^\/api\/agent-display\/powerbi-query\b/, permission: "powerbi:query" },
  { pattern: /^\/api\/agent-display\b/, permission: "display:view" },
  { pattern: /^\/api\/powerbi\b/, permission: "powerbi:query" },
  { pattern: /^\/api\/reports\b/, permission: "reports:view" },
  { pattern: /^\/api\/export\b/, permission: "reports:view" },
  { pattern: /^\/api\/analytics\b/, permission: "reports:view" },
  { pattern: /^\/api\/structured\b/, permission: "reports:view" },
  { pattern: /^\/api\/dashboard\b/, permission: "dashboard:view" },
  { pattern: /^\/api\/infrastructure\b/, permission: "zabbix:read" },
  { pattern: /^\/api\/ops\b/, permission: "agent:ask" },
  { pattern: /^\/api\/voice\b/, permission: "agent:ask" },
  { pattern: /^\/api\/realtime\b/, permission: "agent:ask" },
  { pattern: /^\/api\/admin\b/, permission: "admin:manage" },
  { pattern: /^\/api\/zabbix\b/, permission: "zabbix:read" }
];

const PAGE_PERMISSION_RULES = [
  { pattern: /^\/agent-display\b/, permission: "display:view" },
  { pattern: /^\//, permission: "dashboard:view" }
];

function bool(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "si", "sí"].includes(normalized);
}

function isPublic(pathname) {
  return PUBLIC_PATHS.some((item) => pathname === item || pathname.startsWith(`${item}/`));
}

function ruleFor(pathname) {
  const rules = pathname.startsWith("/api/") ? API_PERMISSION_RULES : PAGE_PERMISSION_RULES;
  return rules.find((rule) => rule.pattern.test(pathname)) || null;
}

function hasPermission(token, permission) {
  return Array.isArray(token?.permissions) && token.permissions.includes(permission);
}

function json(status, body) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function isInternalJobAllowed(req, pathname) {
  if (pathname !== "/api/dashboard/run-daily-report") {
    return false;
  }
  const expected = String(process.env.INTERNAL_JOB_TOKEN || process.env.DAILY_DASHBOARD_TOKEN || "").trim();
  if (!expected) {
    return false;
  }
  const headerToken = String(
    req.headers.get("x-internal-job-token") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      ""
  ).trim();
  return headerToken.length >= 32 && headerToken === expected;
}

function b64urlToBytes(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function b64urlToText(input) {
  return new TextDecoder().decode(b64urlToBytes(input));
}

async function verifyCustomSessionJwt(rawToken, secret) {
  try {
    if (!rawToken || !secret) return null;
    const parts = String(rawToken).split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(secret)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(signature),
      new TextEncoder().encode(data)
    );

    if (!valid) return null;

    const parsed = JSON.parse(b64urlToText(payload));
    if (parsed.exp && Math.floor(Date.now() / 1000) > Number(parsed.exp)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("[security-custom-token-read-error]", {
      error: "No se pudo validar la sesión custom."
    });
    return null;
  }
}

async function readSessionToken(req) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

  try {
    const standard = await getToken({ req, secret });
    if (standard) return standard;
  } catch (error) {
    console.warn("[security-token-read-error]", {
      path: req.nextUrl.pathname,
      error: "No se pudo validar la sesión estándar."
    });
  }

  const rawToken =
    req.cookies.get("next-auth.session-token")?.value ||
    req.cookies.get("__Secure-next-auth.session-token")?.value;

  return verifyCustomSessionJwt(rawToken, secret);
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname) || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (isInternalJobAllowed(req, pathname)) {
    return NextResponse.next();
  }

  const token = await readSessionToken(req);

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return json(401, { ok: false, error: "No autenticado." });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const rule = ruleFor(pathname);
  if (!rule) {
    return NextResponse.next();
  }

  const allowed = hasPermission(token, rule.permission);
  const enforce = bool(process.env.SECURITY_RBAC_ENFORCE, process.env.NODE_ENV === "production");
  if (!allowed) {
    console.warn("[security-rbac-denied]", {
      path: pathname,
      permission: rule.permission,
      enforce,
      user: token.userPrincipalName || token.email || token.username || "unknown"
    });
    if (enforce) {
      if (pathname.startsWith("/api/")) {
        return json(403, { ok: false, error: "Permiso insuficiente." });
      }
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("forbidden", "1");
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|avatar/).*)"
  ]
};
