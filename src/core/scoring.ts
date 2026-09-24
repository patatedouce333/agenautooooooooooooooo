/**
 * loop v2 — SCORING F1 (spec §4, étape 2).
 *
 *   score = (montant × proba d'acceptation) / effort
 *
 * - montant       : brut converti en USDC-équivalent (EUR ≈ 1:1 par défaut) ;
 * - proba         : 0..1 estimée par l'agent (historique plateforme, fit) ;
 * - effort        : heures agent estimées (plancher 0.25 h pour éviter
 *                   les divisions par zéro et les scores infinis).
 *
 * Les missions exigeant un humain (terrain, légal, présence physique)
 * sont classées `f2_needs_human` et exclues du top-N F1.
 */

export interface ScorableMission {
  amount: number | null;
  currency: string | null;
  acceptanceProba: number | null;
  effortEstimateH: number | null;
}

/** Mots-clés (FR/EN) qui signalent une mission nécessitant un humain. */
const HUMAN_REQUIRED_KEYWORDS = [
  "terrain",
  "présence",
  "presentiel",
  "on-site",
  "onsite",
  "in person",
  "déplacement",
  "travel",
  "photo géolocalisée",
  "geotagged",
  "validation légale",
  "legal validation",
  "notaire",
  "huissier",
  "physique",
  "physical presence",
  "livraison locale",
  "local delivery",
  "installation",
  "on site",
];

const MIN_EFFORT_H = 0.25;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Convertit un montant brut en USDC-équivalent (parité EUR≈1:1 par défaut). */
export function toUsdcEquivalent(amount: number | null, currency: string | null): number {
  if (amount === null || Number.isNaN(amount) || amount <= 0) return 0;
  const cur = (currency ?? "USDC").toUpperCase();
  if (cur === "EUR") return amount; // parité configurable plus tard
  return amount; // USDC, USD… : 1:1
}

/** Normalise une chaîne (minuscules + sans accents) pour la comparaison. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Détecte si une mission exige un humain à partir de son titre/description.
 * Utilisé pour router F1 (agent seul) vs F2 (arbitrage humain).
 * Insensible à la casse et aux accents (« présentiel » ≈ « presentiel »).
 */
export function requiresHuman(title: string | null, notes: string | null = null): boolean {
  const haystack = fold(`${title ?? ""} ${notes ?? ""}`);
  return HUMAN_REQUIRED_KEYWORDS.some((kw) => haystack.includes(fold(kw)));
}

/**
 * Score F1 : (montant × proba) / effort.
 * Retourne 0 pour toute mission non chiffrable (montant/effort manquants).
 */
export function scoreMission(m: ScorableMission): number {
  const value = toUsdcEquivalent(m.amount, m.currency);
  const proba = clamp01(m.acceptanceProba ?? 0.5);
  const effort = Math.max(MIN_EFFORT_H, m.effortEstimateH ?? 1);
  if (value <= 0) return 0;
  const score = (value * proba) / effort;
  return Math.round(score * 100) / 100;
}

/** Trie un lot de missions par score décroissant (stables sur l'id). */
export function rankByScore<T extends { score: number | null; id: number }>(missions: T[]): T[] {
  return [...missions].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);
}
