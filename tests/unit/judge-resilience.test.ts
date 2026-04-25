import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `judge-resilience-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  }
});

let judgeCalls = 0;

vi.mock("@/lib/llm", async () => {
  return {
    llmCall: vi.fn(async (args: { caller: string }) => {
      if (args.caller !== "judge") {
        return {
          callId: `call_${args.caller}`,
          traceId: `trc_${args.caller}`,
          output: {},
          parsed: {},
          text: "开场已经写好。",
          tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
          latencyMs: 1,
        };
      }

      judgeCalls += 1;
      if (judgeCalls === 1) {
        return {
          callId: "call_judge_1",
          traceId: "trc_judge_1",
          output: { error: "Connection error." },
          parsed: undefined,
          text: "",
          tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
          latencyMs: 1,
        };
      }

      return {
        callId: "call_judge_2",
        traceId: "trc_judge_2",
        output: {},
        parsed: {
          quality: [{ dim_id: "d1", grade: "good", evidence: "识别了事实与解释的差异。" }],
          path_decision: { type: "advance", target: null, scaffold_spec: null },
          narrator_directive: "肯定 d1 的事实拆分，用追问下沉到第二股驱动力。",
          companion_dispatch: [],
          script_branch_switch: null,
          event_triggers: [],
          next_response_frame: null,
        },
        text: "",
        tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
        latencyMs: 1,
      };
    }),
  };
});

beforeEach(() => {
  judgeCalls = 0;
});

describe("runJudge resilience", () => {
  it("retries ledger-style transient connection errors before normalizing output", async () => {
    const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
    const { createLearnerState, buildSnapshot } = await import("@/lib/state-manager");
    const { runJudge, DEFAULT_ACTION_SPACE_RULES } = await import("@/lib/judge");

    const bp = createBlueprint("Judge retry", "d_judge_retry");
    bp.step1_gamecore = {
      core_actions: [
        {
          action_id: "a1",
          name: "拆分事实与解释",
          description: "区分材料事实与叙事解释",
          knowledge_type: "procedural",
          relations: [],
          quality_matrix: {
            dimensions: [{ dim_id: "d1", name: "事实拆分", type: "process" }],
            complexity_levels: ["low", "medium", "high"],
            rubrics: {
              d1: {
                low: { good: "清楚拆分", medium: "部分拆分", poor: "未拆分" },
                medium: { good: "清楚拆分", medium: "部分拆分", poor: "未拆分" },
                high: { good: "清楚拆分", medium: "部分拆分", poor: "未拆分" },
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
          milestone: { id: "m1", summary: "完成" },
          challenges: [
            {
              challenge_id: "ch1",
              title: "漂亮材料",
              binds_actions: ["a1"],
              complexity: "low",
              trunk: {
                setup: "你看到一份漂亮材料。",
                action_prompts: ["拆分事实与解释。"],
                expected_signals: ["能区分事实与解释"],
              },
              companion_hooks: [],
            },
          ],
        },
      ],
    };
    updateBlueprint(bp);

    const learner = await createLearnerState(bp.blueprint_id);
    const result = await runJudge({
      snapshot: buildSnapshot(learner.learner_id),
      learnerInput: "门店翻四倍是事实，消费升级是解释。",
      evidenceSummary: "",
      actionSpaceRules: DEFAULT_ACTION_SPACE_RULES,
    });

    expect(judgeCalls).toBe(2);
    expect(result.output.quality[0]).toMatchObject({
      dim_id: "d1",
      grade: "good",
      evidence: "识别了事实与解释的差异。",
    });
    expect(result.output.path_decision.type).toBe("advance");
  });
});
