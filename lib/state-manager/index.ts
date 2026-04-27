// State Manager (PRD §6.3.1) — quant + qualitative layers, pure code (no LLM).

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type {
  LearnerState,
  Grade,
  Complexity,
  EvidenceEntry,
  Blueprint,
  CoreAction,
  ResponseFrame,
} from "@/lib/types/core";
import { getBlueprint } from "@/lib/blueprint";
import {
  DEFAULT_FRAMEWORK,
  computePoints,
  daysBetween,
  effectivePoints,
  initialStability,
  updateStability,
} from "@/lib/points";
import {
  appendConversation,
  hasJourneyOrientation as _hasJourneyOrientation,
} from "@/lib/state-manager/conversation";
import { dropChallengeEnterArtifacts } from "@/lib/learning-runtime/artifact-drop";
import { runNarratorOpening } from "@/lib/narrator";
import {
  normalizeResponseFrames,
  resolveActiveResponseFrame,
  resolveLadderAwareFrame,
} from "@/lib/learning-runtime/response-frames";

export {
  appendConversation,
  listConversation,
  latestConversationEntries,
  conversationCount,
  lastConversationEntry,
  ensureBootstrapMessages,
  hasJourneyOrientation,
  dropArtifact,
  isArtifactAlreadyDropped,
  listDroppedArtifacts,
} from "@/lib/state-manager/conversation";
// ensureJourneyOrientation is defined below — exported via function declaration.

