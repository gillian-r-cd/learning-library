// 跨模块共享的 TS 类型。严格对齐 PRD.md 的 schema 定义。

export type Stage = "design" | "learning" | "eval";

export type KnowledgeType = "factual" | "conceptual" | "procedural" | "metacognitive";
export type Complexity = "low" | "medium" | "high";
export type Grade = "good" | "medium" | "poor";
export type EngagementLevel = "passive" | "active" | "constructive" | "interactive";

// ===== Blueprint schema (PRD §5.2) =====

export interface Rubric {
  good: string;
  medium: string;
  poor: string;
}

export interface QualityDimension {
  dim_id: string;
  name: string;
  type: "process" | "outcome";
}

export interface QualityMatrix {
  dimensions: QualityDimension[];
  complexity_levels: Complexity[];
  rubrics: Record<string, Record<Complexity, Rubric>>;
}

/** A named cognitive move the learner can EARN — the personal/subjective
 *  complement to the objective Mastery Map. Each core_action can register
 *  2-3 signature_moves at design time; Judge recognises them at runtime and
 *  awards via AWARD_SIGNATURE_MOVE events. */
export interface SignatureMove {
  move_id: string;
  /** Short evocative name (e.g., "分任务诊断"). */
  name: string;
  /** One-line definition of what this move IS — shown on the card. */
  definition: string;
  /** Detection hint for Judge's prompt — what pattern in learner output
   *  should trigger this move. Judge uses semantic matching, not regex. */
  recognition_hint: string;
  /** Which core_actions this move is bound to (usually 1). */
  bound_actions: string[];
  /** Tiered mastery: 1 earn = 初识, 3 = 娴熟, 5 = 立派 (default thresholds).
   *  Kept as configurable array for per-move override. */
  tier_thresholds?: number[];
}

/** Domain framework concept that a core_action depends on (e.g. R1-R4
 *  readiness levels for situational leadership). Declared at design time so
 *  that runtime can ensure: (a) the concept gets introduced via an artifact
 *  or narrator beat BEFORE any challenge requires it; (b) frame options /
 *  ladder rungs can show the concept's plain-language descriptions without
 *  exposing internal codes to learners. */
export interface FrameworkConcept {
  /** Stable id used across rubric / signature_moves / ladder.required_concepts. */
  concept_id: string;
  /** Short human name (例: "下属准备度的四种组合"). */
  name: string;
  /** One-paragraph plain-language description (no internal codes) used by
   *  artifacts and option labels. */
  plain_description: string;
  /** Optional categorical levels — each carries a learner-visible label and
   *  a one-line guidance. Used by Skill 3 Fill to populate single_choice
   *  rung options and concept_card artifact content. */
  levels?: Array<{
    /** Internal id (R1, S2, etc.). NOT shown to learners. */
    code: string;
    /** Plain-language label ("能力低、意愿高"). Shown to learners. */
    label: string;
    /** One-line guidance ("适合给具体步骤、同时保护积极性"). Optional. */
    guidance?: string;
  }>;
}

export interface CoreAction {
  action_id: string;
  name: string;
  description: string;
  knowledge_type: KnowledgeType;
  relations: { to: string; type: "precedes" | "parallel" | "reinforces" }[];
  quality_matrix: QualityMatrix;
  /** Signature moves registered under this action. Empty for old blueprints. */
  signature_moves?: SignatureMove[];
  /** Framework concepts (categorical schemes, scales, taxonomies) this
   *  action's rubric / signature_moves depend on. Declared at Skill 1 so
   *  Skill 3 can route concept introduction. Optional for backward compat. */
  framework_concepts?: FrameworkConcept[];
}

export interface Step1Gamecore {
  core_actions: CoreAction[];
  relation_graph: { from: string; to: string; type: string }[];
  reasoning_notes?: string;
}

export interface Step2Experience {
  mappings: {
    action_id: string;
    form_id: string;
    form_name: string;
    rationale: string;
    engagement_level: EngagementLevel;
  }[];
  form_library_version: string;
}

