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
- `POST /missions` : réécrire l'INSERT avec colonnes explicites (le littéral `'scored'` mélangé aux binds est fragile et non testé — FakeD1 ne supporte même pas ce motif, preuve du trou de couverture).
- `system.ts` : requête `IN (${placeholders})` — placeholders bindés OK, mais extraire un helper `fetchMissionsByIds` testé.
- Effort S (avec tests).

### P1-6. Contraintes d'intégrité en base (CHECK + ENUM)
- `status`, `kind`, `currency`, `submitted_via` sont des `TEXT` libres. Migration `0005` : `CHECK (status IN (...))`, `CHECK (kind IN (...))`, `CHECK (currency IN ('USDC','EUR'))`. Le code ne pourra plus écrire d'état invalide même en cas de bug.
- `missions.external_id` nullable + index unique : SQLite autorise plusieurs NULL (distincts) — comportement voulu (brouillons sans ID externe) mais à documenter dans la migration.
- Effort S.

### P1-7. Audit : SHA-256 au lieu de FNV-1a
- `chainHash` (`src/db/queries.ts`) : FNV-1a détecte les corruptions, pas les falsifications. `crypto.subtle.digest("SHA-256")` existe dans Workers — l'utiliser (async). Ajouter une route `GET /system/audit/verify` qui re-joue la chaîne.
- Effort XS–S.

### P1-8. Supprimer le code mort et les doublons
- `assertNoTradingModule()` (`src/core/ledger.ts`) : no-op bizarre — supprimer (le test statique suffit).
- `resolveConfig` (`types.ts`) vs `configFromEnv` (`policy.ts`) : n'en garder qu'une (cf. P1-1).
- `idParamIndex` ternaire identique des deux côtés (`tests/support/fake-d1.ts`) : nettoyer.
- `void getFlag;` / `void env;` / `void _env;` : résidus — nettoyer les signatures au lieu de masquer.
- Effort XS.

### P1-9. Frontend : corriger le proxy `/api` mort + dette UX
- **Bug réel :** `vite.config.ts` définit un proxy `/api → :8787`, mais `lib/api.ts` appelle `BASE + "/system/status"` avec `BASE=""` en dev → les requêtes partent vers Vite (404) → **mode démo permanent en dev local**. Décider : soit `VITE_API_URL=http://localhost:8787` documenté comme requis en dev (+ CORS ouvert, déjà le cas), soit préfixer le client par `/api` en dev. Le proxy actuel est du code mort.
- `window.prompt` dans `Deals.tsx` (recrutement, contrôle) : remplacer par des modales/formulaires (état React, validation).
- `allowedHosts` hardcode l'hôte d'une sandbox périmée : garder `PREVIEW_HOST` + commentaire, et envisager `allowedHosts: true` (Vite ≥ 6) ou variable d'env exclusive.
- Pas d'Error Boundary React : une exception dans un onglet tue tout le dashboard. Ajouter une boundary par onglet.
- Accessibilité : `scope` sur les `th`, labels sur les `select`, focus visible — passe rapide.
- Effort S–M.

### P1-10. Rate limiting + durcissement edge
- Aucun rate limit (API, webhooks). En Workers : limiter via KV ou compteur D1 (`usage_counters` existe déjà — étendre : `api_hit` par IP / minute, 429 au-delà). Minimum : sur `/webhooks/*` et `/system/*`.
- Headers de sécurité sur le dashboard (Pages `_headers` : `frame-ancestors`, `nosniff`…) et sur le Worker (Hono `secureHeaders`).
- Effort S.

### P1-11. CI + qualité automatisée (pompe à essence du refactor)
- Ajouter `.github/workflows/ci.yml` : `npm ci` racine + frontend, `tsc --noEmit` × 2, `vitest run`, `vite build`, `wrangler deploy --dry-run` (sans secret — validation de config uniquement). Déclenchement : PR + push main.
- Ajouter ESLint (flat config, `@typescript-eslint`, règles `no-explicit-any` en warn) + Prettier + `lint-staged` pre-commit. Sans CI, chaque refactor régresse.
- Effort S.

