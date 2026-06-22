import crypto from "crypto";
import CredentialsProvider from "next-auth/providers/credentials";
import { authenticateWithActiveDirectory } from "./adLdapClient";
import { getSecurityConfig, validateSecurityStartupConfig } from "./config";
import { canLoginWithMappedRoles, sanitizeUserProfile } from "./roleMapping";
import { auditEvent } from "./auditLogger";
import { checkLoginRateLimit, clearLoginRateLimit } from "./rateLimit";

function requestIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req?.socket?.remoteAddress || "";
}

function sanitizeUsername(value) {
  return String(value || "").trim().slice(0, 160);
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function hmacSha256(data, secret) {
  return crypto.createHmac("sha256", String(secret || ""))
    .update(data)
    .digest();
}

async function encodeSessionJwt({ token, secret, maxAge }) {
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET/AUTH_SECRET no configurado.");
  }

  const now = Math.floor(Date.now() / 1000);
  const lifetime = Number(maxAge || 8 * 60 * 60);
  const payload = {
    ...(token || {}),
    iat: now,
    exp: now + lifetime
  };

  const header = { alg: "HS256", typ: "JWT" };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(hmacSha256(data, secret));
  return `${data}.${signature}`;
}

async function decodeSessionJwt({ token, secret }) {
  try {
    if (!token || !secret) return null;
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;
    const expected = hmacSha256(data, secret);
    const received = b64urlDecode(signature);

    if (expected.length !== received.length) return null;
    if (!crypto.timingSafeEqual(expected, received)) return null;

    const parsed = JSON.parse(b64urlDecode(payload).toString("utf8"));
    if (parsed.exp && Math.floor(Date.now() / 1000) > Number(parsed.exp)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("[auth-warning] decodeSessionJwt fallo", {
      message: error?.message || String(error)
    });
    return null;
  }
}

function safeAuditEvent(payload) {
  try {
    return auditEvent(payload);
  } catch (error) {
    console.warn("[audit-warning]", {
      message: error?.message || String(error)
    });
    return null;
  }
}

export function buildAuthOptions() {
  const config = getSecurityConfig();
  const validation = validateSecurityStartupConfig(config);
  if (!validation.ok) {
    console.warn("[security-config-warning]", {
      warnings: validation.warnings
    });
  }

  return {
    secret: config.authSecret,
    session: {
      strategy: "jwt",
      maxAge: config.sessionMaxAgeSeconds
    },
    jwt: {
      encode: encodeSessionJwt,
      decode: decodeSessionJwt
    },
    pages: {
      signIn: "/login"
    },
    providers: [
      CredentialsProvider({
        id: "active-directory",
        name: "Active Directory",
        credentials: {
          username: { label: "Usuario", type: "text" },
          password: { label: "Contraseña", type: "password" }
        },
        async authorize(credentials, req) {
          const username = sanitizeUsername(credentials?.username);
          const password = String(credentials?.password || "");
          const ip = requestIp(req);
          const rate = checkLoginRateLimit({
            username,
            ip,
            windowMs: config.loginRateLimitWindowMs,
            maxAttempts: config.loginRateLimitMaxAttempts
          });

          if (!rate.allowed) {
            safeAuditEvent({
              req,
              action: "login_failed",
              resource: "auth:active-directory",
              allowed: false,
              details: { reason: "rate_limited", username }
            });
            throw new Error("Demasiados intentos de login. Espera unos minutos.");
          }

          try {
            console.warn("[auth-debug] authorize:start", { username });
            const profile = await authenticateWithActiveDirectory(username, password, { config });
            console.warn("[auth-debug] ldap:ok", {
              username: profile?.sAMAccountName,
              userPrincipalName: profile?.userPrincipalName,
              memberOfCount: Array.isArray(profile?.memberOf) ? profile.memberOf.length : 0
            });
            const mapped = canLoginWithMappedRoles(profile.memberOf, config);
            console.warn("[auth-debug] roles:mapped", {
              allowed: mapped.allowed,
              roles: mapped.roles || []
            });
            if (!mapped.allowed) {
              safeAuditEvent({
                req,
                action: "login_failed",
                resource: "auth:active-directory",
                allowed: false,
                details: { reason: "no_allowed_ad_group", username }
              });
              const denial = new Error("Usuario sin grupo autorizado.");
              denial.auditLogged = true;
              throw denial;
            }

            const user = sanitizeUserProfile(profile, mapped);
            clearLoginRateLimit({ username, ip });
            safeAuditEvent({
              req,
              user,
              action: "login_success",
              resource: "auth:active-directory",
              allowed: true,
              details: { username: user.username }
            });
            return user;
          } catch (error) {
            console.warn("[auth-debug] authorize:error", {
              message: error?.message || String(error),
              name: error?.name,
              code: error?.code
            });
            if (!error?.auditLogged) {
              safeAuditEvent({
                req,
                action: "login_failed",
                resource: "auth:active-directory",
                allowed: false,
                details: { reason: error?.message || "invalid_credentials", username }
              });
            }
            throw new Error("Login no válido.");
          }
        }
      })
    ],
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          console.warn("[auth-debug] jwt:user", {
            id: user.id,
            username: user.username,
            email: user.email,
            roles: user.roles || []
          });

          token.userId = String(user.userId || user.id || "");
          token.sub = String(user.userId || user.id || "");
          token.name = String(user.name || user.displayName || user.username || "");
          token.username = String(user.username || "");
          token.userPrincipalName = String(user.userPrincipalName || "");
          token.displayName = String(user.displayName || user.name || user.username || "");
          token.email = String(user.email || "");
          token.roles = Array.isArray(user.roles) ? user.roles : [];
          token.permissions = Array.isArray(user.permissions) ? user.permissions : [];
        }
        return token;
      },
      async session({ session, token }) {
        session.user = {
          id: String(token.userId || token.sub || ""),
          userId: String(token.userId || token.sub || ""),
          name: String(token.name || token.displayName || token.username || ""),
          username: String(token.username || ""),
          userPrincipalName: String(token.userPrincipalName || ""),
          displayName: String(token.displayName || token.name || ""),
          email: String(token.email || ""),
          roles: Array.isArray(token.roles) ? token.roles : [],
          permissions: Array.isArray(token.permissions) ? token.permissions : []
        };
        return session;
      }
    },
    events: {
      async signOut({ token }) {
        safeAuditEvent({
          user: token,
          action: "logout",
          resource: "auth:session",
          allowed: true
        });
      }
    }
  };
}

export const authOptions = buildAuthOptions();