export interface CompanionHook {
  hook_id: string;
  condition: { companion_type: string; min_level: number };
  delta: {
    pre_action_injection?: string;
    post_action_injection?: string;
    scaffold_override?: string | null;
  };
}

// ===== Learner response frames =====
// Fixed, Schema-driven input contracts for learner replies. The learner UI
// renders these with known components; LLMs choose ids, not UI code.

export type ResponseFrameKind =
  | "free_text"
  | "single_choice"
  | "multi_choice"
  | "form"
  | "ranking"
  | "matrix"
  | "allocation"
  | "compound"
  /** Light-touch narrative choice. The learner taps one of 2-3 buttons; the
   *  story advances. Goes through a lightweight judge path (cognitive_signal
   *  recorded but no grade computed). See `docs/scaffold-ladder-redesign.md`. */
  | "narrative_choice";

export type ResponseFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "radio"
  | "checkboxes"
  | "chips"
  | "rank_order"
  | "likert"
  | "matrix_cell";

export interface ResponseOption {
  value: string;
  label: string;
  description?: string;
  /** Only used when the parent frame.kind === "narrative_choice".
   *  Story content the narrator must weave when this option is chosen.
   *  Should be ≥30 chars, written by Skill 3 Fill at design time. */
  narrative_payoff?: string;
  /** Only used for narrative_choice. Lightweight signal about the cognitive
   *  posture this option reveals (recorded in evidence_log; never graded). */
  cognitive_signal?: {
    action_id?: string;
    /** Free-form one-or-two-token tag, e.g. "ability_lean", "willingness_lean",
     *  "ambiguous", "context_seeking". Values are not enumerated; Skill 3 Fill
     *  decides per option. */
    tag: string;
  };
  /** Only used for single_choice rungs that drive a graded judgment.
   *  Skill 3 Fill tags every option as one of:
   *   - "target":     the canonical correct read for the rung.
   *   - "defensible": a partially correct read that still demonstrates progress;
   *                   runtime may advance with mastery=partial.
   *   - "off_target": clearly wrong read; runtime short-circuits to enter_review,
   *                   handing the learner a Narrator explanation beat. */
  judgment_kind?: "target" | "defensible" | "off_target";
  /** Optional designer-authored explanation for an `off_target` option.
   *  When present, runtime uses this verbatim as the selected misreading
   *  passed to Narrator instead of picking from the rung's
   *  common_misreadings array. */
  option_specific_misreading?: string;
}

export interface ResponseField {
  field_id: string;
  type: ResponseFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  help_text?: string;
  options?: ResponseOption[];
  validation?: {
    min_length?: number;
    max_length?: number;
    min_items?: number;
    max_items?: number;
  };
  maps_to?: {
    action_id?: string;
    dim_id?: string;
    evidence_key?: string;
  };
}

export interface ResponseFrame {
  frame_id: string;
  version: number;
  kind: ResponseFrameKind;
  title: string;
  prompt: string;
  helper_text?: string;
  submit_label?: string;
  binds_actions: string[];
  expected_evidence_keys?: string[];
  fields: ResponseField[];
  validation?: {
    min_required_fields?: number;
  };
  fallback_frame_id?: string;
}

export interface LearnerStructuredResponse {
  frame_id: string;
  frame_version: number;
  kind: ResponseFrameKind;
  values: Record<string, unknown>;
  canonical_text: string;
}

export interface NextResponseFrameSelection {
  frame_id: string;
  reason: string;
  /** Optional field-level narrowing. When set, the learner only sees these
   *  existing fields from the selected frame, so already-correct answers are
   *  not requested again in the same challenge. */
  field_ids?: string[];
  overrides?: {
    title?: string;
    prompt?: string;
    helper_text?: string;
  };
}

