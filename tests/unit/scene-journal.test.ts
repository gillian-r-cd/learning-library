import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `scene-journal-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

async function seedBlueprint(topic: string) {
  const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
  const {
    runSkill1,
    runSkill2,
    runSkill3Fill,
    runSkill3Skeleton,
    runSkill4,
    runSkill5,
  } = await import("@/lib/skills");
  const bp = createBlueprint(topic, "d_sj");
  await runSkill1(bp.blueprint_id);
  await runSkill2(bp.blueprint_id);
  const sk = await runSkill3Skeleton(bp.blueprint_id);
  await runSkill3Fill(bp.blueprint_id, sk.skeleton);
  await runSkill4(bp.blueprint_id);
  await runSkill5(bp.blueprint_id);
  return getBlueprint(bp.blueprint_id)!;
}

describe("buildSceneJournal — the guardrail that blocks character hallucination", () => {
  it("fresh learner: nameable_characters = incoming artifact chars, played_recap empty", async () => {
    const bp = await seedBlueprint("新学员场景日志");
    const { createLearnerState, getLearnerState } = await import("@/lib/state-manager");
    const { buildSceneJournal } = await import(
      "@/lib/learning-runtime/scene-journal"
    );

    const learner = await createLearnerState(bp.blueprint_id);
    const state = getLearnerState(learner.learner_id)!;

    const journal = buildSceneJournal({
      learnerId: learner.learner_id,
      blueprint: bp,
      learner: state,
    });

    expect(journal.played_challenges_recap).toHaveLength(0);
    // The mock blueprint gives each chapter's first challenge an
    // on_challenge_enter fields-type artifact (下属员工档案 with 姓名=陈雨).
    // incoming_characters should include 陈雨 and so should nameable_characters.
    expect(journal.nameable_characters.length).toBeGreaterThan(0);
    expect(
      journal.nameable_characters.some((c) => c.name === "陈雨")
    ).toBe(true);
  });

  it("after completing a challenge, played_recap carries the closing narrator text", async () => {
    const bp = await seedBlueprint("已完成挑战回顾");
    const { createLearnerState, appendConversation, saveLearnerState, getLearnerState } =
      await import("@/lib/state-manager");
    const { buildSceneJournal } = await import(
      "@/lib/learning-runtime/scene-journal"
    );

    const learner = await createLearnerState(bp.blueprint_id);
    const firstChapter = bp.step3_script!.chapters[0];
    const firstChallengeId = firstChapter.challenges[0].challenge_id;
    const secondChallengeId =
      firstChapter.challenges[1]?.challenge_id ??
      bp.step3_script!.chapters[1].challenges[0].challenge_id;
    const secondChapterId = firstChapter.challenges[1]
      ? firstChapter.chapter_id
      : bp.step3_script!.chapters[1].chapter_id;

    // Write a fake closing narrator for the first challenge.
    appendConversation({
      learner_id: learner.learner_id,
      turn_idx: 2,
      chapter_id: firstChapter.chapter_id,
      challenge_id: firstChallengeId,
      role: "narrator",
      text: "你从「做得很好」一路收到「核对跟进状态」，这条链就是情境领导力最底层的地基。",
      meta: { kind: "challenge_turn" },
    });
    // Mark completed + move learner to second challenge.
    const s = getLearnerState(learner.learner_id)!;
    s.completed_challenges = [firstChallengeId];
    s.position = {
      chapter_id: secondChapterId,
      challenge_id: secondChallengeId,
      turn_idx: 0,
    };
    saveLearnerState(s);

    const journal = buildSceneJournal({
      learnerId: learner.learner_id,
      blueprint: bp,
      learner: s,
    });
    expect(journal.played_challenges_recap).toHaveLength(1);
    const recap = journal.played_challenges_recap[0];
    expect(recap.challenge_id).toBe(firstChallengeId);
    expect(recap.closing_recap).toContain("做得很好");
    // The closing opening (LLM-produced from createLearnerState) must NOT be
    // what we capture — the test specifically injected a non-opening narrator
    // and that one should win.
    expect(recap.closing_recap).not.toContain("【");
  });
});

describe("CompanionHookMatcher — wires designer per-challenge hooks to active companions", () => {
  it("returns hooks only for companions that are unlocked AND meet min_level", async () => {
    const bp = await seedBlueprint("hook 匹配主题");
    const { matchActiveCompanionHooks } = await import(
      "@/lib/learning-runtime/companion-hooks"
    );
    const { createLearnerState, getLearnerState } = await import(
      "@/lib/state-manager"
    );

    const learner = await createLearnerState(bp.blueprint_id);
    const state = getLearnerState(learner.learner_id)!;
    const firstChallengeId = bp.step3_script!.chapters[0].challenges[0].challenge_id;

    // No companions unlocked → no hooks fire
    expect(
      matchActiveCompanionHooks({
        blueprint: bp,
        challengeId: firstChallengeId,
        learner: state,
      })
    ).toHaveLength(0);

    // Unlock the npc_guide companion — mock's skill_3_script_fill always
    // adds a hook with condition.companion_type === "npc_guide" min_level=1.
    const guide = bp.step4_companions!.companions.find(
      (c) => c.companion_type === "npc_guide"
    )!;
    state.unlocked_companions = [
      { companion_id: guide.companion_id, level: 1, unlocked_at: new Date().toISOString() },
    ];
    const hits = matchActiveCompanionHooks({
      blueprint: bp,
      challengeId: firstChallengeId,
      learner: state,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].companion_id).toBe(guide.companion_id);
    expect(hits[0].hook_text.length).toBeGreaterThan(0);
  });
});

describe("computeLevel — upgrade threshold math", () => {
  it("level caps at upgrade_path length and progresses at 3 and 8 speeches", async () => {
    const { computeLevel } = await import(
      "@/lib/learning-runtime/companion-upgrades"
    );
    expect(computeLevel(0, 3)).toBe(1);
    expect(computeLevel(2, 3)).toBe(1);
    expect(computeLevel(3, 3)).toBe(2);
    expect(computeLevel(7, 3)).toBe(2);
    expect(computeLevel(8, 3)).toBe(3);
    expect(computeLevel(50, 3)).toBe(3); // capped
    // Companion with only 2 levels defined never reaches Lv.3
    expect(computeLevel(20, 2)).toBe(2);
    // Zero upgrade_path → always Lv.1
    expect(computeLevel(20, 0)).toBe(1);
  });

  it("recomputeCompanionLevels bumps level + writes ✨ system bubble when crossing a threshold", async () => {
    const bp = await seedBlueprint("upgrade 升级主题");
    const {
      createLearnerState,
      getLearnerState,
      saveLearnerState,
      appendConversation,
      listConversation,
    } = await import("@/lib/state-manager");
    const { recomputeCompanionLevels } = await import(
      "@/lib/learning-runtime/companion-upgrades"
    );

    const learner = await createLearnerState(bp.blueprint_id);
    const state = getLearnerState(learner.learner_id)!;
    const guide = bp.step4_companions!.companions.find(
      (c) => c.companion_type === "npc_guide"
    )!;
    state.unlocked_companions = [
      { companion_id: guide.companion_id, level: 1, unlocked_at: new Date().toISOString() },
    ];
    saveLearnerState(state);

    // Log 3 speeches from this companion (enough for Lv.2).
    for (let i = 0; i < 3; i++) {
      appendConversation({
        learner_id: learner.learner_id,
        turn_idx: i,
        chapter_id: "c1",
        challenge_id: "c1_ch1",
        role: "companion",
        who: guide.display_name,
        text: `line ${i}`,
      });
    }

    const events = recomputeCompanionLevels({
      learnerId: learner.learner_id,
      learner: state,
      blueprint: bp,
      turnIdx: 3,
      chapterId: "c1",
      challengeId: "c1_ch1",
    });
    expect(events).toHaveLength(1);
    expect(events[0].to_level).toBe(2);

    // State mutated + persisted
    const reloaded = getLearnerState(learner.learner_id)!;
    expect(reloaded.unlocked_companions[0].level).toBe(2);

    // ✨ system bubble written
    const conv = listConversation(learner.learner_id);
    const upgradeBubble = conv.find(
      (c) => c.role === "system" && c.who === "upgrade"
    );
    expect(upgradeBubble).toBeTruthy();
    expect(upgradeBubble!.text).toContain("Lv.2");
  });
});
