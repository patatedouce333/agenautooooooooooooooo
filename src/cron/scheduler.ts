/**
 * CRONS — boucle quotidienne de l'agent (spec §2 + wrangler.toml).
 *
 *   `0 *\/6 * * *` → scan F1 (toutes les 6h) + proposition top-N via HITL.
 *   `0 20 * * *`  → KPI du soir sur Telegram + expiration des HITL.
 *
 * Distinction : le runtime Workers ne transmet pas l'expression cron qui a
 * déclenché l'appel — on utilise l'heure UTC (20h = KPI, sinon scan).
 */

import type { Env } from "../types";
import { utcToday } from "../types";
import { configFromEnv } from "../core/policy";
import { runScanCycle } from "../f1/scanner";
import { createHitlRequest, expireStaleHitlRequests } from "../telegram/hitl";
import { sendDailyKpi } from "../telegram/kpi";

export async function handleScheduled(db: D1Database, env: Env, scheduledTime: Date): Promise<string> {
  const hourUtc = scheduledTime.getUTCHours();
  if (hourUtc === 20) {
    return runEveningKpi(db, env);
  }
  return runScanCron(db, env);
}

/** Scan F1 + HITL léger « voici N missions, confirme ». */
export async function runScanCron(db: D1Database, env: Env): Promise<string> {
  await expireStaleHitlRequests(db);
  const report = await runScanCycle(db, env, configFromEnv(env));
  if (report.degraded) return "scan_skipped_degraded";
  if (report.proposedTopN.length === 0) return `scan_done_inserted_${report.inserted}`;

  const placeholders = report.proposedTopN.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id, title, source_platform, amount, currency, score FROM missions WHERE id IN (${placeholders}) ORDER BY score DESC`)
    .bind(...report.proposedTopN)
    .all<{ id: number; title: string | null; source_platform: string; amount: number | null; currency: string | null; score: number | null }>();
  const lines = (results ?? []).map(
    (m) => `#${m.id} — ${m.title ?? "(sans titre)"} (${m.source_platform}, ${m.amount ?? "?"} ${m.currency ?? ""}, ${m.score ?? 0} pts)`,
  );
  await createHitlRequest(db, env, "mission_batch", { missionIds: report.proposedTopN }, {
    summary: `Voici ${report.proposedTopN.length} mission(s), confirme celle(s) à traiter :\n${lines.join("\n")}`,
  });
  return `scan_done_proposed_${report.proposedTopN.length}`;
}

/** KPI du soir + expiration HITL (timeout = deny). */
export async function runEveningKpi(db: D1Database, env: Env): Promise<string> {
  await expireStaleHitlRequests(db);
  await sendDailyKpi(db, env, utcToday());
  return "kpi_sent";
}