/** Scaffold ladder gate — when does the learner get to climb to the next rung?
 *  Skill 3 Fill writes this at design time; runtime evaluates it after each
 *  turn to decide whether to escalate the active frame. */
export type ScaffoldLadderGate =
  /** N successful narrative_advance turns at this rung have accumulated. */
  | { type: "after_n_advances"; n: number }
  /** Cross-challenge: the learner has at least N good-grade evidence rows
   *  on the action this ladder is for. */
  | { type: "after_action_mastery_at_least"; threshold: number }
  /** Judge / Narrator decides; runtime defers to a path_decision.type === "escalate_frame". */
  | { type: "narrator_decision"; cue: string }
  /** Final rung — no further escalation possible. */
  | null;

/** A single rung on the scaffold ladder for a challenge. Each rung references
 *  one of the challenge's response_frames via frame_id. The runtime maintains
 *  a position (0-indexed) per learner per challenge, escalating per gate. */
export interface ScaffoldLadderRung {
  position: number;
  /** Mirrors the referenced frame's kind; set redundantly so runtime/judge can
   *  branch without a frame lookup. */
  kind: "narrative_choice" | "form" | "free_text" | "single_choice" | "multi_choice";
  /** Must match an entry in challenge.response_frames. */
  frame_id: string;
  /** Why this rung exists (Skill 3 Fill rationale; not shown to learner). */
  narrative_purpose: string;
  /** Condition for the runtime to escalate to position+1. `null` = terminal. */
  gate_to_next: ScaffoldLadderGate;
  /** The concrete question narrator must end the turn with when this rung is
   *  active. Optional for backward compat with v1 ladders. When present,
   *  narrator must produce a semantic variant (preserving question type +
   *  referent; only paraphrase for stylistic flow). */
  rung_question?: string;
  /** What learner must demonstrate at this rung (designer-side; not shown). */
  rung_expected_output?: string;
  /** Framework concept ids that must already be introduced (via artifact /
   *  earlier rung / earlier challenge) for this rung to be valid. Runtime
   *  uses this to validate concept ordering at design time. */
  required_concepts?: string[];
  /** Designer-authored "model judgment" for this rung — what the canonical
   *  correct read is, with named details from the case (≥40 chars). Used
   *  verbatim as Narrator content when the rung enters review mode (either
   *  because the learner picked an off_target single_choice option, or
   *  because they failed the rung twice). Skill 3 Fill writes this. */
  model_judgment?: string;
  /** Designer-authored bank of common misreadings on this rung, one per
   *  typical wrong direction. Each entry binds to a rubric dim_id so the
   *  runtime can pick the entry whose dim matches Judge's worst-graded dim
   *  on form / free_text rungs. For single_choice, an option's
   *  option_specific_misreading takes priority. */
  common_misreadings?: Array<{
    dim_id: string;
    /** ≥30-char prose explaining what learners typically get wrong on this
     *  dim and why. Will be handed to Narrator alongside model_judgment. */
    description: string;
  }>;
}

export interface Challenge {
  challenge_id: string;
  title: string;
  binds_actions: string[];
  complexity: Complexity;
  trunk: {
    setup: string;
    action_prompts: string[];
    expected_signals: string[];
  };
  companion_hooks: CompanionHook[];
  /** 挑战级道具数组（0-3 个）。老 blueprint 没有此字段时 UI 自然降级。 */
  artifacts?: Artifact[];
  /** Schema-driven learner reply frames; normalised to include free_text. */
  response_frames?: ResponseFrame[];
  default_response_frame_id?: string;
  /** Optional ordered scaffold ladder. When present, runtime drives frame
   *  escalation through this ladder; absent → fall back to legacy
   *  default_response_frame_id behaviour. */
  scaffold_ladder?: ScaffoldLadderRung[];
  /** Where on the ladder this challenge starts. Defaults to 0. */
  default_ladder_position?: number;
}

