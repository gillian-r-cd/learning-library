import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `learner-view-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

async function seedReadyBlueprint(topic: string) {
  const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
  const {
    runSkill1,
    runSkill2,
    runSkill3Fill,
    runSkill3Skeleton,
    runSkill4,
    runSkill5,
  } = await import("@/lib/skills");
  const bp = createBlueprint(topic, "d_lv");
  await runSkill1(bp.blueprint_id);
  await runSkill2(bp.blueprint_id);
  const sk = await runSkill3Skeleton(bp.blueprint_id);
  await runSkill3Fill(bp.blueprint_id, sk.skeleton);
  await runSkill4(bp.blueprint_id);
  await runSkill5(bp.blueprint_id);
  return getBlueprint(bp.blueprint_id)!;
}

describe("buildPointsBreakdown — learner-visible points audit trail", () => {
  it("returns entries with base×multiplier = earned and totals aggregated by action", async () => {
    const bp = await seedReadyBlueprint("积分明细主题");
    const { createLearnerState, applyJudgeOutput } = await import(
      "@/lib/state-manager"
    );
    const { buildPointsBreakdown } = await import(
      "@/lib/learning-runtime/learner-view"
    );

    const learner = await createLearnerState(bp.blueprint_id);

    // Directly call applyJudgeOutput twice to create two evidence rows.
    // (Bypasses runTurn to keep this test deterministic without any LLM.)
    applyJudgeOutput({
      learnerId: learner.learner_id,
      grades: { d1: "good", d2: "good", d3: "medium" },
      actionId: "a1",
      evidence: "t1 evidence",
      complexity: "low",
      decisionType: "advance",
    });
    applyJudgeOutput({
      learnerId: learner.learner_id,
      grades: { d1: "medium", d2: "poor" },
      actionId: "a1",
      evidence: "t2 evidence",
      complexity: "medium",
      decisionType: "retry",
    });

    const breakdown = buildPointsBreakdown(learner.learner_id, bp);
    // newest first
    expect(breakdown.entries).toHaveLength(2);

    const newest = breakdown.entries[0];
    expect(newest.evidence).toBe("t2 evidence");
    expect(newest.complexity).toBe("medium");
    // grades: d1=medium(1) + d2=poor(0) = 1 base, × 1.5 = 1.5
    expect(newest.base_points).toBe(1);
    expect(newest.complexity_multiplier).toBe(1.5);
    expect(newest.points_earned).toBeCloseTo(1.5, 1);

    const oldest = breakdown.entries[1];
    expect(oldest.evidence).toBe("t1 evidence");
    expect(oldest.complexity).toBe("low");
    // grades: d1=good(3) + d2=good(3) + d3=medium(1) = 7 base, × 1.0 = 7
    expect(oldest.base_points).toBe(7);
    expect(oldest.complexity_multiplier).toBe(1.0);
    expect(oldest.points_earned).toBeCloseTo(7, 1);

    // totals aggregated by action
    expect(breakdown.totals.raw).toBeCloseTo(8.5, 1);
    expect(breakdown.totals.by_action.a1.count).toBe(2);
    expect(breakdown.totals.by_action.a1.raw).toBeCloseTo(8.5, 1);
    expect(breakdown.totals.by_action.a1.action_name).toBeTruthy();
  });

  it("handles legacy evidence rows without stored points_earned/complexity by recomputing", async () => {
    const bp = await seedReadyBlueprint("legacy 兼容主题");
    const { createLearnerState } = await import("@/lib/state-manager");
    const { buildPointsBreakdown } = await import(
      "@/lib/learning-runtime/learner-view"
    );
    const { db } = await import("@/lib/db");

    const learner = await createLearnerState(bp.blueprint_id);

    // Write a legacy row directly (no points_earned, no complexity).
    db()
      .prepare(
        `INSERT INTO evidence_log
           (learner_id, ts, challenge_id, action_id, turn_idx, grades_json, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        learner.learner_id,
        new Date().toISOString(),
        bp.step3_script!.chapters[0].challenges[0].challenge_id,
        "a1",
        0,
        JSON.stringify({ d1: "good", d2: "medium" }),
        "legacy evidence"
      );

    const breakdown = buildPointsBreakdown(learner.learner_id, bp);
    expect(breakdown.entries).toHaveLength(1);
    const e = breakdown.entries[0];
    // Complexity looked up from blueprint (first challenge is "low" in mock).
    expect(e.complexity).toBe("low");
    // Recomputed: good(3) + medium(1) = 4, × 1.0 = 4
    expect(e.base_points).toBe(4);
    expect(e.points_earned).toBeCloseTo(4, 1);
  });
});

describe("buildCompanionLibrary — unlocked + locked with rich cards", () => {
  it("separates unlocked from locked and carries recent_speeches for unlocked ones", async () => {
    const bp = await seedReadyBlueprint("伴学库主题");
    const { createLearnerState, saveLearnerState, getLearnerState, appendConversation } =
      await import("@/lib/state-manager");
    const { buildCompanionLibrary } = await import(
      "@/lib/learning-runtime/learner-view"
    );

    const learner = await createLearnerState(bp.blueprint_id);
    // Force-unlock the first companion at level 1
    const s = getLearnerState(learner.learner_id)!;
    const firstComp = bp.step4_companions!.companions[0];
    s.unlocked_companions = [
      { companion_id: firstComp.companion_id, level: 1, unlocked_at: new Date().toISOString() },
    ];
    saveLearnerState(s);

    // Log two speeches from that companion.
    appendConversation({
      learner_id: learner.learner_id,
      turn_idx: 1,
      chapter_id: "c1",
      challenge_id: "c1_ch1",
      role: "companion",
      who: firstComp.display_name,
      text: "companion speech 1",
    });
    appendConversation({
      learner_id: learner.learner_id,
      turn_idx: 2,
      chapter_id: "c1",
      challenge_id: "c1_ch1",
      role: "companion",
      who: firstComp.display_name,
      text: "companion speech 2",
    });

    const lib = buildCompanionLibrary(learner.learner_id, bp, s, /*effective*/ 15);

    expect(lib.unlocked).toHaveLength(1);
    expect(lib.unlocked[0].companion_id).toBe(firstComp.companion_id);
    expect(lib.unlocked[0].display_name).toBe(firstComp.display_name);
    expect(lib.unlocked[0].speech_count).toBe(2);
    // newest first
    expect(lib.unlocked[0].recent_speeches[0].text).toBe("companion speech 2");
    // Carries the full intro fields
    expect(lib.unlocked[0].unique_value_hypothesis.length).toBeGreaterThan(0);
    expect(lib.unlocked[0].speak_when.length).toBeGreaterThan(0);

    // Locked companions have progress + points_needed
    expect(lib.locked.length).toBe(bp.step4_companions!.companions.length - 1);
    for (const l of lib.locked) {
      expect(l.effective_total_now).toBe(15);
      expect(l.points_needed).toBeGreaterThanOrEqual(0);
      expect(l.unlock_threshold).toBeGreaterThan(0);
    }
    // Locked sorted by threshold ascending
    const thresholds = lib.locked.map((l) => l.unlock_threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
  });
});
