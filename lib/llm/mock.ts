// Deterministic mock LLM outputs for every caller.
// Keeps the system runnable without ANTHROPIC_API_KEY and makes E2E tests stable.

import type { PromptBody } from "@/lib/prompt-store/render";

export interface MockResult {
  output: unknown;
  text: string;
  promptTokens: number;
  outputTokens: number;
  cacheRead: number;
}

export function mockForCaller(
  caller: string,
  variables: Record<string, unknown>,
  _prompt: PromptBody
): MockResult {
  const topic = (variables.topic as string) ?? "情境领导力";

  if (caller === "skill_1_gamecore") return mockGamecore(topic);
  if (caller === "skill_2_experience") return mockExperience(variables);
  if (caller === "skill_3_script_skeleton") return mockScriptSkeleton(variables);
  if (caller === "skill_3_script_fill") return mockScriptFill(variables);
  if (caller === "skill_4_companion") return mockCompanions(variables);
  if (caller === "design_copilot_chat") return mockCopilotChat(variables);
  if (caller === "judge") return mockJudge(variables);
  if (caller === "narrator") return mockNarrator(variables);
  if (caller === "narrator_opening") return mockNarratorOpening(variables);
  if (caller.startsWith("companion:")) return mockCompanion(caller, variables);
  if (caller === "summary_compressor") return mockSummary(variables);
  if (caller === "recap_generator") return mockRecap(variables);

  // generic fallback
  const text = `[mock:${caller}] topic=${topic}`;
  return { output: { text }, text, promptTokens: 50, outputTokens: 10, cacheRead: 0 };
}

// -------- Skill 1 --------
function mockGamecore(topic: string): MockResult {
  const payload = {
    core_actions: [
      {
        action_id: "a1",
        name: "读懂准备度",
        description: `在 ${topic} 的情境中识别对方当前的能力与意愿水平`,
        knowledge_type: "procedural",
        relations: [{ to: "a2", type: "precedes" }],
        signature_moves: [
          {
            move_id: "sm_a1_task_split",
            name: "分任务诊断",
            definition: "不给人贴整体标签，对同一人在不同任务上分别落档",
            recognition_hint: "学员在同一下属身上给出两个不同 R 档并引用任务差异",
            bound_actions: ["a1"],
            tier_thresholds: [1, 3, 5],
          },
          {
            move_id: "sm_a1_behavior_to_state",
            name: "察其细微",
            definition: "从一个具体行为动作反推到底层能力或意愿",
            recognition_hint: "学员指出具体肢体/语言动作并推出心理或能力状态",
            bound_actions: ["a1"],
            tier_thresholds: [1, 3, 5],
          },
        ],
        quality_matrix: buildMatrix("读懂准备度"),
      },
      {
        action_id: "a2",
        name: "匹配领导风格",
        description: "根据准备度判断选择 S1-S4 中最合适的领导风格",
        knowledge_type: "procedural",
        relations: [{ to: "a3", type: "precedes" }],
        signature_moves: [
          {
            move_id: "sm_a2_style_switch",
            name: "同人换挡",
            definition: "对同一人在不同任务上用不同领导风格",
            recognition_hint: "学员对同一下属不同任务给出不同 S 风格并解释切换依据",
            bound_actions: ["a2"],
            tier_thresholds: [1, 3, 5],
          },
          {
            move_id: "sm_a2_concrete_language",
            name: "具体到台词",
            definition: "不只说风格名，直接给出具体开口句",
            recognition_hint: "学员给出带时间/动作的具体开口台词而非抽象 'S2 风格' 表述",
            bound_actions: ["a2"],
            tier_thresholds: [1, 3, 5],
          },
        ],
        quality_matrix: buildMatrix("匹配领导风格"),
      },
      {
        action_id: "a3",
        name: "给出具体动作",
        description: "将领导风格转化为可操作的语言/行为",
        knowledge_type: "procedural",
        relations: [],
        signature_moves: [
          {
            move_id: "sm_a3_time_action",
            name: "时限动作句",
            definition: "把要求落到具体的时间点 + 具体动作上",
            recognition_hint: "学员输出包含时间点（本周 X / 明天 X 点）+ 具体动作描述的句子",
            bound_actions: ["a3"],
            tier_thresholds: [1, 3, 5],
          },
        ],
        quality_matrix: buildMatrix("给出具体动作"),
      },
    ],
    relation_graph: [
      { from: "a1", to: "a2", type: "precedes" },
      { from: "a2", to: "a3", type: "precedes" },
    ],
    reasoning_notes: `针对主题「${topic}」选出 3 个指向迁移的核心动作 + 招式谱。`,
  };
  const text = JSON.stringify(payload);
  return { output: payload, text, promptTokens: 420, outputTokens: 280, cacheRead: 180 };
}

function buildMatrix(actionName: string) {
  const dimensions = [
    { dim_id: "d1", name: "信息采集", type: "process" as const },
    { dim_id: "d2", name: "判断准确性", type: "outcome" as const },
    { dim_id: "d3", name: "推理路径", type: "process" as const },
  ];
  const complexity_levels = ["low", "medium", "high"] as const;
  const rubrics: Record<string, Record<string, { good: string; medium: string; poor: string }>> = {};
  for (const d of dimensions) {
    rubrics[d.dim_id] = {};
    for (const c of complexity_levels) {
      rubrics[d.dim_id][c] = {
        good: `[${actionName}·${d.name}·${c}] 区分出表层与底层信号并引用具体情境细节`,
        medium: `[${actionName}·${d.name}·${c}] 注意到关键线索但未深入分析`,
        poor: `[${actionName}·${d.name}·${c}] 只关注表层信号`,
      };
    }
  }
  return { dimensions, complexity_levels, rubrics };
}

