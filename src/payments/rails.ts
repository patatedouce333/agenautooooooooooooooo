/**
 * RAILS DE PAIEMENT — le wallet comme banque (spec §6).
 *
 *   PAYTO — reçoit TOUT (USDC x402, crypto bounties, freelance).
 *           Clé JAMAIS sur le serveur, ne signe rien (adresse seule).
 *   OPS   — admin (approbations, freeze, config). Solde symbolique (~2 USDC).
 *   SPEND — dépenses de l'agent (facilitator fees, micro-achats x402,
 *           avances F2). Plafonds stricts quotidiens (policy `spend`).
 *
 * Anti self-dealing : `own_wallets` explicite, versionnée, HITL pour ajout.
 * Tout transfert entre wallets propres = `transfer`, jamais du revenu.
 *
 * NOTE : ce module ne signe RIEN. Les signatures SPEND passent par le
 * facilitator x402 / le wallet externe ; ici on ne fait que tracer et
 * faire respecter les plafonds AVANT toute dépense réelle.
 */

import type { LoopConfig } from "../types";
import { utcNowIso } from "../types";
import { evaluatePolicy } from "../core/policy";
import { recordEvent } from "../core/ledger";
import { logDecision } from "../db/queries";

export type WalletRole = "PAYTO" | "OPS" | "SPEND" | "OTHER";

export interface SpendRequest {
  amountUsdc: number;
  /** Motif (facilitator fee, micro-achat x402, avance F2…). */
  purpose: string;
  missionId?: number | null;
  /** true si un HITL `spend` a approuvé cette dépense précise. */
  hitlApproved?: boolean;
  /** Hash de tx si la dépense est déjà exécutée on-chain. */
  txHash?: string | null;
}

export type SpendResult =
  | { ok: true; eventId: number; via: "auto" | "hitl" }
  | { ok: false; reason: string };

/**
 * Autorise (policy) puis trace une dépense SPEND.
 * À appeler AVANT toute dépense réelle ; en cas de refus, NE PAS dépenser.
 */
export async function authorizeAndRecordSpend(
  db: D1Database,
  config: LoopConfig,
  req: SpendRequest,
): Promise<SpendResult> {
  const verdict = await evaluatePolicy(db, config, {
    action: "spend",
    amountUsdc: req.amountUsdc,
    hitlApproved: req.hitlApproved,
    context: req.purpose,
  });
  if (!verdict.allowed) {
    await logDecision(db, "spend_denied", `${req.purpose} : ${verdict.reason}`, { actor: "agent" });
    return { ok: false, reason: verdict.reason };
  }

  const recorded = await recordEvent(db, {
    kind: "fee",
    amountUsdc: req.amountUsdc,
    currency: "USDC",
    missionId: req.missionId ?? null,
    txHash: req.txHash ?? null,
    costKind: "spend",
  });
  if (!recorded.ok) return { ok: false, reason: recorded.reason };

  await logDecision(db, "spend_authorized", `${req.purpose} : ${req.amountUsdc} USDC via ${verdict.via}.`, {
    actor: "agent",
    metadata: { amountUsdc: req.amountUsdc, via: verdict.via, eventId: recorded.eventId },
  });
  return { ok: true, eventId: recorded.eventId, via: verdict.via };
}

/**
 * Ajoute un wallet propre (HITL obligatoire — `wallet_add`).
 * Sans approbation, refus + traçage.
 */
export async function addOwnWallet(
  db: D1Database,
  address: string,
  role: WalletRole,
  addedBy: string,
  hitlApproved: boolean,
  note?: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!hitlApproved) {
    await logDecision(db, "wallet_add_denied", `Ajout ${address} (${role}) sans HITL — refusé.`, { actor: addedBy });
    return { ok: false, reason: "Ajout de wallet propre exige une approbation HITL (anti self-dealing)." };
  }
  await db
    .prepare("INSERT OR REPLACE INTO own_wallets (address, role, added_at, added_by, note) VALUES (?, ?, ?, ?, ?)")
    .bind(address.trim().toLowerCase(), role, utcNowIso(), addedBy, note ?? null)
    .run();
  await logDecision(db, "wallet_added", `Wallet ${address} (${role}) ajouté par ${addedBy}.`, { actor: addedBy });
  return { ok: true, reason: `Wallet ${address} enregistré comme ${role}.` };
}

/** Liste les wallets propres (pour le dashboard / l'audit). */
export async function listOwnWallets(db: D1Database): Promise<Array<{ address: string; role: string; added_at: string; added_by: string; note: string | null }>> {
  const { results } = await db
    .prepare("SELECT address, role, added_at, added_by, note FROM own_wallets ORDER BY added_at ASC")
    .all<{ address: string; role: string; added_at: string; added_by: string; note: string | null }>();
  return results ?? [];
}
