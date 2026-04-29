// End-to-end mechanism check for the "Narrator-explains-instead-of-hinting"
// rework (docs/narrator-judge-decoupling.md).
//
// We construct a tiny blueprint with a single_choice rung whose options carry
// judgment_kind tags + a model_judgment + common_misreadings, drive runTurn
// with an off_target pick, and inspect the resulting state and Narrator
// output. The mechanism is validated when:
//   1. Judge output's path_decision.type is upgraded to "enter_review".
//   2. Ladder progress escalates with last_completion_kind = "partial_via_teach".
//   3. The Narrator bubble contains the model_judgment payload (state, not hint).
//   4. The Narrator bubble does NOT contain a question mark (no PUA hedging).
//
// We also exercise the form-rung path: two consecutive non-good submissions
// at the same rung must escalate to enter_review with the matched-dim
// misreading reaching Narrator, and again no question marks.

import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `rung-review-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  }
});

import type {
  Blueprint,
  Challenge,
  ResponseFrame,
  ScaffoldLadderRung,
} from "@/lib/types/core";

function buildSingleChoiceFrame(): ResponseFrame {
  return {
    frame_id: "rf_choice",
    version: 1,
    kind: "single_choice",
    title: "她的准备度",
    prompt: "选一个最贴你读到的判断。",
    binds_actions: ["a1"],
    fields: [
      {
        field_id: "choice",
        type: "radio",
        label: "你的判断",
        required: true,
        options: [
          {
            value: "ah_wh",
            label: "能力高、意愿高",
            judgment_kind: "off_target",
            option_specific_misreading:
              "这个选项把林小雨当作完整经验在身的执行者来读，跳过了她六个月内还没走通的跨部门取数路径——三处待补全部对应的是她不熟悉的信息渠道，而不是态度怠工。",
            cognitive_signal: { tag: "d1" },
          },
          {
            value: "al_wh",
            label: "能力低、意愿高",
            judgment_kind: "target",
            cognitive_signal: { tag: "d1" },
          },
          {
            value: "ah_wl",
            label: "能力高、意愿低",
            judgment_kind: "off_target",
            cognitive_signal: { tag: "d2" },
          },
        ],
      },
    ],
  };
}

function buildFormFrame(): ResponseFrame {
  return {
    frame_id: "rf_form",
    version: 1,
    kind: "form",
    title: "诊断表",
    prompt: "拆开填",
    binds_actions: ["a1"],
    fields: [
      { field_id: "person", type: "text", label: "对象", required: true },
      {
        field_id: "ability",
        type: "radio",
        label: "能力",
        required: true,
        options: [
          { value: "low", label: "低" },
          { value: "high", label: "高" },
        ],
      },
      { field_id: "evidence", type: "textarea", label: "证据", required: true },
    ],
  };
}

const SINGLE_CHOICE_RUNG: ScaffoldLadderRung = {
  position: 0,
  kind: "single_choice",
  frame_id: "rf_choice",
  narrative_purpose: "first read",
  gate_to_next: { type: "after_n_advances", n: 1 },
  rung_question: "她在这件事上的准备度是哪一档？",
  rung_expected_output: "选出 target",
  model_judgment:
    "林小雨在这件事上意愿这一端是清楚的，她在邮件里直接写「需要向客服部调取」，主动说出来。能力那端要分开看：历史工单、满意度数据、竞品对比这三处待补对应的是她六个月内还没走通的信息路径，跨部门取数的渠道本来就没建起来。准确读法是能力低、意愿高。",
  common_misreadings: [
    {
      dim_id: "d1",
      description:
        "把意愿到位（主动写出待补项）混同为能力到位。她说得出缺什么不等于她有渠道补上，跨部门取数对一个入职半年的新人来说本来就还没走通。",
    },
    {
      dim_id: "d2",
      description:
        "看到「三处待补」就把它读成消极怠工。事实上邮件里的待补项每一条都来自她主动列出，不是回避。",
    },
  ],
};

const FORM_RUNG: ScaffoldLadderRung = {
  position: 1,
  kind: "form",
  frame_id: "rf_form",
  narrative_purpose: "structured diagnosis",
  gate_to_next: null,
  rung_question: "把能力、意愿和证据拆开填。",
  rung_expected_output: "三栏齐全且证据具体",
  model_judgment:
    "诊断表里能力填低、意愿填高，证据要把跨部门取数三处待补和她在邮件里直接写出『需要向客服部调取』分开列。",
  common_misreadings: [
    {
      dim_id: "d1",
      description:
        "把能力填高的常见原因是误读了她写得清楚的邮件——表达清晰是意愿信号，不是能力信号；能力要看她有没有走通信息渠道。",
    },
  ],
};

async function buildBlueprintRow(topicSuffix: string): Promise<Blueprint> {
  const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
  const bp = createBlueprint(`情境领导力 · ${topicSuffix}`, "d_review");
  const challenge: Challenge = {
    challenge_id: "ch1",
    title: "读懂林小雨的准备度",
    binds_actions: ["a1"],
    complexity: "low",
    trunk: {
      setup: "你在会议室里翻完林小雨的方案，她的邮件还摊在桌上。",
      action_prompts: ["先选一个判断方向。"],
      expected_signals: ["分清能力线索与意愿线索"],
    },
    companion_hooks: [],
    response_frames: [buildSingleChoiceFrame(), buildFormFrame()],
    default_response_frame_id: "rf_choice",
    default_ladder_position: 0,
    scaffold_ladder: [SINGLE_CHOICE_RUNG, FORM_RUNG],
  };
  bp.step1_gamecore = {
    core_actions: [
      {
        action_id: "a1",
        name: "读懂准备度",
        description: "区分能力线索和意愿线索",
        knowledge_type: "procedural",
        relations: [],
        quality_matrix: {
          dimensions: [
            { dim_id: "d1", name: "能力读取", type: "process" },
            { dim_id: "d2", name: "意愿读取", type: "process" },
          ],
          complexity_levels: ["low", "medium", "high"],
          rubrics: {
            d1: {
              low: { good: "能区分", medium: "部分", poor: "未区分" },
              medium: { good: "能区分", medium: "部分", poor: "未区分" },
              high: { good: "能区分", medium: "部分", poor: "未区分" },
            },
            d2: {
              low: { good: "能区分", medium: "部分", poor: "未区分" },
              medium: { good: "能区分", medium: "部分", poor: "未区分" },
              high: { good: "能区分", medium: "部分", poor: "未区分" },
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
    },
    chapters: [
      {
        chapter_id: "c1",
        title: "新官上任",
        narrative_premise: "你刚接手销售支持组，要在第一周读懂每个成员。",
        milestone: { id: "m1", summary: "完成第一轮诊断" },
        challenges: [challenge],
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
  return bp;
}

describe("rung review beat — narrator-judge decoupling", () => {
  it("single_choice off_target pick routes through enter_review and Narrator states the answer", async () => {
    const { createLearnerState, getLearnerState, listConversation } =
      await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = await buildBlueprintRow("single-choice");
    const learner = await createLearnerState(bp.blueprint_id);

    const result = await runTurn({
      learnerId: learner.learner_id,
      response: {
        frame_id: "rf_choice",
        frame_version: 1,
        values: { choice: "ah_wh" }, // off_target pick
      },
    });

    // (1) Judge output upgraded / synthesised to enter_review.
    expect(result.judgeOutput.path_decision.type).toBe("enter_review");

    // (2) Ladder bookkeeping: the rung escalated with partial_via_teach.
    const stateAfter = getLearnerState(learner.learner_id);
    const progress = stateAfter?.ladder_progress?.["ch1"];
    expect(progress?.position).toBe(1); // moved off rung 0
    expect(progress?.last_completion_kind).toBe("partial_via_teach");
    expect(progress?.same_rung_attempts ?? 0).toBe(0); // reset on escalation

    // (3) Narrator bubble carried the designer answer + misreading into the
    //     learner-visible transcript.
    const narratorBubble = listConversation(learner.learner_id).find(
      (e) => e.role === "narrator" && e.text === result.narratorText
    );
    expect(narratorBubble).toBeTruthy();
    expect(result.narratorText).toContain("林小雨");
    expect(result.narratorText).toContain("能力低、意愿高");

    // (4) No PUA hedging: the explanation beat must not pose a question or
    //     ask the learner to reconsider.
    expect(result.narratorText).not.toMatch(/[？?]/);
    expect(result.narratorText).not.toMatch(
      /(你是否|你愿意|要不要|再想一下|重新对应|是否略|换个角度想|你能不能)/
    );
  });

  it("graded rung carries enter_review on the second consecutive miss", async () => {
    const {
      createLearnerState,
      getLearnerState,
      saveLearnerState,
    } = await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = await buildBlueprintRow("form-rung");
    const learner = await createLearnerState(bp.blueprint_id);

    // Move learner straight onto the form rung (position=1) so we can test
    // the post-Judge upgrade path without first walking through single_choice.
    const state = getLearnerState(learner.learner_id);
    if (!state) throw new Error("learner state missing");
    state.ladder_progress = {
      ch1: {
        challenge_id: "ch1",
        position: 1,
        advances_at_position: 0,
        same_rung_attempts: 0,
        action_id: "a1",
        updated_at: new Date().toISOString(),
      },
    };
    state.active_response_frame = null;
    saveLearnerState(state);

    // Submit a deliberately weak response — short canonical text drives mock
    // Judge to grade poor on every dim.
    const weakInput = {
      frame_id: "rf_form",
      frame_version: 1,
      values: { person: "林", ability: "high", evidence: "短" },
    };
    const first = await runTurn({
      learnerId: learner.learner_id,
      response: weakInput,
    });
    expect(first.judgeOutput.path_decision.type).not.toBe("enter_review");
    const stateAfterFirst = getLearnerState(learner.learner_id);
    expect(
      stateAfterFirst?.ladder_progress?.ch1?.same_rung_attempts ?? 0
    ).toBeGreaterThanOrEqual(1);

    const second = await runTurn({
      learnerId: learner.learner_id,
      response: weakInput,
    });
    expect(second.judgeOutput.path_decision.type).toBe("enter_review");
    expect(second.narratorText).not.toMatch(/[？?]/);
    // Misreading content should weave in.
    expect(second.narratorText).toMatch(/能力|意愿/);
  });
});
