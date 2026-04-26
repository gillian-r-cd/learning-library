// Learning phase runtime: the single-turn flow from learner input to merged render.
// This is the orchestration layer (PRD §6.3.5).

import { randomUUID } from "node:crypto";
import {
  buildSnapshot,
  applyJudgeOutput,
  listEvidence,
  appendConversation,
  latestConversationEntries,
  writeImmersiveOpening,
  saveLearnerState,
} from "@/lib/state-manager";
import { runJudge, DEFAULT_ACTION_SPACE_RULES } from "@/lib/judge";
import { runNarrator } from "@/lib/narrator";
import { briefForArtifact, toStructuredRecentTurn } from "@/lib/narrator/context";
import type { NarratorRecentTurn } from "@/lib/narrator";
import type { ArtifactBrief } from "@/lib/narrator/context";
import { runCompanions, type CompanionSpeech } from "@/lib/companions";
import {
  dropByEvent,
  dropChallengeEnterArtifacts,
} from "@/lib/learning-runtime/artifact-drop";
import { buildSceneJournal } from "@/lib/learning-runtime/scene-journal";
import { matchActiveCompanionHooks } from "@/lib/learning-runtime/companion-hooks";
import { recomputeCompanionLevels } from "@/lib/learning-runtime/companion-upgrades";
import { awardSignatureMove } from "@/lib/learning-runtime/signature-moves";
import { generateChapterManifesto } from "@/lib/learning-runtime/manifesto";
import { getBlueprint } from "@/lib/blueprint";
import { getLearnerState } from "@/lib/state-manager";
import type {
  ArtifactDropMeta,
  ArtifactType,
  ConversationEntry,
  HelpRequest,
  JudgeOutput,
  LearnerStructuredResponse,
  ResponseFrame,
} from "@/lib/types/core";
import {
  buildLearnerStructuredResponse,
  validateStructuredResponse,
  type StructuredResponseInput,
} from "@/lib/learning-runtime/response-frames";

export interface DroppedArtifactSummary {
  artifact_id: string;
  version: number;
  name: string;
  type: ArtifactType;
  conversation_id: number;
}

export interface TurnResult {
  traceId: string;
  learnerInput: string;
  structuredResponse?: LearnerStructuredResponse | null;
  narratorText: string;
  companionSpeeches: CompanionSpeech[];
  judgeOutput: JudgeOutput;
  pointsEarned: number;
  newUnlocks: string[];
  newTotal: number;
  effectiveTotal: number;
  position: { chapter_id: string; challenge_id: string; turn_idx: number };
  /** If this turn moved the learner into a new challenge, the new scene's opening. */
  openingOfNewChallenge?: {
    chapter_id: string;
    challenge_id: string;
    title: string;
    setup: string;
  } | null;
  /** Artifacts dropped during this turn (Judge event + cross-challenge enter). */
  droppedArtifacts: DroppedArtifactSummary[];
  helpRequest?: { kind: HelpRequest["kind"]; pointsSpent: number } | null;
}

