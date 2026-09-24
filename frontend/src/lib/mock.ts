/**
 * Données de démonstration — utilisées quand l'API est injoignable
 * (VITE_MOCK_FALLBACK=true) pour que le dashboard soit explorable sans backend.
 * Un bandeau « MODE DÉMO » le signale explicitement dans l'UI.
 */
import type { ArbitrageDeal, BySource, DailyKpi, LedgerEvent, Mission, PlatformRule, SystemStatus } from "./types";

const now = new Date();
const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();
const today = now.toISOString().slice(0, 10);

export const mockKpi: DailyKpi = {
  date: today,
  revenue_usdc: 187.5,
  revenue_eur_estimate: 187.5,
  costs_usdc: 24.3,
  net_usdc: 163.2,
  sales_count: 4,
  missions_detected: 23,
  missions_executed: 3,
  missions_pending_hitl: 2,
  deals_active: 1,
};

export const mockBySource: BySource[] = [
  { platform: "x402-bazaar", revenue: 120, sales: 2 },
  { platform: "gitcoin", revenue: 45, sales: 1 },
  { platform: "dework", revenue: 22.5, sales: 1 },
];

export const mockMissions: Mission[] = [
  { id: 101, found_at: iso(3), source_platform: "x402-bazaar", external_id: "x402-881", title: "Générer un dataset d'évaluation FR pour un agent support", url: "https://bazaar.example.com/tasks/x402-881", amount: 80, currency: "USDC", kind: "f1_executable", status: "submitted", score: 64, submitted_via: "auto", deadline: null },
  { id: 102, found_at: iso(5), source_platform: "algora", external_id: "gh-99121", title: "Fix: race condition dans le parser Rust (issue #441)", url: "https://github.com", amount: 250, currency: "USDC", kind: "f1_executable", status: "proposed", score: 62.5, submitted_via: null, deadline: null },
  { id: 103, found_at: iso(6), source_platform: "gitcoin", external_id: "gc-552", title: "Audit de sécurité d'un contrat de vesting (Solidity)", url: "https://app.gitcoin.co", amount: 400, currency: "USDC", kind: "f1_executable", status: "approved", score: 56, submitted_via: null, deadline: null },
  { id: 104, found_at: iso(8), source_platform: "dework", external_id: "dw-2091", title: "Rédiger la documentation API d'un SDK TypeScript", url: "https://app.dework.xyz", amount: 120, currency: "USDC", kind: "f1_executable", status: "executing", score: 48, submitted_via: null, deadline: null },
  { id: 105, found_at: iso(9), source_platform: "upwork", external_id: "uw-7712", title: "Analyse de données e-commerce + dashboard (Python)", url: "https://upwork.com", amount: 300, currency: "USDC", kind: "f1_executable", status: "proposed", score: 45, submitted_via: null, deadline: null },
  { id: 106, found_at: iso(12), source_platform: "malt", external_id: "malt-3301", title: "Photos géolocalisées d'une vitrine à Lyon + vérification", url: "https://malt.fr", amount: 90, currency: "EUR", kind: "f2_needs_human", status: "scored", score: 0, submitted_via: null, deadline: null },
];

export const mockDeals: ArbitrageDeal[] = [
  { id: 7, mission_id: 106, client_price: 290, freelancer_cost: 150, platform_fees: 29, litigation_reserve: 29, control_time_cost: 20, margin_net: 62, currency: "EUR", freelancer_contact: "lea.photo@exemple.fr", freelancer_platform: "malt", status: "proposed" },
  { id: 6, mission_id: null, client_price: 450, freelancer_cost: 260, platform_fees: 45, litigation_reserve: 45, control_time_cost: 30, margin_net: 70, currency: "EUR", freelancer_contact: "marc.insp@exemple.fr", freelancer_platform: "comeup", status: "delivered" },
];

export const mockEvents: LedgerEvent[] = [
  { id: 31, ts: iso(2), kind: "sale", amount_usdc: 80, currency: "USDC", source_platform: "x402-bazaar", mission_id: 101, tx_hash: "0xabc…01", payer: "0xClientAAA", cost_kind: null },
  { id: 30, ts: iso(4), kind: "fee", amount_usdc: 0.8, currency: "USDC", source_platform: "x402-bazaar", mission_id: 101, tx_hash: null, payer: null, cost_kind: "facilitator" },
  { id: 29, ts: iso(7), kind: "sale", amount_usdc: 45, currency: "USDC", source_platform: "gitcoin", mission_id: null, tx_hash: "0xdef…02", payer: "0xClientBBB", cost_kind: null },
  { id: 28, ts: iso(11), kind: "human_payout", amount_usdc: 150, currency: "USDC", source_platform: "malt", mission_id: null, tx_hash: null, payer: null, cost_kind: null },
  { id: 27, ts: iso(13), kind: "api_cost", amount_usdc: 3.5, currency: "USDC", source_platform: null, mission_id: null, tx_hash: null, payer: null, cost_kind: "llm" },
  { id: 26, ts: iso(20), kind: "self_test", amount_usdc: 1, currency: "USDC", source_platform: null, mission_id: null, tx_hash: null, payer: "0xpayto…self", cost_kind: null },
];

export const mockRules: PlatformRule[] = [
  { platform: "x402-bazaar", can_scan: 1, can_prepare: 1, can_auto_submit: 1, requires_hitl_for_submit: 0, notes_tos: "Agent-natif : paiement USDC automatique.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "algora", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "INTERDIT : robotic access interdit.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "gitcoin", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "Relire CGU avant auto-submit.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "dework", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "Relire CGU avant auto-submit.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "superteam", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "Relire CGU avant auto-submit.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "upwork", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "INTERDIT : bots interdits sur candidatures.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "malt", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "Humain valide et envoie.", last_verified_at: "2026-09-24T00:00:00Z" },
  { platform: "comeup", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1, notes_tos: "Humain valide et envoie.", last_verified_at: "2026-09-24T00:00:00Z" },
];

export const mockStatus: SystemStatus = {
  freeze: false,
  degradedMode: false,
  quotas: {
    scan: { used: 34, limit: 500, ratio: 0.068 },
    llm_call: { used: 212, limit: 1000, ratio: 0.212 },
    telegram_msg: { used: 41, limit: 1000, ratio: 0.041 },
    d1_write: { used: 1830, limit: 50000, ratio: 0.037 },
    subrequest: { used: 402, limit: 50000, ratio: 0.008 },
  },
  pendingHitl: [
    { id: 12, created_at: iso(1), expires_at: iso(-11), kind: "mission_batch", ref_type: "missions", ref_id: null, payload: JSON.stringify({ missionIds: [102, 105] }), status: "pending" },
    { id: 11, created_at: iso(4), expires_at: iso(-8), kind: "f2_deal", ref_type: "arbitrage_deals", ref_id: 7, payload: JSON.stringify({ dealId: 7 }), status: "pending" },
  ],
  kpiToday: mockKpi,
  config: { dailySpendLimitUsdc: 1, f2MinMarginEur: 15, f2LitigationReserveRate: 0.1, scanTopN: 5 },
  version: "2.0.0",
};

export const mockByDate = (date: string): DailyKpi => ({ ...mockKpi, date });
