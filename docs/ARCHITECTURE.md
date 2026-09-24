# Architecture — loop v2

> Référence spec : §1 (logique métier), §2 (architecture d'ensemble).

## 1. Principe

Une seule mission : **maximiser le revenu encaissé par jour**. Deux fonctions :

- **F1 — Chasseur-exécuteur** : scan → score → validation humaine légère →
  exécution → soumission (auto ou draft humain) → encaissement.
- **F2 — Arbitrage humain** : chiffrage → approbation obligatoire → recrutement →
  contrôle → paie (marge nette tracée).

Ce qui n'existe **pas** : trading (même paper), catalogue passif, escrow maison,
contournement anti-bot, scraping-revente de données.

## 2. Boucle quotidienne

```
CRON 6h ──┐
Telegram ──┼──▶ Agent orchestrateur ──▶ F1 Scanner / Exécuteur ─┐
Webhooks ──┘   (LLM + policy)      ──▶ F2 Coordinateur ──────────┤
                                                                ▼
                                                     POLICY ENGINE (4 règles)
                                                     plafonds · ToS · no-trade · freeze
                                                                ▼
                                                     RAILS : PAYTO ← OPS ← SPEND
                                                                ▼
                                                     LEDGER + KPI (Telegram 20h UTC)
```

## 3. Infrastructure

| Brique | Choix | Pourquoi |
|---|---|---|
| Runtime | Cloudflare Workers | léger, permanent, cron natif, 0 € au départ |
| HTTP | Hono | routeur rapide, typé, validé pour Workers |
| Base | D1 (SQLite) | relationnel, migrations versionnées, gratuit au départ |
| Déclencheurs | Cron Triggers | scan 6h (`0 */6 * * *`), KPI soir (`0 20 * * *`) |
| Contrôle humain | Bot Telegram | approve/deny en un tap, freeze immédiat |
| Paiements | x402 (Coinbase facilitator) + plateformes | USDC entrant, 0 € (1k settles/mois) |
| Dashboard | React + Vite + Tailwind → Cloudflare Pages | pilotage visuel, mode démo sans backend |

## 4. Composants (carte du code)

```
src/
├── index.ts            Worker : montage Hono + handler `scheduled` (crons)
├── types.ts            Env, Mission, Deal, LedgerEvent, config (défauts spec)
├── core/
│   ├── policy.ts       LES 4 RÈGLES : spend, submit(ToS), no-trading, freeze
│   ├── ledger.ts       append-only, anti self-dealing, idempotence, KPI
│   ├── scoring.ts      score=(montant×proba)/effort + routage F1/F2
│   └── quotas.ts       compteurs D1 + mode dégradé à 90 %
├── db/queries.ts       SQL centralisé (bindé) + audit chaîné par hash
├── f1/
│   ├── scanner.ts      cycle : scan → dédup → score → top-N → HITL
│   ├── executor.ts     approved → executing (producteur LLM injectable)
│   └── submitter.ts    auto (ToS OK) vs draft humain + confirmation
├── f2/arbitrage.ts     quote → propose(HITL) → hire → deliver → pay
├── connectors/         1 fichier/source + registry.ts (9 connecteurs)
├── payments/
│   ├── rails.ts        SPEND (policy d'abord) + own_wallets (HITL)
│   └── x402.ts         entrant : vérif facilitator → sale (idempotent)
├── telegram/
│   ├── bot.ts          transport (envoi, webhook, routage, clavier HITL)
│   ├── commands.ts     /status /freeze /unfreeze /kpi /missions /deals…
│   ├── hitl.ts         file d'attente, timeout=deny, effets métier
│   └── kpi.ts          format + envoi du rapport du soir
├── routes/             API REST (missions, deals, ledger, platforms, system, kpi, webhooks)
└── cron/scheduler.ts   dispatch scan (6h) vs KPI (20h UTC)
```

## 5. Données (D1)

Voir `migrations/0001_init.sql` (schéma) et `0002_seed_platform_rules.sql` (ToS + flags).

| Table | Rôle |
|---|---|
| `missions` | cycle de vie `detected → scored → proposed → approved → executing → submitted → paid \| failed` |
| `arbitrage_deals` | deals F2 (`margin_net` GENERATED) |
| `events` | ledger append-only (`sale, self_test, transfer, fee, human_payout, api_cost`) |
| `own_wallets` | wallets propres (anti self-dealing, HITL pour ajout) |
| `platform_rules` | **matrice ToS** — modifiable uniquement par migration revue |
| `system_flags` | `freeze`, `degraded_mode`, `unfreeze_pending`, `schema_version` |
| `decisions` | audit chaîné (prev_hash → hash, FNV-1a) |
| `usage_counters` | quotas journaliers (anti auto-saturation) |
| `hitl_requests` | file HITL (`pending → approved/denied/expired`, timeout=deny) |

## 6. Flux critiques

### F1 — mission x402 (100 % autonome)
Scan → score → top-N → approve Telegram → exécution → **auto-submit**
(policy ToS OK) → webhook x402 → `sale` → mission `paid` → KPI.

### F1 — mission Algora (humain requis)
Scan → score → top-N → approve → exécution → **draft préparé**
(policy bloque l'auto-submit) → Telegram envoie le texte → humain clique →
`confirm-human-submit` → `submitted` → paiement → `sale`.

### F2 — arbitrage
Détection (humaine requise : terrain, légal…) → chiffrage (marge ≥ 15 € sinon rejet)
→ **HITL obligatoire** → recrutement → contrôle agent → paie freelance
(`human_payout`) + encaissement client (`sale`) → marge nette au KPI.

## 7. Sécurité & garde-fous

- Policy évaluée **côté serveur** à chaque action sortante (le LLM propose, `policy.ts` dispose).
- `guardNoTrading()` + `tests/no-trading.test.ts` : le trading est impossible par construction.
- Freeze D1 lu à chaque dépense/submit/embauche (aucun cache, effet immédiat).
- Injection SQL : 100 % de requêtes bindées (`db/queries.ts` centralise).
- Secrets : Workers secrets + `.dev.vars` local, jamais commités.
- Webhook Telegram : secret `X-Telegram-Secret` + restriction `ADMIN_CHAT_ID`.

## 8. Limites assumées (v2.0)

- Production du livrable LLM : interface `DeliverableProducer` + stub —
  brancher Workers AI ou une API externe (voir `docs/F1_GUIDE.md`).
- Vérification facilitator x402 : stub `verifyFacilitatorSignature` —
  brancher CDP Coinbase avant la prod (voir `docs/LEDGER.md`).
- Upwork/Malt/ComeUp : lecture seule / import manuel en attendant les comptes J5–J10.
- Taux EUR≈USDC à parité 1:1 (paramétrable plus tard).
