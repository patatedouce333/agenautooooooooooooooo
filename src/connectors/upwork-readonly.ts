/**
 * Connecteur UPWORK — LECTURE SEULE (spec §3).
 *
 * - Scan : ✅ autorisé (lecture seule, API/freelancer feeds publics).
 * - Submit : ❌ INTERDIT — « bots interdits sur candidatures ».
 *   L'agent prépare la proposition exacte, l'HUMAIN clique « send proposal ».
 */

import type { Env } from "../types";
import type { Connector, ScanResult } from "./types";

export const upworkReadonlyConnector: Connector = {
  platform: "upwork",
  description: "Upwork lecture seule — l'humain envoie chaque proposition (ToS).",

  async scan(_env: Env): Promise<ScanResult> {
    void _env;
    // Upwork n'expose pas de feed public sans OAuth applicatif.
    // En attendant les credentials J5–J10, le scan passe par :
    // 1) les alertes e-mail/Job Feed exportées manuellement (import), ou
    // 2) la saisie manuelle via le dashboard (route POST /missions).
    // On retourne un scan « partiel » explicite plutôt qu'un faux succès.
    return {
      platform: "upwork",
      missions: [],
      partial: true,
      scannedAt: new Date().toISOString(),
      note: "Lecture seule : connectez l'OAuth Upwork (J5–J10) ou importez via POST /missions. Auto-submit toujours interdit (ToS).",
    };
  },
};