export async function runTurn(args: {
  learnerId: string;
  input?: string;
  response?: StructuredResponseInput;
  helpRequest?: HelpRequest;
  /** Optional recent turns for Narrator context. If omitted, pulled from the
   * persisted conversation_log so callers don't have to reconstruct it. */
  recentTurns?: { role: "learner" | "narrator" | "companion"; text: string }[];
}): Promise<TurnResult> {
  const traceId = `trc_${randomUUID().slice(0, 8)}`;

  // 1. Build snapshot (State Manager read)
  const snapshot = buildSnapshot(args.learnerId);
  const preTurnPosition = { ...snapshot.learner.position };
  const structuredResponse = args.response
    ? buildValidatedStructuredResponse(snapshot.active_response_frame, args.response)
    : null;
  const helpRequestMeta = args.helpRequest
    ? {
        kind: args.helpRequest.kind,
        pointsSpent: helpRequestCost(args.helpRequest.kind),
      }
    : null;
  const learnerInput =
    structuredResponse?.canonical_text ??
    args.input ??
    (args.helpRequest ? helpRequestInput(args.helpRequest.kind) : "");

  // 2. Evidence summary (simple: latest 3 evidence joined)
  const evidence = listEvidence(args.learnerId, 3);
  const evidenceSummary = evidence.map((e) => e.evidence).join(" / ");

  // 2b. Persist the learner's input BEFORE calling any LLM, so the transcript
  //     is complete even if Judge/Narrator fails.
  appendConversation({
    learner_id: args.learnerId,
    turn_idx: preTurnPosition.turn_idx,
    chapter_id: preTurnPosition.chapter_id,
    challenge_id: preTurnPosition.challenge_id,
    role: "learner",
    text: learnerInput,
    trace_id: traceId,
    meta: structuredResponse
      ? {
          kind: "learner_response",
          response_frame: {
            frame_id: structuredResponse.frame_id,
            frame_version: structuredResponse.frame_version,
            kind: structuredResponse.kind,
          },
          structured_response: {
            values: structuredResponse.values,
            canonical_text: structuredResponse.canonical_text,
          },
        }
      : null,
  });

  // 3. Judge — now also carries the current challenge's companion_hooks
  //    matched against active companions. Judge uses these to decide which
  //    companion to dispatch AND to author a richer directive per hook.
  const bpForHooks = getBlueprint(snapshot.learner.blueprint_id);
  const activeCompanionHooks = bpForHooks
    ? matchActiveCompanionHooks({
        blueprint: bpForHooks,
        challengeId: preTurnPosition.challenge_id,
        learner: snapshot.learner,
      })
    : [];
  const judgeRes = await runJudge({
    snapshot,
    learnerInput,
    evidenceSummary,
    actionSpaceRules: DEFAULT_ACTION_SPACE_RULES,
    traceId,
    activeCompanionHooks,
    helpRequest: args.helpRequest ?? null,
  });

  // 4. Apply Judge → State Manager update (every access defensively chained).
  const actionId = snapshot.current_challenge?.binds_actions?.[0] ?? "a1";
  const complexity = snapshot.current_challenge?.complexity ?? "low";
  const qualityList = Array.isArray(judgeRes.output.quality)
    ? judgeRes.output.quality
    : [];
  const grades: Record<string, "good" | "medium" | "poor"> = {};
  for (const q of qualityList) {
    if (q?.dim_id && q?.grade) grades[q.dim_id] = q.grade;
  }
  if (Object.keys(grades).length === 0) {
    // Fallback: record a single medium so downstream math doesn't blow up.
    grades["d1"] = "medium";
  }

  // Scaffold audit: tag this evidence row with the strategy Judge chose and
  // whether the learner was under scaffolding assistance. This drives the
  // per-strategy rebound-rate metric (admin panel).
  const pathType = judgeRes.output.path_decision.type;
  const scaffoldStrategyThisTurn =
    (pathType === "scaffold" ||
    pathType === "simplify_challenge" ||
    pathType === "reveal_answer_and_advance")
      ? judgeRes.output.path_decision.scaffold_spec?.strategy ?? null
      : null;
  const scaffoldAssistedThisTurn =
    pathType === "scaffold" ||
    pathType === "simplify_challenge" ||
    pathType === "reveal_answer_and_advance";
  // Quotable aggregate: if any quality entry has quotable=true, flag the row.
  const quotableThisTurn = (judgeRes.output.quality ?? []).some(
    (q) => q?.quotable === true
  );

  const applied = applyJudgeOutput({
    learnerId: args.learnerId,
    grades,
    actionId,
    evidence: judgeRes.output.quality.map((q) => q.evidence).join(" "),
    complexity,
    decisionType: judgeRes.output.path_decision.type,
    scaffoldStrategy: scaffoldStrategyThisTurn,
    scaffoldAssisted: scaffoldAssistedThisTurn,
    quotable: quotableThisTurn,
  });

  if (helpRequestMeta && helpRequestMeta.pointsSpent > 0) {
    const before = applied.state.points.total;
    applied.state.points.total = Math.max(0, Math.round((before - helpRequestMeta.pointsSpent) * 10) / 10);
    saveLearnerState(applied.state);
    appendConversation({
      learner_id: args.learnerId,
      turn_idx: preTurnPosition.turn_idx,
      chapter_id: preTurnPosition.chapter_id,
      challenge_id: preTurnPosition.challenge_id,
      role: "system",
      who: "help",
      text: `使用求助：${helpRequestLabel(helpRequestMeta.kind)} · -${Math.min(before, helpRequestMeta.pointsSpent)} 点`,
      trace_id: traceId,
      meta: {
        kind: "help_spent",
        help_kind: helpRequestMeta.kind,
        points_spent: helpRequestMeta.pointsSpent,
        total_points: applied.state.points.total,
      },
    });
  }

  const nextFrameSelection = deriveDynamicNextResponseFrameSelection(
    judgeRes.output.next_response_frame,
    judgeRes.output.diagnosis?.missing_field_ids ?? [],
    snapshot.active_response_frame
  );
  if (
    nextFrameSelection &&
    !applied.advancedToNewChallenge &&
    snapshot.response_frames.some((frame) => frame.frame_id === nextFrameSelection.frame_id)
  ) {
    applied.state.active_response_frame = {
      challenge_id: applied.state.position.challenge_id,
      selection: nextFrameSelection,
    };
    saveLearnerState(applied.state);
  }

  // 5a. Process AWARD_SIGNATURE_MOVE events (subjective ability tracking).
  //     Must happen before Narrator so if the move produced a system bubble,
  //     it appears above the Narrator turn response.
  const bpForMoves = getBlueprint(snapshot.learner.blueprint_id);
  if (bpForMoves) {
    for (const ev of judgeRes.output.event_triggers ?? []) {
      if (ev?.type !== "AWARD_SIGNATURE_MOVE") continue;
      const moveId = (ev.payload as { move_id?: string } | undefined)?.move_id;
      if (!moveId) continue;
      const stateForMove = getLearnerState(args.learnerId);
      if (!stateForMove) continue;
      awardSignatureMove({
        learner: stateForMove,
        bp: bpForMoves,
        moveId,
        triggeringQuote: learnerInput,
        challengeId: preTurnPosition.challenge_id,
        turnIdx: preTurnPosition.turn_idx,
        chapterId: preTurnPosition.chapter_id,
        traceId,
      });
    }
  }

  // 5b. Process DROP_ARTIFACT events BEFORE Narrator. Narrator needs to see the
  //    newly dropped artifact in order to naturally reference it (rule #3 in
  //    narrator.template). Events are written to conversation_log first; the
  //    artifact bubble then appears ABOVE the narrator reply, matching UX.
  const droppedThisTurn: DroppedArtifactSummary[] = [];
  const newlyDroppedBriefs: ArtifactBrief[] = [];
  const events = Array.isArray(judgeRes.output.event_triggers)
    ? judgeRes.output.event_triggers
    : [];
  for (const ev of events) {
    if (ev?.type !== "DROP_ARTIFACT") continue;
    const artifactId = (ev.payload as { artifact_id?: string } | undefined)?.artifact_id;
    if (!artifactId || typeof artifactId !== "string") continue;
    const entry = dropByEvent({
      learnerId: args.learnerId,
      blueprintId: snapshot.learner.blueprint_id,
      chapterId: preTurnPosition.chapter_id,
      challengeId: preTurnPosition.challenge_id,
      turnIdx: preTurnPosition.turn_idx,
      artifactId,
      traceId,
      triggerSource: "judge_event",
    });
    if (entry) {
      droppedThisTurn.push(conversationEntryToDropSummary(entry));
      const brief = conversationEntryToBrief(entry);
      if (brief) newlyDroppedBriefs.push(brief);
    }
  }

  // 6. Narrator + Companions in parallel. Narrator now gets the full Judge
  //    output (quality grades, path_decision, companion_dispatch) + the briefs
  //    of artifacts dropped this turn so it can ground its prose.
  //
  //    recent_turns takes the TRULY latest entries via latestConversationEntries
  //    (not `listConversation({limit:N}).slice(-N)` which returned the oldest
  //    rows and caused the cross-challenge context-bleed bug).
  //
  //    We also filter out entries from the previous challenge: if this turn is
  //    happening inside `challenge_id=X`, we only keep recent turns that also
  //    belong to challenge X, walking back only as far as the nearest
  //    `challenge_opening` marker for X. This prevents Narrator from echoing
  //    the previous challenge's characters or rubric after a complete_challenge
  //    transition.
  const rawRecent = latestConversationEntries(args.learnerId, 12);
  const currentChallengeId = preTurnPosition.challenge_id;
  const trimmedRecent = trimRecentToCurrentChallenge(rawRecent, currentChallengeId);
  const recentTurns: NarratorRecentTurn[] =
    args.recentTurns?.map((t) => ({
      role: t.role,
      text: t.text,
    })) ??
    trimmedRecent.slice(-6).map((e) => {
      const structured = toStructuredRecentTurn(e);
      return {
        role: structured.role as NarratorRecentTurn["role"],
        who: structured.who,
        meta_kind: structured.meta_kind,
        text: structured.text,
      };
    });
  // Build the scene journal for the current challenge. Narrator uses this
  // for its nameable_characters whitelist + played_challenges_recap.
  const bpForJournal = bpForHooks; // same blueprint, rename for readability
  const sceneJournal = bpForJournal
    ? buildSceneJournal({
        learnerId: args.learnerId,
        blueprint: bpForJournal,
        learner: snapshot.learner,
        currentChapterId: preTurnPosition.chapter_id,
        currentChallengeId: preTurnPosition.challenge_id,
      })
    : null;

  const [narrator, companionSpeeches] = await Promise.all([
    runNarrator({
      snapshot,
      judgeOutput: judgeRes.output,
      learnerInput,
      recentTurns,
      newlyDroppedArtifacts: newlyDroppedBriefs,
      sceneJournal,
      challengeCompanionHooks: activeCompanionHooks,
      traceId,
      parentSpanId: judgeRes.callId,
    }),
    runCompanions({
      snapshot,
      dispatch: judgeRes.output.companion_dispatch,
      challengeCompanionHooks: activeCompanionHooks,
      scaffoldStrategy: scaffoldStrategyThisTurn,
      traceId,
      parentSpanId: judgeRes.callId,
    }),
  ]);

  // 6. Persist Narrator / Companion / Unlock / Cross-challenge-transition bubbles.
  //    Use the pre-turn position for these replies (they are the system's response
  //    to the learner's action in the old challenge).
  appendConversation({
    learner_id: args.learnerId,
    turn_idx: preTurnPosition.turn_idx,
    chapter_id: preTurnPosition.chapter_id,
    challenge_id: preTurnPosition.challenge_id,
    role: "narrator",
    text: narrator.text,
    trace_id: traceId,
    meta: scaffoldStrategyThisTurn
      ? {
          kind: "scaffold",
          strategy: scaffoldStrategyThisTurn,
          path_decision: pathType,
        }
      : null,
  });
  if (applied.pointsEarned > 0) {
    appendConversation({
      learner_id: args.learnerId,
      turn_idx: preTurnPosition.turn_idx,
      chapter_id: preTurnPosition.chapter_id,
      challenge_id: preTurnPosition.challenge_id,
      role: "system",
      who: "points",
      text: `+${applied.pointsEarned} 分 · 累计 ${applied.state.points.total} 分`,
      trace_id: traceId,
      meta: {
        kind: "points_awarded",
        points_earned: applied.pointsEarned,
        total_points: applied.state.points.total,
        effective_total_before_refresh: snapshot.effective_total,
        primary_reason: firstJudgeEvidence(judgeRes.output),
      },
    });
  }
  for (const c of companionSpeeches) {
    appendConversation({
      learner_id: args.learnerId,
      turn_idx: preTurnPosition.turn_idx,
      chapter_id: preTurnPosition.chapter_id,
      challenge_id: preTurnPosition.challenge_id,
      role: "companion",
      who: c.display_name,
      text: c.text,
      trace_id: traceId,
      meta: { companion_id: c.companion_id, format: c.format },
    });
  }
  if (applied.newUnlocks.length > 0) {
    appendConversation({
      learner_id: args.learnerId,
      turn_idx: preTurnPosition.turn_idx,
      chapter_id: preTurnPosition.chapter_id,
      challenge_id: preTurnPosition.challenge_id,
      role: "system",
      who: "unlock",
      text: `🎉 解锁了：${applied.newUnlocks.join(", ")}`,
      trace_id: traceId,
      meta: { kind: "unlock", companion_ids: applied.newUnlocks },
    });
  }

  // Cross-challenge transition CEREMONY — only when Judge decided
  // `complete_challenge`. Three explicit beats so the learner feels a clean
  // close, a system milestone, then a new opening (not a chopped-up jump).
  if (applied.completedChallenge && applied.advancedToNewChallenge) {
    const closed = applied.completedChallenge;
    const next = applied.advancedToNewChallenge;
    const milestoneLine = closed.milestone_summary
      ? `（里程碑：${closed.milestone_summary}）`
      : "";
    appendConversation({
      learner_id: args.learnerId,
      turn_idx: preTurnPosition.turn_idx,
      chapter_id: preTurnPosition.chapter_id,
      challenge_id: preTurnPosition.challenge_id,
      role: "system",
      who: "milestone",
      text:
        `✅ 挑战完成：${closed.chapter_title} · ${closed.challenge_title}\n` +
        `${milestoneLine}\n` +
        `+${applied.pointsEarned} 分 · 共 ${applied.state.points.total} 分`,
      trace_id: traceId,
      meta: {
        kind: "challenge_completed",
        chapter_id: closed.chapter_id,
        challenge_id: closed.challenge_id,
      },
    });
    // If this completion closes a whole CHAPTER (the next challenge belongs
    // to a different chapter_id), generate the chapter manifesto — woven
    // from the learner's own quotable utterances across the chapter.
    if (closed.chapter_id !== next.chapter_id) {
      try {
        await generateChapterManifesto({
          learnerId: args.learnerId,
          blueprintId: snapshot.learner.blueprint_id,
          chapterId: closed.chapter_id,
          traceId,
        });
      } catch (err) {
        // Manifesto failure should NEVER block the transition. Log + continue.
        console.warn("[runTurn] manifesto generation failed (non-fatal):", err);
      }
    }
    // LLM-generated immersive opening for the new challenge (cross_challenge
    // variant). Replaces the static "【${title}】${setup}" template.
    //
    // writeImmersiveOpening internally builds a fresh SceneJournal for the
    // NEW challenge position so the opening knows what the learner actually
    // played through + which characters are nameable (no more inventing
    // "and your talk with 陈悦...").
    await writeImmersiveOpening(
      args.learnerId,
      snapshot.learner.blueprint_id,
      {
        chapter_id: next.chapter_id,
        challenge_id: next.challenge_id,
        turn_idx: 0,
      },
      "cross_challenge",
      {
        title: closed.challenge_title,
        milestone: closed.milestone_summary,
      }
    );
    // Then drop the new challenge's on_challenge_enter artifacts.
    const crossDrops = dropChallengeEnterArtifacts({
      learnerId: args.learnerId,
      blueprintId: snapshot.learner.blueprint_id,
      chapterId: next.chapter_id,
      challengeId: next.challenge_id,
      turnIdx: 0,
      traceId,
    });
    for (const d of crossDrops) droppedThisTurn.push(conversationEntryToDropSummary(d));
  }

  // Upgrade-path recompute: derives each unlocked companion's level from
  // their cumulative speech count and writes a "✨ 升级" bubble when any
  // threshold is crossed. This is where upgrade_path becomes visible.
  const latestLearnerState = getLearnerState(args.learnerId);
  const bpForUpgrades = getBlueprint(snapshot.learner.blueprint_id);
  if (latestLearnerState && bpForUpgrades) {
    recomputeCompanionLevels({
      learnerId: args.learnerId,
      learner: latestLearnerState,
      blueprint: bpForUpgrades,
      turnIdx: preTurnPosition.turn_idx,
      chapterId: latestLearnerState.position.chapter_id,
      challengeId: latestLearnerState.position.challenge_id,
      traceId,
    });
  }

  // Fresh snapshot to report new effective total (with updated points/decay)
  const freshSnap = buildSnapshot(args.learnerId);

  return {
    traceId,
    learnerInput,
    structuredResponse,
    narratorText: narrator.text,
    companionSpeeches,
    judgeOutput: judgeRes.output,
    pointsEarned: applied.pointsEarned,
    newUnlocks: applied.newUnlocks,
    newTotal: applied.state.points.total,
    effectiveTotal: freshSnap.effective_total,
    position: applied.state.position,
    openingOfNewChallenge: applied.advancedToNewChallenge,
    droppedArtifacts: droppedThisTurn,
    helpRequest: helpRequestMeta,
  };
}

