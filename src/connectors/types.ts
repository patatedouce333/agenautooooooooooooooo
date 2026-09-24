/**
 * loop v2 — types des connecteurs de scan (spec §4, étape 1).
 *
 * Règles communes à TOUS les connecteurs :
 * - lecture seule via API officielles / RSS / pages publiques ;
 * - JAMAIS de contournement de mesures anti-bot (spec §13) ;
 * - chaque mission normalisée porte sa plateforme d'origine pour que
 *   la matrice ToS (`platform_rules`) s'applique à la soumission.
 */

import type { Env } from "../types";

/** Mission brute normalisée, avant scoring/stockage. */
export interface RawMission {
  /** Identifiant stable sur la plateforme source. */
  externalId: string;
  /** Clé de `platform_rules` (ex. 'algora', 'gitcoin'). */
  platform: string;
  title: string;
  url: string;
  /** Montant brut (null si non chiffré). */
  amount: number | null;
  currency: string | null; // USDC | EUR | …
  deadline: string | null; // ISO-8601
  /** Description courte pour le scoring / la détection F2. */
  summary: string | null;
  /** Estimation agent (remplie par le connecteur si dispo, sinon null). */
  effortEstimateH: number | null;
  acceptanceProba: number | null;
}

export interface ScanResult {
  platform: string;
  missions: RawMission[];
  /** true si le scan a été partiel (quota, rate-limit…). */
  partial: boolean;
  scannedAt: string;
  note?: string;
}

export interface Connector {
  /** Clé `platform_rules`. */
  platform: string;
  /** Description humaine (docs auto). */
  description: string;
  /** Scan lecture-seule. Ne lève pas : retourne `partial` en cas de souci. */
  scan(env: Env): Promise<ScanResult>;
}

/** En-têtes HTTP communs (identification polie + pas de contournement). */
export function politeHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "loop-agent/2.0 (+https://github.com/patatedouce333/agenautooooooooooooooo)",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
