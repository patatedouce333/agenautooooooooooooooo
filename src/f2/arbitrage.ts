/**
 * F2 — ARBITRAGE HUMAIN (spec §5).
 *
 * Cycle :
 *   1. CHIFFRAGE   — marge = client − freelance − frais − réserve litige
 *                     − temps de contrôle. Si < seuil (15 €) → rejet.
 *   2. APPROBATION — HITL obligatoire, jamais automatique.
 *   3. RECRUTEMENT — contrat, brief, délai, critères de réception.
 *   4. LIVRAISON & CONTRÔLE — l'agent contrôle (cohérence, preuves…).
 *   5. PAIEMENT    — freelance payé, client facturé/encaissé ;
 *                     events `human_payout` (sortie) + `sale` (entrée).
 *
 * Garde-fous (spec §5) :
 * - aucune embauche sans client financeur confirmé ;
 * - pas d'escrow maison ; pas de crypto envoyée à un freelance sauf si la
 *   plateforme le gère elle-même ; toujours une facture (SIRET requis).
 */

import type { ArbitrageDeal, LoopConfig } from "../types";
import { utcNowIso } from "../types";
import { logDecision } from "../db/queries";

export interface QuoteInput {
  missionId?: number | null;
  clientPrice: number;
  currency?: string;
  freelancerCost: number;
  platformFees?: number;
  controlTimeCost?: number;
  freelancerContact?: string;
  freelancerPlatform?: string;
  notes?: string;
}

export type QuoteResult =
  | { ok: true; dealId: number; marginNet: number; deal: ArbitrageDeal }
  | { ok: false; reason: string };

/** Étape 1 — chiffrage. Crée le deal en `scouting`, ou rejette si marge < seuil. */
export async function quoteDeal(db: D1Database, config: LoopConfig, input: QuoteInput): Promise<QuoteResult> {
  if (input.clientPrice <= 0) return { ok: false, reason: "Prix client invalide." };
  if (input.freelancerCost < 0) return { ok: false, reason: "Coût freelance invalide." };

  const litigationReserve = round2(input.clientPrice * config.f2LitigationReserveRate);
  const marginNet = round2(
    input.clientPrice -
      input.freelancerCost -
      (input.platformFees ?? 0) -
      litigationReserve -
      (input.controlTimeCost ?? 0),
  );

  // Seuil en EUR ; si devise USDC on applique la parité 1:1.
  if (marginNet < config.f2MinMarginEur) {
    await logDecision(db, "f2_quote_rejected", `Deal rejeté : marge nette ${marginNet} < seuil ${config.f2MinMarginEur}.`, {
      actor: "agent",
      metadata: { ...input, litigationReserve, marginNet },
    });
    return {
      ok: false,
      reason: `Marge nette ${marginNet} ${input.currency ?? "EUR"} < seuil ${config.f2MinMarginEur} — deal rejeté.`,
    };
  }

  const res = await db
    .prepare(
      `INSERT INTO arbitrage_deals (mission_id, client_price, freelancer_cost, platform_fees, litigation_reserve, control_time_cost, currency, freelancer_contact, freelancer_platform, status, created_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scouting', ?, ?)`,
    )
    .bind(
      input.missionId ?? null,
      input.clientPrice,
      input.freelancerCost,
      input.platformFees ?? 0,
      litigationReserve,
      input.controlTimeCost ?? 0,
      input.currency ?? "EUR",
      input.freelancerContact ?? null,
      input.freelancerPlatform ?? null,
      utcNowIso(),
      input.notes ?? null,
    )
    .run();

  const dealId = Number(res.meta.last_row_id);
  const deal = await db.prepare("SELECT * FROM arbitrage_deals WHERE id = ?").bind(dealId).first<ArbitrageDeal>();
  await logDecision(db, "f2_quoted", `Deal F2 #${dealId} chiffré : marge nette ${marginNet}. En attente HITL.`, {
    actor: "agent",
    metadata: { dealId, marginNet },
  });
  return { ok: true, dealId, marginNet, deal: deal as ArbitrageDeal };
}

/** Étape 2 — l'humain approuve (via HITL `f2_deal`) → `proposed`. */
export async function proposeDeal(db: D1Database, dealId: number, approvedBy: string): Promise<ArbitrageDeal | null> {
  await db
    .prepare("UPDATE arbitrage_deals SET status = 'proposed', hitl_approved_at = ?, hitl_approved_by = ? WHERE id = ? AND status = 'scouting'")
    .bind(utcNowIso(), approvedBy, dealId)
    .run();
  const deal = await db.prepare("SELECT * FROM arbitrage_deals WHERE id = ?").bind(dealId).first<ArbitrageDeal>();
  if (deal) {
    await logDecision(db, "f2_proposed", `Deal F2 #${dealId} approuvé par ${approvedBy} — recrutement autorisé.`, { actor: approvedBy });
  }
  return deal;
}

/** Étape 3 — recrutement (après HITL). */
export async function markHired(db: D1Database, dealId: number, freelancerContact: string): Promise<void> {
  await db
    .prepare("UPDATE arbitrage_deals SET status = 'hired', freelancer_contact = ? WHERE id = ? AND status = 'proposed'")
    .bind(freelancerContact, dealId)
    .run();
  await logDecision(db, "f2_hired", `Deal F2 #${dealId} : freelance recruté (${freelancerContact}).`, { actor: "agent" });
}

/** Étape 4 — livraison contrôlée par l'agent. */
export async function markDelivered(db: D1Database, dealId: number, controlNotes: string): Promise<void> {
  await db.prepare("UPDATE arbitrage_deals SET status = 'delivered', notes = COALESCE(notes,'') || ? WHERE id = ? AND status = 'hired'").bind(`\n[contrôle] ${controlNotes}`, dealId).run();
  await logDecision(db, "f2_delivered", `Deal F2 #${dealId} livré et contrôlé.`, { actor: "agent" });
}

/**
 * Étape 5 — clôture financière : le freelance est payé (human_payout) et le
 * client a payé (sale). Les deux événements ledger doivent être enregistrés
 * par l'appelant AVANT d'appeler cette fonction (traçabilité).
 */
export async function markPaid(db: D1Database, dealId: number): Promise<void> {
  const now = utcNowIso();
  await db
    .prepare("UPDATE arbitrage_deals SET status = 'paid', human_payout_at = COALESCE(human_payout_at, ?), client_paid_at = COALESCE(client_paid_at, ?) WHERE id = ? AND status = 'delivered'")
    .bind(now, now, dealId)
    .run();
  await logDecision(db, "f2_paid", `Deal F2 #${dealId} soldé (freelance payé, client encaissé).`, { actor: "agent" });
}

export async function cancelDeal(db: D1Database, dealId: number, reason: string): Promise<void> {
  await db.prepare("UPDATE arbitrage_deals SET status = 'cancelled', notes = COALESCE(notes,'') || ? WHERE id = ?").bind(`\n[annulé] ${reason}`, dealId).run();
  await logDecision(db, "f2_cancelled", `Deal F2 #${dealId} annulé : ${reason}`, { actor: "agent" });
}

export async function getDeal(db: D1Database, dealId: number): Promise<ArbitrageDeal | null> {
  return db.prepare("SELECT * FROM arbitrage_deals WHERE id = ?").bind(dealId).first<ArbitrageDeal>();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
