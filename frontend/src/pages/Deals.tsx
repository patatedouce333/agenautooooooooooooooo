/** Arbitrage F2 : chiffrage → HITL → recrutement → livraison → paiement. */
import { useCallback, useEffect, useState } from "react";
import { UserPlus, PackageCheck, Banknote, Plus } from "lucide-react";
import { api } from "../lib/api";
import type { ArbitrageDeal } from "../lib/types";
import { fmtMoney } from "../lib/format";
import { Empty, ErrorBox, Skeleton, StatusBadge } from "../components/ui";

export function Deals() {
  const [deals, setDeals] = useState<ArbitrageDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [showQuote, setShowQuote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.deals();
      setDeals(r.deals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id);
    setMsg(null);
    try {
      const r = (await fn()) as { message?: string };
      setMsg(r.message ?? "OK");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Arbitrage F2</h1>
          <p className="text-sm text-slate-500">Marge = client − freelance − frais − réserve litige − contrôle.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowQuote((v) => !v)}>
          <Plus size={16} /> Chiffrer un deal
        </button>
      </div>

      {msg && <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">{msg}</div>}
      {showQuote && <QuoteForm onDone={(m) => { setMsg(m); setShowQuote(false); load(); }} />}

      {loading ? (
        <Skeleton lines={4} />
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : deals.length === 0 ? (
        <Empty title="Aucun deal F2" hint="Chiffrez une mission nécessitant un humain pour commencer." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {deals.map((d) => {
            const cur = d.currency ?? "EUR";
            const marginTone = (d.margin_net ?? 0) >= 0 ? "text-loop-400" : "text-red-400";
            return (
              <div key={d.id} className="card">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500">Deal #{d.id}{d.mission_id ? ` · mission #${d.mission_id}` : ""}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <Row label="Prix client" value={fmtMoney(d.client_price, cur)} />
                  <Row label="Coût freelance" value={`− ${fmtMoney(d.freelancer_cost, cur)}`} />
                  <Row label="Frais plateforme" value={`− ${fmtMoney(d.platform_fees, cur)}`} />
                  <Row label="Réserve litige" value={`− ${fmtMoney(d.litigation_reserve, cur)}`} />
                  <Row label="Temps de contrôle" value={`− ${fmtMoney(d.control_time_cost, cur)}`} />
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="text-sm text-slate-400">Marge nette</span>
                  <span className={`text-xl font-extrabold ${marginTone}`}>{fmtMoney(d.margin_net, cur)}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {d.freelancer_platform ?? "?"} · {d.freelancer_contact ?? "freelance non assigné"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.status === "scouting" && (
                    <button className="btn-ghost" disabled={busy === d.id} onClick={() => act(d.id, () => api.requestDealApproval(d.id))}>
                      Demander approbation (HITL)
                    </button>
                  )}
                  {d.status === "proposed" && (
                    <button className="btn-primary" disabled={busy === d.id} onClick={() => {
                      const contact = window.prompt("Contact freelance (contrat, brief, délai envoyés) :", d.freelancer_contact ?? "");
                      if (contact) act(d.id, () => api.markHired(d.id, contact));
                    }}>
                      <UserPlus size={16} /> Recruter
                    </button>
                  )}
                  {d.status === "hired" && (
                    <button className="btn-primary" disabled={busy === d.id} onClick={() => {
                      const notes = window.prompt("Notes de contrôle (cohérence, preuves, géoloc) :", "contrôle OK");
                      if (notes !== null) act(d.id, () => api.markDelivered(d.id, notes));
                    }}>
                      <PackageCheck size={16} /> Livré + contrôlé
                    </button>
                  )}
                  {d.status === "delivered" && (
                    <button className="btn-primary" disabled={busy === d.id} onClick={() => act(d.id, () => api.markPaid(d.id))}>
                      <Banknote size={16} /> Solder
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs leading-relaxed text-slate-500">
        Garde-fous : aucune embauche sans client financeur confirmé · pas d'escrow maison · facture obligatoire (SIRET requis pour le fiat récurrent).
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function QuoteForm({ onDone }: { onDone: (msg: string) => void }) {
  const [f, setF] = useState({ clientPrice: "", freelancerCost: "", platformFees: "", controlTimeCost: "", freelancerPlatform: "malt", notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = (await api.quoteDeal({
        clientPrice: Number(f.clientPrice),
        freelancerCost: Number(f.freelancerCost || 0),
        platformFees: Number(f.platformFees || 0),
        controlTimeCost: Number(f.controlTimeCost || 0),
        freelancerPlatform: f.freelancerPlatform,
        notes: f.notes || undefined,
      })) as { dealId?: number; marginNet?: number };
      onDone(`Deal #${r.dealId} chiffré — marge nette ${r.marginNet}. En attente de validation HITL.`);
    } catch (err) {
      onDone(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-dashed">
      <p className="card-title">Chiffrage F2 (rejet auto si marge &lt; seuil 15 €)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" required type="number" min="0" step="0.01" placeholder="Prix client (€) *" value={f.clientPrice} onChange={(e) => set("clientPrice", e.target.value)} />
        <input className="input" required type="number" min="0" step="0.01" placeholder="Coût freelance (€) *" value={f.freelancerCost} onChange={(e) => set("freelancerCost", e.target.value)} />
        <input className="input" type="number" min="0" step="0.01" placeholder="Frais plateforme (€)" value={f.platformFees} onChange={(e) => set("platformFees", e.target.value)} />
        <input className="input" type="number" min="0" step="0.01" placeholder="Temps de contrôle (€)" value={f.controlTimeCost} onChange={(e) => set("controlTimeCost", e.target.value)} />
        <select className="input" value={f.freelancerPlatform} onChange={(e) => set("freelancerPlatform", e.target.value)}>
          {["malt", "comeup", "upwork", "rentahuman-requester", "youpijob"].map((p) => <option key={p}>{p}</option>)}
        </select>
        <input className="input" placeholder="Notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? "Chiffrage…" : "Chiffrer"}</button>
    </form>
  );
}
