 # UMU Learning Library — 产品需求文档（PRD v0.1）

> **文档性质**：基于 `Plan.md` 的完整产品设计。Plan.md 负责"为什么"和"想到哪里了"，本 PRD 负责"做什么、做到什么粒度、以什么顺序做"。所有 Plan.md 中标注 🔲 的待定问题，本 PRD 都给出一版明确的设计决策或验证计划。
>
> **适用阶段**：MVP（Minimum Validated Product）设计期。所有决策均以"能否跑通一个主题的完整闭环"为锚。

---

## 目录

1. [产品概述](#1-产品概述)
2. [核心概念与术语](#2-核心概念与术语)
3. [设计原则](#3-设计原则)
4. [系统架构总览](#4-系统架构总览)
5. [设计阶段 PRD](#5-设计阶段-prd)
6. [学习阶段 PRD](#6-学习阶段-prd)
7. [横切关注点](#7-横切关注点)
8. [运维后台（Admin Console）](#8-运维后台admin-console)
9. [非功能需求](#9-非功能需求)
10. [MVP 范围与分阶段交付](#10-mvp-范围与分阶段交付)
11. [待验证假设与实验计划](#11-待验证假设与实验计划)

---

## 1. 产品概述

### 1.1 愿景

UMU Learning Library 是一个**以基模世界知识为底、以游戏化学习旅程为壳**的内容平台。它不展示书，而是把一本书/方法论/技能领域，转换成学习者可以**亲自走一遍**的旅程——在旅程中反复执行指向能力迁移的"核心动作"，在逐渐升高的情境复杂度中获得正反馈。

### 1.2 目标用户

| 角色 | 身份 | 关键需求 | 使用频率 |
| --- | --- | --- | --- |
| **课程设计师**（Designer） | UMU 内部 LXD / 外部合作方 | 把一个主题快速产出为一份可运行的旅程蓝图，无需自己写 prompt、写代码 | 每个主题一次（设计期集中使用） |
| **学习者**（Learner） | C 端用户 / 企业客户员工 | 在碎片时间获得"有爽感、能留下东西"的学习体验，感受到自己在变强 | 持续、反复访问（北极星：回访率） |

### 1.3 核心价值主张

* 对**设计师**：把"理解书 + 翻译为游戏化学习"这个原本高门槛的创作过程，降为 5 步对话式共创。
* 对**学习者**：每次访问都有**可执行、有反馈、有积累**的短循环；长期访问有**成长可视化**和**伴学关系**的情感纽带。
* 对 **UMU 业务**：规避版权风险（不引原文）；可规模化（一套方法论套多个主题）；可沉淀资产（通用积分框架、伴学库、体验形式库跨主题复用）。

### 1.4 产品范围（MVP）

**In Scope**
* 单机单人旅程（无社交、无多人合作）
* 设计阶段 5 个环节全部跑通 + 可追溯的 Blueprint
* 学习阶段四角色（State Manager / Judge / Narrator / Companion）+ 至少 3 种伴学类型
* 通用积分框架 + 衰减恢复模型的一版可工作实现
* 旅程完成态（证书 + 回顾）

**Out of Scope（后续版本）**
* 多人合作/匹配
* 毕业后的持续复习调度（只保留数据结构，调度逻辑延后）
* 设计师工具的多人协作/版本管理
* 课程商店、付费、企业管理后台

---

## 2. 核心概念与术语

| 术语 | 定义 | 所属 |
| --- | --- | --- |
| **主题**（Topic） | 一本书、一套方法论或一个技能领域。设计阶段的唯一输入。 | 业务 |
| **核心动作**（Core Action） | 学习者需反复执行、直接指向能力迁移的行为；每个主题 ≤5 个。 | 业务 |
| **质量矩阵**（Quality Matrix） | 每个核心动作的"评价维度 × 应用复杂度"表，单元格是 mini-rubric。 | 业务 |
| **Gamecore** | 主题→核心动作→质量矩阵这组产出的总称，是整条链路的北极星。 | 业务 |
| **体验形式**（Experience Form） | 承载核心动作的游戏化壳（如 What-If 模拟器、教会 NPC 等）。 | 业务 |
| **旅程 / 章节 / 挑战 / 交互** | 四层嵌套反馈循环。见 §6.2。 | 业务 |
| **伴学**（Companion） | 可用积分解锁/升级的动态奖励，独立于路径，提升体验上限。 | 业务 |
| **Blueprint** | 设计阶段的结构化产出，是学习阶段运行的唯一源。 | 技术 |
| **Design Copilot** | 设计阶段贯穿全程的单 LLM Agent。 | 技术 |
| **Skill** | Copilot 在特定环节调用的 prompt 模板 + 输出约束 + 校验规则。 | 技术 |
| **State Manager / Judge / Narrator / Companion Agent** | 学习阶段的四类角色。见 §6.3。 | 技术 |
| **active_companions** | 当前学员已解锁且在当前场景中可能发言的伴学集合。 | 技术 |
| **script_branch** | 在一个挑战节点上预置的"有/无某伴学"分支标签。 | 技术 |

---

## 3. 设计原则

1. **学习者是主角**：任何功能都用"它让学员多主动了吗？多爽了吗？多想回来了吗？"三问检验。
2. **以终为始**：先穷尽学员可能做的所有事（行动空间表），再反推系统响应；不按顺序拍脑袋补。
3. **单机为底**：所有设计以"只有一个学员、没有老师、没有同伴"为默认假设；任何社交/多人元素都是可加可减的增强。
4. **规避原文**：严禁任何 Skill 的 prompt 或输出引用原作者的原文字句；一切从"世界知识+学员体验"出发。
5. **可追溯、可回退**：设计阶段每一步的产出都持久化、可回看、可回退；回退时下游自动标为"待刷新"且必须显式确认。
6. **奥卡姆剃刀**：Agent 能合则合。单个 Judge 能胜任就不拆；Skill 能共用就不复制。只在业务或性能确实迫使时才拆分。
7. **科学为骨、游戏为肤**：积分衰减对齐遗忘曲线研究（FSRS/SM-2）；爽感来自精心设计的反馈循环与解锁节奏，不是糖精。
8. **API 友好**：每个业务功能都通过结构化数据（JSON schema）和模块边界清晰交互，便于后续替换实现、接入不同模型、做自动化评测。

---

## 4. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         设计阶段（Designer UI）                      │
│  ┌──────────────────────────┐       ┌──────────────────────────┐    │
│  │     步骤面板 UI           │◀─────▶│     Design Copilot        │    │
│  │  (左:Blueprint  右:Chat) │       │   (+ 5 个 Skill)           │    │
│  └──────────┬───────────────┘       └──────────────┬────────────┘    │
│             │                                      │                 │
│             ▼                                      ▼                 │
│        ┌────────────────────────────────────────────┐                │
│        │             Blueprint (JSON)                │                │
│        │  环节1数据 | 环节2 | 环节3 | 环节4 | 环节5   │                │
│        └────────────────────┬───────────────────────┘                │
└─────────────────────────────┼──────────────────────────────────────── ┘
                              │ Blueprint Compiler
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          学习阶段（Learner UI）                      │
│                                                                     │
│    Learner Input                                                    │
│         │                                                           │
│         ▼                                                           │
│    ┌─────────────┐   1. snapshot + events                           │
│    │State Manager│────────────────────┐                             │
│    │  (code)     │                    ▼                             │
│    └─────┬───────┘            ┌───────────────┐                     │
│          │ 2. grade            │    Judge      │                     │
│          │   → points          │    (LLM #1)   │                     │
│          │   → state           └───┬───────┬───┘                     │
│          │                         │       │                         │
│          ▼ 3. dispatch             ▼       ▼                         │
│    ┌────────────┐ parallel ┌──────────┐ ┌─────────────────┐         │
│    │ Narrator   │◀────────▶│Companion │ │Companion        │         │
│    │ (LLM #2)   │          │ #1 (LLM) │ │ #N (LLM)        │         │
│    └─────┬──────┘          └────┬─────┘ └────────┬────────┘         │
│          │                      │                │                  │
│          └────────┬─────────────┴────────────────┘                  │
│                   ▼                                                 │
│             合并渲染 → Learner                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Blueprint Compiler**（一段代码模块）把设计阶段产出的 Blueprint 转成学习阶段各角色所需的运行时 bundle（§7.3）。

---

## 5. 设计阶段 PRD

### 5.1 整体模式：Design Copilot + Blueprint + Skills

* **一个 Design Copilot**贯穿全程：理解意图、调用对应 Skill、更新 Blueprint、回应追问。
* **Skills ≠ 独立 Agent**：Skill 是 Copilot 在特定环节切换到的"专业模式"（prompt 模板 + 输出格式 + 校验规则），共享同一个对话上下文和 Blueprint。
* **Blueprint** 是唯一真相源。UI 只是 Blueprint 的视图，对话只是操作 Blueprint 的手段。

**为什么这么设计**
* 上下文不切片，后环节能直接用前环节的语义。
* 每步都需设计师深度参与，不存在跨 Agent 异步协作的场景。
* 5 个 Skill + 1 个 Copilot 的复杂度远低于 5 个独立 Agent + 编排器 + 格式契约。

### 5.2 Blueprint Schema（顶层）

```jsonc
{
  "blueprint_id": "bp_xxx",
  "topic": "情境领导力",
  "version": 3,                // 每次确认产出后自增
  "status": "in_design" | "ready" | "archived",
  "created_at": "...", "updated_at": "...",
  "designer_id": "...",

  "step1_gamecore": { ... },    // §5.3.1
  "step2_experience": { ... },  // §5.3.2
  "step3_script": { ... },      // §5.3.3
  "step4_companions": { ... },  // §5.3.4
  "step5_points": { ... },      // §5.3.5

  "step_status": {
    "step1": "confirmed",       // draft | confirmed | stale
    "step2": "confirmed",
    "step3": "stale",           // 因上游回退被标为待刷新
    "step4": "draft",
    "step5": "draft"
  },

  "audit_log": [                // 每步的历次产出快照，可回看
    { "step": 1, "version": 1, "at": "...", "skill_output": {...} },
    ...
  ]
}
```

**不变量**
* `step_status` 控制流：任意步骤回到 `draft`/`stale`，则 UI 禁止使用下游数据进入学习阶段。
* `audit_log` 是只追加的历史；"回看"读这里，"当前视图"读 `stepN_xxx` 字段。

### 5.3 各环节详细规格

#### 5.3.1 环节 1：Gamecore 萃取

**输入** 主题名称 + 设计师可选的补充描述（受众、目标岗位等）。

**数据来源** 仅依赖模型的世界知识，不输入书籍文本。

**输出（step1_gamecore）**

```jsonc
{
  "core_actions": [
    {
      "action_id": "a1",
      "name": "读懂准备度",
      "description": "在与下属交谈的场景中识别其能力与意愿的当前水平",
      "knowledge_type": "procedural",  // factual | conceptual | procedural | metacognitive
      "relations": [ { "to": "a2", "type": "precedes" } ],
      "quality_matrix": {
        "dimensions": [
          { "dim_id": "d1", "name": "信息采集", "type": "process" },
          { "dim_id": "d2", "name": "判断准确性", "type": "outcome" },
          { "dim_id": "d3", "name": "推理路径", "type": "process" }
        ],
        "complexity_levels": ["low", "medium", "high"],
        "rubrics": {
          "d1": {
            "low":    { "good": "...", "medium": "...", "poor": "..." },
            "medium": { "good": "...", "medium": "...", "poor": "..." },
            "high":   { "good": "...", "medium": "...", "poor": "..." }
          },
          "d2": { ... }, "d3": { ... }
        }
      }
    }
    // ≤5 条
  ],
  "relation_graph": [ { "from": "a1", "to": "a2", "type": "precedes" } ]
}
```

**针对 Plan.md 的 Todo 处理**

* 🔲 **维度如何确定** → 设计一个"维度库"作为 Skill 的知识储备：按**过程信号**（推理路径 / 信息采集 / 思维结构 / 权衡过程）和**结果信号**（判断准确性 / 产出完整性 / 表达清晰度 / 方案可行性）两类提供候选。Skill 根据 `knowledge_type` + 动作描述选 2-3 个并说明为什么选。
* 🔲 **mini-rubric 粒度** → MVP 采用三级（好/中/差）且描述必须可观察、含"要触发此等级需出现什么具体行为"。Schema 支持 5 级扩展（通过 `levels` 字段声明），默认 3 级即可。三级边界在原型阶段（§11）做校准实验。

**UI 规范**（步骤面板左侧）
* 顶部：核心动作卡片（≤5 张），每张卡片可展开/折叠；卡片内嵌关系图（有向图，a→b 表示 precedes；可点击节点跳到对应卡片）。
* 每张卡片内部：质量矩阵以矩阵表格呈现，列=complexity，行=dimension，单元格=mini-rubric 折叠卡片（展开看好/中/差三档描述）。
* 顶部按钮：`[刷新 Gamecore]` `[⚠️ 确认本步]`。

**Skill: Gamecore 萃取**

* **System prompt 骨架**：
  * 角色：教学设计专家 + Zimmerman 学派游戏化设计师
  * 硬约束：≤5 条核心动作；必须指向能力迁移；不引用任何原文；每个动作 2-3 个维度；每个维度在三个复杂度下都有 mini-rubric
  * 维度库（上面列出）；知识类型分类（Anderson & Krathwohl）
  * 输出：严格 JSON，包含 `reasoning_notes`（给设计师看的"为什么这么选"）字段
* **校验规则**（代码侧）：JSON schema 校验 + 动作数 ≤5 + 每个 rubric 非空 + 维度 2-3 个 + 维度按过程/结果混合。

**依赖** 无，是链路起点。

**Human 确认**是。`step1` 状态变为 `confirmed`。

---

#### 5.3.2 环节 2：游戏体验选型

**输入** `step1_gamecore` 已确认 + 设计师可选的风格偏好（严肃 / 戏谑 / 职场 / 奇幻）。

**输出（step2_experience）**

```jsonc
{
  "mappings": [
    {
      "action_id": "a1",
      "form_id": "what_if_simulator",
      "form_name": "What-If 模拟器",
      "rationale": "读懂准备度需要快速判断+即时反馈，模拟器能批量生成情境并给出因果后果",
      "engagement_level": "constructive"  // ICAP: passive | active | constructive | interactive
    }
    // 每个 action 一条
  ],
  "form_library_version": "v1"
}
```

**体验形式库（MVP 版 v1）**

| form_id | 名称 | 适合的知识类型 | 认知参与层级 | 典型用法 |
| --- | --- | --- | --- | --- |
| `what_if_simulator` | What-If 模拟器 | procedural, conceptual | constructive | 给一个情境，让学员做决定后看后果演化 |
| `teach_npc` | 教会 NPC | conceptual, metacognitive | constructive | 让学员向一个"刚入门"的 NPC 讲清楚某个概念 |
| `mystery_investigation` | 悬疑调查 | procedural (diagnosis) | interactive | 给一组线索，学员通过追问/采样还原真相 |
| `concept_court` | 概念法庭 | conceptual | interactive | 两个立场的辩论，学员做"法官"审视论据 |
| `case_construction` | 案例构建 | procedural, metacognitive | constructive | 学员基于原则拼出一个符合条件的案例 |
| `dilemma_navigator` | 两难航行 | procedural, conceptual | constructive | 在资源有限的场景下做取舍并为后果承担 |
| `time_capsule` | 时间胶囊 | metacognitive | constructive | 从"未来"视角反思当下决定会导向什么 |
| `role_inversion` | 角色反转 | conceptual | interactive | 让学员站在下属/对手/客户视角重新看问题 |

**选型矩阵**（`knowledge_type` × `engagement_target` → 候选 forms）。Skill 不强制单选，可返回 top-3 + 推荐第一。

**针对 Plan.md 的 Todo**
* 🔲 **体验形式完整候选库** → 上表 8 种作为 v1，版本化管理；未来新增走 `form_library_version` 升级。
* 🔲 **选型规则可操作性** → 选型矩阵落到 Skill 的 system prompt 作为硬规则，Skill 输出必须给 `rationale` 引用该矩阵的哪一格。

**UI** 左侧表格：核心动作 → 推荐形式 + 理由；每行可点击看候选 top-3 + 设计师下拉切换。

**Skill: 体验选型** prompt 内置上表 + 选型矩阵 + ICAP 定义；输出必须给出所选 form 的理由与次优替代方案。

**Human 确认**是。

---

#### 5.3.3 环节 3：剧本与情节生成

**输入** `step1 + step2` 已确认。

**输出（step3_script）**

```jsonc
{
  "journey_meta": {
    "arc_type": "hero_journey",
    "tone": "cinematic_workplace",
    "estimated_duration_min": 180
  },
  "chapters": [
    {
      "chapter_id": "c1",
      "title": "新官上任",
      "narrative_premise": "...",
      "milestone": { "id": "m1", "summary": "首次对不同类型下属做出正确的领导选择" },
      "challenges": [
        {
          "challenge_id": "ch1",
          "title": "...",
          "binds_actions": ["a1"],
          "complexity": "low",
          "trunk": {
            "setup": "...",
            "action_prompts": ["..."],
            "expected_signals": ["..."]
          },
          "companion_hooks": [
            {
              "hook_id": "h1",
              "condition": { "companion_type": "guide_mentor", "min_level": 1 },
              "delta": {
                "pre_action_injection": "向导 Elena 插入一句……",
                "post_action_injection": "...",
                "scaffold_override": null
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**关键设计**

* **共享主干 + 差异 delta**：每个挑战写"无伴学"的主干一次，每个伴学钩子只写差异（注入点 + delta 文本），避免 O(n) 复制。
* **规模参数（MVP 默认）**：3-5 章 / 章；3-4 挑战 / 章；1-3 次执行-反馈 / 挑战；章内复杂度递增、章间复杂度跨级递增。
* **复杂度与 Step1 的质量矩阵列对齐**：挑战的 `complexity` 字段严格使用 `low/medium/high` 三挡，保证 Judge 能查对应 rubric 列。

**针对 Plan.md 的 Todo**
* 🔲 **伴学分支粒度** → 采用**主干 + delta** 策略；delta 只写注入点和差异文本，不写整条替代路径。
* 🔲 **组合爆炸** → 同一场景至多 2 个 companion 被主动唤起。多伴学同时在场时，Judge 按 `companion_priority`（伴学登记字段）选一个为主讲，其他为"点头嗯嗯"的被动在场；不为每个组合单独写分支。
* 🔲 **章节-挑战规模参数** → MVP 默认上面的 3-5 / 3-4 / 1-3；原型期（§11）用一个主题校准后锁定。

**UI** 左侧三级树形结构：章节 → 挑战 → 交互。每个节点展开看 `trunk` + `companion_hooks` 列表。顶部"Mermaid 风格"的路径缩略图作为导航。

**Skill: 剧本生成**
* **分步执行**（针对"最重 Skill"）：
  1. **骨架 pass**：生成章节 + 挑战序列 + 复杂度递增安排（输出：章节列表 + 挑战标题 + 每挑战的核心动作绑定 + 复杂度）；设计师先确认骨架。
  2. **填充 pass**（可多次）：按章节批量填充 `trunk` 和 `companion_hooks`；允许设计师针对某个章节单独重新生成。
* **自检**：填充后 Skill 自我校验"复杂度是否严格递增"、"每个核心动作是否至少绑定 3 次"、"伴学钩子条件是否引用了合法的 companion_type"。

**Human 确认**是（骨架确认一次 + 全文确认一次，两级 gate）。

---

#### 5.3.4 环节 4：高级伴学清单设计

**输入** `step1 + step3` 已确认（step2 间接可得）。

**输出（step4_companions）**

```jsonc
{
  "companions": [
    {
      "companion_id": "cp1",
      "companion_type": "npc_guide",   // 见下面伴学形式表
      "display_name": "Elena（资深 HRBP）",
      "unique_value_hypothesis": "她的金句化比喻能在高复杂度场景降低认知负荷",
      "effectiveness_mechanism": "把抽象原则接地到具体行为，提升迁移率",
      "persona": { ... },              // §7.2 的标准 persona 文档
      "unlock_rule": { "type": "points_threshold", "value": 120 },
      "upgrade_path": [
        { "level": 1, "delta": "仅提示" },
        { "level": 2, "delta": "增加情境比喻库" },
        { "level": 3, "delta": "解锁 Elena 的个人故事线（隐藏剧情）" }
      ],
      "companion_priority": 50,        // 多伴学同场时谁为主讲
      "output_format": "dialog_text",  // dialog_text | reading_artifact | plot_delta | param_override | visualization | scenario_override
      "io_spec": { ... }               // §7.2
    }
  ]
}
```

**伴学形式库（MVP 版 v1）**

| companion_type | 人格/非人格 | 输出形态 | 典型机制 |
| --- | --- | --- | --- |
| `npc_guide`（向导） | 人格 | dialog_text | 在卡住时给提问式引导；不给答案 |
| `npc_traveler`（旅伴） | 人格 | dialog_text | 陪伴感；记得你的往事；情感投入的锚点 |
| `npc_competitor`（竞争者） | 人格 | dialog_text | 你的成绩被他追平/反超时他开口；刺激意愿 |
| `npc_adversary`（敌人） | 人格 | dialog_text | 高级挑战中的反方立场，提供压力测试 |
| `case_pack`（实战案例包） | 非人格 | reading_artifact | 一段额外情境 + 反思问题；不引用原作者 |
| `hidden_plotline`（隐藏剧情线） | 非人格（嵌入 Narrator） | plot_delta | 一段支线叙事的注入，激活后在后续章节汇合 |
| `difficulty_dial`（难度调节器） | 非人格 | param_override | 主动调高 `complexity` 挡位，换更高倍率 |
| `replay_lens`（复盘视角） | 非人格 | visualization | 调用 State Manager 质性层，渲染决策轨迹+标注 |
| `context_variant`（情境变体包） | 非人格 | scenario_override | 同一核心动作换行业/文化/角色重玩一遍 |

**针对 Plan.md 的 Todo（全部兜住）**
* 🔲 **Companion 形式设计（阻塞性）** → 上表 9 种作为 v1；MVP 至少落地 3 种：`npc_guide` + `case_pack` + `replay_lens`（覆盖人格类、文本类、可视化类三种形态）。
* 🔲 **必要性与有效性论证** → 每个 companion 条目必须填写 `unique_value_hypothesis` + `effectiveness_mechanism`；原型期做简化版 A/B（有/无该伴学的学员满意度与回访差）作为验证依据。
* 🔲 **升级路径** → 三级默认（§7.2.3）：Lv.1 基础表达；Lv.2 记忆增强+语气锋利化；Lv.3 新增独家机制（如 Elena 的隐藏故事线）。每个伴学条目显式填 `upgrade_path[3]`。

**UI** 左侧伴学卡片网格；每张卡片顶部显示 persona 摘要、中部显示 unlock/upgrade 时间轴、底部显示 `io_spec` 结构化视图。

**Skill: 伴学设计** prompt 内置上表 + persona 模板 + "每个伴学必须回答三问（不可替代性、有效性假设、验证指标）"。

**Human 确认**是。

---

#### 5.3.5 环节 5：积分系统配置

**输入** **通用积分框架**（§7.1）+ `step1.quality_matrix` + `step3.chapters` + `step4.companions`。

**输出（step5_points）**

```jsonc
{
  "framework_version": "v1",
  "instance_params": {
    "base_points": { "good": 3, "medium": 1, "poor": 0 },
    "complexity_multiplier": { "low": 1.0, "medium": 1.5, "high": 2.5 },
    "interaction_participation_bonus": 0.2,
    "replay_bonus_ratio": 0.3,
    "decay": {
      "model": "fsrs_inspired",
      "params_by_knowledge_type": {
        "factual":     { "initial_stability": 3,  "stability_growth": 1.2 },
        "conceptual":  { "initial_stability": 7,  "stability_growth": 1.3 },
        "procedural":  { "initial_stability": 14, "stability_growth": 1.5 },
        "metacognitive": { "initial_stability": 10, "stability_growth": 1.4 }
      },
      "floor_ratio": 0.2
    },
    "unlock_thresholds": [
      { "companion_id": "cp1", "threshold": 120 },
      ...
    ],
    "target_progress_curve": {
      "first_companion_at_challenge": 3,
      "first_milestone_at_challenge": 5,
      "full_companion_set_at_challenge": 12
    }
  },
  "total_capacity": 840,        // 由 compiler 估算
  "fit_diagnostics": {
    "fast_learner_unlock_first_at": 2,
    "median_learner_unlock_first_at": 3,
    "slow_learner_unlock_first_at": 4
  }
}
```

**Skill: 积分配置（非 LLM 为主，LLM 可选兜底）**

算法流程（纯代码）：
1. 读取 `total_capacity` = Σ(每个挑战最高得分 × 复杂度倍率)
2. 用三类学员画像（fast/median/slow）做蒙特卡洛模拟 1000 次
3. 解 `base_points` 使 median 学员的解锁曲线贴合 `target_progress_curve`
4. 输出 `fit_diagnostics`，若偏离 >15% 则回到第 3 步迭代

若设计师对某些权重有主观要求（如"我想让推理路径这个维度权重更高"），退化为 LLM Skill 做参数主观调整。

**Human 确认**是（校验 `fit_diagnostics` 是否符合预期）。

---

### 5.4 步骤面板 UI 规范

**布局**
* 左 60%：当前步骤的结构化面板（每步的专属视图，见上）
* 右 40%：与 Copilot 的对话区
* 顶部：步骤导航条（1→2→3→4→5），每步显示状态徽章（draft / confirmed / stale）
* 侧栏：Blueprint 总览 + 跨步骤跳转

**交互规则**
* **所有修改通过右侧对话驱动**：设计师说"把信息采集的中复杂度描述改得更具体"，Copilot 调用 Step1 Skill 的 `patch_rubric(dim='d1', complexity='medium', ...)` 子操作，Blueprint 局部更新，左侧面板自动刷新。
* **直接编辑面板字段**作为便捷补丁：对短文本字段允许设计师直接 inline 编辑（节省对话成本），但编辑事件会记入 `audit_log`。
* **回看**：点击顶部步骤条上的 `v1 / v2 / v3` 徽章切换到该版本快照（只读）；当前版本可继续编辑。

### 5.5 回退修改的级联规则

| 修改类型 | 级联范围 | 触发动作 |
| --- | --- | --- |
| Step1：核心动作的 name / description 文案微调 | 无级联 | 仅 `step1` 版本+1 |
| Step1：核心动作数量变化 / 知识类型变化 / 新增删除动作 | 2/3/4/5 全部置 stale | UI 显著警告 + 要求设计师对每个下游步骤显式决策（刷新 / 保留待手改） |
| Step1：质量矩阵的维度增删或复杂度档位变动 | 3/5 stale | 同上 |
| Step2：单个 action 的 form 替换 | 3 里相关 challenge stale（不整章） | 局部刷新 |
| Step2：form_library_version 升级 | 3/4/5 stale | 同上 |
| Step3：挑战顺序 / 复杂度 | 5 stale（不 4） | 局部刷新 |
| Step3：companion_hooks 增删 | 4 可能 stale（若 hook 引用了不存在的 type） | 仅相关 companion stale |
| Step4：companion 增删 / unlock_rule | 5 stale | 局部刷新 |
| Step4：persona 文案微调 | 无级联 | 仅 `step4` 版本+1 |

**原则**：Copilot 在生成级联诊断时输出自然语言说明"因为 A 变了，所以 B/C 需要重跑"，设计师必须**逐项确认**后才真正刷新。不自动覆盖。

### 5.6 Skill Prompt 模板统一规范

每个 Skill 的模板都包含以下段落：
1. **角色与风格**（谁在说话，什么身份）
2. **领域知识**（维度库 / 形式库 / ICAP / 分类学等）
3. **硬约束**（数量、长度、禁止事项）
4. **输入结构**（该 Skill 从 Blueprint 读什么）
5. **输出格式**（严格 JSON Schema，包含 `reasoning_notes` 字段给设计师解读）
6. **自检清单**（输出前自己回答的 5 个问题）
7. **示例**（1 正 1 反）

**迭代与评测**：每个 Skill 维护一套"金标题材"（3-5 个不同主题的人工标注 Gamecore），用作 regression test；修改 prompt 后跑一遍，判对率不得下降。

**优先级排序**：Skill 1（Gamecore 萃取） > Skill 3（剧本生成） > Skill 2（体验选型） > Skill 4（伴学设计）。Skill 5 以算法为主。

---

## 6. 学习阶段 PRD

### 6.1 三层业务功能（观察 / 判断 / 执行）

| 层 | 对应组件 | 是否 LLM |
| --- | --- | --- |
| 观察 | State Manager | 否（代码） |
| 判断 | Judge | 是（LLM） |
| 执行 | Narrator + Companion Agent(s) | 是（LLM） |

### 6.2 嵌套反馈循环

```
旅程（journey）——里程碑为标记，天/周级，对应"我整体进步多少 / 值得回来吗"
  └── 章节（chapter）——叙事容器，提供背景与情感弧线
        └── 挑战（challenge）——有完成态、可重玩、有积分结算的单元
              └── 执行-反馈交互（turn）——一次核心动作执行 + 系统反馈
```

每一层有独立的系统关注点（积分结算 / 叙事推进 / 伴学加载 / 进度可视化），但共享同一个 State Manager 做状态源。

### 6.3 角色与职责

#### 6.3.1 State Manager（代码）

**职责**
* 量化层的确定性计算（积分、衰减、解锁阈值）
* 质性层的 evidence 摘要存储与检索
* 交互起点提供状态快照，交互终点接收 Judge 的 grade 做更新

**双层存储设计**

```jsonc
// 量化层（每学员一条活跃记录 + 时序事件流）
{
  "learner_id": "u_xxx",
  "blueprint_version": "bp_xxx@3",
  "position": { "chapter_id": "c1", "challenge_id": "ch2", "turn_idx": 3 },
  "points": {
    "total": 87,
    "by_action": { "a1": { "raw": 40, "stability": 14, "last_review_at": "..." } }
  },
  "unlocked_companions": [
    { "companion_id": "cp1", "level": 1, "unlocked_at": "..." }
  ],
  "completed_challenges": [
    { "challenge_id": "ch1", "first_quality": {...}, "best_quality": {...} }
  ],
  "last_active_at": "...",
  "events_inbox": [ /* 每次交互启动时 State Manager 检查并弹出事件供 Judge */ ]
}
```

```jsonc
// 质性层（append-only evidence log）
{
  "learner_id": "u_xxx",
  "entries": [
    {
      "ts": "...",
      "challenge_id": "ch1",
      "action_id": "a1",
      "turn_idx": 2,
      "grades": { "d1": "medium", "d2": "good", "d3": "poor" },
      "evidence": "学员引用了回避眼神但未考虑外部压力源，推理链条止于表层观察"
    }
  ],
  "compressed_summary": "过去 10 轮：该学员在 a1 上信息采集稳定中等，推理路径仍待加强..."
  // 每 10 条 entries 由一个后台任务（非 LLM）用规则 + 可选 LLM 做压缩
}
```

**不是 LLM 的理由**：所有数值计算（积分、衰减、阈值比对）必须 deterministic + cheap；交由 LLM 会引入不必要的延迟与不确定性。

#### 6.3.2 Judge（LLM）

**职责**
* 评估学员表现质量（按质量矩阵当前复杂度列的 mini-rubric）
* 做出路径决策（推进 / 重试 / 触发脚手架 / 切换分支）
* 下达指令给 Narrator 与活跃 Companion(s)
* **不产出任何学员可见的文字**

**输入结构**

```jsonc
{
  "snapshot": { /* State Manager 的状态快照 */ },
  "events": [ { "type": "UNLOCK", "companion_id": "cp1" } ],
  "current_challenge": { /* from Blueprint Runtime */ },
  "rubric_column": { /* 该挑战复杂度对应的 mini-rubric 列 */ },
  "action_space_rules": { /* §6.5 的完整映射 */ },
  "learner_input": "...",
  "evidence_summary": "...",
  "active_companions": [ { "companion_id": "cp1", "level": 1 } ],
  "companion_registry": { /* 伴学列表的 persona 摘要与 io_spec */ }
}
```

**输出 Schema（v1 稳定版）**

```jsonc
{
  "quality": [
    { "dim_id": "d1", "grade": "medium", "evidence": "..." },
    { "dim_id": "d2", "grade": "good",   "evidence": "..." }
  ],
  "path_decision": {
    "type": "advance" | "retry" | "scaffold" | "branch" | "complete_challenge" | "escalate_complexity",
    "target": "ch3" | null,
    "scaffold_spec": { "form": "hint_question" | "structure_template" | "concrete_analogy" | "step_breakdown", "focus_dim": "d3" } | null
  },
  "narrator_directive": "肯定信息采集，追问推理深度；将 Elena 自然引入本场景",
  "companion_dispatch": [
    { "companion_id": "cp1", "role": "speaker", "directive": "用比喻帮助学员理解准备度四象限", "priority": 50 }
  ],
  "script_branch_switch": "c1.ch2.hook_h1" | null,
  "event_triggers": [
    { "type": "AWARD_POINTS", "payload": { "...": "..." } },
    { "type": "UNLOCK_CHECK", "payload": {} }
  ]
}
```

**单 Judge vs 多 Judge** → MVP 采用**单 Judge**。Judge prompt 结构化为多段（质量评估 / 路径决策 / 伴学路由），用 `chain_of_thought` 引导。仅当：
* p50 延迟 > 2s，或
* 在金标集合上总体判对率 < 85%

才拆成 Quality Judge + Routing Judge（两次 LLM 调用，仍可部分并行，但拆分代价是上下文重复）。

#### 6.3.3 Narrator（LLM）

**职责**
* 旅程的主持人；产出所有"旁白视角"内容（场景描述、反馈、叙事过渡、伴学登场引入、脚手架文本）
* 声音从头到尾保持稳定
* **不做评估决策**，只执行 Judge 的 `narrator_directive`

**上下文三层管理（token 预算 4K）**

| 层 | 内容 | 大小估算 | 更新频率 |
| --- | --- | --- | --- |
| L1 Persona（缓存） | Narrator 固定人设 | 300-500 tokens | 永不 |
| L2 章节态（半缓存） | 当前章节叙事背景 + 已发生剧情摘要 + 活跃 companion 列表 | 1500 tokens | 每章更新 |
| L3 当轮（动态） | 当前挑战 setup + Judge 的 directive + 最近 5 轮对话滑窗 | 1000-2000 tokens | 每轮更新 |

Anthropic prompt caching 覆盖 L1+L2，L3 为变化部分。

#### 6.3.4 Companion Agent(s)（LLM / 非 LLM）

**每种伴学独立 Agent**（即使同为 LLM）。理由：
* 记忆隔离（旅伴记友谊，敌人记对抗）
* 人设不串台
* 新增伴学 = 在 Registry 注册一条，不改主流程代码

**Persona 文档规范（统一 schema）**

```jsonc
{
  "companion_id": "cp1",
  "companion_type": "npc_guide",
  "display_name": "Elena",
  "persona": {
    "background": "资深 HRBP，10 年制造业经验",
    "personality_traits": ["务实", "爱用比喻", "偶尔毒舌"],
    "speech_patterns": {
      "sentence_length": "short",
      "typical_phrases": ["说白了…", "你试试看…"],
      "avoid": ["学术大词", "长段说教"]
    },
    "knowledge_boundary": "熟悉基层管理场景；不讨论薪酬/合规法条",
    "relationship_stages": [
      { "level": 1, "stance": "礼貌专业但有距离" },
      { "level": 2, "stance": "亲近，会分享轶事" },
      { "level": 3, "stance": "开放隐藏故事线" }
    ],
    "interaction_rules": {
      "speak_when": "Judge 指派且当前场景为 companion_hook 激活状态",
      "silent_when": "Judge 未指派 / 学员自由探索偏题 / 主干 setup 阶段"
    }
  },
  "io_spec": {
    "input": { /* from Judge dispatch + own memory */ },
    "output_format": "dialog_text",   // 或 reading_artifact / plot_delta / param_override / visualization / scenario_override
    "max_tokens": 300
  },
  "upgrade_deltas": [
    { "level": 2, "added_memory_slots": 5, "added_phrases": [...] },
    { "level": 3, "unlocks_plotline_id": "hp1" }
  ]
}
```

**非 LLM 伴学**（如 `difficulty_dial` / `replay_lens`）也通过同一接口注册，`output_format` 不同、`invoke` 调用走不同的 runtime handler。

**Companion Registry 接口**

```jsonc
POST /registry/companion
{
  "companion_id": "...",
  "companion_type": "...",
  "persona_doc": { /* 上面结构 */ },
  "runtime_handler": "llm_dialog" | "reading_render" | "plot_injection" | "param_apply" | "timeline_viz" | "scenario_swap"
}
```

#### 6.3.5 单次交互流程与延迟预算

```
学员输入
 │ t=0
 ▼
[State Manager]  读状态 + 检事件        ~50ms（内存/缓存）
 │ t≈50ms
 ▼
[Judge]          LLM #1 评估 + 决策     p50 1.5s（结构化输出，token 限制紧）
 │ t≈1.55s
 ▼
[State Manager]  算积分 + 更新 + 存证    ~50ms
 │ t≈1.6s
 ▼
并行：
 ┌─ [Narrator]          LLM #2 旁白文本    p50 1.5s（流式，首 token 500ms）
 ├─ [Companion #1]      LLM #3 in-char     p50 1.5s（流式）
 └─ [Companion #2 ...]  LLM #n             并行
 │ 对学员：首 token ≈ t + 2.1s；总完成 ≈ t + 3s
 ▼
合并渲染
```

**延迟目标**
* 首 token 可见：**≤ 2.5s p50 / 4s p95**
* 整轮完成：**≤ 4s p50 / 6s p95**

**降级策略**
* Judge 用 Sonnet 级；Companion 用 Haiku 级（快模型）
* 当主 LLM 超时 3s，Narrator 用预置模板回复维持体验
* 当 Companion 超时，以缄默处理（"Elena 点了点头"），不阻塞主体验

### 6.4 行动空间完整规范

沿用 Plan.md 表格，补充 Judge 决策字段映射：

| 学员行为 | `path_decision.type` | `scaffold_spec` | 积分事件 |
| --- | --- | --- | --- |
| 执行核心动作，质量达标 | `advance` | null | AWARD_POINTS（按 grade） |
| 质量不达标，第 1 次 | `retry` | null | 无（但 turn_idx++） |
| 质量不达标，连续 ≥2 次 | `scaffold` | 填充 | 无 |
| 脚手架后仍不达标 | `branch`（降级分支或替代任务） | null | 无 |
| 跳过当前挑战 | `branch`（skip_to_next） | null | 无 |
| 回看/重做之前挑战 | `advance`（以 replay 模式） | null | AWARD_POINTS（恢复衰减）+ 首次质量对比奖励 |
| 请求兑换伴学 | `advance` + `event_triggers=[UNLOCK_CHECK]` | null | 无 |
| 与已解锁 NPC 互动 | `advance`（对话模式） | null | 小额 participation_bonus |
| 长时间无操作 | 不经 Judge，由前端 timer 触发 Narrator 一句轻量提示 | — | 无 |
| 断点续传回来 | Judge 调用前先由 State Manager 发 `RESUME` 事件 | — | 视衰减情况提示复习 |
| 自由输入/偏题 | `advance`（探索模式，若相关）或 `retry`（温和引导） | null | 视相关性小额奖励或无 |
| 主动求助 | `scaffold`（但标记 `learner_initiated=true`，不记入卡壳计数） | 填充 | 无扣分 |

### 6.5 脚手架设计（针对 Plan.md 🔲 脚手架的完整回答）

**生成归属**：脚手架由 **Narrator 生成**（它是学员可见文字的唯一出口），但 **Judge 指定 form 与 focus_dim**。不新增独立 Scaffolder Agent——复用 Narrator 的人设，保持统一声音。

**四种 scaffold_form**（v1）

| form | 形态 | 适用情境 |
| --- | --- | --- |
| `hint_question` | 一个引导性追问 | 学员卡在"没想到"某个信号上 |
| `structure_template` | 提供一个思考结构（如"先 A，再 B，最后 C"） | 学员信息足但组织混乱 |
| `concrete_analogy` | 给一个类比/具体例子 | 学员概念理解偏抽象 |
| `step_breakdown` | 把当前任务拆成 2-3 个子步骤 | 学员被情境复杂度压垮 |

**评价标准**
* **短期有效性**：脚手架后的下一次执行是否在该 `focus_dim` 上升一个等级（poor→medium 或 medium→good）？
* **不降低认知参与**：脚手架应含问题/结构/类比，而非直接给答案；Narrator prompt 硬约束"不得输出该挑战的正确选项或完整答案"。
* **不过度使用**：同一 challenge 内最多 2 次脚手架；超过即路径降级（`branch`）。

**评测**：每个脚手架 form 维护金标集合，人工标注"这个 scaffold 在这个情境下合适吗"，迭代 Narrator prompt。

### 6.6 断点续传

**状态恢复策略**
* **默认**：只恢复量化层 + 最近位置，Narrator 发一句 1-2 行的"欢迎回来，你上次停在..."。
* **离开超过 24h**：Narrator 自动生成 **"Previously On..." 段**（≤ 80 字），内容从质性层 `compressed_summary` 拉取关键 evidence。
* **离开超过 7 天 且 核心动作积分衰减 ≥20%**：Narrator 在欢迎语后主动提议"要不要先刷一下 ch1 的记忆"（复习入口），不强制。

**State Manager 增加字段**

```jsonc
"session_continuity": {
  "last_session_end_at": "...",
  "gap_seconds": 87234,
  "needs_recap": true,
  "needs_review_prompt": false
}
```

### 6.7 旅程完成态设计

**完成触发**：最后一章最后一挑战被标记为 `complete_challenge` 且整体质量达阈（default: 总均分 ≥ medium）。

**完成产出**
* **反思交互**（最后一个特殊挑战）：Narrator 邀请学员自由回答"你最大的改变是什么 / 最不确定的仍然是什么"；可触发一次 `replay_lens` 伴学的免费使用。
* **证书页**：主题名 + 学员昵称 + 关键核心动作的 best_quality 分布可视化 + 一张"成长曲线"图（来自 State Manager 质性层）。
* **Alumni 状态**：标记 `journey_complete=true`。MVP 不做后续调度，只保留数据结构 `alumni_state`，为将来的持续复习/延伸内容留口子。

### 6.8 合并渲染

**排序规则**（v1）
1. Narrator 先渲染（设定场景/过渡）
2. 若 `script_branch_switch` 非空 → Narrator 在同一段内织入伴学登场
3. 活跃 Companion(s) 按 `companion_dispatch[].priority` 降序渲染
4. 非人格类伴学（如 `replay_lens` 可视化）作为独立卡片浮现在对话流之下，由前端选择是否主动展开

**流式输出**：Narrator 和 Companion 同时流式写入前端；UI 用不同色/头像区分；等全部完成后才给输入框解锁（防止学员在 Narrator 还没说完时先回复）。

---

## 7. 横切关注点

### 7.1 通用积分框架（独立、一次性科学设计）

> 这个框架**不依赖任何主题**，一旦设计完成就跨所有主题复用。每个主题通过 §5.3.5 的 `instance_params` 实例化。

#### 7.1.1 分值映射
| grade | base_points |
| --- | --- |
| good | 3 |
| medium | 1 |
| poor | 0 |

不引入负分（避免"惩罚式"情绪）。MVP 值；原型期校准。

#### 7.1.2 复杂度倍率
| complexity | multiplier |
| --- | --- |
| low | 1.0x |
| medium | 1.5x |
| high | 2.5x |

高复杂度的倍率跃升刻意拉开，鼓励学员尝试更高难度（与 `difficulty_dial` 伴学联动）。

#### 7.1.3 单次交互积分
```
points_earned = Σ(dim base_points × dim_weight) × complexity_multiplier
```
`dim_weight` 默认均分；主题可在 step5 配置。

#### 7.1.4 衰减函数（FSRS-inspired，针对 🔲 衰减科学依据）

每个核心动作对学员的掌握有一个"记忆稳定度" `S`（天数）和"当前可及性" `R ∈ [0,1]`。

```
R(t) = max(floor_ratio, exp(-t / S))
effective_points(a) = raw_points(a) × R(t)
```

* 初始 `S` 由 `knowledge_type` 决定（见 §5.3.5 `params_by_knowledge_type`）
* 每次复习后，`S ← S × stability_growth × quality_factor`
  * `quality_factor`：good=1.2 / medium=1.0 / poor=0.8
* `floor_ratio = 0.2`：衰减不跌破 20%，防止彻底丧失动力

**差异化**：factual 类衰减快（初始 S=3 天），procedural 类慢（初始 S=14 天），对应真实的遗忘曲线研究。

#### 7.1.5 恢复函数
复习（重做之前挑战并达到 medium 以上）触发：
```
new_S = old_S × growth_factor × quality_factor
new_R = 1.0  // 重置为满格
```
外加 **replay_bonus**：若本次 grade ≥ 首次 grade，额外奖励 `replay_bonus_ratio × base_points`（默认 0.3）。

#### 7.1.6 解锁阈值
```
threshold(companion) = companion.rank_percent × total_capacity
```
* `total_capacity` 由 Blueprint Compiler 估算（§5.3.5）
* `rank_percent`：第一个伴学 15%；第二个 30%；…；所有伴学 100%
* **目标进度曲线**（median 学员）：第 3 个挑战解锁第一个伴学，第 12 个挑战解锁全部

#### 7.1.7 数值模拟（针对 🔲 经济平衡）

Blueprint Compiler 内置 Monte Carlo 工具：
* 三种学员画像（fast: 全 good，80% 高复杂度选择；median: 60% good 30% medium 10% poor，均匀复杂度；slow: 30% good 50% medium 20% poor，低复杂度）
* 各画像模拟 1000 条旅程
* 诊断输出：每个伴学的首次解锁挑战分布 + 每个里程碑的达成挑战分布
* 规则：median 学员的 `first_companion_at` 必须在 `[3,5]` 区间，否则自动调参迭代

### 7.2 伴学系统设计（对 Plan.md 🔲 Companion 形式/升级的完整回答）

见 §5.3.4 的形式库与 §6.3.4 的 persona 规范。补充：

#### 7.2.1 MVP 必做的 3 种

1. **npc_guide**（代表人格类 LLM 伴学）
2. **case_pack**（代表非人格文本类）
3. **replay_lens**（代表可视化类，展示质性层数据）

每种伴学必须在 Plan 的"不可替代性/有效性假设/验证指标"三问上各有一条能被原型验证的答案（§11）。

#### 7.2.2 统一升级模型（v1）

所有人格类伴学默认三级：
* **Lv.1（默认）**：基础 persona + 有限记忆（最近 5 轮）
* **Lv.2**：扩展记忆（最近 20 轮 + 章节摘要） + 语气锋利化（引入 2-3 个签名口头禅）
* **Lv.3**：解锁该伴学的独家机制（如向导的"隐藏章节"、旅伴的"私人故事"、竞争者的"正面对决挑战"）

非人格类伴学的升级按"量"延展（更多案例 / 更细可视化维度 / 更大难度调节范围）。

#### 7.2.3 多伴学并存规则

* `active_companions.length ≤ 3`（硬上限）
* 同一场景至多 2 个被 Judge 派发为 speaker，其余为 silent（见 §5.3.3）
* 相互"读过彼此话"：同一 State Manager evidence 可被多个 Companion 引用，但每个 Companion 只从自己的人设出发解读

### 7.3 Blueprint → Runtime 编译机制

**Blueprint Compiler**（一段代码模块）在学员首次进入旅程时运行，将 Blueprint 转成各角色所需的运行时 bundle：

```
Blueprint (JSON)
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  Blueprint Compiler                                         │
│    ├─ 解析 step1 → QualityMatrixDoc（供 Judge 按列查询）    │
│    ├─ 解析 step3 → ChapterChallengeLoader（按位置取当前挑战 │
│    │              及其 companion_hooks）                    │
│    ├─ 解析 step3 + step4 → ScriptBranchResolver             │
│    │              （根据 active_companions 选分支）         │
│    ├─ 解析 step4 → CompanionFactory（按 id 实例化 Agent）   │
│    ├─ 解析 step5 → PointsEngine（注入 State Manager）       │
│    └─ 输出 runtime_bundle（hash 版本化，用于缓存）          │
└─────────────────────────────────────────────────────────────┘
```

**版本控制**：`runtime_bundle` 以 `blueprint_version` hash 为 key 缓存；Blueprint 更新时老学员继续用旧 bundle 直到下个里程碑，避免中途换参数破坏体验。

---

## 8. 运维后台（Admin Console）

### 8.1 定位与目标

运维后台是**面向 UMU 内部的"玻璃房"**：能看见系统内部每一次 LLM 调用的原始输入与输出、每一项运行指标；同时是**可干预的工作台**——所有系统提示词、Skill 模板、伴学（Companion）的 persona/行为规则在这里手动编辑，无需发版。

* **目标用户**：UMU 内部的运营 / 运维 / 内容质量团队（**不是**设计师日常创作界面，也**不是**学员界面）
* **两条主线**
  * **Observability（观）**：不采样、不裁剪地记录每次 LLM 调用；围绕 Agent 指标做告警与回归
  * **Mutability（改）**：所有 prompt / persona / 配置均可在 UI 直接编辑，按"系统级 vs 课程级"清晰分层、版本化、可回滚
* **设计硬约束**
  * 记录不遗漏（每一次 LLM 调用都进 ledger，含降级与失败调用）
  * 编辑不越权（系统级改动需 admin，课程级改动绑定 blueprint）
  * 热更新（prompt 变更不需发版；下一次调用生效或灰度生效）

### 8.2 Observability：可观测性

#### 8.2.1 原始调用账本（Raw Call Ledger）

**覆盖范围**（每一次 LLM 调用都必须入账，无例外）
* **设计阶段**：Skill 1-5 的每次调用、Design Copilot 的每次主对话调用、Blueprint 内部压缩/摘要调用
* **学习阶段**：Judge 的每次调用、Narrator 的每次调用、每个 Companion Agent 的每次调用、质性层 evidence 压缩调用、Narrator 的 "Previously On..." 生成调用
* **评测链路**：金标回归跑批的每次调用（带 `eval=true` 标记，与生产调用分桶统计但仍入账）

**每条记录的字段（完整 schema）**

```jsonc
{
  "call_id": "uuid",
  "trace_id": "uuid",              // 一次学员交互 / 设计师操作对应的 trace
  "parent_span_id": "uuid",         // 父 span（如 Narrator 由 Judge 指令触发时，parent 是 Judge 的 span）
  "ts_start": "...",
  "ts_end": "...",

  "stage": "design" | "learning" | "eval",
  "caller": "skill_1_gamecore" | "skill_2_experience" | "skill_3_script_skeleton" | "skill_3_script_fill"
          | "skill_4_companion" | "skill_5_points" | "design_copilot_chat"
          | "judge" | "narrator" | "companion:<companion_id>"
          | "summary_compressor" | "recap_generator",

  "model": "claude-opus-4-7" | "claude-sonnet-4-6" | "claude-haiku-4-5" | ...,
  "model_version": "...",
  "sdk": "anthropic",
  "api_endpoint": "messages" | "messages.stream",

  "raw_input": {
    "system": "...",                // 完整 system prompt（不裁剪）
    "messages": [ /* 完整 messages 数组 */ ],
    "tools": [ /* 若有 */ ],
    "temperature": 0.7,
    "max_tokens": 1024,
    "stop_sequences": [...]
  },
  "raw_output": {
    "content": [ /* 完整返回块 */ ],
    "stop_reason": "end_turn" | "max_tokens" | "stop_sequence" | "tool_use",
    "role": "assistant"
  },

  "tokens": {
    "input": 1234,
    "output": 567,
    "cache_creation": 890,           // prompt caching 写入
    "cache_read": 2345,              // prompt caching 命中
    "total": 5036
  },
  "cache": {
    "hit_ratio": 0.74,               // cache_read / (cache_read + input)
    "ttl_remaining_sec": 180,         // 该前缀距离失效还有多久
    "cache_key_hash": "sha256:..."
  },

  "latency": {
    "time_to_first_token_ms": 520,
    "total_duration_ms": 1480,
    "queue_wait_ms": 12
  },

  "cost_usd": 0.0134,

  "context": {
    "blueprint_id": "bp_xxx",
    "blueprint_version": 3,
    "learner_id": "u_xxx" | null,    // 学习阶段才有
    "designer_id": "d_xxx" | null,   // 设计阶段才有
    "chapter_id": "c1" | null,
    "challenge_id": "ch2" | null,
    "turn_id": "t_xxx" | null,
    "companion_id": "cp1" | null,    // companion caller 才有
    "active_companions": ["cp1"],    // 判断时的 active 集合
    "prompt_version": {              // 当次使用的各 prompt 版本（系统级 + 课程级覆盖）
      "system_level": "v12",
      "course_level": "v3"
    }
  },

  "lifecycle": {
    "status": "success" | "error" | "timeout" | "fallback",
    "retry_count": 0,
    "fallback_used": "template" | "haiku_downgrade" | null,
    "error_code": null,
    "error_message": null
  },

  "user_visible": true | false,      // 该输出是否到达学员界面（Judge=false, Narrator=true 等）
  "content_safety": {                // 输出过内容安全过滤的结果
    "flagged": false,
    "flags": []
  }
}
```

**存储策略**
* 热存储 30 天，全字段可查
* 冷存储 90 天，可下载但非实时检索
* 90 天后归档到对象存储；超过 12 个月按治理策略删除
* 高容量优化：raw_input / raw_output 做 gzip；messages 重复部分引用 `prompt_version` 指针避免复制

**查询 UI**
* **时间线视图**：按 `ts_start` 排序，卡片显示 caller + model + latency + cost + status
* **过滤器**：stage / caller / model / learner_id / blueprint_id / status / 时间范围 / cache_hit_ratio 阈值 / 是否 fallback
* **详情抽屉**：点开一条记录，左面 raw_input（可一键复制）/ 右面 raw_output / 底部 tokens+cache+latency+cost
* **Trace 视图**：按 `trace_id` 展开一条完整因果链（见 §8.2.3）
* **Replay**：一键用当前生产 prompt 重跑同一 raw_input，与历史 raw_output 做 diff（回归调试用）

#### 8.2.2 指标看板（Metrics Dashboard）

按 **caller**、**model**、**blueprint**、**学员画像** 四个维度切片展示。

| 指标族 | 具体指标 | 告警默认阈值 |
| --- | --- | --- |
| **延迟** | time_to_first_token p50/p95/p99；total_duration p50/p95/p99 | p95 > 预算 120% 持续 5 分钟 |
| **吞吐** | 每分钟调用数；每学员每小时交互数 | 异常骤降 50% |
| **成功率** | success / error / timeout / fallback 分布 | 错误率 > 1% |
| **Token 经济** | 平均 input/output token；与预算对比；长尾 (> 2× 均值) 占比 | 平均 > 预算 130% |
| **Cache** | hit_ratio（整体 + 按 caller）；write 次数；TTL 过期命中损失估算 | hit_ratio < 60% for Judge/Narrator |
| **成本** | USD / 调用；USD / 学员 / 天；USD / 课程 / 学员完成 | 日成本环比 > 50% |
| **质量** | Judge 判对率（对金标）；Narrator 合规率（内容安全过滤命中率）；脚手架短期有效率（§6.5） | 判对率 < 85% |
| **业务** | 完成率；7 日回访率；首次伴学解锁挑战分布 | 完成率 < 40% |

**看板交互**
* 时间范围选择（1h / 24h / 7d / 30d / custom）
* 维度下钻（点击某个 caller 的柱子 → 进入该 caller 的细节 dashboard）
* 对比模式（prompt v11 vs v12 的 A/B 期间对比）
* 导出 CSV / 订阅告警到 Slack / 飞书

#### 8.2.3 分布式追踪（Tracing）

**一个 trace 的典型结构（学习阶段单次交互）**

```
trace_id: trc_xxx    (span root = turn)
├─ span: state_manager.load           (code, 40ms)
├─ span: judge.call                   (llm, 1480ms)  ← Raw Ledger 记录
├─ span: state_manager.update         (code, 50ms)
├─ span (parallel):
│   ├─ span: narrator.call            (llm, 1600ms) ← Raw Ledger 记录
│   ├─ span: companion:cp1.call       (llm, 1300ms) ← Raw Ledger 记录
│   └─ span: companion:cp3.call       (llm, 1100ms) ← Raw Ledger 记录
└─ span: render.merge                 (code, 20ms)
```

**一个 trace（设计阶段单次 Skill 调用）**

```
trace_id: trc_yyy
├─ span: copilot.intent_parse         (llm, 800ms)   ← Raw Ledger
├─ span: skill_3_script_skeleton.call (llm, 3200ms) ← Raw Ledger
├─ span: validate.schema              (code, 30ms)
└─ span: blueprint.patch              (code, 60ms)
```

* 每个 LLM span 在 Raw Ledger 中有对应 `call_id`，span 视图可一键跳 Ledger 详情
* 支持按 trace 搜索：输入 `learner_id` + 时间 → 列出该学员的所有 trace
* 异常 trace 高亮（任一 span 为 error / timeout / fallback）

#### 8.2.4 金标评测回路（Eval Loop）

* **金标集合管理**：
  * Skill 1-5 每个各维护 ≥5 个主题的标注 Gamecore / 剧本 / 伴学结构
  * Judge 维护 ≥200 个标注的（input, expected_quality, expected_decision）样本
  * Scaffold 4 种 form 各 ≥20 个情境样本
* **触发方式**：
  * 手动：在编辑器里按"回归评测"按钮
  * 自动：任何 prompt 版本从 Draft 到 Approve 时强制跑
  * 定时：每晚跑一次全量，生成趋势图
* **结果输出**：判对率 / 与上一版 diff / 错误案例摘要（失败用例的 input + expected + actual + diff）
* **与 Ledger 联动**：eval 跑批的调用也入 Ledger（stage=eval），便于看"同一 prompt 在生产 vs 金标的表现差"

### 8.3 Mutability：可编辑性

#### 8.3.1 两级继承模型：系统级 vs 课程级

**核心规则**

* **系统级（System-level）**：跨所有课程复用的默认配置。改一次影响全量。
* **课程级（Course-level）**：绑定到具体 `blueprint_id` 的覆盖配置。只影响该课程。
* **解析优先级**：运行时查找顺序为 **课程级 override → 系统级 base**。缺省则用系统级。
* **模板继承**：课程级通常只覆盖**局部字段**（如 Narrator 的 tone_override），不复制整篇 prompt；UI 渲染时合并为最终有效版本供预览。

```
┌─────────────────────────────────────────────────────────────┐
│  系统级 Prompt Store                                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ narrator.base_persona  v12  published                    │ │
│  │ judge.system_prompt    v8   published                    │ │
│  │ skill_1.template       v15  draft                        │ │
│  │ ...                                                      │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────┘
                        │ 继承 + 局部覆盖
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  课程级 Prompt Store（per Blueprint）                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ bp_situational_leadership:                               │ │
│  │   narrator.tone_override         v3  published           │ │
│  │   companion:cp1.persona          v5  published           │ │
│  │   challenge:ch2.trunk_text       v2  published           │ │
│  │   scaffold.hint_question_phrasing v1 published           │ │
│  │ bp_seven_habits:                                         │ │
│  │   ...                                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 8.3.2 可编辑对象清单（完整枚举）

**A. 系统级对象（所有课程共享）**

| # | 所属阶段 | 对象 | 对象类型 | 作用域 |
| - | --- | --- | --- | --- |
| S1 | 设计 | `design_copilot.system_prompt` | system prompt | 所有设计师对话 |
| S2 | 设计 | `skill_1_gamecore.template` | Skill 模板（prompt + schema + 校验） | 所有 Gamecore 萃取 |
| S3 | 设计 | `skill_2_experience.template` + `experience_form_library` | Skill + 形式库（9 种） | 所有体验选型 |
| S4 | 设计 | `skill_3_script_skeleton.template` | Skill 骨架 pass | 所有剧本生成 |
| S5 | 设计 | `skill_3_script_fill.template` | Skill 填充 pass | 所有剧本填充 |
| S6 | 设计 | `skill_4_companion.template` + `companion_type_library`（9 种基础 persona 骨架） | Skill + 伴学形式库 | 所有伴学设计 |
| S7 | 设计 | `skill_5_points.algorithm_params` + `points_framework_defaults` | 非 LLM 算法的默认系数 + 通用积分框架 | 所有积分配置 |
| S8 | 学习 | `judge.system_prompt` + `judge.output_schema` | system prompt + JSON schema | 所有 Judge 调用 |
| S9 | 学习 | `narrator.base_persona`（L1 固定层） | persona doc | 所有课程 Narrator |
| S10 | 学习 | `scaffold.form_templates` × 4（hint_question / structure_template / concrete_analogy / step_breakdown） | 脚手架模板 | 所有脚手架触发 |
| S11 | 学习 | `companion.archetype_library` × 9（npc_guide / npc_traveler / npc_competitor / npc_adversary / case_pack / hidden_plotline / difficulty_dial / replay_lens / context_variant） | 基础 persona + io_spec 骨架 | 所有伴学实例化 |
| S12 | 学习 | `summary_compressor.prompt` | 质性层 evidence 压缩 prompt | 所有学员 |
| S13 | 学习 | `recap_generator.prompt` | 断点续传的 "Previously On..." prompt | 所有学员 |
| S14 | 通用 | `dimension_library` + `selection_matrix` + `knowledge_type_taxonomy` | 被多个 Skill 引用的知识库 | 所有设计 |
| S15 | 通用 | `content_safety.filter_list` | 禁引词/禁用表达 | 所有输出 |
| S16 | 通用 | `model_routing.policy` | 哪个 caller 用哪个 model + 降级规则 | 全站 |

**B. 课程级对象（绑定具体 Blueprint）**

| # | 所属阶段 | 对象 | 对象类型 | 来源 |
| - | --- | --- | --- | --- |
| C1 | 设计 | 该课程的主题名 + 设计师补充描述 | Skill 1 的原始输入 | 设计师输入 |
| C2 | 设计 | Blueprint 的 `step1_gamecore`（核心动作 + 质量矩阵） | 结构化数据 | Skill 1 产出 |
| C3 | 设计 | `step2_experience`（映射表） | 结构化数据 | Skill 2 产出 |
| C4 | 设计 | `step3_script`（章节/挑战/trunk/companion_hooks） | 结构化数据 + 自由文本 | Skill 3 产出 |
| C5 | 设计 | `step4_companions`（每个 companion 的完整 persona 与 upgrade_path） | persona doc | Skill 4 产出 |
| C6 | 设计 | `step5_points.instance_params` | 参数表 | Skill 5 产出 |
| C7 | 学习 | `narrator.tone_override`（在 S9 基础上叠加语调/风格差异） | persona delta | 该课程 |
| C8 | 学习 | 该课程每个 companion 的 `persona`（课程特化版，继承自 S11 的 archetype） | persona doc | 该课程 |
| C9 | 学习 | 每个挑战的 `trunk` 文案 | 叙事文本 | 可编辑（C4 的一部分，但单独可编辑暴露） |
| C10 | 学习 | 每个挑战的 `companion_hooks[].delta` | 叙事 delta | 同上 |
| C11 | 学习 | `scaffold.phrasing_override`（该课程的脚手架用语本地化） | 文案 override | 可选 |
| C12 | 学习 | `judge.rubric_pack`（该课程的 quality matrix mini-rubric，供 Judge 按列取用） | 结构化数据 | C2 派生 |
| C13 | 通用 | 该课程的模型路由 override（某个 caller 在本课程用更快/更贵模型） | 配置 | 可选 |

> **关键区分**：C2-C6 既是 Blueprint 的一部分（设计师通过步骤面板改），也在 Admin Console 暴露（内部运营侧可直改）。两者改同一存储，但权限不同——设计师只能在自己未归档的 Blueprint 上改；运营 admin 可以对任意 Blueprint 改并触发重编译。

#### 8.3.3 编辑工作流（Draft → Preview → Approve → Publish）

**状态机**

```
Draft → Preview → Approved → Published
  ▲                  │
  └──── Rejected ◀───┘
          ↓
        Rollback（可从 Published 一键回滚到任何历史版本）
```

* **Draft**：任何角色可创建；不影响生产。
* **Preview**：编辑器实时展示 diff + 金标评测结果 + Token 估算 + 样例 raw_input/raw_output。
* **Approved**：通过审核（系统级需 admin，课程级设计师 owner 即可）。
* **Published**：
  * **系统级**：支持**灰度发布**——10% → 50% → 100%，按 `learner_id` hash 分桶；灰度期间对比两版关键指标（§8.2.2），异常自动暂停
  * **课程级**：即时生效，只作用于该 Blueprint 的**新交互**，不追溯已写入的历史
* **Rollback**：任何 Published 版本可一键回滚；回滚记录入 audit_log。

**分支策略**：系统级对象允许有 `main / staging / experiment_*` 多条版本分支用于 A/B（见 §8.3.6）。

#### 8.3.4 编辑器 UI 规范

**布局**

```
┌──────────────────────────────────────────────────────────┐
│ 顶栏：对象名 + 当前版本 + 状态 + [Preview] [Approve] [Pub]│
├──────────┬────────────────────────────┬──────────────────┤
│ 左：对象树 │  中：编辑器                 │  右：预览 & 评测  │
│          │                            │                  │
│ [系统级] │  ┌──────────────────────┐  │  [合并有效版]     │
│  ├设计   │  │ system prompt 富文本  │  │  [diff vs 上版]  │
│  │ ├S1   │  │ 高亮占位符 {{...}}    │  │  [金标评测结果]  │
│  │ ├S2   │  │                      │  │  [token 估算]    │
│  │ ...   │  └──────────────────────┘  │  [示例 I/O]      │
│  └学习   │  ┌──────────────────────┐  │                  │
│    ├S8   │  │ 变量面板              │  │  [关联 Ledger]   │
│    ├S9   │  │ {{quality_matrix}}    │  │                  │
│    ...   │  │ {{evidence_summary}}  │  │                  │
│ [课程级] │  └──────────────────────┘  │                  │
│  ├bp_xxx │                            │                  │
│  │ ├C7   │                            │                  │
│  │ ├C8   │                            │                  │
│  │ ...   │                            │                  │
└──────────┴────────────────────────────┴──────────────────┘
```

**关键交互**

* 左侧对象树按 **[系统级 / 课程级]** 两个顶级分组；系统级下按"设计/学习/通用"分组；课程级下按 Blueprint 分组
* 中间支持富文本 + 代码 + YAML/JSON 混合编辑（不同对象不同编辑器）
* **占位符校验**：Jinja 风格 `{{var}}` 在编辑时高亮、悬停提示含义与示例值；未定义占位符阻止 Approve
* **Dry Run**：编辑器可选择一个真实 learner + turn 的 snapshot 作为模拟输入，立即对比新旧 prompt 的 raw_output

#### 8.3.5 发布到运行时的生效机制

* 每个调用点（Judge / Narrator / Companion / Skill）在**每次调用前**从 Prompt Store 读取"当前有效版本"
* Prompt Store 是内存缓存 + 事件驱动失效（发布事件触发失效，无需重启）
* 调用时把所使用的 `prompt_version.system_level + course_level` 写入 Ledger 的 `context.prompt_version` 字段，保证可追溯
* Blueprint Compiler（§7.3）每次编译产物同样绑定 `prompt_version` hash；老学员仍跑老 bundle 直到下个里程碑

#### 8.3.6 实验与 A/B

* 支持为任一系统级对象创建**实验分支**（experiment_*）
* 按 `learner_id` hash 或 `blueprint_id` 白名单分流
* 实验期间 Ledger + Metrics 可按 `experiment_id` 维度切片看差异
* 实验结束支持"promote to main"或"discard"

### 8.4 权限与审计

| 角色 | 看 Ledger | 看指标 | 改系统级 | 改课程级 | 审批发布 |
| --- | --- | --- | --- | --- | --- |
| admin（UMU 运维核心） | ✅ 全量 | ✅ | ✅ | ✅ | ✅ |
| ops（运营） | ✅ 脱敏 | ✅ | ❌ | ✅（只自己负责的课程） | ❌ |
| designer（课程设计师） | ✅ 仅自己课程相关 + 脱敏 | ✅ 自己课程 | ❌ | ✅ 自己课程 | ❌ |
| auditor（合规审计） | ✅ 全量 | ✅ | ❌ | ❌ | ❌ |
| developer（工程） | ✅ 全量（非脱敏需二次审批） | ✅ | ✅ 经 admin 确认 | ❌ | ✅（系统级） |

**审计日志**：所有编辑、发布、回滚、权限变更均写入 `admin_audit_log`，永久保留，包含 who / when / what（diff）/ why（可选备注）/ 关联 ticket。

### 8.5 数据治理

* **PII 脱敏**：Ledger 中的 `raw_input.messages` 若含学员自由输入，默认按策略脱敏（人名/邮箱/电话 redact）；原始值加密保存，需二次审批才能在 UI 看
* **学员数据请求**：按 `learner_id` 支持导出 / 删除（GDPR 类合规口子）
* **内容版权**：Ledger 定期扫描，检测输出是否命中原文片段（通过长字符串相似度 + 关键词列表），命中进入 `content_safety.flagged`
* **成本护栏**：按 Blueprint / 按学员设置日成本上限，超限告警并自动降级模型

### 8.6 与其他模块的接口

* **State Manager**（§6.3.1）在每次 evidence 写入时异步复制到 Ledger
* **Blueprint Compiler**（§7.3）编译时读取系统级 + 课程级 Prompt Store 的最新 Published 版本，绑定 hash
* **金标评测**（§5.6 / §6.5）接入 §8.2.4 的 Eval Loop
* **运行时各 LLM 调用点**通过统一的 `llm_call(caller, variables)` SDK 封装：SDK 负责拼 prompt（从 Store 读版本 + 占位符渲染）、调用 Claude API（带 prompt caching）、写 Ledger、计费

### 8.7 MVP 范围（针对 Admin Console）

> 详细分期见 §10。

* **M0 必须**：Ledger（raw_input/raw_output 完整字段）+ 基础 metrics（延迟/token/cache/成本）+ Trace + Prompt Store 两级继承模型的存储层
* **M1 必须**：系统级 Skill 1-5 的可视化编辑 + Draft→Publish 状态机 + 金标评测按钮
* **M2 必须**：学习阶段 Judge/Narrator/Companion 的编辑 + 课程级 override UI + 发布灰度 + 告警
* **M3 目标**：A/B 实验框架 + 权限分级完整上线 + 合规导出 / 删除工具

---

## 9. 非功能需求

| 维度 | 指标 |
| --- | --- |
| **延迟** | 首 token ≤2.5s p50；整轮 ≤4s p50；Judge 单次 ≤1.5s p50 |
| **可用性** | 学习阶段 99.5%；设计阶段可容忍至 99%；Admin Console 99% |
| **可扩展性** | 新增 Companion type 只需注册 + persona doc；无需改 Judge 核心逻辑；新增可编辑对象只需在 Prompt Store 注册 schema |
| **可观测性** | 每次 LLM 调用必须完整入 Ledger（raw_input + raw_output + tokens + cache + latency + cost + prompt_version），零采样；Trace 串联一次交互的所有 span；Metrics 看板提供 6 类指标族（§8.2.2）；评测金标集跑批结果入 Ledger |
| **可编辑性** | 所有 system prompt / Skill 模板 / persona / 配置通过 Admin Console 编辑，热更新无需发版；系统级走灰度，课程级即时生效；完整版本化可回滚 |
| **Prompt Caching** | Judge/Narrator 的 L1+L2 层走 Anthropic prompt caching，目标命中率 ≥70%；Companion 的 persona 段强制走 cache |
| **内容安全** | 所有 Skill / Narrator / Companion 的 prompt 均含"不得引用任何已出版作品原文字句"硬约束；输出过本地关键词过滤 + 长串相似度检测；命中写入 Ledger 的 `content_safety.flagged` |
| **隐私** | 学员 evidence 不含 PII；Ledger 中自由输入默认脱敏；可按 learner_id 导出/删除（§8.5） |
| **权限** | Admin Console 分 5 种角色（admin / ops / designer / auditor / developer），按 §8.4 授权；所有变更写 `admin_audit_log` 永久保留 |
| **成本** | 每轮 LLM 调用总 token 预算 ≤ 6K input + 1K output；日活 1 万 / 人均 20 轮下单日 LLM 成本为关键指标；支持按 Blueprint / 按学员设置日成本上限与自动降级 |

---

## 10. MVP 范围与分阶段交付

### M0（4 周）——基础设施 + Admin 骨架
* Blueprint JSON Schema 落地 + 存储
* Design Copilot 壳 + 对话路由
* State Manager 代码骨架 + 量化层存储
* 通用积分框架 v1 的代码实现 + 单元测试
* **`llm_call` 统一 SDK**：封装 Claude API + prompt caching + Ledger 写入 + 计费（所有 LLM 调用必须走该 SDK）
* **Admin Console M0**：Raw Call Ledger 存储与查询 UI、基础 Metrics 看板（延迟/token/cache/成本）、Trace 视图、Prompt Store 两级继承存储层（仅后端，编辑入口延后）

### M1（6 周）——设计阶段 5 环节跑通
* Skill 1-5 的 prompt + 校验
* 步骤面板 UI（5 个 panel）
* 回退级联规则
* 用 1 个主题（建议"情境领导力"）从头到尾产出一份 Blueprint，设计师可以签字
* **Admin Console M1**：系统级 Skill 1-5 + Design Copilot system prompt 可视化编辑；Draft → Preview → Approve → Publish 状态机；金标评测按钮；对象树 UI（系统级分组）

### M2（6 周）——学习阶段四角色跑通
* Blueprint Compiler
* Judge prompt + schema 闭环
* Narrator + 上下文三层管理
* MVP 3 种 Companion（npc_guide + case_pack + replay_lens）
* 单次交互流程 + 合并渲染 + 延迟预算达标
* 断点续传 + 完成态
* **Admin Console M2**：Judge / Narrator / Companion / scaffold / 脚手架等所有学习阶段对象的编辑；课程级 override UI（对象树增加课程级分组）；灰度发布（10/50/100）；告警配置（Slack/飞书）；Dry Run（拿真实 snapshot 跑新 prompt 看 diff）

### M3（4 周）——校准与打磨
* 金标集合建立（每个 Skill 5 个主题 + Judge 200 样本 + 每个 scaffold form 20 个情境）
* Monte Carlo 积分经济平衡
* 3 种学员画像的体验 QA
* 首批外部课程设计师试用 + 反馈迭代
* **Admin Console M3**：A/B 实验框架（experiment 分支 + 按 learner_id hash 分流）；完整权限分级（5 种角色）；合规导出 / 删除工具；内容版权扫描；成本护栏（日上限 + 自动降级）

---

## 11. 待验证假设与实验计划

| 假设 | 验证方法 | 何时验证 | 成功标准 |
| --- | --- | --- | --- |
| 🔲 **mini-rubric 三级够用** | 让 5 位设计师用同一矩阵评同一批学员回答，看评级一致性 | M1 末 | Cohen's κ ≥ 0.7 |
| 🔲 **章节-挑战规模参数（3-5/3-4/1-3）** | 用情境领导力主题跑 20 位种子学员，测完成率与总时长 | M2 中 | 完成率 ≥60%，时长 120-240 分钟 |
| 🔲 **Companion 有效性（每种）** | 带/不带某 Companion 的 A/B，测满意度 + 3 日回访 + 关键动作质量 | M3 | 关键指标任一显著提升 |
| 🔲 **路径灵活度（自由输入 vs 选择题）** | 同一挑战做两版，切 A/B，测 Constructive 参与比例与系统误判率 | M2 末 | 自由输入组 Constructive 比例 ≥ 选择题组 20%；Judge 误判率 ≤15% |
| 🔲 **脚手架短期有效性** | 每次 scaffold 后统计下一次在 focus_dim 上的 grade 变化 | M2-M3 | 升级率 ≥60% |
| 🔲 **积分经济平衡** | Monte Carlo + 真实学员回访率比对 | M3 | median 学员首次伴学解锁在 [ch3, ch5]，7 日回访率 ≥35% |
| 🔲 **单 Judge vs 多 Judge** | Judge 输出对金标集跑 200 个用例，比对准确率与延迟 | M2 | 单 Judge 判对率 ≥85% 时不拆；否则拆 |
| 🔲 **衰减函数拟合** | 让学员间隔 1/3/7/14 天回来，测实际"感觉还记得"的比例，对照 R(t) 曲线 | M3 | 预测与自评的 RMSE ≤0.15 |
| 🔲 **伴学类型扩展（除 MVP 3 种外）** | 用原型追加 `npc_traveler` + `hidden_plotline` + `difficulty_dial`，各跑 30 位学员 | M3 后 | 视反馈决定是否正式加入库 |

---

## 附录 A：对 Plan.md 所有 🔲 Todo 的处理清单

| Plan.md 条目 | 本 PRD 处理位置 | 决策类型 |
| --- | --- | --- |
| 伴学加入后互动模式 | §5.3.3（主干+delta）§6.3.4（persona+io_spec） | 直接定义 |
| 伴学清单的必要性/有效性论证 | §5.3.4（每个伴学必填三问）§11（A/B 验证） | 定义 + 验证计划 |
| 质量矩阵维度如何确定 | §5.3.1（维度库 + Skill 选取逻辑） | 直接定义 |
| mini-rubric 粒度 | §5.3.1（MVP 三级 + schema 兼容 5 级） | 直接定义 + §11 验证 |
| 体验形式完整候选库 | §5.3.2（8 种 v1 + 版本管理） | 直接定义 |
| 选型规则可操作性 | §5.3.2（选型矩阵 + Skill 硬规则） | 直接定义 |
| 伴学接入点条件分支粒度 | §5.3.3（共享主干 + delta） | 直接定义 |
| 多伴学组合爆炸 | §5.3.3 + §7.2.3（至多 3 活跃/2 speaker + priority） | 直接定义 |
| 章节-挑战规模参数 | §5.3.3（3-5/3-4/1-3） | 直接定义 + §11 验证 |
| Companion 形式设计（阻塞性） | §5.3.4（9 种形式库）§7.2.1（MVP 3 种） | 直接定义 |
| 伴学升级路径 | §7.2.2（统一三级模型） | 直接定义 |
| 通用积分框架（阻塞性） | §7.1 整节 | 直接定义 |
| 衰减函数科学依据 | §7.1.4（FSRS-inspired + knowledge_type 差异 + floor） | 直接定义 + §11 验证 |
| 积分经济平衡测试 | §7.1.7（Monte Carlo + 三画像） | 直接定义 + §11 验证 |
| 路径灵活度 | §6.4（默认 NL，二选一决策点例外） | 直接定义 + §11 验证 |
| 脚手架评价标准/形式/生成归属 | §6.5（Narrator 生成 + Judge 指定 form + 四种 form + 评价标准） | 直接定义 |
| 断点续传状态恢复 | §6.6（三级策略：≤24h/>24h/>7d） | 直接定义 |
| 旅程完成态 | §6.7（反思交互 + 证书 + alumni 口子） | 直接定义 |
| 各 Skill prompt 模板 | §5.6（统一 7 段结构 + 金标评测 + 优先级） | 直接定义 |
| 剧本生成 Skill 分步 | §5.3.3（骨架 pass + 填充 pass + 章节级重生成） | 直接定义 |
| Blueprint 数据结构 | §5.2 + 各环节子 schema | 直接定义 |
| 步骤面板 UI 规范 | §5.4（布局 + 每步专属面板） | 直接定义 |
| 回退级联规则 | §5.5（修改类型 → 级联范围矩阵） | 直接定义 |
| Judge 输出 schema | §6.3.2（v1 稳定版 JSON） | 直接定义 |
| Judge 架构/提示词 | §6.3.2（MVP 单 Judge + 拆分触发条件） | 直接定义 + §11 验证 |
| Narrator 上下文管理 | §6.3.3（三层 + prompt caching） | 直接定义 |
| Companion persona 规范 | §6.3.4（完整 schema） | 直接定义 |
| Companion 注册接口 | §6.3.4（Registry POST schema） | 直接定义 |
| State Manager 双层存储 | §6.3.1（量化 + 质性 schema + 压缩策略） | 直接定义 |
| 合并渲染排序 | §6.8（4 步规则） | 直接定义 |
| 延迟预算 | §6.3.5（整套预算 + 降级） | 直接定义 |
| Blueprint → Runtime 加载 | §7.3（Blueprint Compiler） | 直接定义 |

—— 全部 32 条 Plan.md 显式或隐式 Todo 已在本 PRD 中有对应位置。

---

## 附录 B：术语速查表

（同 §2；合并到附录便于单独查阅。略）

---

**文档结束。版本 v0.1，待设计师与工程师联合评审后升级到 v1.0。**
