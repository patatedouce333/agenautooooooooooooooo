/**
 * loop v2 — POLICY ENGINE (spec §7).
 *
 * « Pas de mandat/AP2 complexe. Une seule logique : autoriser ou bloquer
 *   selon quatre règles. »
 *
 * Les 4 règles dures :
 *   1. PLAFOND D'APPROBATION — toute sortie SPEND au-dessus de X USDC/jour
 *      exige un HITL. Commence bas (1 USDC/jour).
 *   2. MATRICE ToS — toute action `submit` sur une plateforme avec
 *      `can_auto_submit = false` est bloquée côté serveur. Toute plateforme
 *      non listée = refus + attente d'approbation humaine.
 *   3. AUCUN TRADING — aucune route, aucun module, aucune clé d'exchange.
 *      `guardNoTrading()` refuse par construction toute action de trade.
 *   4. FREEZE — flag D1 `system_flags['freeze']` lu à chaque action sortante.
 *
 * Le LLM propose des actions ; ce module autorise ou refuse. Le LLM ne
 * décide JAMAIS seul d'une dépense ni d'une soumission interdite.
 */

import type { Env, LoopConfig } from "../types";
import { getFlag, getPlatformRule, getSpendTotalSince } from "../db/queries";

// ── Types ──────────────────────────────────────────────────────

export type PolicyAction =
  | "spend" // sortie d'argent via SPEND
  | "submit" // soumission d'une mission/livrable sur une plateforme
  | "scan" // lecture/veille (toujours douce, mais tracée)
  | "hire" // recrutement d'un freelance (F2)
  | "trade"; // INTERDIT par construction (spec §7 + §13)

export interface PolicyRequest {
  action: PolicyAction;
  /** Montant concerné (USDC) pour `spend` / `hire`. */
  amountUsdc?: number;
  /** Plateforme concernée pour `submit` / `scan`. */
  platform?: string;
  /** true si un HITL a déjà approuvé cette action précise. */
  hitlApproved?: boolean;
  /** Contexte libre pour l'audit. */
  context?: string;
}

export type PolicyVerdict =
  | { allowed: true; via: "auto" | "hitl"; reason: string }
  | { allowed: false; reason: string; requiresHitl: boolean };

// ── Règle 3 : AUCUN TRADING — par construction ─────────────────
// NOTE INTENTIONNELLE : il n'existe AUCUNE route, AUCUN module,
// AUCUNE clé liée à des exchanges de trading dans ce dépôt.
// Cette garde existe pour que tout appel accidentel/futur soit
// refusé explicitement et tracé dans l'audit.

export function guardNoTrading(action: string): PolicyVerdict | null {
  const normalized = action.toLowerCase().trim();
  const tradeKeywords = [
    "trade",
    "swap",
    "long",
    "short",
    "leverage",
    "margin",
    "perp",
    "futures",
    "options",
    "paper_trade",
  ];
  if (normalized === "trade" || tradeKeywords.includes(normalized)) {
    return {
      allowed: false,
      requiresHitl: false,
      reason:
        "REFUSÉ — trading interdit par construction (spec §7/§13 : aucun module trading, même pas paper).",
    };
  }
  return null;
}

// ── Évaluation principale ──────────────────────────────────────

export async function evaluatePolicy(
  db: D1Database,
  config: LoopConfig,
  req: PolicyRequest,
): Promise<PolicyVerdict> {
  // Règle 3 d'abord : le trading ne passe JAMAIS, HITL ou pas.
  const tradeGuard = guardNoTrading(req.action);
  if (tradeGuard) return tradeGuard;

  // Règle 4 : freeze — lu à chaque action sortante (spend/submit/hire).
  if (req.action === "spend" || req.action === "submit" || req.action === "hire") {
    const frozen = await getFlag(db, "freeze");
    if (frozen === "true") {
      return {
        allowed: false,
        requiresHitl: false,
        reason:
          "REFUSÉ — système gelé (freeze=true). Telegram /unfreeze (double confirmation) requis.",
      };
    }
  }

  switch (req.action) {
    case "spend":
      return evaluateSpend(db, config, req);
    case "hire":
      // F2 : l'embauche exige TOUJOURS un HITL (spec §5), quel que soit le montant.
      if (req.hitlApproved) {
        return {
          allowed: true,
          via: "hitl",
          reason: "Embauche F2 autorisée via approbation humaine.",
        };
      }
      return {
        allowed: false,
        requiresHitl: true,
        reason:
          "BLOQUÉ — toute embauche F2 exige une approbation HITL (spec §5 : jamais automatique).",
      };
    case "submit":
      return evaluateSubmit(db, req);
    case "scan":
      return evaluateScan(db, req);
    default:
      return {
        allowed: false,
        requiresHitl: true,
        reason: `BLOQUÉ — action inconnue '${req.action}'. Ajout en attente d'approbation humaine.`,
      };
  }
}

