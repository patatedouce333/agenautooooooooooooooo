/**
 * Connecteur SUPERTEAM EARN (bounties Solana — code, design, data).
 * - Scan : API/listing public Earn (missions ouvertes).
 * - ToS : à vérifier au cas par cas → submit humain par défaut.
 */

import type { Env } from "../types";
import { politeHeaders, type Connector, type ScanResult } from "./types";

export const superteamConnector: Connector = {
  platform: "superteam",
  description: "Superteam Earn — scan listings publics, submit humain par défaut.",

  async scan(env: Env): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    try {
      const res = await fetch("https://earn.superteam.fun/api/listings?status=open&take=50", {
        headers: politeHeaders(),
      });
      void env;
      if (!res.ok) {
        return { platform: "superteam", missions: [], partial: true, scannedAt, note: `Earn API ${res.status}` };
      }
      const data = (await res.json()) as { listings?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const listings = Array.isArray(data) ? data : (data.listings ?? []);
      return {
        platform: "superteam",
        scannedAt,
        partial: false,
        missions: listings.slice(0, 50).map((l, i) => ({
          externalId: String(l["id"] ?? l["slug"] ?? `earn-${i}`),
          platform: "superteam",
          title: String(l["title"] ?? "Listing Earn"),
          url: String(l["url"] ?? `https://earn.superteam.fun/listing/${String(l["slug"] ?? "")}`),
          amount: typeof l["rewardAmount"] === "number" ? l["rewardAmount"] : null,
          currency: typeof l["token"] === "string" ? l["token"] : "USDC",
          deadline: typeof l["deadline"] === "string" ? l["deadline"] : null,
          summary: typeof l["description"] === "string" ? l["description"].slice(0, 500) : null,
          effortEstimateH: null,
          acceptanceProba: 0.3,
        })),
      };
    } catch (err) {
      return {
        platform: "superteam",
        missions: [],
        partial: true,
        scannedAt,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
