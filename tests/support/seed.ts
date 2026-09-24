/**
 * Seed de test — MIROIR de `migrations/0002_seed_platform_rules.sql`.
 * Un test (`tos.test.ts`) vérifie que les deux restent synchronisés.
 */
import { FakeD1 } from "./fake-d1";

export const EXPECTED_RULES: Array<{
  platform: string;
  can_scan: number;
  can_prepare: number;
  can_auto_submit: number;
  requires_hitl_for_submit: number;
}> = [
  { platform: "x402-bazaar", can_scan: 1, can_prepare: 1, can_auto_submit: 1, requires_hitl_for_submit: 0 },
  { platform: "rentahuman-requester", can_scan: 1, can_prepare: 1, can_auto_submit: 1, requires_hitl_for_submit: 0 },
  { platform: "rentahuman-provider", can_scan: 1, can_prepare: 1, can_auto_submit: 1, requires_hitl_for_submit: 0 },
  { platform: "gitcoin", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "dework", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "superteam", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "algora", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "upwork", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "malt", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "comeup", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "youpijob", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
  { platform: "leboncoin-services", can_scan: 1, can_prepare: 1, can_auto_submit: 0, requires_hitl_for_submit: 1 },
];

export function seedRules(fake: FakeD1): void {
  for (const r of EXPECTED_RULES) {
    fake.rules.set(r.platform, { ...r, notes_tos: "seed de test", last_verified_at: "2026-09-24T00:00:00Z" });
  }
}

export function seedFlags(fake: FakeD1): void {
  fake.flags.set("freeze", { value: "false", updated_at: "2026-09-24T00:00:00Z" });
  fake.flags.set("degraded_mode", { value: "false", updated_at: "2026-09-24T00:00:00Z" });
  fake.flags.set("unfreeze_pending", { value: "false", updated_at: "2026-09-24T00:00:00Z" });
}

/** Crée une mission de test, retourne son id. */
export function seedMission(
  fake: FakeD1,
  partial: Record<string, unknown> = {},
): number {
  const id = fake.nextId++;
  const row: Record<string, unknown> = {
    found_at: new Date().toISOString(),
    source_platform: "algora",
    external_id: `test-${id}`,
    title: "Mission de test",
    url: "https://example.com/mission",
    amount: 100,
    currency: "USDC",
    kind: "f1_executable",
    status: "scored",
    score: 50,
    effort_estimate_h: 2,
    acceptance_proba: 0.5,
    hitl_approved_at: null,
    hitl_approved_by: null,
    submitted_via: null,
    submitted_at: null,
    deliverable_ref: null,
    draft_text: null,
    deadline: null,
    notes: null,
    ...partial,
  };
  row["id"] = id;
  fake.missions.set(id, row);
  return id;
}