// ===== Artifacts (道具) =====
// 学员在挑战中可观察的结构化物件：邮件、档案、时间线、清单、表格、组织图等。
// 每个 artifact 在挑战开场 / 学员请求 / Judge 诊断时通过 trigger 机制"掉落"到对话流。

export type ArtifactType =
  | "narrative"
  | "fields"
  | "series"
  | "list"
  | "table"
  | "hierarchy";

export type ArtifactTrigger =
  | "on_challenge_enter"
  | "on_learner_request"
  | "on_judge_scaffold";

export interface ArtifactNarrativeContent {
  header?: {
    from?: string;
    to?: string;
    date?: string;
    subject?: string;
  };
  body: string;
  footer?: string;
  annotations?: Array<{
    span: [number, number];
    note: string;
  }>;
}

export interface ArtifactFieldEntry {
  key: string;
  value: string;
  status?: "filled" | "empty" | "warning" | "highlight";
  note?: string;
}

export interface ArtifactFieldsContent {
  title?: string;
  sections?: Array<{
    heading: string;
    fields: ArtifactFieldEntry[];
  }>;
  fields?: ArtifactFieldEntry[];
}

export interface ArtifactSeriesEntry {
  id?: string;
  timestamp?: string;
  actor?: string;
  text: string;
  tag?: string;
  status?: "default" | "highlight" | "muted";
}

export interface ArtifactSeriesContent {
  title?: string;
  ordering?: "time_asc" | "time_desc" | "manual";
  entries: ArtifactSeriesEntry[];
}

export interface ArtifactListItem {
  text: string;
  checked?: boolean;
  status?: "default" | "warning" | "done" | "empty";
  sub_items?: string[];
}

export interface ArtifactListContent {
  title?: string;
  mode: "checklist" | "bullet" | "numbered";
  items: ArtifactListItem[];
}

export interface ArtifactTableContent {
  title?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" | "center" }>;
  rows: Array<Record<string, string | number>>;
  row_notes?: Array<{ row_index: number; note: string }>;
  highlight?: Array<{ row: number; col: string }>;
}

export interface ArtifactHierarchyNode {
  label: string;
  meta?: string;
  status?: "default" | "highlight" | "muted";
  children?: ArtifactHierarchyNode[];
}

export interface ArtifactHierarchyContent {
  title?: string;
  root: ArtifactHierarchyNode;
}

export type ArtifactContent =
  | ({ type: "narrative" } & ArtifactNarrativeContent)
  | ({ type: "fields" } & ArtifactFieldsContent)
  | ({ type: "series" } & ArtifactSeriesContent)
  | ({ type: "list" } & ArtifactListContent)
  | ({ type: "table" } & ArtifactTableContent)
  | ({ type: "hierarchy" } & ArtifactHierarchyContent);

export interface Artifact {
  artifact_id: string;
  name: string;
  icon_hint?: string;
  type: ArtifactType;
  /** 结构由 `type` 决定；在运行时用 discriminated union 访问。 */
  content: ArtifactContent;
  trigger: ArtifactTrigger;
  /** 在 on_learner_request / on_judge_scaffold 下给 Judge 的匹配提示。 */
  trigger_hint?: string;
  version: number;
  /** 指向前一版本的 artifact_id（通常就是同一个 artifact_id 的上一个 version）。 */
  supersedes?: string | null;
  /** 可选：掉落时 Narrator 说的那句话；省略则由 Narrator 自然生成。 */
  narrator_intro?: string;
}

/** Artifact 掉落到 conversation_log 时的 meta 结构（role = "artifact" 的 meta_json）。 */
export interface ArtifactDropMeta {
  kind: "artifact_drop";
  artifact_id: string;
  version: number;
  type: ArtifactType;
  content: ArtifactContent;
  trigger: ArtifactTrigger;
  supersedes?: string | null;
  trigger_source?: string;
}

