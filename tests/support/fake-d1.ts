/**
 * Fake D1Database in-memory pour les tests unitaires.
 *
 * Implémente juste assez de SQL pour les chemins couverts par les tests :
 * flags, platform_rules, missions, arbitrage_deals, events, own_wallets,
 * decisions, usage_counters, hitl_requests.
 *
 * Les requêtes sont dispatchées par reconnaissance de motifs (pas un vrai
 * moteur SQL) — chaque motif correspond à une requête réelle du code dans
 * `src/`. Si un motif manque, le fake lève une erreur explicite.
 */

type Row = Record<string, unknown>;

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export class FakeD1 {
  flags = new Map<string, { value: string; updated_at: string }>();
  rules = new Map<string, Row>();
  missions = new Map<number, Row>();
  deals = new Map<number, Row>();
  events: Row[] = [];
  wallets = new Map<string, Row>();
  decisions: Row[] = [];
  counters = new Map<string, number>();
  hitl: Row[] = [];
  nextId = 1;

  prepare(sql: string): FakeStmt {
    return new FakeStmt(this, sql, []);
  }
}

class FakeStmt {
  constructor(
    private db: FakeD1,
    private sql: string,
    private params: unknown[],
  ) {}

  bind(...params: unknown[]): FakeStmt {
    return new FakeStmt(this.db, this.sql, params);
  }

