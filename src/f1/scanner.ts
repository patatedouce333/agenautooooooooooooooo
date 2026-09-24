/**
 * F1 — SCANNER (spec §4, étapes 1-3).
 *
 * Cycle (cron toutes les 6h) :
 *   1. SCAN      — chaque connecteur autorisé par la policy `scan` ;
 *   2. FILTRE & SCORING — F1 vs F2, score = (montant × proba) / effort ;
 *   3. SÉLECTION — top-N (configurable, défaut 5) → `proposed` + HITL Telegram.
 *
 * Règles :
 * - déduplication sur (source_platform, external_id) ;
 * - timeout HITL = deny : `proposed` sans réponse → reste en attente,
 *   l'agent ne prend RIEN par défaut (cohérent avec « timeout = deny ») ;
 * - mode dégradé (spec §9) : pas de scan non essentiel.
 */

import type { Env, LoopConfig, MissionKind } from "../types";
import { utcNowIso } from "../types";
import { CONNECTORS } from "../connectors/registry";
import type { RawMission } from "../connectors/types";
import { evaluatePolicy } from "../core/policy";
import { isNonEssentialScanAllowed, bumpCounter } from "../core/quotas";
import { logDecision } from "../db/queries";
import { requiresHuman, scoreMission } from "../core/scoring";

export interface ScanCycleReport {
  startedAt: string;
  finishedAt: string;
  degraded: boolean;
  platforms: Array<{ platform: string; found: number; partial: boolean; note?: string }>;
  inserted: number;
  duplicates: number;
  f1Count: number;
  f2Count: number;
  proposedTopN: number[];
}

/** Exécute un cycle complet de scan + scoring + proposition. */
export async function runScanCycle(db: D1Database, env: Env, config: LoopConfig): Promise<ScanCycleReport> {
  const startedAt = utcNowIso();
  const report: ScanCycleReport = {
    startedAt,
    finishedAt: startedAt,
    degraded: false,
    platforms: [],
    inserted: 0,
    duplicates: 0,
    f1Count: 0,
    f2Count: 0,
    proposedTopN: [],
  };

  // Mode dégradé : on coupe les scans non essentiels (spec §9).
  if (!(await isNonEssentialScanAllowed(db))) {
    report.degraded = true;
    report.finishedAt = utcNowIso();
    await logDecision(db, "scan_cycle_skipped", "Mode dégradé actif (quota ≥ 90 %) — scan non essentiel coupé.", { actor: "system" });
    return report;
  }

  const allFound: RawMission[] = [];

  for (const connector of CONNECTORS) {
    // Policy `scan` par plateforme (matrice ToS).
    const verdict = await evaluatePolicy(db, config, { action: "scan", platform: connector.platform });
    if (!verdict.allowed) {
      report.platforms.push({ platform: connector.platform, found: 0, partial: true, note: verdict.reason });
      continue;
    }
    try {
      const result = await connector.scan(env);
      await bumpCounter(db, "scan", 1);
      report.platforms.push({ platform: result.platform, found: result.missions.length, partial: result.partial, note: result.note });
      allFound.push(...result.missions);
    } catch (err) {
      report.platforms.push({
        platform: connector.platform,
        found: 0,
        partial: true,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Stockage + scoring ──
  const scoredIds: Array<{ id: number; score: number }> = [];
  for (const raw of allFound) {
    const stored = await storeRawMission(db, raw);
    if (stored === null) {
      report.duplicates++;
      continue;
    }
    report.inserted++;
    if (stored.kind === "f1_executable") {
      report.f1Count++;
      scoredIds.push({ id: stored.id, score: stored.score });
    } else {
      report.f2Count++;
    }
  }

  // ── Sélection top-N F1 → proposed ──
  scoredIds.sort((a, b) => b.score - a.score || a.id - b.id);
  const topN = scoredIds.slice(0, Math.max(0, config.scanTopN));
  for (const { id } of topN) {
    await db.prepare("UPDATE missions SET status = 'proposed' WHERE id = ? AND status = 'scored'").bind(id).run();
    report.proposedTopN.push(id);
  }

  report.finishedAt = utcNowIso();
  await logDecision(db, "scan_cycle", `Scan : ${report.inserted} nouvelles (${report.f1Count} F1, ${report.f2Count} F2), ${report.duplicates} doublons, top-${config.scanTopN} proposées.`, {
    actor: "agent",
    metadata: { platforms: report.platforms, proposedTopN: report.proposedTopN },
  });
  return report;
}

/**
 * Stocke une mission brute (dédupliquée) + scoring immédiat.
 * Retourne null si doublon (même plateforme + external_id).
 */
async function storeRawMission(
  db: D1Database,
  raw: RawMission,
): Promise<{ id: number; kind: MissionKind; score: number } | null> {
  const existing = await db
    .prepare("SELECT id FROM missions WHERE source_platform = ? AND external_id = ?")
    .bind(raw.platform, raw.externalId)
    .first<{ id: number }>();
  if (existing) return null;

  const kind: MissionKind = requiresHuman(raw.title, raw.summary) ? "f2_needs_human" : "f1_executable";
  const score = kind === "f1_executable"
    ? scoreMission({ amount: raw.amount, currency: raw.currency, acceptanceProba: raw.acceptanceProba, effortEstimateH: raw.effortEstimateH })
    : 0;

  const res = await db
    .prepare(
      `INSERT INTO missions (found_at, source_platform, external_id, title, url, amount, currency, kind, status, score, effort_estimate_h, acceptance_proba, deadline, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      utcNowIso(),
      raw.platform,
      raw.externalId,
      raw.title,
      raw.url,
      raw.amount,
      raw.currency,
      kind,
      "scored",
      score,
      raw.effortEstimateH,
      raw.acceptanceProba,
      raw.deadline,
      raw.summary,
    )
    .run();

  return { id: Number(res.meta.last_row_id), kind, score };
}
