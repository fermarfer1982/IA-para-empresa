import dynamic from "next/dynamic";
import "../lib/installRandomUUIDFallback";

const InfraChatClient = dynamic(() => import("./InfraChatClient"), {
  ssr: false,
  loading: () => (
    <main className="app-shell loading-shell">
      <div className="loading-panel">Cargando chat...</div>
    </main>
  )
});

export default function InfraChat() {
  return <InfraChatClient />;
}