/** UI 聚合：一个 artifact_id 的所有历史版本（按 version 升序）。 */
export interface DroppedArtifactGroup {
  artifact_id: string;
  name: string;
  type: ArtifactType;
  icon_hint?: string;
  versions: Array<{
    version: number;
    content: ArtifactContent;
    trigger: ArtifactTrigger;
    supersedes?: string | null;
    /** conversation_log.id — 用来按时间顺序/精确定位 */
    conversation_id: number;
    ts: string;
    chapter_id: string | null;
    challenge_id: string | null;
  }>;
}

/** A stage in the learner's Hero's Journey arc. Every chapter is bound to
 *  one stage; the stage shapes Skill 1's action selection, Skill 3's
 *  narrative premise, AND the runtime Narrator's voice (tone modulation). */
export type ArcStageName =
  | "觉察"
  | "启程"
  | "试炼"
  | "低谷"
  | "蜕变"
  | "归来";

export interface ArcStage {
  id: string;               // e.g., "arc_s1"
  name: ArcStageName;
  position: number;         // 0-indexed order within the journey
  /** A one-sentence "signature question" the learner wrestles with at this
   *  stage. Passed to Skill 3 as a writing constraint for chapter premise. */
  signature_question: string;
  /** One-phrase voice hint for Narrator — e.g., "节奏加快、利害前置". */
  narrator_voice_hint: string;
}

export interface Chapter {
  chapter_id: string;
  title: string;
  narrative_premise: string;
  milestone: { id: string; summary: string };
  challenges: Challenge[];
  /** Link to one ArcStage.id in journey_meta.arc_stages. Old blueprints
   *  may omit this; runtime degrades gracefully. */
  arc_stage_id?: string;
  /** Framework concept ids this chapter teaches/introduces. A concept may
   *  only be referenced in a challenge if it appears here or in an earlier
   *  chapter's introduces_concepts. Optional for backward compat. */
  introduces_concepts?: string[];
}

export interface Step3Script {
  journey_meta: {
    arc_type: string;
    tone: string;
    estimated_duration_min: number;
    /** 学员在旅程中扮演的角色设定（"你是一位刚接手 5 人小组的新 manager"） */
    protagonist_role?: string;
    /** 旅程整体要达成的学习目标（一句话） */
    journey_goal?: string;
    /** Hero's Journey arc stages for this blueprint. Each chapter binds to
     *  exactly one stage via `chapter.arc_stage_id`. */
    arc_stages?: ArcStage[];
  };
  chapters: Chapter[];
}

export type CompanionType =
  | "npc_guide"
  | "npc_traveler"
  | "npc_competitor"
  | "npc_adversary"
  | "case_pack"
  | "hidden_plotline"
  | "difficulty_dial"
  | "replay_lens"
  | "context_variant";

export type CompanionOutputFormat =
  | "dialog_text"
  | "reading_artifact"
  | "plot_delta"
  | "param_override"
  | "visualization"
  | "scenario_override";

export interface CompanionPersona {
  background: string;
  personality_traits: string[];
  speech_patterns: {
    sentence_length: "short" | "medium" | "long";
    typical_phrases: string[];
    avoid: string[];
  };
  knowledge_boundary: string;
  relationship_stages: { level: number; stance: string }[];
  interaction_rules: { speak_when: string; silent_when: string };
}

export interface Companion {
  companion_id: string;
  companion_type: CompanionType;
  display_name: string;
  unique_value_hypothesis: string;
  effectiveness_mechanism: string;
  persona: CompanionPersona;
  unlock_rule: { type: "points_threshold"; value: number };
  upgrade_path: { level: number; delta: string }[];
  companion_priority: number;
  output_format: CompanionOutputFormat;
  io_spec: { max_tokens: number };
}

export interface Step4Companions {
  companions: Companion[];
}

