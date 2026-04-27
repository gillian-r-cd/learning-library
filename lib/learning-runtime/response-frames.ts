import type {
  ActionMasteryRecord,
  Challenge,
  LadderProgress,
  LearnerStructuredResponse,
  NextResponseFrameSelection,
  ResponseField,
  ResponseFrame,
  ScaffoldLadderGate,
  ScaffoldLadderRung,
} from "@/lib/types/core";

export interface NormalizedResponseFrames {
  frames: ResponseFrame[];
  defaultFrameId: string;
}

export interface StructuredResponseInput {
  frame_id: string;
  frame_version?: number;
  values: Record<string, unknown>;
}

export interface ResponseValidationResult {
  ok: boolean;
  errors: string[];
}

export const FREE_TEXT_FRAME_ID = "free_text_default";

export function defaultFreeTextFrame(bindActions: string[] = []): ResponseFrame {
  return {
    frame_id: FREE_TEXT_FRAME_ID,
    version: 1,
    kind: "free_text",
    title: "自然语言回复",
    prompt: "用你的话回应当前挑战。",
    submit_label: "发送",
    binds_actions: bindActions,
    fields: [
      {
        field_id: "text",
        type: "textarea",
        label: "你的回复",
        required: true,
        validation: { min_length: 1, max_length: 2000 },
      },
    ],
  };
}

export function normalizeResponseFrames(challenge: Pick<Challenge, "binds_actions" | "response_frames" | "default_response_frame_id">): NormalizedResponseFrames {
  const fallback = defaultFreeTextFrame(challenge.binds_actions);
  const seen = new Set<string>();
  const frames: ResponseFrame[] = [];

  for (const raw of challenge.response_frames ?? []) {
    const frame = normalizeFrame(raw, challenge.binds_actions);
    if (!frame || seen.has(frame.frame_id)) continue;
    seen.add(frame.frame_id);
    frames.push(frame);
  }

  if (!seen.has(FREE_TEXT_FRAME_ID)) {
    frames.unshift(fallback);
    seen.add(FREE_TEXT_FRAME_ID);
  }

  const requestedDefault = challenge.default_response_frame_id;
  const defaultFrameId =
    requestedDefault && seen.has(requestedDefault) ? requestedDefault : FREE_TEXT_FRAME_ID;

  return { frames, defaultFrameId };
}

export function normalizeChallengeResponseFrames(challenge: Challenge): Challenge {
  const { frames, defaultFrameId } = normalizeResponseFrames(challenge);
  const { ladder, defaultPosition } = normalizeScaffoldLadder(
    challenge.scaffold_ladder,
    challenge.default_ladder_position,
    frames
  );
  return {
    ...challenge,
    response_frames: frames,
    default_response_frame_id: defaultFrameId,
    ...(ladder ? { scaffold_ladder: ladder } : {}),
    ...(typeof defaultPosition === "number"
      ? { default_ladder_position: defaultPosition }
      : {}),
  };
}

/**
 * Validate + normalise a scaffold ladder against a challenge's actual frames.
 * - Each rung must reference an existing frame_id (else the rung is dropped).
 * - Rung.kind must match the frame's kind (else the rung is dropped).
 * - Positions are renumbered to 0..N-1 in the original order, gaps removed.
 * - default_ladder_position is clamped to [0, ladder.length-1].
 * - If less than 1 valid rung remains, the ladder is dropped entirely.
 */
export function normalizeScaffoldLadder(
  rawLadder: ScaffoldLadderRung[] | undefined,
  rawDefaultPosition: number | undefined,
  frames: ResponseFrame[]
): { ladder: ScaffoldLadderRung[] | null; defaultPosition: number | null } {
  if (!Array.isArray(rawLadder) || rawLadder.length === 0) {
    return { ladder: null, defaultPosition: null };
  }
  const frameById = new Map(frames.map((f) => [f.frame_id, f]));
  const valid: ScaffoldLadderRung[] = [];
  for (const raw of rawLadder) {
    if (!raw || typeof raw.frame_id !== "string") continue;
    const frame = frameById.get(raw.frame_id);
    if (!frame) continue;
    const declaredKind = raw.kind;
    const inferredKind: ScaffoldLadderRung["kind"] | null =
      frame.kind === "narrative_choice" || frame.kind === "form" || frame.kind === "free_text"
        ? frame.kind
        : null;
    if (!inferredKind) continue; // rung must point to one of the supported kinds
    if (declaredKind && declaredKind !== inferredKind) continue; // mismatch
    valid.push({
      position: valid.length, // renumber sequentially
      kind: inferredKind,
      frame_id: raw.frame_id,
      narrative_purpose: String(raw.narrative_purpose ?? "").trim(),
      gate_to_next: normalizeLadderGate(raw.gate_to_next, valid.length === rawLadder.length - 1),
    });
  }
  if (valid.length === 0) return { ladder: null, defaultPosition: null };
  const lastIndex = valid.length - 1;
  // Final rung must have null gate (no further escalation possible).
  valid[lastIndex] = { ...valid[lastIndex], gate_to_next: null };
  let defaultPosition = typeof rawDefaultPosition === "number" ? rawDefaultPosition : 0;
  if (defaultPosition < 0) defaultPosition = 0;
  if (defaultPosition > lastIndex) defaultPosition = lastIndex;
  return { ladder: valid, defaultPosition };
}

