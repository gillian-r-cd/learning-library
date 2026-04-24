// Points framework (PRD §7.1) — FSRS-inspired decay + recovery

import type {
  Grade,
  Complexity,
  KnowledgeType,
  Step5Points,
} from "@/lib/types/core";

export const DEFAULT_FRAMEWORK: Step5Points = {
  framework_version: "v1",
  instance_params: {
    base_points: { good: 3, medium: 1, poor: 0 },
    complexity_multiplier: { low: 1.0, medium: 1.5, high: 2.5 },
    interaction_participation_bonus: 0.2,
    replay_bonus_ratio: 0.3,
    decay: {
      model: "fsrs_inspired",
      params_by_knowledge_type: {
        factual: { initial_stability: 3, stability_growth: 1.2 },
        conceptual: { initial_stability: 7, stability_growth: 1.3 },
        procedural: { initial_stability: 14, stability_growth: 1.5 },
        metacognitive: { initial_stability: 10, stability_growth: 1.4 },
      },
      floor_ratio: 0.2,
    },
    unlock_thresholds: [],
    target_progress_curve: {
      first_companion_at_challenge: 3,
      first_milestone_at_challenge: 5,
      full_companion_set_at_challenge: 12,
    },
  },
  total_capacity: 840,
  fit_diagnostics: {
    fast_learner_unlock_first_at: 2,
    median_learner_unlock_first_at: 3,
    slow_learner_unlock_first_at: 4,
  },
};

/** Points earned for a single interaction. */
export function computePoints(args: {
  grades: Grade[];
  complexity: Complexity;
  framework?: Step5Points;
}): number {
  const fw = args.framework ?? DEFAULT_FRAMEWORK;
  const base = args.grades
    .map((g) => fw.instance_params.base_points[g])
    .reduce((a, b) => a + b, 0);
  const mult = fw.instance_params.complexity_multiplier[args.complexity];
  return Math.round(base * mult * 10) / 10;
}

/** Retrievability for a memory with stability S after elapsed days t. */
export function retrievability(stabilityDays: number, elapsedDays: number, floorRatio = 0.2): number {
  if (stabilityDays <= 0) return floorRatio;
  const r = Math.exp(-elapsedDays / stabilityDays);
  return Math.max(floorRatio, r);
}

/** Effective points given decay. */
export function effectivePoints(args: {
  raw: number;
  stabilityDays: number;
  elapsedDays: number;
  floorRatio?: number;
}): number {
  const R = retrievability(args.stabilityDays, args.elapsedDays, args.floorRatio ?? 0.2);
  return Math.round(args.raw * R * 10) / 10;
}

/** Update stability after a review. */
export function updateStability(args: {
  oldStability: number;
  grade: Grade;
  knowledgeType: KnowledgeType;
  framework?: Step5Points;
}): number {
  const fw = args.framework ?? DEFAULT_FRAMEWORK;
  const { stability_growth } =
    fw.instance_params.decay.params_by_knowledge_type[args.knowledgeType];
  const qf = args.grade === "good" ? 1.2 : args.grade === "medium" ? 1.0 : 0.8;
  return Math.round(args.oldStability * stability_growth * qf * 10) / 10;
}

/** Initial stability when first encountering an action. */
export function initialStability(
  kt: KnowledgeType,
  framework: Step5Points = DEFAULT_FRAMEWORK
): number {
  return framework.instance_params.decay.params_by_knowledge_type[kt].initial_stability;
}

/** Compute daysBetween for decay math. */
export function daysBetween(tsA: string | null, tsB: string): number {
  if (!tsA) return 0;
  const ms = new Date(tsB).getTime() - new Date(tsA).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

/** Determine unlock thresholds by rank_percent against estimated capacity. */
export function computeUnlockThresholds(
  companionIds: string[],
  totalCapacity: number
): { companion_id: string; threshold: number }[] {
  const n = companionIds.length;
  if (n === 0) return [];
  return companionIds.map((id, idx) => ({
    companion_id: id,
    threshold: Math.round((((idx + 1) / n) * 0.95 + 0.05) * 0.45 * totalCapacity),
  }));
}
