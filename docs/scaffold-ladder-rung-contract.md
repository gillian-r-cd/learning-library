# 学员体验三个症状的根因与解决方案

## 0. 一句话目标

每个学员动作（每一档 rung）必须由"narrator 问题 + 输入控件 + 前置知识"三者构成一个明确的**契约**；当前实现里这三者是独立生成的，导致问题对不上控件、控件字段冗余、问题里出现学员从未学过的术语。

---

## 1. 你在 u_b5a41e39 的对话里观察到的三条直观感受

1. **填的东西没有意义**：第二轮的"任务（具体到这一项）"字段——本挑战里只有一个任务（《H 客户支持方案》的起草），却让学员自己填，造成第一次填错（"风险点评估"）。
2. **该铺垫的概念没铺垫**：第三轮 narrator 直接抛"在 R1 到 R4 的分级里对应哪一档？"，但整个旅程到此为止没有任何地方介绍过 R1 到 R4 是什么。
3. **问题与输入控件不匹配**：narrator 抛出的"对照上面四种组合，这份方案的起草工作应当归到哪一档？"是一个 4 选 1 的题，但学员看到的输入区还是同一张「任务 + 能力 + 意愿 + 证据」表单（或 free_text），都不是单选。

---

## 2. 现场还原（基于 u_b5a41e39 的对话流）

| 轮次 | 学员动作 | 实际发生 | 问题 |
|---|---|---|---|
| 0（开场） | — | narrator 介绍场景 + 道具掉落（方案节选） | OK |
| 1（narrative_choice） | 点 "先了解她的背景再下判断" | runtime 走 narrative_advance；narrator 写了一段 NARRATIVE_BEAT；ladder 0→1 | OK |
| 2（form 第一次） | 填表：task=**风险点评估**，能力=低，意愿=高，证据="不确定并等着确定" | Judge 打 medium；narrator 纠正"任务不是'风险点评估'，是这份《H 客户支持方案》的起草本身"；+2 分 | **症状①**：task 字段诱导学员去文档里找一个"任务名"，而本挑战只有一个任务。学员把方案的子段落"风险点"误当成了任务。 |
| 3（form 第二次） | 重填：task=《H 客户支持方案》起草工作，能力=低，意愿=高，证据=具体细节 | Judge 打 good；获得招式；+4 分；narrator 抛 "**在 R1 到 R4 的分级里对应哪一档？**"；ladder 1→2（system 气泡"这一步交给你独立完成"） | **症状②**：narrator 第一次提到 R1-R4，learner 此前从未见过这套术语。 |
| 4（free_text） | "我不知道 R1-R4 的分级是什么玩意" | Judge 走 scaffold（concept_scaffold）；narrator 在"提示卡"里事后补了 R1-R4 的解释，并继续问 "对照上面四种组合，这份方案的起草工作应当归到哪一档？"；+1 分 | **症状③**：narrator 抛的是 4 选 1 的问题，但底下的输入区是 free_text（或被 Judge 临时切回 form），而不是一个 4 个按钮的单选。 |

ladder_progress 显示当前 position=2（free_text 已经是终档），mastery 显示 good=1 / medium=2 / poor=0。也就是说：**学员在表面上完成了 ladder，但实际并没有真正完成"判断分类"这一步——他在 form 阶段填了能力/意愿，但从未明确地把"能力低意愿高"映射到一个准备度档位**。这是典型的"动作做完了但概念没建立"。

---

## 3. 三个症状背后的同一个根因

这三件事不是三个独立的 bug。它们是**同一个结构性问题**在三个层面上的显形：

> **脚本生成阶段（Skill 3 Fill）把"narrator 问题"、"学员输入控件"、"前置概念"三件事独立生成了，没有任何契约要求它们对齐。**

具体到三件事：

### 3.1 控件层：表单模板没有按挑战上下文裁剪

`rf_c1ch1_form` 是一张通用诊断表，包含 4 个字段：task / ability / willingness / evidence。

- 在 c2 里需要让学员区分"陈岚的两件不同任务"，task 字段是必要的。
- 在 c1_ch1 里只有一个任务，task 字段就成了**伪填空**：学员被迫从场景里"选"一个任务名，而场景里能被命名的"任务名"包括"H 客户支持方案"、"风险点评估"、"需求拆解"等好几个候选——其中只有一个是对的。