/** Resolve the active frame for a learner-on-challenge, ladder-aware.
 *  Priority order:
 *   1. If learner has an active_response_frame selection for this challenge,
 *      respect it (Judge previously dynamic-selected, e.g. via missing_field_ids).
 *   2. If the challenge has a scaffold_ladder + the learner has a
 *      ladder_progress entry, return the rung's frame at progress.position.
 *   3. Fall back to the challenge's default_response_frame_id.
 *   4. Final fallback: first frame in response_frames, or the implicit free_text.
 */
export interface LadderFrameResolution {
  frame: ResponseFrame;
  /** The rung the runtime resolved to; null if ladder is not active. */
  rung: ScaffoldLadderRung | null;
  /** The active learner-side selection, if any (untouched). */
  selection: NextResponseFrameSelection | null;
}

export function resolveLadderAwareFrame(args: {
  challenge: Pick<
    Challenge,
    | "binds_actions"
    | "response_frames"
    | "default_response_frame_id"
    | "scaffold_ladder"
    | "default_ladder_position"
  >;
  ladderProgress?: LadderProgress | null;
  selection?: NextResponseFrameSelection | null;
}): LadderFrameResolution {
  const { frames, defaultFrameId } = normalizeResponseFrames(args.challenge);
  // Ladder rung selection (only if no explicit selection wins).
  const ladder = args.challenge.scaffold_ladder ?? null;
  const progress = args.ladderProgress ?? null;
  const explicit = args.selection?.frame_id
    ? frames.find((f) => f.frame_id === args.selection!.frame_id)
    : null;
  if (explicit) {
    return { frame: explicit, rung: null, selection: args.selection ?? null };
  }
  if (ladder && progress) {
    const pos = Math.min(Math.max(progress.position, 0), ladder.length - 1);
    const rung = ladder[pos];
    const frame = frames.find((f) => f.frame_id === rung.frame_id);
    if (frame) {
      return { frame, rung, selection: null };
    }
  }
  const fallback =
    frames.find((f) => f.frame_id === defaultFrameId) ?? frames[0];
  if (!fallback) {
    return {
      frame: defaultFreeTextFrame(args.challenge.binds_actions),
      rung: null,
      selection: null,
    };
  }
  return { frame: fallback, rung: null, selection: null };
}

/** Test whether the learner has met the gate to climb to the next rung.
 *  Returns true → runtime should call escalateLadderPosition() before next turn. */
export function shouldEscalateLadder(
  rung: ScaffoldLadderRung,
  progress: LadderProgress,
  mastery?: ActionMasteryRecord
): boolean {
  const gate = rung.gate_to_next;
  if (!gate) return false;
  if (gate.type === "after_n_advances") {
    return progress.advances_at_position >= gate.n;
  }
  if (gate.type === "after_action_mastery_at_least") {
    if (!mastery) return false;
    return mastery.good_count >= gate.threshold;
  }
  // narrator_decision: the runtime never evaluates this; Judge or Narrator
  // raises path_decision.type === "escalate_frame" when conditions match.
  return false;
}

function normalizeLadderGate(
  raw: ScaffoldLadderGate | undefined | null,
  isLastRung: boolean
): ScaffoldLadderGate {
  if (isLastRung) return null;
  if (!raw) return { type: "after_n_advances", n: 1 };
  if (raw.type === "after_n_advances") {
    const n = Number((raw as { n?: number }).n ?? 1);
    return { type: "after_n_advances", n: Math.max(1, Math.floor(n)) };
  }
  if (raw.type === "after_action_mastery_at_least") {
    const threshold = Number((raw as { threshold?: number }).threshold ?? 1);
    return { type: "after_action_mastery_at_least", threshold: Math.max(1, Math.floor(threshold)) };
  }
  if (raw.type === "narrator_decision") {
    return { type: "narrator_decision", cue: String((raw as { cue?: string }).cue ?? "") };
  }
  // Unknown gate type — fall back to a safe default.
  return { type: "after_n_advances", n: 1 };
}