// ── Règle 1 : plafond SPEND ────────────────────────────────────

async function evaluateSpend(
  db: D1Database,
  config: LoopConfig,
  req: PolicyRequest,
): Promise<PolicyVerdict> {
  const amount = req.amountUsdc ?? 0;
  if (amount <= 0) {
    return { allowed: false, requiresHitl: true, reason: "BLOQUÉ — montant invalide." };
  }
  if (req.hitlApproved) {
    return { allowed: true, via: "hitl", reason: "Dépense autorisée via approbation humaine." };
  }
  const spentToday = await getSpendTotalSince(db, startOfTodayUtcIso());
  const projected = spentToday + amount;
  if (projected > config.dailySpendLimitUsdc) {
    return {
      allowed: false,
      requiresHitl: true,
      reason:
        `BLOQUÉ — plafond SPEND dépassé : ${spentToday.toFixed(4)} déjà dépensés + ` +
        `${amount.toFixed(4)} demandés > ${config.dailySpendLimitUsdc} USDC/jour. HITL requis.`,
    };
  }
  return {
    allowed: true,
    via: "auto",
    reason: `Dépense ${amount.toFixed(4)} USDC dans le plafond (${projected.toFixed(4)}/${config.dailySpendLimitUsdc} USDC).`,
  };
}

// ── Règle 2 : matrice ToS ──────────────────────────────────────

async function evaluateSubmit(db: D1Database, req: PolicyRequest): Promise<PolicyVerdict> {
  if (!req.platform) {
    return { allowed: false, requiresHitl: true, reason: "BLOQUÉ — plateforme de soumission manquante." };
  }
  const rule = await getPlatformRule(db, req.platform);
  if (!rule) {
    // Spec §3 : plateforme non listée = refus + attente d'approbation humaine.
    return {
      allowed: false,
      requiresHitl: true,
      reason:
        `BLOQUÉ — plateforme '${req.platform}' inconnue (non listée dans platform_rules). ` +
        `Refus + ajout en attente d'approbation humaine.`,
    };
  }
  if (rule.can_auto_submit === 1) {
    return {
      allowed: true,
      via: "auto",
      reason: `Auto-submit autorisé sur '${req.platform}' (matrice ToS).`,
    };
  }
  // can_auto_submit = false → bloqué côté serveur, l'humain soumet.
  return {
    allowed: false,
    requiresHitl: true,
    reason:
      `BLOQUÉ — auto-submit interdit sur '${req.platform}' (ToS : ${rule.notes_tos ?? "bots interdits"}). ` +
      `L'agent prépare le draft, l'humain clique.`,
  };
}

async function evaluateScan(db: D1Database, req: PolicyRequest): Promise<PolicyVerdict> {
  if (!req.platform) {
    return { allowed: true, via: "auto", reason: "Scan générique autorisé." };
  }
  const rule = await getPlatformRule(db, req.platform);
  if (!rule) {
    return {
      allowed: false,
      requiresHitl: true,
      reason: `BLOQUÉ — plateforme '${req.platform}' inconnue. Approbation humaine requise avant tout scan.`,
    };
  }
  if (rule.can_scan !== 1) {
    return {
      allowed: false,
      requiresHitl: false,
      reason: `REFUSÉ — scan interdit sur '${req.platform}' (matrice ToS).`,
    };
  }
  return { allowed: true, via: "auto", reason: `Scan autorisé sur '${req.platform}'.` };
}

function startOfTodayUtcIso(): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return start.toISOString();
}

/** Résout la config depuis l'environnement Workers. */
export function configFromEnv(env: Env): LoopConfig {
  return {
    dailySpendLimitUsdc: Number(env.DAILY_SPEND_LIMIT_USDC ?? "1"),
    f2MinMarginEur: Number(env.F2_MIN_MARGIN_EUR ?? "15"),
    f2LitigationReserveRate: Number(env.F2_LITIGATION_RESERVE_RATE ?? "0.10"),
    scanTopN: Number(env.SCAN_TOP_N ?? "5"),
  };
}
