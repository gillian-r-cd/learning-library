// Judge (PRD §6.3.2)
//
// Extended to receive the full journey context (topic / role / chapter /
// challenge / action description / learner_total_turns) so it can apply the
// cognitive-stage rules defined in the Judge system prompt.

import { randomUUID } from "node:crypto";
import { llmCall } from "@/lib/llm";
import { llmCallWithTransientRetry } from "@/lib/llm/retry";
import { getBlueprint } from "@/lib/blueprint";
import { db } from "@/lib/db";
import { conversationCount } from "@/lib/state-manager/conversation";
import { listEvidence } from "@/lib/state-manager";
import {
  listAvailableArtifactsSummary,
  listPendingArtifacts,
} from "@/lib/learning-runtime/artifact-drop";
import type { ActiveCompanionHook } from "@/lib/learning-runtime/companion-hooks";
import type {
  Grade,
  HelpRequest,
  JudgeOutput,
  NextResponseFrameSelection,
  ScaffoldStrategy,
  ScaffoldSpec,
} from "@/lib/types/core";
import { SCAFFOLD_FORM_TO_STRATEGY } from "@/lib/types/core";
import type { Snapshot } from "@/lib/state-manager";
import {
  consecutiveHelpSignalsInChallenge,
  consecutivePoorInChallenge,
  detectHelpIntent,
  detectSelfHelpSignal,
} from "@/lib/learning-runtime/scaffold";
import { eligibleMovesForChallenge } from "@/lib/learning-runtime/signature-moves";

export interface JudgeInput {
  snapshot: Snapshot;
  learnerInput: string;
  evidenceSummary: string;
  actionSpaceRules: string;
  /** Hooks the current challenge's blueprint declared for any active
   *  companions. Judge is REQUIRED to consider these when choosing who to
   *  dispatch as a speaker — if a hook clearly fits the current turn's
   *  weakness, the companion whose hook it is MUST be a speaker. */
  activeCompanionHooks?: ActiveCompanionHook[];
  traceId?: string;
  helpRequest?: HelpRequest | null;
}

