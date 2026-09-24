/**
 * loop v2 — QUOTAS & MODE DÉGRADÉ (spec §9).
 *
 * 3 couches :
 *   1. notifications natives Cloudflare (dashboard — hors code) ;
 *   2. compteurs D1 batchés (`usage_counters`) pour éviter l'auto-saturation ;
 *   3. Analytics Engine pour le détail (branchement futur).
 *
 * Mode dégradé à 90 % : coupe les crons de scan non essentiels et ne sert
 * que les actions déjà validées (HITL approuvés, submits en attente).
 */

import { utcToday } from "../types";

export type QuotaKind = "scan" | "llm_call" | "telegram_msg" | "d1_write" | "subrequest";

/** Plafonds journaliers indicatifs (Workers free par défaut — à ajuster). */
export const DAILY_QUOTA_LIMITS: Record<QuotaKind, number> = {
  scan: 500,
  llm_call: 1000,
  telegram_msg: 1000,
  d1_write: 50_000,
  subrequest: 50_000,
};

const DEGRADED_THRESHOLD = 0.9;

/** Incrémente un compteur (upsert atomique). */
export async function bumpCounter(db: D1Database, kind: QuotaKind, by = 1): Promise<number> {
  const date = utcToday();
  await db
    .prepare(
      `INSERT INTO usage_counters (date, kind, count) VALUES (?, ?, ?)
       ON CONFLICT (date, kind) DO UPDATE SET count = count + excluded.count`,
    )
    .bind(date, kind, by)
    .run();
  const row = await db
    .prepare("SELECT count FROM usage_counters WHERE date = ? AND kind = ?")
    .bind(date, kind)
    .first<{ count: number }>();
  return row?.count ?? by;
}

/** Lit l'usage du jour pour une ressource. */
export async function getUsage(db: D1Database, kind: QuotaKind): Promise<{ used: number; limit: number; ratio: number }> {
  const date = utcToday();
  const row = await db
    .prepare("SELECT count FROM usage_counters WHERE date = ? AND kind = ?")
    .bind(date, kind)
    .first<{ count: number }>();
  const used = row?.count ?? 0;
  const limit = DAILY_QUOTA_LIMITS[kind];
  return { used, limit, ratio: limit === 0 ? 1 : used / limit };
}

/**
 * Active le mode dégradé si une ressource dépasse 90 %.
 * Retourne true si le mode dégradé est (nouvellement ou déjà) actif.
 */
export async function maybeEnterDegradedMode(db: D1Database): Promise<boolean> {
  const kinds: QuotaKind[] = ["scan", "llm_call", "telegram_msg", "d1_write", "subrequest"];
  for (const kind of kinds) {
    const { ratio } = await getUsage(db, kind);
    if (ratio >= DEGRADED_THRESHOLD) {
      await db
        .prepare("INSERT INTO system_flags (key, value, updated_at) VALUES ('degraded_mode', 'true', ?) ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at")
        .bind(new Date().toISOString())
        .run();
      return true;
    }
  }
  const flag = await db.prepare("SELECT value FROM system_flags WHERE key = 'degraded_mode'").bind().first<{ value: string }>();
  return flag?.value === "true";
}

/** Le scan non essentiel est-il autorisé ? (non en mode dégradé). */
export async function isNonEssentialScanAllowed(db: D1Database): Promise<boolean> {
  return !(await maybeEnterDegradedMode(db));
}
