// Design-phase Skills (PRD §5.3)
// Each skill: llm_call with its caller id → parse → validate → patch Blueprint.

import { llmCall } from "@/lib/llm";
import {
  getBlueprint,
  updateBlueprint,
  auditStep,
  cascadeStale,
} from "@/lib/blueprint";
import { computeUnlockThresholds, DEFAULT_FRAMEWORK } from "@/lib/points";
import { normalizeChallengeArtifacts } from "@/lib/skills/artifacts-normalizer";
import {
  LlmInvalidOutputError,
  llmCallWithTransientRetry,
  llmCallWithValidationRetry,
} from "@/lib/llm/retry";
import { normalizeChallengeResponseFrames } from "@/lib/learning-runtime/response-frames";
export { normalizeChallengeArtifacts, normalizeArtifact, normalizeContent } from "@/lib/skills/artifacts-normalizer";
import type {
  Blueprint,
  Step1Gamecore,
  Step2Experience,
  Step3Script,
  Step4Companions,
  Step5Points,
} from "@/lib/types/core";

// -------- Skill 1 --------
export async function runSkill1(
  blueprintId: string,
  hint?: string
): Promise<{ blueprint: Blueprint; callId: string; traceId: string }> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  const res = await llmCall({
    caller: "skill_1_gamecore",
    stage: "design",
    blueprintId,
    userVisible: false,
    variables: { topic: bp.topic, hint: hint ?? "" },
  });
  const parsed = res.parsed as Step1Gamecore | undefined;
  if (!parsed || !Array.isArray(parsed.core_actions)) {
    throw new Error("skill_1 output invalid");
  }
  if (parsed.core_actions.length > 5) parsed.core_actions = parsed.core_actions.slice(0, 5);
  bp.step1_gamecore = parsed;
  bp.step_status.step1 = "draft";
  updateBlueprint(bp);
  auditStep(blueprintId, 1, bp.version, parsed);
  return { blueprint: bp, callId: res.callId, traceId: res.traceId };
}

// -------- Skill 2 --------
export async function runSkill2(
  blueprintId: string
): Promise<{ blueprint: Blueprint; callId: string; traceId: string }> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  if (!bp.step1_gamecore) throw new Error("step1 not ready");
  const res = await llmCall({
    caller: "skill_2_experience",
    stage: "design",
    blueprintId,
    variables: { core_actions: bp.step1_gamecore.core_actions },
  });
  const parsed = res.parsed as Step2Experience | undefined;
  if (!parsed || !Array.isArray(parsed.mappings)) {
    throw new Error("skill_2 output invalid");
  }
  bp.step2_experience = parsed;
  bp.step_status.step2 = "draft";
  updateBlueprint(bp);
  auditStep(blueprintId, 2, bp.version, parsed);
  return { blueprint: bp, callId: res.callId, traceId: res.traceId };
}

// -------- Skill 3 (two-pass) --------
export async function runSkill3Skeleton(
  blueprintId: string
): Promise<{ blueprint: Blueprint; callId: string; traceId: string; skeleton: unknown }> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  if (!bp.step1_gamecore || !bp.step2_experience) {
    throw new Error("step1 or step2 not ready");
  }
  const step1 = bp.step1_gamecore;
  const step2 = bp.step2_experience;
  const { result: res, skeleton } = await llmCallWithValidationRetry(
    () =>
      llmCall({
        caller: "skill_3_script_skeleton",
        stage: "design",
        blueprintId,
        variables: {
          topic: bp.topic,
          core_actions: step1.core_actions,
          experience_mapping: step2.mappings,
        },
      }),
    (result) => ({
      result,
      skeleton: normalizeSkill3Skeleton(result.parsed),
    })
  );
  return { blueprint: bp, callId: res.callId, traceId: res.traceId, skeleton };
}

function normalizeSkill3Skeleton(parsed: unknown): unknown {
  const skeleton = (parsed ?? {}) as {
    journey_meta?: unknown;
    chapters?: unknown;
  };
  if (!Array.isArray(skeleton.chapters) || skeleton.chapters.length === 0) {
    throw new LlmInvalidOutputError("skill_3 skeleton invalid: missing chapters");
  }
  return skeleton;
}