export async function runJudge(args: JudgeInput): Promise<{
  output: JudgeOutput;
  callId: string;
  traceId: string;
}> {
  const traceId = args.traceId ?? `trc_${randomUUID().slice(0, 8)}`;
  const bp = getBlueprint(args.snapshot.learner.blueprint_id);
  const chapter = bp?.step3_script?.chapters.find(
    (c) => c.chapter_id === args.snapshot.current_challenge?.chapter_id
  );
  const challenge = chapter?.challenges.find(
    (c) => c.challenge_id === args.snapshot.current_challenge?.challenge_id
  );
  const boundActionId = challenge?.binds_actions?.[0] ?? null;
  const boundAction = boundActionId
    ? bp?.step1_gamecore?.core_actions.find((a) => a.action_id === boundActionId)
    : null;
  const totalLearnerTurns = countLearnerTurns(args.snapshot.learner.learner_id);

  // Artifacts the learner has already seen (summary) and those still pending
  // on the current challenge. Used by Judge to decide when to fire DROP_ARTIFACT.
  const currentChapterId = args.snapshot.current_challenge?.chapter_id ?? "";
  const currentChallengeId = args.snapshot.current_challenge?.challenge_id ?? "";
  const availableArtifacts = currentChallengeId
    ? listAvailableArtifactsSummary({
        learnerId: args.snapshot.learner.learner_id,
        blueprintId: args.snapshot.learner.blueprint_id,
        chapterId: currentChapterId,
        challengeId: currentChallengeId,
      })
    : [];
  const pendingArtifacts = currentChallengeId
    ? listPendingArtifacts({
        learnerId: args.snapshot.learner.learner_id,
        blueprintId: args.snapshot.learner.blueprint_id,
        chapterId: currentChapterId,
        challengeId: currentChallengeId,
      })
    : [];

  // Per-dim recent grade trend within the current challenge. Newest first.
  const perDimRecentGrades = currentChallengeId
    ? buildPerDimRecentGrades(args.snapshot.learner.learner_id, currentChallengeId)
    : {};

  // Scaffold-trigger signals — Judge uses these to decide strategy + thresholds.
  const consecutivePoor = currentChallengeId
    ? consecutivePoorInChallenge(
        args.snapshot.learner.learner_id,
        currentChallengeId
      )
    : 0;
  const selfHelpSignal = detectSelfHelpSignal(args.learnerInput);
  const detectedHelpIntent = detectHelpIntent(args.learnerInput);
  const helpSignalStreak = currentChallengeId
    ? consecutiveHelpSignalsInChallenge(
        args.snapshot.learner.learner_id,
        currentChallengeId
      )
    : 0;
  const helpIntent =
    args.helpRequest?.kind ??
    (helpSignalStreak >= 2 && detectedHelpIntent.kind !== "none"
      ? "reveal"
      : detectedHelpIntent.kind);

  // Signature moves eligible for the current challenge (bound actions).
  // Judge is instructed to emit AWARD_SIGNATURE_MOVE events when learner's
  // input shows the recognition_hint pattern.
  const eligibleSignatureMoves = currentChallengeId && bp
    ? eligibleMovesForChallenge(bp, currentChallengeId).map((m) => ({
        move_id: m.move_id,
        name: m.name,
        recognition_hint: m.recognition_hint,
        bound_actions: m.bound_actions,
      }))
    : [];
  // Already-earned moves — Judge sees so it knows awarding again is an
  // increment (not duplicate suppression).
  const earnedMoveCounts = Object.fromEntries(
    (args.snapshot.learner.earned_signature_moves ?? []).map((e) => [
      e.move_id,
      e.count,
    ])
  );

  const res = await llmCallWithTransientRetry(() =>
    llmCall({
      caller: "judge",
      stage: "learning",
      traceId,
      learnerId: args.snapshot.learner.learner_id,
      blueprintId: args.snapshot.learner.blueprint_id,
      userVisible: false,
      variables: {
        topic: bp?.topic ?? "(未知主题)",
        protagonist_role:
          bp?.step3_script?.journey_meta?.protagonist_role ??
          `一名正在学习「${bp?.topic ?? ""}」的实践者`,
        chapter_title: chapter?.title ?? "—",
        chapter_narrative_premise: chapter?.narrative_premise ?? "",
        challenge_title: challenge?.title ?? "—",
        challenge_complexity: challenge?.complexity ?? "low",
        challenge_setup: challenge?.trunk?.setup ?? "",
        challenge_expected_signals: challenge?.trunk?.expected_signals ?? [],
        core_action_description: boundAction
          ? `${boundAction.name}: ${boundAction.description}`
          : "—",
        learner_total_turns: totalLearnerTurns,
        challenge_turn_idx: args.snapshot.learner.position.turn_idx,
        rubric_column: args.snapshot.rubric_column,
        action_space_rules: args.actionSpaceRules,
        learner_input: args.learnerInput,
        evidence_summary: args.evidenceSummary,
        events: args.snapshot.events,
        active_companions: args.snapshot.active_companions,
        response_frames: args.snapshot.response_frames.map((f) => ({
          frame_id: f.frame_id,
          kind: f.kind,
          title: f.title,
          prompt: f.prompt,
          fields: f.fields.map((field) => ({
            field_id: field.field_id,
            type: field.type,
            label: field.label,
            required: field.required ?? false,
          })),
        })),
        active_response_frame: {
          frame_id: args.snapshot.active_response_frame.frame_id,
          kind: args.snapshot.active_response_frame.kind,
          title: args.snapshot.active_response_frame.title,
        },
        available_artifacts: availableArtifacts,
        pending_artifacts: pendingArtifacts,
        per_dim_recent_grades: perDimRecentGrades,
        active_companion_hooks: args.activeCompanionHooks ?? [],
        consecutive_poor_in_challenge: consecutivePoor,
        self_help_signal: selfHelpSignal,
        help_intent: helpIntent,
        help_request_kind: args.helpRequest?.kind ?? "",
        frustration_signal: detectedHelpIntent.frustration,
        consecutive_help_signals_in_challenge: helpSignalStreak,
        eligible_signature_moves: eligibleSignatureMoves,
        earned_signature_move_counts: earnedMoveCounts,
      },
    })
  );
  const normalized = normalizeJudgeOutput(res.parsed, {
    dimIds: extractDimIds(args.snapshot.rubric_column, boundActionId),
  });
  return { output: normalized, callId: res.callId, traceId: res.traceId };
}

/** Make Judge output safe for every downstream consumer.
 *
 * Real LLMs occasionally:
 *  - omit `quality` entirely
 *  - return an empty array
 *  - use a different shape like `grades` instead of `quality`
 *  - forget `path_decision`, `companion_dispatch`, `event_triggers`, etc.
 *
 * Rather than crashing `runTurn` with "Cannot read properties of undefined
 * (reading '0')" — which was the symptom that surfaced in production — we
 * coerce the output into the strict `JudgeOutput` shape with sensible defaults.
 */
