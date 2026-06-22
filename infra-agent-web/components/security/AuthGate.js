import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useMemo } from "react";

const PUBLIC_PATHS = ["/login"];

const PAGE_PERMISSIONS = [
  { pattern: /^\/agent-display\b/, permission: "display:view" },
  { pattern: /^\//, permission: "dashboard:view" }
];

function routePermission(pathname) {
  const rule = PAGE_PERMISSIONS.find((item) => item.pattern.test(pathname || "/"));
  return rule?.permission || null;
}

function hasPermission(session, permission) {
  if (!permission) return true;
  return Array.isArray(session?.user?.permissions) && session.user.permissions.includes(permission);
}

function roleLabel(roles) {
  const values = Array.isArray(roles) ? roles : [];
  return values.length ? values.join(", ") : "sin rol";
}

export default function AuthGate({ children }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const pathname = router.pathname || "/";
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const requiredPermission = useMemo(() => routePermission(pathname), [pathname]);

  useEffect(() => {
    if (!isPublic && status === "unauthenticated") {
      const callbackUrl = router.asPath || "/";
      router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }, [isPublic, router, status]);

  if (isPublic) {
    return children;
  }

  if (status === "loading") {
    return (
      <main className="security-screen">
        <section className="security-panel">
          <p className="security-eyebrow">Seguridad</p>
          <h1>Validando sesión</h1>
          <p>Comprobando identidad y permisos del usuario.</p>
        </section>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="security-screen">
        <section className="security-panel">
          <p className="security-eyebrow">Acceso restringido</p>
          <h1>Inicia sesión</h1>
          <p>Redirigiendo al login corporativo.</p>
        </section>
      </main>
    );
  }

  if (!hasPermission(session, requiredPermission)) {
    return (
      <main className="security-screen">
        <section className="security-panel">
          <p className="security-eyebrow">RBAC</p>
          <h1>Permiso insuficiente</h1>
          <p>Tu cuenta no tiene el permiso requerido para esta vista.</p>
          <p className="security-meta">Permiso requerido: {requiredPermission || "desconocido"}</p>
          <button type="button" className="security-secondary-button" onClick={() => signOut({ callbackUrl: "/login" })}>
            Cerrar sesión
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      {children}
      <aside className="auth-user-badge" aria-label="Sesión activa">
        <span>{session.user.displayName || session.user.username || "Usuario"}</span>
        <strong>{roleLabel(session.user.roles)}</strong>
        <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
          Salir
        </button>
      </aside>
    </>
  );
}
