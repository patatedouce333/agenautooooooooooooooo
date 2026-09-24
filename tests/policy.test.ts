/**
 * Tests POLICY ENGINE (spec §7 + plan de tests §10).
 * - plafond SPEND (auto sous le plafond, HITL au-dessus) ;
 * - freeze (effet immédiat, sans redéploiement) ;
 * - embauche F2 (toujours HITL) ;
 * - aucun trading (refus par construction, même avec HITL).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { evaluatePolicy, guardNoTrading, type PolicyRequest } from "../src/core/policy";
import { recordEvent } from "../src/core/ledger";
import type { LoopConfig } from "../src/types";
import { FakeD1, asD1 } from "./support/fake-d1";
import { seedFlags, seedRules } from "./support/seed";

const CONFIG: LoopConfig = {
  dailySpendLimitUsdc: 1,
  f2MinMarginEur: 15,
  f2LitigationReserveRate: 0.1,
  scanTopN: 5,
};

let fake: FakeD1;
let db: D1Database;

beforeEach(() => {
  fake = new FakeD1();
  db = asD1(fake);
  seedFlags(fake);
  seedRules(fake);
});

async function verdict(req: PolicyRequest) {
  return evaluatePolicy(db, CONFIG, req);
}

describe("règle 1 — plafond SPEND", () => {
  it("autorise en auto sous le plafond journalier", async () => {
    const v = await verdict({ action: "spend", amountUsdc: 0.5 });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.via).toBe("auto");
  });

  it("bloque au-dessus du plafond et exige un HITL", async () => {
    const v = await verdict({ action: "spend", amountUsdc: 5 });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.requiresHitl).toBe(true);
  });

  it("cumule les dépenses du jour (2e dépense qui dépasse → bloquée)", async () => {
    await recordEvent(db, { kind: "fee", amountUsdc: 0.8, costKind: "spend" });
    const v = await verdict({ action: "spend", amountUsdc: 0.5 });
    expect(v.allowed).toBe(false);
  });

  it("autorise via HITL même au-dessus du plafond", async () => {
    const v = await verdict({ action: "spend", amountUsdc: 5, hitlApproved: true });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.via).toBe("hitl");
  });
});

describe("règle 4 — freeze", () => {
  it("bloque spend/submit/hire quand freeze=true (effet immédiat)", async () => {
    fake.flags.set("freeze", { value: "true", updated_at: new Date().toISOString() });
    for (const action of ["spend", "submit", "hire"] as const) {
      const v = await verdict({ action, amountUsdc: 0.01, platform: "x402-bazaar", hitlApproved: true });
      expect(v.allowed).toBe(false);
    }
  });

  it("laisse passer le scan (lecture seule) même gelé", async () => {
    fake.flags.set("freeze", { value: "true", updated_at: new Date().toISOString() });
    const v = await verdict({ action: "scan", platform: "algora" });
    expect(v.allowed).toBe(true);
  });
});

describe("embauche F2 — HITL toujours obligatoire", () => {
  it("bloque sans approbation, quel que soit le montant", async () => {
    const v = await verdict({ action: "hire", amountUsdc: 0.01 });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.requiresHitl).toBe(true);
  });

  it("autorise avec approbation", async () => {
    const v = await verdict({ action: "hire", amountUsdc: 500, hitlApproved: true });
    expect(v.allowed).toBe(true);
  });
});

describe("règle 3 — aucun trading, par construction", () => {
  it("refuse 'trade' même avec HITL (requiresHitl=false : jamais)", async () => {
    const v = await verdict({ action: "trade", hitlApproved: true });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.requiresHitl).toBe(false);
  });

  it("guardNoTrading refuse tout le vocabulaire de trade", () => {
    for (const word of ["trade", "swap", "long", "short", "leverage", "perp", "futures"]) {
      const v = guardNoTrading(word);
      expect(v, word).not.toBeNull();
      expect(v!.allowed).toBe(false);
    }
  });

  it("guardNoTrading laisse passer les actions légitimes", () => {
    for (const word of ["spend", "submit", "scan", "hire"]) {
      expect(guardNoTrading(word)).toBeNull();
    }
  });
});

describe("actions inconnues — refus + HITL", () => {
  it("bloque toute action inconnue", async () => {
    const v = await verdict({ action: "lancer_fusee" as unknown as "spend" });
    expect(v.allowed).toBe(false);
  });
});
