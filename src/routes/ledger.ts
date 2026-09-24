/**
 * Routes LEDGER — événements financiers append-only (spec §6 + §8).
 *
 *   GET  /ledger?limit=&offset=      liste (plus récents d'abord)
 *   POST /ledger                     enregistre un événement (anti self-dealing + idempotence)
 *   GET  /wallets                    wallets propres
 *   POST /wallets                    ajout wallet (HITL `wallet_add` d'abord)
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { listEvents, recordEvent } from "../core/ledger";
import { addOwnWallet, listOwnWallets } from "../payments/rails";

export const ledgerRoutes = new Hono<{ Bindings: Env }>();

ledgerRoutes.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const offset = Number(c.req.query("offset") ?? "0");
  const events = await listEvents(c.env.DB, limit, offset);
  return c.json({ events, limit, offset });
});

const eventSchema = z.object({
  kind: z.enum(["sale", "self_test", "transfer", "fee", "human_payout", "api_cost"]),
  amountUsdc: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),
  sourcePlatform: z.string().optional().nullable(),
  missionId: z.number().int().optional().nullable(),
  txHash: z.string().optional().nullable(),
  paymentNonce: z.string().optional().nullable(),
  payer: z.string().optional().nullable(),
  costKind: z.string().optional().nullable(),
});

ledgerRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload invalide.", details: parsed.error.flatten() }, 400);
  const result = await recordEvent(c.env.DB, {
    kind: parsed.data.kind,
    amountUsdc: parsed.data.amountUsdc ?? null,
    currency: parsed.data.currency ?? null,
    sourcePlatform: parsed.data.sourcePlatform ?? null,
    missionId: parsed.data.missionId ?? null,
    txHash: parsed.data.txHash ?? null,
    paymentNonce: parsed.data.paymentNonce ?? null,
    payer: parsed.data.payer ?? null,
    costKind: parsed.data.costKind ?? null,
  });
  if (!result.ok) return c.json({ error: result.reason }, 422);
  return c.json(result, result.idempotentReplay ? 200 : 201);
});

ledgerRoutes.get("/wallets", async (c) => {
  return c.json({ wallets: await listOwnWallets(c.env.DB) });
});

const walletSchema = z.object({
  address: z.string().min(3),
  role: z.enum(["PAYTO", "OPS", "SPEND", "OTHER"]),
  addedBy: z.string().min(1),
  hitlApproved: z.boolean(),
  note: z.string().optional(),
});

ledgerRoutes.post("/wallets", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = walletSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload invalide.", details: parsed.error.flatten() }, 400);
  const result = await addOwnWallet(c.env.DB, parsed.data.address, parsed.data.role, parsed.data.addedBy, parsed.data.hitlApproved, parsed.data.note);
  if (!result.ok) return c.json({ error: result.reason }, 403);
  return c.json({ ok: true, message: result.reason }, 201);
});
