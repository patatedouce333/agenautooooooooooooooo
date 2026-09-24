/**
 * Connecteur MALT / COMEUP — LECTURE SEULE (spec §3).
 *
 * - Scan : ✅ lecture seule (recherche publique, sans contournement).
 * - Submit : ❌ à vérifier — probablement non. Humain valide et envoie.
 *
 * Un seul connecteur pour les deux plateformes FR (même régime ToS).
 */

import type { Env } from "../types";
import type { Connector, ScanResult } from "./types";

async function stubScan(platform: "malt" | "comeup"): Promise<ScanResult> {
  return {
    platform,
    missions: [],
    partial: true,
    scannedAt: new Date().toISOString(),
    note: "Lecture seule : compte pro + KYC requis (J5–J10). En attendant, import manuel via POST /missions. Auto-submit interdit par prudence (ToS à vérifier).",
  };
}

export const maltReadonlyConnector: Connector = {
  platform: "malt",
  description: "Malt lecture seule — l'humain valide et envoie (ToS à vérifier).",
  async scan(_env: Env): Promise<ScanResult> {
    void _env;
    return stubScan("malt");
  },
};

export const comeupReadonlyConnector: Connector = {
  platform: "comeup",
  description: "ComeUp lecture seule — l'humain valide et envoie (ToS à vérifier).",
  async scan(_env: Env): Promise<ScanResult> {
    void _env;
    return stubScan("comeup");
  },
};
