import { describe, expect, it } from "vitest";
import { getBuiltinBody, listBuiltinKeys, PROMPT_STYLE_GUARD } from "@/lib/prompt-store/seed";

describe("built-in prompt style guard", () => {
  it("adds the anti-AI style rules to every built-in system prompt", () => {
    for (const { key } of listBuiltinKeys()) {
      const body = getBuiltinBody(key);
      expect(body?.system, key).toContain(PROMPT_STYLE_GUARD);
    }
  });

  it("keeps high-risk AI-flavored wording out of prompt bodies after the guard", () => {
    const banned = [
      "舞台",
      "我接住你了",
      "高瞻远瞩",
      "战略高度",
      "浪潮",
      "驾驭",
      "基石",
      "引擎",
      "进化",
      "蓝图",
      "孤岛",
      "鸿沟",
      "催化剂",
      "弹药库",
      "路线图",
      "副驾驶",
      "不仅",
      "更是",
      "——",
    ];

    for (const { key } of listBuiltinKeys()) {
      const body = getBuiltinBody(key);
      const promptBody = body?.system.replace(PROMPT_STYLE_GUARD, "") ?? "";
      for (const word of banned) {
        expect(promptBody.includes(word), `${key} contains ${word}`).toBe(false);
      }
      expect(/不是[\s\S]{0,24}而是/.test(promptBody), `${key} contains 不是...而是`).toBe(false);
    }
  });
});
