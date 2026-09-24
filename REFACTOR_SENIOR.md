# Refactor Brief — Senior Dev Review (loop v2.0)

> **Audience :** senior dev chargé du refactor post-v1.
> **But :** état des lieux honnête, failles à corriger, backlog priorisé, architecture cible.
> **Périmètre :** tout le repo (`src/`, `tests/`, `frontend/`, `migrations/`, `docs/`).
> **État au 24/09/2026 :** fonctionnel, 48/48 tests verts, déployable J0 — mais avec des raccourcis assumés listés ci-dessous. Rien n'est caché : chaque stub est marqué `STUB`/`TODO` dans le code.

---

## 1. Verdict global (TL;DR)

**Ce qui est sain :**
- Séparation claire `core/` (policy, ledger, scoring) vs `f1/`/`f2/` vs `routes/` vs `telegram/`. La policy est évaluée côté serveur, un seul point de passage (`evaluatePolicy`).
- Tests unitaires déterministes via `FakeD1`, verrouillage anti-trading statique, migrations SQL validées sur SQLite réel.
- Docs à jour et spec-tracée (§). Chaque fichier a un en-tête de rôle.

**Les 5 chantiers qui comptent vraiment (tout le reste est P2) :**
1. **L'API REST n'a AUCUNE authentification** (P0-1) — `/system/freeze`, `/missions/:id/execute`, `POST /ledger` sont ouverts à quiconque a l'URL.
2. **`hitlApproved: boolean` est déclaratif, jamais vérifié** (P0-2) — l'appelant passe `true`, aucune lecture de `hitl_requests`. Le verrou F2/HITL est du théâtre sans single-use token.
3. **`verifyFacilitatorSignature` retourne `true` en dur** (P0-3) — fail-OPEN : n'importe qui peut forger un `sale` via `/webhooks/x402` (aggravé par P0-1).
4. **Zéro test de routes / webhooks / crons / connecteurs** (P0-4) — les chemins HTTP réels ne sont couverts que par les tests unitaires des fonctions internes.
5. **Montants en `REAL` (float)** (P0-5) — acceptable en v2.0, à migrer vers centimes (`INTEGER`) ou décimal (`TEXT`) avant volume.

---

## 2. P0 — Bloquant sécurité / correction (avant prod réelle)

### P0-1. Authentifier l'API (endpoints sensibles ouverts)
- **Fichiers :** `src/index.ts` (montage routes), toutes les routes `src/routes/*.ts`.
- **Constat :** seul `/webhooks/telegram` vérifie un secret. `POST /system/freeze`, `POST /system/unfreeze`, `POST /missions/:id/execute`, `POST /deals/:id/*`, `POST /ledger`, `POST /system/scan` sont anonymes. Le CORS (`cors()` par défaut) autorise toutes les origines.
- **Refactor :**
  - Middleware Hono `requireAdmin` : `Authorization: Bearer <ADMIN_API_TOKEN>` (secret Workers), appliqué à tout sauf `GET /` (health) — ou tout sauf allowlist explicite.
  - Restreindre `cors({ origin: [dashboardPagesUrl] })` en prod, `*` en dev uniquement via flag.
  - Séparer si besoin token lecture / écriture plus tard (pas nécessaire en v2.1).
- **Effort :** S (2–4 h). **Risque si ignoré :** critique.