// -------- Skill 2 --------
function mockExperience(variables: Record<string, unknown>): MockResult {
  const actions =
    (variables.core_actions as { action_id: string; name: string }[]) ?? [];
  const forms = [
    { id: "what_if_simulator", name: "What-If 模拟器" },
    { id: "teach_npc", name: "教会 NPC" },
    { id: "mystery_investigation", name: "悬疑调查" },
  ];
  const payload = {
    mappings: actions.map((a, i) => ({
      action_id: a.action_id,
      form_id: forms[i % forms.length].id,
      form_name: forms[i % forms.length].name,
      rationale: `${a.name} 需要快速判断与即时反馈，${forms[i % forms.length].name} 的因果链路能把学员放在驾驶座上`,
      engagement_level: "constructive",
    })),
    form_library_version: "v1",
  };
  const text = JSON.stringify(payload);
  return { output: payload, text, promptTokens: 300, outputTokens: 180, cacheRead: 220 };
}

// -------- Skill 3 骨架 --------
function mockScriptSkeleton(variables: Record<string, unknown>): MockResult {
  const actions =
    (variables.core_actions as { action_id: string; name: string }[]) ?? [];
  const chapters = [
    { id: "c1", title: "新官上任", milestone: "首次做出正确的领导选择", complexity: "low", arc: "arc_s1" },
    { id: "c2", title: "风暴来临", milestone: "在冲突情境中保持判断", complexity: "medium", arc: "arc_s2" },
    { id: "c3", title: "独当一面", milestone: "在高压情境中维持稳定", complexity: "high", arc: "arc_s3" },
  ];
  const payload = {
    journey_meta: {
      arc_type: "hero_journey",
      tone: "cinematic_workplace",
      estimated_duration_min: 180,
      arc_stages: [
        {
          id: "arc_s1",
          name: "觉察",
          position: 0,
          signature_question: "在一堆表层行为里，你能读出哪一条是真的信号？",
          narrator_voice_hint: "节奏缓、镜头贴近",
        },
        {
          id: "arc_s2",
          name: "试炼",
          position: 1,
          signature_question: "同一个人、两件事，你的判断还能站得住吗？",
          narrator_voice_hint: "节奏紧、利害前置",
        },
        {
          id: "arc_s3",
          name: "蜕变",
          position: 2,
          signature_question: "把判断变成开口的那一句，你打算怎么说？",
          narrator_voice_hint: "逼到桌面、要具体",
        },
      ],
    },
    chapters: chapters.map((c) => ({
      chapter_id: c.id,
      title: c.title,
      milestone_summary: c.milestone,
      arc_stage_id: c.arc,
      challenges: actions.map((a, ai) => ({
        challenge_id: `${c.id}_ch${ai + 1}`,
        title: `${c.title} · ${a.name}`,
        binds_actions: [a.action_id],
        complexity: c.complexity,
      })),
    })),
  };
  const text = JSON.stringify(payload);
  return { output: payload, text, promptTokens: 500, outputTokens: 240, cacheRead: 300 };
}

// -------- Skill 3 填充（单章节模式）--------
function mockScriptFill(variables: Record<string, unknown>): MockResult {
  // New per-chapter protocol: variables.skeleton = { journey_meta, chapter }
  const sk = (variables.skeleton as {
    journey_meta?: Record<string, unknown>;
    chapter?: {
      chapter_id: string;
      title: string;
      milestone_summary?: string;
      challenges: { challenge_id: string; title: string; binds_actions: string[]; complexity: string }[];
    };
  }) ?? {};
  const chap = sk.chapter;
  if (!chap) {
    // Fallback: empty shape the parser will reject cleanly.
    const payload = { chapters: [] };
    const text = JSON.stringify(payload);
    return { output: payload, text, promptTokens: 400, outputTokens: 20, cacheRead: 200 };
  }
  const filled = {
    chapter_id: chap.chapter_id,
    title: chap.title,
    narrative_premise: `${chap.title} 是学员第一次直面 ${chap.milestone_summary ?? ""} 的舞台。`,
    milestone: { id: `m_${chap.chapter_id}`, summary: chap.milestone_summary ?? "" },
    challenges: chap.challenges.map((ch, chi) => ({
      challenge_id: ch.challenge_id,
      title: ch.title,
      binds_actions: ch.binds_actions,
      complexity: ch.complexity,
      trunk: {
        setup: `${ch.title}。场景：你被临时指派去和一位下属沟通一项紧急任务。你会先观察什么？`,
        action_prompts: [
          "请描述你从对方的语言/行为中读到的信号。",
          "你判断其准备度为哪一等级？依据是什么？",
        ],
        expected_signals: ["能区分表层与底层信号", "能给出判断依据"],
      },
      companion_hooks: [
        {
          hook_id: `h_${ch.challenge_id}_guide`,
          condition: { companion_type: "npc_guide", min_level: 1 },
          delta: {
            pre_action_injection: "向导先做一句情境铺垫，让学员进入角色",
            post_action_injection: "向导用一个 2 句话的比喻帮学员把判断接地",
            scaffold_override: null,
          },
        },
      ],
      // Mock artifacts: first challenge of each chapter gets a fields-type
      // artifact (员工档案) that drops on enter, plus a series-type artifact
      // (对话记录) that drops on learner request. Keeps E2E tests deterministic.
      artifacts:
        chi === 0
          ? [
              {
                artifact_id: `art_${ch.challenge_id}_profile`,
                name: "下属员工档案",
                icon_hint: "📇",
                type: "fields",
                content: {
                  title: "下属员工档案 · 小陈",
                  fields: [
                    { key: "姓名", value: "陈雨" },
                    { key: "入职", value: "2025-10 · 半年" },
                    { key: "岗位", value: "销售顾问 · 见习" },
                    { key: "近期表现", value: "学习积极，但独立完成单子的能力还在构建中", status: "highlight" },
                  ],
                },
                trigger: "on_challenge_enter",
                version: 1,
              },
              {
                artifact_id: `art_${ch.challenge_id}_conversation`,
                name: "昨日你和他的对话记录",
                icon_hint: "💬",
                type: "series",
                content: {
                  title: "昨日对话节选",
                  entries: [
                    { timestamp: "昨日 10:30", actor: "你", text: "这一单的进度怎么样？" },
                    { timestamp: "昨日 10:31", actor: "小陈", text: "还在和客户对一些条款，我有点拿不准哪个要让步。" },
                    { timestamp: "昨日 10:33", actor: "你", text: "你把关键点发我一份，我看看。" },
                  ],
                },
                trigger: "on_learner_request",
                trigger_hint: "学员询问昨日发生了什么 / 他们之前聊过什么 / 小陈昨天说了什么",
                version: 1,
              },
            ]
          : [],
    })),
  };
  const payload = { chapters: [filled] };
  const text = JSON.stringify(payload);
  return { output: payload, text, promptTokens: 500, outputTokens: 260, cacheRead: 300 };
}

