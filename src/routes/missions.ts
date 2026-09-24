/**
 * Routes MISSIONS — file F1 (scan → exécution → soumission).
 *
 *   GET  /missions?status=&platform=&limit=      liste paginée
 *   GET  /missions/:id                            détail
 *   POST /missions                                import manuel (Upwork/Malt… lecture seule)
 *   POST /missions/:id/approve                    approve HITL (proxy API — notifie Telegram)
 *   POST /missions/:id/execute                    exécute (si approved)
 *   POST /missions/:id/submit                     soumet (auto ou prépare draft humain)
 *   POST /missions/:id/confirm-human-submit       l'humain confirme son clic plateforme
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env, Mission } from "../types";
import { utcNowIso } from "../types";
import { configFromEnv } from "../core/policy";
import { requiresHuman, scoreMission } from "../core/scoring";
import { executeMission } from "../f1/executor";
import { submitMission } from "../f1/submitter";
import { getMission } from "../db/queries";
import { createHitlRequest } from "../telegram/hitl";

export const missionsRoutes = new Hono<{ Bindings: Env }>();

missionsRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const platform = c.req.query("platform");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const offset = Number(c.req.query("offset") ?? "0");
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  if (platform) {
    where.push("source_platform = ?");
    binds.push(platform);
  }
  const sql = `SELECT * FROM missions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY score DESC, id DESC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds, limit, offset).all<Mission>();
  return c.json({ missions: results ?? [], limit, offset });
});

missionsRoutes.get("/:id", async (c) => {
  const mission = await getMission(c.env.DB, Number(c.req.param("id")));
  if (!mission) return c.json({ error: "Mission introuvable." }, 404);
  return c.json({ mission });
});

const importSchema = z.object({
  platform: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().optional().nullable(),
  amount: z.number().positive().optional().nullable(),
  currency: z.string().optional().nullable(),
  deadline: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  effortEstimateH: z.number().positive().optional().nullable(),
  acceptanceProba: z.number().min(0).max(1).optional().nullable(),
});

/** Import manuel — pour les plateformes lecture seule (Upwork, Malt…). */
missionsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload invalide.", details: parsed.error.flatten() }, 400);
  const m = parsed.data;

  const existing = await c.env.DB
    .prepare("SELECT id FROM missions WHERE source_platform = ? AND external_id = ?")
    .bind(m.platform, m.externalId)
    .first<{ id: number }>();
  if (existing) return c.json({ ok: true, duplicate: true, id: existing.id }, 200);

  const kind = requiresHuman(m.title, m.summary ?? null) ? "f2_needs_human" : "f1_executable";
  const score = kind === "f1_executable"
    ? scoreMission({ amount: m.amount ?? null, currency: m.currency ?? null, acceptanceProba: m.acceptanceProba ?? null, effortEstimateH: m.effortEstimateH ?? null })
    : 0;

  const res = await c.env.DB
    .prepare(`INSERT INTO missions (found_at, source_platform, external_id, title, url, amount, currency, kind, status, score, effort_estimate_h, acceptance_proba, deadline, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'scored', ?, ?, ?, ?, ?)`)
    .bind(utcNowIso(), m.platform, m.externalId, m.title, m.url ?? null, m.amount ?? null, m.currency ?? null, kind, score, m.effortEstimateH ?? null, m.acceptanceProba ?? null, m.deadline ?? null, m.summary ?? null)
    .run();
  return c.json({ ok: true, id: Number(res.meta.last_row_id), kind, score }, 201);
});

/** Demande d'approbation HITL (notifie Telegram avec boutons). */
missionsRoutes.post("/:id/approve", async (c) => {
  const id = Number(c.req.param("id"));
  const mission = await getMission(c.env.DB, id);
  if (!mission) return c.json({ error: "Mission introuvable." }, 404);
  if (mission.status !== "proposed" && mission.status !== "scored") {
    return c.json({ error: `Mission au statut '${mission.status}' — proposez-la d'abord.` }, 409);
  }
  if (mission.status === "scored") {
    await c.env.DB.prepare("UPDATE missions SET status = 'proposed' WHERE id = ?").bind(id).run();
  }
  const hitlId = await createHitlRequest(c.env.DB, c.env, "mission_batch", { missionIds: [id] }, {
    refType: "missions",
    refId: id,
    summary: `#${id} — ${mission.title ?? "(sans titre)"} (${mission.source_platform}, ${mission.amount ?? "?"} ${mission.currency ?? ""}, score ${mission.score ?? 0})`,
  });
  return c.json({ ok: true, hitlId, message: `Demande HITL #${hitlId} envoyée sur Telegram.` });
});

missionsRoutes.post("/:id/execute", async (c) => {
  const result = await executeMission(c.env.DB, Number(c.req.param("id")));
  if (!result.ok) return c.json({ error: result.reason }, 409);
  return c.json(result);
});

missionsRoutes.post("/:id/submit", async (c) => {
  const config = configFromEnv(c.env);
  const result = await submitMission(c.env.DB, config, Number(c.req.param("id")), false);
  if (!result.ok) return c.json({ error: result.reason }, 409);
  return c.json(result);
});

missionsRoutes.post("/:id/confirm-human-submit", async (c) => {
  const config = configFromEnv(c.env);
  const result = await submitMission(c.env.DB, config, Number(c.req.param("id")), true);
  if (!result.ok) return c.json({ error: result.reason }, 409);
  return c.json(result);
});