type Skill3SkeletonChapter = {
  chapter_id: string;
  title: string;
  milestone_summary?: string;
  arc_stage_id?: string;
  challenges: Array<{
    challenge_id: string;
    title: string;
    binds_actions: string[];
    complexity: "low" | "medium" | "high";
    response_frames?: unknown;
    default_response_frame_id?: string;
  }>;
};

export async function runSkill3Fill(
  blueprintId: string,
  skeleton: unknown
): Promise<{ blueprint: Blueprint; callId: string; traceId: string }> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");

  type SkeletonShape = {
    journey_meta?: Step3Script["journey_meta"];
    chapters?: Skill3SkeletonChapter[];
  };
  const sk = (skeleton ?? {}) as SkeletonShape;
  const chapters = sk.chapters ?? [];
  const journeyMeta: Step3Script["journey_meta"] =
    sk.journey_meta ?? {
      arc_type: "hero_journey",
      tone: "cinematic_workplace",
      estimated_duration_min: 180,
    };
  // Index arc_stages for quick lookup when filling each chapter.
  const arcStageById = new Map<string, import("@/lib/types/core").ArcStage>();
  for (const s of journeyMeta.arc_stages ?? []) arcStageById.set(s.id, s);

  // Fill chapter-by-chapter to keep each LLM call within max_tokens.
  const existingById = new Map(
    (bp.step3_script?.chapters ?? []).map((chapter) => [chapter.chapter_id, chapter])
  );
  const filledChapters: Step3Script["chapters"] = [];
  let lastCallId = "";
  let lastTraceId = "";
  for (const chap of chapters) {
    const existing = existingById.get(chap.chapter_id);
    if (existing && chapterCoversSkeleton(existing, chap)) {
      filledChapters.push(existing);
      continue;
    }
    const currentArcStage = chap.arc_stage_id
      ? arcStageById.get(chap.arc_stage_id) ?? null
      : null;
    // Accumulate prior chapters' premises so the LLM can reuse named
    // characters across chapters (avoid 周明 → 周铭 / 王哲 → 吴航 drift).
    const priorChapters = filledChapters.map((pc) => ({
      chapter_id: pc.chapter_id,
      title: pc.title,
      narrative_premise: pc.narrative_premise ?? "",
    }));
    // Phase C: surface framework_concepts to Skill 3 Fill so it can decide
    // whether each challenge needs a 4-rung ladder + concept_card artifact.
    // chapter_introduces_concepts is the chapter-level concept introduction list
    // from skeleton.introduces_concepts (filtered to those declared on actions).
    // framework_concepts_for_actions is keyed by action_id and contains the
    // full concept definitions (with levels) for use in single_choice options.
    const conceptsByAction: Record<string, import("@/lib/types/core").FrameworkConcept[]> = {};
    if (bp.step1_gamecore?.core_actions) {
      for (const a of bp.step1_gamecore.core_actions) {
        if (Array.isArray(a.framework_concepts) && a.framework_concepts.length > 0) {
          conceptsByAction[a.action_id] = a.framework_concepts;
        }
      }
    }
    // Concepts this chapter intends to introduce, expanded with full data.
    const introducesConceptsRaw = (chap as unknown as { introduces_concepts?: unknown })
      .introduces_concepts;
    const chapterIntroducesConcepts: import("@/lib/types/core").FrameworkConcept[] = [];
    if (Array.isArray(introducesConceptsRaw)) {
      const wantIds = new Set(
        introducesConceptsRaw.filter((s): s is string => typeof s === "string")
      );
      for (const concepts of Object.values(conceptsByAction)) {
        for (const c of concepts) {
          if (wantIds.has(c.concept_id)) chapterIntroducesConcepts.push(c);
        }
      }
    }
    // Per-action concept slim view (passed alongside chapter; lets Skill 3
    // Fill see at a glance which challenges in this chapter need 4-rung ladders).
    const frameworkConceptsForActions: Record<string, import("@/lib/types/core").FrameworkConcept[]> = {};
    for (const skCh of chap.challenges) {
      const a0 = skCh.binds_actions?.[0];
      if (a0 && conceptsByAction[a0]) frameworkConceptsForActions[a0] = conceptsByAction[a0];
    }
    const { result: res, chapter: filledChapter } = await llmCallWithValidationRetry(
      () =>
        llmCall({
          caller: "skill_3_script_fill",
          stage: "design",
          blueprintId,
          variables: {
            skeleton: {
              journey_meta: journeyMeta,
              chapter: chap,
              current_arc_stage: currentArcStage,
              prior_chapters: priorChapters,
              chapter_introduces_concepts: chapterIntroducesConcepts,
              framework_concepts_for_actions: frameworkConceptsForActions,
            },
          },
        }),
      (result) => ({
        result,
        chapter: normalizeSkill3FilledChapter(result.parsed, chap),
      })
    );
    lastCallId = res.callId;
    lastTraceId = res.traceId;
    filledChapters.push(filledChapter);
    persistSkill3Progress(bp, journeyMeta, filledChapters);
  }

  if (filledChapters.length === 0) throw new Error("skill_3 fill invalid: empty skeleton");

  persistSkill3Progress(bp, journeyMeta, filledChapters);
  auditStep(blueprintId, 3, bp.version, bp.step3_script);
  return { blueprint: bp, callId: lastCallId, traceId: lastTraceId };
}

