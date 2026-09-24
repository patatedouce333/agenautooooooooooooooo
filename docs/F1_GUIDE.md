# Guide F1 — Chasseur-exécuteur

> Référence spec : §4. Code : `src/f1/` + `src/connectors/` + `src/cron/`.

## 1. Cycle complet

```
CRON toutes les 6h (ou POST /system/scan)
  │ 1. SCAN — connecteurs autorisés par la policy `scan`
  │    API/GitHub (Gitcoin, Dework, Algora, Superteam) · RSS/JSON-LD ·
  │    x402/Bazaar (agent-à-agent) · pages publiques (sans contournement)
  ▼
  │ 2. FILTRE & SCORING
  │    F1 (agent seul) vs F2 (humain requis — mots-clés FR/EN)
  │    score = (montant × proba) / effort
  ▼
  │ 3. SÉLECTION — top-N (défaut 5) → statut `proposed`
  │    → Telegram : « Voici 5 missions, confirme celle(s) à traiter »
  │    Timeout = l'agent ne prend RIEN (timeout = deny)
  ▼
  │ 4. EXÉCUTION (après approve) — livrable + QA interne (2e passage)
  ▼
  │ 5. SOUMISSION — can_auto_submit ? auto : draft copier-coller + clic humain
  │    → decisions(action='submitted', via='auto'|'human')
  ▼
  │ 6. ENCAISSEMENT — events(kind='sale') → KPI du jour
```

## 2. Connecteurs

| Fichier | Plateforme | Source | Régime ToS |
|---|---|---|---|
| `algora.ts` | `algora` | API (+ repli GitHub search) | scan ✅, submit **humain** |
| `gitcoin.ts` | `gitcoin` | API publique | scan ✅, submit **humain** |
| `dework.ts` | `dework` | API publique | scan ✅, submit **humain** |
| `superteam.ts` | `superteam` | listings Earn | scan ✅, submit **humain** |
| `x402-bazaar.ts` | `x402-bazaar` | endpoint Bazaar (`X402_BAZAAR_URL`) | **auto-submit USDC** |
| `rentahuman.ts` | `rentahuman-provider` | API jobs | auto-traitable |
| `upwork-readonly.ts` | `upwork` | OAuth à venir / import manuel | **lecture seule** |
| `malt-readonly.ts` | `malt`, `comeup` | comptes J5–J10 / import manuel | **lecture seule** |

Ajouter une source : implémenter `Connector` (`src/connectors/types.ts`),
l'enregistrer dans `registry.ts`, **puis** ajouter sa ligne ToS par migration
(sans ligne = refus par défaut — fail-closed).

## 3. Scoring

`src/core/scoring.ts` :

- `score = (montant × proba) / effort`, effort plancher 0,25 h (jamais d'infini),
  proba bornée [0,1], EUR≈USDC à parité 1:1 (paramétrable).
- `requiresHuman(title, notes)` — mots-clés FR/EN insensibles aux accents
  (terrain, présentiel, on-site, géolocalisée, notaire…) → route F2.
- `rankByScore()` — tri décroissant stable.

## 4. Exécution (LLM)

`executeMission(db, id, produce?)` — `DeliverableProducer` est **injectable** :

```ts
import { executeMission } from "./src/f1/executor";
await executeMission(db, missionId, async (mission) => ({
  ref: "pr:org/repo#123",          // livrable réel
  qaNotes: "2e passage : …",        // contrôle qualité interne
  draftText: "Bonjour, je propose…",// texte copier-coller si submit humain
}));
```

Par défaut : stub explicite (branchez Workers AI ou votre API LLM —
comptez le coût via `events(kind='api_cost')`).

## 5. Soumission : auto vs humain

`submitMission(db, config, id, humanConfirm=false)` :

- Policy `submit` évaluée **côté serveur** (matrice ToS).
- `can_auto_submit=1` (x402…) → `submitted via auto`.
- Sinon → `{ via: "human", message }` + draft Telegram ; quand vous avez cliqué :
  `POST /missions/:id/confirm-human-submit` → `submitted via human`.

## 6. Tester le cycle (plan §10)

```bash
npm test -- tests/f1.test.ts     # exécution + auto/human submit + freeze
# F1 Algora : mission → exécutée → PR préparée → attente submit humain ✔
# F1 x402   : agent soumet seul → sale → KPI augmente ✔ (tests/ledger.test.ts)
```
