# loop v2 — agent chasseur de missions + arbitrage humain

> **Mission : maximiser le revenu encaissé par jour.**
> L'agent scanne un périmètre autorisé, détecte ce qui est faisable seul (**F1**)
> ou nécessite un humain (**F2**), présente les meilleures opportunités sur Telegram,
> exécute ou coordonne, encaisse, et rapporte chaque soir combien il a gagné.

**Rupture avec v1.x** : fini la logique « vendeur x402 passif ». Pas de trading
(même pas paper), pas de catalogue passif, pas d'attente d'acheteurs.

---

## ⚡ Démarrage rapide

### 1. Backend (Cloudflare Workers + Hono + D1)

```bash
npm install

# Base locale + migrations + seed ToS
npx wrangler d1 create loop-db            # copier database_id dans wrangler.toml
npm run db:migrate:local
npm run seed:local

# Secrets locaux (.dev.vars — voir .env.example)
cp .env.example .dev.vars                 # puis remplir TELEGRAM_*, etc.

# Lancer le Worker en local
npm run dev                                # → http://localhost:8787
```

### 2. Frontend (dashboard)

```bash
cd frontend
npm install
cp .env.example .env.local                # VITE_API_URL=http://localhost:8787
npm run dev                                # → http://localhost:5173
```

Sans backend, le dashboard bascule en **mode démo** (données fictives + bandeau).

### 3. Tests

```bash
npm test          # 48 tests : policy, ToS, ledger, scoring, F1, F2, no-trading
npm run typecheck
```

---

## 🧭 Les deux fonctions (et rien d'autre)

| Fonction | Rôle | Paiement |
|---|---|---|
| **F1 — Chasseur-exécuteur** | Scanne les sources autorisées, exécute les tâches faisables par un agent (code, data, R&D, rédaction, audit), livre, encaisse | USDC via x402 / crypto bounties / fiat freelance |
| **F2 — Arbitrage humain** | Trouve une mission exigeant un humain, recrute un freelance, encaisse la différence | Marge = client − freelance − frais |

```
        ┌──────────── [Cron 6h] ──── [Telegram] ──── [Webhooks] ────────────┐
        ▼                                                                   │
  ┌─────────────┐      ┌──────────┐      ┌─────────────┐      ┌──────────┐   │
  │ F1 Scanner  │ ───▶ │ F1 Exéc. │ ───▶ │ F1 Submit   │      │ F2 Deal  │◀──┘
  │ (9 sources) │      │ (LLM+QA) │      │ (auto/hum.) │      │ (marge)  │
  └─────────────┘      └──────────┘      └──────┬──────┘      └────┬─────┘
                                               │                  │
                                               ▼                  ▼
                                        ┌─────────────────────────────┐
                                        │  POLICY ENGINE (filtre dur) │
                                        │  plafonds · ToS · freeze    │
                                        │  AUCUN TRADING              │
                                        └──────────────┬──────────────┘
                                                       ▼
                                        ┌─────────────────────────────┐
                                        │  RAILS : PAYTO ← OPS ← SPEND │
                                        └──────────────┬──────────────┘
                                                       ▼
                                              LEDGER + KPI du soir
```

---

## 📁 Structure

```
├── src/
│   ├── index.ts            # Worker Hono (routes + crons)
│   ├── core/               # policy.ts · ledger.ts · scoring.ts · quotas.ts
│   ├── db/queries.ts       # helpers D1 + journal d'audit chaîné
│   ├── f1/                 # scanner.ts · executor.ts · submitter.ts
│   ├── f2/arbitrage.ts     # chiffrage → HITL → recrutement → paie
│   ├── connectors/         # 9 sources (algora, gitcoin, x402, upwork-ro…)
│   ├── payments/           # rails.ts (PAYTO/OPS/SPEND) · x402.ts
│   ├── telegram/           # bot.ts · commands.ts · hitl.ts · kpi.ts
│   ├── routes/             # missions · deals · ledger · platforms · system · kpi · webhooks
│   └── cron/scheduler.ts   # scan 6h + KPI 20h UTC
├── migrations/             # 0001_init.sql (schéma) · 0002_seed (ToS + flags)
├── tests/                  # 48 tests + FakeD1 in-memory
├── frontend/               # dashboard React + Tailwind (voir frontend/README.md)
└── docs/                   # documentation complète (voir ci-dessous)
```

---

## 📚 Documentation

| Document | Contenu |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Vue d'ensemble, boucle quotidienne, composants, données |
| [docs/API.md](docs/API.md) | Référence complète des routes HTTP + exemples curl |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Déploiement Cloudflare (D1, secrets, crons, Telegram, Pages) |
| [docs/TOS_MATRIX.md](docs/TOS_MATRIX.md) | Matrice ToS par plateforme + procédure de modification |
| [docs/F1_GUIDE.md](docs/F1_GUIDE.md) | Cycle chasseur-exécuteur : scan → score → HITL → exécution → encaissement |
| [docs/F2_GUIDE.md](docs/F2_GUIDE.md) | Cycle arbitrage : chiffrage → approbation → recrutement → contrôle → paie |
| [docs/TELEGRAM.md](docs/TELEGRAM.md) | Commandes bot, boutons HITL, KPI du soir |
| [docs/LEDGER.md](docs/LEDGER.md) | Comptabilité, anti self-dealing, x402, export fiscal |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Contribuer : standards, tests, migrations |
| [frontend/README.md](frontend/README.md) | Dashboard : pages, mode démo, build |

---

## 🛡️ Garanties dures (non négociables)

1. **Plafond SPEND** — toute sortie au-dessus de X USDC/jour exige un humain (défaut : 1 USDC).
2. **Matrice ToS** — auto-submit bloqué côté serveur là où c'est interdit (Upwork, Algora…).
3. **Aucun trading** — aucune route, aucun module, aucun test ne l'autorise (`tests/no-trading.test.ts` verrouille le dépôt).
4. **Freeze** — `/freeze` bloque tout, effet immédiat, sans redéploiement. `/unfreeze` = double confirmation.
5. **Timeout = deny** — sans réponse humaine, l'agent ne prend rien.
6. **Anti self-dealing** — les wallets propres sont déclarés ; leurs mouvements ne sont jamais du revenu.

---

## 🤖 Commandes Telegram

`/status` · `/freeze` · `/unfreeze` · `/kpi` · `/missions` · `/deals` · `/platforms` · `/approve <id>` · `/deny <id>`

Détail : [docs/TELEGRAM.md](docs/TELEGRAM.md).

---

## 📄 Licence

MIT — voir [LICENSE](LICENSE) (à ajouter si distribution).
