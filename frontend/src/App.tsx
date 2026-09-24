/** Racine du dashboard : état global (statut système) + navigation par onglets. */
import { useCallback, useEffect, useState } from "react";
import { Layout, type TabId } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Missions } from "./pages/Missions";
import { Deals } from "./pages/Deals";
import { Ledger } from "./pages/Ledger";
import { Platforms } from "./pages/Platforms";
import { System } from "./pages/System";
import { api } from "./lib/api";
import type { SystemStatus } from "./lib/types";

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [status, setStatus] = useState<SystemStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
    } catch {
      // Le mode démo est géré dans api.ts ; ici on ignore silencieusement.
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 60_000); // refresh doux chaque minute
    return () => clearInterval(t);
  }, [refreshStatus]);

  return (
    <Layout tab={tab} setTab={setTab} frozen={status?.freeze ?? false}>
      {tab === "dashboard" && <Dashboard status={status} refreshStatus={refreshStatus} />}
      {tab === "missions" && <Missions />}
      {tab === "deals" && <Deals />}
      {tab === "ledger" && <Ledger />}
      {tab === "platforms" && <Platforms />}
      {tab === "system" && <System status={status} refreshStatus={refreshStatus} />}
    </Layout>
  );
}