### P1-12. LICENSE + nettoyage doc
- `README.md` référence `LICENSE` qui n'existe pas : ajouter MIT (ou retirer la mention).
- `docs/` : ajouter `docs/ADR/` (Architecture Decision Records) pour figer : Hono, D1 sans ORM, onglets vs routeur, parité EUR/USDC, FNV→SHA.
- Effort XS.

---

## 4. P2 — Évolutions structurantes (v2.2+)

| # | Chantier | Fichiers | Notes | Effort |
|---|---|---|---|---|
| P2-1 | Contrat d'API généré (OpenAPI) | `src/routes/*`, `frontend/src/lib/*` | `frontend/src/lib/types.ts` est un **miroir manuel** des types backend → dérive garantie. Cible : `@hono/zod-openapi` côté Worker + `openapi-typescript` côté front (types générés au build). En attendant : test de contrat qui compare les clés JSON. | M |
| P2-2 | Package de types partagés | nouveau `packages/shared/` | Alternative/complément à P2-1 : `Mission`, `Deal`, `Kpi`, statuts en `enum` partagés (npm workspace). Élimine les stringly-typed status des deux côtés. | S |
| P2-3 | Data-fetching front (SWR/React Query) | `frontend/src/lib/api.ts` | `demoMode` mutable + listeners maison fonctionnent mais pas de cache/dedup/retry. Migrer vers SWR (léger) en gardant la bascule démo comme `fetcher` avec fallback. | M |
| P2-4 | Observabilité | `src/index.ts`, `src/core/*` | `console.error` seul. Cible : request-id (middleware), logs structurés JSON, `wrangler tail` documenté, Analytics Engine (couche 3 de la spec §9 — non implémentée), alertes quota Cloudflare natives (dashboard, hors code). | M |
| P2-5 | Batch D1 | `src/f1/scanner.ts`, `src/f2/*`, `src/core/ledger.ts` | `db.batch()` pour les flux multi-écritures (scan, quote+log, clôture F2) : moins d'allers-retours, atomicité. Attention : D1 batch = pas de vraies transactions multi-tables rollback — documenter les limites. | S |
| P2-6 | Outbox Telegram | `src/telegram/*` | `sendMessage` fire-and-forget (échec silencieux). Cible : table `outbox` + cron de re-jeu + alerte si backlog. Minimum : logger + compteur `telegram_failed`. | S |
| P2-7 | Versionnage API | `src/index.ts` | Préfixer `/v1/*` avant que des clients durcissent (sinon breaking changes impossibles). Redirection ou double-montage pendant transition. | XS |
| P2-8 | Signataire wallet dédié | `src/payments/*` | Aujourd'hui : traçage seul, aucune signature. Cible : module `signer` isolé (clé SPEND via secret, jamais loggée), interface `signAndBroadcast`, tests avec clé jetable, séparation stricte avec la policy (policy AVANT signature, jamais après). Évaluer Turnkey/KMS vs clé Workers. | L |
| P2-9 | Connecteurs : budget d'erreurs + métriques | `src/connectors/*` | Compteurs succès/partial/erreur par plateforme (table `connector_health`), dashboard admin, désactivation auto temporaire (lié P1-4). | S |
| P2-10 | LLM producteur réel + garde-fous coût | `src/f1/executor.ts` | Implémenter `DeliverableProducer` (Workers AI ou API) avec : timeout, retry borné, `api_cost` systématique, plafond par mission, sortie validée (Zod) avant stockage. | M–L |
| P2-11 | Tests front + E2E | `frontend/` | Vitest + Testing Library (client API, bascule démo, pages) ; E2E léger (Playwright, 3 parcours : KPI affiché, import mission, freeze). | M |
| P2-12 | Durcissement D1 prod | `wrangler.toml`, `migrations/` | Time Travel / PITR à évaluer, exports planifiés du ledger (cron → R2 → Waltio), runbook restore testé. | S |

---

## 5. Revue fichier par fichier (notes ciblées)