// -------- Skill 4 --------
function mockCompanions(_variables: Record<string, unknown>): MockResult {
  const payload = {
    companions: [
      {
        companion_id: "cp_guide",
        companion_type: "npc_guide",
        display_name: "Elena（资深 HRBP）",
        unique_value_hypothesis: "她的金句式比喻能在高复杂度场景降低认知负荷",
        effectiveness_mechanism: "把抽象判断接地到具体场景，提升迁移率",
        persona: {
          background: "资深 HRBP，10 年制造业经验",
          personality_traits: ["务实", "爱用比喻", "偶尔毒舌"],
          speech_patterns: {
            sentence_length: "short",
            typical_phrases: ["说白了…", "你试试看…"],
            avoid: ["学术大词", "长段说教"],
          },
          knowledge_boundary: "熟悉基层管理；不讨论薪酬/合规法条",
          relationship_stages: [
            { level: 1, stance: "礼貌专业但有距离" },
            { level: 2, stance: "亲近，会分享轶事" },
            { level: 3, stance: "开放隐藏故事线" },
          ],
          interaction_rules: {
            speak_when: "Judge 派发且处于 hook 激活状态",
            silent_when: "主干 setup 阶段 / 学员偏题探索",
          },
        },
        unlock_rule: { type: "points_threshold", value: 30 },
        upgrade_path: [
          { level: 1, delta: "仅提示" },
          { level: 2, delta: "增加情境比喻库" },
          { level: 3, delta: "解锁 Elena 的个人故事线（隐藏剧情）" },
        ],
        companion_priority: 50,
        output_format: "dialog_text",
        io_spec: { max_tokens: 300 },
      },
      {
        companion_id: "cp_case",
        companion_type: "case_pack",
        display_name: "实战案例包",
        unique_value_hypothesis: "另一个行业/角色的情境能检验学员是否真正迁移",
        effectiveness_mechanism: "同一核心动作换行业做一次，暴露脆弱的判断",
        persona: {
          background: "一组真实情境的文本集合（非 NPC）",
          personality_traits: [],
          speech_patterns: { sentence_length: "medium", typical_phrases: [], avoid: [] },
          knowledge_boundary: "仅提供情境，不解读",
          relationship_stages: [{ level: 1, stance: "中立" }],
          interaction_rules: {
            speak_when: "学员主动请求额外情境",
            silent_when: "学员正在主线挑战中",
          },
        },
        unlock_rule: { type: "points_threshold", value: 55 },
        upgrade_path: [
          { level: 1, delta: "3 个基础案例" },
          { level: 2, delta: "增加跨行业案例" },
          { level: 3, delta: "开放带反思模板的专家批注案例" },
        ],
        companion_priority: 30,
        output_format: "reading_artifact",
        io_spec: { max_tokens: 400 },
      },
      {
        companion_id: "cp_replay",
        companion_type: "replay_lens",
        display_name: "复盘视角",
        unique_value_hypothesis: "可视化成长轨迹把「我在进步」变得可见",
        effectiveness_mechanism: "调用质性层 evidence 历史渲染成长曲线",
        persona: {
          background: "一个时间线视图 + 自动标注（非 NPC）",
          personality_traits: [],
          speech_patterns: { sentence_length: "short", typical_phrases: [], avoid: [] },
          knowledge_boundary: "仅基于学员自身 evidence 历史",
          relationship_stages: [{ level: 1, stance: "客观" }],
          interaction_rules: {
            speak_when: "学员主动请求复盘",
            silent_when: "默认",
          },
        },
        unlock_rule: { type: "points_threshold", value: 85 },
        upgrade_path: [
          { level: 1, stance: "按 challenge 列时间线" },
          { level: 2, delta: "按 dimension 聚合" },
          { level: 3, delta: "与同类学员对比" },
        ],
        companion_priority: 20,
        output_format: "visualization",
        io_spec: { max_tokens: 200 },
      },
    ],
  };
  const text = JSON.stringify(payload);
  return { output: payload, text, promptTokens: 700, outputTokens: 500, cacheRead: 450 };
}

