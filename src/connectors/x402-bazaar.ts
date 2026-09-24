/**
 * Connecteur x402 / BAZAAR (tâches agent-à-agent payées en USDC).
 *
 * C'est la source agent-native : d'autres agents paient pour des tâches.
 * - Scan : découverte native (endpoint Bazaar configuré).
 * - ToS : `can_auto_submit = true` — l'agent soumet SEUL et encaisse en USDC.
 *   → C'est le seul chemin F1 100 % autonome (spec §4, test « F1 auto »).
 */

import type { Env } from "../types";
import { politeHeaders, type Connector, type ScanResult } from "./types";

export const x402BazaarConnector: Connector = {
  platform: "x402-bazaar",
  description: "Bazaar x402 agent-à-agent — auto-submit USDC autorisé (F1 autonome).",

  async scan(env: Env): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    const base = (env.X402_BAZAAR_URL ?? "https://bazaar.example.com").replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/tasks?status=open&limit=50`, {
        headers: politeHeaders(),
      });
      if (!res.ok) {
        return { platform: "x402-bazaar", missions: [], partial: true, scannedAt, note: `Bazaar ${res.status} — endpoint à configurer (X402_BAZAAR_URL)` };
      }
      const data = (await res.json()) as { tasks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const tasks = Array.isArray(data) ? data : (data.tasks ?? []);
      return {
        platform: "x402-bazaar",
        scannedAt,
        partial: false,
        missions: tasks.slice(0, 50).map((t, i) => ({
          externalId: String(t["id"] ?? `x402-${i}`),
          platform: "x402-bazaar",
          title: String(t["title"] ?? "Tâche x402"),
          url: String(t["url"] ?? `${base}/tasks/${String(t["id"] ?? "")}`),
          amount: typeof t["price_usdc"] === "number" ? t["price_usdc"] : typeof t["amount"] === "number" ? t["amount"] : null,
          currency: "USDC",
          deadline: typeof t["deadline"] === "string" ? t["deadline"] : null,
          summary: typeof t["description"] === "string" ? t["description"].slice(0, 500) : null,
          effortEstimateH: typeof t["effort_h"] === "number" ? t["effort_h"] : null,
          acceptanceProba: 0.6, // agent-à-agent : pas de candidature, exécution directe
        })),
      };
    } catch (err) {
      return {
        platform: "x402-bazaar",
        missions: [],
        partial: true,
        scannedAt,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