function deriveDynamicNextResponseFrameSelection(
  selected: import("@/lib/types/core").NextResponseFrameSelection | null | undefined,
  missingFieldIds: string[],
  activeFrame: ResponseFrame
): import("@/lib/types/core").NextResponseFrameSelection | null {
  const usableMissingFields = missingFieldIds.filter((fieldId) =>
    activeFrame.fields.some((field) => field.field_id === fieldId)
  );
  if (selected) {
    return selected.field_ids?.length || usableMissingFields.length === 0
      ? selected
      : { ...selected, field_ids: usableMissingFields };
  }
  if (
    activeFrame.kind !== "free_text" &&
    usableMissingFields.length > 0 &&
    usableMissingFields.length < activeFrame.fields.length
  ) {
    return {
      frame_id: activeFrame.frame_id,
      reason: "只追问本轮诊断出的缺口，避免要求学员重填已达标字段。",
      field_ids: usableMissingFields,
      overrides: {
        title: "只补还缺的部分",
        prompt: "前面已经成立的内容不用重填，这轮只补下面这些缺口。",
      },
    };
  }
  return selected ?? null;
}

function helpRequestCost(kind: HelpRequest["kind"]): number {
  if (kind === "hint") return 1;
  if (kind === "example") return 2;
  return 4;
}