Skill 3 Fill 的当前规则（第 4.5 节）规定每个动作首次出现的 challenge 必须出 form rung，但**没有规定 form 的字段必须按当前挑战的可命名对象数量裁剪**。模板被原样复用到了不需要它的地方。

### 3.2 知识层：脚本不约束"使用前必须先介绍"

R1-R4 是情境领导力的准备度分级。它出现在：

- Skill 1 的 quality_matrix.rubrics（如"good: 给出明确档位（倾向 R3）..."）——Judge 内部读，OK。
- Skill 3 Fill 的 expected_signals（同上）——Judge 内部读，OK。
- **narrator_directive 和 narrator 输出**——这里就是问题。

Judge 在写 directive 时引用了"R3""R4"之类的代码，narrator 即使按照"框架代码不外显"规则尽量改写，也只能改写**当前问题里的代码**，没有办法**回过头去补讲清楚**这套分级是什么。

更深的问题：**整个 blueprint 没有一个地方明确声明"这一章学员需要先知道哪些概念"**。Skill 3 Skeleton 在生成章节时，没有"introduces_concepts"字段；Skill 3 Fill 在生成挑战时，没有义务为本挑战要用的每一个概念安排"先介绍后使用"的顺序。结果就是：

- 第一个挑战里 narrator 想问"这是哪一档"，但学员从未见过"档"这个词。
- 学员被迫求助，Judge 走 concept_scaffold 临时补讲，体验上是"被动学概念"而不是"被铺垫好"。

### 3.3 匹配层：ladder 过于固定，question 与 frame 解耦

当前 scaffold ladder 是 3 档固定模板：

```
narrative_choice → form → free_text
```

每档的 frame 是 Skill 3 Fill 在设计阶段生成的固定结构。**narrator 在运行时抛什么问题完全自由**——它读 directive，自由组合学员可见的话术。

问题：narrator 抛出的问题**类型**与当前 frame 的**形态**没有契约。

具体到这次：
- form 阶段，学员填完 ability=低 / willingness=高。
- narrator 自然延伸到"这种组合对应 R1 到 R4 的哪一档？"——这是一个 4 选 1 题。
- 此时 ladder 已经升档到 free_text，但学员看到的输入是文本框（或者 Judge 因为 self_help 又切回了 form）——总之**没有 4 个按钮**让学员选档。

学员被迫用文本写"R3，因为...或者 R2，因为..."，但他根本不知道 R1-R4 是什么。三个症状叠加在一起，挫败感显著。

**根因可以总结成一句话**：rung 这个抽象只规定了"用什么 frame"，没有规定"在这个 frame 下 narrator 应当问什么 / 学员应当能学到什么"。frame 是一个空壳，往里塞什么 question / 期待什么 input 由 narrator 临场决定。这种解耦在小场景下能跑，复杂一点就崩。

---

## 4. 解决方案：把 rung 从"frame 容器"升级为"问答契约"

### 4.1 数据模型：rung 上加 question + 前置知识

当前的 `ScaffoldLadderRung`：

```ts
interface ScaffoldLadderRung {
  position: number;
  kind: "narrative_choice" | "form" | "free_text";
  frame_id: string;
  narrative_purpose: string;
  gate_to_next: ScaffoldLadderGate;
}
```

升级版（不破坏现有字段，只加新字段）：

```ts
interface ScaffoldLadderRung {
  position: number;
  kind: "narrative_choice" | "form" | "free_text" | "single_choice" | "multi_choice";
  frame_id: string;
  narrative_purpose: string;
  gate_to_next: ScaffoldLadderGate;

  // —— 新增 ——
  /** narrator 在该 rung 激活时必须问的具体问题。设计期写死。 */
  rung_question: string;
  /** 该 rung 学员需要能够展示的认知动作（用学员可读的语言写）。 */
  rung_expected_output: string;
  /** 该 rung 在被激活前必须保证已经被介绍过的前置概念 id 列表。 */
  required_concepts?: string[];
}
```

新增字段的含义：

- `rung_question`：narrator 输出的最后一句必须是这个问题（或它的语义变体）。Judge 不允许覆盖。
- `rung_expected_output`：跟"这一档结束时学员需要能做到什么"对齐，与 rubric 解耦。
- `required_concepts`：被引用的所有 concept id；在该 rung 被激活前 runtime 必须确认这些都在该学员的 `learned_concepts` 集合里。

