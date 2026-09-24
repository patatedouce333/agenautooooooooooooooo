/**
 * Tests MATRICE ToS (spec §3 + plan de tests §10).
 * - submit Upwork/Algora → refus net côté serveur ;
 * - submit x402/Bazaar → autorisé ;
 * - plateforme inconnue → refus + HITL ;
 * - la migration SQL seed reste synchronisée avec le seed de test.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluatePolicy } from "../src/core/policy";
import type { LoopConfig } from "../src/types";
import { FakeD1, asD1 } from "./support/fake-d1";
import { EXPECTED_RULES, seedFlags, seedRules } from "./support/seed";

const CONFIG: LoopConfig = { dailySpendLimitUsdc: 1, f2MinMarginEur: 15, f2LitigationReserveRate: 0.1, scanTopN: 5 };

let fake: FakeD1;
let db: D1Database;
beforeEach(() => {
  fake = new FakeD1();
  db = asD1(fake);
  seedFlags(fake);
  seedRules(fake);
});

describe("matrice ToS — submit", () => {
  it("REFUSE le submit auto sur Upwork (bots interdits)", async () => {
    const v = await evaluatePolicy(db, CONFIG, { action: "submit", platform: "upwork" });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.requiresHitl).toBe(true);
      expect(v.reason).toMatch(/interdit/i);
    }
  });

  it("REFUSE le submit auto sur Algora (robotic access interdit)", async () => {
    const v = await evaluatePolicy(db, CONFIG, { action: "submit", platform: "algora" });
    expect(v.allowed).toBe(false);
  });

  it("REFUSE le submit auto sur Malt/ComeUp (prudence, ToS à vérifier)", async () => {
    for (const p of ["malt", "comeup"]) {
      const v = await evaluatePolicy(db, CONFIG, { action: "submit", platform: p });
      expect(v.allowed, p).toBe(false);
    }
  });

  it("AUTORISE le submit auto sur x402-bazaar (agent-natif)", async () => {
    const v = await evaluatePolicy(db, CONFIG, { action: "submit", platform: "x402-bazaar" });
    expect(v.allowed).toBe(true);
  });

  it("REFUSE toute plateforme non listée + exige approbation humaine", async () => {
    const v = await evaluatePolicy(db, CONFIG, { action: "submit", platform: "plateforme-obscure-xyz" });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.requiresHitl).toBe(true);
      expect(v.reason).toMatch(/inconnue/);
    }
  });

  it("autorise le scan partout où can_scan=true", async () => {
    for (const r of EXPECTED_RULES) {
      const v = await evaluatePolicy(db, CONFIG, { action: "scan", platform: r.platform });
      expect(v.allowed, r.platform).toBe(true);
    }
  });
});

describe("seed SQL — non-régression", () => {
  it("la migration seed contient chaque plateforme avec les bonnes valeurs", () => {
    const path = join(__dirname, "..", "migrations", "0002_seed_platform_rules.sql");
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8");
    for (const r of EXPECTED_RULES) {
      expect(sql, `plateforme ${r.platform}`).toContain(`'${r.platform}'`);
    }
    // Upwork/Algora explicitement non-auto dans le SQL.
    expect(sql).toMatch(/'upwork', 1, 1, 0, 1/);
    expect(sql).toMatch(/'algora', 1, 1, 0, 1/);
    expect(sql).toMatch(/'x402-bazaar', 1, 1, 1, 0/);
  });
});