export interface Step5Points {
  framework_version: string;
  instance_params: {
    base_points: Record<Grade, number>;
    complexity_multiplier: Record<Complexity, number>;
    interaction_participation_bonus: number;
    replay_bonus_ratio: number;
    decay: {
      model: "fsrs_inspired";
      params_by_knowledge_type: Record<
        KnowledgeType,
        { initial_stability: number; stability_growth: number }
      >;
      floor_ratio: number;
    };
    unlock_thresholds: { companion_id: string; threshold: number }[];
    target_progress_curve: {
      first_companion_at_challenge: number;
      first_milestone_at_challenge: number;
      full_companion_set_at_challenge: number;
    };
  };
  total_capacity: number;
  fit_diagnostics: Record<string, number>;
}

export type StepStatus = "draft" | "confirmed" | "stale";

export interface Blueprint {
  blueprint_id: string;
  topic: string;
  version: number;
  status: "in_design" | "ready" | "archived";
  created_at: string;
  updated_at: string;
  designer_id: string;
  step1_gamecore?: Step1Gamecore;
  step2_experience?: Step2Experience;
  step3_script?: Step3Script;
  step4_companions?: Step4Companions;
  step5_points?: Step5Points;
  step_status: Record<"step1" | "step2" | "step3" | "step4" | "step5", StepStatus>;
}

// ===== Runtime types (PRD §6) =====

export interface EarnedSignatureMove {
  move_id: string;
  /** How many times this move has been awarded — drives tier. */
  count: number;
  first_earned_at: string;
  last_earned_at: string;
  /** The specific learner-text quote that TRIGGERED the first award — kept
   *  verbatim as the "moment" on the move card. */
  triggering_quote: string;
  /** Which challenge the first award happened in. */
  first_challenge_id: string;
}

/** Per-action accumulated mastery, used to gate frame escalation across
 *  challenges. Updated by `applyJudgeOutput` after every graded turn. */
export interface ActionMasteryRecord {
  attempts: number;
  good_count: number;
  medium_count: number;
  poor_count: number;
  consecutive_good: number;
  last_seen_at: string;
  last_challenge_id: string;
}

/** Per-(learner, challenge) record of which scaffold ladder rung the learner
 *  is on. Persisted on LearnerState; runtime reads at turn entry, writes on
 *  narrative_advance / escalate_frame. */
export interface LadderProgress {
  challenge_id: string;
  position: number;
  /** Number of completed narrative_advance turns at the current position. */
  advances_at_position: number;
  /** Last action this challenge's ladder is anchored to (the first
   *  binds_action; recorded for clarity). */
  action_id: string;
  /** Number of non-passing attempts the learner has made AT THE CURRENT rung.
   *  Reset to 0 on rung escalation. Drives the "after 2 misses, give the
   *  explanation beat" rule for form / free_text rungs. */
  same_rung_attempts?: number;
  /** When the learner advanced past this rung, was it via independent
   *  mastery, or did they get the explanation beat first? Persisted for the
   *  most recent escalation per challenge. */
  last_completion_kind?: "independent" | "partial_via_teach";
  updated_at: string;
}

export interface LearnerState {
  learner_id: string;
  blueprint_id: string;
  blueprint_version: number;
  position: { chapter_id: string; challenge_id: string; turn_idx: number };
  points: {
    total: number;
    by_action: Record<
      string,
      { raw: number; stability: number; last_review_at: string | null }
    >;
  };
  unlocked_companions: { companion_id: string; level: number; unlocked_at: string }[];
  completed_challenges: string[];
  active_response_frame?: {
    challenge_id: string;
    selection: NextResponseFrameSelection;
  } | null;
  /** Every signature_move the learner has earned at least once. */
  earned_signature_moves?: EarnedSignatureMove[];
  /** Cross-challenge mastery counters per action_id. Drives ladder escalation
   *  for challenges whose first binds_action matches a record here. */
  action_mastery?: Record<string, ActionMasteryRecord>;
  /** Per-challenge ladder progress (keyed by challenge_id). */
  ladder_progress?: Record<string, LadderProgress>;
  last_active_at: string;
  created_at: string;
}

