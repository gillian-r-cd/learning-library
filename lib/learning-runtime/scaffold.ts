// Scaffold runtime helpers — derived signals that feed the Judge's decision
// about WHEN to scaffold and HOW HARD.
//
// Two inputs Judge cares about:
//   1. consecutive_poor_in_challenge — how many turns in a row the learner
//      has been all-poor on every dim within the CURRENT challenge. Triggers:
//        ≥ 2  → path=scaffold (regular)
//        ≥ 3  → force strategy=worked_example (hardest support short of simplify)
//        ≥ 5  → path=simplify_challenge (cognitive downgrade)
//   2. self_help_signal — whether this turn's learner input is a self-declared
//      "I give up / give me an example / help me" moment. If yes, immediately
//      jump to simplify_challenge without waiting for the counter.
//
// Both are backstops for Judge: Judge is SUPPOSED to catch these patterns from
// the prompt alone, but we derive them in code and inject them as explicit
// variables so Judge can't miss.

import { db } from "@/lib/db";
import type { Grade } from "@/lib/types/core";

/** Walk back through evidence rows within `challengeId`, newest first, and
 *  count the suffix of consecutive turns where EVERY graded dim is "poor".
 *  Any single "medium" or "good" breaks the streak. */
export function consecutivePoorInChallenge(
  learnerId: string,
  challengeId: string
): number {
  const rows = db()
    .prepare(
      `SELECT grades_json FROM evidence_log
       WHERE learner_id = ? AND challenge_id = ?
       ORDER BY id DESC`
    )
    .all(learnerId, challengeId) as Array<{ grades_json: string }>;
  let streak = 0;
  for (const r of rows) {
    let grades: Record<string, Grade> = {};
    try {
      grades = JSON.parse(r.grades_json) as Record<string, Grade>;
    } catch {
      break;
    }
    const vals = Object.values(grades);
    if (vals.length === 0) break;
    // All-poor means every dim is poor. Forgiving: any medium/good breaks.
    const allPoor = vals.every((g) => g === "poor");
    if (allPoor) streak++;
    else break;
  }
  return streak;
}

/** Regex-based backstop for self-help signals. Fire on either:
 *   (a) a short, anchored utterance that IS a cry for help ("我不知道了"), or
 *   (b) an explicit begging pattern anywhere in a longer message ("给我个例子"
 *       / "完全没思路").
 *  Reject long answers that merely CONTAIN "不知道" as description (e.g.
 *  "他不知道产品细节"). */
export function detectSelfHelpSignal(learnerInput: string): boolean {
  if (!learnerInput) return false;
  const trimmed = learnerInput.trim();
  // Pattern 1: the WHOLE input is a short cry for help.
  if (
    /^(我?不知道了?|不会了?|没(思路|头绪)|帮帮我|给个例子|给我个例子|卡住了|我放弃|我想不出来?)[。.!！\s]*$/.test(
      trimmed
    )
  ) {
    return true;
  }
  // Pattern 2: explicit begging phrase appears inside a longer message.
  if (
    /(帮帮我|给(我)?(一个|个)例子|给我看(个|一个)(范例|例子)|完全没(思路|头绪)|我真的不会|我(彻底|真的)卡住了|我(真的|完全)不知道(该|要)怎么)/.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}
