/**
 * Connecteur RENTAHUMAN.
 *
 * Double rôle :
 * - comme FOURNISSEUR (`rentahuman-provider`) : micro-tâches B1 payées par
 *   le client — auto-traitable ;
 * - comme DEMANDEUR (`rentahuman-requester`) : recrutement F2 d'humains
 *   pour les missions terrain — l'agent paie, donc pas de contrainte ToS
 *   côté soumission (mais HITL obligatoire pour toute embauche, spec §5).
 *
 * Ce connecteur scanne les micro-tâches preneurs (rôle fournisseur).
 */

import type { Env } from "../types";
import { politeHeaders, type Connector, type ScanResult } from "./types";

export const rentahumanConnector: Connector = {
  platform: "rentahuman-provider",
  description: "RentAHuman (fournisseur) — micro-tâches payées par le client.",

  async scan(env: Env): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    try {
      const res = await fetch("https://api.rentahuman.example.com/v1/jobs?status=open&limit=50", {
        headers: politeHeaders(env.RENTAHUMAN_API_KEY),
      });
      if (!res.ok) {
        return {
          platform: "rentahuman-provider",
          missions: [],
          partial: true,
          scannedAt,
          note: `RentAHuman ${res.status} — endpoint à configurer quand le compte J1 est créé`,
        };
      }
      const data = (await res.json()) as { jobs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const jobs = Array.isArray(data) ? data : (data.jobs ?? []);
      return {
        platform: "rentahuman-provider",
        scannedAt,
        partial: false,
        missions: jobs.slice(0, 50).map((j, i) => ({
          externalId: String(j["id"] ?? `rah-${i}`),
          platform: "rentahuman-provider",
          title: String(j["title"] ?? "Micro-tâche"),
          url: String(j["url"] ?? "https://rentahuman.example.com"),
          amount: typeof j["payout_usdc"] === "number" ? j["payout_usdc"] : null,
          currency: "USDC",
          deadline: typeof j["deadline"] === "string" ? j["deadline"] : null,
          summary: typeof j["description"] === "string" ? j["description"].slice(0, 500) : null,
          effortEstimateH: null,
          acceptanceProba: 0.5,
        })),
      };
    } catch (err) {
      return {
        platform: "rentahuman-provider",
        missions: [],
        partial: true,
        scannedAt,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
