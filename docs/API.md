# Référence API — loop v2

Base locale : `http://localhost:8787`. Toutes les réponses sont JSON.
Erreurs : `{ "error": "message" }` (+ `details` pour la validation Zod).

> Il n'y a **aucune** route trading et il ne doit jamais y en avoir (spec §13).

## Santé

```bash
GET /
# → { name, version, mission, routes, guarantees }
```

## Missions (F1)

```bash
GET  /missions?status=proposed&platform=algora&limit=50&offset=0
GET  /missions/123

# Import manuel (plateformes lecture seule : upwork, malt…)
POST /missions
# { platform, externalId, title, url?, amount?, currency?, deadline?,
#   summary?, effortEstimateH?, acceptanceProba? }
# → 201 { ok, id, kind, score } · 200 { duplicate: true, id }

# Demande de validation HITL (notifie Telegram avec boutons)
POST /missions/123/approve
# → { ok, hitlId }

# Exécute (statut approved requis)
POST /missions/123/execute
# → { ok, missionId, deliverableRef }

# Soumet : auto si ToS OK, sinon prépare le draft humain
POST /missions/123/submit
# → { ok, via: "auto"|"human", message }

# L'humain confirme avoir cliqué sur la plateforme
POST /missions/123/confirm-human-submit
```

Exemple :

```bash
curl -X POST localhost:8787/missions \
  -H 'Content-Type: application/json' \
  -d '{"platform":"upwork","externalId":"uw-1","title":"Dashboard Python",
       "amount":300,"currency":"USDC","effortEstimateH":4,"acceptanceProba":0.5}'
```

## Arbitrage F2

```bash
GET  /deals?status=proposed
GET  /deals/7

# Chiffrage (422 si marge < seuil)
POST /deals/quote
# { missionId?, clientPrice, currency?, freelancerCost, platformFees?,
#   controlTimeCost?, freelancerContact?, freelancerPlatform?, notes? }
# → 201 { ok, dealId, marginNet, deal }

POST /deals/7/request-approval   # HITL obligatoire → Telegram
POST /deals/7/hired              # { freelancerContact } — après HITL
POST /deals/7/delivered          # { controlNotes }
POST /deals/7/paid               # clôture (human_payout + sale déjà tracés)
POST /deals/7/cancel             # { reason? }
```

## Ledger & wallets

```bash
GET  /ledger?limit=50&offset=0

POST /ledger
# { kind: sale|self_test|transfer|fee|human_payout|api_cost,
#   amountUsdc?, currency?, sourcePlatform?, missionId?,
#   txHash?, paymentNonce?, payer?, costKind? }
# → 201 { ok, idempotentReplay: false, eventId }
# → 200 { ok, idempotentReplay: true, eventId }  (nonce/tx déjà vu)

GET  /ledger/wallets
POST /ledger/wallets             # ajout = HITL obligatoire
# { address, role: PAYTO|OPS|SPEND|OTHER, addedBy, hitlApproved, note? }
```

## Plateformes (ToS — lecture seule)

```bash
GET /platforms        # { rules, connectors, policy }
GET /platforms/upwork # { rule, known } · 404 si inconnue (= refus par défaut)
```

> La matrice ne s'écrit que par migration SQL revue (voir `docs/TOS_MATRIX.md`).

## Système

```bash
GET  /system/status    # { freeze, degradedMode, quotas, pendingHitl, kpiToday, config, version }
POST /system/freeze    # gel immédiat
POST /system/unfreeze  # étape 1/2 → HITL Telegram pour confirmer (étape 2/2)
GET  /system/decisions?limit=50   # journal d'audit
GET  /system/hitl                 # HITL en attente (expire les dépassés)
POST /system/scan                 # cycle F1 manuel → { report, hitlId? }
```

## KPI

```bash
GET /kpi/today
# { kpi: { date, revenue_usdc, revenue_eur_estimate, costs_usdc, net_usdc,
#          sales_count, missions_detected, missions_executed,
#          missions_pending_hitl, deals_active } }

GET /kpi/2026-09-24
GET /kpi/by-source/2026-09-24   # { date, bySource: [{ platform, revenue, sales }] }
```

## Webhooks

```bash
POST /webhooks/telegram   # header X-Telegram-Secret requis · updates du bot
POST /webhooks/x402        # paiement USDC entrant (facilitator)
# { paymentNonce, txHash?, amountUsdc, payer, missionId?, sourcePlatform? }
# → 201 { ok, eventId, idempotentReplay: false }
```

## Codes d'erreur usuels

| Code | Sens |
|---|---|
| 400 | payload invalide (détails Zod) |
| 403 | refusé (secret webhook, wallet sans HITL…) |
| 404 | ressource inconnue (mission, deal, plateforme) |
| 409 | transition illégale (ex. exécuter sans approbation) |
| 422 | règle métier (marge < seuil, montant invalide…) |
