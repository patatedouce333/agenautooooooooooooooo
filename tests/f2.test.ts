/**
 * Tests F2 — ARBITRAGE (spec §5 + plan de tests §10).
 * - chiffrage : marge < seuil → rejet ;
 * - cycle : scouting → proposed (HITL) → hired → delivered → paid ;
 * - pas de recrutement sans approbation.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { cancelDeal, getDeal, markDelivered, markHired, markPaid, proposeDeal, quoteDeal } from "../src/f2/arbitrage";
import type { LoopConfig } from "../src/types";
import { FakeD1, asD1 } from "./support/fake-d1";
import { seedFlags, seedRules } from "./support/seed";

const CONFIG: LoopConfig = { dailySpendLimitUsdc: 1, f2MinMarginEur: 15, f2LitigationReserveRate: 0.1, scanTopN: 5 };

let fake: FakeD1;
let db: D1Database;
beforeEach(() => {
  fake = new FakeD1();
  db = asD1(fake);
  seedFlags(fake);
  seedRules(fake);
});

describe("chiffrage", () => {
  it("rejette si la marge nette < seuil (15 €)", async () => {
    // 100 − 80 − 5 − 10 (réserve 10 %) − 0 = 5 < 15 → rejet
    const r = await quoteDeal(db, CONFIG, { clientPrice: 100, freelancerCost: 80, platformFees: 5 });
    expect(r.ok).toBe(false);
  });

  it("crée le deal en scouting si la marge ≥ seuil", async () => {
    // 200 − 100 − 10 − 20 − 5 = 65 ≥ 15
    const r = await quoteDeal(db, CONFIG, {
      clientPrice: 200,
      freelancerCost: 100,
      platformFees: 10,
      controlTimeCost: 5,
      freelancerPlatform: "malt",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marginNet).toBe(65);
    expect(r.deal.status).toBe("scouting");
    expect(r.deal.litigation_reserve).toBe(20); // 10 % du prix client
  });

  it("refuse un prix client invalide", async () => {
    const r = await quoteDeal(db, CONFIG, { clientPrice: 0, freelancerCost: 10 });
    expect(r.ok).toBe(false);
  });
});

describe("cycle de vie", () => {
  async function quotedDealId(): Promise<number> {
    const r = await quoteDeal(db, CONFIG, { clientPrice: 300, freelancerCost: 150 });
    if (!r.ok) throw new Error("quote devrait réussir");
    return r.dealId;
  }

  it("interdit le recrutement avant approbation HITL", async () => {
    const id = await quotedDealId();
    await markHired(db, id, "freelance@example.com"); // WHERE status='proposed' → noop
    expect((await getDeal(db, id))?.status).toBe("scouting");
  });

  it("scouting → proposed → hired → delivered → paid", async () => {
    const id = await quotedDealId();
    await proposeDeal(db, id, "telegram:admin");
    expect((await getDeal(db, id))?.status).toBe("proposed");

    await markHired(db, id, "freelance@example.com");
    expect((await getDeal(db, id))?.status).toBe("hired");

    await markDelivered(db, id, "preuves OK, géoloc vérifiée");
    expect((await getDeal(db, id))?.status).toBe("delivered");

    await markPaid(db, id);
    const deal = await getDeal(db, id);
    expect(deal?.status).toBe("paid");
    expect(deal?.human_payout_at).not.toBeNull();
    expect(deal?.client_paid_at).not.toBeNull();
  });

  it("annulation traçée", async () => {
    const id = await quotedDealId();
    await cancelDeal(db, id, "client désisté");
    expect((await getDeal(db, id))?.status).toBe("cancelled");
  });
});
