/**
 * loop v2 — types partagés.
 *
 * Conventions :
 * - les montants financiers sont en `number` (REAL SQLite) ;
 * - les dates sont des chaînes ISO-8601 UTC (`TEXT` SQLite) ;
 * - `Env` décrit les bindings Cloudflare Workers (D1 + secrets).
 */

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  // Banque (adresses — la clé PAYTO n'est JAMAIS sur le serveur)
  PAYTO_ADDRESS?: string;
  OPS_ADDRESS?: string;
  SPEND_ADDRESS?: string;
  SPEND_PRIVATE_KEY?: string;
  // Policy
  DAILY_SPEND_LIMIT_USDC?: string;
  F2_MIN_MARGIN_EUR?: string;
  F2_LITIGATION_RESERVE_RATE?: string;
  SCAN_TOP_N?: string;
  // Connecteurs
  GITHUB_TOKEN?: string;
  ALGORA_API_KEY?: string;
  GITCOIN_API_KEY?: string;
  DEWORK_API_KEY?: string;
  X402_BAZAAR_URL?: string;
  RENTAHUMAN_API_KEY?: string;
}

// ── Missions (spec §8) ─────────────────────────────────────────

export type MissionKind = "f1_executable" | "f2_needs_human";

export type MissionStatus =
  | "detected"
  | "scored"
  | "proposed"
  | "approved"
  | "executing"
  | "submitted"
  | "paid"
  | "failed";

export interface Mission {
  id: number;
  found_at: string;
  source_platform: string;
  external_id: string | null;
  title: string | null;
  url: string | null;
  amount: number | null;
  currency: string | null; // USDC | EUR
  kind: MissionKind;
  status: MissionStatus;
  score: number | null;
  effort_estimate_h: number | null;
  acceptance_proba: number | null;
  hitl_approved_at: string | null;
  hitl_approved_by: string | null;
  submitted_via: "auto" | "human" | null;
  submitted_at: string | null;
  deliverable_ref: string | null;
  draft_text: string | null;
  deadline: string | null;
  notes: string | null;
}

// ── Arbitrage F2 (spec §8) ─────────────────────────────────────

export type ArbitrageStatus =
  | "scouting"
  | "proposed"
  | "hired"
  | "delivered"
  | "paid"
  | "cancelled";

export interface ArbitrageDeal {
  id: number;
  mission_id: number | null;
  client_price: number;
  freelancer_cost: number | null;
  platform_fees: number | null;
  litigation_reserve: number | null;
  control_time_cost: number | null;
  margin_net: number | null; // colonne GENERATED
  currency: string | null;
  freelancer_contact: string | null;
  freelancer_platform: string | null;
  status: ArbitrageStatus;
  hitl_approved_at: string | null;
  hitl_approved_by: string | null;
  human_payout_at: string | null;
  client_paid_at: string | null;
  created_at: string;
  notes: string | null;
}

// ── Ledger (spec §8) ───────────────────────────────────────────

export type EventKind =
  | "sale"
  | "self_test"
  | "transfer"
  | "fee"
  | "human_payout"
  | "api_cost";

export interface LedgerEvent {
  id: number;
  ts: string;
  kind: EventKind;
  amount_usdc: number | null;
  currency: string | null;
  source_platform: string | null;
  mission_id: number | null;
  tx_hash: string | null;
  payment_nonce: string | null;
  payer: string | null;
  cost_kind: string | null;
}

// ── Plateformes / ToS (spec §3) ────────────────────────────────

export interface PlatformRule {
  platform: string;
  can_scan: number; // SQLite BOOLEAN → 0/1
  can_prepare: number;
  can_auto_submit: number;
  requires_hitl_for_submit: number;
  notes_tos: string | null;
  last_verified_at: string | null;
}

// ── HITL ───────────────────────────────────────────────────────

export type HitlKind =
  | "mission_batch"
  | "f2_deal"
  | "spend"
  | "wallet_add"
  | "unfreeze"
  | "generic";

export type HitlStatus = "pending" | "approved" | "denied" | "expired";

export interface HitlRequest {
  id: number;
  created_at: string;
  expires_at: string;
  kind: HitlKind;
  ref_type: string | null;
  ref_id: number | null;
  payload: string; // JSON
  status: HitlStatus;
  resolved_at: string | null;
  resolved_by: string | null;
}

// ── Audit ──────────────────────────────────────────────────────

export interface Decision {
  id: number;
  ts: string;
  action: string;
  reason: string | null;
  actor: string | null;
  metadata: string | null;
  prev_hash: string | null;
  hash: string;
}

// ── KPI quotidien (spec §8) ────────────────────────────────────

export interface DailyKpi {
  date: string; // YYYY-MM-DD
  revenue_usdc: number;
  revenue_eur_estimate: number;
  costs_usdc: number;
  net_usdc: number;
  sales_count: number;
  missions_detected: number;
  missions_executed: number;
  missions_pending_hitl: number;
  deals_active: number;
}

// ── Config runtime (résolue depuis Env + défauts spec) ─────────

export interface LoopConfig {
  dailySpendLimitUsdc: number;
  f2MinMarginEur: number;
  f2LitigationReserveRate: number;
  scanTopN: number;
}

export function resolveConfig(env: Partial<Env>): LoopConfig {
  return {
    dailySpendLimitUsdc: Number(env.DAILY_SPEND_LIMIT_USDC ?? "1"),
    f2MinMarginEur: Number(env.F2_MIN_MARGIN_EUR ?? "15"),
    f2LitigationReserveRate: Number(env.F2_LITIGATION_RESERVE_RATE ?? "0.10"),
    scanTopN: Number(env.SCAN_TOP_N ?? "5"),
  };
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