### 4.2 Skill 1（Gamecore）：声明 framework_concepts

每个 `core_action` 增加一段：

```ts
framework_concepts: [
  {
    concept_id: "readiness_levels",
    name: "准备度分级",
    plain_description: "把能力和意愿合在一起，对一个具体任务上的下属分成四种状态：能力意愿都低、能力低意愿高、能力高意愿不稳、能力高意愿都高。每种状态对应不同的领导方式。",
    introduction_artifact_template: { ... }   // 可选：默认的概念卡片模板
  },
  ...
]
```

Skill 1 的 prompt 加硬约束：**core_action 的 rubric 或 signature_moves 中只要引用了某个分级、阶梯或编码体系，就必须在 framework_concepts 里登记一份**。

### 4.3 Skill 3 Skeleton：introduces_concepts 与"先介绍后使用"校验

每章新增字段：

```ts
chapter: {
  ...
  introduces_concepts: ["readiness_levels"],
}
```

Skill 3 Skeleton 的 prompt 增加规则：

- 一个 concept 只能在它**第一次被任何 challenge 用到的章节**或**之前的章节**里被介绍。
- 介绍方式有三种：(a) `concept_card` artifact（推荐）；(b) 一段 narrator 显式 setup beat；(c) 单独的"概念引入挑战"。

校验在 normalizer 里执行：扫描每个 challenge 的 expected_signals / rubric_column / scaffold_ladder.required_concepts，找出引用的 concept_id；如果该 concept_id 在当前章节及之前章节的 introduces_concepts 里都没出现，**直接拒绝该 chapter**，让 LLM 重生成。

### 4.4 Skill 3 Fill：rung 级问答契约 + 表单按上下文裁剪 + concept artifact

#### 4.4.1 表单字段裁剪

Skill 3 Fill 生成 form rung 时，prompt 增加规则：

- 如果本挑战只有一个明确的"被评估对象"（一个任务 / 一个人 / 一份产出），form **不允许包含**让学员"指定对象"的字段。该对象通过 frame.helper_text 或 frame.title 直接交代清楚（例："正在评估：林小雨独立起草《H 客户支持方案》这一项工作"）。
- 如果本挑战有 2 个或以上的被评估对象，form **必须**用 single_choice / radio 的方式列出这些对象（而不是让学员自由填写文本），避免歧义。

ResponseFrameRenderer 也要做配套改动：在 frame.helper_text 里支持"展示但不可编辑"的上下文锚点。

#### 4.4.2 rung 级问答契约

Skill 3 Fill 在生成 ladder 时，每个 rung 必须配套写出 `rung_question` + `rung_expected_output`。同一个挑战的不同 rung，问题应当**层层递进**：

- 第 0 档（narrative_choice）：问"你的初步印象是什么？"——直观判断。
- 第 1 档（form）：问"用具体证据填写能力侧、意愿侧的判断。"——结构化拆分。
- 第 2 档（**新增** single_choice）：问"用前面的拆分对照下面四种领导态度组合，这次你会从哪一种切入？"——概念分类。
- 第 3 档（free_text）：问"把上面三步整合成一段你真要对她说的话。"——综合产出。

也就是说，**c1_ch1 的 ladder 应当是 4 档而不是 3 档**。其中第 2 档是这次缺失的"概念分类"档。

新增的 single_choice 档的 frame 长这样：

```json
{
  "frame_id": "rf_c1ch1_archetype",
  "kind": "single_choice",
  "title": "对应到哪一种领导态度",
  "prompt": "结合你刚才填的能力低意愿高，下面这四种组合最贴你的判断的是哪一种？",
  "fields": [
    {
      "field_id": "archetype",
      "type": "radio",
      "label": "领导态度组合",
      "required": true,
      "options": [
        { "value": "ll", "label": "能力低、意愿低（适合明确指令、贴身指导）" },
        { "value": "lh", "label": "能力低、意愿高（适合给具体步骤、同时保护积极性）" },
        { "value": "hu", "label": "能力高、意愿不稳（适合给方向、回应顾虑、把决定权交给对方）" },
        { "value": "hh", "label": "能力高、意愿高（适合直接放手）" }
      ]
    }
  ]
}
```