// -------- Copilot Chat --------
function mockCopilotChat(variables: Record<string, unknown>): MockResult {
  const userMsg = (variables.user_message as string) ?? "";
  const text = `收到。我将基于主题「${variables.topic ?? "你给定的主题"}」执行：${userMsg || "继续下一步"}。`;
  return { output: { text }, text, promptTokens: 200, outputTokens: 45, cacheRead: 100 };
}

// -------- Judge --------
function mockJudge(variables: Record<string, unknown>): MockResult {
  const learner = (variables.learner_input as string) ?? "";
  // 简化质量评估：看学员输入长度决定 good/medium/poor
  const L = learner.length;
  const grade = L > 120 ? "good" : L > 40 ? "medium" : "poor";
  const dims = ["d1", "d2", "d3"];
  const activeCompanions =
    (variables.active_companions as { companion_id: string; level: number }[]) ?? [];
  const challengeComplexity =
    (variables.challenge_complexity as string) ??
    ((variables.current_challenge as { complexity?: string })?.complexity) ??
    "low";
  // Detect artifact-request intent: if learner asked a "who / what about X / 昨天 / 对话"
  // style question AND there is a pending artifact whose trigger_hint matches,
  // emit a DROP_ARTIFACT event.
  const pendingArtifacts =
    (variables.pending_artifacts as
      | Array<{ artifact_id: string; trigger?: string; trigger_hint?: string; name?: string }>
      | undefined) ?? [];
  const artifactEvents: { type: string; payload: Record<string, unknown> }[] = [];
  const lowerLearner = learner.toLowerCase();
  const wantsWho = /是谁|什么人|身份|背景|小陈|他是谁|who|about him|about her/i.test(learner);
  const wantsYesterdayChat = /昨天|昨日|对话|聊过|沟通记录|记录/.test(learner);
  for (const p of pendingArtifacts) {
    if (p.trigger !== "on_learner_request") continue;
    const hint = (p.trigger_hint ?? "").toLowerCase();
    if (
      (wantsWho && (hint.includes("是谁") || hint.includes("背景") || hint.includes("who"))) ||
      (wantsYesterdayChat && (hint.includes("昨天") || hint.includes("昨日") || hint.includes("对话"))) ||
      (hint && lowerLearner && hint.split("/").some((k) => k.trim() && lowerLearner.includes(k.trim().toLowerCase())))
    ) {
      artifactEvents.push({ type: "DROP_ARTIFACT", payload: { artifact_id: p.artifact_id } });
    }
  }
  // Runtime-derived scaffold signals.
  const consecutivePoor = Number(variables.consecutive_poor_in_challenge ?? 0);
  const selfHelp = Boolean(variables.self_help_signal);
  const helpIntent = String(variables.help_intent ?? "none");
  const responseFrames =
    (variables.response_frames as
      | Array<{
          frame_id: string;
          kind: string;
          fields?: Array<{ field_id: string; label?: string }>;
        }>
      | undefined) ?? [];
  const activeFrame = variables.active_response_frame as
    | { frame_id?: string; kind?: string; title?: string }
    | undefined;
  const structuredFrame =
    responseFrames.find((frame) => frame.frame_id === activeFrame?.frame_id) ??
    responseFrames.find((frame) => frame.kind !== "free_text");

  // Decision priorities:
  //   (1) Self-help signal OR consecutive_poor ≥ 5 → simplify_challenge
  //   (2) consecutive_poor ≥ 3 → scaffold+worked_example
  //   (3) consecutive_poor ≥ 2 → scaffold with a contextual strategy
  //   (4) grade=good && turn_idx ≥ 2 → complete_challenge
  //   (5) grade=good → advance
  //   (6) grade=medium → retry
  //   (7) grade=poor → scaffold (contextual strategy)
  const challengeTurnIdx = Number(variables.challenge_turn_idx ?? 0);
  let decisionType:
    | "advance"
    | "retry"
    | "scaffold"
    | "complete_challenge"
    | "reveal_answer_and_advance"
    | "simplify_challenge" = "advance";
  let scaffoldStrategy:
    | "worked_example"
    | "contrastive_cases"
    | "chunked_walkthrough"
    | "analogy_bridge"
    | "retrieval_prompt"
    | "near_transfer_demo"
    | "concept_scaffold"
    | "self_explanation"
    | null = null;

  if (helpIntent === "reveal") {
    decisionType = "reveal_answer_and_advance";
    scaffoldStrategy = "worked_example";
  } else if (selfHelp || consecutivePoor >= 5) {
    decisionType = "simplify_challenge";
    scaffoldStrategy = "worked_example";
  } else if (consecutivePoor >= 3) {
    decisionType = "scaffold";
    scaffoldStrategy = "worked_example";
  } else if (grade === "good" && challengeTurnIdx >= 2) {
    decisionType = "complete_challenge";
  } else if (grade === "good") {
    decisionType = "advance";
  } else if (grade === "medium") {
    decisionType = "retry";
  } else {
    // poor but consecutive < 3 — softer scaffold by context.
    decisionType = "scaffold";
    // Cycle strategies per turn for some deterministic variety in mock mode.
    const strategies = [
      "contrastive_cases",
      "chunked_walkthrough",
      "concept_scaffold",
      "retrieval_prompt",
    ] as const;
    scaffoldStrategy = strategies[challengeTurnIdx % strategies.length];
  }

  const mockMissingFieldIds =
    grade === "good"
      ? []
      : (structuredFrame?.fields ?? [])
          .map((field) => field.field_id)
          .filter((fieldId) => !/^(person|name|text)$/.test(fieldId))
          .slice(0, grade === "medium" ? 1 : 2);

  const payload = {
    quality: dims.map((d) => ({
      dim_id: d,
      grade,
      evidence:
        grade === "good"
          ? "学员引用了具体情境并给出多层推理。"
          : grade === "medium"
          ? "学员抓住了主要线索但未深入分析影响源。"
          : "学员仅描述表层现象，未给出判断依据。",
      // Quotable heuristic: long learner input + good grade + first-person
      // synthesis markers. Mock fires on d1 only to avoid over-tagging.
      quotable:
        d === "d1" &&
        grade === "good" &&
        learner.length > 60 &&
        /我(判断|觉得|认为|想|会)|我的(判断|理解)/.test(learner),
    })),
    diagnosis: {
      stuck_reason:
        helpIntent === "reveal"
          ? "frustration"
          : selfHelp
          ? "self_help"
          : grade === "good"
          ? "none"
          : grade === "medium"
          ? "surface_level"
          : "missing_evidence",
      evidence:
        grade === "good"
          ? "本轮没有明显卡点。"
          : "学员当前回答缺少可核验的关键证据，容易变成只给结论。",
      focus_dim_ids: grade === "good" ? [] : ["d2", "d3"],
      missing_field_ids: mockMissingFieldIds,
      confidence: grade === "good" ? "low" : "medium",
    },
    path_decision: {
      type: decisionType,
      target: null,
      scaffold_spec: scaffoldStrategy
        ? {
            strategy: scaffoldStrategy,
            focus_dim: "d3",
            notes: "",
          }
        : null,
    },
    narrator_directive:
      decisionType === "reveal_answer_and_advance"
        ? "直接给出参考答案和判断依据，明确告诉学员本题到此收束，并承接到下一挑战。"
        : grade === "good"
        ? "肯定其信息采集与推理的深度，并引入更高复杂度的后续情境。"
        : grade === "medium"
        ? "肯定他注意到的线索，追问他忽略的那一层。"
        : "温和引导回主题；用一个具体提问打开他的思路，不要给答案。",
    companion_dispatch: activeCompanions.map((c) => ({
      companion_id: c.companion_id,
      role: "speaker",
      directive:
        grade === "poor"
          ? "用一句接地的比喻帮学员把抽象概念具体化"
          : "简短肯定并补一句个性化评论",
      priority: 50,
    })),
    script_branch_switch: null,
    event_triggers: buildMockEventTriggers({
      grade,
      challengeComplexity,
      artifactEvents,
      learner,
      eligibleSignatureMoves:
        (variables.eligible_signature_moves as Array<{
          move_id: string;
          name: string;
          recognition_hint: string;
        }> | undefined) ?? [],
    }),
    next_response_frame:
      structuredFrame && mockMissingFieldIds.length > 0
        ? {
            frame_id: structuredFrame.frame_id,
            reason: "只补本轮诊断出的缺口，避免重复填写已成立字段。",
            field_ids: mockMissingFieldIds,
            overrides: {
              title: "只补还缺的部分",
              prompt: "前面已经成立的内容不用重填，这轮只补下面这些缺口。",
            },
          }
        : null,
  };
  const text = JSON.stringify(payload);
  return { output: payload, text, promptTokens: 900, outputTokens: 320, cacheRead: 700 };
}

