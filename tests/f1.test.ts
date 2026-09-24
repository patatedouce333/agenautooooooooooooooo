/**
 * Tests F1 — EXÉCUTION + SOUMISSION (spec §4 + plan de tests §10).
 * - exécution : approved requis, F2 refusée ;
 * - submit auto (x402) vs draft humain (algora) + confirmation humaine ;
 * - freeze : submit bloqué même sur plateforme auto.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { executeMission } from "../src/f1/executor";
import { submitMission } from "../src/f1/submitter";
import type { LoopConfig } from "../src/types";
import { FakeD1, asD1 } from "./support/fake-d1";
import { seedFlags, seedMission, seedRules } from "./support/seed";

const CONFIG: LoopConfig = { dailySpendLimitUsdc: 1, f2MinMarginEur: 15, f2LitigationReserveRate: 0.1, scanTopN: 5 };

let fake: FakeD1;
let db: D1Database;
beforeEach(() => {
  fake = new FakeD1();
  db = asD1(fake);
  seedFlags(fake);
  seedRules(fake);
});

describe("exécution", () => {
  it("refuse d'exécuter sans approbation HITL", async () => {
    const id = seedMission(fake, { status: "proposed" });
    const r = await executeMission(db, id);
    expect(r.ok).toBe(false);
  });

  it("refuse les missions F2 (routées arbitrage)", async () => {
    const id = seedMission(fake, { status: "approved", kind: "f2_needs_human" });
    const r = await executeMission(db, id);
    expect(r.ok).toBe(false);
  });

  it("exécute une mission approved et prépare le draft", async () => {
    const id = seedMission(fake, { status: "approved" });
    const r = await executeMission(db, id, async (m) => ({
      ref: `pr:org/repo#${m.id}`,
      qaNotes: "QA OK",
      draftText: "Proposition…",
    }));
    expect(r.ok).toBe(true);
    expect(fake.missions.get(id)?.["status"]).toBe("executing");
    expect(fake.missions.get(id)?.["deliverable_ref"]).toBe(`pr:org/repo#${id}`);
    expect(fake.missions.get(id)?.["draft_text"]).toBe("Proposition…");
  });
});

describe("soumission", () => {
  it("auto-submit sur x402-bazaar (agent-natif)", async () => {
    const id = seedMission(fake, { status: "executing", source_platform: "x402-bazaar" });
    const r = await submitMission(db, CONFIG, id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("auto");
    expect(fake.missions.get(id)?.["status"]).toBe("submitted");
    expect(fake.missions.get(id)?.["submitted_via"]).toBe("auto");
  });

  it("prépare un draft humain sur Algora (ToS), puis confirme le clic humain", async () => {
    const id = seedMission(fake, { status: "executing", source_platform: "algora" });
    const prep = await submitMission(db, CONFIG, id, false);
    expect(prep.ok).toBe(true);
    if (prep.ok) expect(prep.via).toBe("human");
    expect(fake.missions.get(id)?.["status"]).toBe("executing"); // pas encore soumis

    const confirm = await submitMission(db, CONFIG, id, true);
    expect(confirm.ok).toBe(true);
    expect(fake.missions.get(id)?.["status"]).toBe("submitted");
    expect(fake.missions.get(id)?.["submitted_via"]).toBe("human");
  });

  it("freeze : l'agent ne soumet plus en auto, mais le clic humain reste traçable", async () => {
    // Sous freeze, la policy refuse tout submit sortant de l'AGENT.
    // En revanche, si l'humain a physiquement cliqué sur la plateforme de son
    // côté, enregistrer ce fait (bookkeeping, pas d'action sortante) reste OK.
    fake.flags.set("freeze", { value: "true", updated_at: new Date().toISOString() });
    const { evaluatePolicy } = await import("../src/core/policy");
    const v = await evaluatePolicy(db, CONFIG, { action: "submit", platform: "x402-bazaar" });
    expect(v.allowed).toBe(false); // l'agent ne soumet pas tout seul

    const id = seedMission(fake, { status: "executing", source_platform: "x402-bazaar" });
    const r = await submitMission(db, CONFIG, id, true); // humain confirme son propre clic
    expect(r.ok).toBe(true);
    expect(fake.missions.get(id)?.["submitted_via"]).toBe("human");
  });
});
