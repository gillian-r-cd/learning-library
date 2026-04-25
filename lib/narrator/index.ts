// Narrator (PRD §6.3.3)
//
// Two entry points:
//   - runNarratorOpening: produces the sole immersive scene-opening bubble
//     written once at createLearnerState and once at each cross-challenge
//     transition. Replaces the legacy 4-block static template.
//   - runNarrator: produces the per-turn learner-facing response, given full
//     Judge output, scene state (artifacts + characters), and the learner's
//     input. Includes a lightweight output validator.

import { llmCall } from "@/lib/llm";
import { getBlueprint } from "@/lib/blueprint";
import type { Snapshot } from "@/lib/state-manager";
import { listEvidence } from "@/lib/state-manager";
import { conversationCount } from "@/lib/state-manager/conversation";
import { db } from "@/lib/db";
import type { ConversationRole, JudgeOutput } from "@/lib/types/core";
import {
  briefsForPendingChallengeEnter,
  buildAllSeenArtifactBriefs,
  buildCharacterRegistry,
  extractCharactersFromArtifacts,
  getSignalsHitSoFar,
  lastNarratorResponseText,
  type ArtifactBrief,
  type CharacterRegistryEntry,
} from "@/lib/narrator/context";
import type { ActiveCompanionHook } from "@/lib/learning-runtime/companion-hooks";
import type { SceneJournal } from "@/lib/learning-runtime/scene-journal";
import { buildSceneJournal } from "@/lib/learning-runtime/scene-journal";
import { getLearnerState } from "@/lib/state-manager";

/** Structured recent-turn shape Narrator actually understands. */
export interface NarratorRecentTurn {
  role: ConversationRole;
  who?: string | null;
  meta_kind?: string | null;
  text: string;
}

// ============================================================================
// Opening (first & cross-challenge) — one LLM call, one narrator bubble
// ============================================================================

export interface NarratorOpeningArgs {
  learnerId: string;
  blueprintId: string;
  variant: "first" | "cross_challenge";
  chapterId: string;
  challengeId: string;
  /** For cross_challenge variant: what just closed. */
  previousChallenge?: {
    title: string;
    milestone?: string | null;
  };
  traceId: string;
  parentSpanId?: string;
}

export interface NarratorOpeningResult {
  text: string;
  callId: string;
  traceId: string;
}

/** Generate the single immersive opening bubble. Falls back to a minimal
 *  template if the LLM fails or returns something unusable, so learners never
 *  land on an empty transcript. */
