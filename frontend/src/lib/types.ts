/** Types miroirs de l'API Workers (cf. src/types.ts côté backend). */

export interface Mission {
  id: number;
  found_at: string;
  source_platform: string;
  external_id: string | null;
  title: string | null;
  url: string | null;
  amount: number | null;
  currency: string | null;
  kind: "f1_executable" | "f2_needs_human";
  status: string;
  score: number | null;
  submitted_via: "auto" | "human" | null;
  deadline: string | null;
}

export interface ArbitrageDeal {
  id: number;
  mission_id: number | null;
  client_price: number;
  freelancer_cost: number | null;
  platform_fees: number | null;
  litigation_reserve: number | null;
  control_time_cost: number | null;
  margin_net: number | null;
  currency: string | null;
  freelancer_contact: string | null;
  freelancer_platform: string | null;
  status: string;
}

export interface LedgerEvent {
  id: number;
  ts: string;
  kind: string;
  amount_usdc: number | null;
  currency: string | null;
  source_platform: string | null;
  mission_id: number | null;
  tx_hash: string | null;
  payer: string | null;
  cost_kind: string | null;
}

export interface PlatformRule {
  platform: string;
  can_scan: number;
  can_prepare: number;
  can_auto_submit: number;
  requires_hitl_for_submit: number;
  notes_tos: string | null;
  last_verified_at: string | null;
}

export interface DailyKpi {
  date: string;
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

export interface HitlRequest {
  id: number;
  created_at: string;
  expires_at: string;
  kind: string;
  ref_type: string | null;
  ref_id: number | null;
  payload: string;
  status: string;
}

export interface SystemStatus {
  freeze: boolean;
  degradedMode: boolean;
  quotas: Record<string, { used: number; limit: number; ratio: number }>;
  pendingHitl: HitlRequest[];
  kpiToday: DailyKpi;
  config: {
    dailySpendLimitUsdc: number;
    f2MinMarginEur: number;
    f2LitigationReserveRate: number;
    scanTopN: number;
  };
  version: string;
}

export interface BySource {
  platform: string | null;
  revenue: number;
  sales: number;
}
