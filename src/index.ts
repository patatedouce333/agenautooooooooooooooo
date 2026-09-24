/**
 * loop v2 — point d'entrée Cloudflare Workers (Hono).
 *
 * Architecture (spec §2) :
 *   Cron / Telegram / Webhooks → Agent orchestrateur → F1/F2 → Policy → Rails → Ledger.
 *
 * Routes :
 *   GET  /                  santé + carte des routes
 *   /missions               file F1 (spec §4)
 *   /deals                  arbitrage F2 (spec §5)
 *   /ledger                 ledger + wallets (spec §6/§8)
 *   /platforms              matrice ToS (spec §3)
 *   /system                 freeze, statut, audit, scan manuel
 *   /kpi                    KPI quotidien (spec §8)
 *   /webhooks/telegram      bot Telegram
 *   /webhooks/x402          paiements USDC entrants
 *
 * RAPPEL DUR : aucune route trading — jamais (spec §7/§13).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types";
import { missionsRoutes } from "./routes/missions";
import { arbitrageRoutes } from "./routes/arbitrage";
import { ledgerRoutes } from "./routes/ledger";
import { platformsRoutes } from "./routes/platforms";
import { systemRoutes } from "./routes/system";
import { kpiRoutes } from "./routes/kpi";
import { webhooksRoutes } from "./routes/webhooks";
import { handleScheduled } from "./cron/scheduler";

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use("/missions/*", cors());
app.use("/deals/*", cors());
app.use("/ledger/*", cors());
app.use("/platforms/*", cors());
app.use("/system/*", cors());
app.use("/kpi/*", cors());

app.get("/", (c) =>
  c.json({
    name: "loop-agent",
    version: "2.0.0",
    mission: "Maximiser le revenu encaissé par jour (F1 chasseur-exécuteur + F2 arbitrage humain).",
    routes: {
      missions: "/missions",
      deals: "/deals",
      ledger: "/ledger",
      platforms: "/platforms",
      system: "/system/status",
      kpi: "/kpi/today",
      webhooks: ["/webhooks/telegram", "/webhooks/x402"],
    },
    guarantees: [
      "policy engine : plafonds, matrice ToS, freeze",
      "aucun trading — par construction",
      "timeout HITL = deny",
    ],
  }),
);

app.route("/missions", missionsRoutes);
app.route("/deals", arbitrageRoutes);
app.route("/ledger", ledgerRoutes);
app.route("/platforms", platformsRoutes);
app.route("/system", systemRoutes);
app.route("/kpi", kpiRoutes);
app.route("/webhooks", webhooksRoutes);

app.notFound((c) => c.json({ error: "Route inconnue.", hint: "GET / pour la carte des routes." }, 404));
app.onError((err, c) => {
  console.error("loop error:", err);
  return c.json({ error: "Erreur interne." }, 500);
});

export default {
  fetch: app.fetch,
  /** Cron Triggers (wrangler.toml) → scheduler. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env.DB, env, new Date(_event.scheduledTime)));
  },
};
