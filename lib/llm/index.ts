// llm_call 统一 SDK（PRD §8.3, §8.6）
// 所有 LLM 调用必须走这里。负责：读 Prompt Store → 渲染模板 → 调 Anthropic API（或 mock）
// → 写 Ledger → 计费。

import { randomUUID } from "node:crypto";
import { writeLedger } from "@/lib/ledger";
import { renderTemplate, type PromptBody } from "@/lib/prompt-store/render";
import { getEffectivePrompt } from "@/lib/prompt-store";
import { mockForCaller } from "@/lib/llm/mock";
import type { LedgerRecord } from "@/lib/types/core";

export interface LlmCallArgs {
  caller: string;
  stage: "design" | "learning" | "eval";
  variables: Record<string, unknown>;
  traceId?: string;
  parentSpanId?: string;
  blueprintId?: string | null;
  learnerId?: string | null;
  userVisible?: boolean;
  context?: Record<string, unknown>;
  /** 可选强制模型；否则读 prompt body 的 model */
  modelOverride?: string;
}

export interface LlmCallResult {
  callId: string;
  traceId: string;
  output: unknown;
  /** 为 JSON skills 提供的 parsed 便捷字段 */
  parsed?: unknown;
  text: string;
  tokens: LedgerRecord["tokens"];
  latencyMs: number;
}

export async function llmCall(args: LlmCallArgs): Promise<LlmCallResult> {
  const callId = `call_${randomUUID().slice(0, 8)}`;
  const traceId = args.traceId ?? `trc_${randomUUID().slice(0, 8)}`;
  const tsStart = new Date().toISOString();
  const startMs = Date.now();

  // 1) 读取系统级 + 课程级 prompt（两级继承）
  const prompt = getEffectivePrompt(args.caller, args.blueprintId ?? null);

  // 2) 渲染模板（占位符替换）
  const rendered = renderTemplate(prompt, args.variables);

  // 3) 调用 LLM（mock 或 real）。默认走最强的 Opus；per-caller 可在 prompt body 里
  //    覆盖（例如 haiku 用于高频低延迟的 Companion / summary / recap）。
  const useMock = !process.env.ANTHROPIC_API_KEY || process.env.LLM_MOCK === "1";
  const model = args.modelOverride ?? prompt.model ?? "claude-opus-4-7";

  // One-time stderr warning per process so users never silently eat mock data.
  warnMockModeOnce(useMock);

  let output: unknown;
  let text: string;
  let promptTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let status: "success" | "error" | "timeout" | "fallback" | "truncated" =
    "success";
  let errorMessage: string | null = null;
  let truncationError: LlmTruncatedError | null = null;

  try {
    if (useMock) {
      const mocked = mockForCaller(args.caller, args.variables, prompt);
      output = mocked.output;
      text = mocked.text;
      promptTokens = mocked.promptTokens;
      outputTokens = mocked.outputTokens;
      cacheRead = mocked.cacheRead;
    } else {
      const real = await callAnthropicReal(rendered, model);
      output = real.output;
      text = real.text;
      promptTokens = real.promptTokens;
      outputTokens = real.outputTokens;
      cacheRead = real.cacheRead;
      cacheCreation = real.cacheCreation;

      // Hard-fail on max_tokens truncation. If we let this slide, `jsonrepair`
      // in extractJson below would silently salvage the broken tail into a
      // structurally-valid object — exactly how Skill 3 started shipping
      // duplicated challenges. Mark ledger as truncated + throw.
      if (real.stopReason === "max_tokens") {
        status = "truncated";
        truncationError = new LlmTruncatedError({
          caller: args.caller,
          model,
          maxTokens: rendered.max_tokens ?? 0,
          outputTokens: real.outputTokens,
        });
        errorMessage = truncationError.message;
        console.warn(`[llm] ${truncationError.message}`);
      }
    }
  } catch (e) {
    status = "error";
    errorMessage = (e as Error).message;
    output = { error: errorMessage };
    text = "";
  }

  const tsEnd = new Date().toISOString();
  const totalDurationMs = Date.now() - startMs;

  // 4) Parse JSON robustly — real Claude often wraps in ```json fences,
  //    adds preamble ("Here is…"), or trailing commentary. Try multiple strategies.
  const parsed = extractJson(text);

  const cacheHitRatio =
    promptTokens + cacheRead > 0
      ? cacheRead / (promptTokens + cacheRead)
      : 0;

  const record: LedgerRecord = {
    call_id: callId,
    trace_id: traceId,
    parent_span_id: args.parentSpanId ?? null,
    ts_start: tsStart,
    ts_end: tsEnd,
    stage: args.stage,
    caller: args.caller,
    model,
    raw_input: rendered,
    raw_output: output,
    tokens: {
      input: promptTokens,
      output: outputTokens,
      cache_creation: cacheCreation,
      cache_read: cacheRead,
      total: promptTokens + outputTokens + cacheCreation + cacheRead,
    },
    cache: { hit_ratio: cacheHitRatio, ttl_remaining_sec: null },
    latency: {
      time_to_first_token_ms: Math.max(200, Math.floor(totalDurationMs * 0.3)),
      total_duration_ms: totalDurationMs,
    },
    cost_usd: estimateCost(model, promptTokens, outputTokens),
    context: {
      ...args.context,
      blueprint_id: args.blueprintId ?? null,
      learner_id: args.learnerId ?? null,
      prompt_version: {
        system_level: prompt.systemVersion,
        course_level: prompt.courseVersion,
      },
    },
    lifecycle: {
      status,
      retry_count: 0,
      fallback_used: useMock ? "mock_mode" : null,
      error_code: null,
      error_message: errorMessage,
    },
    user_visible: args.userVisible ?? false,
    content_safety: { flagged: false, flags: [] },
  };

  writeLedger(record, {
    learner_id: args.learnerId ?? null,
    blueprint_id: args.blueprintId ?? null,
  });

  // Ledger is written first so truncated responses are inspectable, then we
  // throw — callers MUST NOT see a partial/repaired result.
  if (truncationError) throw truncationError;

  return {
    callId,
    traceId,
    output,
    parsed,
    text,
    tokens: record.tokens,
    latencyMs: totalDurationMs,
  };
}

