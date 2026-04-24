import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `orient-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("immersive opening — learner arrives in one narrator bubble", () => {
  it("createLearnerState writes exactly one challenge_opening narrator bubble", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listConversation } = await import("@/lib/state-manager");

    const bp = createBlueprint("沉浸开场主题", "d_orient");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const conv = listConversation(learner.learner_id);

    // Opening is now ONE narrator bubble with meta.kind === "challenge_opening".
    const openings = conv.filter(
      (c) => c.role === "narrator" && c.meta?.kind === "challenge_opening"
    );
    expect(openings.length).toBe(1);

    // The immersive opening must be a substantive second-person paragraph,
    // not a boilerplate course-description. Length ≥ 30 chars is a generous floor.
    expect(openings[0].text.length).toBeGreaterThanOrEqual(30);

    // It must NOT start with the legacy 【xxx】 title-label prefix, and must not
    // contain any of the banned meta-preamble phrases.
    expect(openings[0].text).not.toMatch(/^【/);
    expect(openings[0].text).not.toMatch(/欢迎来到/);
    expect(openings[0].text).not.toMatch(/共\s*\d+\s*章，预计/);

    // There is no longer an "orientation_journey" system bubble or
    // "orientation_role" bubble. Meta tour has been removed.
    const kinds = conv.map((c) => c.meta?.kind);
    expect(kinds).not.toContain("orientation_journey");
    expect(kinds).not.toContain("orientation_role");
  });

  it("ensureJourneyOrientation catches up legacy learners without duplicating", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const {
      listConversation,
      ensureJourneyOrientation,
      createLearnerState,
    } = await import("@/lib/state-manager");

    const bp = createBlueprint("老学员迁移主题", "d_legacy");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    // Simulate a legacy learner: create state and wipe all conversation so the
    // patch path fires.
    const learner = await createLearnerState(bp.blueprint_id);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.LL_DB_PATH!);
    db.prepare(`DELETE FROM conversation_log WHERE learner_id = ?`).run(learner.learner_id);
    db.close();
    expect(listConversation(learner.learner_id).length).toBe(0);

    const fired = await ensureJourneyOrientation(learner.learner_id);
    expect(fired).toBe(true);

    const conv = listConversation(learner.learner_id);
    const openings = conv.filter(
      (c) => c.role === "narrator" && c.meta?.kind === "challenge_opening"
    );
    expect(openings.length).toBe(1);

    // Idempotent: running again must be a no-op.
    const fired2 = await ensureJourneyOrientation(learner.learner_id);
    expect(fired2).toBe(false);
    expect(listConversation(learner.learner_id).length).toBe(conv.length);
  });
});