注意：选项的 label 是**自然语言描述**，不是 R1-R4 代码。这样即使学员从未见过 R1-R4，也能通过这一档把自己已经填好的能力/意愿对照到一种领导态度。**这个档同时完成了"概念引入"（通过选项把分级铺出来）和"概念应用"（让学员选一个）两件事**。

#### 4.4.3 concept artifact（可选但推荐）

对每个章节首次使用的 framework concept，Skill 3 Fill 在该章首个挑战的 `artifacts` 里插入一份 `concept_card` 类型的 artifact：

```json
{
  "artifact_id": "art_concept_readiness",
  "type": "concept_card",
  "name": "下属准备度的四种组合",
  "content": {
    "title": "下属准备度 · 四种组合",
    "description": "判断一个下属在一项具体任务上是不是能交付，看两件事：能力到位没有，意愿到位没有。两件事各自高/低，组合出四种状态——",
    "items": [
      { "label": "能力低、意愿低", "guidance": "明确指令、贴身指导，先让动作做出来" },
      { "label": "能力低、意愿高", "guidance": "给具体步骤、同时保护积极性" },
      { "label": "能力高、意愿不稳", "guidance": "给方向、回应顾虑、把决定权交给对方" },
      { "label": "能力高、意愿高", "guidance": "直接放手" }
    ]
  },
  "trigger": "on_challenge_enter"
}
```

数据模型上 `ArtifactType` 需要增加 `"concept_card"`，对应一个新的 ContentRenderer。

学员开场就看到这张牌摆在桌上。narrator 可以在 narrative_choice 之前一句话引到它（"桌上还有一份你前几天在公司内训里拿到的下属准备度参考卡，先翻一翻再判断"）。这样 R1-R4 这种代码就不需要出现，自然语言的"四种组合"已经在学员心里建立。

### 4.5 runtime / narrator：narrator 必须问该 rung 的 question

新增 narrator 输入变量：

```
当前 rung 的指定问题 (rung_question): ...
当前 rung 的期望产出 (rung_expected_output): ...
```

narrator 的硬约束新增一条：

> 当 `rung_question` 非空时，narrator 输出的末句**必须**是 rung_question 的语义变体——可以微调措辞以衔接前文（例如"基于你刚才的判断"作为开头），但**不得改变它的认知任务类型**（不得把 4 选 1 改成开放问句，反之亦然）。

这把 issue ③（问答与控件不匹配）从根源上消灭：narrator 的问题被 rung 锁死，rung 又被 frame 锁定，三者绑在一起。

### 4.6 Judge：尊重 rung 的契约

Judge 的 prompt 增加：

- 当 rung_question 非空时，**不要在 narrator_directive 里建议 narrator 改问别的题**。Judge 只能在两个动作里选：(a) 让学员留在当前 rung 重答（retry）；(b) 让学员升档到下一 rung（escalate_frame）。具体的问题措辞 narrator 自己处理。
- Judge 可以引用 R1-R4 等代码（这是 Judge 内部语言），但 directive 里不允许用代码——这条已有。

---

## 5. 优先级与分阶段

按可立即落地的程度排序：

### 阶段 A：表单字段裁剪（解决症状①）— 最小代价

只改 Skill 3 Fill 的 prompt + ResponseFrameRenderer 的 helper_text 渲染：

- prompt 加规则："单对象挑战的 form 不允许包含'指定对象'字段"。
- ResponseFrameRenderer 把 frame.helper_text 显示为顶部的 context strip。
- 重跑 Skill 3 Fill 一次。

约 0.5 天，验证立即可见。

### 阶段 B：rung 级 question + 4 档 ladder（解决症状③）— 中代价

- 数据模型：`ScaffoldLadderRung` 加 `rung_question` + `rung_expected_output` 字段（向后兼容）。
- Skill 3 Fill prompt：要求每个 rung 配套写 question；要求"分类型挑战"（如 a1）的 ladder 至少 4 档（narrative_choice → form → single_choice → free_text）。
- runtime：把 rung_question 透传到 narrator 变量。
- narrator prompt：硬约束"末句必须是 rung_question 的语义变体"。
- 重跑 Skill 3 Fill。

