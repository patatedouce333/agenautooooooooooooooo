/** Matrice ToS : ce que l'agent peut scanner / soumettre, par plateforme. */
import { useCallback, useEffect, useState } from "react";
import { Check, X, Minus } from "lucide-react";
import { api } from "../lib/api";
import type { PlatformRule } from "../lib/types";
import { Badge, Empty, ErrorBox, Skeleton } from "../components/ui";

function Tri({ v }: { v: number }) {
  if (v === 1) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-300"><Check size={14} /></span>;
  return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/15 text-red-300"><X size={14} /></span>;
}

export function Platforms() {
  const [rules, setRules] = useState<PlatformRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.platforms();
      setRules(r.rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Plateformes & ToS</h1>
        <p className="text-sm text-slate-500">Contrainte dure : l'agent scanne partout, mais ne soumet en auto que là où c'est permis.</p>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : rules.length === 0 ? (
        <Empty title="Aucune règle" />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Plateforme</th>
                <th className="px-4 py-3 text-center">Scan</th>
                <th className="px-4 py-3 text-center">Préparer</th>
                <th className="px-4 py-3 text-center">Auto-submit</th>
                <th className="px-4 py-3">Règle ToS</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.platform} className="table-row">
                  <td className="px-4 py-3 font-mono font-semibold">{r.platform}</td>
                  <td className="px-4 py-3 text-center"><Tri v={r.can_scan} /></td>
                  <td className="px-4 py-3 text-center"><Tri v={r.can_prepare} /></td>
                  <td className="px-4 py-3 text-center">
                    {r.can_auto_submit === 1 ? <Badge tone="green">auto OK</Badge> : <Badge tone="amber">humain requis</Badge>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{r.notes_tos ?? <Minus size={14} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-200">Règles du jeu</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Plateforme <strong>non listée</strong> = refus + approbation humaine avant tout scan/submit.</li>
          <li>La matrice ne se modifie que par <strong>migration SQL revue</strong> (pas de bouton magique — changer une règle ToS est une décision humaine tracée).</li>
          <li>Jamais de contournement anti-bot : si interdit, l'agent prépare le draft et l'humain clique.</li>
        </ul>
      </div>
    </div>
  );
}
