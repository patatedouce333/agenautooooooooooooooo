# Déploiement — loop v2

> Coût J0 : **0 €** (Cloudflare + Telegram + facilitator gratuits au départ).
> Pas de domaine payant, VPS ou LLM payant avant le premier USDC externe encaissé (spec §13).

## 1. Prérequis

- Compte Cloudflare (Workers + D1 + Pages)
- Bot Telegram (via [@BotFather](https://t.me/BotFather)) + votre `chat_id`
  (obtenu en écrivant au bot puis `https://api.telegram.org/bot<TOKEN>/getUpdates`)
- Node 20+ · `npm i -g wrangler` (ou npx)

## 2. Backend — premier déploiement

```bash
npm install

# 1) Base D1
npx wrangler d1 create loop-db
# → copier database_id dans wrangler.toml ([[d1_databases]] + env.dev)

# 2) Migrations + seed ToS (distant)
npm run db:migrate:remote
npm run seed:remote

# 3) Secrets (JAMAIS dans wrangler.toml ni git)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ADMIN_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # chaîne aléatoire longue
# plus tard : SPEND_PRIVATE_KEY, GITHUB_TOKEN, ALGORA_API_KEY…

# 4) Déployer (crons inclus via wrangler.toml [triggers])
npm run deploy
# → https://loop-agent.<sous-domaine>.workers.dev
```

## 3. Webhook Telegram

```bash
TELEGRAM_BOT_TOKEN=xxx \
WORKER_URL=https://loop-agent.<sous-domaine>.workers.dev \
TELEGRAM_WEBHOOK_SECRET=yyy \
npm run telegram:webhook
# → {"ok":true,...}

# Vérifier : envoyez /status au bot → réponse immédiate.
```

## 4. Frontend (Cloudflare Pages)

**Option A — Pages + API Workers (recommandé)** :

```bash
cd frontend
npm install
# .env production (Pages → Settings → Environment variables) :
#   VITE_API_URL=https://loop-agent.<sous-domaine>.workers.dev
#   VITE_MOCK_FALLBACK=false
npm run build          # → dist/
npx wrangler pages deploy dist --project-name loop-dashboard
```

**Option B — tout-en-un** : servir `frontend/dist` via le Worker
(`site` bucket / Workers Static Assets — voir docs Cloudflare).

## 5. Variables & secrets — récapitulatif

| Nom | Où | Secret ? | Défaut |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | ✅ | — |
| `TELEGRAM_ADMIN_CHAT_ID` | secret | ✅ | — |
| `TELEGRAM_WEBHOOK_SECRET` | secret | ✅ | — |
| `SPEND_PRIVATE_KEY` | secret | ✅ | — |
| `DAILY_SPEND_LIMIT_USDC` | vars | ❌ | `1` |
| `F2_MIN_MARGIN_EUR` | vars | ❌ | `15` |
| `F2_LITIGATION_RESERVE_RATE` | vars | ❌ | `0.10` |
| `SCAN_TOP_N` | vars | ❌ | `5` |
| `PAYTO_ADDRESS/OPS_ADDRESS/SPEND_ADDRESS` | vars | ❌ (adresses) | — |
| `GITHUB_TOKEN/ALGORA_API_KEY/…` | secrets | ✅ | — |

## 6. Comptes externes (spec §12)

| Quand | Service | Action |
|---|---|---|
| J0 | GitHub, Telegram, Cloudflare, wallets | code, bot, infra, banque |
| J0 | Coinbase CDP | facilitator x402 |
| J1 | Algora / Gitcoin / Dework | comptes, premières revues |
| J1 | RentAHuman (client) | compte pour F2 |
| J5–J10 | Malt / ComeUp / Upwork | comptes pro, KYC |
| Avant fiat régulier | Autoentrepreneur (INPI) | SIRET, BNC |
| Avant fiat régulier | Banque dédiée + Waltio/Koinly | séparation flux, fiscalité |

## 7. Runbook minimal

```bash
# Logs temps réel
npm run tail

# KPI du jour (API)
curl https://loop-agent.<xxx>.workers.dev/kpi/today

# Geler en urgence (si Telegram HS)
curl -X POST https://loop-agent.<xxx>.workers.dev/system/freeze

# Rollback : wrangler rollback / redéployer le tag précédent
```

## 8. Environnements

- `dev` (`env.dev` dans wrangler.toml) : base `loop-db-dev`, déployé via
  `npx wrangler deploy --env dev`.
- `production` : base `loop-db`.
- Règle : toute migration D1 est testée en `dev` avant `production`.