/** Mock Judge event composer — mirrors the priority the real Judge uses.
 *  Emits AWARD_POINTS always, DROP_ARTIFACT for matched triggers, and a single
 *  AWARD_SIGNATURE_MOVE when learner text semantically matches a
 *  recognition_hint (very rough keyword overlap; good enough for mock tests). */
function buildMockEventTriggers(args: {
  grade: string;
  challengeComplexity: string;
  artifactEvents: { type: string; payload: Record<string, unknown> }[];
  learner: string;
  eligibleSignatureMoves: Array<{
    move_id: string;
    name: string;
    recognition_hint: string;
  }>;
}): { type: string; payload: Record<string, unknown> }[] {
  const events: { type: string; payload: Record<string, unknown> }[] = [
    { type: "AWARD_POINTS", payload: { grade: args.grade, complexity: args.challengeComplexity } },
    ...args.artifactEvents,
  ];
  // Signature move recognition — only when learner is at least medium.
  // Use bigram-overlap heuristic (paraphrase-tolerant) — good enough for mocks.
  if (args.grade !== "poor" && args.learner.length > 30) {
    for (const m of args.eligibleSignatureMoves) {
      const hint = m.recognition_hint ?? "";
      if (hint.length < 6) continue;
      const hintBigrams = collectBigrams(hint);
      if (hintBigrams.size === 0) continue;
      const learnerBigrams = collectBigrams(args.learner);
      let hits = 0;
      for (const g of hintBigrams) if (learnerBigrams.has(g)) hits++;
      // Require ≥ 3 bigram overlaps AND ≥ 20% of hint's bigrams.
      if (hits >= 3 && hits / hintBigrams.size >= 0.2) {
        events.push({
          type: "AWARD_SIGNATURE_MOVE",
          payload: { move_id: m.move_id },
        });
        break; // Max 1 move per turn (per Judge rules).
      }
    }
  }
  return events;
}

/** Extract 2-character CJK bigrams (sliding window), ignoring punctuation/spaces.
 *  Used by mock to do paraphrase-tolerant overlap. */
function collectBigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 <= s.length; i++) {
    const g = s.slice(i, i + 2);
    if (/^[一-龥A-Za-z]{2}$/.test(g)) out.add(g);
  }
  return out;
}

// -------- Narrator (per-turn response) --------
function mockNarrator(variables: Record<string, unknown>): MockResult {
  // Grounded mock. In scaffold / simplify_challenge mode, output contains
  // the strategy-specific content required by the Narrator validator
  // (quoted example ≥ 20 chars for worked_example / contrastive_cases /
  // chunked_walkthrough).
  const learnerInput = ((variables.learner_input as string) ?? "").trim();
  const echo = pickLearnerEcho(learnerInput);
  const newDrops =
    (variables.newly_dropped_artifacts as Array<{ name: string; summary?: string }> | undefined) ??
    [];
  const characters =
    (variables.characters_introduced as Array<{ name: string; identity: string }> | undefined) ??
    [];
  const pathType =
    ((variables.judge_path_decision as { type?: string } | undefined)?.type) ?? "advance";
  const scaffoldStrategy =
    ((variables.judge_path_decision as {
      scaffold_spec?: { strategy?: string };
    } | undefined)?.scaffold_spec?.strategy) ??
    (variables.scaffold_strategy as string) ??
    "";
  const personRef = characters[0] ? `${characters[0].name}（${characters[0].identity}）` : "他";
  const personName = characters[0] ? characters[0].name : "他";

  let text: string;
  if (pathType === "enter_review") {
    // Review beat: state the canonical answer + reasoning + where the
    // learner went off, no questions, no hedging. Pulls verbatim from the
    // designer-authored payload that runtime fed in.
    const modelJudgment = String(variables.model_judgment ?? "").trim();
    const selectedMisreading = String(variables.selected_misreading ?? "").trim();
    const baseAnswer = modelJudgment ||
      `这道题的准确读法应当先把信号拆开看，再合起来下判断。`;
    const misreadingTail = selectedMisreading
      ? ` ${selectedMisreading}`
      : ` 学员这一答把表层信号当成了底层判断的依据，跳过了证据这一层。`;
    text = `${baseAnswer}${misreadingTail}`;
  } else if (pathType === "complete_challenge") {
    text =
      `你刚才关于${echo}的判断已经立得住脚——从表层现象走到了底层状态，还给出了具体依据。` +
      `把这一段收在这里，你已经在${personRef}这条线索上建立起一个可靠的判断框架。`;
  } else if (pathType === "simplify_challenge") {
    text =
      `这段我们换个轻的打法——我给你两段开口台词做对照。` +
      `A：「${personName}，这周五前把前 10 个客户录进新系统，我周四下午陪你过半小时，卡在哪个字段就在那儿问我。」` +
      `B：「${personName}，你能力很强，希望你带个头把系统用起来。」` +
      `这两段里，哪一段更接近你在本轮任务上想说的？为什么？`;
  } else if (pathType === "scaffold") {
    text = buildScaffoldText(scaffoldStrategy, {
      echo,
      personName,
      personRef,
      newDrops,
    });
  } else if (pathType === "retry") {
    const artifactHook = newDrops[0]
      ? `桌上那份《${newDrops[0].name}》${newDrops[0].summary ? `里提到「${newDrops[0].summary.slice(0, 24)}」` : ""}，`
      : "";
    text =
      `你注意到${echo}这一点，但背后的依据还没立起来。${artifactHook}` +
      `能不能挑一个具体细节，来区分这是他「能力」上的问题还是「意愿」上的问题？`;
  } else if (pathType === "escalate_complexity") {
    text =
      `你在${echo}这一层已经站住了。换个更棘手的情境继续练一练：` +
      `假设${personRef}今天表现反复无常，你同样的判断还成立吗？依据要变吗？`;
  } else {
    // advance / default
    const drop = newDrops[0];
    text = drop
      ? `你提到${echo}——正好桌上那份《${drop.name}》${drop.summary ? `写着「${drop.summary.slice(0, 26)}」，` : "就在眼前，"}` +
        `从这条细节里，你会先区分出哪些是表层信号、哪些是底层状态？`
      : `你注意到${echo}这一点，是个好切入。` +
        `再往下一层：这个信号指向的是${personRef}的能力问题，还是意愿问题？依据是什么？`;
  }
  return { output: { text }, text, promptTokens: 650, outputTokens: 80, cacheRead: 500 };
}

/** Scaffold-mode strategy-specific prose. Each branch produces content that
 *  meets the Narrator output validator (e.g., worked_example / contrastive_cases
 *  / chunked_walkthrough must include a ≥20-char quoted segment). */
