/**
 * Routes KPI — « Combien gagné aujourd'hui, par source ? » (spec §8).
 *
 *   GET /kpi/today              KPI du jour
 *   GET /kpi/:date              KPI d'une date (AAAA-MM-JJ)
 *   GET /kpi/by-source/:date    revenu par plateforme source
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { utcToday } from "../types";
import { computeDailyKpi } from "../core/ledger";

export const kpiRoutes = new Hono<{ Bindings: Env }>();

function validDateOrToday(param?: string): string {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) return param;
  return utcToday();
}

kpiRoutes.get("/today", async (c) => {
  return c.json({ kpi: await computeDailyKpi(c.env.DB, utcToday()) });
});

kpiRoutes.get("/by-source/:date", async (c) => {
  const date = validDateOrToday(c.req.param("date"));
  const { results } = await c.env.DB
    .prepare(
      `SELECT source_platform AS platform, COALESCE(SUM(amount_usdc), 0) AS revenue, COUNT(*) AS sales
       FROM events
       WHERE kind = 'sale' AND substr(ts, 1, 10) = ?
         AND (payer IS NULL OR LOWER(payer) NOT IN (SELECT LOWER(address) FROM own_wallets))
       GROUP BY source_platform ORDER BY revenue DESC`,
    )
    .bind(date)
    .all<{ platform: string | null; revenue: number; sales: number }>();
  return c.json({ date, bySource: results ?? [] });
});

kpiRoutes.get("/:date", async (c) => {
  return c.json({ kpi: await computeDailyKpi(c.env.DB, validDateOrToday(c.req.param("date"))) });
});
