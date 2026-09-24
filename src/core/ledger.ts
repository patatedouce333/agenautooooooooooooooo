/**
 * loop v2 — LEDGER (spec §6 + §8).
 *
 * Le wallet est la banque : PAYTO reçoit tout, OPS administre, SPEND dépense.
 * Ce module garantit :
 *  - append-only : on n'update JAMAIS un événement financier ;
 *  - anti self-dealing : les mouvements entre wallets propres (`own_wallets`)
 *    sont tracés comme `transfer` / `self_test` et EXCLUS du revenu ;
 *  - idempotence : `tx_hash` et `payment_nonce` uniques → double soumission
 *    du même paiement = réponse idempotente, aucun double crédit.
 *
 * KPI quotidien (spec §8) :
 *   Revenu = SUM(sale, payer NOT IN own_wallets, jour J)
 *   Coûts  = SUM(fee) + SUM(human_payout) + SUM(api_cost)
 *   Net    = Revenu − Coûts
 */

import type { DailyKpi, Env, EventKind, LedgerEvent } from "../types";
import { utcNowIso } from "../types";

export interface RecordEventInput {
  kind: EventKind;
  amountUsdc: number | null;
  currency?: string | null;
  sourcePlatform?: string | null;
  missionId?: number | null;
  txHash?: string | null;
  paymentNonce?: string | null;
  payer?: string | null;
  costKind?: string | null;
}

export type RecordEventResult =
  | { ok: true; idempotentReplay: false; eventId: number }
  | { ok: true; idempotentReplay: true; eventId: number; reason: string }
  | { ok: false; reason: string };

/** Normalise une adresse pour comparaison (lowercase, trim). */
export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  return address.trim().toLowerCase();
}

/** true si l'adresse appartient à `own_wallets` (anti self-dealing). */
export async function isOwnWallet(db: D1Database, address: string | null | undefined): Promise<boolean> {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  const row = await db
    .prepare("SELECT address FROM own_wallets WHERE LOWER(address) = ?")
    .bind(normalized)
    .first<{ address: string }>();
  return row !== null;
}

/**
 * Enregistre un événement financier.
 * - Si `payer` ∈ own_wallets et kind='sale' → requalifié en `self_test`
 *   (jamais compté comme revenu).
 * - Si `tx_hash`/`payment_nonce` déjà vu → replay idempotent.
 */
export async function recordEvent(db: D1Database, input: RecordEventInput): Promise<RecordEventResult> {
  let kind = input.kind;

  // ── Anti self-dealing (spec §6) ──
  if (kind === "sale" && (await isOwnWallet(db, input.payer))) {
    kind = "self_test";
  }

  // ── Idempotence : nonce déjà vu ? ──
  if (input.paymentNonce) {
    const existing = await db
      .prepare("SELECT id FROM events WHERE payment_nonce = ?")
      .bind(input.paymentNonce)
      .first<{ id: number }>();
    if (existing) {
      return {
        ok: true,
        idempotentReplay: true,
        eventId: existing.id,
        reason: `Nonce ${input.paymentNonce} déjà enregistré (événement #${existing.id}) — aucun double crédit.`,
      };
    }
  }
  if (input.txHash) {
    const existing = await db
      .prepare("SELECT id FROM events WHERE tx_hash = ?")
      .bind(input.txHash)
      .first<{ id: number }>();
    if (existing) {
      return {
        ok: true,
        idempotentReplay: true,
        eventId: existing.id,
        reason: `tx ${input.txHash} déjà enregistré (événement #${existing.id}) — aucun double crédit.`,
      };
    }
  }

  try {
    const res = await db
      .prepare(
        `INSERT INTO events (ts, kind, amount_usdc, currency, source_platform, mission_id, tx_hash, payment_nonce, payer, cost_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        utcNowIso(),
        kind,
        input.amountUsdc,
        input.currency ?? null,
        input.sourcePlatform ?? null,
        input.missionId ?? null,
        input.txHash ?? null,
        input.paymentNonce ?? null,
        normalizeAddress(input.payer),
        input.costKind ?? null,
      )
      .run();
    return { ok: true, idempotentReplay: false, eventId: Number(res.meta.last_row_id) };
  } catch (err) {
    // Contrainte UNIQUE (course entre deux requêtes) → rejouer en lecture.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE")) {
      const existing = input.paymentNonce
        ? await db.prepare("SELECT id FROM events WHERE payment_nonce = ?").bind(input.paymentNonce).first<{ id: number }>()
        : await db.prepare("SELECT id FROM events WHERE tx_hash = ?").bind(input.txHash).first<{ id: number }>();
      if (existing) {
        return { ok: true, idempotentReplay: true, eventId: existing.id, reason: "Écriture concurrente — replay idempotent." };
      }
    }
    return { ok: false, reason: `Échec d'enregistrement ledger : ${message}` };
  }
}

/** Liste paginée des événements (plus récents d'abord). */
export async function listEvents(db: D1Database, limit = 50, offset = 0): Promise<LedgerEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<LedgerEvent>();
  return results ?? [];
}