export async function createLearnerState(
  blueprintId: string,
  learnerId?: string
): Promise<LearnerState> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  const lid = learnerId ?? `u_${randomUUID().slice(0, 8)}`;
  const first = firstPosition(bp);
  const now = new Date().toISOString();
  const state: LearnerState = {
    learner_id: lid,
    blueprint_id: blueprintId,
    blueprint_version: bp.version,
    position: first,
    points: { total: 0, by_action: {} },
    unlocked_companions: [],
    completed_challenges: [],
    last_active_at: now,
    created_at: now,
  };
  db()
    .prepare(
      `INSERT INTO learner_states (learner_id, blueprint_id, blueprint_ver, data_json, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(lid, blueprintId, bp.version, JSON.stringify(state), now, now);

  // Single immersive opening: one LLM-crafted narrator bubble that sets
  // time/place/role, introduces the first key person, and plants the
  // opening question. Artifacts drop BELOW this opening so it can
  // pre-reference them.
  await writeImmersiveOpening(lid, blueprintId, first, "first");
  dropChallengeEnterArtifacts({
    learnerId: lid,
    blueprintId,
    chapterId: first.chapter_id,
    challengeId: first.challenge_id,
    turnIdx: 0,
  });
  return state;
}

/** Idempotent: for old learners who lack an immersive opening, append one now
 *  at their current position. Replaces the previous 4-block patch. */
export async function ensureJourneyOrientation(learnerId: string): Promise<boolean> {
  const state = getLearnerState(learnerId);
  if (!state) return false;
  if (_hasJourneyOrientation(learnerId)) return false;
  const bp = getBlueprint(state.blueprint_id);
  if (!bp) return false;
  await writeImmersiveOpening(learnerId, state.blueprint_id, state.position, "first");
  dropChallengeEnterArtifacts({
    learnerId,
    blueprintId: state.blueprint_id,
    chapterId: state.position.chapter_id,
    challengeId: state.position.challenge_id,
    turnIdx: state.position.turn_idx,
  });
  return true;
}

/** Write a single immersive opening narrator bubble via LLM. Used by both
 *  createLearnerState (first) and runTurn cross-challenge transitions. */
export async function writeImmersiveOpening(
  learnerId: string,
  blueprintId: string,
  position: LearnerState["position"],
  variant: "first" | "cross_challenge",
  previousChallenge?: { title: string; milestone?: string | null }
): Promise<void> {
  const traceId = `trc_${randomUUID().slice(0, 8)}`;
  const { text } = await runNarratorOpening({
    learnerId,
    blueprintId,
    variant,
    chapterId: position.chapter_id,
    challengeId: position.challenge_id,
    previousChallenge,
    traceId,
  });
  // Find arc_stage for the chapter so the UI can badge the opening bubble.
  const bp = getBlueprint(blueprintId);
  const chapter = bp?.step3_script?.chapters.find(
    (c) => c.chapter_id === position.chapter_id
  );
  const arcStage = chapter?.arc_stage_id
    ? bp?.step3_script?.journey_meta?.arc_stages?.find(
        (s) => s.id === chapter.arc_stage_id
      ) ?? null
    : null;
  appendConversation({
    learner_id: learnerId,
    turn_idx: position.turn_idx,
    chapter_id: position.chapter_id,
    challenge_id: position.challenge_id,
    role: "narrator",
    text,
    trace_id: traceId,
    meta: {
      kind: "challenge_opening",
      variant,
      ...(arcStage ? { arc_stage: arcStage.name, arc_stage_id: arcStage.id } : {}),
    },
  });
}

function firstPosition(bp: Blueprint): LearnerState["position"] {
  const ch = bp.step3_script?.chapters?.[0];
  const cl = ch?.challenges?.[0];
  return {
    chapter_id: ch?.chapter_id ?? "c1",
    challenge_id: cl?.challenge_id ?? "ch1",
    turn_idx: 0,
  };
}

export function getLearnerState(learnerId: string): LearnerState | null {
  const row = db()
    .prepare(`SELECT data_json FROM learner_states WHERE learner_id = ?`)
    .get(learnerId) as { data_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data_json) as LearnerState;
}

export function listLearners(): LearnerState[] {
  const rows = db()
    .prepare(`SELECT data_json FROM learner_states ORDER BY last_active_at DESC`)
    .all() as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as LearnerState);
}

export function saveLearnerState(s: LearnerState): LearnerState {
  s.last_active_at = new Date().toISOString();
  db()
    .prepare(
      `UPDATE learner_states SET data_json = ?, last_active_at = ?, blueprint_ver = ? WHERE learner_id = ?`
    )
    .run(JSON.stringify(s), s.last_active_at, s.blueprint_version, s.learner_id);
  return s;
}

export interface LearnerDeleteCounts {
  learners: number;
  conversation_log: number;
  evidence_log: number;
  ledger: number;
}

/** Hard-delete a learner and every log row tied to them. The schema has no
 *  FOREIGN KEY constraints, so each table is dropped explicitly inside one
 *  transaction. Does NOT touch the parent blueprint. */
export function deleteLearner(learnerId: string): LearnerDeleteCounts {
  return deleteLearners([learnerId]);
}

/** Read or initialise the learner's ladder progress for a given challenge.
 *  If no record exists yet, position defaults to the challenge's
 *  default_ladder_position (or 0 if absent). */
export function getOrInitLadderProgress(
  learnerId: string,
  challenge: { challenge_id: string; binds_actions: string[]; default_ladder_position?: number }
): { state: LearnerState; progress: import("@/lib/types/core").LadderProgress } | null {
  const s = getLearnerState(learnerId);
  if (!s) return null;
  if (!s.ladder_progress) s.ladder_progress = {};
  let progress = s.ladder_progress[challenge.challenge_id];
  if (!progress) {
    progress = {
      challenge_id: challenge.challenge_id,
      position: challenge.default_ladder_position ?? 0,
      advances_at_position: 0,
      action_id: challenge.binds_actions?.[0] ?? "a1",
      updated_at: new Date().toISOString(),
    };
    s.ladder_progress[challenge.challenge_id] = progress;
    saveLearnerState(s);
  }
  return { state: s, progress };
}

/** Increment advances_at_position for the learner's current ladder rung. */
export function incrementLadderAdvances(
  learnerId: string,
  challengeId: string
): import("@/lib/types/core").LadderProgress | null {
  const s = getLearnerState(learnerId);
  if (!s || !s.ladder_progress) return null;
  const cur = s.ladder_progress[challengeId];
  if (!cur) return null;
  const next = {
    ...cur,
    advances_at_position: cur.advances_at_position + 1,
    updated_at: new Date().toISOString(),
  };
  s.ladder_progress[challengeId] = next;
  saveLearnerState(s);
  return next;
}

/** Move the learner to the next ladder position, resetting advances counter. */
export function escalateLadderPosition(
  learnerId: string,
  challengeId: string
): import("@/lib/types/core").LadderProgress | null {
  const s = getLearnerState(learnerId);
  if (!s || !s.ladder_progress) return null;
  const cur = s.ladder_progress[challengeId];
  if (!cur) return null;
  const next = {
    ...cur,
    position: cur.position + 1,
    advances_at_position: 0,
    updated_at: new Date().toISOString(),
  };
  s.ladder_progress[challengeId] = next;
  saveLearnerState(s);
  return next;
}

export function deleteLearners(learnerIds: string[]): LearnerDeleteCounts {
  const counts: LearnerDeleteCounts = {
    learners: 0,
    conversation_log: 0,
    evidence_log: 0,
    ledger: 0,
  };
  if (learnerIds.length === 0) return counts;
  const d = db();
  const tx = d.transaction((ids: string[]) => {
    for (const lid of ids) {
      counts.conversation_log += d
        .prepare(`DELETE FROM conversation_log WHERE learner_id = ?`)
        .run(lid).changes;
      counts.evidence_log += d
        .prepare(`DELETE FROM evidence_log WHERE learner_id = ?`)
        .run(lid).changes;
      counts.ledger += d
        .prepare(`DELETE FROM ledger WHERE learner_id = ?`)
        .run(lid).changes;
      counts.learners += d
        .prepare(`DELETE FROM learner_states WHERE learner_id = ?`)
        .run(lid).changes;
    }
  });
  tx(learnerIds);
  return counts;
}

// ---------- Snapshot for Judge ----------

export interface Snapshot {
  learner: LearnerState;
  effective_total: number; // with decay applied
  events: { type: string; payload?: unknown }[];
  active_companions: { companion_id: string; level: number }[];
  current_challenge: {
    chapter_id: string;
    challenge_id: string;
    title: string;
    complexity: Complexity;
    binds_actions: string[];
  } | null;
  rubric_column: Record<string, Record<string, { good: string; medium: string; poor: string }>>;
  response_frames: ResponseFrame[];
  active_response_frame: ResponseFrame;
}

export function buildSnapshot(learnerId: string): Snapshot {
  const s = getLearnerState(learnerId);
  if (!s) throw new Error("learner not found");
  const bp = getBlueprint(s.blueprint_id);
  if (!bp) throw new Error("blueprint not found");

  const now = new Date().toISOString();

  // Effective total with decay
  let effTotal = 0;
  for (const [actionId, info] of Object.entries(s.points.by_action)) {
    const days = info.last_review_at ? daysBetween(info.last_review_at, now) : 0;
    effTotal += effectivePoints({
      raw: info.raw,
      stabilityDays: info.stability,
      elapsedDays: days,
    });
  }

  // Events: UNLOCK / UPGRADE checks
  const events: Snapshot["events"] = [];
  const thresholds = bp.step5_points?.instance_params.unlock_thresholds ?? [];
  const unlocked = new Set(s.unlocked_companions.map((c) => c.companion_id));
  for (const t of thresholds) {
    if (effTotal >= t.threshold && !unlocked.has(t.companion_id)) {
      events.push({ type: "UNLOCK", payload: { companion_id: t.companion_id } });
    }
  }

  // Current challenge
  const ch = bp.step3_script?.chapters.find((c) => c.chapter_id === s.position.chapter_id);
  const cl = ch?.challenges.find((c) => c.challenge_id === s.position.challenge_id);
  const currentChallenge = cl
    ? {
        chapter_id: s.position.chapter_id,
        challenge_id: s.position.challenge_id,
        title: cl.title,
        complexity: cl.complexity,
        binds_actions: cl.binds_actions,
      }
    : null;

  // Rubric column for current complexity, for each bound action
  const rubric_column: Snapshot["rubric_column"] = {};
  if (cl && bp.step1_gamecore) {
    for (const actionId of cl.binds_actions) {
      const action = bp.step1_gamecore.core_actions.find((a) => a.action_id === actionId);
      if (!action) continue;
      rubric_column[actionId] = {};
      for (const [dimId, byComplexity] of Object.entries(action.quality_matrix.rubrics)) {
        rubric_column[actionId][dimId] = byComplexity[cl.complexity];
      }
    }
  }

  const responseFrameSource =
    cl ?? {
      binds_actions: currentChallenge?.binds_actions ?? [],
      response_frames: undefined,
      default_response_frame_id: undefined,
      scaffold_ladder: undefined,
      default_ladder_position: undefined,
    };
  const normalizedFrames = normalizeResponseFrames(responseFrameSource);
  const persistedSelection =
    s.active_response_frame?.challenge_id === s.position.challenge_id
      ? s.active_response_frame.selection
      : null;
  // Ladder-aware frame resolution: if the challenge declares a scaffold_ladder
  // and the learner has progress on it, the rung's frame wins over the legacy
  // default_response_frame_id. Existing dynamic selection (via Judge's
  // next_response_frame) still has highest priority via persistedSelection.
  const ladderProgress = cl
    ? (s.ladder_progress ?? {})[s.position.challenge_id] ?? null
    : null;
  const ladderResolution = resolveLadderAwareFrame({
    challenge: responseFrameSource,
    ladderProgress,
    selection: persistedSelection,
  });

  return {
    learner: s,
    effective_total: Math.round(effTotal * 10) / 10,
    events,
    active_companions: s.unlocked_companions,
    current_challenge: currentChallenge,
    rubric_column,
    response_frames: normalizedFrames.frames,
    active_response_frame: ladderResolution.frame,
  };
}

// ---------- Evidence store ----------

export function writeEvidence(entry: Omit<EvidenceEntry, "id">) {
  db()
    .prepare(
      `INSERT INTO evidence_log
         (learner_id, ts, challenge_id, action_id, turn_idx, grades_json, evidence,
          points_earned, complexity, scaffold_strategy, scaffold_assisted, quotable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.learner_id,
      entry.ts,
      entry.challenge_id,
      entry.action_id,
      entry.turn_idx,
      JSON.stringify(entry.grades),
      entry.evidence,
      entry.points_earned ?? null,
      entry.complexity ?? null,
      entry.scaffold_strategy ?? null,
      entry.scaffold_assisted == null ? null : entry.scaffold_assisted ? 1 : 0,
      entry.quotable == null ? null : entry.quotable ? 1 : 0
    );
}

