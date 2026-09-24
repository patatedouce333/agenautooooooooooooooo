/**
 * Enregistre le webhook Telegram vers le Worker déployé.
 *
 * Usage :
 *   TELEGRAM_BOT_TOKEN=xxx WORKER_URL=https://loop-agent.<sub>.workers.dev \
 *   TELEGRAM_WEBHOOK_SECRET=yyy npm run telegram:webhook
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const workerUrl = process.env.WORKER_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !workerUrl || !secret) {
  console.error("Manquant : TELEGRAM_BOT_TOKEN, WORKER_URL, TELEGRAM_WEBHOOK_SECRET");
  process.exit(1);
}

const url = `${workerUrl.replace(/\/$/, "")}/webhooks/telegram`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "callback_query"] }),
});
console.log(await res.text());

export {};
