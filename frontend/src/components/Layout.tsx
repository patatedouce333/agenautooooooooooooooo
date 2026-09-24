/** Coquille du dashboard : sidebar, bandeaux freeze/démo, navigation par onglets. */
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Crosshair,
  Handshake,
  BookOpenText,
  ShieldCheck,
  Settings2,
  Snowflake,
  FlaskConical,
  Bot,
} from "lucide-react";
import { demoMode, onDemoChange } from "../lib/api";

export type TabId = "dashboard" | "missions" | "deals" | "ledger" | "platforms" | "system";

const TABS: Array<{ id: TabId; label: string; icon: ReactNode; hint: string }> = [
  { id: "dashboard", label: "Vue d'ensemble", icon: <LayoutDashboard size={18} />, hint: "KPI du jour" },
  { id: "missions", label: "Missions F1", icon: <Crosshair size={18} />, hint: "Chasseur-exécuteur" },
  { id: "deals", label: "Arbitrage F2", icon: <Handshake size={18} />, hint: "Humains" },
  { id: "ledger", label: "Ledger", icon: <BookOpenText size={18} />, hint: "Banque" },
  { id: "platforms", label: "Plateformes", icon: <ShieldCheck size={18} />, hint: "Matrice ToS" },
  { id: "system", label: "Système", icon: <Settings2 size={18} />, hint: "Freeze · audit" },
];

export function Layout({
  tab,
  setTab,
  frozen,
  children,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  frozen: boolean;
  children: ReactNode;
}) {
  const [demo, setDemo] = useState(demoMode);
  useEffect(() => onDemoChange(setDemo), []);

  return (
    <div className="min-h-screen lg:flex">
      {/* ── Sidebar ── */}
      <aside className="border-b border-white/10 bg-ink-900/60 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-loop-400 to-loop-600 text-ink-950">
            <Bot size={22} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-lg font-extrabold tracking-tight">
              loop <span className="text-loop-400">v2</span>
            </p>
            <p className="text-xs text-slate-500">chasseur de missions</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-1 lg:overflow-visible">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={`flex min-w-max items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition lg:min-w-0 ${
                tab === t.id ? "bg-loop-500/15 text-loop-400 ring-1 ring-loop-500/30" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden p-4 lg:block">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-500">
            <p className="font-semibold text-slate-300">Mission : revenu / jour</p>
            <p className="mt-1">F1 chasse + exécute · F2 arbitre l'humain. Aucun trading.</p>
          </div>
        </div>
      </aside>

      {/* ── Contenu ── */}
      <main className="min-w-0 flex-1">
        {demo && (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-sm text-amber-200">
            <FlaskConical size={16} />
            <span>
              <strong>MODE DÉMO</strong> — API injoignable, données fictives. Définissez <code className="font-mono">VITE_API_URL</code> pour le live.
            </span>
          </div>
        )}
        {frozen && (
          <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-5 py-2 text-sm text-sky-200">
            <Snowflake size={16} />
            <span>
              <strong>SYSTÈME GELÉ</strong> — toutes les actions sortantes sont bloquées. Dégel via Système (double confirmation).
            </span>
          </div>
        )}
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
