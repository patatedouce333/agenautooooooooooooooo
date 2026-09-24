/**
 * Connecteur DEWORK (bounties crypto / DAO).
 * - Scan : API publique Dework (tâches ouvertes).
 * - ToS : à vérifier au cas par cas → submit humain par défaut.
 */

import type { Env } from "../types";
import { politeHeaders, type Connector, type ScanResult } from "./types";

export const deworkConnector: Connector = {
  platform: "dework",
  description: "Tâches Dework — scan API, submit humain par défaut.",

  async scan(env: Env): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    try {
      const res = await fetch("https://api.dework.xyz/tasks?status=OPEN&limit=50", {
        headers: politeHeaders(env.DEWORK_API_KEY),
      });
      if (!res.ok) {
        return { platform: "dework", missions: [], partial: true, scannedAt, note: `Dework API ${res.status}` };
      }
      const data = (await res.json()) as { tasks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const tasks = Array.isArray(data) ? data : (data.tasks ?? []);
      return {
        platform: "dework",
        scannedAt,
        partial: false,
        missions: tasks.slice(0, 50).map((t, i) => ({
          externalId: String(t["id"] ?? `dework-${i}`),
          platform: "dework",
          title: String(t["name"] ?? t["title"] ?? "Tâche Dework"),
          url: String(t["url"] ?? "https://app.dework.xyz"),
          amount: typeof t["rewardAmount"] === "number" ? t["rewardAmount"] : null,
          currency: typeof t["rewardCurrency"] === "string" ? t["rewardCurrency"] : "USDC",
          deadline: typeof t["dueDate"] === "string" ? t["dueDate"] : null,
          summary: typeof t["description"] === "string" ? t["description"].slice(0, 500) : null,
          effortEstimateH: null,
          acceptanceProba: 0.35,
        })),
      };
    } catch (err) {
      return {
        platform: "dework",
        missions: [],
        partial: true,
        scannedAt,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
