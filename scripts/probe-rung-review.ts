// Probe: drive the off_target → enter_review flow against the REAL Anthropic
// API and print the Narrator output. Use to sanity-check that the prompt
// rewrite actually produces hedge-free explanation prose.
//
// Run:  npx tsx scripts/probe-rung-review.ts
//
// Reads ANTHROPIC_API_KEY from .env.local. Exits non-zero if the produced
// Narrator text contains a question mark or any hedging phrase.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
// Hand-rolled .env.local loader so this script is independent of any
// framework-level dotenv setup.
const envPath = path.join(ROOT, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set in env. Aborting.");
  process.exit(1);
}
delete process.env.LLM_MOCK; // ensure real LLM
process.env.LL_DB_PATH = path.join(
  ROOT,
  "data",
  `probe-rung-review-${Date.now()}.db`
);

import type { Blueprint, Challenge, ResponseFrame, ScaffoldLadderRung } from "@/lib/types/core";

function singleChoiceFrame(): ResponseFrame {
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
              "这个选项把林小雨当作完整经验在身的执行者来读，跳过了她六个月内还没走通的跨部门取数路径。她邮件里列出的『三处待补』每一条都是她没有走过的信息渠道，而不是态度怠工。",
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

const RUNG: ScaffoldLadderRung = {
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
  ],
};

const FORM_RUNG: ScaffoldLadderRung = {
  position: 1,
  kind: "form",
  frame_id: "rf_form",
  narrative_purpose: "structured diagnosis",
  gate_to_next: null,
  rung_question: "把能力、意愿、证据拆开填。",
};

async function main() {
  const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
  const { createLearnerState, listConversation } = await import(
    "@/lib/state-manager"
  );
  const { runTurn } = await import("@/lib/learning-runtime");

  const bp = createBlueprint("情境领导力·probe", "d_probe") as Blueprint;
  const challenge: Challenge = {
    challenge_id: "ch1",
    title: "读懂林小雨",
    binds_actions: ["a1"],
    complexity: "low",
    trunk: {
      setup:
        "你是新接手销售支持组的 team leader。林小雨入职半年，她写了一份方案给你，方案末尾附了一封邮件，邮件里点名说：客户历史工单、满意度数据、竞品对比这三处她还要向客服部调取。她笔迹工整，语气平稳。",
      action_prompts: ["先选一个判断方向。"],
      expected_signals: ["分清能力线索与意愿线索"],
    },
    companion_hooks: [],
    response_frames: [
      singleChoiceFrame(),
      {
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
      },
    ],
    default_response_frame_id: "rf_choice",
    default_ladder_position: 0,
    scaffold_ladder: [RUNG, FORM_RUNG],
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
      protagonist_role: "你是新接手销售支持组的 team leader",
      journey_goal: "读懂、风格匹配、给出具体动作",
    },
    chapters: [
      {
        chapter_id: "c1",
        title: "新官上任",
        narrative_premise:
          "你刚接手销售支持组，第一周里要分别读懂每位组员当前在不同任务上的准备度。林小雨是组里入职半年的新人，今天交上来的方案是她头一次独立操盘。",
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

  const learner = await createLearnerState(bp.blueprint_id);
  console.log("[probe] starting off_target turn against REAL Anthropic API…");
  const result = await runTurn({
    learnerId: learner.learner_id,
    response: {
      frame_id: "rf_choice",
      frame_version: 1,
      values: { choice: "ah_wh" },
    },
  });

  console.log("\n=== runTurn result ===");
  console.log("path_decision.type =", result.judgeOutput.path_decision.type);
  console.log("\n=== Narrator text ===\n" + result.narratorText);

  const issues: string[] = [];
  if (result.judgeOutput.path_decision.type !== "enter_review") {
    issues.push(
      `path_decision.type expected enter_review, got ${result.judgeOutput.path_decision.type}`
    );
  }
  if (/[？?]/.test(result.narratorText)) {
    issues.push("narrator text contains a question mark");
  }
  if (
    /(你是否|你愿意|要不要|再想一下|重新对应|是否略|换个角度想|你能不能)/.test(
      result.narratorText
    )
  ) {
    issues.push("narrator text contains a PUA-style hedge");
  }
  if (!/林小雨|能力低|意愿高/.test(result.narratorText)) {
    issues.push(
      "narrator text does not weave in the model_judgment payload (林小雨 / 能力低 / 意愿高)"
    );
  }

  if (issues.length > 0) {
    console.error("\n=== ISSUES ===");
    for (const x of issues) console.error("  -", x);
    process.exit(2);
  }
  console.log("\n=== probe passed ===");

  // Persist conversation snapshot for inspection.
  const lines = listConversation(learner.learner_id).map(
    (e) => `${e.role}${e.who ? `(${e.who})` : ""}: ${e.text}`
  );
  console.log("\n=== conversation log ===\n" + lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
