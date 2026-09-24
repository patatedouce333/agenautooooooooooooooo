/**
 * F1 — EXÉCUTEUR (spec §4, étape 4).
 *
 * L'agent produit le livrable (code, analyse, rapport…) APRÈS validation
 * Telegram (`approved`). Contrôle qualité interne : second passage /
 * vérification croisée avant soumission.
 *
 * Ce module orchestre le cycle de vie en base :
 *   approved → executing → (livrable prêt) → prêt pour `submitter`.
 * La production réelle du livrable est déléguée au LLM (fonction
 * `produceDeliverable` injectable — Workers AI, API externe…).
 */

import type { Mission } from "../types";
import { utcNowIso } from "../types";
import { getMission, logDecision, updateMissionStatus } from "../db/queries";

/** Fonction de production du livrable (injectée — LLM au choix). */
export type DeliverableProducer = (mission: Mission) => Promise<{
  /** Référence du livrable (URL repo, chemin R2, hash…). */
  ref: string;
  /** Résumé du contrôle qualité interne (second passage). */
  qaNotes: string;
  /** Texte exact à copier-coller si submit humain requis. */
  draftText: string;
}>;

/** Producteur par défaut : marque la mission « à produire » (stub explicite). */
export const defaultProducer: DeliverableProducer = async (mission) => ({
  ref: `draft:mission-${mission.id}`,
  qaNotes: "QA interne : stub — brancher le LLM (Workers AI / API) pour générer le livrable réel.",
  draftText:
    `Bonjour,\n\nJe propose de réaliser « ${mission.title ?? `mission #${mission.id}`} » ` +
    `(${mission.url ?? "voir plateforme"}).\n\nApproche : [à compléter par l'agent]\nDélai : [à compléter]\n\nCordialement.`,
});

export type ExecuteResult =
  | { ok: true; missionId: number; deliverableRef: string }
  | { ok: false; reason: string };

/** Exécute une mission `approved` (HITL déjà donné). */
export async function executeMission(
  db: D1Database,
  missionId: number,
  produce: DeliverableProducer = defaultProducer,
): Promise<ExecuteResult> {
  const mission = await getMission(db, missionId);
  if (!mission) return { ok: false, reason: `Mission #${missionId} introuvable.` };
  if (mission.kind !== "f1_executable") {
    return { ok: false, reason: `Mission #${missionId} classée ${mission.kind} — routée F2, pas F1.` };
  }
  if (mission.status !== "approved") {
    return { ok: false, reason: `Mission #${missionId} au statut '${mission.status}' — approbation HITL requise avant exécution.` };
  }

  await updateMissionStatus(db, missionId, "executing");
  await logDecision(db, "execute_start", `Exécution mission #${missionId} (${mission.source_platform}).`, {
    actor: "agent",
    metadata: { missionId, platform: mission.source_platform },
  });

  try {
    const produced = await produce(mission);
    await updateMissionStatus(db, missionId, "executing", {
      deliverable_ref: produced.ref,
      draft_text: produced.draftText,
      notes: [mission.notes, `QA: ${produced.qaNotes}`].filter(Boolean).join("\n---\n"),
    });
    await logDecision(db, "execute_done", `Livrable mission #${missionId} prêt (${produced.ref}).`, {
      actor: "agent",
      metadata: { missionId, ref: produced.ref },
    });
    return { ok: true, missionId, deliverableRef: produced.ref };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await updateMissionStatus(db, missionId, "approved", {
      notes: `Échec d'exécution (${utcNowIso()}) : ${reason} — retour en file pour nouvel essai.`,
    });
    await logDecision(db, "execute_failed", `Échec exécution #${missionId} : ${reason}`, { actor: "agent" });
    return { ok: false, reason };
  }
}
