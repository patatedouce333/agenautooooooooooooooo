/**
 * Routes PLATEFORMES — matrice ToS (spec §3, contrainte dure).
 *
 *   GET /platforms            matrice + connecteurs disponibles
 *   GET /platforms/:name      règle d'une plateforme
 *
 * La matrice n'est modifiable QUE via migration SQL revue (pas de route
 * d'écriture : changer une règle ToS = décision humaine tracée au déploiement).
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { getPlatformRule, listPlatformRules } from "../db/queries";
import { listConnectorMeta } from "../connectors/registry";

export const platformsRoutes = new Hono<{ Bindings: Env }>();

platformsRoutes.get("/", async (c) => {
  const [rules, connectors] = await Promise.all([
    listPlatformRules(c.env.DB),
    Promise.resolve(listConnectorMeta()),
  ]);
  return c.json({
    rules,
    connectors,
    policy: "Plateforme non listée = refus + approbation humaine. Auto-submit interdit sauf can_auto_submit=true.",
  });
});

platformsRoutes.get("/:name", async (c) => {
  const rule = await getPlatformRule(c.env.DB, c.req.param("name"));
  if (!rule) return c.json({ error: "Plateforme inconnue — refus par défaut + approbation humaine requise.", known: false }, 404);
  return c.json({ rule, known: true });
});
