/**
 * Registre des connecteurs (spec §4 étape 1 + §11).
 *
 * Ordre de build :
 *  1. Algora ou Gitcoin (premier connecteur F1) ;
 *  2. x402/Bazaar (F1 auto) ;
 *  3. Malt/Upwork lecture seule.
 * Tous sont câblés ici ; le cron ne lance que ceux autorisés par
 * `platform_rules.can_scan` (policy `scan`).
 */

import type { Connector } from "./types";
import { algoraConnector } from "./algora";
import { gitcoinConnector } from "./gitcoin";
import { deworkConnector } from "./dework";
import { superteamConnector } from "./superteam";
import { x402BazaarConnector } from "./x402-bazaar";
import { rentahumanConnector } from "./rentahuman";
import { upworkReadonlyConnector } from "./upwork-readonly";
import { comeupReadonlyConnector, maltReadonlyConnector } from "./malt-readonly";

export const CONNECTORS: Connector[] = [
  algoraConnector,
  gitcoinConnector,
  deworkConnector,
  superteamConnector,
  x402BazaarConnector,
  rentahumanConnector,
  upworkReadonlyConnector,
  maltReadonlyConnector,
  comeupReadonlyConnector,
];

export function getConnector(platform: string): Connector | undefined {
  return CONNECTORS.find((c) => c.platform === platform);
}

export function listConnectorMeta(): Array<{ platform: string; description: string }> {
  return CONNECTORS.map((c) => ({ platform: c.platform, description: c.description }));
}
