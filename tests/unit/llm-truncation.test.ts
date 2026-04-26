import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `llm-trunc-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
// Force real-API branch in llmCall: ANTHROPIC_API_KEY present, LLM_MOCK unset.
process.env.ANTHROPIC_API_KEY = "test-key-not-used";
delete process.env.LLM_MOCK;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  }
});

beforeEach(() => {
  createMock.mockReset();
});

// Stub the SDK so we can drive any stop_reason we want without a network call.
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: createMock };
    constructor(_args: unknown) {}
  }
  return { default: FakeAnthropic };
});

describe("llmCall · truncation detection", () => {
  it("throws LlmTruncatedError when Anthropic returns stop_reason=max_tokens", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"partial": "result with tail cut' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 100, output_tokens: 3500 },
    });
    const { llmCall, LlmTruncatedError } = await import("@/lib/llm");
    await expect(
      llmCall({
        caller: "judge", // any caller with a prompt entry works
        stage: "learning",
        variables: {},
      })
    ).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("does not throw when stop_reason=end_turn", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"ok": true}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const { llmCall } = await import("@/lib/llm");
    const res = await llmCall({
      caller: "judge",
      stage: "learning",
      variables: {},
    });
    expect(res).toBeTruthy();
    expect(res.text).toContain("ok");
  });

  it("throws LlmProviderError instead of returning empty text on Anthropic API errors", async () => {
    createMock.mockRejectedValueOnce(
      new Error('403 {"error":{"type":"forbidden","message":"Request not allowed"}}')
    );
    const { llmCall, LlmProviderError } = await import("@/lib/llm");

    await expect(
      llmCall({
        caller: "narrator",
        stage: "learning",
        variables: {},
        userVisible: true,
      })
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("passes claude-opus-4-6 through to Anthropic create params", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"ok": true}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { llmCall } = await import("@/lib/llm");

    await llmCall({
      caller: "judge",
      stage: "learning",
      variables: {},
      modelOverride: "claude-opus-4-6",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-6",
        temperature: expect.any(Number),
      })
    );
  });
});