export interface EvidenceEntry {
  id: number;
  learner_id: string;
  ts: string;
  challenge_id: string;
  action_id: string;
  turn_idx: number;
  grades: Record<string, Grade>;
  evidence: string;
  /** Points awarded for this turn (persisted at write time so the "why" never
   *  needs to be recomputed from shifting blueprints). Nullable only for old
   *  rows written before the schema migration. */
  points_earned?: number | null;
  /** The complexity level at the moment points were computed. */
  complexity?: Complexity | null;
  /** If this turn's Narrator was produced in scaffold mode, which strategy
   *  Judge chose. Null for regular (non-scaffold) turns. */
  scaffold_strategy?: ScaffoldStrategy | null;
  /** Whether this turn's learner performance was rescued by scaffolding —
   *  i.e., `path_decision.type` was `scaffold` or `simplify_challenge`. Used
   *  for metric: which strategies actually rebound which learners. */
  scaffold_assisted?: boolean | null;
  /** Judge flagged this learner utterance as a "quotable moment" — the
   *  learner gave a first-person synthesis/reflection/essential judgment
   *  worth preserving. Fuels the chapter Manifesto. */
  quotable?: boolean | null;
}

/** Persisted conversation bubble — the learner-facing transcript.
 *  "artifact" entries carry an ArtifactDropMeta in .meta for rich rendering. */
export type ConversationRole =
  | "learner"
  | "narrator"
  | "companion"
  | "system"
  | "artifact";

export interface ConversationEntry {
  id: number;
  learner_id: string;
  ts: string;
  turn_idx: number;
  chapter_id: string | null;
  challenge_id: string | null;
  role: ConversationRole;
  who: string | null;
  text: string;
  trace_id: string | null;
  meta: Record<string, unknown> | null;
}

// ===== Judge output schema (PRD §6.3.2) =====

export type PathDecisionType =
  | "advance"
  | "retry"
  | "scaffold"
  | "branch"
  | "complete_challenge"
  | "reveal_answer_and_advance"
  /** The "explanation beat" path: the learner is owed a direct read of the
   *  current rung's model_judgment (with selected_misreading) instead of any
   *  more hinting. Triggered by:
   *   (a) a single_choice rung where the learner picked an off_target option, or
   *   (b) a graded rung where same_rung_attempts >= 2 and the rung's
   *       model_judgment is authored.
   *  Mastery for the rung is recorded as `partial_via_teach`; runtime
   *  escalates the ladder one rung after the beat. */
  | "enter_review"
  | "escalate_complexity"
  /** Continuous failure (≥5 all-poor turns OR explicit self-help signal).
   *  Runtime switches to a combined worked_example + contrastive_cases
   *  production; learner only needs to recognise, not generate. Award 100%
   *  points but tag the evidence row as scaffold_assisted. */
  | "simplify_challenge"
  /** Light-touch story progression. The learner just tapped a
   *  narrative_choice option; runtime should NOT compute a quality grade,
   *  but record the option's cognitive_signal as a light-weight evidence
   *  row and let narrator render the option's narrative_payoff. */
  | "narrative_advance"
  /** Learner has met the current ladder rung's gate_to_next; runtime should
   *  bump ladder_progress.position by 1 and switch the active frame to the
   *  next rung's frame_id. Narrator runs in "handoff" mode for this turn. */
  | "escalate_frame";

/** Legacy scaffold form names — kept for backward compatibility with older
 *  Judge outputs. Always mapped to a ScaffoldStrategy at normalisation time. */
export type ScaffoldForm =
  | "hint_question"
  | "structure_template"
  | "concrete_analogy"
  | "step_breakdown";

/** The 8 authoritative cognitive scaffolding strategies. Each one has
 *  specific production rules in narrator.template's SCAFFOLD MODE section.
 *  Strategies are NOT UI — they are Narrator's content-level posture. */
