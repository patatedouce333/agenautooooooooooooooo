/**
 * Paiements x402 (Coinbase facilitator — spec §12 : 1k settles/mois gratuits).
 *
 * Deux sens :
 * - ENTRANT : un client/agent paie PAYTO en USDC pour une mission F1 livrée
 *   → `POST /webhooks/x402` → vérification → `events(kind='sale')`.
 * - SORTANT : l'agent paie une micro-tâche x402 via SPEND (policy `spend`
 *   d'abord, facilitator ensuite).
 *
 * Idempotence : `payment_nonce` UNIQUE — même nonce deux fois = replay
 * sans double crédit (spec §10).
 */

import { recordEvent } from "../core/ledger";
import { logDecision } from "../db/queries";

export interface X402IncomingPayment {
  /** Nonce unique du paiement (idempotence). */
  paymentNonce: string;
  txHash?: string;
  amountUsdc: number;
  payer: string;
  missionId?: number | null;
  sourcePlatform?: string;
}

export type X402VerifyResult =
  | { ok: true; eventId: number; idempotentReplay: boolean }
  | { ok: false; reason: string };

/**
 * Vérifie (signature facilitator — stub documenté) puis enregistre un
 * paiement x402 entrant comme `sale` (ou `self_test` si payer ∈ own_wallets).
 *
 * PRODUCTION : remplacer `verifyFacilitatorSignature` par l'appel réel au
 * facilitator Coinbase CDP (cf. docs/LEDGER.md § x402).
 */
export async function verifyFacilitatorSignature(_payload: unknown): Promise<boolean> {
  // STUB EXPLICITE : en dev on accepte ; en prod, vérifier la signature
  // du facilitator avant d'appeler `recordIncomingX402Payment`.
  // Retourner false ici bloque l'encaissement (fail-closed).
  return true;
}

export async function recordIncomingX402Payment(
  db: D1Database,
  payment: X402IncomingPayment,
): Promise<X402VerifyResult> {
  if (payment.amountUsdc <= 0) return { ok: false, reason: "Montant x402 invalide." };
  if (!payment.paymentNonce) return { ok: false, reason: "Nonce x402 manquant (idempotence requise)." };

  const recorded = await recordEvent(db, {
    kind: "sale",
    amountUsdc: payment.amountUsdc,
    currency: "USDC",
    sourcePlatform: payment.sourcePlatform ?? "x402-bazaar",
    missionId: payment.missionId ?? null,
    txHash: payment.txHash ?? null,
    paymentNonce: payment.paymentNonce,
    payer: payment.payer,
  });
  if (!recorded.ok) return { ok: false, reason: recorded.reason };

  // Si rattaché à une mission et premier encaissement → statut `paid`.
  if (payment.missionId && !recorded.idempotentReplay) {
    await db.prepare("UPDATE missions SET status = 'paid' WHERE id = ? AND status = 'submitted'").bind(payment.missionId).run();
  }

  await logDecision(
    db,
    recorded.idempotentReplay ? "x402_replay" : "x402_sale",
    recorded.idempotentReplay
      ? `x402 replay idempotent (nonce ${payment.paymentNonce}).`
      : `x402 encaissé : ${payment.amountUsdc} USDC de ${payment.payer}.`,
    { actor: "system", metadata: { ...payment, eventId: recorded.eventId } },
  );
  return { ok: true, eventId: recorded.eventId, idempotentReplay: recorded.idempotentReplay };
}