function helpRequestLabel(kind: HelpRequest["kind"]): string {
  if (kind === "hint") return "给一点提示";
  if (kind === "example") return "看一个范例";
  return "揭晓并继续";
}

function helpRequestInput(kind: HelpRequest["kind"]): string {
  if (kind === "hint") return "我想花 1 点换一个提示。";
  if (kind === "example") return "我想花 2 点看一个范例。";
  return "我想花 4 点揭晓答案并继续。";
}

function conversationEntryToDropSummary(entry: ConversationEntry): DroppedArtifactSummary {
  const m = (entry.meta ?? {}) as {
    artifact_id?: string;
    version?: number;
    type?: ArtifactType;
  };
  return {
    artifact_id: m.artifact_id ?? "",
    version: m.version ?? 1,
    name: entry.who ?? m.artifact_id ?? "",
    type: (m.type as ArtifactType) ?? "narrative",
    conversation_id: entry.id,
  };
}

function buildValidatedStructuredResponse(
  frame: ResponseFrame,
  response: StructuredResponseInput
): LearnerStructuredResponse {
  const validation = validateStructuredResponse(frame, response);
  if (!validation.ok) {
    throw new Error(`structured response invalid: ${validation.errors.join("; ")}`);
  }
  return buildLearnerStructuredResponse(frame, response);
}

