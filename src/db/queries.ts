/**
 * loop v2 — helpers D1 mutualisés.
 *
 * Toutes les requêtes passent par ces helpers pour :
 * - centraliser le SQL (revue ToS/policy facilitée) ;
 * - garantir les paramètres bindés (anti-injection) ;
 * - tracer les décisions dans `decisions` (journal chaîné).
 */

import type { Mission, PlatformRule } from "../types";
import { utcNowIso } from "../types";

// ── Flags système ──────────────────────────────────────────────

export async function getFlag(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM system_flags WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setFlag(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, utcNowIso())
    .run();
}

// ── Matrice ToS ────────────────────────────────────────────────

export async function getPlatformRule(db: D1Database, platform: string): Promise<PlatformRule | null> {
  return db
    .prepare("SELECT * FROM platform_rules WHERE platform = ?")
    .bind(platform)
    .first<PlatformRule>();
}

export async function listPlatformRules(db: D1Database): Promise<PlatformRule[]> {
  const { results } = await db
    .prepare("SELECT * FROM platform_rules ORDER BY platform ASC")
    .all<PlatformRule>();
  return results ?? [];
}

// ── Dépenses SPEND ─────────────────────────────────────────────

export async function getSpendTotalSince(db: D1Database, sinceIso: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_usdc), 0) AS total FROM events
       WHERE kind IN ('fee', 'api_cost') AND ts >= ?`,
    )
    .bind(sinceIso)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// ── Missions ───────────────────────────────────────────────────

export async function getMission(db: D1Database, id: number): Promise<Mission | null> {
  return db.prepare("SELECT * FROM missions WHERE id = ?").bind(id).first<Mission>();
}

export async function updateMissionStatus(
  db: D1Database,
  id: number,
  status: Mission["status"],
  extra: Partial<Pick<Mission, "score" | "submitted_via" | "submitted_at" | "deliverable_ref" | "draft_text" | "notes" | "hitl_approved_at" | "hitl_approved_by">> = {},
): Promise<void> {
  const sets: string[] = ["status = ?"];
  const values: unknown[] = [status];
  for (const [key, value] of Object.entries(extra)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);
  await db.prepare(`UPDATE missions SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

// ── Journal d'audit chaîné ─────────────────────────────────────

/** Hash simple (FNV-1a hex) — le chaînage vise la détection, pas le secret. */
export function chainHash(prevHash: string | null, payload: string): string {
  let h = 0x811c9dc5;
  const input = `${prevHash ?? "GENESIS"}|${payload}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export async function logDecision(
  db: D1Database,
  action: string,
  reason: string | null,
  opts: { actor?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const last = await db
    .prepare("SELECT hash FROM decisions ORDER BY id DESC LIMIT 1")
    .first<{ hash: string }>();
  const prevHash = last?.hash ?? null;
  const ts = utcNowIso();
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const hash = chainHash(prevHash, `${ts}|${action}|${reason ?? ""}|${opts.actor ?? ""}|${metadata ?? ""}`);
  await db
    .prepare("INSERT INTO decisions (ts, action, reason, actor, metadata, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(ts, action, reason, opts.actor ?? null, metadata, prevHash, hash)
    .run();
}
