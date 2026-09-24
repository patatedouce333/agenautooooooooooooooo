-- ═══════════════════════════════════════════════════════════════
-- loop v2 — seed : matrice ToS par plateforme (spec §3) + flags système
-- Toute plateforme NON listée ici = refus + attente d'approbation humaine.
-- ═══════════════════════════════════════════════════════════════

-- ── Matrice ToS (contrainte dure — spec §3) ────────────────────
INSERT OR REPLACE INTO platform_rules
  (platform, can_scan, can_prepare, can_auto_submit, requires_hitl_for_submit, notes_tos, last_verified_at)
VALUES
  ('x402-bazaar', 1, 1, 1, 0,
   'Agent-natif : paiement USDC automatique, auto-submit autorisé.', '2026-09-24T00:00:00Z'),
  ('rentahuman-requester', 1, 1, 1, 0,
   'En tant que demandeur (client qui paie) : auto-submit autorisé.', '2026-09-24T00:00:00Z'),
  ('rentahuman-provider', 1, 1, 1, 0,
   'Micro-tâches B1 comme fournisseur : le client nous paie, pas de submit externe.', '2026-09-24T00:00:00Z'),
  ('gitcoin', 1, 1, 0, 1,
   'Bounty crypto : relire CGU spécifiques avant tout auto-submit. Humain par défaut.', '2026-09-24T00:00:00Z'),
  ('dework', 1, 1, 0, 1,
   'Bounty crypto : relire CGU spécifiques avant tout auto-submit. Humain par défaut.', '2026-09-24T00:00:00Z'),
  ('superteam', 1, 1, 0, 1,
   'Superteam Earn : relire CGU spécifiques avant tout auto-submit. Humain par défaut.', '2026-09-24T00:00:00Z'),
  ('algora', 1, 1, 0, 1,
   'INTERDIT : robotic access interdit. Humain clique submit PR/claim.', '2026-09-24T00:00:00Z'),
  ('upwork', 1, 1, 0, 1,
   'INTERDIT : bots interdits sur candidatures. Lecture seule + humain envoie.', '2026-09-24T00:00:00Z'),
  ('malt', 1, 1, 0, 1,
   'À vérifier — probablement non auto. Humain valide et envoie.', '2026-09-24T00:00:00Z'),
  ('comeup', 1, 1, 0, 1,
   'À vérifier — probablement non auto. Humain valide et envoie.', '2026-09-24T00:00:00Z'),
  ('youpijob', 1, 1, 0, 1,
   'Terrain/physique : humain uniquement.', '2026-09-24T00:00:00Z'),
  ('leboncoin-services', 1, 1, 0, 1,
   'Terrain/physique : humain uniquement. Pas de scraping pour revente de data.', '2026-09-24T00:00:00Z');

-- ── Flags système initiaux ────────────────────────────────────
INSERT OR IGNORE INTO system_flags (key, value, updated_at) VALUES
  ('freeze', 'false', '2026-09-24T00:00:00Z'),
  ('degraded_mode', 'false', '2026-09-24T00:00:00Z'),
  ('unfreeze_pending', 'false', '2026-09-24T00:00:00Z'),
  ('schema_version', '2.0.0', '2026-09-24T00:00:00Z');
