import { getCsrfToken, getSession, signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";

export async function getServerSideProps(context) {
  const session = await getSession(context);
  if (session?.user) {
    return {
      redirect: {
        destination: String(context.query?.callbackUrl || "/"),
        permanent: false
      }
    };
  }

  return {
    props: {
      csrfToken: await getCsrfToken(context)
    }
  };
}

export default function LoginPage({ csrfToken }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const callbackUrl = typeof router.query.callbackUrl === "string" ? router.query.callbackUrl : "/";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("active-directory", {
      username,
      password,
      redirect: false,
      callbackUrl
    });

    setLoading(false);
    if (result?.ok) {
      router.replace(result.url || callbackUrl);
      return;
    }
    setError("Credenciales no válidas o usuario sin grupo autorizado.");
  }

  return (
    <main className="security-login-page">
      <section className="security-login-card">
        <p className="security-eyebrow">Infra Agent Web · v0.21.0</p>
        <h1>Acceso corporativo</h1>
        <p>Inicia sesión con tu usuario de Active Directory. La aplicación no almacena contraseñas.</p>
        <form className="security-login-form" onSubmit={handleSubmit}>
          <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
          <label>
            Usuario
            <input
              autoComplete="username"
              autoFocus
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="usuario o usuario@dominio"
              required
              type="text"
            />
          </label>
          <label>
            Contraseña
            <input
              autoComplete="current-password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
            />
          </label>
          {error ? <p className="security-login-error">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? "Validando..." : "Entrar"}
          </button>
        </form>
        <p className="security-login-note">
          El acceso se autoriza por grupos AD y se audita en servidor.
        </p>
      </section>
    </main>
  );
}