export async function runNarratorOpening(
  args: NarratorOpeningArgs
): Promise<NarratorOpeningResult> {
  const bp = getBlueprint(args.blueprintId);
  if (!bp) {
    return {
      text: fallbackOpening(null, null, null, args.variant, "", ""),
      callId: "fallback_no_blueprint",
      traceId: args.traceId,
    };
  }
  const chapter = bp.step3_script?.chapters.find((c) => c.chapter_id === args.chapterId);
  const challenge = chapter?.challenges.find((c) => c.challenge_id === args.challengeId);
  const boundActionId = challenge?.binds_actions?.[0] ?? null;
  const boundAction = boundActionId
    ? bp.step1_gamecore?.core_actions.find((a) => a.action_id === boundActionId)
    : null;

  // Artifacts about to drop right after the opening — pre-reference them.
  const pendingBriefs = briefsForPendingChallengeEnter(bp, args.chapterId, args.challengeId);
  // Characters we can trust identities for (from those dropping artifacts).
  const charactersPreview = extractCharactersFromArtifacts(
    pendingBriefs.map((b) => ({ artifact_id: b.artifact_id, content: b.content }))
  );

  // Scene journal — the CRITICAL guardrail that tells the opening:
  //   1. Which characters the learner has ACTUALLY met (whitelist).
  //   2. What the learner actually DID in prior challenges (recap basis).
  // Without this, cross_challenge openings invented "你和陈悦那场谈话" when
  // 陈悦 was merely declared in chapter narrative_premise but never actually
  // interacted with. The whitelist + played_recap shuts that hallucination.
  const learner = getLearnerState(args.learnerId);
  const journal = learner
    ? buildSceneJournal({
        learnerId: args.learnerId,
        blueprint: bp,
        learner,
        currentChapterId: args.chapterId,
        currentChallengeId: args.challengeId,
      })
    : null;

  // Current arc_stage — drives voice/pacing modulation in the opening.
  const currentArcStage =
    chapter?.arc_stage_id
      ? bp.step3_script?.journey_meta?.arc_stages?.find(
          (s) => s.id === chapter.arc_stage_id
        ) ?? null
      : null;

  const res = await llmCall({
    caller: "narrator_opening",
    stage: "learning",
    traceId: args.traceId,
    parentSpanId: args.parentSpanId,
    learnerId: args.learnerId,
    blueprintId: args.blueprintId,
    userVisible: true,
    variables: {
      opening_variant: args.variant,
      topic: bp.topic ?? "",
      protagonist_role:
        bp.step3_script?.journey_meta?.protagonist_role ??
        `你是一名正在学习「${bp.topic ?? ""}」的实践者`,
      journey_goal: bp.step3_script?.journey_meta?.journey_goal ?? "",
      current_arc_stage: currentArcStage
        ? {
            name: currentArcStage.name,
            position: currentArcStage.position,
            signature_question: currentArcStage.signature_question,
            narrator_voice_hint: currentArcStage.narrator_voice_hint,
          }
        : null,
      chapter_title: chapter?.title ?? "",
      chapter_narrative_premise: chapter?.narrative_premise ?? "",
      chapter_milestone: chapter?.milestone?.summary ?? "",
      challenge_title: challenge?.title ?? "",
      challenge_complexity: challenge?.complexity ?? "low",
      challenge_setup: challenge?.trunk?.setup ?? "",
      challenge_expected_signals: challenge?.trunk?.expected_signals ?? [],
      challenge_action_prompts: challenge?.trunk?.action_prompts ?? [],
      core_action_description: boundAction
        ? `${boundAction.name}: ${boundAction.description}`
        : "",
      on_challenge_enter_artifacts: pendingBriefs.map((b) => ({
        name: b.name,
        type: b.type,
        summary: b.summary,
      })),
      characters_preview: charactersPreview,
      previous_challenge_title: args.previousChallenge?.title ?? "",
      previous_challenge_milestone: args.previousChallenge?.milestone ?? "",
      // Scene-journal guardrails:
      nameable_characters: journal?.nameable_characters ?? charactersPreview,
      played_challenges_recap: journal?.played_challenges_recap ?? [],
    },
  });

  const text = (res.text ?? "").trim();
  const validated = validateOpeningOutput(text, {
    variant: args.variant,
    artifactNames: pendingBriefs.map((b) => b.name),
    nameableCharacters: (journal?.nameable_characters ?? charactersPreview).map((c) => c.name),
    protagonistRole:
      bp.step3_script?.journey_meta?.protagonist_role ??
      `你是一名正在学习「${bp.topic ?? ""}」的实践者`,
    // All character names DECLARED in this blueprint — any name in text that's
    // blueprint-declared but NOT in the whitelist is an off-narrative reference.
    declaredCharacters: collectAllDeclaredCharacterNames(bp),
  });
  if (validated.ok) {
    return { text, callId: res.callId, traceId: res.traceId };
  }
  console.warn("[runNarratorOpening] validation failed, falling back", validated.issues);
  return {
    text: fallbackOpening(
      chapter ?? null,
      challenge ?? null,
      pendingBriefs,
      args.variant,
      bp.step3_script?.journey_meta?.protagonist_role ?? "",
      bp.step3_script?.journey_meta?.journey_goal ?? ""
    ),
    callId: res.callId,
    traceId: res.traceId,
  };
}

/** Collect character names from ALL fields-type artifacts declared anywhere
 *  in the blueprint. These are the "known universe" of names; any name in a
 *  Narrator output that's declared but NOT in the current nameable whitelist
 *  is an off-script reference. */