function buildScaffoldText(
  strategy: string,
  ctx: {
    echo: string;
    personName: string;
    personRef: string;
    newDrops: Array<{ name: string; summary?: string }>;
  }
): string {
  const { echo, personName, personRef } = ctx;
  switch (strategy) {
    case "worked_example":
      return (
        `你提到${echo}——我先给你一版参考台词：` +
        `「${personName}，这周五前你把前 10 个客户录进新系统，我周四下午陪你过半小时，卡在哪个字段我们当场拆。」` +
        `这段和你刚才的说法比，差在哪一步？`
      );
    case "contrastive_cases":
      return (
        `围绕${echo}这件事，我给你两段对照台词。` +
        `A：「${personName}，你的方案我看了很漂亮；CRM 那套你照老习惯走就行。」` +
        `B：「${personName}，方案那头按你节奏，CRM 这头周五前必须录完前 10 个客户，我周四陪你过半小时。」` +
        `${personName}听到 A 会怎么接？听到 B 呢？`
      );
    case "chunked_walkthrough":
      return (
        `咱分两步。第一步我先打样：「${personRef}在方案这件事上是高能力高意愿，落 R4，证据是他独立完成且来通报结果。」` +
        `第二步轮你——同一个人，在 CRM 这件事上能力/意愿各是什么？给我一个判断 + 一条证据。`
      );
    case "analogy_bridge":
      return (
        `这就像带一位做了十年的老木匠——手艺没问题、让他换一把新刨子他就蹭。` +
        `放回${personRef}身上，他此刻最像类比里的哪一步：手上没工具，还是工具在手上但不愿意换？`
      );
    case "retrieval_prompt":
      return (
        `你在上一个挑战已经说过「${echo}」——这次在${personName}身上，` +
        `能不能把那个观察方法搬过来直接用一次，不用重新想框架。`
      );
    case "near_transfer_demo":
      return (
        `回想你在上一幕里抓到的那一个关键小动作，从它读出了底层状态。` +
        `这次在${personName}身上，有没有类似的「手上的小动作」或「语气里的顿挫」？`
      );
    case "concept_scaffold":
      return (
        `诊断准备度时要收两条证据：【能力线索】——他具体做过什么、做得怎么样；` +
        `【意愿线索】——他的动作节奏、语气、眼神是不是主动。` +
        `这两组，你手上有哪些，还缺哪一条？`
      );
    case "self_explanation":
      return (
        `先别急着给答案——你能不能用你自己的话讲一遍，${personName}刚才那句真正在说什么？` +
        `先把这一层说清，再谈怎么回他。`
      );
    default:
      // Unknown strategy fallback — still satisfies "no empty open question"
      // by referencing echo concretely.
      return `围绕${echo}，再给一条最具体的一个证据，它指向能力还是意愿？`;
  }
}

/** Pick a short semantic fragment from the learner's input to echo back.
 *  Not a keyword extractor — just the first meaningful clause/noun-ish span. */
function pickLearnerEcho(input: string): string {
  if (!input) return "刚才这个方向";
  // Split on Chinese/Western punctuation into clauses, pick the longest meaningful one up to 12 chars.
  const clauses = input.split(/[，,。.！!？?；;：:\s]+/).filter((x) => x.trim().length > 0);
  if (clauses.length === 0) return input.slice(0, 10) || "刚才这个方向";
  const best = clauses.sort((a, b) => b.length - a.length)[0];
  return best.length > 12 ? best.slice(0, 12) : best;
}

// -------- Narrator opening --------
function mockNarratorOpening(variables: Record<string, unknown>): MockResult {
  const variant = ((variables.opening_variant as string) ?? "first") as
    | "first"
    | "cross_challenge";
  const role = (variables.protagonist_role as string) ?? "你正走入这个场景";
  const journeyGoal = ((variables.journey_goal as string) ?? "").trim();
  const chapterTitle = (variables.chapter_title as string) ?? "";
  const challengeTitle = (variables.challenge_title as string) ?? "";
  const setup = ((variables.challenge_setup as string) ?? "").trim();
  const pending =
    (variables.on_challenge_enter_artifacts as Array<{ name: string; summary?: string }> | undefined) ??
    [];
  const characters =
    (variables.characters_preview as Array<{ name: string; identity: string }> | undefined) ?? [];
  const prevTitle = (variables.previous_challenge_title as string) ?? "";
  const arcStage =
    (variables.current_arc_stage as {
      name?: string;
      signature_question?: string;
      narrator_voice_hint?: string;
    } | null) ?? null;

  // 5-part structure sentences. Mock produces one sentence per element so
  // the output deterministically contains each anchor.
  const roleAnchor = normalizeMockRole(role);
  const stageAnchor = arcStage
    ? arcStage.name === "觉察"
      ? "空气里有一种还没动的静。"
      : arcStage.name === "启程"
      ? "决定的那一刻到了。"
      : arcStage.name === "试炼"
      ? "时间不等人，这一幕紧在眼前。"
      : arcStage.name === "低谷"
      ? "你之前的那套，第一次不管用了。"
      : arcStage.name === "蜕变"
      ? "所有线索此刻要合到一起。"
      : arcStage.name === "归来"
      ? "你已经站在能回馈别人的位置。"
      : "一幕新场景在你面前展开。"
    : "一幕新场景在你面前展开。";

  const timePlace = variant === "cross_challenge" && prevTitle
    ? `你把《${prevTitle}》的结论合上，转向下一场。`
    : "下午两点十分，会议室的灯亮着。";
  const stakes = journeyGoal
    ? `这一段要练到的是：${journeyGoal.slice(0, 42)}。`
    : "再拖，这一段今天就过不去。";

  const personIntro = characters[0]
    ? `${characters[0].name}（${characters[0].identity}）已经在座，你走进去。`
    : "";
  // Derive a clean setup sentence (drop repeated title prefix if present)
  const cleanSetup = setup
    .replace(new RegExp(`^${escapeReg(challengeTitle)}[。．\\.\\s]*`), "")
    .replace(/^场景[:：]?\s*/, "")
    .trim();
  const situation =
    (cleanSetup ? `${cleanSetup.slice(0, 100)}${cleanSetup.length > 100 ? "..." : ""}。` : "") +
    (personIntro ? `${personIntro}` : "") +
    (pending[0]
      ? `桌上放着《${pending[0].name}》${pending[0].summary ? `，里面写着「${pending[0].summary.slice(0, 24)}」` : ""}。`
      : "");

  const closingQuestion = arcStage?.signature_question
    ? arcStage.signature_question
    : "此刻你第一件要观察的是什么？";

  let text = `${roleAnchor}${stageAnchor}${timePlace}${stakes}${situation}${closingQuestion}`;
  // Guard: strip any stray 【...】 or 👉 residue.
  text = text.replace(/【[^】]*】/g, "").replace(/👉/g, "").replace(/\s+/g, " ").trim();
  return { output: { text }, text, promptTokens: 700, outputTokens: 140, cacheRead: 560 };
}

