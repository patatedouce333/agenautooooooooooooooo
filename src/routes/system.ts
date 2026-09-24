/**
 * Routes SYSTÈME — freeze, statut, audit, quotas, HITL.
 *
 *   GET  /system/status        freeze, dégradé, quotas, HITL en attente, config
 *   POST /system/freeze        gel immédiat
 *   POST /system/unfreeze      dégel (double confirmation : étape 1, puis HITL)
 *   GET  /system/decisions     journal d'audit chaîné
 *   GET  /system/hitl          demandes HITL en attente
 *   POST /system/scan          déclenchement manuel d'un cycle F1
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { utcToday } from "../types";
import { configFromEnv } from "../core/policy";
import { computeDailyKpi } from "../core/ledger";
import { getUsage, type QuotaKind } from "../core/quotas";
import { getFlag, setFlag, logDecision } from "../db/queries";
import { runScanCycle } from "../f1/scanner";
import { createHitlRequest, expireStaleHitlRequests, listPendingHitl } from "../telegram/hitl";
import { sendMessage } from "../telegram/bot";

export const systemRoutes = new Hono<{ Bindings: Env }>();

systemRoutes.get("/status", async (c) => {
  const config = configFromEnv(c.env);
  const kinds: QuotaKind[] = ["scan", "llm_call", "telegram_msg", "d1_write", "subrequest"];
  const quotas: Record<string, unknown> = {};
  for (const kind of kinds) quotas[kind] = await getUsage(c.env.DB, kind);
  const [freeze, degraded, pending, kpi] = await Promise.all([
    getFlag(c.env.DB, "freeze"),
    getFlag(c.env.DB, "degraded_mode"),
    listPendingHitl(c.env.DB),
    computeDailyKpi(c.env.DB, utcToday()),
  ]);
  return c.json({
    freeze: freeze === "true",
    degradedMode: degraded === "true",
    quotas,
    pendingHitl: pending,
    kpiToday: kpi,
    config,
    version: "2.0.0",
  });
});

systemRoutes.post("/freeze", async (c) => {
  await setFlag(c.env.DB, "freeze", "true");
  await logDecision(c.env.DB, "freeze", "Gel via API.", { actor: "api" });
  await sendMessage(c.env.DB, c.env, "🧊 *Système gelé* (via API).").catch(() => false);
  return c.json({ ok: true, freeze: true });
});

systemRoutes.post("/unfreeze", async (c) => {
  const frozen = (await getFlag(c.env.DB, "freeze")) === "true";
  if (!frozen) return c.json({ ok: true, freeze: false, message: "Pas gelé." });
  // Double confirmation : HITL `unfreeze` (comme /unfreeze Telegram).
  await setFlag(c.env.DB, "unfreeze_pending", "true");
  const hitlId = await createHitlRequest(c.env.DB, c.env, "unfreeze", { via: "api" }, {
    summary: "Confirmez le dégel du système (double confirmation, demandée via API).",
    ttlHours: 1,
  });
  return c.json({ ok: true, step: "1/2", hitlId, message: "Confirmez via le bouton Telegram (étape 2/2)." });
});

systemRoutes.get("/decisions", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const { results } = await c.env.DB
    .prepare("SELECT * FROM decisions ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all();
  return c.json({ decisions: results ?? [] });
});

systemRoutes.get("/hitl", async (c) => {
  await expireStaleHitlRequests(c.env.DB);
  return c.json({ pending: await listPendingHitl(c.env.DB) });
});

systemRoutes.post("/scan", async (c) => {
  const config = configFromEnv(c.env);
  const report = await runScanCycle(c.env.DB, c.env, config);
  // Notifie l'admin du top-N à valider (HITL léger — spec §4 étape 3).
  if (report.proposedTopN.length > 0) {
    const placeholders = report.proposedTopN.map(() => "?").join(",");
    const { results } = await c.env.DB
      .prepare(`SELECT id, title, source_platform, amount, currency, score FROM missions WHERE id IN (${placeholders}) ORDER BY score DESC`)
      .bind(...report.proposedTopN)
      .all<{ id: number; title: string | null; source_platform: string; amount: number | null; currency: string | null; score: number | null }>();
    const lines = (results ?? []).map(
      (m) => `#${m.id} — ${m.title ?? "(sans titre)"} (${m.source_platform}, ${m.amount ?? "?"} ${m.currency ?? ""}, ${m.score ?? 0} pts)`,
    );
    const hitlId = await createHitlRequest(c.env.DB, c.env, "mission_batch", { missionIds: report.proposedTopN }, {
      summary: `Voici ${report.proposedTopN.length} mission(s), confirmez celle(s) à traiter :\n${lines.join("\n")}`,
    });
    return c.json({ ok: true, report, hitlId });
  }
  return c.json({ ok: true, report });
});