function collectAllDeclaredCharacterNames(bp: import("@/lib/types/core").Blueprint): string[] {
  const names = new Set<string>();
  for (const chap of bp.step3_script?.chapters ?? []) {
    for (const ch of chap.challenges ?? []) {
      for (const a of ch.artifacts ?? []) {
        if (a.content.type !== "fields") continue;
        const flat = [...(a.content.fields ?? [])];
        for (const s of a.content.sections ?? []) flat.push(...s.fields);
        const nameField = flat.find((f) =>
          /^(姓名|name|称呼)$/i.test(f.key.trim())
        );
        if (nameField?.value) names.add(nameField.value.trim());
      }
    }
  }
  return Array.from(names);
}

function validateOpeningOutput(
  text: string,
  ctx: {
    variant: "first" | "cross_challenge";
    artifactNames: string[];
    nameableCharacters: string[];
    protagonistRole: string;
    declaredCharacters: string[];
  }
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!text || text.length < 40) issues.push("too-short");
  if (text.length > 340) issues.push("too-long");
  if (/\{\{|\bundefined\b|\bnull\b/.test(text)) issues.push("placeholder-leak");
  if (/^【|【第\s*\d+\s*章】|【第一幕】|欢迎来到/.test(text)) issues.push("meta-preamble");
  if (/"学员"|\b您\b|\b用户\b/.test(text)) issues.push("third-person-leak");
  if (/👉|```/.test(text)) issues.push("forbidden-symbol");
  // Must end with a question for "first" variant (open call-to-action)
  if (ctx.variant === "first" && !/[？?]\s*$/.test(text)) issues.push("no-closing-question");
  if (ctx.variant === "first" && !openingContainsLearnerIdentity(text, ctx.protagonistRole)) {
    issues.push("missing-learner-identity");
  }
  // If there are artifacts expected to drop, text should reference at least one by name substring
  if (ctx.artifactNames.length > 0) {
    const anyHit = ctx.artifactNames.some((n) => n && text.includes(n));
    if (!anyHit) issues.push("missing-artifact-reference");
  }
  // HARD GUARDRAIL: no off-whitelist declared characters in the output.
  // A declared character is any person-name known to the blueprint; a nameable
  // one is one the learner has actually met (or is meeting this turn).
  // An off-whitelist name in the output means the LLM invented a prior
  // interaction with an unmet character.
  const nameSet = new Set(ctx.nameableCharacters);
  const offroster = ctx.declaredCharacters.filter(
    (n) => n && !nameSet.has(n) && text.includes(n)
  );
  if (offroster.length > 0) {
    issues.push(`off-roster-character:${offroster.join(",")}`);
  }
  return { ok: issues.length === 0, issues };
}

function fallbackOpening(
  chapter: { title?: string; narrative_premise?: string } | null,
  challenge: { title?: string; trunk?: { setup?: string; action_prompts?: string[] } } | null,
  pendingArtifacts: Array<{ name: string }> | null,
  variant: "first" | "cross_challenge",
  protagonistRole: string,
  journeyGoal: string
): string {
  const title = challenge?.title ?? chapter?.title ?? "此刻";
  const setup = challenge?.trunk?.setup?.trim() ?? "";
  const prompt = challenge?.trunk?.action_prompts?.[0]?.trim() ?? "你会先关注什么？";
  const artifactHint =
    pendingArtifacts && pendingArtifacts.length > 0
      ? `桌上放着一份《${pendingArtifacts[0].name}》，你可以先翻一翻。`
      : "";
  const prefix =
    variant === "cross_challenge"
      ? "你把上一幕收在这里，转入下一个场景。"
      : "";
  const roleLine = protagonistRole
    ? `${normalizeSecondPersonRole(protagonistRole)}。`
    : "";
  const goalLine = journeyGoal ? `这一段要完成的是：${journeyGoal}。` : "";
  const body = `${prefix}${roleLine}${goalLine}${setup} ${artifactHint}`.replace(/\s+/g, " ").trim();
  return (body || title) + ` ${prompt}`;
}

function openingContainsLearnerIdentity(text: string, protagonistRole: string): boolean {
  if (/你(现在)?是|你的身份|作为/.test(text)) return true;
  const keywords = roleKeywords(protagonistRole);
  return keywords.some((word) => text.includes(word));
}

function roleKeywords(protagonistRole: string): string[] {
  const words = protagonistRole.match(/[A-Za-z][A-Za-z -]{2,}|[一-龥]{2,}/g) ?? [];
  const stop = new Set(["你是", "一名", "正在", "学习", "实践者", "需要", "面对", "这个", "一个"]);
  return words
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !stop.has(word))
    .slice(0, 8);
}

function normalizeSecondPersonRole(protagonistRole: string): string {
  const trimmed = protagonistRole.trim();
  if (!trimmed) return "";
  if (/^你(现在)?是/.test(trimmed)) return trimmed.replace(/[。.!！\s]+$/, "");
  return `你现在是${trimmed.replace(/^一名/, "一名").replace(/[。.!！\s]+$/, "")}`;
}

// ============================================================================
// Per-turn narrator response
// ============================================================================

export interface NarratorArgs {
  snapshot: Snapshot;
  judgeOutput: JudgeOutput;
  /** The authoritative current-turn learner input. Narrator always prefers
   *  this over rediscovering it from recentTurns — the latter may contain a
   *  stale "last learner entry" if the conversation_log tail is misaligned. */
  learnerInput: string;
  recentTurns: NarratorRecentTurn[];
  newlyDroppedArtifacts?: ArtifactBrief[];
  /** Scene journal for this learner at this position. Supplies nameable
   *  whitelist + played_recap. If omitted, runNarrator rebuilds it. */
  sceneJournal?: SceneJournal | null;
  /** Hooks the designer declared for this challenge × active companions.
   *  Narrator reads them as background so it can leave a natural hook for
   *  the companion to pick up ("你听见 Elena 想提醒你…"). */
  challengeCompanionHooks?: ActiveCompanionHook[];
  traceId: string;
  parentSpanId?: string;
}

export async function runNarrator(args: NarratorArgs): Promise<{ text: string; callId: string }> {
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
  // Authoritative: the caller hands us the current-turn input explicitly.
  // The recentTurns fallback is only a last resort (e.g., tests that skip it).
  const learnerInput =
    args.learnerInput ||
    args.recentTurns.slice().reverse().find((t) => t.role === "learner")?.text ||
    "";

  const characters: CharacterRegistryEntry[] = buildCharacterRegistry({
    learnerId: args.snapshot.learner.learner_id,
    blueprint: bp ?? null,
  });
  const seenArtifacts = buildAllSeenArtifactBriefs(args.snapshot.learner.learner_id);
  const newlyDropped = args.newlyDroppedArtifacts ?? [];

  const evidence = listEvidence(args.snapshot.learner.learner_id, 40);
  const signalsHit = getSignalsHitSoFar({ evidence, challenge: challenge ?? null });

  const cognitiveStage =
    totalLearnerTurns <= 2
      ? "破冰期 (0-2)"
      : totalLearnerTurns <= 6
      ? "定向期 (3-6)"
      : "展开期 (7+)";

  const rubricColumn = boundActionId
    ? args.snapshot.rubric_column[boundActionId] ?? {}
    : {};

  const judgeQuality = (args.judgeOutput.quality ?? []).map((q) => ({
    dim_id: q.dim_id,
    grade: q.grade,
    evidence: q.evidence,
  }));

  const companionDispatch = (args.judgeOutput.companion_dispatch ?? [])
    .filter((d) => d.role === "speaker")
    .map((d) => ({ companion_id: d.companion_id, directive: d.directive }));

  const previousNarration = lastNarratorResponseText(args.snapshot.learner.learner_id);

  // Current arc_stage — voice modulation cue for the turn response.
  const currentArcStage =
    chapter?.arc_stage_id
      ? bp?.step3_script?.journey_meta?.arc_stages?.find(
          (s) => s.id === chapter.arc_stage_id
        ) ?? null
      : null;

  // Scene journal — same guardrails as opening. If caller didn't supply one,
  // rebuild. We need nameable_characters for the hard whitelist rule.
  const sceneJournal =
    args.sceneJournal ??
    (bp
      ? buildSceneJournal({
          learnerId: args.snapshot.learner.learner_id,
          blueprint: bp,
          learner: args.snapshot.learner,
          currentChapterId: args.snapshot.current_challenge?.chapter_id,
          currentChallengeId: args.snapshot.current_challenge?.challenge_id,
        })
      : null);

  const res = await llmCall({
    caller: "narrator",
    stage: "learning",
    traceId: args.traceId,
    parentSpanId: args.parentSpanId,
    learnerId: args.snapshot.learner.learner_id,
    blueprintId: args.snapshot.learner.blueprint_id,
    userVisible: true,
    variables: {
      // Block 1 · static scene script
      topic: bp?.topic ?? "",
      protagonist_role:
        bp?.step3_script?.journey_meta?.protagonist_role ??
        `你是一名正在学习「${bp?.topic ?? ""}」的实践者`,
      journey_goal:
        bp?.step3_script?.journey_meta?.journey_goal ??
        `完成这段旅程，掌握「${bp?.topic ?? ""}」的核心动作`,
      chapter_title: chapter?.title ?? "",
      chapter_narrative_premise: chapter?.narrative_premise ?? "",
      chapter_milestone: chapter?.milestone?.summary ?? "",
      challenge_title: challenge?.title ?? "",
      challenge_complexity: challenge?.complexity ?? "low",
      challenge_setup: challenge?.trunk?.setup ?? "",
      challenge_action_prompts: challenge?.trunk?.action_prompts ?? [],
      challenge_expected_signals: challenge?.trunk?.expected_signals ?? [],
      core_action_description: boundAction
        ? `${boundAction.name}: ${boundAction.description}`
        : "",
      rubric_column: rubricColumn,
      current_arc_stage: currentArcStage
        ? {
            name: currentArcStage.name,
            position: currentArcStage.position,
            signature_question: currentArcStage.signature_question,
            narrator_voice_hint: currentArcStage.narrator_voice_hint,
          }
        : null,

      // Block 2 · live scene state
      characters_introduced: characters,
      seen_artifacts: seenArtifacts,
      newly_dropped_artifacts: newlyDropped,
      active_companions: args.snapshot.active_companions,
      companion_dispatch_this_turn: companionDispatch,
      // Scene-journal guardrails: name whitelist + played-recap continuity.
      nameable_characters: sceneJournal?.nameable_characters ?? characters,
      played_challenges_recap: sceneJournal?.played_challenges_recap ?? [],
      // Designer-declared companion hooks for this challenge (background;
      // Narrator may leave a natural out for the companion to take).
      challenge_companion_hooks: (args.challengeCompanionHooks ?? []).map((h) => ({
        companion: h.display_name,
        hook: h.hook_text,
      })),

      // Block 3 · this-turn dynamics
      learner_input: learnerInput,
      judge_quality: judgeQuality,
      judge_path_decision: args.judgeOutput.path_decision ?? {
        type: "advance",
        target: null,
        scaffold_spec: null,
      },
      scaffold_strategy:
        args.judgeOutput.path_decision?.scaffold_spec?.strategy ?? "",
      scaffold_notes:
        args.judgeOutput.path_decision?.scaffold_spec?.notes ?? "",
      narrator_directive: args.judgeOutput.narrator_directive ?? "",
      signals_hit_so_far: signalsHit,
      learner_total_turns: totalLearnerTurns,
      challenge_turn_idx: args.snapshot.learner.position.turn_idx,
      cognitive_stage: cognitiveStage,
      recent_turns: args.recentTurns,
      my_previous_narration: previousNarration,
    },
  });

  const raw = (res.text ?? "").trim();
  const validated = validateNarratorOutput(raw, {
    directive: args.judgeOutput.narrator_directive ?? "",
    newlyDroppedArtifacts: newlyDropped,
    pathDecisionType: args.judgeOutput.path_decision?.type ?? "advance",
    scaffoldStrategy:
      args.judgeOutput.path_decision?.scaffold_spec?.strategy ?? null,
    nameableCharacters: (sceneJournal?.nameable_characters ?? characters).map((c) => c.name),
    declaredCharacters: bp ? collectAllDeclaredCharacterNames(bp) : [],
  });
  if (!validated.ok) {
    console.warn("[runNarrator] validation warnings", validated.issues);
  }
  return { text: raw, callId: res.callId };
}

function validateNarratorOutput(
  text: string,
  ctx: {
    directive: string;
    newlyDroppedArtifacts: ArtifactBrief[];
    pathDecisionType: string;
    scaffoldStrategy?: string | null;
    nameableCharacters: string[];
    declaredCharacters: string[];
  }
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!text) {
    issues.push("empty");
    return { ok: false, issues };
  }
  // Scaffold mode produces longer, content-heavy text (worked examples,
  // paired contrastive cases, walkthroughs). Relax the upper bound there.
  const isScaffoldMode =
    ctx.pathDecisionType === "scaffold" ||
    ctx.pathDecisionType === "simplify_challenge";
  if (text.length < 30) issues.push("too-short");
  if (text.length > (isScaffoldMode ? 320 : 260)) issues.push("too-long");
  if (/\{\{|\bundefined\b|\bnull\b/.test(text)) issues.push("placeholder-leak");
  if (/^【/.test(text)) issues.push("title-prefix");
  if (/👉|```/.test(text)) issues.push("forbidden-symbol");

  // Scaffold strategies that MUST contain an explicit example-style snippet
  // (a quoted ≥ ~25-char line). If missing, Narrator regressed to "更精细的
  // 开放问题" — exactly what we're trying to prevent. This is the core
  // correctness check of the whole scaffold refactor.
  if (isScaffoldMode) {
    const mustHaveQuotedExample = [
      "worked_example",
      "contrastive_cases",
      "chunked_walkthrough",
    ];
    if (ctx.scaffoldStrategy && mustHaveQuotedExample.includes(ctx.scaffoldStrategy)) {
      // Look for a Chinese-quoted or Latin-quoted segment that is at least
      // 20 chars long inside the output. Supports「...」 /『...』/ "..." / "..." / ....
      const quotedMatch = text.match(
        /[「『"'""][^「『"'""]{20,}[」』"'""]/
      );
      if (!quotedMatch) issues.push(`scaffold-missing-quoted-example:${ctx.scaffoldStrategy}`);
    }
  }
  // Directive must not be quoted verbatim (≥15 char substring)
  if (ctx.directive && ctx.directive.length >= 15) {
    // Scan for any 15-char window of directive present in text
    for (let i = 0; i + 15 <= ctx.directive.length; i++) {
      const window = ctx.directive.slice(i, i + 15);
      if (text.includes(window)) {
        issues.push("directive-verbatim");
        break;
      }
    }
  }
  // Newly dropped artifact must be referenced by name
  if (ctx.newlyDroppedArtifacts.length > 0) {
    const anyHit = ctx.newlyDroppedArtifacts.some((a) => a.name && text.includes(a.name));
    if (!anyHit) issues.push("missing-new-artifact-reference");
  }
  // complete_challenge must not contain a question (this is about *closing*
  // a challenge, not scaffolding through one).
  if (ctx.pathDecisionType === "complete_challenge" && /[？?]/.test(text)) {
    issues.push("closing-turn-has-question");
  }
  // HARD GUARDRAIL: no off-whitelist declared character names.
  const nameSet = new Set(ctx.nameableCharacters);
  const offroster = ctx.declaredCharacters.filter(
    (n) => n && !nameSet.has(n) && text.includes(n)
  );
  if (offroster.length > 0) {
    issues.push(`off-roster-character:${offroster.join(",")}`);
  }
  return { ok: issues.length === 0, issues };
}

/** Count how many `learner` messages this learner has ever sent. */
function countLearnerTurns(learnerId: string): number {
  if (conversationCount(learnerId) === 0) return 0;
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM conversation_log WHERE learner_id = ? AND role = 'learner'`
    )
    .get(learnerId) as { n: number };
  return r.n;
}
