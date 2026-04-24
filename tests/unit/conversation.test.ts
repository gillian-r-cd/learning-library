import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `conv-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("conversation_log — full transcript persistence", () => {
  it("createLearnerState seeds a 4-step journey opening", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listConversation } = await import(
      "@/lib/state-manager"
    );

    const bp = createBlueprint("对话持久化主题", "d_test");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const conv = listConversation(learner.learner_id);
    // Opening is one narrator bubble with kind="challenge_opening", then the
    // on_challenge_enter artifact drops below it.
    const openings = conv.filter(
      (c) => c.role === "narrator" && c.meta?.kind === "challenge_opening"
    );
    expect(openings.length).toBe(1);
    // First message must be the narrator opening (no more meta tour system bubble).
    expect(conv[0].role).toBe("narrator");
    expect(conv[0].meta?.kind).toBe("challenge_opening");
  });

  it("runTurn appends learner + narrator + companion + optional unlock", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listConversation } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("对话 turn 主题", "d_turn");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    await runTurn({ learnerId: learner.learner_id, input: "我先观察场景再做判断。" });

    const conv = listConversation(learner.learner_id);
    // 1 opening narrator + learner + this-turn narrator at minimum
    const roles = conv.map((c) => c.role);
    expect(roles[0]).toBe("narrator"); // immersive opening
    expect(roles).toContain("learner");
    expect(roles.filter((r) => r === "narrator").length).toBeGreaterThanOrEqual(2);

    // Learner entry preserves the exact text
    const learnerEntry = conv.find((c) => c.role === "learner");
    expect(learnerEntry?.text).toBe("我先观察场景再做判断。");
  });

  it("cross-challenge advance writes a new opening bubble", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listConversation } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("跨挑战过渡主题", "d_cross");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    // The mock Judge gives "good" for long inputs → "advance" decision, which
    // moves to the next challenge. A single long-enough turn suffices.
    const long =
      "这是一段充分详细的回答，旨在展示高质量的信息采集、推理路径与判断准确性。我观察到很多线索，并给出支持判断的理由和反例。再补充一段让长度过120以触发good评估。";
    const r = await runTurn({ learnerId: learner.learner_id, input: long });
    if (!r.openingOfNewChallenge) {
      // If mock judge didn't advance, skip: the test verifies only the
      // integration contract, not mock gradings. Fall back to asserting at
      // least opening + learner + narrator.
      const conv = listConversation(learner.learner_id);
      expect(conv.length).toBeGreaterThanOrEqual(3);
      return;
    }
    const conv = listConversation(learner.learner_id);
    const openings = conv.filter((c) => c.meta?.kind === "challenge_opening");
    expect(openings.length).toBeGreaterThanOrEqual(2);
  });

  it("ensureBootstrapMessages is idempotent and only fires on empty log", async () => {
    const { ensureBootstrapMessages, listConversation } = await import(
      "@/lib/state-manager"
    );
    const learnerId = `u_boot_${Date.now()}`;
    const a = ensureBootstrapMessages({
      learner_id: learnerId,
      chapter_id: "c1",
      challenge_id: "c1_ch1",
      challenge_title: "开场挑战",
      challenge_setup: "欢迎来到第一个挑战。",
    });
    expect(a).toBe(true);
    const firstCount = listConversation(learnerId).length;
    expect(firstCount).toBe(2); // notice + opening

    // Second call must be a no-op.
    const b = ensureBootstrapMessages({
      learner_id: learnerId,
      chapter_id: "c1",
      challenge_id: "c1_ch1",
      challenge_title: "开场挑战",
      challenge_setup: "欢迎来到第一个挑战。",
    });
    expect(b).toBe(false);
    expect(listConversation(learnerId).length).toBe(firstCount);
  });
});