function normalizeMockRole(role: string): string {
  const clean = role.trim().replace(/[。.!！\s]+$/, "");
  if (!clean) return "你现在是这段任务的实践者。";
  if (/^你(现在)?是/.test(clean)) return `${clean}。`;
  return `你现在是${clean}。`;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -------- Companion（按 companion_id 动态） --------
function mockCompanion(caller: string, variables: Record<string, unknown>): MockResult {
  const companionId = caller.replace("companion:", "");
  const directive = (variables.directive as string) ?? "";
  const persona = (variables.persona ?? {}) as {
    display_name?: string;
    companion_type?: string;
    output_format?: string;
  };
  const displayName = persona.display_name ?? companionId;
  const companionType = persona.companion_type ?? "npc_guide";
  const outputFormat = persona.output_format ?? "dialog_text";
  const recent = (variables.my_recent_lines as string[] | undefined) ?? [];
  const level = Number(variables.current_level ?? 1);
  const scaffoldStrategy = (variables.scaffold_strategy as string) ?? "";

  // Mock "silent right": if the strategy is self_explanation or recent speeches
  // already show 3 near-identical openings, return empty (the runtime drops it).
  if (scaffoldStrategy === "self_explanation") {
    return { output: { text: "" }, text: "", promptTokens: 200, outputTokens: 0, cacheRead: 180 };
  }
  if (recent.length >= 3 && recent.every((l) => l.slice(0, 8) === recent[0].slice(0, 8))) {
    return { output: { text: "" }, text: "", promptTokens: 200, outputTokens: 0, cacheRead: 180 };
  }

  // Type-aware pools of varied openers — cycle through to avoid repetition.
  const pools: Record<string, string[]> = {
    npc_guide: [
      `说白了——${directive || "就从学员刚建立的那条线索往下按一寸"}。`,
      `你试试看：把他今天做的那件事，按时间顺序拆三步。`,
      `稳住第一步。把最有把握的那一档先钉下来。`,
    ],
    npc_traveler: [
      `我当时卡在这步——不是没看见，是没分开看。`,
      `嗯……我想起自己第一次做这个也犯同样的错。`,
      `你这一步不孤单。先别急着答，呼吸一下。`,
    ],
    case_pack: [
      `另一组案例：一位汽车 4S 店主管面对类似场景，先做了 30 秒观察再开口。`,
      `参考：制造业车间的老班长遇到新流程时，选择先示范一次再要求。`,
      `另一版本：销售团队老将在新 CRM 前，先跟主管约了半小时一起过字段。`,
    ],
    case_pack_default: [
      `📘 参考：另一个行业的同类情境值得一看。`,
    ],
    replay_lens: [
      `你过去在这条线索上，good 出现过 2 次——都发生在你先落档、再验证之后。`,
      `对照一下上一挑战的高光：你那次是从一个具体动作反推的判断。`,
    ],
    npc_competitor: [
      `你真觉得这一刀切得对？我会问一句：如果他明天换个任务，这个档还成立吗？`,
    ],
    npc_adversary: [
      `就这样交过去我会直接打回来——理由不够硬。`,
    ],
  };

  let pool = pools[companionType] ?? pools.npc_guide;
  // Recent lines are stored with a `【<name>】` / `📘【<name>】` / `📊【<name>】` prefix in
  // conversation_log. Strip it before comparing openings against our pool.
  const stripPrefix = (s: string) => s.replace(/^(?:📘|📊)?【[^】]*】\s*/, "");
  const banned = new Set(recent.map((l) => stripPrefix(l).slice(0, 10)));
  let pick = pool.find((line) => !banned.has(line.slice(0, 10)));
  if (!pick) pick = pool[level % pool.length] ?? pool[0];

  if (outputFormat === "reading_artifact") {
    const text = `📘【${displayName}】${pick}`;
    return { output: { text }, text, promptTokens: 400, outputTokens: 60, cacheRead: 320 };
  }
  if (outputFormat === "visualization") {
    const text = `📊【${displayName}】${pick}`;
    return { output: { text }, text, promptTokens: 300, outputTokens: 40, cacheRead: 220 };
  }
  // dialog_text default
  const text = `【${displayName}】${pick}`;
  return { output: { text }, text, promptTokens: 500, outputTokens: 55, cacheRead: 400 };
}

function mockSummary(_variables: Record<string, unknown>): MockResult {
  const text = "过去 10 轮：学员在 a1 上信息采集稳定中等，判断准确性提升明显，推理路径仍待加强。";
  return { output: { text }, text, promptTokens: 600, outputTokens: 30, cacheRead: 500 };
}

function mockRecap(_variables: Record<string, unknown>): MockResult {
  const text = "上次你在新官上任章节的第 2 个挑战停下，已解锁向导 Elena。欢迎回来，她也在等你。";
  return { output: { text }, text, promptTokens: 420, outputTokens: 45, cacheRead: 380 };
}