export function normalizeJudgeOutput(
  raw: unknown,
  ctx: { dimIds: string[] }
): JudgeOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // quality: accept `quality` or `grades`; fall back to one-entry medium.
  let quality = (obj.quality ?? obj.grades) as JudgeOutput["quality"] | undefined;
  if (!Array.isArray(quality) || quality.length === 0) {
    const dims = ctx.dimIds.length ? ctx.dimIds : ["d1"];
    quality = dims.map((dim_id) => ({
      dim_id,
      grade: "medium" as const,
      evidence: "(Judge 未给出评估，系统按中等处理)",
    }));
  } else {
    quality = quality.map((q, i) => {
      const r = (q ?? {}) as Record<string, unknown>;
      const grade = (r.grade as string) ?? "medium";
      return {
        dim_id: (r.dim_id as string) ?? ctx.dimIds[i] ?? `d${i + 1}`,
        grade: (["good", "medium", "poor"].includes(grade)
          ? (grade as "good" | "medium" | "poor")
          : "medium"),
        evidence: typeof r.evidence === "string" ? r.evidence : "",
      };
    });
  }

  // path_decision: default to retry so the turn completes safely.
  const pdRaw = (obj.path_decision ?? {}) as Record<string, unknown>;
  const pdType = pdRaw.type as string;
  const validTypes = [
    "advance",
    "retry",
    "scaffold",
    "branch",
    "complete_challenge",
    "reveal_answer_and_advance",
    "escalate_complexity",
    "simplify_challenge",
  ];
  const pathType = (validTypes.includes(pdType) ? pdType : "retry") as
    JudgeOutput["path_decision"]["type"];
  const scaffoldSpec: ScaffoldSpec | null =
    pathType === "scaffold" ||
    pathType === "simplify_challenge" ||
    pathType === "reveal_answer_and_advance"
      ? normalizeScaffoldSpec(pdRaw.scaffold_spec, ctx.dimIds, pathType)
      : null;

  // companion_dispatch: default [].
  const dispatchRaw = Array.isArray(obj.companion_dispatch)
    ? (obj.companion_dispatch as unknown[])
    : [];
  const companion_dispatch = dispatchRaw.map((d, i) => {
    const r = (d ?? {}) as Record<string, unknown>;
    const role = (r.role as string) ?? "speaker";
    return {
      companion_id: String(r.companion_id ?? `cp${i}`),
      role: (role === "silent" ? "silent" : "speaker") as "speaker" | "silent",
      directive: typeof r.directive === "string" ? r.directive : "",
      priority: typeof r.priority === "number" ? r.priority : 50,
    };
  });

  return {
    quality,
    path_decision: {
      type: pathType,
      target: (pdRaw.target as string | null) ?? null,
      scaffold_spec: scaffoldSpec,
    },
    narrator_directive:
      typeof obj.narrator_directive === "string" && obj.narrator_directive.trim()
        ? obj.narrator_directive
        : "肯定学员的思考方向，追问一个更具体的下一步。",
    companion_dispatch,
    script_branch_switch:
      typeof obj.script_branch_switch === "string" ? obj.script_branch_switch : null,
    event_triggers: normalizeEventTriggers(obj.event_triggers),
    next_response_frame: normalizeNextResponseFrame(obj.next_response_frame),
  };
}

function normalizeNextResponseFrame(raw: unknown): NextResponseFrameSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const frameId = typeof r.frame_id === "string" ? r.frame_id.trim() : "";
  if (!frameId) return null;
  const reason = typeof r.reason === "string" ? r.reason : "";
  const overridesRaw =
    r.overrides && typeof r.overrides === "object"
      ? (r.overrides as Record<string, unknown>)
      : null;
  const overrides: NextResponseFrameSelection["overrides"] = {};
  if (overridesRaw) {
    for (const key of ["title", "prompt", "helper_text"] as const) {
      const value = overridesRaw[key];
      if (typeof value === "string" && value.trim()) overrides[key] = value;
    }
  }
  return {
    frame_id: frameId,
    reason,
    ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
  };
}

/** Accept any combination of legacy `form` and modern `strategy` and coerce
 *  to a strict ScaffoldSpec. Priority:
 *   1. `strategy` (if valid ScaffoldStrategy) wins.
 *   2. `form` (legacy) is mapped via SCAFFOLD_FORM_TO_STRATEGY.
 *   3. Otherwise: default to "retrieval_prompt" (softest) for scaffold, or
 *      "worked_example" for simplify_challenge (hardest). */
