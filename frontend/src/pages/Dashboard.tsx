/** Vue d'ensemble : KPI du jour, revenu par source, file HITL, raccourcis. */
import { useCallback, useEffect, useState } from "react";
import { Wallet, TrendingUp, Receipt, Target, Hourglass, Handshake, RefreshCw, Radar } from "lucide-react";
import { api } from "../lib/api";
import type { BySource, DailyKpi, SystemStatus } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { Badge, BarChart, Empty, ErrorBox, Skeleton } from "../components/ui";

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <p className="card-title">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Dashboard({ status, refreshStatus }: { status: SystemStatus | null; refreshStatus: () => void }) {
  const [kpi, setKpi] = useState<DailyKpi | null>(status?.kpiToday ?? null);
  const [bySource, setBySource] = useState<BySource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!status);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, s] = await Promise.all([api.kpiToday(), api.kpiBySource(new Date().toISOString().slice(0, 10))]);
      setKpi(k.kpi);
      setBySource(s.bySource);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await api.scan();
      setScanMsg(`Scan terminé — HITL #${(r as { hitlId?: number }).hitlId ?? "?"} envoyé sur Telegram.`);
      refreshStatus();
      load();
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  if (loading && !kpi) return <Skeleton lines={4} />;
  if (error && !kpi) return <ErrorBox message={error} onRetry={load} />;
  if (!kpi) return <Empty title="Aucun KPI" />;

  const netTone = kpi.net_usdc > 0 ? "text-loop-400" : kpi.net_usdc === 0 ? "text-slate-200" : "text-red-400";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Vue d'ensemble</h1>
          <p className="text-sm text-slate-500">Combien gagné aujourd'hui, par source ? — {kpi.date}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => { load(); refreshStatus(); }}>
            <RefreshCw size={16} /> Actualiser
          </button>
          <button className="btn-primary" onClick={runScan} disabled={scanning}>
            <Radar size={16} /> {scanning ? "Scan…" : "Scanner"}
          </button>
        </div>
      </div>
      {scanMsg && <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">{scanMsg}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card border-loop-500/30 bg-gradient-to-br from-loop-500/10 to-transparent">
          <div className="flex items-center gap-2 text-slate-400">
            <TrendingUp size={16} />
            <p className="card-title">Net aujourd'hui</p>
          </div>
          <p className={`mt-2 text-3xl font-extrabold tracking-tight ${netTone}`}>{fmtMoney(kpi.net_usdc)}</p>
          <p className="mt-1 text-xs text-slate-500">≈ {fmtMoney(kpi.revenue_eur_estimate, "€ (est.)")}</p>
        </div>
        <Stat icon={<Wallet size={16} />} label="Revenu" value={fmtMoney(kpi.revenue_usdc)} sub={`${kpi.sales_count} vente(s)`} />
        <Stat icon={<Receipt size={16} />} label="Coûts" value={fmtMoney(kpi.costs_usdc)} sub="fees + F2 + API" />
        <Stat icon={<Target size={16} />} label="Missions détectées" value={String(kpi.missions_detected)} sub={`${kpi.missions_executed} exécutées`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <p className="card-title">Revenu par source</p>
          <div className="mt-4">
            {bySource.length === 0 ? <Empty title="Pas de ventes aujourd'hui" hint="Le scan tourne toutes les 6h." /> : <BarChart data={bySource.map((b) => ({ label: b.platform ?? "?", value: b.revenue }))} />}
          </div>
        </div>
        <div className="card">
          <p className="card-title">File d'attente humaine</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3">
              <span className="flex items-center gap-2 text-sm"><Hourglass size={16} className="text-amber-300" /> Missions à valider</span>
              <Badge tone={kpi.missions_pending_hitl > 0 ? "amber" : "slate"}>{kpi.missions_pending_hitl}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3">
              <span className="flex items-center gap-2 text-sm"><Handshake size={16} className="text-sky-300" /> Deals F2 actifs</span>
              <Badge tone={kpi.deals_active > 0 ? "blue" : "slate"}>{kpi.deals_active}</Badge>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              Timeout = refus : sans réponse sur Telegram, l'agent ne prend rien. Validez depuis Telegram (boutons approve/deny) ou l'onglet Missions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
