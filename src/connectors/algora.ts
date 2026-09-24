/**
 * Connecteur ALGORA (bounties code).
 * - Scan : API publique / GitHub (bounties ouvertes).
 * - ToS : robotic access INTERDIT pour le claim → `can_auto_submit = false`.
 *   L'agent scanne et prépare, l'HUMAIN clique « submit PR / claim ».
 *
 * Source : https://console.algora.io/bounties (API documentée côté client).
 * Sans clé API : repli sur la recherche GitHub des issues liées Algora.
 */

import type { Env } from "../types";
import { politeHeaders, type Connector, type ScanResult } from "./types";

export const algoraConnector: Connector = {
  platform: "algora",
  description: "Bounties code Algora — scan API/GitHub, submit 100 % humain (ToS).",

  async scan(env: Env): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    try {
      // 1) Essai API Algora si clé configurée (endpoint public des bounties).
      if (env.ALGORA_API_KEY) {
        const res = await fetch("https://console.algora.io/api/bounties?status=open&limit=50", {
          headers: politeHeaders(env.ALGORA_API_KEY),
        });
        if (res.ok) {
          const data = (await res.json()) as Array<Record<string, unknown>>;
          return {
            platform: "algora",
            scannedAt,
            partial: false,
            missions: data.slice(0, 50).map((b, i) => ({
              externalId: String(b["id"] ?? `algora-${i}`),
              platform: "algora",
              title: String(b["title"] ?? b["issue_title"] ?? "Bounty Algora"),
              url: String(b["url"] ?? b["issue_url"] ?? "https://console.algora.io/bounties"),
              amount: typeof b["amount"] === "number" ? b["amount"] : null,
              currency: typeof b["currency"] === "string" ? b["currency"] : "USDC",
              deadline: typeof b["deadline"] === "string" ? b["deadline"] : null,
              summary: typeof b["description"] === "string" ? b["description"].slice(0, 500) : null,
              effortEstimateH: null,
              acceptanceProba: 0.4,
            })),
          };
        }
      }
      // 2) Repli : recherche GitHub d'issues mentionnant des bounties Algora.
      const q = encodeURIComponent("algora bounty in:body state:open");
      const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=30`, {
        headers: politeHeaders(env.GITHUB_TOKEN),
      });
      if (!res.ok) {
        return { platform: "algora", missions: [], partial: true, scannedAt, note: `GitHub API ${res.status}` };
      }
      const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
      return {
        platform: "algora",
        scannedAt,
        partial: false,
        note: "via GitHub search (pas de clé Algora)",
        missions: (data.items ?? []).map((it) => ({
          externalId: `gh-${String(it["id"])}`,
          platform: "algora",
          title: String(it["title"] ?? "Issue bounty"),
          url: String(it["html_url"] ?? "https://github.com"),
          amount: null,
          currency: null,
          deadline: null,
          summary: typeof it["body"] === "string" ? it["body"].slice(0, 500) : null,
          effortEstimateH: null,
          acceptanceProba: 0.3,
        })),
      };
    } catch (err) {
      return {
        platform: "algora",
        missions: [],
        partial: true,
        scannedAt,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
