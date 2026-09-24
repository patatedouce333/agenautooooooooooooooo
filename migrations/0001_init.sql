-- ═══════════════════════════════════════════════════════════════
-- loop v2 — migration initiale (spec §8 : modèle de données D1)
-- Ordre de build : core/policy.ts → ledger + migrations → Telegram → F1 → F2
-- ═══════════════════════════════════════════════════════════════

-- ── Missions trouvées et leur cycle de vie ─────────────────────
-- status: detected → scored → proposed → approved → executing
--         → submitted → paid | failed
-- kind:   f1_executable (agent seul) | f2_needs_human (arbitrage)
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  found_at TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  external_id TEXT,
  title TEXT,
  url TEXT,
  amount REAL,
  currency TEXT,                      -- USDC | EUR
  kind TEXT NOT NULL,                 -- f1_executable | f2_needs_human
  status TEXT NOT NULL DEFAULT 'detected',
  score REAL,
  effort_estimate_h REAL,             -- effort estimé (heures agent)
  acceptance_proba REAL,              -- probabilité d'acceptation 0..1
  hitl_approved_at TEXT,
  hitl_approved_by TEXT,
  submitted_via TEXT,                 -- auto | human
  submitted_at TEXT,
  deliverable_ref TEXT,               -- lien/note vers le livrable produit
  draft_text TEXT,                    -- texte exact préparé pour submit humain
  deadline TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_platform ON missions(source_platform);
CREATE INDEX IF NOT EXISTS idx_missions_score ON missions(score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_missions_platform_external
  ON missions(source_platform, external_id);

-- ── F2 : freelance et arbitrage ────────────────────────────────
CREATE TABLE IF NOT EXISTS arbitrage_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER REFERENCES missions(id),
  client_price REAL NOT NULL,
  freelancer_cost REAL,
  platform_fees REAL,
  litigation_reserve REAL,
  control_time_cost REAL DEFAULT 0,   -- coût de ton temps de contrôle
  margin_net REAL GENERATED ALWAYS AS
    (client_price
      - COALESCE(freelancer_cost, 0)
      - COALESCE(platform_fees, 0)
      - COALESCE(litigation_reserve, 0)
      - COALESCE(control_time_cost, 0)
    ) VIRTUAL,
  currency TEXT DEFAULT 'EUR',
  freelancer_contact TEXT,
  freelancer_platform TEXT,
  status TEXT NOT NULL,               -- scouting | proposed | hired | delivered | paid | cancelled
  hitl_approved_at TEXT,
  hitl_approved_by TEXT,
  human_payout_at TEXT,
  client_paid_at TEXT,
  created_at TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_arbitrage_mission ON arbitrage_deals(mission_id);
CREATE INDEX IF NOT EXISTS idx_arbitrage_status ON arbitrage_deals(status);

-- ── Événements financiers (ledger — append-only) ───────────────
-- kind: sale | self_test | transfer | fee | human_payout | api_cost
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_usdc REAL,
  currency TEXT,
  source_platform TEXT,
  mission_id INTEGER REFERENCES missions(id),
  tx_hash TEXT UNIQUE,
  payment_nonce TEXT UNIQUE,
  payer TEXT,
  cost_kind TEXT                      -- pour kind='fee'/'api_cost' : facilitator | platform | llm | infra
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_mission ON events(mission_id);

-- ── Wallets propres (anti self-dealing) ────────────────────────
CREATE TABLE IF NOT EXISTS own_wallets (
  address TEXT PRIMARY KEY,
  role TEXT NOT NULL,                 -- PAYTO | OPS | SPEND | OTHER
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL,             -- qui a approuvé (HITL obligatoire)
  note TEXT
);

-- ── Règles par plateforme (matrice ToS — spec §3) ──────────────
CREATE TABLE IF NOT EXISTS platform_rules (
  platform TEXT PRIMARY KEY,
  can_scan BOOLEAN NOT NULL DEFAULT 1,
  can_prepare BOOLEAN NOT NULL DEFAULT 1,
  can_auto_submit BOOLEAN NOT NULL DEFAULT 0,
  requires_hitl_for_submit BOOLEAN NOT NULL DEFAULT 1,
  notes_tos TEXT,
  last_verified_at TEXT
);

-- ── Flags système (freeze etc.) ────────────────────────────────
CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Journal d'audit (chaîné par hash) ──────────────────────────
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  actor TEXT,                         -- agent | telegram:<chat_id> | system
  metadata TEXT,                      -- JSON libre
  prev_hash TEXT,
  hash TEXT NOT NULL
);

-- ── Compteurs quotas Cloudflare ────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_counters (
  date TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- scan | llm_call | telegram_msg | d1_write | subrequest
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, kind)
);

-- ── File HITL (validations humaines en attente) ────────────────
-- Timeout = deny (spec §4) : un worker cron marque `expired` les
-- demandes dépassées, et l'agent ne prend rien par défaut.
CREATE TABLE IF NOT EXISTS hitl_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- mission_batch | f2_deal | spend | wallet_add | unfreeze | generic
  ref_type TEXT,                      -- missions | arbitrage_deals | NULL
  ref_id INTEGER,
  payload TEXT NOT NULL,              -- JSON : résumé pour Telegram
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied | expired
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_hitl_status ON hitl_requests(status);
