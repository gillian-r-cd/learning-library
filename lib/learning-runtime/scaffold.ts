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

export type HelpIntentKind = "none" | "hint" | "example" | "reveal";

export interface HelpIntent {
  kind: HelpIntentKind;
  selfHelp: boolean;
  frustration: boolean;
}

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

export function detectHelpIntent(learnerInput: string): HelpIntent {
  if (!learnerInput) return { kind: "none", selfHelp: false, frustration: false };
  const trimmed = learnerInput.trim();
  const selfHelp = detectSelfHelpSignal(trimmed);
  const hint = /(提示一下|给点线索|给我点线索|提醒我一下|一点提示|线索就行)/.test(trimmed);
  const reveal =
    /(直接告诉我(答案|怎么做)|告诉我答案|给答案|揭晓吧|看答案|我放弃|算了|不想答了|不想继续|别问了|跳过吧|一直不对|老是不对|太烦了|烦死了)/.test(
      trimmed
    );
  const frustration =
    reveal ||
    /(崩溃|挫败|受不了了|怎么都不对|一直卡|卡死了|太难了|好烦|没意思)/.test(
      trimmed
    );

  if (reveal || frustration) return { kind: "reveal", selfHelp, frustration };
  if (selfHelp) return { kind: "example", selfHelp, frustration: false };
  if (hint) return { kind: "hint", selfHelp: false, frustration: false };
  return { kind: "none", selfHelp: false, frustration: false };
}

/** Count the latest learner messages in the same challenge that are help or
 * frustration signals. Called after the current learner message is persisted,
 * so a value of 2 means the learner has now asked twice in a row. */
export function consecutiveHelpSignalsInChallenge(
  learnerId: string,
  challengeId: string
): number {
  const rows = db()
    .prepare(
      `SELECT text FROM conversation_log
       WHERE learner_id = ? AND challenge_id = ? AND role = 'learner'
       ORDER BY id DESC
       LIMIT 5`
    )
    .all(learnerId, challengeId) as Array<{ text: string }>;
  let streak = 0;
  for (const row of rows) {
    const intent = detectHelpIntent(row.text);
    if (intent.kind === "none") break;
    streak += 1;
  }
  return streak;
}
