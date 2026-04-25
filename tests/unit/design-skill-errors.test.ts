import { describe, expect, it } from "vitest";
import { designSkillErrorStatus } from "@/lib/skills/errors";

describe("design skill API errors", () => {
  it("classifies upstream connection failures as bad gateway instead of bad request", () => {
    expect(designSkillErrorStatus(new Error("Connection error."))).toBe(502);
  });

  it("keeps user/input validation failures as bad request", () => {
    expect(designSkillErrorStatus(new Error("step1 or step2 not ready"))).toBe(400);
  });
});
