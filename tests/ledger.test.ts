/**
 * Tests LEDGER (spec §6 + §8 + plan de tests §10).
 * - anti self-dealing : autopaiement → self_test, jamais dans le KPI ;
 * - idempotence : même nonce x2 → replay, aucun double crédit ;
 * - KPI : Net = Revenu − Coûts.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { computeDailyKpi, isOwnWallet, listEvents, recordEvent } from "../src/core/ledger";
import { addOwnWallet } from "../src/payments/rails";
import { recordIncomingX402Payment } from "../src/payments/x402";
import { utcToday } from "../src/types";
import { FakeD1, asD1 } from "./support/fake-d1";
import { seedFlags, seedRules, seedMission } from "./support/seed";

let fake: FakeD1;
let db: D1Database;
beforeEach(() => {
  fake = new FakeD1();
  db = asD1(fake);
  seedFlags(fake);
  seedRules(fake);
});

describe("anti self-dealing", () => {
  it("requalifie en self_test tout sale depuis un wallet propre", async () => {
    await addOwnWallet(db, "0xPAYTO", "PAYTO", "test", true);
    expect(await isOwnWallet(db, "0xpayto")).toBe(true); // insensible à la casse

    const r = await recordEvent(db, { kind: "sale", amountUsdc: 100, payer: "0xPAYTO" });
    expect(r.ok).toBe(true);

    const events = await listEvents(db, 10);
    expect(events[0].kind).toBe("self_test");

    const kpi = await computeDailyKpi(db, utcToday());
    expect(kpi.revenue_usdc).toBe(0); // jamais dans le revenu
  });

  it("compte comme revenu un sale depuis un tiers", async () => {
    await addOwnWallet(db, "0xPAYTO", "PAYTO", "test", true);
    await recordEvent(db, { kind: "sale", amountUsdc: 42.5, payer: "0xCLIENT" });
    const kpi = await computeDailyKpi(db, utcToday());
    expect(kpi.revenue_usdc).toBe(42.5);
    expect(kpi.sales_count).toBe(1);
  });

  it("refuse l'ajout de wallet sans HITL", async () => {
    const r = await addOwnWallet(db, "0xEVIL", "OTHER", "test", false);
    expect(r.ok).toBe(false);
    expect(await isOwnWallet(db, "0xEVIL")).toBe(false);
  });
});

describe("idempotence x402", () => {
  it("même nonce soumis deux fois → replay, aucun double crédit", async () => {
    const payment = { paymentNonce: "nonce-abc-123", txHash: "0xtx1", amountUsdc: 25, payer: "0xCLIENT" };
    const first = await recordIncomingX402Payment(db, payment);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.idempotentReplay).toBe(false);

    const second = await recordIncomingX402Payment(db, { ...payment, txHash: "0xtx1-bis" });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.idempotentReplay).toBe(true);
      expect(second.eventId).toBe(first.ok ? first.eventId : -1);
    }

    const kpi = await computeDailyKpi(db, utcToday());
    expect(kpi.revenue_usdc).toBe(25); // crédité une seule fois
  });

  it("passe une mission submitted → paid au premier encaissement", async () => {
    const id = seedMission(fake, { status: "submitted", source_platform: "x402-bazaar" });
    await recordIncomingX402Payment(db, { paymentNonce: "n1", amountUsdc: 10, payer: "0xC", missionId: id });
    expect(fake.missions.get(id)?.["status"]).toBe("paid");
  });
});

describe("KPI quotidien", () => {
  it("Net = Revenu − (fees + human_payout + api_cost)", async () => {
    await recordEvent(db, { kind: "sale", amountUsdc: 100, payer: "0xC1" });
    await recordEvent(db, { kind: "sale", amountUsdc: 50, payer: "0xC2" });
    await recordEvent(db, { kind: "fee", amountUsdc: 2, costKind: "facilitator" });
    await recordEvent(db, { kind: "human_payout", amountUsdc: 30 });
    await recordEvent(db, { kind: "api_cost", amountUsdc: 3, costKind: "llm" });
    await recordEvent(db, { kind: "transfer", amountUsdc: 999 }); // ignoré

    const kpi = await computeDailyKpi(db, utcToday());
    expect(kpi.revenue_usdc).toBe(150);
    expect(kpi.costs_usdc).toBe(35);
    expect(kpi.net_usdc).toBe(115);
    expect(kpi.sales_count).toBe(2);
  });
});
