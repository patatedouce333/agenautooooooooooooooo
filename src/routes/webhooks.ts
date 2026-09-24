/**
 * WEBHOOKS entrants — Telegram + x402 (spec §2 : événements webhooks).
 *
 *   POST /webhooks/telegram   updates du bot (secret requis)
 *   POST /webhooks/x402        paiement USDC entrant (facilitator)
 *
 * NOTE : il n'y a AUCUNE route trading — et il ne doit jamais y en avoir
 * (spec §7/§13). Voir `guardNoTrading()` dans core/policy.ts.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { handleTelegramUpdate } from "../telegram/bot";
import { recordIncomingX402Payment, verifyFacilitatorSignature } from "../payments/x402";

export const webhooksRoutes = new Hono<{ Bindings: Env }>();

webhooksRoutes.post("/telegram", async (c) => {
  // Vérifie le secret webhook (configuré via setWebhook + secrets).
  const secret = c.req.header("X-Telegram-Secret");
  if (c.env.TELEGRAM_WEBHOOK_SECRET && secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "Secret webhook invalide." }, 403);
  }
  const update = await c.req.json().catch(() => null);
  if (!update) return c.json({ error: "Update vide." }, 400);
  const result = await handleTelegramUpdate(c.env.DB, c.env, update);
  return c.json({ ok: true, result });
});

const x402Schema = z.object({
  paymentNonce: z.string().min(1),
  txHash: z.string().optional(),
  amountUsdc: z.number().positive(),
  payer: z.string().min(1),
  missionId: z.number().int().optional().nullable(),
  sourcePlatform: z.string().optional(),
});

webhooksRoutes.post("/x402", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = x402Schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload x402 invalide.", details: parsed.error.flatten() }, 400);

  // Vérification facilitator (fail-closed : false = refus).
  const verified = await verifyFacilitatorSignature(parsed.data);
  if (!verified) return c.json({ error: "Signature facilitator invalide." }, 403);

  const result = await recordIncomingX402Payment(c.env.DB, {
    paymentNonce: parsed.data.paymentNonce,
    txHash: parsed.data.txHash,
    amountUsdc: parsed.data.amountUsdc,
    payer: parsed.data.payer,
    missionId: parsed.data.missionId ?? null,
    sourcePlatform: parsed.data.sourcePlatform,
  });
  if (!result.ok) return c.json({ error: result.reason }, 422);
  return c.json(result, result.idempotentReplay ? 200 : 201);
});