const VALID_STRATEGIES: ScaffoldStrategy[] = [
  "worked_example",
  "contrastive_cases",
  "chunked_walkthrough",
  "analogy_bridge",
  "retrieval_prompt",
  "near_transfer_demo",
  "concept_scaffold",
  "self_explanation",
];
function normalizeScaffoldSpec(
  raw: unknown,
  dimIds: string[],
  pathType: string
): ScaffoldSpec {
  const s = (raw ?? {}) as Record<string, unknown>;
  const rawStrategy = s.strategy as string | undefined;
  const rawForm = s.form as string | undefined;
  let strategy: ScaffoldStrategy | null = null;
  if (rawStrategy && VALID_STRATEGIES.includes(rawStrategy as ScaffoldStrategy)) {
    strategy = rawStrategy as ScaffoldStrategy;
  } else if (rawForm && rawForm in SCAFFOLD_FORM_TO_STRATEGY) {
    strategy = SCAFFOLD_FORM_TO_STRATEGY[rawForm as keyof typeof SCAFFOLD_FORM_TO_STRATEGY];
  } else {
    strategy =
      pathType === "simplify_challenge" || pathType === "reveal_answer_and_advance"
        ? "worked_example"
        : "retrieval_prompt";
  }
  const focusDim = (s.focus_dim as string) ?? dimIds[0] ?? "d1";
  const notes = typeof s.notes === "string" ? (s.notes as string) : undefined;
  return {
    strategy,
    focus_dim: focusDim,
    ...(typeof rawForm === "string" && rawForm in SCAFFOLD_FORM_TO_STRATEGY
      ? { form: rawForm as import("@/lib/types/core").ScaffoldForm }
      : {}),
    ...(notes ? { notes } : {}),
  };
}

// Only surface events we understand; drop malformed entries so the runtime
// loop can trust the shape. Today: AWARD_POINTS, UNLOCK_CHECK, DROP_ARTIFACT.
// New event types can be added here as the system grows.
function normalizeEventTriggers(raw: unknown): JudgeOutput["event_triggers"] {
  if (!Array.isArray(raw)) return [];
  const KNOWN = new Set([
    "AWARD_POINTS",
    "UNLOCK_CHECK",
    "DROP_ARTIFACT",
    "AWARD_SIGNATURE_MOVE",
  ]);
  return (raw as unknown[])
    .map((ev) => {
      if (!ev || typeof ev !== "object") return null;
      const r = ev as Record<string, unknown>;
      const type = typeof r.type === "string" ? (r.type as string) : "";
      if (!type || !KNOWN.has(type)) return null;
      const payload =
        r.payload && typeof r.payload === "object"
          ? (r.payload as Record<string, unknown>)
          : undefined;
      if (type === "DROP_ARTIFACT") {
        const artifactId = payload?.artifact_id;
        if (typeof artifactId !== "string" || !artifactId.trim()) return null;
        return { type, payload: { artifact_id: artifactId } };
      }
      if (type === "AWARD_SIGNATURE_MOVE") {
        const moveId = payload?.move_id;
        if (typeof moveId !== "string" || !moveId.trim()) return null;
        return { type, payload: { move_id: moveId } };
      }
      return payload ? { type, payload } : { type };
    })
    .filter((x): x is { type: string; payload?: Record<string, unknown> } => x !== null);
}

/** Pull the rubric's dimension ids for the currently-bound action, used as
 * the default dim_ids when Judge's quality array is empty. */
function extractDimIds(
  rubricColumn: Record<string, Record<string, unknown>>,
  boundActionId: string | null
): string[] {
  if (!boundActionId) return [];
  const column = rubricColumn?.[boundActionId];
  if (!column) return [];
  return Object.keys(column);
}

/** For each dim, return the recent grade sequence (newest first) in the
 *  current challenge. Empty dims are omitted. */
function buildPerDimRecentGrades(
  learnerId: string,
  challengeId: string
): Record<string, Grade[]> {
  const entries = listEvidence(learnerId, 20).filter(
    (e) => e.challenge_id === challengeId
  );
  // listEvidence is newest-first per the SQL (ORDER BY id DESC) — keep that.
  const out: Record<string, Grade[]> = {};
  for (const e of entries) {
    for (const [dim, grade] of Object.entries(e.grades)) {
      if (!out[dim]) out[dim] = [];
      out[dim].push(grade);
    }
  }
  return out;
}

function countLearnerTurns(learnerId: string): number {
  if (conversationCount(learnerId) === 0) return 0;
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM conversation_log WHERE learner_id = ? AND role = 'learner'`
    )
    .get(learnerId) as { n: number };
  return r.n;
}

export const DEFAULT_ACTION_SPACE_RULES = `
- 质量达标 → advance
- 质量不达标第1次 → retry（简短反馈，允许重试）
- 质量不达标连续≥2次 → scaffold（降低认知负荷的支持）
- scaffold 后仍不达标 → branch（降级路径或替代任务）
- 跳过挑战 → branch(skip_to_next)，不给积分
- 回看/重做 → advance（replay 模式），可恢复衰减积分
- 请求兑换伴学 → advance + UNLOCK_CHECK 事件
- 自由探索 → advance（若相关）或 retry（温和引导）
- 主动求助 → scaffold，不扣积分
- 破冰期（learner_total_turns ≤ 2）学员表达困惑 → 必须 scaffold + form=concrete_analogy/step_breakdown，directive 先补背景
`;
