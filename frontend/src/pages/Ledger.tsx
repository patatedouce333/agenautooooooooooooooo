/** Ledger : événements financiers append-only + anti self-dealing. */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { LedgerEvent } from "../lib/types";
import { fmtDate, fmtMoney, shortAddr } from "../lib/format";
import { Badge, Empty, ErrorBox, Skeleton } from "../components/ui";

const KIND_META: Record<string, { label: string; tone: "green" | "red" | "amber" | "slate" | "blue" }> = {
  sale: { label: "vente", tone: "green" },
  self_test: { label: "auto-test (exclu)", tone: "slate" },
  transfer: { label: "transfert interne", tone: "slate" },
  fee: { label: "frais", tone: "red" },
  human_payout: { label: "paie freelance", tone: "red" },
  api_cost: { label: "coût API", tone: "red" },
};

export function Ledger() {
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.ledger();
      setEvents(r.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const revenue = events.filter((e) => e.kind === "sale").reduce((s, e) => s + (e.amount_usdc ?? 0), 0);
  const costs = events.filter((e) => ["fee", "human_payout", "api_cost"].includes(e.kind)).reduce((s, e) => s + (e.amount_usdc ?? 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Ledger</h1>
        <p className="text-sm text-slate-500">Append-only : on n'efface jamais un événement financier. PAYTO reçoit tout.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><p className="card-title">Ventes (période affichée)</p><p className="mt-2 text-2xl font-extrabold text-loop-400">{fmtMoney(revenue)}</p></div>
        <div className="card"><p className="card-title">Coûts (période affichée)</p><p className="mt-2 text-2xl font-extrabold text-red-400">{fmtMoney(costs)}</p></div>
        <div className="card"><p className="card-title">Net (période affichée)</p><p className="mt-2 text-2xl font-extrabold">{fmtMoney(revenue - costs)}</p></div>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : events.length === 0 ? (
        <Empty title="Aucun événement" />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Montant</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Payeur</th>
                <th className="px-4 py-3">Mission</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const meta = KIND_META[e.kind] ?? { label: e.kind, tone: "slate" as const };
                const isCost = ["fee", "human_payout", "api_cost"].includes(e.kind);
                return (
                  <tr key={e.id} className="table-row">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{e.id}</td>
                    <td className="px-4 py-2.5 text-slate-300">{fmtDate(e.ts)}</td>
                    <td className="px-4 py-2.5"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${isCost ? "text-red-300" : e.kind === "sale" ? "text-loop-400" : "text-slate-300"}`}>
                      {isCost ? "− " : ""}{fmtMoney(e.amount_usdc, e.currency ?? "USDC")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{e.source_platform ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{shortAddr(e.payer)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{e.mission_id ? `#${e.mission_id}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Anti self-dealing : les mouvements entre wallets propres sont requalifiés en <code className="font-mono">self_test</code> / <code className="font-mono">transfer</code> et exclus du revenu.
      </p>
    </div>
  );
}
