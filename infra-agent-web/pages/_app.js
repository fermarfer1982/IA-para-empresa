import { SessionProvider } from "next-auth/react";
import AuthGate from "../components/security/AuthGate";
import "../styles/globals.css";

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <AuthGate>
        <Component {...pageProps} />
      </AuthGate>
    </SessionProvider>
  );
}
