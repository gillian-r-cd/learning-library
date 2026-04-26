import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("prompt-store two-tier inheritance", () => {
  it("returns system-level prompt when no course override", async () => {
    const { getEffectivePrompt } = await import("@/lib/prompt-store");
    const p = getEffectivePrompt("skill_1_gamecore", null);
    expect(p.system).toContain("教学设计");
    expect(p.systemVersion).toBe(1);
    expect(p.courseVersion).toBeNull();
  });

  it("course-level prompt overrides system-level", async () => {
    const { getEffectivePrompt, upsertPrompt } = await import("@/lib/prompt-store");
    upsertPrompt({
      key: "skill_1_gamecore.template",
      scope: "course:bp_test",
      status: "published",
      body: {
        system: "COURSE-LEVEL SPECIFIC: 该课程有不同语气",
        messages: [{ role: "user", content: "overridden" }],
        model: "claude-haiku-4-5",
        temperature: 0.1,
      },
      created_by: "unit-test",
    });
    const p = getEffectivePrompt("skill_1_gamecore", "bp_test");
    expect(p.system).toContain("COURSE-LEVEL");
    expect(p.courseVersion).not.toBeNull();
  });

  it("keeps only the latest published prompt visible per key and scope", async () => {
    const { listPromptKeys, upsertPrompt } = await import("@/lib/prompt-store");

    upsertPrompt({
      key: "judge.template",
      scope: "system",
      status: "published",
      body: {
        system: "JUDGE V2",
        messages: [{ role: "user", content: "v2" }],
      },
      created_by: "unit-test",
    });
    const latest = upsertPrompt({
      key: "judge.template",
      scope: "system",
      status: "published",
      body: {
        system: "JUDGE V3",
        messages: [{ role: "user", content: "v3" }],
      },
      created_by: "unit-test",
    });

    const judgeRows = listPromptKeys().filter(
      (row) => row.key === "judge.template" && row.scope === "system"
    );
    expect(judgeRows).toHaveLength(1);
    expect(judgeRows[0].version).toBe(latest.version);
  });

  it("renderTemplate substitutes variables", async () => {
    const { renderTemplate } = await import("@/lib/prompt-store/render");
    const body = {
      system: "Hello {{name}}!",
      messages: [{ role: "user" as const, content: "List: {{items}}" }],
    };
    const r = renderTemplate(body, { name: "Elena", items: ["a", "b"] });
    expect(r.system).toBe("Hello Elena!");
    expect(r.messages[0].content).toContain("a");
  });
});
