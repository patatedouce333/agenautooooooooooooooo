/**
 * Client API du Worker + repli démo.
 *
 * - `VITE_API_URL` : base de l'API (ex. https://loop-agent.xxx.workers.dev).
 *   Vide → requêtes relatives (même origine / proxy /api en dev).
 * - Si l'API est injoignable et `VITE_MOCK_FALLBACK=true` → données mock
 *   (bandeau MODE DÉMO dans l'UI). Les actions d'écriture sont alors
 *   simulées localement (refusées proprement avec un message).
 */

import type { ArbitrageDeal, BySource, DailyKpi, LedgerEvent, Mission, PlatformRule, SystemStatus } from "./types";
import { mockBySource, mockDeals, mockEvents, mockKpi, mockMissions, mockRules, mockStatus } from "./mock";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const MOCK_FALLBACK = (import.meta.env.VITE_MOCK_FALLBACK as string | undefined ?? "true") !== "false";

export let demoMode = false;
const listeners = new Set<(demo: boolean) => void>();
export function onDemoChange(fn: (demo: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setDemo(v: boolean) {
  if (demoMode !== v) {
    demoMode = v;
    listeners.forEach((fn) => fn(v));
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `API ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Lecture avec repli mock : retourne [données, estDémo]. */
async function read<T>(path: string, mock: T): Promise<T> {
  if (!MOCK_FALLBACK) {
    setDemo(false);
    return req<T>(path);
  }
  try {
    const data = await req<T>(path);
    setDemo(false);
    return data;
  } catch {
    setDemo(true);
    // Petite latence simulée pour un rendu réaliste.
    await new Promise((r) => setTimeout(r, 350));
    return structuredClone(mock);
  }
}

async function write<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (demoMode) {
    await new Promise((r) => setTimeout(r, 400));
    throw new Error("Mode démo : connectez l'API (VITE_API_URL) pour exécuter cette action.");
  }
  try {
    return await req<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    // Si l'API tombe en cours de route, basculer en démo pour les lectures.
    if (MOCK_FALLBACK) setDemo(true);
    throw err;
  }
}

export const api = {
  // ── Lectures ──
  status: () => read<{ freeze: boolean; degradedMode: boolean; quotas: SystemStatus["quotas"]; pendingHitl: SystemStatus["pendingHitl"]; kpiToday: DailyKpi; config: SystemStatus["config"]; version: string }>("/system/status", mockStatus),
  kpiToday: () => read<{ kpi: DailyKpi }>("/kpi/today", { kpi: mockKpi }),
  kpiBySource: (date: string) => read<{ date: string; bySource: BySource[] }>(`/kpi/by-source/${date}`, { date, bySource: mockBySource }),
  missions: (params = "") => read<{ missions: Mission[] }>("/missions" + params, { missions: mockMissions }),
  deals: () => read<{ deals: ArbitrageDeal[] }>("/deals", { deals: mockDeals }),
  ledger: () => read<{ events: LedgerEvent[] }>("/ledger?limit=100", { events: mockEvents }),
  platforms: () => read<{ rules: PlatformRule[] }>(`/platforms`, { rules: mockRules }),
  decisions: () => read<{ decisions: Array<{ id: number; ts: string; action: string; reason: string | null; actor: string | null }> }>(`/system/decisions?limit=30`, { decisions: [] }),

  // ── Écritures ──
  scan: () => write<{ ok: boolean; report: unknown; hitlId?: number }>("/system/scan", "POST"),
  freeze: () => write<{ ok: boolean }>("/system/freeze", "POST"),
  unfreeze: () => write<{ ok: boolean; hitlId?: number }>("/system/unfreeze", "POST"),
  approveMission: (id: number) => write(`/missions/${id}/approve`, "POST"),
  executeMission: (id: number) => write(`/missions/${id}/execute`, "POST"),
  submitMission: (id: number) => write(`/missions/${id}/submit`, "POST"),
  confirmHumanSubmit: (id: number) => write(`/missions/${id}/confirm-human-submit`, "POST"),
  quoteDeal: (body: unknown) => write("/deals/quote", "POST", body),
  requestDealApproval: (id: number) => write(`/deals/${id}/request-approval`, "POST"),
  markHired: (id: number, freelancerContact: string) => write(`/deals/${id}/hired`, "POST", { freelancerContact }),
  markDelivered: (id: number, controlNotes: string) => write(`/deals/${id}/delivered`, "POST", { controlNotes }),
  markPaid: (id: number) => write(`/deals/${id}/paid`, "POST"),
  importMission: (body: unknown) => write("/missions", "POST", body),
};
