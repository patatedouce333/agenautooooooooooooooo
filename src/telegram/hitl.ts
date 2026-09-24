/**
 * HITL — validations humaines (spec §4-§5 : « approve / deny »).
 *
 * Principes :
 * - timeout = deny : `expires_at` dépassé → `expired`, l'agent ne prend RIEN ;
 * - chaque demande porte son contexte JSON (résumé pour Telegram) ;
 * - la résolution déclenche l'action métier (approve mission, deal F2…).
 *
 * Kinds : mission_batch | f2_deal | spend | wallet_add | unfreeze | generic.
 */

import type { Env, HitlKind, HitlRequest } from "../types";
import { utcNowIso } from "../types";
import { getFlag, setFlag, logDecision } from "../db/queries";
import { proposeDeal } from "../f2/arbitrage";
import { answerCallback, hitlKeyboard, sendMessage } from "./bot";

const DEFAULT_TTL_HOURS = 12;

/** Crée une demande HITL + notifie Telegram avec boutons approve/deny. */
export async function createHitlRequest(
  db: D1Database,
  env: Env,
  kind: HitlKind,
  payload: Record<string, unknown>,
  opts: { refType?: string; refId?: number; ttlHours?: number; summary: string },
): Promise<number> {
  const now = new Date();
  const expires = new Date(now.getTime() + (opts.ttlHours ?? DEFAULT_TTL_HOURS) * 3600_000);
  const res = await db
    .prepare(
      `INSERT INTO hitl_requests (created_at, expires_at, kind, ref_type, ref_id, payload, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(now.toISOString(), expires.toISOString(), kind, opts.refType ?? null, opts.refId ?? null, JSON.stringify(payload))
    .run();
  const id = Number(res.meta.last_row_id);

  await sendMessage(
    db,
    env,
    `🔔 *HITL #${id} — ${kind}*\n\n${opts.summary}\n\n_Expire le ${expires.toISOString()} (timeout = refus)._`,
    { replyMarkup: hitlKeyboard(id) },
  );
  await logDecision(db, "hitl_created", `Demande #${id} (${kind}) créée.`, { actor: "agent", metadata: { id, kind } });
  return id;
}

/** Marque `expired` les demandes dépassées (cron — timeout = deny). */
export async function expireStaleHitlRequests(db: D1Database): Promise<number> {
  const now = utcNowIso();
  const res = await db
    .prepare("UPDATE hitl_requests SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND expires_at < ?")
    .bind(now, now)
    .run();
  const n = res.meta.changes ?? 0;
  if (n > 0) {
    await logDecision(db, "hitl_expired", `${n} demande(s) expirée(s) — timeout = deny, rien n'a été pris.`, { actor: "system" });
  }
  return n;
}

/** Route les callbacks approve/deny des boutons inline. */
export async function handleCallbackQuery(db: D1Database, env: Env, callbackId: string, data: string): Promise<string> {
  const match = data.match(/^hitl:(approve|deny):(\d+)$/);
  if (!match) {
    await answerCallback(env, callbackId, "Action inconnue.");
    return "unknown_callback";
  }
  const [, decision, idStr] = match;
  const id = Number(idStr);
  const req = await db.prepare("SELECT * FROM hitl_requests WHERE id = ?").bind(id).first<HitlRequest>();
  if (!req) {
    await answerCallback(env, callbackId, "Demande introuvable.");
    return "not_found";
  }
  if (req.status !== "pending") {
    await answerCallback(env, callbackId, `Déjà traitée (${req.status}).`);
    return "already_resolved";
  }
  if (req.expires_at < utcNowIso()) {
    await db.prepare("UPDATE hitl_requests SET status = 'expired', resolved_at = ? WHERE id = ?").bind(utcNowIso(), id).run();
    await answerCallback(env, callbackId, "Expirée (timeout = refus).");
    return "expired";
  }

  const approved = decision === "approve";
  await db
    .prepare("UPDATE hitl_requests SET status = ?, resolved_at = ?, resolved_by = 'telegram:admin' WHERE id = ?")
    .bind(approved ? "approved" : "denied", utcNowIso(), id)
    .run();
  await logDecision(db, approved ? "hitl_approved" : "hitl_denied", `Demande #${id} (${req.kind}) ${approved ? "approuvée" : "refusée"} via Telegram.`, {
    actor: "telegram:admin",
    metadata: { id, kind: req.kind, refType: req.ref_type, refId: req.ref_id },
  });

  // ── Effets métier ──
  if (approved) await applyApproval(db, env, req);

  await answerCallback(env, callbackId, approved ? "Approuvé ✅" : "Refusé ❌");
  await sendMessage(db, env, `${approved ? "✅" : "❌"} *HITL #${id}* (${req.kind}) ${approved ? "approuvée" : "refusée"}.`);
  return approved ? "approved" : "denied";
}

/** Applique l'effet métier d'une approbation (par kind). */
async function applyApproval(db: D1Database, env: Env, req: HitlRequest): Promise<void> {
  const payload = safeJson(req.payload);
  switch (req.kind) {
    case "mission_batch": {
      // payload: { missionIds: number[] }
      const ids = Array.isArray(payload["missionIds"]) ? (payload["missionIds"] as number[]) : [];
      for (const missionId of ids) {
        await db
          .prepare("UPDATE missions SET status = 'approved', hitl_approved_at = ?, hitl_approved_by = 'telegram:admin' WHERE id = ? AND status = 'proposed'")
          .bind(utcNowIso(), Number(missionId))
          .run();
      }
      await sendMessage(db, env, `🚀 ${ids.length} mission(s) approuvée(s) — exécution F1 lancée.`);
      break;
    }
    case "f2_deal": {
      // ref_id = deal F2
      if (req.ref_id) {
        await proposeDeal(db, req.ref_id, "telegram:admin");
        await sendMessage(db, env, `🤝 Deal F2 #${req.ref_id} approuvé — recrutement autorisé.`);
      }
      break;
    }
    case "unfreeze": {
      // /unfreeze = double confirmation : ce HITL est la 2e étape.
      await setFlag(db, "unfreeze_pending", "false");
      await setFlag(db, "freeze", "false");
      await sendMessage(db, env, "🧊❌ *Système dégelé* (double confirmation reçue).");
      break;
    }
    case "spend":
    case "wallet_add":
    case "generic":
    default: {
      // Ces kinds sont consommés par l'appelant métier (spend/wallet) qui
      // relit la demande ; on se contente de notifier.
      await sendMessage(db, env, `📝 Approbation #${req.id} (${req.kind}) enregistrée — reprenez l'action côté dashboard.`);
      break;
    }
  }
  void getFlag;
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Liste les demandes en attente (dashboard + /status). */
export async function listPendingHitl(db: D1Database): Promise<HitlRequest[]> {
  const { results } = await db
    .prepare("SELECT * FROM hitl_requests WHERE status = 'pending' ORDER BY expires_at ASC")
    .all<HitlRequest>();
  return results ?? [];
}
