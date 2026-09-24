/** Petits composants UI partagés : badges, barres, états vides/erreurs. */
import type { ReactNode } from "react";

export function Badge({ tone, children }: { tone: "green" | "red" | "amber" | "slate" | "blue"; children: ReactNode }) {
  const tones: Record<string, string> = {
    green: "bg-green-500/15 text-green-300 ring-1 ring-green-500/30",
    red: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
    amber: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    slate: "bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30",
    blue: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
  };
  return <span className={`badge ${tones[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, "green" | "red" | "amber" | "slate" | "blue"> = {
  detected: "slate",
  scored: "slate",
  proposed: "amber",
  approved: "blue",
  executing: "blue",
  submitted: "green",
  paid: "green",
  failed: "red",
  scouting: "amber",
  hired: "blue",
  delivered: "blue",
  cancelled: "red",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>;
}

export function KindBadge({ kind }: { kind: string }) {
  return kind === "f1_executable" ? <Badge tone="green">F1 · agent</Badge> : <Badge tone="amber">F2 · humain</Badge>;
}

export function Progress({ ratio }: { ratio: number }) {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const color = ratio >= 0.9 ? "bg-red-400" : ratio >= 0.7 ? "bg-amber-400" : "bg-loop-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <p className="font-semibold text-slate-200">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
      <p>{message}</p>
      {onRetry && (
        <button className="btn-ghost mt-2" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-label="Chargement…">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-white/5" />
      ))}
    </div>
  );
}

/** Petit graphique en barres SVG (revenu par source). */
export function BarChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-mono text-slate-300">{d.label}</span>
            <span className="font-semibold text-slate-100">{d.value.toFixed(2)} USDC</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-loop-600 to-loop-400"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
