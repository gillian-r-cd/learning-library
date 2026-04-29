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
  writeEvidence,
  getOrInitLadderProgress,
  incrementLadderAdvances,
  escalateLadderPosition,
  incrementSameRungAttempts,
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
  shouldEscalateLadder,
  type StructuredResponseInput,
} from "@/lib/learning-runtime/response-frames";
import {
  findFrameOption,
  isOffTargetOption,
  pickMisreadingForOption,
  pickMisreadingFromJudge,
  shouldEnterReviewFromJudge,
} from "@/lib/learning-runtime/rung-review";

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

  // 3a. Pre-compute the rung the learner is currently sitting on. This is
  //     the rung Judge / runtime grade against; the post-turn rung
  //     (which is what Narrator will introduce next) is recomputed after
  //     bookkeeping further below.
  //
  //     If the learner hasn't initialised ladder_progress yet (first turn of
  //     a fresh challenge), fall back to the challenge's
  //     default_ladder_position so off_target short-circuit can still fire.
  const challengeAtTurnEntry = bpForHooks?.step3_script?.chapters
    .find((c) => c.chapter_id === preTurnPosition.chapter_id)
    ?.challenges.find((c) => c.challenge_id === preTurnPosition.challenge_id);
  const ladderAtTurnEntry = challengeAtTurnEntry?.scaffold_ladder;
  const ladderProgressAtTurnEntry =
    snapshot.learner.ladder_progress?.[preTurnPosition.challenge_id] ?? null;
  const rungAtTurnEntryPosition =
    ladderProgressAtTurnEntry?.position ??
    challengeAtTurnEntry?.default_ladder_position ??
    0;
  const rungAtTurnEntry: import("@/lib/types/core").ScaffoldLadderRung | null =
    ladderAtTurnEntry && ladderAtTurnEntry.length > 0
      ? ladderAtTurnEntry[
          Math.min(Math.max(rungAtTurnEntryPosition, 0), ladderAtTurnEntry.length - 1)
        ] ?? null
      : null;

  // 3b. Branching paths into Judge:
  //   (i)   narrative_choice + structured response → synth narrative_advance.
  //   (ii)  single_choice rung where the learner picked an off_target option →
  //         synth enter_review (skip Judge LLM; runtime owns the routing).
  //   (iii) anything else → run Judge LLM normally.
  const activeFrame = snapshot.active_response_frame;
  const isNarrativeChoice =
    activeFrame?.kind === "narrative_choice" && !!structuredResponse;
  const offTargetOptionPick =
    !isNarrativeChoice &&
    activeFrame?.kind === "single_choice" &&
    !!structuredResponse
      ? findFrameOption(activeFrame, structuredResponse.values?.choice)
      : null;
  const isOffTargetShortCircuit =
    rungAtTurnEntry?.kind === "single_choice" &&
    !!rungAtTurnEntry.model_judgment &&
    isOffTargetOption(offTargetOptionPick);
  let chosenNarrativePayoff = "";
  /** Set to non-empty by either the off_target short-circuit OR the post-Judge
   *  upgrade path; consumed by Narrator dispatch a few blocks below. */
  let reviewModelJudgment = "";
  let reviewSelectedMisreading = "";
  let judgeRes: { output: JudgeOutput; callId: string; traceId: string };
  if (isNarrativeChoice) {
    const choiceField = activeFrame.fields?.find((f) => f.field_id === "choice");
    const chosenValue = String(structuredResponse?.values?.choice ?? "");
    const option = choiceField?.options?.find((o) => o.value === chosenValue);
    chosenNarrativePayoff = String(option?.narrative_payoff ?? "");
    const cogTag = option?.cognitive_signal?.tag ?? "ambiguous";
    judgeRes = {
      output: {
        quality: [],
        diagnosis: {
          stuck_reason: "none",
          evidence: `narrative_advance · option=${chosenValue} · signal=${cogTag}`,
          focus_dim_ids: [],
          missing_field_ids: [],
          confidence: "low",
        },
        path_decision: {
          type: "narrative_advance",
          target: null,
          scaffold_spec: null,
        },
        narrator_directive: "",
        companion_dispatch: [],
        event_triggers: [],
        next_response_frame: null,
      },
      callId: `synth_narrative_advance_${randomUUID().slice(0, 6)}`,
      traceId,
    };
  } else if (isOffTargetShortCircuit && offTargetOptionPick && rungAtTurnEntry) {
    const picked = pickMisreadingForOption({
      rung: rungAtTurnEntry,
      option: offTargetOptionPick,
    });
    reviewModelJudgment = rungAtTurnEntry.model_judgment ?? "";
    reviewSelectedMisreading = picked.description;
    const optionDimHint =
      offTargetOptionPick.cognitive_signal?.tag ??
      rungAtTurnEntry.common_misreadings?.[0]?.dim_id ??
      "d1";
    judgeRes = {
      output: {
        quality: [
          {
            dim_id: optionDimHint,
            grade: "poor",
            evidence: `learner picked off_target option ${offTargetOptionPick.value}`,
          },
        ],
        diagnosis: {
          stuck_reason: "concept_confusion",
          evidence: `enter_review · off_target · option=${offTargetOptionPick.value} · misreading_source=${picked.reason}`,
          focus_dim_ids: [optionDimHint],
          missing_field_ids: [],
          confidence: "high",
        },
        path_decision: {
          type: "enter_review",
          target: null,
          scaffold_spec: null,
        },
        narrator_directive: "",
        companion_dispatch: [],
        event_triggers: [],
        next_response_frame: null,
      },
      callId: `synth_enter_review_${randomUUID().slice(0, 6)}`,
      traceId,
    };
  } else {
    judgeRes = await runJudge({
      snapshot,
      learnerInput,
      evidenceSummary,
      actionSpaceRules: DEFAULT_ACTION_SPACE_RULES,
      traceId,
      activeCompanionHooks,
      helpRequest: args.helpRequest ?? null,
    });
    // Post-Judge upgrade: form / free_text rungs that have been missed twice
    // in a row should be flipped from {retry|scaffold} → enter_review so
    // Narrator gives the answer instead of more hinting.
    const sameRungAttemptsIncludingThisTurn =
      (ladderProgressAtTurnEntry?.same_rung_attempts ?? 0) + 1;
    if (
      shouldEnterReviewFromJudge({
        rung: rungAtTurnEntry,
        judgeOutput: judgeRes.output,
        sameRungAttemptsIncludingThisTurn,
      }) &&
      rungAtTurnEntry
    ) {
      const picked = pickMisreadingFromJudge({
        rung: rungAtTurnEntry,
        judgeOutput: judgeRes.output,
      });
      reviewModelJudgment = rungAtTurnEntry.model_judgment ?? "";
      reviewSelectedMisreading = picked.description;
      judgeRes = {
        ...judgeRes,
        output: {
          ...judgeRes.output,
          path_decision: {
            type: "enter_review",
            target: null,
            scaffold_spec: null,
          },
          diagnosis: {
            ...judgeRes.output.diagnosis,
            evidence:
              `enter_review · attempts=${sameRungAttemptsIncludingThisTurn} · misreading_source=${picked.reason}`,
          },
          companion_dispatch: [],
          event_triggers: [],
        },
      };
    }
  }

  // 3b. Ladder gating on complete_challenge: if Judge wants to close the
  // challenge but the learner hasn't reached the ladder's terminal rung yet,
  // demote complete_challenge → advance so the ladder still gets to walk
  // through its remaining rungs (e.g., single_choice classification before
  // free_text synthesis). Without this, Judge tends to fire complete_challenge
  // on the first good form submission, skipping the rest of the ladder.
  if (judgeRes.output.path_decision.type === "complete_challenge") {
    const stateForGate = getLearnerState(args.learnerId);
    const challengeForGate = bpForHooks?.step3_script?.chapters
      .find((c) => c.chapter_id === preTurnPosition.chapter_id)
      ?.challenges.find((c) => c.challenge_id === preTurnPosition.challenge_id);
    const ladderForGate = challengeForGate?.scaffold_ladder;
    const progressForGate = stateForGate?.ladder_progress?.[preTurnPosition.challenge_id];
    if (
      ladderForGate &&
      ladderForGate.length > 0 &&
      progressForGate &&
      progressForGate.position < ladderForGate.length - 1
    ) {
      // Convert to a regular advance; the ladder bookkeeping at the end of
      // runTurn will then evaluate gate_to_next and possibly escalate.
      judgeRes = {
        ...judgeRes,
        output: {
          ...judgeRes.output,
          path_decision: { ...judgeRes.output.path_decision, type: "advance" },
        },
      };
    }
  }

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
  if (Object.keys(grades).length === 0 && judgeRes.output.path_decision.type !== "narrative_advance") {
    // Fallback: record a single medium so downstream math doesn't blow up.
    grades["d1"] = "medium";
  }

  // narrative_advance light evidence row — written here (not by applyJudgeOutput
  // since it short-circuits). Carries the option's cognitive_signal so admin
  // analytics can see what the learner was leaning toward, but no grade.
  if (judgeRes.output.path_decision.type === "narrative_advance") {
    writeEvidence({
      learner_id: args.learnerId,
      ts: new Date().toISOString(),
      challenge_id: preTurnPosition.challenge_id,
      action_id: actionId,
      turn_idx: preTurnPosition.turn_idx,
      grades: {},
      evidence: judgeRes.output.diagnosis?.evidence ?? "narrative_advance",
      points_earned: 0,
      complexity,
      scaffold_strategy: null,
      scaffold_assisted: null,
      quotable: null,
    });
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
  // Ladder is authoritative when present. Judge's next_response_frame
  // selection should NOT skip ladder rungs. Allow Judge to override only
  // when (a) the challenge has no ladder, or (b) Judge is doing scaffolding
  // (path is scaffold / simplify_challenge / reveal_answer_and_advance) so it
  // legitimately needs to fall back to a structured frame.
  const _challengeForLadderCheck = bpForHooks?.step3_script?.chapters
    .find((c) => c.chapter_id === preTurnPosition.chapter_id)
    ?.challenges.find((c) => c.challenge_id === preTurnPosition.challenge_id);
  const challengeHasLadder = !!(
    _challengeForLadderCheck?.scaffold_ladder &&
    _challengeForLadderCheck.scaffold_ladder.length > 0
  );
  const judgeIsScaffolding =
    judgeRes.output.path_decision.type === "scaffold" ||
    judgeRes.output.path_decision.type === "simplify_challenge" ||
    judgeRes.output.path_decision.type === "reveal_answer_and_advance";
  const allowJudgeFrameOverride = !challengeHasLadder || judgeIsScaffolding;
  if (
    allowJudgeFrameOverride &&
    nextFrameSelection &&
    !applied.advancedToNewChallenge &&
    snapshot.response_frames.some((frame) => frame.frame_id === nextFrameSelection.frame_id)
  ) {
    applied.state.active_response_frame = {
      challenge_id: applied.state.position.challenge_id,
      selection: nextFrameSelection,
    };
    saveLearnerState(applied.state);
  } else if (challengeHasLadder && !judgeIsScaffolding) {
    // Clear any stale Judge-driven selection so the ladder rung's frame wins
    // on the next snapshot (resolveLadderAwareFrame ranks explicit selection
    // first; we don't want Judge's "next_response_frame" to skip the rung).
    if (applied.state.active_response_frame?.challenge_id === applied.state.position.challenge_id) {
      applied.state.active_response_frame = null;
      saveLearnerState(applied.state);
    }
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

  // Scaffold ladder bookkeeping must happen BEFORE the narrator call so that
  // (a) the narrator sees the post-escalation rung's rung_question, and
  // (b) the "这一步交给你独立完成" handoff bubble lands above narrator.
  const bpForRung = bpForHooks; // alias, same blueprint
  const challengeForRung = bpForRung?.step3_script?.chapters
    .find((c) => c.chapter_id === preTurnPosition.chapter_id)
    ?.challenges.find((c) => c.challenge_id === preTurnPosition.challenge_id);
  if (challengeForRung?.scaffold_ladder && challengeForRung.scaffold_ladder.length > 0) {
    getOrInitLadderProgress(args.learnerId, challengeForRung);
    let progress =
      judgeRes.output.path_decision.type === "narrative_advance"
        ? incrementLadderAdvances(args.learnerId, preTurnPosition.challenge_id)
        : (getLearnerState(args.learnerId)?.ladder_progress ?? {})[preTurnPosition.challenge_id] ??
          null;
    // Track failed attempts at the same rung so the next miss can flip to
    // enter_review. Skip when the turn is itself an enter_review beat (we
    // escalate after the beat instead) or when the learner just earned a good.
    if (
      progress &&
      judgeRes.output.path_decision.type !== "narrative_advance" &&
      judgeRes.output.path_decision.type !== "enter_review"
    ) {
      const qualityList = judgeRes.output.quality ?? [];
      const earnedAnyGood =
        qualityList.length > 0 && qualityList.some((q) => q.grade === "good");
      if (!earnedAnyGood) {
        progress =
          incrementSameRungAttempts(
            args.learnerId,
            preTurnPosition.challenge_id
          ) ?? progress;
      }
    }
    // enter_review path: escalate the rung WITH partial_via_teach as the
    // completion kind. The learner was carried through this rung by the
    // explanation beat, so analytics records that fact and the next rung
    // becomes active before Narrator runs.
    if (progress && judgeRes.output.path_decision.type === "enter_review") {
      const isLastRung = progress.position >= (challengeForRung.scaffold_ladder.length - 1);
      if (!isLastRung) {
        const escalated = escalateLadderPosition(
          args.learnerId,
          preTurnPosition.challenge_id,
          "partial_via_teach"
        );
        if (escalated) progress = escalated;
      }
    }
    if (progress) {
      const currentRungPre = challengeForRung.scaffold_ladder[progress.position];
      const stateNow = getLearnerState(args.learnerId);
      const masteryNow = stateNow?.action_mastery?.[progress.action_id] ?? undefined;
      if (currentRungPre && shouldEscalateLadder(currentRungPre, progress, masteryNow)) {
        const escalated = escalateLadderPosition(args.learnerId, preTurnPosition.challenge_id);
        if (escalated && challengeForRung.scaffold_ladder[escalated.position]) {
          appendConversation({
            learner_id: args.learnerId,
            turn_idx: preTurnPosition.turn_idx,
            chapter_id: preTurnPosition.chapter_id,
            challenge_id: preTurnPosition.challenge_id,
            role: "system",
            who: "ladder",
            text: `这一步交给你独立完成。`,
            trace_id: traceId,
            meta: {
              kind: "ladder_escalation",
              from_position: progress.position,
              to_position: escalated.position,
              new_frame_id:
                challengeForRung.scaffold_ladder[escalated.position].frame_id,
            },
          });
          progress = escalated;
        }
      }
    }
  }

  // Now (post-escalation) resolve the rung that the learner will see NEXT.
  // narrator's rung_question is keyed off this rung, so its question matches
  // the input control the learner is about to interact with.
  const stateForRung = getLearnerState(args.learnerId);
  const rungProgress = stateForRung?.ladder_progress?.[preTurnPosition.challenge_id] ?? null;
  const currentRung =
    challengeForRung?.scaffold_ladder && rungProgress
      ? challengeForRung.scaffold_ladder[rungProgress.position] ?? null
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
      chosenNarrativePayoff: chosenNarrativePayoff || undefined,
      rungQuestion: currentRung?.rung_question || undefined,
      rungExpectedOutput: currentRung?.rung_expected_output || undefined,
      rungKind: currentRung?.kind || undefined,
      modelJudgment: reviewModelJudgment || undefined,
      selectedMisreading: reviewSelectedMisreading || undefined,
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

  // (Scaffold ladder bookkeeping was moved earlier — before narrator — so
  // narrator could see the post-escalation rung. Don't duplicate it here.)

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