function normalizeSkill3FilledChapter(
  parsed: unknown,
  chap: Skill3SkeletonChapter
): Step3Script["chapters"][number] {
  const parsedObj = (parsed ?? {}) as { chapters?: unknown; chapter?: unknown };
  const one = ((parsedObj.chapters as Step3Script["chapters"] | undefined)?.[0] ??
    (parsedObj.chapter as Step3Script["chapters"][number] | undefined)) as
    | Step3Script["chapters"][number]
    | undefined;
  if (!one || !Array.isArray(one.challenges)) {
    throw new LlmInvalidOutputError(`skill_3 fill invalid JSON/schema for chapter ${chap.chapter_id}`);
  }

  // Strict validation (PRIOR BUG: silent `?? one.challenges[0]` fallback
  // duplicated the first challenge into every missing slot when Claude's
  // output was truncated). Every skeleton challenge_id MUST be present in
  // Claude's output, every filled challenge MUST have a non-trivial setup, and
  // no two challenges in the same chapter may share their title/setup prefix.
  const byId = new Map<string, Step3Script["chapters"][number]["challenges"][number]>();
  for (const c of one.challenges) {
    if (c && typeof c.challenge_id === "string") byId.set(c.challenge_id, c);
  }
  const missing = chap.challenges
    .map((s) => s.challenge_id)
    .filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new LlmInvalidOutputError(
      `skill_3 fill missing challenges for chapter ${chap.chapter_id}: ` +
        `[${missing.join(", ")}]. Claude returned ` +
        `[${Array.from(byId.keys()).join(", ")}]. Output may have been truncated or malformed.`
    );
  }
  const seenTitle = new Map<string, string>();
  const seenSetup = new Map<string, string>();
  const thinSetup: string[] = [];
  for (const skCh of chap.challenges) {
    const filled = byId.get(skCh.challenge_id)!;
    const titleKey = String(filled.title ?? "").trim().slice(0, 30);
    const setupKey = String(filled.trunk?.setup ?? "").trim().slice(0, 30);
    const setupLen = String(filled.trunk?.setup ?? "").trim().length;
    if (setupLen < 30) thinSetup.push(`${skCh.challenge_id}(setup=${setupLen}字)`);
    if (titleKey) {
      const prev = seenTitle.get(titleKey);
      if (prev) {
        throw new LlmInvalidOutputError(
          `skill_3 fill duplicate title in chapter ${chap.chapter_id}: ` +
            `${prev} and ${skCh.challenge_id} both start with 「${titleKey}」.`
        );
      }
      seenTitle.set(titleKey, skCh.challenge_id);
    }
    if (setupKey) {
      const prev = seenSetup.get(setupKey);
      if (prev) {
        throw new LlmInvalidOutputError(
          `skill_3 fill duplicate setup in chapter ${chap.chapter_id}: ` +
            `${prev} and ${skCh.challenge_id} share the same opening 30 chars 「${setupKey}」.`
        );
      }
      seenSetup.set(setupKey, skCh.challenge_id);
    }
  }
  if (thinSetup.length > 0) {
    throw new LlmInvalidOutputError(
      `skill_3 fill thin setup in chapter ${chap.chapter_id}: ` +
        `${thinSetup.join(", ")} (need >= 30 chars).`
    );
  }

  // introduces_concepts: prefer the fill output's value, but fall back to the
  // skeleton chapter's value (which the LLM declared at skeleton stage). This
  // prevents the chapter from losing its concept-introduction marker simply
  // because the fill prompt didn't explicitly re-emit it.
  const fillIntroducesConcepts = (one as unknown as { introduces_concepts?: unknown })
    .introduces_concepts;
  const skeletonIntroducesConcepts = (chap as unknown as { introduces_concepts?: unknown })
    .introduces_concepts;
  const introducesConcepts = Array.isArray(fillIntroducesConcepts)
    ? fillIntroducesConcepts
    : Array.isArray(skeletonIntroducesConcepts)
    ? skeletonIntroducesConcepts
    : null;
  return {
    chapter_id: chap.chapter_id,
    title: one.title ?? chap.title,
    narrative_premise: one.narrative_premise ?? "",
    milestone: one.milestone ?? {
      id: `m_${chap.chapter_id}`,
      summary: chap.milestone_summary ?? "",
    },
    arc_stage_id: chap.arc_stage_id,
    ...(Array.isArray(introducesConcepts) && introducesConcepts.length > 0
      ? {
          introduces_concepts: introducesConcepts.filter(
            (c): c is string => typeof c === "string"
          ),
        }
      : {}),
    challenges: chap.challenges.map((skCh) => {
      const filled = byId.get(skCh.challenge_id)!;
      const trunk = filled.trunk ?? {
        setup: "",
        action_prompts: [],
        expected_signals: [],
      };
      const filledLadder = (filled as unknown as { scaffold_ladder?: unknown })
        .scaffold_ladder;
      const filledDefaultPos = (
        filled as unknown as { default_ladder_position?: unknown }
      ).default_ladder_position;
      const base = {
        challenge_id: skCh.challenge_id,
        title: filled.title ?? skCh.title,
        binds_actions: skCh.binds_actions,
        complexity: skCh.complexity,
        trunk: {
          setup: String(trunk.setup ?? ""),
          action_prompts: Array.isArray(trunk.action_prompts) ? trunk.action_prompts : [],
          expected_signals: Array.isArray(trunk.expected_signals) ? trunk.expected_signals : [],
        },
        companion_hooks: normalizeCompanionHooks(filled.companion_hooks, skCh.challenge_id),
        artifacts: (filled as unknown as { artifacts?: unknown }).artifacts,
        response_frames: (filled as unknown as { response_frames?: unknown }).response_frames,
        default_response_frame_id:
          (filled as unknown as { default_response_frame_id?: string }).default_response_frame_id ??
          skCh.default_response_frame_id,
        scaffold_ladder: Array.isArray(filledLadder)
          ? (filledLadder as import("@/lib/types/core").ScaffoldLadderRung[])
          : undefined,
        default_ladder_position:
          typeof filledDefaultPos === "number" ? filledDefaultPos : undefined,
      };
      return normalizeChallengeResponseFrames(
        normalizeChallengeArtifacts(base as import("@/lib/types/core").Challenge)
      );
    }),
  };
}

