import fs from "fs";
import Head from "next/head";
import path from "path";
import AgentDisplayShell from "../components/AgentDisplayShell";

export async function getServerSideProps() {
  const publicDir = path.join(process.cwd(), "public", "avatar");
  return {
    props: {
      avatarAssets: {
        idle: fs.existsSync(path.join(publicDir, "avatar-en-reposo.mp4")),
        active: fs.existsSync(path.join(publicDir, "avatar-hablando.mp4"))
      }
    }
  };
}

export default function AgentDisplayPage({ avatarAssets }) {
  return (
    <>
      <Head>
        <title>Agent Display | Infra Agent</title>
        <meta
          name="description"
          content="Centro de control visual para el agente inteligente de infraestructura."
        />
      </Head>
      <AgentDisplayShell avatarAssets={avatarAssets} />
    </>
  );
}
