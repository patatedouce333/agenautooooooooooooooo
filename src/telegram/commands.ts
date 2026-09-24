/**
 * Commandes Telegram (spec §11 : /freeze, /status, HITL, KPI).
 *
 *   /help      — aide
 *   /status    — freeze, mode dégradé, compteurs du jour, HITL en attente
 *   /freeze    — gel immédiat (effet sans redéploiement)
 *   /unfreeze  — double confirmation (2e étape via bouton HITL)
 *   /kpi       — KPI du jour (ou /kpi 2026-09-23)
 *   /missions  — dernières missions proposées (top-N)
 *   /approve <id> / /deny <id> — résoudre un HITL sans bouton
 *   /deals     — deals F2 actifs
 */

import type { Env, LoopConfig } from "../types";
import { utcToday } from "../types";
import { getFlag, setFlag, listPlatformRules, logDecision } from "../db/queries";
import { computeDailyKpi } from "../core/ledger";
import { getUsage } from "../core/quotas";
import { configFromEnv } from "../core/policy";
import { createHitlRequest, listPendingHitl } from "./hitl";
import { hitlKeyboard, sendMessage } from "./bot";
import { formatKpiMessage } from "./kpi";

export async function handleCommand(db: D1Database, env: Env, text: string, username: string): Promise<string> {
  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.toLowerCase().split("@")[0]; // enlève @botname
  const config = configFromEnv(env);

  switch (cmd) {
    case "/help":
    case "/start":
      await sendMessage(db, env, HELP_TEXT);
      return "help";
    case "/status":
      await sendStatus(db, env, config);
      return "status";
    case "/freeze":
      await setFlag(db, "freeze", "true");
      await logDecision(db, "freeze", `Système gelé par ${username}.`, { actor: `telegram:${username}` });
      await sendMessage(db, env, "🧊 *Système gelé* — toutes les actions sortantes sont bloquées (effet immédiat).");
      return "freeze";
    case "/unfreeze":
      return handleUnfreeze(db, env, username);
    case "/kpi":
      await sendKpi(db, env, args[0]);
      return "kpi";
    case "/missions":
      await sendMissions(db, env);
      return "missions";
    case "/deals":
      await sendDeals(db, env);
      return "deals";
    case "/approve":
    case "/deny":
      return resolveHitlByCommand(db, env, cmd === "/approve", args[0]);
    case "/platforms":
      await sendPlatforms(db, env);
      return "platforms";
    default:
      await sendMessage(db, env, `Commande inconnue \`${cmd}\`. Tapez /help.`);
      return "unknown";
  }
}

const HELP_TEXT =
  `🤖 *loop v2 — aide*\n\n` +
  `/status — état (freeze, quotas, HITL en attente)\n` +
  `/freeze — geler le système (immédiat)\n` +
  `/unfreeze — dégeler (double confirmation)\n` +
  `/kpi [AAAA-MM-JJ] — rapport du jour\n` +
  `/missions — missions proposées (top-N)\n` +
  `/deals — deals F2 actifs\n` +
  `/platforms — matrice ToS\n` +
  `/approve <id> / /deny <id> — résoudre un HITL\n\n` +
  `_Timeout HITL = refus : sans réponse, l'agent ne prend rien._`;

async function sendStatus(db: D1Database, env: Env, config: LoopConfig): Promise<void> {
  const freeze = (await getFlag(db, "freeze")) === "true";
  const degraded = (await getFlag(db, "degraded_mode")) === "true";
  const scan = await getUsage(db, "scan");
  const llm = await getUsage(db, "llm_call");
  const tg = await getUsage(db, "telegram_msg");
  const pending = await listPendingHitl(db);
  const kpi = await computeDailyKpi(db, utcToday());

  const lines = [
    `${freeze ? "🧊 *GELÉ*" : "🟢 *ACTIF*"}${degraded ? " (mode dégradé — scans coupés)" : ""}`,
    ``,
    `Plafond SPEND : ${config.dailySpendLimitUsdc} USDC/jour`,
    `Seuil F2 : ${config.f2MinMarginEur} € · Top-N : ${config.scanTopN}`,
    ``,
    `Quotas du jour : scan ${scan.used}/${scan.limit} · llm ${llm.used}/${llm.limit} · tg ${tg.used}/${tg.limit}`,
    `Net du jour : ${kpi.net_usdc.toFixed(2)} USDC · Missions en attente : ${kpi.missions_pending_hitl}`,
    ``,
    pending.length === 0
      ? `Aucun HITL en attente.`
      : `⏳ *${pending.length} HITL en attente :*\n` + pending.map((p) => `#${p.id} (${p.kind}) — expire ${p.expires_at}`).join("\n"),
  ];
  await sendMessage(db, env, lines.join("\n"));
  // Renvoyer les claviers des HITL en attente pour validation en un tap.
  for (const p of pending.slice(0, 5)) {
    await sendMessage(db, env, `HITL #${p.id} (${p.kind}) : ${summarizePayload(p.payload)}`, { replyMarkup: hitlKeyboard(p.id) });
  }
}

