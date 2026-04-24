// Companion upgrade-path runtime — the piece that makes `upgrade_path`
// (defined in Skill 4 output) actually mean something.
//
// Rule (simple, deterministic, derivable from conversation_log):
//   A companion's level = min(upgrade_path.length, 1 + floor(speeches / tier))
//   Tiers: [3 speeches → Lv.2, 8 speeches → Lv.3]
// i.e. once a companion has spoken 3 times, they advance to Lv.2; at 8 speeches,
// Lv.3. If upgrade_path has fewer levels, cap there.
//
// After each turn, recompute levels for every unlocked companion. If any
// level changed, persist to learner_state AND write a system "✨ 升级" bubble
// so the learner sees it.

import { db } from "@/lib/db";
import { appendConversation } from "@/lib/state-manager/conversation";
import type { Blueprint, LearnerState } from "@/lib/types/core";

const SPEECH_THRESHOLDS = [3, 8]; // Lv.2 at 3 speeches, Lv.3 at 8

export interface CompanionUpgradeEvent {
  companion_id: string;
  display_name: string;
  from_level: number;
  to_level: number;
  delta_description: string;
}

/** For each unlocked companion, compute the level the runtime considers
 *  correct right now, based on speech count. Returns the list of upgrade
 *  events that fired this turn + the updated LearnerState (same object
 *  mutated in place for caller convenience). */
export function recomputeCompanionLevels(args: {
  learnerId: string;
  learner: LearnerState;
  blueprint: Blueprint;
  turnIdx: number;
  chapterId: string | null;
  challengeId: string | null;
  traceId?: string;
}): CompanionUpgradeEvent[] {
  const { learnerId, learner, blueprint: bp, turnIdx, chapterId, challengeId, traceId } = args;

  if (learner.unlocked_companions.length === 0) return [];
  const companionDefsById = new Map<string, { display_name: string; upgrade_path: { level: number; delta: string }[] }>();
  for (const c of bp.step4_companions?.companions ?? []) {
    companionDefsById.set(c.companion_id, {
      display_name: c.display_name,
      upgrade_path: c.upgrade_path ?? [],
    });
  }

  // Count speeches per display_name (same key the companion writes under).
  const speechCounts = countCompanionSpeeches(learnerId);

  const events: CompanionUpgradeEvent[] = [];
  const now = new Date().toISOString();
  for (const entry of learner.unlocked_companions) {
    const def = companionDefsById.get(entry.companion_id);
    if (!def) continue;
    const speeches = speechCounts.get(def.display_name) ?? 0;
    const computed = computeLevel(speeches, def.upgrade_path.length);
    if (computed > entry.level) {
      const from = entry.level;
      entry.level = computed;
      const delta = def.upgrade_path[computed - 1]?.delta ?? "";
      events.push({
        companion_id: entry.companion_id,
        display_name: def.display_name,
        from_level: from,
        to_level: computed,
        delta_description: delta,
      });
      appendConversation({
        learner_id: learnerId,
        turn_idx: turnIdx,
        chapter_id: chapterId,
        challenge_id: challengeId,
        role: "system",
        who: "upgrade",
        text: `✨ ${def.display_name} 升级到 Lv.${computed}：${delta || "（无描述）"}`,
        trace_id: traceId ?? null,
        meta: {
          kind: "companion_upgrade",
          companion_id: entry.companion_id,
          from_level: from,
          to_level: computed,
        },
      });
    }
  }
  if (events.length > 0) {
    learner.last_active_at = now;
    db()
      .prepare(
        `UPDATE learner_states SET data_json = ?, last_active_at = ? WHERE learner_id = ?`
      )
      .run(JSON.stringify(learner), now, learnerId);
  }
  return events;
}

export function computeLevel(
  speeches: number,
  upgradePathLength: number
): number {
  if (upgradePathLength <= 0) return 1;
  let level = 1;
  for (let i = 0; i < SPEECH_THRESHOLDS.length; i++) {
    if (speeches >= SPEECH_THRESHOLDS[i]) level = i + 2;
  }
  return Math.min(level, upgradePathLength);
}

function countCompanionSpeeches(learnerId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT who, COUNT(*) AS n FROM conversation_log
       WHERE learner_id = ? AND role = 'companion' AND who IS NOT NULL
       GROUP BY who`
    )
    .all(learnerId) as Array<{ who: string; n: number }>;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.who, r.n);
  return out;
}

/** Expose the thresholds so UI can show "下一次升级还差 N 次发言". */
export function getSpeechThresholds(): number[] {
  return [...SPEECH_THRESHOLDS];
}
