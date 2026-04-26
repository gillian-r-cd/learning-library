import type {
  Challenge,
  LearnerStructuredResponse,
  NextResponseFrameSelection,
  ResponseField,
  ResponseFrame,
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
  return {
    ...challenge,
    response_frames: frames,
    default_response_frame_id: defaultFrameId,
  };
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