export function resolveActiveResponseFrame(
  challenge: Pick<Challenge, "binds_actions" | "response_frames" | "default_response_frame_id">,
  selection?: NextResponseFrameSelection | null
): ResponseFrame {
  const { frames, defaultFrameId } = normalizeResponseFrames(challenge);
  const selected = selection?.frame_id
    ? frames.find((frame) => frame.frame_id === selection.frame_id)
    : null;
  const base = selected ?? frames.find((frame) => frame.frame_id === defaultFrameId) ?? frames[0];
  if (!base) return defaultFreeTextFrame(challenge.binds_actions);
  if (!selected) return base;
  const narrowedFields = narrowFields(base.fields, selection?.field_ids);
  return {
    ...base,
    ...definedOverrides(selection?.overrides),
    fields: narrowedFields,
  };
}

export function validateStructuredResponse(
  frame: ResponseFrame,
  response: StructuredResponseInput
): ResponseValidationResult {
  const errors: string[] = [];
  if (response.frame_id !== frame.frame_id) {
    errors.push(`frame_id must be ${frame.frame_id}`);
  }
  for (const field of frame.fields) {
    const value = response.values?.[field.field_id];
    if (field.required && isEmptyValue(value)) {
      errors.push(`${field.field_id} is required`);
      continue;
    }
    validateFieldLength(field, value, errors);
  }
  return { ok: errors.length === 0, errors };
}

export function canonicalizeStructuredResponse(
  frame: ResponseFrame,
  values: Record<string, unknown>
): string {
  const lines = [`学员使用结构化框架「${frame.title}」作答：`];
  for (const field of frame.fields) {
    const value = values[field.field_id];
    if (isEmptyValue(value)) continue;
    lines.push(`- ${field.label}：${formatFieldValue(field, value)}`);
  }
  return lines.join("\n");
}

export function buildLearnerStructuredResponse(
  frame: ResponseFrame,
  input: StructuredResponseInput
): LearnerStructuredResponse {
  return {
    frame_id: frame.frame_id,
    frame_version: input.frame_version ?? frame.version,
    kind: frame.kind,
    values: input.values,
    canonical_text: canonicalizeStructuredResponse(frame, input.values),
  };
}

function normalizeFrame(raw: ResponseFrame, bindActions: string[]): ResponseFrame | null {
  if (!raw || typeof raw.frame_id !== "string" || !raw.frame_id.trim()) return null;
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) return null;
  return {
    frame_id: raw.frame_id,
    version: typeof raw.version === "number" && raw.version > 0 ? raw.version : 1,
    kind: raw.kind,
    title: raw.title?.trim() || "回复",
    prompt: raw.prompt?.trim() || "请完成本轮回复。",
    ...(raw.helper_text ? { helper_text: raw.helper_text } : {}),
    ...(raw.submit_label ? { submit_label: raw.submit_label } : {}),
    binds_actions: Array.isArray(raw.binds_actions) ? raw.binds_actions : bindActions,
    ...(Array.isArray(raw.expected_evidence_keys)
      ? { expected_evidence_keys: raw.expected_evidence_keys }
      : {}),
    fields: raw.fields.filter((f) => f?.field_id && f?.type && f?.label),
    ...(raw.validation ? { validation: raw.validation } : {}),
    ...(raw.fallback_frame_id ? { fallback_frame_id: raw.fallback_frame_id } : {}),
  };
}

function narrowFields(fields: ResponseField[], fieldIds?: string[]): ResponseField[] {
  if (!Array.isArray(fieldIds) || fieldIds.length === 0) return fields;
  const wanted = new Set(fieldIds.map((id) => id.trim()).filter(Boolean));
  const narrowed = fields.filter((field) => wanted.has(field.field_id));
  return narrowed.length > 0 ? narrowed : fields;
}

function definedOverrides(overrides?: NextResponseFrameSelection["overrides"]) {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => typeof value === "string" && value.trim())
  );
}

function validateFieldLength(field: ResponseField, value: unknown, errors: string[]) {
  const validation = field.validation;
  if (!validation || isEmptyValue(value)) return;
  if (typeof value === "string") {
    if (validation.min_length != null && value.length < validation.min_length) {
      errors.push(`${field.field_id} must be at least ${validation.min_length} characters`);
    }
    if (validation.max_length != null && value.length > validation.max_length) {
      errors.push(`${field.field_id} must be at most ${validation.max_length} characters`);
    }
  }
  if (Array.isArray(value)) {
    if (validation.min_items != null && value.length < validation.min_items) {
      errors.push(`${field.field_id} must include at least ${validation.min_items} items`);
    }
    if (validation.max_items != null && value.length > validation.max_items) {
      errors.push(`${field.field_id} must include at most ${validation.max_items} items`);
    }
  }
}

function formatFieldValue(field: ResponseField, value: unknown): string {
  const labelFor = (v: unknown) =>
    field.options?.find((opt) => opt.value === v)?.label ?? String(v);
  if (Array.isArray(value)) return value.map(labelFor).join("、");
  return labelFor(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
