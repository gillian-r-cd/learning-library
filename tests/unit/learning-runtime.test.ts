import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `learn-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("learning runtime: full turn orchestration", () => {
  it("runs a turn: Judge → State update → Narrator + Companions", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState } = await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("情境领导力", "d_test");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const res = await runTurn({
      learnerId: learner.learner_id,
      input:
        "我观察到对方回避眼神、语气犹豫，结合他承担跨部门任务的事实，我判断他能力中等但意愿低，倾向 R2。",
    });
    expect(res.narratorText.length).toBeGreaterThan(5);
    expect(typeof res.pointsEarned).toBe("number");
    expect(res.position.challenge_id).toBeTruthy();
    expect(res.judgeOutput.quality.length).toBeGreaterThan(0);
  });

  it("accumulates points across many turns and triggers unlocks", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState } = await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("理论X", "d_t2");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const input =
      "这是一段充分详细的回答，旨在展示高质量的信息采集、推理路径与判断准确性。我观察到很多线索，并给出支持判断的理由和反例。再补充一段让长度过 120 以触发 good 评估。再再加一段保底。";
    let total = 0;
    let lastUnlocks: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await runTurn({ learnerId: learner.learner_id, input });
      total = r.newTotal;
      if (r.newUnlocks.length > 0) lastUnlocks = lastUnlocks.concat(r.newUnlocks);
    }
    expect(total).toBeGreaterThan(10);
    expect(lastUnlocks.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("ledger writes every LLM call", () => {
  it("records both design and learning stages", async () => {
    const { queryLedger } = await import("@/lib/ledger");
    const rows = queryLedger({ limit: 200 });
    expect(rows.length).toBeGreaterThan(0);
    const callers = new Set(rows.map((r) => r.caller));
    expect(callers.has("judge")).toBe(true);
    expect(callers.has("narrator")).toBe(true);
    expect(callers.has("skill_1_gamecore")).toBe(true);
  });
});
