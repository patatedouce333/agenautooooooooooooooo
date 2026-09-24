# Guide F2 — Arbitrage humain

> Référence spec : §5. Code : `src/f2/arbitrage.ts` + routes `/deals`.

## 1. Quand F2 ?

Une mission nécessite un humain : photo géolocalisée, présence physique,
validation manuelle/légale, installation… Détection automatique au scan
(`requiresHuman()`) ou routage manuel (import → `f2_needs_human`).

## 2. Cycle complet

```
Détection (scan F1 ou mission x402 reçue)
  │ La mission nécessite un humain
  ▼
  1. CHIFFRAGE — marge = client − freelance − frais − réserve litige (10 %)
                          − temps de contrôle
     Si marge < seuil (15 €) → REJET automatique + traçage
  ▼
  2. APPROBATION HITL — obligatoire, JAMAIS automatique
     Telegram : mission, client, prix, freelance visé, marge nette → approve/deny
  ▼
  3. RECRUTEMENT — contrat, brief, délai, critères de réception
     (Malt / ComeUp / Upwork / RentAHuman-requester)
  ▼
  4. LIVRAISON & CONTRÔLE — l'agent contrôle (cohérence, preuves, géoloc)
  ▼
  5. PAIEMENT — freelance payé (SEPA/crypto via plateforme)
     + client facturé/encaissé
     → events : human_payout (sortie) + sale (entrée) → marge nette au KPI
```

## 3. API (détail : `docs/API.md`)

```bash
POST /deals/quote                  # chiffrage (422 si < seuil)
POST /deals/7/request-approval     # HITL Telegram
POST /deals/7/hired                # { freelancerContact }
POST /deals/7/delivered            # { controlNotes }
POST /deals/7/paid                 # clôture financière
POST /deals/7/cancel               # { reason? }
```

Statuts : `scouting → proposed → hired → delivered → paid | cancelled`.
`margin_net` est une colonne GENERATED (toujours cohérente).

## 4. Garde-fous (spec §5 — non négociables)

- ❌ Aucune embauche sans **client financeur confirmé**.
- ❌ Pas d'**escrow maison** (les fonds tiers ne transitent pas par nous).
- ❌ Pas de crypto envoyée à un freelance **sauf si la plateforme le gère**.
- 🧾 Toujours une **facture** — SIRET requis pour le fiat récurrent
  (autoentrepreneur, guichet unique INPI, 0 €).

## 5. Exemple chiffré

Client 300 € − freelance 150 € − frais 15 € − réserve 30 € (10 %) − contrôle 20 €
= **marge nette 85 €** ≥ 15 € → deal proposé au HITL.

En dessous du seuil (ex. marge 5 €) : rejet tracé (`f2_quote_rejected`), pas de HITL.

## 6. Tester (plan §10)

```bash
npm test -- tests/f2.test.ts
# chiffrage/rejet ✔ · cycle scouting→paid ✔ · recrutement sans HITL impossible ✔
```
