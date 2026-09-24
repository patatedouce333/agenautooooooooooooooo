/**
 * KPI quotidien — rapport Telegram du soir (spec §8).
 *
 *   « Net aujourd'hui : X USDC / Y EUR »
 * + détail : revenu, coûts, ventes, missions (détectées/exécutées/en attente),
 *   deals F2 actifs.
 */

import type { Env } from "../types";
import { computeDailyKpi } from "../core/ledger";
import { sendMessage } from "./bot";

export function formatKpiMessage(kpi: {
  date: string;
  revenue_usdc: number;
  revenue_eur_estimate: number;
  costs_usdc: number;
  net_usdc: number;
  sales_count: number;
  missions_detected: number;
  missions_executed: number;
  missions_pending_hitl: number;
  deals_active: number;
}): string {
  const mood = kpi.net_usdc > 0 ? "🟢" : kpi.net_usdc === 0 ? "⚪" : "🔴";
  return (
    `${mood} *loop — rapport du ${kpi.date}*\n\n` +
    `💰 *Net aujourd'hui : ${kpi.net_usdc.toFixed(2)} USDC / ${kpi.revenue_eur_estimate.toFixed(2)} € (est.)*\n\n` +
    `Revenu : ${kpi.revenue_usdc.toFixed(2)} USDC (${kpi.sales_count} vente(s))\n` +
    `Coûts : ${kpi.costs_usdc.toFixed(2)} USDC (fees + F2 + API)\n\n` +
    `🎯 Missions détectées : ${kpi.missions_detected}\n` +
    `✅ Exécutées/soumises : ${kpi.missions_executed}\n` +
    `⏳ En attente de validation : ${kpi.missions_pending_hitl}\n` +
    `🤝 Deals F2 actifs : ${kpi.deals_active}`
  );
}

/** Calcule le KPI du jour et l'envoie à l'admin. */
export async function sendDailyKpi(db: D1Database, env: Env, date?: string): Promise<string> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const kpi = await computeDailyKpi(db, day);
  const message = formatKpiMessage(kpi);
  await sendMessage(db, env, message);
  return message;
}