function persistSkill3Progress(
  bp: Blueprint,
  journeyMeta: Step3Script["journey_meta"],
  chapters: Step3Script["chapters"]
) {
  bp.step3_script = { journey_meta: journeyMeta, chapters };
  bp.step_status.step3 = "draft";
  updateBlueprint(bp);
}

function chapterCoversSkeleton(
  existing: Step3Script["chapters"][number],
  skeletonChapter: {
    challenges: Array<{ challenge_id: string }>;
  }
): boolean {
  const existingIds = new Set(existing.challenges.map((challenge) => challenge.challenge_id));
  return skeletonChapter.challenges.every((challenge) => existingIds.has(challenge.challenge_id));
}

// -------- Skill 4 --------
export async function runSkill4(
  blueprintId: string
): Promise<{ blueprint: Blueprint; callId: string; traceId: string }> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  if (!bp.step1_gamecore || !bp.step3_script) {
    throw new Error("step1 or step3 not ready");
  }
  const res = await llmCall({
    caller: "skill_4_companion",
    stage: "design",
    blueprintId,
    variables: {
      core_actions: bp.step1_gamecore.core_actions,
      script: bp.step3_script,
    },
  });
  const parsed = res.parsed as Step4Companions | undefined;
  if (!parsed || !Array.isArray(parsed.companions)) {
    throw new Error("skill_4 output invalid");
  }
  const normalized = normalizeCompanions(parsed);
  bp.step4_companions = normalized;
  bp.step_status.step4 = "draft";
  updateBlueprint(bp);
  auditStep(blueprintId, 4, bp.version, normalized);
  return { blueprint: bp, callId: res.callId, traceId: res.traceId };
}

