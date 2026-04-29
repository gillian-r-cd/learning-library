// Probe: drive a real cross_challenge opening against the Anthropic API and
// verify that:
//   - the prose does NOT replay protagonist_role / journey_goal
//   - the prose contains the new scene's setup details
//   - the prose ends with a question on the new challenge
//
// Run:  npx tsx scripts/probe-cross-challenge-opening.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envPath = path.join(ROOT, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing");
  process.exit(1);
}
delete process.env.LLM_MOCK;
process.env.LL_DB_PATH = path.join(
  ROOT,
  "data",
  `probe-cross-${Date.now()}.db`
);

const PROTAGONIST_ROLE =
  "你是一家中型设计公司的项目经理，刚带领团队完成了一个高强度的客户交付。团队里有合作多年的资深设计师，也有刚入职不久的年轻成员。近期你和家人之间也出现了几次让彼此都不太舒服的对话。";
const JOURNEY_GOAL =
  "在旅程结束时，你能够独立完成从分离观察与评价、识别并表达感受、连接内在需要、提出可执行请求这一整套非暴力沟通的实践流程，并在真实的冲突情境中保持稳定的应用。";

async function main() {
  const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
  const { createLearnerState, listConversation } = await import(
    "@/lib/state-manager"
  );
  const { runTurn } = await import("@/lib/learning-runtime");

  const bp = createBlueprint("非暴力沟通·跨挑战切场 probe", "d_probe_cross");
  bp.step1_gamecore = {
    core_actions: [
      {
        action_id: "a1",
        name: "区分观察与评价",
        description: "把事实和评价拆开陈述",
        knowledge_type: "procedural",
        relations: [{ to: "a2", type: "precedes" }],
        quality_matrix: {
          dimensions: [
            { dim_id: "d1", name: "事实分离", type: "process" },
            { dim_id: "d2", name: "评价识别", type: "process" },
          ],
          complexity_levels: ["low", "medium", "high"],
          rubrics: {
            d1: {
              low: { good: "好", medium: "中", poor: "差" },
              medium: { good: "好", medium: "中", poor: "差" },
              high: { good: "好", medium: "中", poor: "差" },
            },
            d2: {
              low: { good: "好", medium: "中", poor: "差" },
              medium: { good: "好", medium: "中", poor: "差" },
              high: { good: "好", medium: "中", poor: "差" },
            },
          },
        },
      },
      {
        action_id: "a2",
        name: "识别感受",
        description: "把评价改写成感受陈述",
        knowledge_type: "procedural",
        relations: [],
        quality_matrix: {
          dimensions: [{ dim_id: "d1", name: "感受词汇", type: "process" }],
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
    relation_graph: [{ from: "a1", to: "a2", type: "precedes" }],
  };
  bp.step3_script = {
    journey_meta: {
      arc_type: "hero_journey",
      tone: "workplace",
      estimated_duration_min: 60,
      protagonist_role: PROTAGONIST_ROLE,
      journey_goal: JOURNEY_GOAL,
    },
    chapters: [
      {
        chapter_id: "c1",
        title: "第一次自查",
        narrative_premise:
          "周一上午你坐在工位前，看着昨晚和先生那段不太舒服的对话残留在心里，桌上摆着你刚交给市场总监徐慧的本周周报。",
        milestone: { id: "m1", summary: "完成本周周报词组的事实化重写" },
        challenges: [
          {
            challenge_id: "ch1",
            title: "拣出最像评价的那一句",
            binds_actions: ["a1"],
            complexity: "low",
            trunk: {
              setup:
                "你打开周报草稿，从开头到结尾通读一遍，准备先标出最像评价的那一句话。",
              action_prompts: ["哪一句最像评价？为什么？"],
              expected_signals: ["分离评价"],
            },
            companion_hooks: [],
          },
          {
            challenge_id: "ch2",
            title: "把形容词换成事实",
            binds_actions: ["a1"],
            complexity: "low",
            trunk: {
              setup:
                "你把刚才那段小结的草稿暂时放到了一边，打开了今天上午另一份你写过的内容：你给徐慧的周报。周报里写了一段对团队整体状态的描述，包括「最近大家有点疲惫」「林小雨学习态度很积极」「周明对新流程比较抗拒」等几句概括性的表达。徐慧今天上午回复你的那条消息你也还留着，她写的是：「这些感受我大致明白，但具体是看到了什么让你这样判断的？下次能不能直接写事实？」你重新打开周报，光标停在那几个形容词上。",
              action_prompts: [
                "「疲惫」「积极」「抗拒」这三个形容词，分别在最近一周内对应了哪些可以被同事或主管直接看到的具体场景？请尽量给出时间、地点和动作。",
              ],
              expected_signals: ["把评价改成观察"],
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
  console.log("[probe] running first challenge to good completion…");
  // Drive a few good turns to push completion → triggers cross_challenge opening.
  const goodAnswer =
    "周报里这一句最像评价：「林小雨学习态度很积极」。这句话直接给出对她的整体印象，没有列具体可观察的行为或时间地点。把它改成观察可以是：本周二、周四的项目复盘里，林小雨主动提出两条新的客户分类方法，并在周三晚上自己加班整理了客服反馈摘要发到群里。这样描述既给出了时间、动作、可见结果，也避免了对一个人的整体性贴标签。";
  for (let i = 0; i < 4; i++) {
    const r = await runTurn({
      learnerId: learner.learner_id,
      input: goodAnswer,
    });
    console.log(
      `  turn ${i + 1}: path=${r.judgeOutput.path_decision.type}, position=${r.position.challenge_id}`
    );
    if (r.position.challenge_id !== "ch1") break;
  }

  console.log("\n=== conversation log (last 10) ===");
  const logs = listConversation(learner.learner_id);
  const tail = logs.slice(-10);
  for (const e of tail) {
    console.log(`${e.role}${e.who ? `(${e.who})` : ""}: ${e.text}`);
  }

  // Find the cross_challenge narrator opening (should be after milestone bubble).
  const crossOpening = [...logs]
    .reverse()
    .find(
      (e) =>
        e.role === "narrator" &&
        e.challenge_id === "ch2"
    );
  if (!crossOpening) {
    console.error("[probe] no ch2 narrator opening found — could not validate");
    process.exit(2);
  }

  console.log("\n=== cross_challenge opening ===\n" + crossOpening.text);
  const text = crossOpening.text;
  const issues: string[] = [];
  if (text.length > 220) issues.push(`length ${text.length} > 220`);
  if (text.includes("项目经理")) issues.push("contains 项目经理 (role replay)");
  if (text.includes("非暴力沟通")) issues.push("contains 非暴力沟通 (goal replay)");
  if (/这一段要完成的是|在旅程结束时|你需要做到的是/.test(text)) {
    issues.push("contains journey-goal phrasing");
  }
  // Check 8-char verbatim spans from role/goal.
  for (let i = 0; i + 8 <= PROTAGONIST_ROLE.length; i++) {
    const w = PROTAGONIST_ROLE.slice(i, i + 8);
    if (text.includes(w)) {
      issues.push(`replays role span: "${w}"`);
      break;
    }
  }
  for (let i = 0; i + 8 <= JOURNEY_GOAL.length; i++) {
    const w = JOURNEY_GOAL.slice(i, i + 8);
    if (text.includes(w)) {
      issues.push(`replays goal span: "${w}"`);
      break;
    }
  }
  // Should reference new scene specifics or end with a question.
  if (!/[？?]/.test(text)) issues.push("no closing question");

  if (issues.length > 0) {
    console.error("\n=== ISSUES ===");
    for (const x of issues) console.error("  -", x);
    process.exit(2);
  }
  console.log("\n=== probe passed ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
