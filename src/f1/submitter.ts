/**
 * F1 — SOUMISSION (spec §4, étape 5).
 *
 *   Si can_auto_submit → l'agent soumet seul.
 *   Si requires_hitl  → l'agent prépare le texte exact à copier-coller,
 *                       l'envoie à Telegram, l'humain clique sur la plateforme.
 *   → trace dans decisions(action='submitted', via='auto'|'human').
 *
 * La policy `submit` est ÉVALUÉE CÔTÉ SERVEUR à chaque appel : même un bug
 * ou un LLM entreprenant ne peut pas auto-submit sur Upwork/Algora.
 */

import type { LoopConfig } from "../types";
import { utcNowIso } from "../types";
import { evaluatePolicy } from "../core/policy";
import { getMission, logDecision, updateMissionStatus } from "../db/queries";

export type SubmitResult =
  | { ok: true; via: "auto" | "human"; missionId: number; message: string }
  | { ok: false; reason: string };

/**
 * Soumet (ou prépare pour soumission humaine) une mission exécutée.
 * @param humanConfirm — passer true quand l'humain confirme avoir cliqué
 *                       sur la plateforme (route Telegram /missions).
 */
export async function submitMission(
  db: D1Database,
  config: LoopConfig,
  missionId: number,
  humanConfirm = false,
): Promise<SubmitResult> {
  const mission = await getMission(db, missionId);
  if (!mission) return { ok: false, reason: `Mission #${missionId} introuvable.` };
  if (mission.status === "submitted" || mission.status === "paid") {
    return { ok: false, reason: `Mission #${missionId} déjà '${mission.status}'.` };
  }
  if (mission.status !== "executing") {
    return { ok: false, reason: `Mission #${missionId} au statut '${mission.status}' — exécutez-la d'abord.` };
  }

  // ── Policy SUBMIT côté serveur (matrice ToS) ──
  const verdict = await evaluatePolicy(db, config, { action: "submit", platform: mission.source_platform });

  if (verdict.allowed) {
    // Auto-submit (x402/Bazaar, RentAHuman…) — l'agent soumet seul.
    await updateMissionStatus(db, missionId, "submitted", {
      submitted_via: "auto",
      submitted_at: utcNowIso(),
    });
    await logDecision(db, "submitted", `Mission #${missionId} soumise automatiquement (${mission.source_platform}).`, {
      actor: "agent",
      metadata: { missionId, via: "auto", platform: mission.source_platform },
    });
    return { ok: true, via: "auto", missionId, message: `Mission #${missionId} soumise automatiquement sur ${mission.source_platform}.` };
  }

  // ── Submit humain requis ──
  if (!humanConfirm) {
    await logDecision(db, "submit_prepared", `Draft mission #${missionId} préparé pour submit humain. ${verdict.reason}`, {
      actor: "agent",
      metadata: { missionId, via: "human", platform: mission.source_platform },
    });
    return {
      ok: true,
      via: "human",
      missionId,
      message:
        `Auto-submit bloqué (${verdict.reason}). ` +
        `Draft prêt — copiez-collez sur ${mission.source_platform}, puis confirmez.`,
    };
  }

  // L'humain confirme avoir cliqué sur la plateforme.
  await updateMissionStatus(db, missionId, "submitted", {
    submitted_via: "human",
    submitted_at: utcNowIso(),
  });
  await logDecision(db, "submitted", `Mission #${missionId} soumise par l'humain (${mission.source_platform}).`, {
    actor: "human",
    metadata: { missionId, via: "human", platform: mission.source_platform },
  });
  return { ok: true, via: "human", missionId, message: `Mission #${missionId} marquée soumise (via humain).` };
}
