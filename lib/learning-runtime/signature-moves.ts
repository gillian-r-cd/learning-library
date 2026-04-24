// Signature moves runtime — the subjective, personal half of the
// objective/subjective ability pair (Mastery Map is the objective half).
//
// Data flow per turn:
//   1. Judge is told which signature_moves are eligible for the current
//      challenge (those bound to challenge.binds_actions). Each move has a
//      recognition_hint.
//   2. If learner's input displays that pattern, Judge emits
//      event_triggers += { type: "AWARD_SIGNATURE_MOVE", payload: { move_id } }.
//   3. runTurn consumes the event → persists to learner_state +
//      writes a "⚔️ 获得招式" system bubble.

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendConversation } from "@/lib/state-manager/conversation";
import type {
  Blueprint,
  EarnedSignatureMove,
  LearnerState,
  SignatureMove,
} from "@/lib/types/core";

/** Resolve the set of signature_moves bound to the current challenge — what
 *  Judge is allowed to award this turn. */
export function eligibleMovesForChallenge(
  bp: Blueprint,
  challengeId: string
): SignatureMove[] {
  if (!bp.step1_gamecore?.core_actions) return [];
  const challenge = findChallenge(bp, challengeId);
  if (!challenge) return [];
  const boundActionIds = new Set(challenge.binds_actions ?? []);
  const out: SignatureMove[] = [];
  for (const action of bp.step1_gamecore.core_actions) {
    if (!boundActionIds.has(action.action_id)) continue;
    for (const m of action.signature_moves ?? []) out.push(m);
  }
  return out;
}

/** All signature_moves defined in the blueprint, keyed by move_id. */
export function allMovesByIdMap(bp: Blueprint): Map<string, SignatureMove> {
  const out = new Map<string, SignatureMove>();
  for (const action of bp.step1_gamecore?.core_actions ?? []) {
    for (const m of action.signature_moves ?? []) {
      out.set(m.move_id, m);
    }
  }
  return out;
}

/** Award a signature move to a learner (idempotent-per-increment).
 *  - If never earned: push new EarnedSignatureMove with count=1.
 *  - If earned before: increment count + update last_earned_at + tier.
 *  Writes a system bubble announcing earn / level-up. Returns the earned row
 *  after update (or null if the move is not defined in blueprint). */
export function awardSignatureMove(args: {
  learner: LearnerState;
  bp: Blueprint;
  moveId: string;
  triggeringQuote: string;
  challengeId: string;
  turnIdx: number;
  chapterId: string | null;
  traceId?: string;
}): EarnedSignatureMove | null {
  const { learner, bp, moveId, triggeringQuote, challengeId, turnIdx, chapterId, traceId } = args;
  const def = allMovesByIdMap(bp).get(moveId);
  if (!def) return null;

  const earned = learner.earned_signature_moves ?? [];
  const now = new Date().toISOString();
  const existing = earned.find((e) => e.move_id === moveId);
  const tiers = def.tier_thresholds ?? [1, 3, 5];

  let result: EarnedSignatureMove;
  let tierCrossed: number | null = null;
  if (existing) {
    const prevTier = tierForCount(existing.count, tiers);
    existing.count += 1;
    existing.last_earned_at = now;
    const newTier = tierForCount(existing.count, tiers);
    if (newTier > prevTier) tierCrossed = newTier;
    result = existing;
  } else {
    const fresh: EarnedSignatureMove = {
      move_id: moveId,
      count: 1,
      first_earned_at: now,
      last_earned_at: now,
      triggering_quote: triggeringQuote.slice(0, 200),
      first_challenge_id: challengeId,
    };
    earned.push(fresh);
    result = fresh;
    tierCrossed = 1; // "初识" is always announced on first earn
  }
  learner.earned_signature_moves = earned;
  learner.last_active_at = now;
  db()
    .prepare(
      `UPDATE learner_states SET data_json = ?, last_active_at = ? WHERE learner_id = ?`
    )
    .run(JSON.stringify(learner), now, learner.learner_id);

  // Learner-visible system bubble
  const tierLabel = TIER_LABEL[tierCrossed ?? tierForCount(result.count, tiers)] ?? "初识";
  if (tierCrossed !== null) {
    appendConversation({
      learner_id: learner.learner_id,
      turn_idx: turnIdx,
      chapter_id: chapterId,
      challenge_id: challengeId,
      role: "system",
      who: "signature_move",
      text:
        tierCrossed === 1
          ? `⚔️ 获得招式：「${def.name}」（${tierLabel} · ${def.definition}）`
          : `⚔️ 招式升级：「${def.name}」→ ${tierLabel}（累计 ${result.count} 次）`,
      trace_id: traceId ?? `trc_${randomUUID().slice(0, 8)}`,
      meta: {
        kind: "signature_move",
        move_id: moveId,
        tier: tierCrossed,
        count: result.count,
      },
    });
  }
  return result;
}

function findChallenge(bp: Blueprint, challengeId: string) {
  for (const chap of bp.step3_script?.chapters ?? []) {
    const c = chap.challenges?.find((x) => x.challenge_id === challengeId);
    if (c) return c;
  }
  return null;
}

function tierForCount(count: number, tiers: number[]): number {
  let tier = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (count >= tiers[i]) tier = i + 1;
  }
  return tier;
}

const TIER_LABEL: Record<number, string> = {
  1: "初识",
  2: "娴熟",
  3: "立派",
};
