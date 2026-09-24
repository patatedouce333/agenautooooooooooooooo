/**
 * Connecteur GITCOIN (bounties crypto).
 * - Scan : API publique Gitcoin (bounties ouvertes).
 * - ToS : à vérifier au cas par cas → `can_auto_submit = false` par défaut.
 *   L'agent prépare, l'humain valide avant tout submit.
 */

import type { Env } from "../types";
import { politeHeaders, type Connector, type ScanResult } from "./types";

export const gitcoinConnector: Connector = {
  platform: "gitcoin",
  description: "Bounties Gitcoin — scan API publique, submit humain par défaut.",

  async scan(env: Env): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    try {
      const res = await fetch(
        "https://api.gitcoin.co/api/v1/bounty/?is_open=true&limit=50&order_by=-created",
        { headers: politeHeaders(env.GITCOIN_API_KEY) },
      );
      if (!res.ok) {
        return { platform: "gitcoin", missions: [], partial: true, scannedAt, note: `Gitcoin API ${res.status}` };
      }
      const data = (await res.json()) as Array<Record<string, unknown>>;
      return {
        platform: "gitcoin",
        scannedAt,
        partial: false,
        missions: data.slice(0, 50).map((b, i) => ({
          externalId: String(b["id"] ?? b["pk"] ?? `gitcoin-${i}`),
          platform: "gitcoin",
          title: String(b["title"] ?? "Bounty Gitcoin"),
          url: String(b["url"] ?? "https://app.gitcoin.co/bounties"),
          amount: typeof b["value_in_usdt"] === "number" ? b["value_in_usdt"] : null,
          currency: "USDC",
          deadline: typeof b["expires_date"] === "string" ? b["expires_date"] : null,
          summary: typeof b["issue_description"] === "string" ? b["issue_description"].slice(0, 500) : null,
          effortEstimateH: null,
          acceptanceProba: 0.35,
        })),
      };
    } catch (err) {
      return {
        platform: "gitcoin",
        missions: [],
        partial: true,
        scannedAt,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