// ============ Real Anthropic call ============

interface AnthropicResult {
  output: unknown;
  text: string;
  promptTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  stopReason: string | null;
}

async function callAnthropicReal(
  body: { system: string; messages: { role: string; content: string }[]; max_tokens?: number; temperature?: number },
  model: string
): Promise<AnthropicResult> {
  // Dynamic import so that bundlers don't pull SDK into the client
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Opus 4.7 (and later) no longer accept a `temperature` parameter — it is
  // auto-tuned by the model. Only pass temperature to models that support it.
  const supportsTemperature = !modelDropsTemperature(model);

  // Build create() params. Use a structural type so we can conditionally set
  // temperature without fighting the SDK's overloads (which also support stream).
  const params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    temperature?: number;
  } = {
    model,
    max_tokens: body.max_tokens ?? 1024,
    system: body.system,
    messages: body.messages as { role: "user" | "assistant"; content: string }[],
  };
  if (supportsTemperature) {
    params.temperature = body.temperature ?? 0.7;
  }
  const resp = (await client.messages.create(params)) as {
    content: { type: string; text?: string }[];
    stop_reason?: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  const text =
    resp.content
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n") || "";
  return {
    output: resp,
    text,
    promptTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
    cacheRead: resp.usage.cache_read_input_tokens ?? 0,
    cacheCreation: resp.usage.cache_creation_input_tokens ?? 0,
    stopReason: resp.stop_reason ?? null,
  };
}

/** Thrown when the real API returns stop_reason === "max_tokens". Surfaced
 *  so callers can't silently accept a truncated response (which `jsonrepair`
 *  would otherwise salvage into a structurally-valid but semantically-broken
 *  object — see the Skill 3 duplicate-challenges incident). */
export class LlmTruncatedError extends Error {
  readonly code = "llm_truncated" as const;
  readonly caller: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly outputTokens: number;
  constructor(args: {
    caller: string;
    model: string;
    maxTokens: number;
    outputTokens: number;
  }) {
    super(
      `LLM output truncated (stop_reason=max_tokens). caller=${args.caller} model=${args.model} max_tokens=${args.maxTokens} output_tokens=${args.outputTokens}. Bump max_tokens in the prompt-store entry.`
    );
    this.name = "LlmTruncatedError";
    this.caller = args.caller;
    this.model = args.model;
    this.maxTokens = args.maxTokens;
    this.outputTokens = args.outputTokens;
  }
}

// Track whether we've already logged the mock-mode banner this process.
let _mockWarnLogged = false;
function warnMockModeOnce(useMock: boolean): void {
  if (_mockWarnLogged) return;
  _mockWarnLogged = true;
  if (useMock) {
    const reason =
      process.env.LLM_MOCK === "1"
        ? "LLM_MOCK=1 is set"
        : "ANTHROPIC_API_KEY is missing";
    console.warn(
      `[llm] RUNNING IN MOCK MODE (${reason}). All Skill/Judge/Narrator/Companion outputs are deterministic mock data, not real LLM calls. Unset LLM_MOCK and set ANTHROPIC_API_KEY to use the real API.`
    );
  } else {
    console.info("[llm] running in REAL mode (Anthropic API)");
  }
}

// ============ JSON extraction ============
// Real LLMs routinely emit JSON with:
//  - markdown fences (```json … ```)
//  - preamble or trailing commentary
//  - unescaped nested quotes in Chinese text ("自驱力强，但有时越权")
//  - trailing commas, single quotes, missing quotes on keys
// We try strict parse first; on failure, repair via `jsonrepair` before failing.

import { jsonrepair } from "jsonrepair";

function extractJson(text: string): unknown | undefined {
  if (!text || typeof text !== "string") return undefined;
  const trimmed = text.trim();

  const candidates: string[] = [trimmed];

  // Strategy B: fenced ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());

  // Strategy C: slice from first `{` to last `}`
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  // Strategy D: slice from first `[` to last `]`
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1));

  // First pass: strict JSON.parse on every candidate
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* continue */
    }
  }

  // Second pass: jsonrepair (handles unescaped quotes, trailing commas, etc.)
  for (const c of candidates) {
    try {
      const repaired = jsonrepair(c);
      return JSON.parse(repaired);
    } catch {
      /* continue */
    }
  }

  return undefined;
}

/** Models that have deprecated the `temperature` parameter. */
function modelDropsTemperature(model: string): boolean {
  // Opus 4.7 onwards uses auto-temperature. Previous Opus/Sonnet/Haiku still accept it.
  return /^claude-opus-4-7/.test(model);
}

// ============ Cost estimation ============

function estimateCost(model: string, input: number, output: number): number {
  // Per-1M-token pricing for estimation.
  const prices: Record<string, { in: number; out: number }> = {
    "claude-opus-4-7": { in: 15, out: 75 },
    "claude-sonnet-4-6": { in: 3, out: 15 },
    "claude-haiku-4-5": { in: 1, out: 5 },
  };
  const p = prices[model] ?? prices["claude-opus-4-7"];
  return (input * p.in + output * p.out) / 1_000_000;
}

export type { PromptBody };