function summarizePayload(raw: string): string {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p["summary"] === "string") return p["summary"].slice(0, 300);
    return JSON.stringify(p).slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

async function handleUnfreeze(db: D1Database, env: Env, username: string): Promise<string> {
  const frozen = (await getFlag(db, "freeze")) === "true";
  if (!frozen) {
    await sendMessage(db, env, "Le système n'est pas gelé — rien à dégeler.");
    return "unfreeze_noop";
  }
  const pending = (await getFlag(db, "unfreeze_pending")) === "true";
  if (!pending) {
    // Étape 1/2 : on arme la double confirmation.
    await setFlag(db, "unfreeze_pending", "true");
    await logDecision(db, "unfreeze_step1", `Double confirmation armée par ${username} (étape 1/2).`, { actor: `telegram:${username}` });
    const id = await createHitlRequest(db, env, "unfreeze", { step: 2 }, {
      summary: "Confirmez le dégel du système (étape 2/2). Les actions sortantes reprendront.",
      ttlHours: 1,
    });
    await sendMessage(db, env, `⚠️ Dégel demandé (étape 1/2). Confirmez via le bouton du HITL #${id} (étape 2/2).`);
    return "unfreeze_step1";
  }
  await sendMessage(db, env, "Une demande de dégel est déjà en attente — confirmez-la via son bouton.");
  return "unfreeze_waiting";
}

async function sendKpi(db: D1Database, env: Env, dateArg?: string): Promise<void> {
  const date = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : utcToday();
  const kpi = await computeDailyKpi(db, date);
  await sendMessage(db, env, formatKpiMessage(kpi));
}

async function sendMissions(db: D1Database, env: Env): Promise<void> {
  const { results } = await db
    .prepare("SELECT id, title, source_platform, amount, currency, score, status FROM missions WHERE status IN ('proposed','approved','executing') ORDER BY score DESC LIMIT 10")
    .all<{ id: number; title: string | null; source_platform: string; amount: number | null; currency: string | null; score: number | null; status: string }>();
  if (!results || results.length === 0) {
    await sendMessage(db, env, "Aucune mission en file. Le prochain scan arrive (toutes les 6h).");
    return;
  }
  const lines = results.map(
    (m) => `#${m.id} [${m.status}] ${m.score ?? 0} pts — ${m.title ?? "(sans titre)"} (${m.source_platform}, ${m.amount ?? "?"} ${m.currency ?? ""})`,
  );
  await sendMessage(db, env, `🎯 *Missions en file :*\n\n${lines.join("\n")}`);
}

async function sendDeals(db: D1Database, env: Env): Promise<void> {
  const { results } = await db
    .prepare("SELECT id, client_price, freelancer_cost, margin_net, currency, status FROM arbitrage_deals WHERE status IN ('scouting','proposed','hired','delivered') ORDER BY id DESC LIMIT 10")
    .all<{ id: number; client_price: number; freelancer_cost: number | null; margin_net: number | null; currency: string | null; status: string }>();
  if (!results || results.length === 0) {
    await sendMessage(db, env, "Aucun deal F2 actif.");
    return;
  }
  const lines = results.map(
    (d) => `#${d.id} [${d.status}] client ${d.client_price} / freelance ${d.freelancer_cost ?? "?"} → marge ${d.margin_net ?? "?"} ${d.currency ?? ""}`,
  );
  await sendMessage(db, env, `🤝 *Deals F2 actifs :*\n\n${lines.join("\n")}`);
}

async function sendPlatforms(db: D1Database, env: Env): Promise<void> {
  const rules = await listPlatformRules(db);
  const lines = rules.map(
    (r) => `${r.can_auto_submit === 1 ? "🟢" : "🔴"} ${r.platform} — auto-submit ${r.can_auto_submit === 1 ? "OK" : "INTERDIT"}${r.requires_hitl_for_submit === 1 ? " (humain)" : ""}`,
  );
  await sendMessage(db, env, `📋 *Matrice ToS :*\n\n${lines.join("\n")}\n\n_Plateforme non listée = refus + approbation humaine._`);
}

async function resolveHitlByCommand(db: D1Database, env: Env, approve: boolean, idArg?: string): Promise<string> {
  const id = Number(idArg);
  if (!idArg || Number.isNaN(id)) {
    await sendMessage(db, env, "Usage : /approve <id> ou /deny <id>.");
    return "hitl_usage";
  }
  const req = await db.prepare("SELECT * FROM hitl_requests WHERE id = ?").bind(id).first<{ status: string; kind: string }>();
  if (!req) {
    await sendMessage(db, env, `HITL #${id} introuvable.`);
    return "hitl_not_found";
  }
  if (req.status !== "pending") {
    await sendMessage(db, env, `HITL #${id} déjà traité (${req.status}).`);
    return "hitl_resolved";
  }
  // Réutilise le chemin des boutons (mêmes effets métier).
  const { handleCallbackQuery } = await import("./hitl");
  return handleCallbackQuery(db, env, `cmd-${Date.now()}`, `hitl:${approve ? "approve" : "deny"}:${id}`);
}