export function listEvidence(learnerId: string, limit = 20): EvidenceEntry[] {
  const rows = db()
    .prepare(
      `SELECT * FROM evidence_log WHERE learner_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(learnerId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToEvidenceEntry);
}

/** Scaffold audit: every evidence row whose scaffold_strategy is non-null,
 *  newest first. Used by the admin panel to compute per-strategy rebound. */
export function listScaffoldedEvidence(learnerId?: string): EvidenceEntry[] {
  const stmt = learnerId
    ? db().prepare(
        `SELECT * FROM evidence_log WHERE learner_id = ? AND scaffold_strategy IS NOT NULL ORDER BY id DESC`
      )
    : db().prepare(
        `SELECT * FROM evidence_log WHERE scaffold_strategy IS NOT NULL ORDER BY id DESC`
      );
  const rows = (learnerId ? stmt.all(learnerId) : stmt.all()) as Array<
    Record<string, unknown>
  >;
  return rows.map(rowToEvidenceEntry);
}

function rowToEvidenceEntry(r: Record<string, unknown>): EvidenceEntry {
  return {
    id: r.id as number,
    learner_id: r.learner_id as string,
    ts: r.ts as string,
    challenge_id: r.challenge_id as string,
    action_id: r.action_id as string,
    turn_idx: r.turn_idx as number,
    grades: JSON.parse(r.grades_json as string),
    evidence: r.evidence as string,
    points_earned:
      typeof r.points_earned === "number" ? (r.points_earned as number) : null,
    complexity:
      typeof r.complexity === "string" ? (r.complexity as Complexity) : null,
    scaffold_strategy:
      typeof r.scaffold_strategy === "string"
        ? (r.scaffold_strategy as import("@/lib/types/core").ScaffoldStrategy)
        : null,
    scaffold_assisted:
      r.scaffold_assisted == null ? null : Boolean(r.scaffold_assisted),
    quotable: r.quotable == null ? null : Boolean(r.quotable),
  };
}

// ---------- Apply Judge output → update state ----------

export interface ApplyJudgeInput {
  learnerId: string;
  grades: Record<string, Grade>; // dim_id → grade
  actionId: string;
  evidence: string;
  complexity: Complexity;
  decisionType: string;
  /** Scaffold audit: which cognitive strategy Judge chose this turn (null
   *  if path was not scaffold / simplify_challenge). */
  scaffoldStrategy?: import("@/lib/types/core").ScaffoldStrategy | null;
  /** Whether this turn's learner production was under scaffold assistance. */
  scaffoldAssisted?: boolean;
  /** Judge flagged this turn's learner input as a "quotable moment" — fuels
   *  the Manifesto pipeline. */
  quotable?: boolean;
}

export function applyJudgeOutput(input: ApplyJudgeInput): {
  state: LearnerState;
  pointsEarned: number;
  newUnlocks: string[];
  /** If the learner crossed into a new challenge on this turn. */
  advancedToNewChallenge: {
    chapter_id: string;
    challenge_id: string;
    title: string;
    setup: string;
  } | null;
  /** If the Judge decided `complete_challenge`, the challenge that was just closed. */
  completedChallenge: {
    chapter_id: string;
    chapter_title: string;
    challenge_id: string;
    challenge_title: string;
    milestone_summary: string | null;
  } | null;
} {
  const s = getLearnerState(input.learnerId);
  if (!s) throw new Error("learner not found");
  const bp = getBlueprint(s.blueprint_id);
  if (!bp) throw new Error("blueprint not found");

  // narrative_advance is a lightweight path: the learner clicked a
  // narrative_choice option. The runtime has already written a light evidence
  // row and the ladder-advance counter increment will happen in runTurn after
  // this returns. Here we just bump turn_idx and short-circuit the rest of
  // the points / mastery / unlock pipeline.
  if (input.decisionType === "narrative_advance") {
    s.position.turn_idx += 1;
    saveLearnerState(s);
    return {
      state: s,
      pointsEarned: 0,
      newUnlocks: [],
      advancedToNewChallenge: null,
      completedChallenge: null,
    };
  }

  // Compute points first so we can persist them alongside evidence.
  const avgGrade = averageGrade(Object.values(input.grades));
  const earned = computePoints({ grades: Object.values(input.grades), complexity: input.complexity });

  // Write evidence — persists grades + the EXACT points awarded + the complexity
  // at award time + the scaffold audit trail. The breakdown modal reads this
  // row verbatim; we never recompute from shifting blueprints.
  writeEvidence({
    learner_id: s.learner_id,
    ts: new Date().toISOString(),
    challenge_id: s.position.challenge_id,
    action_id: input.actionId,
    turn_idx: s.position.turn_idx,
    grades: input.grades,
    evidence: input.evidence,
    points_earned: earned,
    complexity: input.complexity,
    scaffold_strategy: input.scaffoldStrategy ?? null,
    scaffold_assisted: input.scaffoldAssisted ?? false,
    quotable: input.quotable ?? false,
  });

  // Update action-specific decayed stability
  const action = bp.step1_gamecore?.core_actions.find((a) => a.action_id === input.actionId);
  const kt = action?.knowledge_type ?? "procedural";
  const prev = s.points.by_action[input.actionId];
  const now = new Date().toISOString();
  const newStability = prev
    ? updateStability({ oldStability: prev.stability, grade: avgGrade, knowledgeType: kt })
    : initialStability(kt);
  s.points.by_action[input.actionId] = {
    raw: (prev?.raw ?? 0) + earned,
    stability: newStability,
    last_review_at: now,
  };
  s.points.total = Math.round((s.points.total + earned) * 10) / 10;

  // Cross-challenge action mastery — drives scaffold ladder escalation.
  // Counts per grade buckets + a consecutive-good streak so ladder gates
  // like `after_action_mastery_at_least: { threshold: N }` can be
  // evaluated against either the cumulative good_count or the streak.
  if (!s.action_mastery) s.action_mastery = {};
  const masteryPrev = s.action_mastery[input.actionId] ?? {
    attempts: 0,
    good_count: 0,
    medium_count: 0,
    poor_count: 0,
    consecutive_good: 0,
    last_seen_at: now,
    last_challenge_id: s.position.challenge_id,
  };
  const masteryUpdate = { ...masteryPrev };
  masteryUpdate.attempts += 1;
  if (avgGrade === "good") {
    masteryUpdate.good_count += 1;
    masteryUpdate.consecutive_good += 1;
  } else if (avgGrade === "medium") {
    masteryUpdate.medium_count += 1;
    masteryUpdate.consecutive_good = 0;
  } else {
    masteryUpdate.poor_count += 1;
    masteryUpdate.consecutive_good = 0;
  }
  masteryUpdate.last_seen_at = now;
  masteryUpdate.last_challenge_id = s.position.challenge_id;
  s.action_mastery[input.actionId] = masteryUpdate;

  // Determine position change.
  //
  // Semantics (aligned with PRD §6.3.2):
  //   - `advance`              → 当前挑战内前进（turn_idx++），**不**跳挑战
  //   - `complete_challenge` / `reveal_answer_and_advance`
  //                            → 当前挑战完成，跳到下一个挑战（带过渡仪式）
  //   - `escalate_complexity`  → 当前挑战内提升难度（turn_idx++；实际复杂度切换留作后续）
  //   - `retry` / `scaffold` / `branch` → 当前挑战内继续（turn_idx++）
  const prevChallengeId = s.position.challenge_id;
  let advancedToNewChallenge: ReturnType<typeof applyJudgeOutput>["advancedToNewChallenge"] = null;
  const completedChallenge: ReturnType<typeof applyJudgeOutput>["completedChallenge"] =
    input.decisionType === "complete_challenge" ||
    input.decisionType === "reveal_answer_and_advance"
      ? (() => {
          const oldChap = bp.step3_script?.chapters.find((c) => c.chapter_id === s.position.chapter_id);
          const oldChal = oldChap?.challenges.find((c) => c.challenge_id === prevChallengeId);
          return oldChal && oldChap
            ? {
                chapter_id: oldChap.chapter_id,
                chapter_title: oldChap.title,
                challenge_id: oldChal.challenge_id,
                challenge_title: oldChal.title,
                milestone_summary: oldChap.milestone?.summary ?? null,
              }
            : null;
        })()
      : null;

  if (
    input.decisionType === "complete_challenge" ||
    input.decisionType === "reveal_answer_and_advance"
  ) {
    advancePosition(s, bp);
    if (s.position.challenge_id !== prevChallengeId) {
      const newChap = bp.step3_script?.chapters.find((c) => c.chapter_id === s.position.chapter_id);
      const newChal = newChap?.challenges.find((c) => c.challenge_id === s.position.challenge_id);
      if (newChal) {
        advancedToNewChallenge = {
          chapter_id: s.position.chapter_id,
          challenge_id: s.position.challenge_id,
          title: newChal.title,
          setup: newChal.trunk?.setup ?? "",
        };
      }
    }
  } else {
    // Every other decision keeps the learner in the same challenge.
    s.position.turn_idx += 1;
  }

  // Unlock check
  const newUnlocks: string[] = [];
  const thresholds = bp.step5_points?.instance_params.unlock_thresholds ?? [];
  const unlocked = new Set(s.unlocked_companions.map((c) => c.companion_id));
  for (const t of thresholds) {
    if (s.points.total >= t.threshold && !unlocked.has(t.companion_id)) {
      s.unlocked_companions.push({
        companion_id: t.companion_id,
        level: 1,
        unlocked_at: now,
      });
      newUnlocks.push(t.companion_id);
    }
  }

  saveLearnerState(s);
  return { state: s, pointsEarned: earned, newUnlocks, advancedToNewChallenge, completedChallenge };
}

function averageGrade(gs: Grade[]): Grade {
  const scores = gs.map((g) => (g === "good" ? 3 : g === "medium" ? 2 : 1));
  const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  if (avg >= 2.5) return "good";
  if (avg >= 1.5) return "medium";
  return "poor";
}

function advancePosition(s: LearnerState, bp: Blueprint) {
  const chapters = bp.step3_script?.chapters ?? [];
  const ci = chapters.findIndex((c) => c.chapter_id === s.position.chapter_id);
  if (ci < 0) return;
  const chapter = chapters[ci];
  const chapterChallenges = chapter?.challenges ?? [];
  const chi = chapterChallenges.findIndex((c) => c.challenge_id === s.position.challenge_id);
  if (chi < 0) return;
  if (!s.completed_challenges.includes(s.position.challenge_id)) {
    s.completed_challenges.push(s.position.challenge_id);
  }
  // Defensive: walk forward until we find a chapter that actually has challenges.
  if (chi + 1 < chapterChallenges.length) {
    s.position.challenge_id = chapterChallenges[chi + 1].challenge_id;
    s.position.turn_idx = 0;
    return;
  }
  for (let next = ci + 1; next < chapters.length; next++) {
    const nextChallenges = chapters[next]?.challenges ?? [];
    if (nextChallenges.length > 0) {
      s.position.chapter_id = chapters[next].chapter_id;
      s.position.challenge_id = nextChallenges[0].challenge_id;
      s.position.turn_idx = 0;
      return;
    }
  }
  // No more challenges — journey complete. Leave position as-is; the UI can
  // surface this via completed_challenges.length vs total.
}

export function coreActionsForChallenge(bp: Blueprint, challengeId: string): CoreAction[] {
  const ch = bp.step3_script?.chapters.find((c) =>
    c.challenges.some((cl) => cl.challenge_id === challengeId)
  );
  const cl = ch?.challenges.find((c) => c.challenge_id === challengeId);
  if (!bp.step1_gamecore || !cl) return [];
  return bp.step1_gamecore.core_actions.filter((a) => cl.binds_actions.includes(a.action_id));
}

export { DEFAULT_FRAMEWORK };