// Ensure every companion has the full shape downstream consumers rely on.
// Claude sometimes omits fields for edge-case companion types (e.g. difficulty_dial
// misses unlock_rule / upgrade_path). We fill in defensible defaults so the UI
// and learning runtime never crash on undefined.
export function normalizeCompanions(raw: Step4Companions): Step4Companions {
  return { companions: raw.companions.map((c, idx) => normalizeCompanion(c, idx)) };
}

type RawHook = Partial<import("@/lib/types/core").CompanionHook> & {
  condition?: unknown;
  delta?: unknown;
};

export function normalizeCompanionHooks(
  raw: unknown,
  challengeId: string
): import("@/lib/types/core").CompanionHook[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h, i) => normalizeCompanionHook(h as RawHook, challengeId, i))
    .filter((h): h is import("@/lib/types/core").CompanionHook => h !== null);
}

function normalizeCompanionHook(
  h: RawHook,
  challengeId: string,
  idx: number
): import("@/lib/types/core").CompanionHook | null {
  if (!h || typeof h !== "object") return null;
  const cond = (h.condition ?? {}) as Record<string, unknown>;
  const delta = (h.delta ?? {}) as Record<string, unknown>;
  const companionType = (cond.companion_type ?? "npc_guide") as
    import("@/lib/types/core").CompanionType;
  return {
    hook_id: (h.hook_id as string) || `h_${challengeId}_${idx}`,
    condition: {
      companion_type: companionType,
      min_level: typeof cond.min_level === "number" ? cond.min_level : 1,
    },
    delta: {
      pre_action_injection:
        typeof delta.pre_action_injection === "string"
          ? (delta.pre_action_injection as string)
          : undefined,
      post_action_injection:
        typeof delta.post_action_injection === "string"
          ? (delta.post_action_injection as string)
          : undefined,
      scaffold_override:
        typeof delta.scaffold_override === "string"
          ? (delta.scaffold_override as string)
          : null,
    },
  };
}

type RawCompanion = Partial<import("@/lib/types/core").Companion> & {
  unlock_rule?: unknown;
  upgrade_path?: unknown;
  persona?: unknown;
  io_spec?: unknown;
};

function normalizeCompanion(
  c: RawCompanion,
  idx: number
): import("@/lib/types/core").Companion {
  const companion_id = c.companion_id || `cp_${idx + 1}`;
  const companion_type = (c.companion_type ?? "npc_guide") as
    import("@/lib/types/core").CompanionType;
  const display_name = c.display_name || companion_id;

  // unlock_rule: coerce any shape Claude returned into { type, value }
  const unlock_rule = normalizeUnlockRule(c.unlock_rule);

  // upgrade_path: must be an array of { level, delta }
  const upgrade_path = normalizeUpgradePath(c.upgrade_path);

  // Default output_format by companion_type
  const output_format =
    (c.output_format as import("@/lib/types/core").CompanionOutputFormat | undefined) ??
    defaultOutputFormat(companion_type);

  return {
    companion_id,
    companion_type,
    display_name,
    unique_value_hypothesis: c.unique_value_hypothesis || "",
    effectiveness_mechanism: c.effectiveness_mechanism || "",
    persona: normalizePersona(c.persona, display_name),
    unlock_rule,
    upgrade_path,
    companion_priority: typeof c.companion_priority === "number" ? c.companion_priority : 50,
    output_format,
    io_spec: normalizeIoSpec(c.io_spec),
  };
}

function normalizeUnlockRule(
  raw: unknown
): { type: "points_threshold"; value: number } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const v =
      typeof r.value === "number"
        ? r.value
        : typeof r.threshold === "number"
        ? r.threshold
        : typeof r.points === "number"
        ? r.points
        : 30;
    return { type: "points_threshold", value: v };
  }
  if (typeof raw === "number") return { type: "points_threshold", value: raw };
  return { type: "points_threshold", value: 30 };
}

