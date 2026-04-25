import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `scaffold-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("consecutivePoorInChallenge — counts only the tail of all-poor turns", () => {
  it("returns 0 on empty history", async () => {
    const { consecutivePoorInChallenge } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    expect(consecutivePoorInChallenge("u_empty", "c1_ch1")).toBe(0);
  });

  it("counts the streak of all-poor turns from the latest row backwards", async () => {
    const { writeEvidence } = await import("@/lib/state-manager");
    const { consecutivePoorInChallenge } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    const learnerId = `u_streak_${Date.now()}`;
    // Oldest first; all same challenge.
    const seq = [
      { d1: "good", d2: "good" },     // counter anchor: NOT poor
      { d1: "poor", d2: "poor" },     // 1st poor (tail)
      { d1: "poor", d2: "poor" },     // 2nd poor
      { d1: "poor", d2: "poor" },     // 3rd poor
    ] as const;
    for (let i = 0; i < seq.length; i++) {
      writeEvidence({
        learner_id: learnerId,
        ts: new Date(Date.now() + i).toISOString(),
        challenge_id: "c1_ch1",
        action_id: "a1",
        turn_idx: i,
        grades: seq[i],
        evidence: `t${i}`,
      });
    }
    expect(consecutivePoorInChallenge(learnerId, "c1_ch1")).toBe(3);
  });

  it("a single non-poor dim breaks the streak", async () => {
    const { writeEvidence } = await import("@/lib/state-manager");
    const { consecutivePoorInChallenge } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    const learnerId = `u_break_${Date.now()}`;
    const seq = [
      { d1: "poor", d2: "poor" },      // older poor
      { d1: "medium", d2: "poor" },    // breaker (has a medium)
      { d1: "poor", d2: "poor" },      // latest poor
    ] as const;
    for (let i = 0; i < seq.length; i++) {
      writeEvidence({
        learner_id: learnerId,
        ts: new Date(Date.now() + i).toISOString(),
        challenge_id: "c1_ch1",
        action_id: "a1",
        turn_idx: i,
        grades: seq[i],
        evidence: `t${i}`,
      });
    }
    // Streak is only the latest one (the medium breaks the prior poor run).
    expect(consecutivePoorInChallenge(learnerId, "c1_ch1")).toBe(1);
  });

  it("isolates per challenge — rows from other challenges do not count", async () => {
    const { writeEvidence } = await import("@/lib/state-manager");
    const { consecutivePoorInChallenge } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    const learnerId = `u_iso_${Date.now()}`;
    writeEvidence({
      learner_id: learnerId,
      ts: new Date().toISOString(),
      challenge_id: "c1_ch_other",
      action_id: "a1",
      turn_idx: 0,
      grades: { d1: "poor", d2: "poor" },
      evidence: "noise",
    });
    writeEvidence({
      learner_id: learnerId,
      ts: new Date().toISOString(),
      challenge_id: "c1_ch_target",
      action_id: "a1",
      turn_idx: 0,
      grades: { d1: "poor", d2: "poor" },
      evidence: "target",
    });
    expect(consecutivePoorInChallenge(learnerId, "c1_ch_target")).toBe(1);
  });
});

describe("detectSelfHelpSignal — precise self-help utterances only", () => {
  it("fires on short explicit cries for help", async () => {
    const { detectSelfHelpSignal } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    expect(detectSelfHelpSignal("我不知道")).toBe(true);
    expect(detectSelfHelpSignal("我不知道了")).toBe(true);
    expect(detectSelfHelpSignal("不知道")).toBe(true);
    expect(detectSelfHelpSignal("不知道了。")).toBe(true);
    expect(detectSelfHelpSignal("帮帮我")).toBe(true);
    expect(detectSelfHelpSignal("给个例子")).toBe(true);
    expect(detectSelfHelpSignal("卡住了")).toBe(true);
    expect(detectSelfHelpSignal("我放弃")).toBe(true);
  });

  it("does not fire on long answers that happen to contain 不知道", async () => {
    const { detectSelfHelpSignal } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    // A substantive answer that mentions "他不知道产品" — NOT a self-help signal.
    expect(
      detectSelfHelpSignal(
        "我判断他是 R1——他不知道产品的关键差异点，但意愿很高，能力低而意愿高。"
      )
    ).toBe(false);
  });

  it("fires on explicit long begging", async () => {
    const { detectSelfHelpSignal } = await import(
      "@/lib/learning-runtime/scaffold"
    );
    expect(
      detectSelfHelpSignal(
        "我完全没思路，真的给我个例子吧，我不知道该怎么接下去了"
      )
    ).toBe(true);
  });
});

describe("detectHelpIntent — frustration and paid help levels", () => {
  it("classifies hint, example, and reveal help requests", async () => {
    const { detectHelpIntent } = await import(
      "@/lib/learning-runtime/scaffold"
    );

    expect(detectHelpIntent("提示一下")).toMatchObject({ kind: "hint" });
    expect(detectHelpIntent("给我个例子")).toMatchObject({ kind: "example" });
    expect(detectHelpIntent("直接告诉我答案吧")).toMatchObject({ kind: "reveal" });
  });

  it("treats strong frustration as reveal intent", async () => {
    const { detectHelpIntent } = await import(
      "@/lib/learning-runtime/scaffold"
    );

    expect(detectHelpIntent("算了我不想答了，一直不对")).toMatchObject({
      kind: "reveal",
      frustration: true,
    });
  });
});

describe("runTurn — scaffold_strategy is persisted to evidence_log", () => {
  it("a 'poor' turn produces scaffold evidence row whose scaffold_strategy is set", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listEvidence } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("支架策略记录主题", "d_sf1");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    // A very short answer → mock Judge grades "poor" → decisionType scaffold.
    await runTurn({ learnerId: learner.learner_id, input: "不会" });

    const ev = listEvidence(learner.learner_id, 5);
    // Most recent evidence row (first because listEvidence orders DESC)
    const latest = ev[0];
    expect(latest.scaffold_assisted).toBe(true);
    expect(latest.scaffold_strategy).toBeTruthy();
  });

  it("self-help signal 'we don't know' triggers path=simplify_challenge → scaffold_strategy=worked_example", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listEvidence } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("自助求助主题", "d_sh");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const result = await runTurn({ learnerId: learner.learner_id, input: "我不知道了" });

    expect(result.judgeOutput.path_decision.type).toBe("simplify_challenge");
    expect(result.judgeOutput.path_decision.scaffold_spec?.strategy).toBe(
      "worked_example"
    );
    const ev = listEvidence(learner.learner_id, 3);
    expect(ev[0].scaffold_strategy).toBe("worked_example");
    expect(ev[0].scaffold_assisted).toBe(true);
  });

  it("paid reveal help gives an answer and advances to the next challenge", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listEvidence } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("揭晓并继续主题", "d_reveal");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const before = learner.position.challenge_id;
    const result = await runTurn({
      learnerId: learner.learner_id,
      helpRequest: { kind: "reveal" },
    });

    expect(result.judgeOutput.path_decision.type).toBe("reveal_answer_and_advance");
    expect(result.position.challenge_id).not.toBe(before);
    expect(result.helpRequest?.kind).toBe("reveal");
    expect(result.helpRequest?.pointsSpent).toBe(4);
    const ev = listEvidence(learner.learner_id, 1);
    expect(ev[0].scaffold_strategy).toBe("worked_example");
    expect(ev[0].scaffold_assisted).toBe(true);
  });
});

describe("scaffold-metrics aggregation", () => {
  it("rebound_rate counts learners who reached medium+ on the next turn", async () => {
    const { writeEvidence } = await import("@/lib/state-manager");
    const { listScaffoldEvents, aggregateStrategyMetrics } = await import(
      "@/lib/scaffold-metrics"
    );
    const learnerId = `u_metric_${Date.now()}`;
    // Setup: scaffold turn (all poor) followed by medium — that's a rebound.
    writeEvidence({
      learner_id: learnerId,
      ts: new Date(Date.now() + 1).toISOString(),
      challenge_id: "c1_ch_metric",
      action_id: "a1",
      turn_idx: 0,
      grades: { d1: "poor", d2: "poor" },
      evidence: "scaffold fired",
      scaffold_strategy: "worked_example",
      scaffold_assisted: true,
    });
    writeEvidence({
      learner_id: learnerId,
      ts: new Date(Date.now() + 2).toISOString(),
      challenge_id: "c1_ch_metric",
      action_id: "a1",
      turn_idx: 1,
      grades: { d1: "medium", d2: "poor" },
      evidence: "rebound turn",
    });
    // Another scaffold turn (this_best=poor) followed by still-poor — no rebound.
    writeEvidence({
      learner_id: learnerId,
      ts: new Date(Date.now() + 3).toISOString(),
      challenge_id: "c1_ch_metric2",
      action_id: "a1",
      turn_idx: 0,
      grades: { d1: "poor", d2: "poor" },
      evidence: "scaffold fired 2",
      scaffold_strategy: "worked_example",
      scaffold_assisted: true,
    });
    writeEvidence({
      learner_id: learnerId,
      ts: new Date(Date.now() + 4).toISOString(),
      challenge_id: "c1_ch_metric2",
      action_id: "a1",
      turn_idx: 1,
      grades: { d1: "poor", d2: "poor" },
      evidence: "still poor",
    });

    const events = listScaffoldEvents().filter(
      (e) => e.learner_id === learnerId
    );
    expect(events).toHaveLength(2);
    const metrics = aggregateStrategyMetrics(events);
    const worked = metrics.find((m) => m.strategy === "worked_example");
    expect(worked).toBeDefined();
    expect(worked!.fired_count).toBe(2);
    expect(worked!.rebound_count).toBe(1);
    expect(worked!.rebound_rate).toBe(0.5);
  });
});
