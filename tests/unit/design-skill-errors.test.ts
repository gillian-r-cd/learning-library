import { describe, expect, it } from "vitest";
import { designSkillErrorStatus } from "@/lib/skills/errors";
import { LlmInvalidOutputError } from "@/lib/llm/retry";

describe("design skill API errors", () => {
  it("classifies upstream connection failures as bad gateway instead of bad request", () => {
    expect(designSkillErrorStatus(new Error("Connection error."))).toBe(502);
  });

  it("keeps user/input validation failures as bad request", () => {
    expect(designSkillErrorStatus(new Error("step1 or step2 not ready"))).toBe(400);
  });

  it("classifies invalid upstream LLM output as bad gateway", () => {
    expect(
      designSkillErrorStatus(new LlmInvalidOutputError("skill_3 fill invalid JSON"))
    ).toBe(502);
  });
});