/**
 * KPI d'une journée (spec §8). `date` au format YYYY-MM-DD (UTC).
 * EUR estimé à parité 1 USDC ≈ 1 € (taux configurable plus tard).
 */
export async function computeDailyKpi(db: D1Database, date: string): Promise<DailyKpi> {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const revenue = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_usdc), 0) AS total, COUNT(*) AS n
       FROM events
       WHERE kind = 'sale' AND ts >= ? AND ts <= ?
         AND (payer IS NULL OR LOWER(payer) NOT IN (SELECT LOWER(address) FROM own_wallets))`,
    )
    .bind(dayStart, dayEnd)
    .first<{ total: number; n: number }>();

  const costs = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_usdc), 0) AS total
       FROM events
       WHERE kind IN ('fee', 'human_payout', 'api_cost') AND ts >= ? AND ts <= ?`,
    )
    .bind(dayStart, dayEnd)
    .first<{ total: number }>();

  const missionsDetected = await db
    .prepare("SELECT COUNT(*) AS n FROM missions WHERE substr(found_at, 1, 10) = ?")
    .bind(date)
    .first<{ n: number }>();

  const missionsExecuted = await db
    .prepare("SELECT COUNT(*) AS n FROM missions WHERE status IN ('submitted', 'paid') AND substr(found_at, 1, 10) = ?")
    .bind(date)
    .first<{ n: number }>();

  const missionsPending = await db
    .prepare("SELECT COUNT(*) AS n FROM missions WHERE status = 'proposed'")
    .bind()
    .first<{ n: number }>();

  const dealsActive = await db
    .prepare("SELECT COUNT(*) AS n FROM arbitrage_deals WHERE status IN ('scouting', 'proposed', 'hired', 'delivered')")
    .bind()
    .first<{ n: number }>();

  const revenueUsdc = revenue?.total ?? 0;
  const costsUsdc = costs?.total ?? 0;
  return {
    date,
    revenue_usdc: round2(revenueUsdc),
    revenue_eur_estimate: round2(revenueUsdc), // parité 1:1 par défaut
    costs_usdc: round2(costsUsdc),
    net_usdc: round2(revenueUsdc - costsUsdc),
    sales_count: revenue?.n ?? 0,
    missions_detected: missionsDetected?.n ?? 0,
    missions_executed: missionsExecuted?.n ?? 0,
    missions_pending_hitl: missionsPending?.n ?? 0,
    deals_active: dealsActive?.n ?? 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Garde-fou build : ce module ne doit JAMAIS importer de code trading. */
export function assertNoTradingModule(): void {
  // Intentionnellement vide : l'absence de module trading est vérifiée
  // par construction (aucun fichier trade* dans src/) et par test.
  void 0 as never as Env | undefined;
}
