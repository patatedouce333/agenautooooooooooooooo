# Ledger & rails de paiement — loop v2

> Référence spec : §6 (rails) + §8 (KPI). Code : `src/core/ledger.ts`,
> `src/payments/`, table `events`.

## 1. Le wallet comme banque

| Rôle | Usage | Règle |
|---|---|---|
| **PAYTO** | Reçoit **tout** : USDC x402, crypto bounties, freelance | clé **jamais** sur le serveur, ne signe rien |
| **OPS** | Admin (approbations, freeze, config) | solde symbolique (~2 USDC) |
| **SPEND** | Dépenses agent (facilitator, micro-achats x402, avances F2) | **plafonds stricts** (policy `spend`) |

`authorizeAndRecordSpend()` : policy **d'abord**, dépense réelle **ensuite**.
En cas de refus, ne jamais dépenser. Chaque dépense = `events(kind='fee')`.

## 2. Ledger append-only

Table `events` — on n'update **jamais** un événement financier :

| kind | Sens | Compte dans |
|---|---|---|
| `sale` | entrée (client tiers) | **revenu** ✅ |
| `self_test` | autopaiement (payer ∈ own_wallets) | rien (exclu) |
| `transfer` | mouvement interne | rien |
| `fee` | sortie (facilitator, SPEND…) | coûts |
| `human_payout` | paie freelance F2 | coûts |
| `api_cost` | LLM, infra… (`cost_kind`) | coûts |

## 3. Anti self-dealing

- `own_wallets` explicite, versionnée (`added_at/added_by`), **HITL pour ajout**.
- `recordEvent()` : si `kind='sale'` et `payer ∈ own_wallets` → requalifié
  en `self_test`, **jamais** dans le revenu.
- Comparaison insensible à la casse (`LOWER(address)`).

Test : `tests/ledger.test.ts` → « autopaiement → self_test, jamais dans le KPI » ✔.

## 4. Idempotence (pas de double crédit)

`tx_hash` et `payment_nonce` **UNIQUE** : même paiement soumis deux fois →
`{ idempotentReplay: true, eventId }`, un seul crédit.
Test : « même nonce x402 deux fois → replay » ✔.

## 5. KPI quotidien

```sql
Revenu = SUM(sale, payer ∉ own_wallets, jour J)
Coûts  = SUM(fee) + SUM(human_payout) + SUM(api_cost)
Net    = Revenu − Coûts
```

API : `GET /kpi/today`, `/kpi/:date`, `/kpi/by-source/:date`.
Parité EUR≈USDC 1:1 par défaut (`revenue_eur_estimate`).

## 6. x402 (Coinbase facilitator)

- **Entrant** : `POST /webhooks/x402` → `verifyFacilitatorSignature()`
  (fail-closed) → `recordIncomingX402Payment()` → `sale` (+ mission → `paid`).
- **Sortant** : via SPEND (policy d'abord), traçé `fee`.
- ⚠️ PROD : remplacer le stub `verifyFacilitatorSignature` par la vérification
  CDP réelle avant d'encaisser (voir commentaire dans `src/payments/x402.ts`).

## 7. Hors-rampage & fiscalité (FR)

- **Off-ramp** : Coinbase (CASP MiCA) → SEPA, hebdomadaire en batch.
- **Comptabilité** : export ledger → Waltio/Koinly :
  ```bash
  curl 'https://loop-agent.<x>.workers.dev/ledger?limit=200&offset=0' > ledger.json
  # + D1 : SELECT * FROM events ORDER BY id (export CSV via dashboard D1)
  ```