### P0-2. HITL : passer du booléen déclaratif au token single-use vérifié
- **Fichiers :** `src/payments/rails.ts` (`authorizeAndRecordSpend`, `addOwnWallet`), `src/f2/arbitrage.ts` (pas de lien HITL côté code), `src/telegram/hitl.ts`.
- **Constat :** `hitlApproved?: boolean` est un paramètre d'appel — aucun contrôle que la demande `#id` existe, est `approved`, correspond au bon `kind`/montant, et n'a pas déjà servi. Un appelant (bug, LLM, attaquant via P0-1) passe `true` et contourne tout.
- **Refactor :**
  - Remplacer `hitlApproved: boolean` par `hitlRequestId: number` dans les signatures.
  - Nouvelle fonction `consumeHitlApproval(db, { id, kind, refType?, refId?, maxAmountUsdc? })` : vérifie `status='approved'` + kind + correspondance payload, puis marque `consumed` (ajouter colonne `consumed_at` via migration `0003`) — usage unique, anti-rejeu.
  - Côté F2 : `markHired` doit exiger un `f2_deal` consumé (aujourd'hui seul le statut `proposed` est testé — contournable via API directe).
  - Exposer dans le dashboard le lien demande → action (traçabilité).
- **Effort :** M (1–2 j avec migration + tests). **Risque si ignoré :** critique (verrou F2 contournable).

### P0-3. x402 : implémenter la vérification facilitateur (fail-closed réel)
- **Fichier :** `src/payments/x402.ts` → `verifyFacilitatorSignature()` retourne `true`.
- **Constat :** le commentaire dit fail-closed mais le stub est fail-open. Combiné à P0-1, n'importe qui crédite des `sale`.
- **Refactor :** brancher la vérification CDP Coinbase (signature du facilitateur) ; en attendant, **désactiver la route** (`503`) via flag `X402_LIVE=false`, ou exiger le bearer admin (P0-1) + allowlist de payeurs. Ne jamais shipper le stub `true` en prod.
- **Effort :** M (intégration CDP + tests). **Risque si ignoré :** critique.

### P0-4. Ajouter des tests de routes / webhooks / crons (hono/test)
- **Fichiers :** tout `src/routes/*`, `src/cron/scheduler.ts`, connecteurs.
- **Constat :** 48 tests unitaires excellents, mais **zéro test HTTP**. Exemples de chemins non couverts : `POST /missions` (INSERT avec littéral `'scored'` mélangé aux binds — fragile, cf. §4), `POST /system/scan` (requête `IN (...)` dynamique), webhooks Telegram (secret), dispatch cron.
- **Refactor :**
  - Tester l'app Hono via `hono/testing` (ou `app.request`) avec `FakeD1` injecté dans `Env` — pattern : `app.fetch(new Request(...), { DB: asD1(fake), ...env })`.
  - Priorité : `missions` (import/execute/submit), `deals` (quote→paid), `webhooks/x402` (idempotence), `system/scan`, Telegram `/freeze`→ action bloquée.
  - Connecteurs : tester avec `fetch` mocké (succès + 500 + timeout) — contrat `Connector` (jamais de throw).
  - Cron : tester `handleScheduled` via `event.cron` (cf. P0-6).
- **Effort :** M (2–3 j). **Valeur :** verrouille le refactor P0-1/P0-2.

### P0-5. Argent : migrer `REAL` → centimes `INTEGER` (ou `TEXT` décimal)
- **Fichiers :** `migrations/0001_init.sql` (`amount`, `amount_usdc`, prix F2, `margin_net` GENERATED), `src/core/ledger.ts`, `src/f2/arbitrage.ts`, frontend `fmtMoney`.
- **Constat :** les floats accumulent des erreurs d'arrondi (`0.1+0.2`). `round2()` masque, ne corrige pas.
- **Refactor :** migration `0004` : nouvelles colonnes `*_cents INTEGER`, backfill `ROUND(x*100)`, bascule du code (unité = centimes partout, formatage à l'affichage), suppression des colonnes float en `0005` après validation. Alternative : `TEXT` + lib décimale si montants exotiques — overkill ici.
- **Effort :** M (1–2 j, migration + code + tests + frontend). **Fenêtre :** maintenant, base vide.

### P0-6. Dispatch cron : switcher sur `event.cron`, pas sur l'heure
- **Fichier :** `src/cron/scheduler.ts` → `getUTCHours() === 20`.
- **Constat :** fragile (retard d'exécution, changement de planning, chevauchement). `ScheduledEvent` expose le champ `cron` (l'expression déclenchante).
- **Refactor :** `switch (event.cron) { case "0 */6 * * *": scan; case "0 20 * * *": kpi }` + défaut = log + noop. Rendre les expressions importables depuis un seul module partagé avec `wrangler.toml` (commentaire de synchro ou génération).
- **Effour :** XS (1–2 h).

---

## 3. P1 — Robustesse & maintenabilité (v2.1)

### P1-1. Valider l'env au boot (Zod), fail-fast
- `Number(undefined)` → `NaN` silencieux dans `configFromEnv`/`resolveConfig` (deux fonctions en double ! `src/types.ts` vs `src/core/policy.ts` — n'en garder qu'une). Schéma Zod pour `Env` : montants > 0, chat_id numérique, URLs valides. Échec bruyant au premier appel.
- Effort XS.

### P1-2. Factoriser la proposition top-N (duplication ~15 lignes)
- `src/routes/system.ts` (`POST /scan`) et `src/cron/scheduler.ts` (`runScanCron`) dupliquent : fetch `IN (...)`, formatage, `createHitlRequest`. Extraire `src/f1/propose.ts` → `proposeTopN(db, env, ids): Promise<hitlId|null>`. + tests.
- Effort XS.

### P1-3. Casser le cycle d'imports Telegram proprement
- `commands.ts` fait `await import("./hitl")` (contournement). Extraire `telegram/client.ts` (`sendMessage`, `answerCallback`, `hitlKeyboard`, consts) importé par `bot.ts`, `commands.ts`, `hitl.ts` — imports statiques partout.
- Effort XS.

### P1-4. Scan parallèle + timeouts + retries
- `runScanCycle` appelle 9 connecteurs **en séquence**, `fetch` sans timeout (un connecteur lent bloque le cron ; budget subrequests Workers : 50/invocation en gratuit — OK aujourd'hui, à surveiller avec le LLM).
- Refactor : `Promise.allSettled` + `AbortSignal.timeout(8000)` par connecteur + retry 1× (backoff) sur erreurs réseau + compteur `partial` déjà prévu. Ajouter per-connector `last_error_at` (table ou flags) pour couper un connecteur en panne (circuit breaker fruste).
- Effort S.

### P1-5. Durcir le SQL dynamique
- `updateMissionStatus` (`src/db/queries.ts`) construit `SET` depuis `Object.entries` — clés internes aujourd'hui, mais pattern à risque. → allowlist de colonnes + helper typé par table.
- `POST /missions/:id` : réécrire l'INSERT avec colonnes explicites (le littéral `'sc
...[truncated 12195 chars]