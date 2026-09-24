/** Système : freeze, quotas, config policy, HITL en attente, journal d'audit. */
import { useCallback, useEffect, useState } from "react";
import { Snowflake, Flame, ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import type { SystemStatus } from "../lib/types";
import { fmtDate } from "../lib/format";
import { Badge, Empty, ErrorBox, Progress, Skeleton } from "../components/ui";

export function System({ status, refreshStatus }: { status: SystemStatus | null; refreshStatus: () => void }) {
  const [decisions, setDecisions] = useState<Array<{ id: number; ts: string; action: string; reason: string | null; actor: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.decisions();
      setDecisions(r.decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function freeze() {
    if (!window.confirm("Geler le système ? Toutes les actions sortantes seront bloquées immédiatement.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.freeze();
      setMsg("Système gelé (effet immédiat).");
      refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unfreeze() {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await api.unfreeze()) as { hitlId?: number; message?: string };
      setMsg(`${r.message ?? "Demande envoyée"}${r.hitlId ? ` — confirmez via le bouton Telegram du HITL #${r.hitlId} (double confirmation).` : ""}`);
      refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Système</h1>
        <p className="text-sm text-slate-500">Freeze, quotas Cloudflare, policy et journal d'audit. Version {status?.version ?? "?"}.</p>
      </div>

      {msg && <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">{msg}</div>}

      {/* Freeze */}
      <div className={`card ${status?.freeze ? "border-sky-500/40" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {status?.freeze ? <Snowflake className="text-sky-300" /> : <ShieldAlert className="text-loop-400" />}
            <div>
              <p className="font-semibold">{status?.freeze ? "Système gelé" : "Système actif"}</p>
              <p className="text-xs text-slate-500">
                {status?.freeze ? "Actions sortantes bloquées — dégel = double confirmation." : "Le policy engine filtre chaque action sortante."}
              </p>
            </div>
          </div>
          {status?.freeze ? (
            <button className="btn-primary" disabled={busy} onClick={unfreeze}>
              <Flame size={16} /> Dégeler (2 étapes)
            </button>
          ) : (
            <button className="btn-danger" disabled={busy} onClick={freeze}>
              <Snowflake size={16} /> Geler maintenant
            </button>
          )}
        </div>
      </div>

      {/* Config policy */}
      {status && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card"><p className="card-title">Plafond SPEND / jour</p><p className="mt-2 text-xl font-extrabold">{status.config.dailySpendLimitUsdc} USDC</p></div>
          <div className="card"><p className="card-title">Seuil marge F2</p><p className="mt-2 text-xl font-extrabold">{status.config.f2MinMarginEur} €</p></div>
          <div className="card"><p className="card-title">Réserve litige F2</p><p className="mt-2 text-xl font-extrabold">{(status.config.f2LitigationReserveRate * 100).toFixed(0)} %</p></div>
          <div className="card"><p className="card-title">Top-N proposé</p><p className="mt-2 text-xl font-extrabold">{status.config.scanTopN}</p></div>
        </div>
      )}

      {/* Quotas */}
      <div className="card">
        <div className="flex items-center justify-between">
          <p className="card-title">Quotas Cloudflare du jour</p>
          {status?.degradedMode && <Badge tone="red">mode dégradé — scans coupés</Badge>}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {status ? (
            Object.entries(status.quotas).map(([kind, q]) => (
              <div key={kind}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-mono">{kind}</span>
                  <span className="text-slate-400">{q.used} / {q.limit}</span>
                </div>
                <Progress ratio={q.ratio} />
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Chargement…</p>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">À 90 % d'un quota : mode dégradé — seuls les actions déjà validées sont servies.</p>
      </div>

      {/* HITL */}
      <div className="card">
        <p className="card-title">Validations humaines en attente ({status?.pendingHitl.length ?? 0})</p>
        {!status || status.pendingHitl.length === 0 ? (
          <div className="mt-3"><Empty title="Aucun HITL en attente" hint="Les demandes apparaissent ici + sur Telegram avec boutons." /></div>
        ) : (
          <div className="mt-3 space-y-2">
            {status.pendingHitl.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] p-3 text-sm">
                <span><strong>#{h.id}</strong> · {h.kind} {h.ref_id ? `· réf ${h.ref_type} #${h.ref_id}` : ""}</span>
                <span className="text-xs text-slate-500">expire {fmtDate(h.expires_at)} (timeout = refus)</span>
              </div>
            ))}
            <p className="text-xs text-slate-500">Résolvez depuis Telegram (/approve, /deny ou boutons) — timeout = refus.</p>
          </div>
        )}
      </div>

      {/* Audit */}
      <div className="card">
        <p className="card-title">Journal d'audit (chaîné)</p>
        {loading ? (
          <div className="mt-3"><Skeleton lines={3} /></div>
        ) : error ? (
          <div className="mt-3"><ErrorBox message={error} onRetry={load} /></div>
        ) : decisions.length === 0 ? (
          <div className="mt-3"><Empty title="Aucune décision tracée" /></div>
        ) : (
          <div className="mt-3 max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
            {decisions.map((d) => (
              <div key={d.id} className="flex gap-3 border-b border-white/5 py-2">
                <span className="shrink-0 text-slate-500">{fmtDate(d.ts)}</span>
                <span className="shrink-0 text-loop-400">{d.action}</span>
                <span className="min-w-0 flex-1 truncate text-slate-400" title={d.reason ?? ""}>{d.reason ?? ""}</span>
                <span className="shrink-0 text-slate-600">{d.actor ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
