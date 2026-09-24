# Matrice ToS par plateforme — loop v2

> Référence spec : §3 (contrainte dure). Seed : `migrations/0002_seed_platform_rules.sql`.

## 1. Règle d'or

L'agent peut **scanner, analyser et préparer partout**.
Il ne peut **soumettre/payer/contracter automatiquement** que là où c'est permis.
Le `policy engine` bloque **côté serveur** toute action `submit` si
`can_auto_submit = false`. Plateforme non listée = **refus + approbation humaine**.

## 2. Matrice (v2.0 — 2026-09-24)

| Plateforme | Scan | Préparer | Auto-submit | Soumission |
|---|---|---|---|---|
| `x402-bazaar` (agent-natif) | ✅ | ✅ | ✅ | Aucune — USDC auto |
| `rentahuman-requester` (nous = client) | ✅ | ✅ | ✅ | Aucune — nous payons |
| `rentahuman-provider` (micro-tâches B1) | ✅ | ✅ | ✅ | Aucune — client paie |
| `gitcoin` | ✅ | ✅ | ⚠️ cas par cas → **non** | Humain (relire CGU) |
| `dework` | ✅ | ✅ | ⚠️ cas par cas → **non** | Humain (relire CGU) |
| `superteam` | ✅ | ✅ | ⚠️ cas par cas → **non** | Humain (relire CGU) |
| `algora` | ✅ | ✅ | ❌ interdit (robotic access) | Humain clique submit PR/claim |
| `upwork` | ✅ lecture seule | ✅ | ❌ interdit (bots) | Humain clique send proposal |
| `malt` | ✅ lecture seule | ✅ | ❌ probablement non | Humain valide et envoie |
| `comeup` | ✅ lecture seule | ✅ | ❌ probablement non | Humain valide et envoie |
| `youpijob` | ✅ | ✅ | ❌ | Humain |
| `leboncoin-services` | ✅ | ✅ | ❌ | Humain (jamais de scraping-revente) |

## 3. Comment c'est appliqué (code)

1. `platform_rules` (D1) — source de vérité, seedée par migration.
2. `evaluatePolicy({ action: "submit", platform })` (`src/core/policy.ts`) —
   `can_auto_submit = 1` → auto ; `0` → bloqué (+ draft humain) ; inconnue → refus + HITL.
3. `submitMission()` (`src/f1/submitter.ts`) — appelle la policy à chaque soumission :
   `submitted via auto | human`, tracé dans `decisions`.
4. Tests `tests/tos.test.ts` — verrouillent chaque ligne (ex. Upwork refusé net)
   **et** la synchro avec le seed SQL (anti-dérive).

## 4. Modifier une règle (procédure)

Il n'y a **pas** de route d'écriture : changer une règle ToS = décision humaine tracée.

1. Relire les CGU à jour de la plateforme (dater la vérification).
2. Créer `migrations/0003_<objet>.sql` :
   ```sql
   UPDATE platform_rules
   SET can_auto_submit = 0, requires_hitl_for_submit = 1,
       notes_tos = '…motif…', last_verified_at = '2026-..-..T..:..:..Z'
   WHERE platform = '…';
   ```
3. Mettre à jour `tests/support/seed.ts` + ce document.
4. `npm test` → déployer (`dev` puis prod).

## 5. Re-vérification périodique

- `last_verified_at` par plateforme ; objectif : relecture trimestrielle
  (ou dès qu'un connecteur signale un changement de CGU).
- Les connecteurs `*-readonly` documentent leurs limites dans leur fichier
  (`src/connectors/*.ts`) — jamais de contournement anti-bot (§13).
