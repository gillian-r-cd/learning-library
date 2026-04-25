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
  it("exposes response frames in snapshot and persists structured learner responses", async () => {
    const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
    const {
      createLearnerState,
      buildSnapshot,
      latestConversationEntries,
    } = await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("结构化输入测试", "d_frames");
    bp.step1_gamecore = {
      core_actions: [
        {
          action_id: "a1",
          name: "读懂准备度",
          description: "识别能力与意愿",
          knowledge_type: "procedural",
          relations: [],
          quality_matrix: {
            dimensions: [{ dim_id: "d1", name: "证据", type: "process" }],
            complexity_levels: ["low", "medium", "high"],
            rubrics: {
              d1: {
                low: { good: "证据清楚", medium: "有证据", poor: "缺证据" },
                medium: { good: "证据清楚", medium: "有证据", poor: "缺证据" },
                high: { good: "证据清楚", medium: "有证据", poor: "缺证据" },
              },
            },
          },
        },
      ],
      relation_graph: [],
    };
    bp.step3_script = {
      journey_meta: { arc_type: "hero_journey", tone: "workplace", estimated_duration_min: 30 },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          narrative_premise: "测试",
          milestone: { id: "m1", summary: "完成诊断" },
          challenges: [
            {
              challenge_id: "ch1",
              title: "准备度诊断",
              binds_actions: ["a1"],
              complexity: "low",
              trunk: {
                setup: "你要判断陈悦的准备度。",
                action_prompts: ["填写诊断。"],
                expected_signals: ["区分能力和意愿"],
              },
              companion_hooks: [],
              response_frames: [
                {
                  frame_id: "rf_form",
                  version: 1,
                  kind: "form",
                  title: "准备度诊断表",
                  prompt: "拆开填写。",
                  binds_actions: ["a1"],
                  fields: [
                    { field_id: "person", type: "text", label: "对象", required: true },
                    {
                      field_id: "ability",
                      type: "radio",
                      label: "能力水平",
                      required: true,
                      options: [
                        { value: "low", label: "低" },
                        { value: "medium", label: "中" },
                      ],
                    },
                    { field_id: "evidence", type: "textarea", label: "关键证据", required: true },
                  ],
                },
              ],
              default_response_frame_id: "rf_form",
            },
          ],
        },
      ],
    };
    updateBlueprint(bp);

    const learner = await createLearnerState(bp.blueprint_id);
    const snapshot = buildSnapshot(learner.learner_id);
    expect(snapshot.active_response_frame.frame_id).toBe("rf_form");
    expect(snapshot.response_frames.map((f) => f.frame_id)).toContain("free_text_default");

    const result = await runTurn({
      learnerId: learner.learner_id,
      response: {
        frame_id: "rf_form",
        frame_version: 1,
        values: {
          person: "陈悦",
          ability: "medium",
          evidence: "能复述流程，但回避承诺排期",
        },
      },
    });

    expect(result.learnerInput).toContain("学员使用结构化框架「准备度诊断表」作答");
    const learnerBubble = latestConversationEntries(learner.learner_id, 10).find(
      (entry) => entry.role === "learner"
    );
    expect(learnerBubble?.meta).toMatchObject({
      kind: "learner_response",
      response_frame: { frame_id: "rf_form", frame_version: 1, kind: "form" },
    });
  });

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

    const { listConversation } = await import("@/lib/state-manager");
    const pointMoment = listConversation(learner.learner_id).find(
      (entry) => entry.role === "system" && entry.who === "points"
    );
    expect(pointMoment?.meta).toMatchObject({
      kind: "points_awarded",
      points_earned: res.pointsEarned,
      total_points: res.newTotal,
    });
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