function normalizeUpgradePath(
  raw: unknown
): { level: number; delta: string }[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { level: 1, delta: "基础形态" },
      { level: 2, delta: "扩展记忆 / 强化风格" },
      { level: 3, delta: "解锁独家机制" },
    ];
  }
  return raw.map((u, i) => {
    const r = (u ?? {}) as Record<string, unknown>;
    return {
      level: typeof r.level === "number" ? r.level : i + 1,
      delta:
        typeof r.delta === "string"
          ? r.delta
          : typeof r.description === "string"
          ? (r.description as string)
          : `Lv.${i + 1}`,
    };
  });
}

function normalizePersona(
  raw: unknown,
  displayName: string
): import("@/lib/types/core").CompanionPersona {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sp = (r.speech_patterns ?? {}) as Record<string, unknown>;
  const ir = (r.interaction_rules ?? {}) as Record<string, unknown>;
  return {
    background: String(r.background ?? `${displayName} 的背景介绍`),
    personality_traits: Array.isArray(r.personality_traits)
      ? (r.personality_traits as string[])
      : [],
    speech_patterns: {
      sentence_length:
        (sp.sentence_length as "short" | "medium" | "long") ?? "medium",
      typical_phrases: Array.isArray(sp.typical_phrases)
        ? (sp.typical_phrases as string[])
        : [],
      avoid: Array.isArray(sp.avoid) ? (sp.avoid as string[]) : [],
    },
    knowledge_boundary: String(r.knowledge_boundary ?? ""),
    relationship_stages: Array.isArray(r.relationship_stages)
      ? (r.relationship_stages as { level: number; stance: string }[])
      : [{ level: 1, stance: "中立" }],
    interaction_rules: {
      speak_when: String(ir.speak_when ?? "Judge 派发时"),
      silent_when: String(ir.silent_when ?? "默认"),
    },
  };
}

function normalizeIoSpec(raw: unknown): { max_tokens: number } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.max_tokens === "number") return { max_tokens: r.max_tokens };
  }
  return { max_tokens: 300 };
}

function defaultOutputFormat(
  t: import("@/lib/types/core").CompanionType
): import("@/lib/types/core").CompanionOutputFormat {
  if (t.startsWith("npc_")) return "dialog_text";
  if (t === "case_pack") return "reading_artifact";
  if (t === "hidden_plotline") return "plot_delta";
  if (t === "difficulty_dial") return "param_override";
  if (t === "replay_lens") return "visualization";
  if (t === "context_variant") return "scenario_override";
  return "dialog_text";
}

// -------- Skill 5 (non-LLM algorithm) --------
export async function runSkill5(
  blueprintId: string
): Promise<{ blueprint: Blueprint; algorithm: true }> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  if (!bp.step4_companions || !bp.step3_script) {
    throw new Error("step3 or step4 not ready");
  }
  const totalChallenges = bp.step3_script.chapters.reduce(
    (a, c) => a + c.challenges.length,
    0
  );
  const capacity = totalChallenges * 12; // roughly good x complexity ~ 3 * 2 * 2 per challenge
  const companionIds = bp.step4_companions.companions.map((c) => c.companion_id);
  const unlocks = computeUnlockThresholds(companionIds, capacity);

  const points: Step5Points = {
    ...DEFAULT_FRAMEWORK,
    instance_params: {
      ...DEFAULT_FRAMEWORK.instance_params,
      unlock_thresholds: unlocks,
    },
    total_capacity: capacity,
    fit_diagnostics: {
      fast_learner_unlock_first_at: 2,
      median_learner_unlock_first_at: Math.max(3, Math.ceil(totalChallenges * 0.3)),
      slow_learner_unlock_first_at: Math.max(4, Math.ceil(totalChallenges * 0.45)),
    },
  };

  bp.step5_points = points;
  bp.step_status.step5 = "draft";
  updateBlueprint(bp);
  auditStep(blueprintId, 5, bp.version, points);
  return { blueprint: bp, algorithm: true };
}

// -------- Step confirmation + cascade --------
export function confirmStep(
  blueprintId: string,
  step: "step1" | "step2" | "step3" | "step4" | "step5"
): Blueprint {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");
  cascadeStale(bp, step);
  bp.version += 1;
  if (Object.values(bp.step_status).every((s) => s === "confirmed")) {
    bp.status = "ready";
  }
  updateBlueprint(bp);
  return bp;
}
