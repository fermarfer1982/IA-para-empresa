import dynamic from "next/dynamic";
import Head from "next/head";

const InfraChat = dynamic(() => import("../components/InfraChat"), {
  ssr: false,
  loading: () => (
    <main className="app-shell loading-shell">
      <div className="loading-panel">Cargando consola...</div>
    </main>
  )
});

export default function Home() {
  return (
    <>
      <Head>
        <title>Agente Inteligente de Infraestructura</title>
        <meta
          name="description"
          content="Consola interna con ChatKit para el Agente Inteligente de Infraestructura."
        />
      </Head>
      <InfraChat />
    </>
  );
}
