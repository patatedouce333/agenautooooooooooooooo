/**
 * Routes ARBITRAGE F2 (spec §5).
 *
 *   GET  /deals                    deals actifs + historique
 *   GET  /deals/:id                 détail
 *   POST /deals/quote               chiffrage (rejet si marge < seuil)
 *   POST /deals/:id/request-approval HITL obligatoire (Telegram)
 *   POST /deals/:id/hired           recrutement (après HITL)
 *   POST /deals/:id/delivered       livraison contrôlée
 *   POST /deals/:id/paid            clôture financière
 *   POST /deals/:id/cancel          annulation
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env, ArbitrageDeal } from "../types";
import { configFromEnv } from "../core/policy";
import { cancelDeal, getDeal, markDelivered, markHired, markPaid, quoteDeal } from "../f2/arbitrage";
import { createHitlRequest } from "../telegram/hitl";

export const arbitrageRoutes = new Hono<{ Bindings: Env }>();

arbitrageRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const sql = status
    ? "SELECT * FROM arbitrage_deals WHERE status = ? ORDER BY id DESC LIMIT 100"
    : "SELECT * FROM arbitrage_deals ORDER BY id DESC LIMIT 100";
  const stmt = status ? c.env.DB.prepare(sql).bind(status) : c.env.DB.prepare(sql);
  const { results } = await stmt.all<ArbitrageDeal>();
  return c.json({ deals: results ?? [] });
});

arbitrageRoutes.get("/:id", async (c) => {
  const deal = await getDeal(c.env.DB, Number(c.req.param("id")));
  if (!deal) return c.json({ error: "Deal introuvable." }, 404);
  return c.json({ deal });
});

const quoteSchema = z.object({
  missionId: z.number().int().optional().nullable(),
  clientPrice: z.number().positive(),
  currency: z.string().optional(),
  freelancerCost: z.number().nonnegative(),
  platformFees: z.number().nonnegative().optional(),
  controlTimeCost: z.number().nonnegative().optional(),
  freelancerContact: z.string().optional(),
  freelancerPlatform: z.string().optional(),
  notes: z.string().optional(),
});

arbitrageRoutes.post("/quote", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload invalide.", details: parsed.error.flatten() }, 400);
  const result = await quoteDeal(c.env.DB, configFromEnv(c.env), parsed.data);
  if (!result.ok) return c.json({ error: result.reason }, 422);
  return c.json({ ok: true, dealId: result.dealId, marginNet: result.marginNet, deal: result.deal }, 201);
});

arbitrageRoutes.post("/:id/request-approval", async (c) => {
  const id = Number(c.req.param("id"));
  const deal = await getDeal(c.env.DB, id);
  if (!deal) return c.json({ error: "Deal introuvable." }, 404);
  if (deal.status !== "scouting") return c.json({ error: `Deal au statut '${deal.status}'.` }, 409);
  const hitlId = await createHitlRequest(c.env.DB, c.env, "f2_deal", { dealId: id }, {
    refType: "arbitrage_deals",
    refId: id,
    summary:
      `Deal F2 #${id} : client ${deal.client_price} ${deal.currency ?? ""} − freelance ${deal.freelancer_cost ?? "?"} ` +
      `− frais ${deal.platform_fees ?? 0} − réserve ${deal.litigation_reserve ?? 0} = *marge ${deal.margin_net ?? "?"}* (${deal.freelancer_platform ?? "?"})`,
  });
  return c.json({ ok: true, hitlId, message: `Demande HITL #${hitlId} envoyée sur Telegram.` });
});

arbitrageRoutes.post("/:id/hired", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const contact = String(body.freelancerContact ?? "");
  if (!contact) return c.json({ error: "freelancerContact requis." }, 400);
  const deal = await getDeal(c.env.DB, id);
  if (!deal) return c.json({ error: "Deal introuvable." }, 404);
  if (deal.status !== "proposed") return c.json({ error: "Approbation HITL requise avant recrutement (spec §5)." }, 409);
  await markHired(c.env.DB, id, contact);
  return c.json({ ok: true, message: `Deal #${id} : freelance recruté.` });
});

arbitrageRoutes.post("/:id/delivered", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const deal = await getDeal(c.env.DB, id);
  if (!deal) return c.json({ error: "Deal introuvable." }, 404);
  if (deal.status !== "hired") return c.json({ error: `Deal au statut '${deal.status}'.` }, 409);
  await markDelivered(c.env.DB, id, String(body.controlNotes ?? "contrôle OK"));
  return c.json({ ok: true, message: `Deal #${id} livré et contrôlé.` });
});

arbitrageRoutes.post("/:id/paid", async (c) => {
  const id = Number(c.req.param("id"));
  const deal = await getDeal(c.env.DB, id);
  if (!deal) return c.json({ error: "Deal introuvable." }, 404);
  if (deal.status !== "delivered") return c.json({ error: `Deal au statut '${deal.status}'.` }, 409);
  await markPaid(c.env.DB, id);
  return c.json({ ok: true, message: `Deal #${id} soldé.` });
});

arbitrageRoutes.post("/:id/cancel", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  await cancelDeal(c.env.DB, id, String(body.reason ?? "annulé via API"));
  return c.json({ ok: true, message: `Deal #${id} annulé.` });
});
