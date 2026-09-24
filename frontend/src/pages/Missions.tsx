/** File F1 : missions détectées → proposées → approuvées → exécutées → soumises. */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Play, Send, CheckCheck, Plus, Stamp } from "lucide-react";
import { api } from "../lib/api";
import type { Mission } from "../lib/types";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, ErrorBox, KindBadge, Skeleton, StatusBadge } from "../components/ui";

const NEXT_ACTION: Record<string, string> = {
  detected: "En attente de scoring",
  scored: "Demander validation →",
  proposed: "Validez sur Telegram 📲",
  approved: "Exécuter →",
  executing: "Soumettre →",
  submitted: "En attente de paiement",
  paid: "Encaissée ✅",
  failed: "Échouée",
};

export function Missions() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.missions();
      setMissions(r.missions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(id: number, fn: () => Promise<unknown>, label: string) {
    setBusy(id);
    setMsg(null);
    try {
      const r = (await fn()) as { message?: string; via?: string; hitlId?: number };
      setMsg(`${label} : ${r.message ?? "OK"}${r.via ? ` (via ${r.via})` : ""}${r.hitlId ? ` — HITL #${r.hitlId}` : ""}`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const shown = filter ? missions.filter((m) => m.status === filter) : missions;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Missions F1</h1>
          <p className="text-sm text-slate-500">L'agent scanne, vous validez, il exécute et encaisse.</p>
        </div>
        <div className="flex gap-2">
          <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Tous statuts</option>
            {["proposed", "approved", "executing", "submitted", "paid", "scored"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={() => setShowImport((v) => !v)}>
            <Plus size={16} /> Import
          </button>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">{msg}</div>}
      {showImport && <ImportForm onDone={(m) => { setMsg(m); setShowImport(false); load(); }} />}

      {loading ? (
        <Skeleton lines={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : shown.length === 0 ? (
        <Empty title="Aucune mission" hint="Lancez un scan depuis la vue d'ensemble." />
      ) : (
        <div className="space-y-3">
          {shown.map((m) => (
            <div key={m.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">#{m.id}</span>
                    <KindBadge kind={m.kind} />
                    <StatusBadge status={m.status} />
                    <span className="font-mono text-xs text-slate-500">{m.source_platform}</span>
                  </div>
                  <p className="mt-2 font-semibold leading-snug">{m.title ?? "(sans titre)"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {fmtMoney(m.amount, m.currency ?? "USDC")} · score {m.score ?? 0} pts · trouvée {fmtDate(m.found_at)}
                    {m.submitted_via && ` · soumise via ${m.submitted_via === "auto" ? "🤖 auto" : "🧑 humain"}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.url && (
                    <a className="btn-ghost" href={m.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                    </a>
                  )}
                  {(m.status === "scored" || m.status === "proposed") && (
                    <button className="btn-ghost" disabled={busy === m.id} onClick={() => act(m.id, () => api.approveMission(m.id), `Mission #${m.id}`)}>
                      <Stamp size={16} /> Valider
                    </button>
                  )}
                  {m.status === "approved" && (
                    <button className="btn-primary" disabled={busy === m.id} onClick={() => act(m.id, () => api.executeMission(m.id), `Mission #${m.id}`)}>
                      <Play size={16} /> Exécuter
                    </button>
                  )}
                  {m.status === "executing" && (
                    <>
                      <button className="btn-primary" disabled={busy === m.id} onClick={() => act(m.id, () => api.submitMission(m.id), `Mission #${m.id}`)}>
                        <Send size={16} /> Soumettre
                      </button>
                      <button className="btn-ghost" disabled={busy === m.id} onClick={() => act(m.id, () => api.confirmHumanSubmit(m.id), `Mission #${m.id}`)}>
                        <CheckCheck size={16} /> J'ai cliqué
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-3 border-t border-white/5 pt-2 text-xs text-slate-500">Prochaine étape : {NEXT_ACTION[m.status] ?? m.status}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Import manuel — pour les plateformes lecture seule (Upwork, Malt…). */
function ImportForm({ onDone }: { onDone: (msg: string) => void }) {
  const [form, setForm] = useState({ platform: "upwork", externalId: "", title: "", url: "", amount: "", currency: "USDC" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = (await api.importMission({
        platform: form.platform,
        externalId: form.externalId || `manuel-${Date.now()}`,
        title: form.title,
        url: form.url || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
        currency: form.currency,
      })) as { id?: number; kind?: string; duplicate?: boolean };
      onDone(r.duplicate ? `Doublon — mission #${r.id} déjà suivie.` : `Mission #${r.id} importée (${r.kind}).`);
    } catch (err) {
      onDone(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-dashed">
      <p className="card-title">Import manuel (Upwork / Malt / ComeUp…)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <select className="input" value={form.platform} onChange={(e) => set("platform", e.target.value)}>
          {["upwork", "malt", "comeup", "youpijob", "leboncoin-services", "algora", "gitcoin"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input className="input" placeholder="ID externe (optionnel)" value={form.externalId} onChange={(e) => set("externalId", e.target.value)} />
        <input className="input sm:col-span-2" required placeholder="Titre de la mission *" value={form.title} onChange={(e) => set("title", e.target.value)} />
        <input className="input sm:col-span-2" placeholder="URL" value={form.url} onChange={(e) => set("url", e.target.value)} />
        <input className="input" type="number" min="0" step="0.01" placeholder="Montant" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
        <select className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
          <option>USDC</option>
          <option>EUR</option>
        </select>
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? "Import…" : "Importer"}</button>
    </form>
  );
}