export type ScaffoldStrategy =
  /** Give a complete good-answer sample; learner only identifies diffs. */
  | "worked_example"
  /** A:/B: two near-identical cases with different outcomes; learner picks. */
  | "contrastive_cases"
  /** Narrator walks step 1 for the learner; learner only tackles step 2. */
  | "chunked_walkthrough"
  /** Use a familiar domain as a bridge to the abstract concept. */
  | "analogy_bridge"
  /** Only ask for recall of something the learner already established. */
  | "retrieval_prompt"
  /** Anchor to a PAST successful challenge the same learner completed. */
  | "near_transfer_demo"
  /** Make the hidden structure of the action explicit (rubric-as-checklist). */
  | "concept_scaffold"
  /** Ask the learner to self-explain what just happened in their own words. */
  | "self_explanation";

/** Map legacy form names to modern strategies. Used by Judge normalizer. */
export const SCAFFOLD_FORM_TO_STRATEGY: Record<ScaffoldForm, ScaffoldStrategy> = {
  hint_question: "retrieval_prompt",
  structure_template: "concept_scaffold",
  concrete_analogy: "analogy_bridge",
  step_breakdown: "chunked_walkthrough",
};

export interface ScaffoldSpec {
  /** Legacy field, retained so old Judge outputs still parse. Normalizer
   *  derives `strategy` from `form` if strategy is missing. */
  form?: ScaffoldForm;
  /** The canonical cognitive strategy for this scaffold turn. */
  strategy: ScaffoldStrategy;
  focus_dim: string;
  /** Optional free-form Judge note (what to emphasize in this specific scaffold). */
  notes?: string;
}

export type StuckReason =
  | "none"
  | "missing_context"
  | "missing_evidence"
  | "concept_confusion"
  | "cognitive_overload"
  | "transfer_failure"
  | "surface_level"
  | "self_help"
  | "frustration";

export interface JudgeDiagnosis {
  stuck_reason: StuckReason;
  /** Concrete text evidence for the diagnosis. Never a generic label. */
  evidence: string;
  /** Rubric dimensions that explain what is still blocking progress. */
  focus_dim_ids: string[];
  /** Response-frame fields that should be asked again, if a structured frame is used. */
  missing_field_ids: string[];
  confidence: "low" | "medium" | "high";
}

export interface JudgeOutput {
  quality: {
    dim_id: string;
    grade: Grade;
    evidence: string;
    /** Optional: Judge flags a dim-level quotable moment. runTurn aggregates
     *  to a single row-level `quotable` on evidence_log. */
    quotable?: boolean;
  }[];
  diagnosis: JudgeDiagnosis;
  path_decision: {
    type: PathDecisionType;
    target?: string | null;
    scaffold_spec?: ScaffoldSpec | null;
  };
  narrator_directive: string;
  companion_dispatch: {
    companion_id: string;
    role: "speaker" | "silent";
    directive: string;
    priority: number;
  }[];
  script_branch_switch?: string | null;
  event_triggers: { type: string; payload?: Record<string, unknown> }[];
  next_response_frame?: NextResponseFrameSelection | null;
}

export type HelpRequestKind = "hint" | "example" | "reveal";

export interface HelpRequest {
  kind: HelpRequestKind;
}

// ===== Ledger (PRD §8.2.1) =====

export interface LedgerRecord {
  call_id: string;
  trace_id: string;
  parent_span_id?: string | null;
  ts_start: string;
  ts_end: string;
  stage: Stage;
  caller: string;
  model: string;
  raw_input: unknown;
  raw_output: unknown;
  tokens: {
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
    total: number;
  };
  cache: { hit_ratio: number; ttl_remaining_sec: number | null };
  latency: { time_to_first_token_ms: number; total_duration_ms: number };
  cost_usd: number;
  context: Record<string, unknown>;
  lifecycle: {
    status: "success" | "error" | "timeout" | "fallback" | "truncated";
    retry_count: number;
    fallback_used: string | null;
    error_code: string | null;
    error_message: string | null;
  };
  user_visible: boolean;
  content_safety: { flagged: boolean; flags: string[] };
}
