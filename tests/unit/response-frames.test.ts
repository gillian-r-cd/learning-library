import { describe, it, expect } from "vitest";
import type { Challenge } from "@/lib/types/core";
import {
  canonicalizeStructuredResponse,
  normalizeResponseFrames,
  resolveActiveResponseFrame,
  validateStructuredResponse,
} from "@/lib/learning-runtime/response-frames";

describe("response frame normalisation", () => {
  it("adds a free_text_default frame when a challenge has no response_frames", () => {
    const challenge = {
      challenge_id: "ch1",
      title: "诊断准备度",
      binds_actions: ["a1"],
      complexity: "low",
      trunk: { setup: "setup", action_prompts: [], expected_signals: [] },
      companion_hooks: [],
    } satisfies Challenge;

    const { frames, defaultFrameId } = normalizeResponseFrames(challenge);

    expect(defaultFrameId).toBe("free_text_default");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      frame_id: "free_text_default",
      kind: "free_text",
      fields: [{ field_id: "text", type: "textarea" }],
    });
  });

  it("falls back to the default frame when runtime selection is invalid", () => {
    const challenge = {
      challenge_id: "ch1",
      title: "诊断准备度",
      binds_actions: ["a1"],
      complexity: "low",
      trunk: { setup: "setup", action_prompts: [], expected_signals: [] },
      companion_hooks: [],
      default_response_frame_id: "rf_choice",
      response_frames: [
        {
          frame_id: "rf_choice",
          version: 1,
          kind: "single_choice",
          title: "选择判断",
          prompt: "选择一个准备度。",
          binds_actions: ["a1"],
          fields: [
            {
              field_id: "readiness",
              type: "radio",
              label: "准备度",
              required: true,
              options: [{ value: "r2", label: "R2" }],
            },
          ],
        },
      ],
    } satisfies Challenge;

    const active = resolveActiveResponseFrame(challenge, { frame_id: "missing", reason: "bad" });

    expect(active.frame_id).toBe("rf_choice");
  });
});

describe("structured learner response", () => {
  const challenge = {
    challenge_id: "ch1",
    title: "诊断准备度",
    binds_actions: ["a1"],
    complexity: "low",
    trunk: { setup: "setup", action_prompts: [], expected_signals: [] },
    companion_hooks: [],
    response_frames: [
      {
        frame_id: "rf_form",
        version: 1,
        kind: "form",
        title: "准备度诊断表",
        prompt: "拆开填写。",
        binds_actions: ["a1"],
        fields: [
          { field_id: "person", type: "text", label: "对象", required: true },
          {
            field_id: "ability",
            type: "radio",
            label: "能力水平",
            required: true,
            options: [
              { value: "low", label: "低" },
              { value: "medium", label: "中" },
              { value: "high", label: "高" },
            ],
          },
          { field_id: "evidence", type: "textarea", label: "关键证据", required: true },
        ],
      },
    ],
    default_response_frame_id: "rf_form",
  } satisfies Challenge;

  it("rejects missing required values", () => {
    const frame = resolveActiveResponseFrame(challenge);
    const result = validateStructuredResponse(frame, {
      frame_id: "rf_form",
      frame_version: 1,
      values: { person: "陈悦", ability: "medium" },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("evidence is required");
  });

  it("canonicalizes structured values into stable Judge-readable text", () => {
    const frame = resolveActiveResponseFrame(challenge);
    const canonical = canonicalizeStructuredResponse(frame, {
      person: "陈悦",
      ability: "medium",
      evidence: "能复述流程，但回避承诺排期",
    });

    expect(canonical).toContain("学员使用结构化框架「准备度诊断表」作答");
    expect(canonical).toContain("- 对象：陈悦");
    expect(canonical).toContain("- 能力水平：中");
    expect(canonical).toContain("- 关键证据：能复述流程，但回避承诺排期");
  });
});