  async first<T = Row>(): Promise<T | null> {
    return this.db.execFirst<T>(this.sql, this.params);
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return { results: this.db.execAll<T>(this.sql, this.params) };
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.execRun(this.sql, this.params);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/** Découpe une clause SET sur les virgules hors parenthèses (COALESCE…). */
function splitAssignments(setPart: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of setPart) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function dealWithMargin(deal: Row): Row {
  const margin =
    asNumber(deal["client_price"]) -
    asNumber(deal["freelancer_cost"] ?? 0) -
    asNumber(deal["platform_fees"] ?? 0) -
    asNumber(deal["litigation_reserve"] ?? 0) -
    asNumber(deal["control_time_cost"] ?? 0);
  return { ...deal, margin_net: Math.round(margin * 100) / 100 };
}

declare module "./fake-d1" {
  interface FakeD1 {
    execFirst<T>(sql: string, params: unknown[]): T | null;
    execAll<T>(sql: string, params: unknown[]): T[];
    execRun(sql: string, params: unknown[]): { meta: { last_row_id: number; changes: number } };
  }
}

FakeD1.prototype.execFirst = function <T>(sql: string, params: unknown[]): T | null {
  const db = this as FakeD1;
  const n = normalize(sql);

  // system_flags — SELECT value ... WHERE key = ? (ou littéral)
  if (n.startsWith("SELECT value FROM system_flags WHERE key =")) {
    const key = params.length > 0 ? String(params[0]) : (n.match(/key = '([^']+)'/)?.[1] ?? "");
    const row = db.flags.get(key);
    return (row ? { value: row.value } : null) as T | null;
  }
  // platform_rules
  if (n === "SELECT * FROM platform_rules WHERE platform = ?") {
    return ((db.rules.get(String(params[0])) as T | undefined) ?? null);
  }
  // decisions — dernier hash
  if (n === "SELECT hash FROM decisions ORDER BY id DESC LIMIT 1") {
    const last = db.decisions[db.decisions.length - 1];
    return ((last ? { hash: last["hash"] } : null) as T | null);
  }
  // own_wallets
  if (n === "SELECT address FROM own_wallets WHERE LOWER(address) = ?") {
    const want = String(params[0]).toLowerCase();
    for (const w of db.wallets.values()) {
      if (String(w["address"]).toLowerCase() === want) return { address: w["address"] } as T;
    }
    return null;
  }
  // events — idempotence
  if (n === "SELECT id FROM events WHERE payment_nonce = ?") {
    const found = db.events.find((e) => e["payment_nonce"] === params[0]);
    return ((found ? { id: found["id"] } : null) as T | null);
  }
  if (n === "SELECT id FROM events WHERE tx_hash = ?") {
    const found = db.events.find((e) => e["tx_hash"] === params[0]);
    return ((found ? { id: found["id"] } : null) as T | null);
  }
  // spend total
  if (n.startsWith("SELECT COALESCE(SUM(amount_usdc), 0) AS total FROM events WHERE kind IN ('fee', 'api_cost')")) {
    const since = String(params[0]);
    const total = db.events
      .filter((e) => (e["kind"] === "fee" || e["kind"] === "api_cost") && String(e["ts"]) >= since)
      .reduce((s, e) => s + asNumber(e["amount_usdc"]), 0);
    return { total } as T;
  }
  // revenue (anti self-dealing)
  if (n.includes("FROM events") && n.includes("kind = 'sale'") && n.includes("own_wallets")) {
    const [start, end] = [String(params[0]), String(params[1])];
    const own = new Set([...db.wallets.values()].map((w) => String(w["address"]).toLowerCase()));
    const sales = db.events.filter(
      (e) =>
        e["kind"] === "sale" &&
        String(e["ts"]) >= start &&
        String(e["ts"]) <= end &&
        (e["payer"] == null || !own.has(String(e["payer"]).toLowerCase())),
    );
    return { total: sales.reduce((s, e) => s + asNumber(e["amount_usdc"]), 0), n: sales.length } as T;
  }
  // costs
  if (n.includes("FROM events") && n.includes("kind IN ('fee', 'human_payout', 'api_cost')")) {
    const [start, end] = [String(params[0]), String(params[1])];
    const total = db.events
      .filter(
        (e) =>
          (e["kind"] === "fee" || e["kind"] === "human_payout" || e["kind"] === "api_cost") &&
          String(e["ts"]) >= start &&
          String(e["ts"]) <= end,
      )
      .reduce((s, e) => s + asNumber(e["amount_usdc"]), 0);
    return { total } as T;
  }
  // missions counts
  if (n === "SELECT COUNT(*) AS n FROM missions WHERE substr(found_at, 1, 10) = ?") {
    const day = String(params[0]);
    return { n: [...db.missions.values()].filter((m) => String(m["found_at"]).slice(0, 10) === day).length } as T;
  }
  if (n === "SELECT COUNT(*) AS n FROM missions WHERE status IN ('submitted', 'paid') AND substr(found_at, 1, 10) = ?") {
    const day = String(params[0]);
    return {
      n: [...db.missions.values()].filter(
        (m) => (m["status"] === "submitted" || m["status"] === "paid") && String(m["found_at"]).slice(0, 10) === day,
      ).length,
    } as T;
  }
  if (n === "SELECT COUNT(*) AS n FROM missions WHERE status = 'proposed'") {
    return { n: [...db.missions.values()].filter((m) => m["status"] === "proposed").length } as T;
  }
  if (n === "SELECT COUNT(*) AS n FROM arbitrage_deals WHERE status IN ('scouting', 'proposed', 'hired', 'delivered')") {
    return {
      n: [...db.deals.values()].filter((d) => ["scouting", "proposed", "hired", "delivered"].includes(String(d["status"]))).length,
    } as T;
  }
  // missions / deals par id
  if (n === "SELECT * FROM missions WHERE id = ?") {
    return ((db.missions.get(Number(params[0])) as T | undefined) ?? null);
  }
  if (n === "SELECT * FROM arbitrage_deals WHERE id = ?") {
    const deal = db.deals.get(Number(params[0]));
    return ((deal ? dealWithMargin(deal) : null) as T | null);
  }
  // dédup scan
  if (n === "SELECT id FROM missions WHERE source_platform = ? AND external_id = ?") {
    for (const m of db.missions.values()) {
      if (m["source_platform"] === params[0] && m["external_id"] === params[1]) return { id: m["id"] } as T;
    }
    return null;
  }
  // usage_counters
  if (n === "SELECT count FROM usage_counters WHERE date = ? AND kind = ?") {
    const v = db.counters.get(`${String(params[0])}|${String(params[1])}`);
    return ((v === undefined ? null : { count: v }) as T | null);
  }
  // hitl par id
  if (n === "SELECT * FROM hitl_requests WHERE id = ?") {
    const found = db.hitl.find((h) => h["id"] === Number(params[0]));
    return ((found ?? null) as T | null);
  }

  throw new Error(`FakeD1.first: motif SQL non supporté: ${n}`);
};

FakeD1.prototype.execAll = function <T>(sql: string, params: unknown[]): T[] {
  const db = this as FakeD1;
  const n = normalize(sql);

  if (n === "SELECT * FROM platform_rules ORDER BY platform ASC") {
    return [...db.rules.values()].sort((a, b) => String(a["platform"]).localeCompare(String(b["platform"]))) as T[];
  }
  if (n === "SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?") {
    const [limit, offset] = [Number(params[0]), Number(params[1])];
    return [...db.events].sort((a, b) => Number(b["id"]) - Number(a["id"])).slice(offset, offset + limit) as T[];
  }
  if (n === "SELECT address, role, added_at, added_by, note FROM own_wallets ORDER BY added_at ASC") {
    return [...db.wallets.values()].sort((a, b) => String(a["added_at"]).localeCompare(String(b["added_at"]))) as T[];
  }
  if (n === "SELECT * FROM decisions ORDER BY id DESC LIMIT ?") {
    return [...db.decisions].sort((a, b) => Number(b["id"]) - Number(a["id"])).slice(0, Number(params[0])) as T[];
  }
  if (n === "SELECT * FROM hitl_requests WHERE status = 'pending' ORDER BY expires_at ASC") {
    return db.hitl.filter((h) => h["status"] === "pending").sort((a, b) => String(a["expires_at"]).localeCompare(String(b["expires_at"]))) as T[];
  }

  throw new Error(`FakeD1.all: motif SQL non supporté: ${n}`);
};

FakeD1.prototype.execRun = function (sql: string, params: unknown[]): { meta: { last_row_id: number; changes: number } } {
  const db = this as FakeD1;
  const n = normalize(sql);
  const nextId = () => db.nextId++;

  // system_flags upsert (3 params) ou littéral dégradé (1 param)
  if (n.startsWith("INSERT INTO system_flags")) {
    if (params.length === 3) {
      db.flags.set(String(params[0]), { value: String(params[1]), updated_at: String(params[2]) });
    } else if (params.length === 1) {
      const m = n.match(/VALUES \('([^']+)', '([^']+)', \?\)/);
      if (!m) throw new Error(`FakeD1: INSERT system_flags littéral non parsé: ${n}`);
      db.flags.set(m[1], { value: m[2], updated_at: String(params[0]) });
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  // events insert
  if (n.startsWith("INSERT INTO events")) {
    const [ts, kind, amount_usdc, currency, source_platform, mission_id, tx_hash, payment_nonce, payer, cost_kind] = params;
    if (payment_nonce != null && db.events.some((e) => e["payment_nonce"] === payment_nonce)) {
      throw new Error("UNIQUE constraint failed: events.payment_nonce");
    }
    if (tx_hash != null && db.events.some((e) => e["tx_hash"] === tx_hash)) {
      throw new Error("UNIQUE constraint failed: events.tx_hash");
    }
    const id = nextId();
    db.events.push({ id, ts, kind, amount_usdc, currency, source_platform, mission_id, tx_hash, payment_nonce, payer, cost_kind });
    return { meta: { last_row_id: id, changes: 1 } };
  }

  // decisions insert
  if (n.startsWith("INSERT INTO decisions")) {
    const [ts, action, reason, actor, metadata, prev_hash, hash] = params;
    const id = nextId();
    db.decisions.push({ id, ts, action, reason, actor, metadata, prev_hash, hash });
    return { meta: { last_row_id: id, changes: 1 } };
  }

  // missions insert (scanner : 14 colonnes)
  if (n.startsWith("INSERT INTO missions")) {
    const cols = n.match(/INSERT INTO missions \(([^)]+)\)/)?.[1].split(",").map((s) => s.trim()) ?? [];
    const id = nextId();
    const row: Row = { id };
    cols.forEach((col, i) => {
      row[col] = params[i];
    });
    db.missions.set(id, row);
    return { meta: { last_row_id: id, changes: 1 } };
  }

  // missions update — générique : SET (col = ? | col = 'lit') … WHERE id = ? [AND status = '…']
  if (n.startsWith("UPDATE missions SET")) {
    const setPart = n.split(" SET ")[1].split(" WHERE ")[0];
    const statusGuard = n.match(/AND status = '([^']+)'/)?.[1];
    const id = Number(params[params.length - 1]);
    const row = db.missions.get(id);
    if (!row) return { meta: { last_row_id: 0, changes: 0 } };
    if (statusGuard && row["status"] !== statusGuard) return { meta: { last_row_id: 0, changes: 0 } };
    const assignments = setPart.split(",").map((s) => s.trim());
    let p = 0;
    for (const a of assignments) {
      const lit = a.match(/^(\w+) = '([^']*)'$/);
      if (lit) {
        row[lit[1]] = lit[2];
        continue;
      }
      const ph = a.match(/^(\w+) = \?$/);
      if (ph) {
        row[ph[1]] = params[p++];
        continue;
      }
      throw new Error(`FakeD1: assignation missions non supportée: ${a}`);
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  // arbitrage_deals insert (12 colonnes)
  if (n.startsWith("INSERT INTO arbitrage_deals")) {
    const cols = n.match(/INSERT INTO arbitrage_deals \(([^)]+)\)/)?.[1].split(",").map((s) => s.trim()) ?? [];
    // Le SQL réel mélange placeholders et littéral 'scouting' — on mappe dans l'ordre.
    const id = nextId();
    const row: Row = { id };
    let p = 0;
    for (const col of cols) {
      if (col === "status") {
        row[col] = "scouting";
      } else {
        row[col] = params[p++];
      }
    }
    db.deals.set(id, row);
    return { meta: { last_row_id: id, changes: 1 } };
  }

  // arbitrage_deals updates
  if (n.startsWith("UPDATE arbitrage_deals SET")) {
    const setPart = n.split(" SET ")[1].split(" WHERE ")[0];
    const statusGuard = n.match(/AND status = '([^']+)'/)?.[1];
    const idParamIndex = setPart.includes("|| ?") || setPart.includes("COALESCE")
      ? params.length - 1
      : params.length - 1;
    const id = Number(params[idParamIndex]);
    const row = db.deals.get(id);
    if (!row) return { meta: { last_row_id: 0, changes: 0 } };
    if (statusGuard && row["status"] !== statusGuard) return { meta: { last_row_id: 0, changes: 0 } };
    const assignments = splitAssignments(setPart);
    let p = 0;
    for (const a of assignments) {
      const lit = a.match(/^(\w+) = '([^']*)'$/);
      if (lit) {
        row[lit[1]] = lit[2];
        continue;
      }
      // notes = COALESCE(notes,'') || ?
      const append = a.match(/^(\w+) = COALESCE\(\w+,''\) \|\| \?$/);
      if (append) {
        row[append[1]] = `${row[append[1]] ?? ""}${String(params[p++])}`;
        continue;
      }
      // col = COALESCE(col, ?)
      const coalesce = a.match(/^(\w+) = COALESCE\(\w+, \?\)$/);
      if (coalesce) {
        if (row[coalesce[1]] == null) row[coalesce[1]] = params[p];
        p++;
        continue;
      }
      const ph = a.match(/^(\w+) = \?$/);
      if (ph) {
        row[ph[1]] = params[p++];
        continue;
      }
      throw new Error(`FakeD1: assignation deals non supportée: ${a}`);
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  // usage_counters upsert additif
  if (n.startsWith("INSERT INTO usage_counters")) {
    const [date, kind, count] = [String(params[0]), String(params[1]), Number(params[2])];
    const key = `${date}|${kind}`;
    db.counters.set(key, (db.counters.get(key) ?? 0) + count);
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  // own_wallets insert
  if (n.startsWith("INSERT OR REPLACE INTO own_wallets")) {
    const [address, role, added_at, added_by, note] = params;
    db.wallets.set(String(address), { address, role, added_at, added_by, note });
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  // hitl insert
  if (n.startsWith("INSERT INTO hitl_requests")) {
    const [created_at, expires_at, kind, ref_type, ref_id, payload] = params;
    const id = nextId();
    db.hitl.push({ id, created_at, expires_at, kind, ref_type, ref_id, payload, status: "pending", resolved_at: null, resolved_by: null });
    return { meta: { last_row_id: id, changes: 1 } };
  }

  // hitl expire
  if (n.startsWith("UPDATE hitl_requests SET status = 'expired'")) {
    const [now, cutoff] = [String(params[0]), String(params[1])];
    let changes = 0;
    for (const h of db.hitl) {
      if (h["status"] === "pending" && String(h["expires_at"]) < cutoff) {
        h["status"] = "expired";
        h["resolved_at"] = now;
        changes++;
      }
    }
    return { meta: { last_row_id: 0, changes } };
  }

  // hitl resolve (UPDATE ... SET status = ?, resolved_at = ?, resolved_by = ... WHERE id = ?)
  if (n.startsWith("UPDATE hitl_requests SET status = ?")) {
    const [status, resolved_at, resolved_by, id] = params;
    const h = db.hitl.find((x) => x["id"] === Number(id));
    if (!h) return { meta: { last_row_id: 0, changes: 0 } };
    h["status"] = status;
    h["resolved_at"] = resolved_at;
    h["resolved_by"] = resolved_by;
    return { meta: { last_row_id: 0, changes: 1 } };
  }

  throw new Error(`FakeD1.run: motif SQL non supporté: ${n}`);
};

/** Cast helper : le fake expose l'interface D1Database utilisée par le code. */
export function asD1(fake: FakeD1): D1Database {
  return fake as unknown as D1Database;
}
