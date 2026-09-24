/**
 * Tests SCORING F1 (spec §4 étape 2 : score = (montant × proba) / effort).
 */
import { describe, expect, it } from "vitest";
import { clamp01, rankByScore, requiresHuman, scoreMission, toUsdcEquivalent } from "../src/core/scoring";

describe("score = (montant × proba) / effort", () => {
  it("calcule le score nominal", () => {
    expect(scoreMission({ amount: 100, currency: "USDC", acceptanceProba: 0.5, effortEstimateH: 2 })).toBe(25);
  });

  it("retourne 0 si non chiffrable", () => {
    expect(scoreMission({ amount: null, currency: null, acceptanceProba: 0.9, effortEstimateH: 1 })).toBe(0);
    expect(scoreMission({ amount: 0, currency: "USDC", acceptanceProba: 0.9, effortEstimateH: 1 })).toBe(0);
  });

  it(" borne la proba à [0,1] et plancher l'effort (pas d'infini)", () => {
    expect(scoreMission({ amount: 100, currency: "USDC", acceptanceProba: 9, effortEstimateH: 0 })).toBe(400); // 100*1/0.25
    expect(scoreMission({ amount: 100, currency: "USDC", acceptanceProba: -5, effortEstimateH: 1 })).toBe(0);
  });

  it("convertit EUR à parité 1:1 par défaut", () => {
    expect(toUsdcEquivalent(50, "EUR")).toBe(50);
    expect(toUsdcEquivalent(50, "USDC")).toBe(50);
  });

  it("clamp01 borne correctement", () => {
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(NaN)).toBe(0);
  });

  it("rankByScore trie par score décroissant", () => {
    const ranked = rankByScore([
      { id: 1, score: 10 },
      { id: 2, score: 99 },
      { id: 3, score: null },
    ]);
    expect(ranked.map((m) => m.id)).toEqual([2, 1, 3]);
  });
});

describe("routage F1 vs F2 (détection humain requis)", () => {
  it("détecte les missions terrain/présence (FR + EN)", () => {
    expect(requiresHuman("Photo géolocalisée du chantier requise")).toBe(true);
    expect(requiresHuman("Mission en présentiel à Paris")).toBe(true);
    expect(requiresHuman("Need on-site installation in Lyon")).toBe(true);
    expect(requiresHuman("Validation légale par notaire")).toBe(true);
  });

  it("laisse passer les missions agent-compatibles", () => {
    expect(requiresHuman("Fix bug in Rust parser")).toBe(false);
    expect(requiresHuman("Rédiger un rapport d'audit SEO")).toBe(false);
  });
});
