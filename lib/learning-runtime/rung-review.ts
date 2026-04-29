// Rung review = the "explanation beat" routing.
//
// Two trigger paths (per docs/narrator-judge-decoupling.md):
//   (a) Single-choice rung where the learner picked an option flagged
//       judgment_kind === "off_target".
//   (b) Form / free_text rung where Judge graded the turn below "good" AND
//       the learner has now missed the same rung at least twice.
//
// In either case, the runtime synthesises (or rewrites) a JudgeOutput with
// path_decision.type === "enter_review" and hands Narrator two pieces of
// designer-authored content:
//
//   - model_judgment   (the canonical correct read for this rung)
//   - selected_misreading (one entry from common_misreadings, or the
//                          option-specific misreading for off_target picks)
//
// Narrator then runs in REVIEW mode, which the prompt forces into a
// hedge-free direct explanation. The runtime escalates the ladder rung
// after the beat with completion_kind = "partial_via_teach".

import type {
  JudgeOutput,
  ResponseFrame,
  ResponseOption,
  ScaffoldLadderRung,
} from "@/lib/types/core";

export interface RungReviewSelection {
  /** The full text Narrator must state as the canonical answer. */
  modelJudgment: string;
  /** The misreading explanation to weave into the beat. */
  selectedMisreading: string;
  /** Why this misreading was picked (for tracing / logs). */
  reason: "option_specific" | "matched_dim" | "first_available";
}

/** Find an option object on a frame by its `value`. */
export function findFrameOption(
  frame: ResponseFrame | null | undefined,
  value: unknown
): ResponseOption | null {
  if (!frame || frame.kind !== "single_choice") return null;
  const choiceField = frame.fields.find((f) => f.field_id === "choice")
    ?? frame.fields[0];
  if (!choiceField?.options) return null;
  const v = String(value ?? "");
  return choiceField.options.find((o) => o.value === v) ?? null;
}

/** True when a single_choice option carries the off_target judgment_kind tag.
 *  This is the hard short-circuit signal that the runtime uses to skip Judge
 *  entirely and route straight into review mode. */
export function isOffTargetOption(option: ResponseOption | null): boolean {
  return option?.judgment_kind === "off_target";
}

/** Pick the misreading explanation for a single_choice off_target pick.
 *  Priority: option_specific_misreading > misreading entry whose dim_id
 *  matches the option's dim hint > first available > empty. */
export function pickMisreadingForOption(args: {
  rung: ScaffoldLadderRung | null;
  option: ResponseOption;
}): { description: string; reason: RungReviewSelection["reason"] } {
  const optSpecific = args.option.option_specific_misreading?.trim();
  if (optSpecific) {
    return { description: optSpecific, reason: "option_specific" };
  }
  const bank = args.rung?.common_misreadings ?? [];
  if (bank.length === 0) return { description: "", reason: "first_available" };
  return {
    description: bank[0].description,
    reason: "first_available",
  };
}

/** Pick the misreading explanation for a graded rung (form / free_text).
 *  Priority: misreading entry whose dim_id matches the worst-graded dim in
 *  Judge output > first available > empty. */
export function pickMisreadingFromJudge(args: {
  rung: ScaffoldLadderRung | null;
  judgeOutput: JudgeOutput;
}): { description: string; reason: RungReviewSelection["reason"] } {
  const bank = args.rung?.common_misreadings ?? [];
  if (bank.length === 0) return { description: "", reason: "first_available" };

  // Worst-first: poor before medium. The first dim Judge graded as poor wins;
  // failing that, the first medium dim. Skip dims graded good.
  const ranked = [...(args.judgeOutput.quality ?? [])].filter(
    (q) => q.grade !== "good"
  );
  ranked.sort((a, b) => {
    const score = (g: string) => (g === "poor" ? 0 : g === "medium" ? 1 : 2);
    return score(a.grade) - score(b.grade);
  });
  for (const q of ranked) {
    const hit = bank.find((m) => m.dim_id === q.dim_id);
    if (hit) return { description: hit.description, reason: "matched_dim" };
  }
  return { description: bank[0].description, reason: "first_available" };
}

/** Decide whether the turn that Judge just graded should be UPGRADED to
 *  enter_review mode, based on rung state + Judge result. Caller is
 *  responsible for calling this AFTER Judge runs and BEFORE Narrator runs. */
export function shouldEnterReviewFromJudge(args: {
  rung: ScaffoldLadderRung | null;
  judgeOutput: JudgeOutput;
  /** Same-rung attempt count INCLUDING the turn just graded. e.g. 2 means
   *  this is the second miss on the rung. */
  sameRungAttemptsIncludingThisTurn: number;
}): boolean {
  const rung = args.rung;
  if (!rung) return false;
  if (!rung.model_judgment || rung.model_judgment.trim().length === 0) {
    return false; // no designer-authored answer → cannot run review beat
  }
  // single_choice rungs do their own pre-Judge short-circuit; this helper
  // only handles the post-Judge graded path.
  if (rung.kind === "single_choice") return false;

  // Don't override Judge if it's already on a terminal-style path.
  const pt = args.judgeOutput.path_decision?.type;
  if (
    pt === "complete_challenge" ||
    pt === "narrative_advance" ||
    pt === "reveal_answer_and_advance" ||
    pt === "enter_review"
  ) {
    return false;
  }

  // Did the learner pass this turn? Any "good" on a quality dim counts as
  // "advancing on at least one dim" — we only enter review when the rung
  // is fully missed.
  const quality = args.judgeOutput.quality ?? [];
  if (quality.length === 0) return false;
  const allMissed = quality.every((q) => q.grade !== "good");
  if (!allMissed) return false;

  return args.sameRungAttemptsIncludingThisTurn >= 2;
}