| Fichier | État | Notes refactor |
|---|---|---|
| `src/index.ts` | 🟡 | Ajouter auth (P0-1), request-id, `secureHeaders`, `/v1` (P2-7). Le handler `scheduled` doit passer `event.cron` (P0-6). |
| `src/types.ts` | 🟡 | Doublon `resolveConfig`/`configFromEnv` (P1-1). `Env` : typer les secrets optionnels vs requis ; `D1Database` global OK via workers-types. |
| `src/core/policy.ts` | 🟢 | Sain. Rendre le `case "trade"` explicite (aujourd'hui implicite via garde précoce) pour lisibilité d'audit. Extraire les seuils en consts nommées. |
| `src/core/ledger.ts` | 🟡 | Supprimer `assertNoTradingModule` (P1-8). `computeDailyKpi` : 6 requêtes → 1–2 avec `UNION`/agrégats, ou vue matérialisée plus tard. Parité EUR en const config. |
| `src/core/scoring.ts` | 🟢 | Propre. `fold()` NFD OK. Envisager poids configurables (table `scoring_weights`) si le ranking devient métier. |
| `src/core/quotas.ts` | 🟡 | `DEGRADED_THRESHOLD` et limites en dur → vars d'env. `maybeEnterDegradedMode` scanne 5 compteurs à chaque scan — mémoïser par invocation. Pas de sortie auto du mode dégradé (reset quotidien ? documenter). |
| `src/db/queries.ts` | 🟡 | Allowlist SQL (P1-5), SHA-256 (P1-7). `logDecision` : ajouter `request_id` quand dispo (P2-4). |
| `src/f1/scanner.ts` | 🟡 | Paralléliser (P1-4), extraire `proposeTopN` (P1-2), `storeRawMission` : gérer le conflit UNIQUE en race (INSERT…ON CONFLICT DO NOTHING + re-SELECT) au lieu de SELECT-then-INSERT. |
| `src/f1/executor.ts` | 🟢 | Stub assumé et documenté. Ajouter timeout global d'exécution + statut `failed` après N essais (aujourd'hui retour `approved` infini → boucle possible). |
| `src/f1/submitter.ts` | 🟢 | Logique auto/humain saine. Cas limite : mission `executing` sans `draft_text` (producteur custom) → valider avant de proposer le chemin humain. |
| `src/f2/arbitrage.ts` | 🟡 | Lier au HITL consumé (P0-2). `round2` dupliqué avec ledger → helper partagé `src/core/money.ts` (prépare P0-5). |
| `src/connectors/*` | 🟡 | Timeouts/retries/circuit-breaker (P1-4). `politeHeaders` bien. Upwork/Malt stubs documentés — OK en attente J5–J10. Tester chaque parseur avec fixtures JSON. |
| `src/payments/rails.ts` | 🔴 | Token HITL requis (P0-2). Ne jamais y mettre de signature (P2-8 : module séparé). |
| `src/payments/x402.ts` | 🔴 | Stub fail-open (P0-3). Le passage mission → `paid` devrait vérifier le montant (paiement partiel ? trop-perçu ?). |
| `src/telegram/bot.ts` | 🟡 | Extraire `client.ts` (P1-3). `sendMessage` : retry 1× + compteur d'échecs (P2-6). `slice(0,4000)` OK (limite 4096). |
| `src/telegram/commands.ts` | 🟡 | Import dynamique à supprimer (P1-3). Parser de commandes : table de dispatch + validation Zod des args au lieu de `split` manuel. |
| `src/telegram/hitl.ts` | 🟡 | Ajouter `consumed_at` + `consumeHitlApproval` (P0-2). TTL en const config. `applyApproval` : cas `spend`/`wallet_add`/`generic` sans effet — à câbler ou supprimer (çaiblage via P0-2). |
| `src/telegram/kpi.ts` | 🟢 | Pur et testable. Ajouter tests unitaires `formatKpiMessage` (rapide, rentable). |
| `src/routes/*` | 🟡 | Auth partout (P0-1), codes d'erreur enum partagés, tests HTTP (P0-4). `missions.ts` : corriger l'INSERT (P1-5). `ledger.ts` : restreindre les `kind` acceptés en écriture (surtout `sale` — forgeries, lié P0-1/P0-3). |
| `src/routes/webhooks.ts` | 🟡 | Telegram : vérifier aussi `chat.id` (fait dans `handleTelegramUpdate` ✓). x402 : 503 si `X402_LIVE=false` (P0-3). Idempotence déjà OK. |
| `src/cron/scheduler.ts` | 🟡 | Dispatch sur `event.cron` (P0-6), factoriser `proposeTopN` (P1-2). |
| `migrations/*.sql` | 🟢 | Valides (SQLite réel). Prévoir 0003 (HITL consumed), 0004–0005 (centimes + CHECK). Politique forward-only déjà documentée ✓. |
| `tests/support/fake-d1.ts` | 🟡 | Dette assumée : pattern-matcher SQL. Stratégie : geler son périmètre (unit core), tout le nouveau coverage en tests HTTP avec le même fake, puis migration `node:sqlite`/miniflare en P2 (pas avant — ROI faible aujourd'hui). |
| `tests/*` | 🟢 | Bonne granularité. Manques : `kpi.test.ts` (format), `hitl.test.ts` (timeout=deny — implémenter les motifs `hitl_requests` manquants si besoin), `quotas.test.ts` (dégradé). |
| `frontend/src/lib/api.ts` | 🟡 | Corriger BASE/proxy dev (P1-9). Typer les retours `write` (aujourd'hui `Promise<T>` générique + casts dans les pages → fuites `as`). Migrer SWR en P2-3. |
| `frontend/src/pages/*` | 🟢 | États loading/erreur/vide systématiques ✓. Extraire les formulaires (Import, Quote) en composants + modales (P1-9). |
| `frontend/src/components/*` | 🟢 | Propre. Ajouter Error Boundary (P1-9). |
| `wrangler.toml` | 🟡 | `database_id` placeholder (bloquant deploy, documenté). Ajouter `d1` dev persistant, revoir `compatibility_flags`, placeholders documentés pour chaque secret. |
| `frontend/vite.config.ts` | 🟡 | `allowedHosts` : nettoyer l'hôte sandbox périmé (P1-9). Proxy `/api` : le rendre effectif ou le supprimer (P1-9). |
| `scripts/*` | 🟢 | OK. Ajouter `scripts/export-ledger.ts` (CSV/JSON pour Waltio — cf. P2-12). |
| `docs/*`, `README.md` | 🟢 | Complets. Ajouter ADRs + LICENSE (P1-12). |

Légende : 🟢 sain · 🟡 refactor ciblé · 🔴 bloquant.

---

## 6. Dette tests — carte de couverture et plan

| Couche | Couverture actuelle | Cible v2.1 | Priorité |
|---|---|---|---|
| `core/` (policy, ledger, scoring, quotas) | ✅ 48 tests | + `quotas`/`kpi.format` unitaires | P1 |
| `f1/` + `f2/` (fonctions) | ✅ | + races (double approve, double submit) | P1 |
| Routes HTTP (`hono/testing`) | ❌ 0 | missions, deals, ledger, webhooks, system/scan | **P0-4** |
| Telegram (commandes, callbacks) | ❌ 0 | `/freeze`→bloqué, approve/deny, timeout=deny | P0-4 |
| Crons | ❌ 0 | dispatch `event.cron`, scan dégradé, KPI | P0-4 |
| Connecteurs (fetch mocké) | ❌ 0 | 1 fixture OK + 1 KO par connecteur | P1 |
| Frontend (Vitest + TL) | ❌ 0 | client API + bascule démo + 2 pages | P2-11 |
| E2E (Playwright) | ❌ 0 | 3 parcours critiques | P2-11 |

Règle proposée : **tout P0/P1 shippe avec son test** ; interdiction d'étendre `FakeD1` pour du nouveau SQL dynamique — préférer les tests HTTP qui exercent le SQL réel via le fake (même fake, plus de valeur).

---

## 7. Architecture cible (après refactor)

```
                         ┌──────────────────┐
                         │  Cloudflare Edge │
                         └────────┬─────────┘
                                  │  requireAdmin (P0-1) · request-id · secureHeaders
                    ┌─────────────▼──────────────┐
                    │      Hono /v1/* (P2-7)     │
                    └──────┬──────────────┬──────┘
                           │              │
              ┌────────────▼─────┐  ┌─────▼────────────┐
              │  Service layer   │  │  Telegram Ctrl   │
              │  (f1/f2/payments │  │  (commands+HITL) │
              │   purs, testés)  │  │  + outbox (P2-6) │
              └────────────┬─────┘  └─────┬────────────┘
                           │              │
                    ┌──────▼──────────────▼──────┐
                    │  policy.ts (4 règles)      │◀── HITL single-use (P0-2)
                    │  + quotas + audit SHA-256  │
                    └──────┬─────────────────────┘
                           │
              ┌────────────▼────────────┐
              │  D1 (migrations 0003+)  │
              │  centimes (P0-5) ·      │
              │  CHECK enums (P1-6)     │
              └─────────────────────────┘

  Transverse : env Zod (P1-1) · OpenAPI codegen (P2-1) · CI (P1-11) ·
               Analytics Engine + alertes (P2-4) · signer isolé (P2-8)
```

**Phasage recommandé :**
- **Phase A (1 sem) :** P0-1, P0-2, P0-3 (désactivation/flag), P0-6, P1-1, P1-2, P1-3, P1-11 (CI). → Branche `refactor/p0-edge`.
- **Phase B (1–2 sem) :** P0-4 (tests HTTP), P0-5 (centimes), P1-4, P1-5, P1-6, P1-7. → `refactor/p0-core`.
- **Phase C (au fil de l'eau) :** P1-9 (front), P1-10, P2-* par opportunité. Pas de big-bang.

---

## 8. Definition of Done du refactor

- [ ] P0-1→P0-6 soldés, chacun avec tests (HTTP de préférence).
- [ ] `npm test`, `tsc --noEmit` (×2), `vite build`, CI verte sur la PR.
- [ ] Migrations `0003+` appliquées en local + `dev`, `schema_version` bumpé.
- [ ] Aucune régression spec : `tests/tos.test.ts`, `tests/no-trading.test.ts` verts et non affaiblis.
- [ ] `POST /ledger` restreint (plus de `sale` forgeable) ; x402 réel ou 503 flaggé.
- [ ] Docs MAJ : `API.md` (auth, codes), `DEPLOYMENT.md` (secrets, CI), ADR pour chaque décision structurante.
- [ ] Dashboard : proxy dev corrigé, `window.prompt` supprimés, Error Boundaries.

## 9. Checklists & annexes

### 9.1. Choses à NE PAS refactorer (verrous intentionnels)
- La sémantique des 4 règles policy et le fail-closed ToS (toute relaxation = décision produit + migration + test + doc).
- Le partitionnement `core/` vs routes vs Telegram (le refactor déplace du code, pas les frontières).
- `FakeD1` : geler, pas étendre à l'infini (cf. §5).
- Le français de l'UI/docs (décision équipe — changer = ADR).

### 9.2. Commandes mémo
```bash
npm install && npx vitest run && npx tsc --noEmit   # backend : tests + types
npm run db:migrate:local && npm run seed:local      # D1 locale + ToS
npm run dev                                          # Worker :8787
cd frontend && npm install && npm run dev            # dashboard :5173
node --experimental-sqlite -e "..."                  # valider une migration (cf. README dev)
npx wrangler deploy --dry-run                        # valider la config sans deploy
```

### 9.3. Références
- Spec : `loop-spec-v2-logique-metier.md` (source v2.0) · Passation : `PASSATION.txt`
- PR : https://github.com/patatedouce333/agenautooooooooooooooo/pull/1
- Docs : `docs/ARCHITECTURE.md` (vue d'ensemble) · `docs/API.md` (contrat) · `docs/DEPLOYMENT.md` (runbook) · `docs/TOS_MATRIX.md` (procédure de modif ToS)

*Fin du brief. En cas de conflit entre ce document et la spec v2.0, la spec gagne — ouvrir une issue pour trancher.*
