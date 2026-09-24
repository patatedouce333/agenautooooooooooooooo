/**
 * Bot Telegram — transport (spec §2 : chat Telegram + cron + webhooks).
 *
 * Responsabilités :
 * - envoyer des messages (alertes HITL, KPI, drafts à copier-coller) ;
 * - recevoir les updates via webhook (`POST /webhooks/telegram`) ;
 * - router vers `commands.ts` (commandes) et `hitl.ts` (approve/deny).
 *
 * Sécurité : seul `TELEGRAM_ADMIN_CHAT_ID` peut commander ; le webhook
 * vérifie `TELEGRAM_WEBHOOK_SECRET` (header X-Telegram-Secret).
 */

import type { Env } from "../types";
import { bumpCounter } from "../core/quotas";
import { handleCommand } from "./commands";
import { handleCallbackQuery } from "./hitl";

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: { id: number; username?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: TelegramMessage;
    from: { id: number; username?: string };
  };
}

const TELEGRAM_API = "https://api.telegram.org";

/** Envoie un message texte (Markdown supporté) à l'admin. */
export async function sendMessage(
  db: D1Database,
  env: Env,
  text: string,
  opts: { parseMode?: "Markdown" | "HTML"; replyMarkup?: unknown } = {},
): Promise<boolean> {
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return false;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text: text.slice(0, 4000),
        parse_mode: opts.parseMode ?? "Markdown",
        reply_markup: opts.replyMarkup,
      }),
    });
    await bumpCounter(db, "telegram_msg", 1).catch(() => 0);
    return res.ok;
  } catch {
    return false;
  }
}

/** Clavier inline approve/deny pour les demandes HITL. */
export function hitlKeyboard(requestId: number): unknown {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approuver", callback_data: `hitl:approve:${requestId}` },
        { text: "❌ Refuser", callback_data: `hitl:deny:${requestId}` },
      ],
    ],
  };
}

/** Répond à un callback query (enlève le spinner côté client). */
export async function answerCallback(env: Env, callbackId: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text.slice(0, 200) }),
  }).catch(() => undefined);
}

/** Point d'entrée webhook : vérifie l'expéditeur puis route. */
export async function handleTelegramUpdate(db: D1Database, env: Env, update: TelegramUpdate): Promise<string> {
  const adminId = Number(env.TELEGRAM_ADMIN_CHAT_ID);

  if (update.callback_query) {
    const fromId = update.callback_query.from.id;
    if (fromId !== adminId) {
      await answerCallback(env, update.callback_query.id, "Non autorisé.");
      return "unauthorized";
    }
    return handleCallbackQuery(db, env, update.callback_query.id, update.callback_query.data ?? "");
  }

  const msg = update.message;
  if (!msg?.text) return "ignored";
  if (msg.chat.id !== adminId) return "unauthorized";

  const username = msg.from?.username ?? String(msg.from?.id ?? "admin");
  return handleCommand(db, env, msg.text.trim(), username);
}