约 1-2 天。

### 阶段 C：concept_prerequisites + introduces_concepts（解决症状②）— 大代价

- 数据模型：`framework_concepts` 在 Skill 1，`introduces_concepts` 在每章；`concept_card` 作为新 artifact 类型。
- Skill 1 prompt：要求声明 framework_concepts。
- Skill 3 Skeleton + Fill prompt：要求 introduces_concepts 字段；引入 concept_card artifact。
- normalizer 校验：使用前必须先介绍。
- ResponseFrameRenderer / ArtifactRenderer：渲染 concept_card。
- 全部 blueprint 重生成（旧 blueprint 如果不重生成会缺 concept artifact）。

约 2-3 天。如果阶段 B 已经把 single_choice 档的选项写成自然语言（隐式介绍），阶段 C 可以延后。

### 阶段 D：narrator / Judge 尊重 rung 契约（巩固）

最小：narrator prompt 加一条硬约束，runtime 把 rung_question 喂进去。约 0.5 天。

---

## 6. 取舍与已知风险

### 6.1 ladder 档数膨胀

把 c1_ch1 从 3 档变成 4 档之后，整个挑战的轮数变多。学员需要点更多次才能到达 free_text 自由表达的开放阶段。如果每一档都有真实价值（narrative_choice 锁直觉、form 拆能力意愿、single_choice 完成分类、free_text 综合表达），那 4 档是值得的。如果学员觉得拖沓，可以为高熟练度的学员（已经在前置章节用过 a1）跳过 single_choice 档（`default_ladder_position` 调到 2）。

### 6.2 设计师工作量

每个 rung 写 rung_question + rung_expected_output 是新的设计要求。Skill 3 Fill 的 prompt 复杂度和 token 用量会上升。但 prompt 已经在用 Opus + 32K tokens，余量足够。

### 6.3 旧 blueprint 兼容

新字段都是 optional，旧 blueprint 没有 rung_question 时 narrator 退回到现有自由提问行为。`required_concepts` 缺失时跳过校验。这些都是软兼容；重新跑一次 Skill 3 Fill 就能升级。

### 6.4 concept_card 是新 artifact 类型

引入新的 `concept_card` 类型涉及类型定义、normalizer、renderer 三处改动。可以分阶段：先把 concept 用普通 `list` 类型 artifact 表达，后续再迁到 dedicated 类型。

### 6.5 Judge 可能仍想跳出 rung_question

Judge 在 scaffold 路径下有自由度去选择八种 strategy 之一。如果 Judge 决定 worked_example，narrator 就要给一段范例话术，这段是否还要保留 rung_question？建议是：scaffold 路径下 narrator 优先满足 strategy 要求，可以**省略**当前 rung_question；学员重答时再问回 rung_question。这条要写进 narrator 的 SCAFFOLD 模式规则里。

---

## 7. 不在本次范围

- 跨章节 concept 复用（A 课程的 readiness_levels 能不能在 B 课程直接被认为已学过）：不在本次。
- 学员主动召回 concept_card（"再给我看一下那张准备度卡"）：可作为道具系统的现有行为，无需新增机制。
- 多语言：concept 描述假设中文输出。

---

## 8. 决策点

要请你拍板的几件事：

1. **阶段 A 单独先做**还是**A + B + D 一起做**？阶段 A 是最小代价但只解决一个症状（表单字段冗余）。三个一起做是完整修复，但要 2-3 天。
2. **新增 single_choice 档是否要把它做成所有"分类型核心动作"的标配**？还是按 core_action 的 framework_concepts 字段 case-by-case？我倾向后者：只对带分级框架的动作（如情境领导力的 R1-R4）增加单选档；对不需要分类的动作（如"识别对立面"）保持 3 档。
3. **concept_card 是用新的 artifact 类型还是复用 list/fields**？前者更干净，后者代价更小。我倾向先用 fields 类型快速实现，后面有时间再独立成 concept_card。
4. **rung_question 在 narrator 输出里是必须保留措辞还是只保留语义**？严格保留措辞会让对话显得像表单，纯保留语义又可能让 narrator 改写成不匹配 frame 的形态。我倾向"保留**问题类型**和**问题指代的对象**，措辞可以微调以衔接前文"。

确认后再进实现。
