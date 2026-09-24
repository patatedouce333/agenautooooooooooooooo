# Bot Telegram — loop v2

> Code : `src/telegram/`. Webhook : `POST /webhooks/telegram`.

## 1. Rôle

Telegram vous garde aux commandes sur **tout ce qui touche l'argent**
ou une plateforme qui l'exige : validations en un tap, freeze immédiat,
KPI du soir. Timeout = refus : sans réponse, l'agent ne prend rien.

## 2. Commandes

| Commande | Effet |
|---|---|
| `/status` | freeze, mode dégradé, quotas, config, net du jour + HITL en attente (boutons renvoyés) |
| `/freeze` | **gel immédiat** (D1, sans redéploiement) — spend/submit/hire bloqués |
| `/unfreeze` | dégel en **double confirmation** (étape 1/2 ici, étape 2/2 via bouton HITL) |
| `/kpi [AAAA-MM-JJ]` | rapport : net, revenu, coûts, missions, deals F2 |
| `/missions` | file F1 (proposées/approuvées/en cours) |
| `/deals` | deals F2 actifs (client/freelance/marge) |
| `/platforms` | matrice ToS résumée (auto-submit OK / humain requis) |
| `/approve <id>` · `/deny <id>` | résoudre un HITL sans bouton |
| `/help` | aide |

Seul `TELEGRAM_ADMIN_CHAT_ID` peut commander ; le webhook vérifie
`X-Telegram-Secret` (configuré dans `scripts/set-telegram-webhook.ts`).

## 3. Boutons HITL

Chaque demande arrive avec **✅ Approuver / ❌ Refuser** :

| Kind | Déclenche | Effet de l'approbation |
|---|---|---|
| `mission_batch` | top-N après scan | missions → `approved` → exécution F1 |
| `f2_deal` | deal chiffré | deal → `proposed` → recrutement autorisé |
| `spend` | dépense > plafond | dépense autorisée (via `hitl`) |
| `wallet_add` | nouveau wallet propre | ajout à `own_wallets` |
| `unfreeze` | `/unfreeze` | dégel (2e confirmation) |
| `generic` | divers | enregistrée, action reprise côté dashboard |

Expiration : TTL 12 h par défaut (1 h pour `unfreeze`) ; le cron marque
`expired` les dépassées (**timeout = deny**, tracé `hitl_expired`).

## 4. KPI du soir (20h UTC)

```
🟢 loop — rapport du 2026-09-24

💰 Net aujourd'hui : 163.20 USDC / 187.50 € (est.)

Revenu : 187.50 USDC (4 vente(s))
Coûts : 24.30 USDC (fees + F2 + API)

🎯 Missions détectées : 23
✅ Exécutées/soumises : 3
⏳ En attente de validation : 2
🤝 Deals F2 actifs : 1
```

Format : `src/telegram/kpi.ts` (`formatKpiMessage`).

## 5. Configuration

```bash
# Secrets Workers
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ADMIN_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# Enregistrer le webhook
TELEGRAM_BOT_TOKEN=xxx WORKER_URL=https://loop-agent.<x>.workers.dev \
TELEGRAM_WEBHOOK_SECRET=yyy npm run telegram:webhook
```
