import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `reset-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("resetPromptToSeed — undoes poisoned prompts", () => {
  it("restores the built-in body and marks the replacement in audit", async () => {
    const { getEffectivePrompt, upsertPrompt } = await import("@/lib/prompt-store");
    const { resetPromptToSeed, getBuiltinBody } = await import("@/lib/prompt-store/seed");

    // Force-seed by reading once
    const before = getEffectivePrompt("narrator", null);
    expect(before.system).toContain("Narrator");

    // Simulate the debug pollution we caused in an earlier session:
    // admin-ui wrote a bogus v2 that sits on top of the seeded v1.
    upsertPrompt({
      key: "narrator.template",
      scope: "system",
      status: "published",
      body: {
        system: "POISONED",
        messages: [{ role: "user", content: "x" }],
      },
      created_by: "admin-ui",
      note: "dirty debug data",
    });

    const poisoned = getEffectivePrompt("narrator", null);
    expect(poisoned.system).toBe("POISONED");

    // Recover
    const result = resetPromptToSeed("narrator.template");
    expect(result.replaced_user_edit).toBe(true);
    expect(result.new_version).toBeGreaterThan(result.previous_version ?? 0);

    const recovered = getEffectivePrompt("narrator", null);
    expect(recovered.system).not.toBe("POISONED");
    expect(recovered.system).toContain("Narrator");
    // And the body matches the built-in exactly (verifying no partial overwrite).
    const builtin = getBuiltinBody("narrator.template");
    expect(recovered.system).toBe(builtin?.system);
  });

  it("rejects non-builtin keys", async () => {
    const { resetPromptToSeed } = await import("@/lib/prompt-store/seed");
    expect(() => resetPromptToSeed("not_a_real_key")).toThrow(/built-in/);
  });

  it("works even on a fresh key that was never seeded", async () => {
    // If for some reason judge.template is missing from DB, reset should
    // still insert it as v1.
    const { resetPromptToSeed } = await import("@/lib/prompt-store/seed");
    // judge.template was seeded by ensureSeed earlier; reset should produce
    // a new version with created_by='seed'.
    const result = resetPromptToSeed("judge.template");
    expect(result.key).toBe("judge.template");
    expect(result.scope).toBe("system");
    expect(result.new_version).toBeGreaterThan(0);
  });
});
