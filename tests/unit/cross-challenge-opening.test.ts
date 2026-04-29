// Cross-challenge openings must NOT replay journey-level intro
// (protagonist_role / journey_goal). This test pins both:
//   1. The fallback template, when LLM output fails validation, must skip
//      role + goal lines for cross_challenge.
//   2. The validator must reject LLM cross_challenge output that copies
//      ≥8-char spans from protagonist_role or journey_goal verbatim.
//
// See docs/narrator-judge-decoupling.md and the user-reported example where
// cross_challenge openings were dumping the whole project-manager role +
// "在旅程结束时你将…" goal into every transition.

import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(
  process.cwd(),
  "data",
  `cross-opening-${Date.now()}.db`
);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  }
});

const PROTAGONIST_ROLE =
  "你是一家中型设计公司的项目经理，刚带领团队完成了一个高强度的客户交付。团队里有合作多年的资深设计师，也有刚入职不久的年轻成员。";
const JOURNEY_GOAL =
  "在旅程结束时，你能够独立完成从分离观察与评价到识别并表达感受、连接内在需要、提出可执行请求这一整套非暴力沟通的实践流程。";

describe("cross-challenge opening: journey-level intro must not leak", () => {
  it("fallback template for cross_challenge does NOT include protagonist_role or journey_goal", async () => {
    const { createBlueprint, updateBlueprint } = await import(
      "@/lib/blueprint"
    );
    const { createLearnerState } = await import("@/lib/state-manager");
    const { runNarratorOpening } = await import("@/lib/narrator");

    // Build a blueprint whose challenge-level setup is empty / minimal so
    // the LLM-mock output is short enough to fail length validation,
    // forcing the fallback to fire. This isolates the fallback's behaviour.
    const bp = createBlueprint("非暴力沟通·切场测试", "d_x");
    bp.step1_gamecore = {
      core_actions: [
        {
          action_id: "a1",
          name: "区分观察与评价",
          description: "把事实和评价分开",
          knowledge_type: "procedural",
          relations: [],
          quality_matrix: {
            dimensions: [{ dim_id: "d1", name: "事实分离", type: "process" }],
            complexity_levels: ["low", "medium", "high"],
            rubrics: {
              d1: {
                low: { good: "好", medium: "中", poor: "差" },
                medium: { good: "好", medium: "中", poor: "差" },
                high: { good: "好", medium: "中", poor: "差" },
              },
            },
          },
        },
      ],
      relation_graph: [],
    };
    bp.step3_script = {
      journey_meta: {
        arc_type: "hero_journey",
        tone: "workplace",
        estimated_duration_min: 30,
        protagonist_role: PROTAGONIST_ROLE,
        journey_goal: JOURNEY_GOAL,
      },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          narrative_premise: "你刚收到团队反馈。",
          milestone: { id: "m1", summary: "首次区分事实与评价" },
          challenges: [
            {
              challenge_id: "ch1",
              title: "周报词组",
              binds_actions: ["a1"],
              complexity: "low",
              trunk: {
                setup: "你打开周报草稿。",
                action_prompts: ["选哪一句最像评价？"],
                expected_signals: ["分离事实"],
              },
              companion_hooks: [],
            },
          ],
        },
      ],
    };
    bp.step_status = {
      step1: "confirmed",
      step2: "confirmed",
      step3: "confirmed",
      step4: "confirmed",
      step5: "confirmed",
    };
    bp.status = "ready";
    updateBlueprint(bp);

    const learner = await createLearnerState(bp.blueprint_id);
    const result = await runNarratorOpening({
      learnerId: learner.learner_id,
      blueprintId: bp.blueprint_id,
      variant: "cross_challenge",
      chapterId: "c1",
      challengeId: "ch1",
      previousChallenge: { title: "上一段", milestone: "完成首次诊断" },
      traceId: "trc_test",
    });

    // Hard guards: cross_challenge openings must NEVER replay journey intro.
    expect(result.text).not.toContain("项目经理");
    expect(result.text).not.toContain("非暴力沟通");
    expect(result.text).not.toContain("这一段要完成的是");
    expect(result.text).not.toContain("在旅程结束时");
    // No 8-char verbatim span from protagonist_role or journey_goal.
    for (let i = 0; i + 8 <= PROTAGONIST_ROLE.length; i++) {
      expect(result.text).not.toContain(PROTAGONIST_ROLE.slice(i, i + 8));
    }
    for (let i = 0; i + 8 <= JOURNEY_GOAL.length; i++) {
      expect(result.text).not.toContain(JOURNEY_GOAL.slice(i, i + 8));
    }
  });

  it("first-variant fallback DOES include protagonist_role + journey_goal (sanity)", async () => {
    const { createBlueprint, updateBlueprint } = await import(
      "@/lib/blueprint"
    );
    const { createLearnerState } = await import("@/lib/state-manager");
    const { runNarratorOpening } = await import("@/lib/narrator");

    const bp = createBlueprint("非暴力沟通·首次进场", "d_first");
    bp.step1_gamecore = {
      core_actions: [
        {
          action_id: "a1",
          name: "区分观察与评价",
          description: "把事实和评价分开",
          knowledge_type: "procedural",
          relations: [],
          quality_matrix: {
            dimensions: [{ dim_id: "d1", name: "事实分离", type: "process" }],
            complexity_levels: ["low", "medium", "high"],
            rubrics: {
              d1: {
                low: { good: "好", medium: "中", poor: "差" },
                medium: { good: "好", medium: "中", poor: "差" },
                high: { good: "好", medium: "中", poor: "差" },
              },
            },
          },
        },
      ],
      relation_graph: [],
    };
    bp.step3_script = {
      journey_meta: {
        arc_type: "hero_journey",
        tone: "workplace",
        estimated_duration_min: 30,
        protagonist_role: "你是项目经理",
        journey_goal: "学会非暴力沟通",
      },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          narrative_premise: "你刚收到团队反馈。",
          milestone: { id: "m1", summary: "" },
          challenges: [
            {
              challenge_id: "ch1",
              title: "周报词组",
              binds_actions: ["a1"],
              complexity: "low",
              trunk: {
                setup: "x",
                action_prompts: ["问"],
                expected_signals: ["s"],
              },
              companion_hooks: [],
            },
          ],
        },
      ],
    };
    bp.step_status = {
      step1: "confirmed",
      step2: "confirmed",
      step3: "confirmed",
      step4: "confirmed",
      step5: "confirmed",
    };
    bp.status = "ready";
    updateBlueprint(bp);

    const learner = await createLearnerState(bp.blueprint_id);
    const result = await runNarratorOpening({
      learnerId: learner.learner_id,
      blueprintId: bp.blueprint_id,
      variant: "first",
      chapterId: "c1",
      challengeId: "ch1",
      traceId: "trc_test",
    });

    // first-variant fallback must still anchor identity + goal.
    expect(result.text).toMatch(/项目经理/);
  });
});