function firstJudgeEvidence(output: JudgeOutput): string {
  return output.quality.find((q) => q.evidence?.trim())?.evidence ?? "你完成了一次有效练习。";
}

/** Keep only the tail of `entries` that belongs to the current challenge.
 *
 *  After a `complete_challenge` transition, conversation_log retains the old
 *  challenge's bubbles. Feeding them to the Narrator for the NEW challenge
 *  causes cross-challenge context leak (Narrator echoes the previous scene's
 *  characters/rubric). We anchor on `challenge_id` per entry: walk forward and
 *  keep only entries whose `challenge_id` matches the current one.
 *
 *  Degenerate cases:
 *   - If NO entries match (e.g. the very first turn of a new challenge before
 *     the opening is persisted), return the original list — Narrator still
 *     needs some context.
 *   - Entries with `challenge_id === null` (some system rows) are passed
 *     through as neutral (kept when adjacent to matching entries). */
function trimRecentToCurrentChallenge(
  entries: ConversationEntry[],
  currentChallengeId: string | null
): ConversationEntry[] {
  if (!currentChallengeId) return entries;
  // Find the first entry index whose challenge_id matches the current one
  // (or is null — null-bearing rows are not from a prior challenge, they are
  // global system notices — keep them through).
  const firstMatch = entries.findIndex(
    (e) => e.challenge_id === currentChallengeId
  );
  if (firstMatch < 0) return entries;
  return entries.slice(firstMatch);
}

function conversationEntryToBrief(entry: ConversationEntry): ArtifactBrief | null {
  const m = entry.meta as ArtifactDropMeta | null;
  if (!m || m.kind !== "artifact_drop") return null;
  return briefForArtifact({
    artifact_id: m.artifact_id,
    name: entry.who ?? m.artifact_id,
    type: m.type,
    version: m.version,
    content: m.content,
  });
}
