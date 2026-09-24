# Dashboard loop v2

Pilotage visuel de l'agent : KPI, missions F1, arbitrage F2, ledger,
matrice ToS, système (freeze, quotas, audit). **React 18 + Vite + Tailwind**.

## Démarrer

```bash
npm install
cp .env.example .env.local
# VITE_API_URL=http://localhost:8787   (Worker local)
# VITE_MOCK_FALLBACK=true              (démo si API absente)
npm run dev        # → http://localhost:5173
npm run build      # → dist/ (déployé sur Cloudflare Pages)
```

## Pages (onglets)

| Onglet | Contenu | Actions |
|---|---|---|
| Vue d'ensemble | net/revenu/coûts du jour, revenu par source, file HITL | Scanner, actualiser |
| Missions F1 | file détectée→payée, filtres, import manuel | Valider, exécuter, soumettre, « j'ai cliqué » |
| Arbitrage F2 | deals + marges détaillées | Chiffrer, approuver (HITL), recruter, solder |
| Ledger | événements append-only + totaux période | — (lecture) |
| Plateformes | matrice ToS (scan/préparer/auto-submit) | — (modif = migration SQL) |
| Système | freeze, config policy, quotas, HITL, audit | Geler, dégeler (double confirmation) |

## Architecture

```
src/
├── main.tsx · App.tsx      # état global (statut refresh 60 s) + onglets
├── lib/
│   ├── api.ts              # client Worker + bascule démo (try API → mock)
│   ├── mock.ts             # données de démo réalistes
│   ├── types.ts            # miroirs des types backend
│   └── format.ts           # fmtMoney, fmtDate, shortAddr
├── components/
│   ├── Layout.tsx          # sidebar, bandeaux démo/freeze, navigation
│   └── ui.tsx              # Badge, Progress, BarChart SVG, Empty/Error/Skeleton
└── pages/                  # Dashboard · Missions · Deals · Ledger · Platforms · System
```

## Mode démo

Si `VITE_API_URL` est vide/injoignable et `VITE_MOCK_FALLBACK=true`,
le dashboard affiche des données fictives avec un bandeau **MODE DÉMO**
et refuse proprement les écritures (« connectez l'API… »).
En production : `VITE_MOCK_FALLBACK=false`.

## Conventions

- Tous les appels passent par `lib/api.ts` (jamais de `fetch` en page).
- Chaque page gère chargement (`Skeleton`), erreur (`ErrorBox` + réessai) et vide (`Empty`).
- UI en français, montants `*.toFixed(2)`, dates `fr-FR`.
- Thème sombre, accents verts (`loop`), monospace pour ids/adresses.
