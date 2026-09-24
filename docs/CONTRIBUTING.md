# Contribuer — loop v2

## 1. Standards

- **TypeScript strict** partout (`npm run typecheck` doit passer).
- Commentaires d'en-tête par fichier : rôle + référence spec (§).
- SQL **bindé uniquement** (via `src/db/queries.ts` si possible).
- Toute action sortante (spend/submit/hire) passe par `evaluatePolicy()`.
- **Interdits absolus** : module/route trading (§13), escrow maison,
  contournement anti-bot, secret commité.

## 2. Workflow

```bash
git checkout -b feat/ma-fonction
npm test && npm run typecheck     # avant chaque commit
```

- 1 PR = 1 sujet, description avec le § spec concerné.
- Tests : tout nouveau comportement métier = test dans `tests/`
  (le `FakeD1` de `tests/support/` simule la base — étendez ses motifs si besoin).

## 3. Migrations D1

- `migrations/NNNN_nom.sql`, numérotation croissante, **jamais** de modification
  d'une migration déjà déployée (créer une corrective).
- Tester en local puis `env=dev` avant la prod :
  ```bash
  npm run db:migrate:local
  npx wrangler d1 migrations apply loop-db-dev --env dev --remote
  ```
- Matrice ToS : suivre la procédure `docs/TOS_MATRIX.md` §4
  (migration + `tests/support/seed.ts` + doc).

## 4. Connecteurs

Nouvelle source : `src/connectors/<plateforme>.ts` implémentant `Connector`
(`scan()` ne lève pas → `partial: true` + `note`), enregistrement dans
`registry.ts`, ligne ToS (fail-closed sans ligne), doc `F1_GUIDE.md`.

## 5. Frontend

Voir `frontend/README.md`. Règles : appels via `src/lib/api.ts` (jamais de
fetch direct en page), états chargement/erreur/vide systématiques, français.

## 6. Revue (checklist)

- [ ] `npm test` + `typecheck` verts
- [ ] policy/tos/freeze respectés pour toute action sortante ?
- [ ] secret ajouté à `.env.example` (sans valeur) + `DEPLOYMENT.md` ?
- [ ] docs à jour (API, guides, matrice) ?
- [ ] pas de `trade` introduit (`tests/no-trading.test.ts` veille)
