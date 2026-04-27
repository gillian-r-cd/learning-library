# 支架阶梯重设计：从叙事优先到自由输入的渐进释放

## 0. 一句话目标

每个核心动作（core_action）的练习都应当遵循"先看故事，再勾选项，再填表单，最后自由表达"的顺序；学员的输入难度由系统按照熟练度推进，而不是从一开始就要求学员写整段散文。

---

## 1. 你提出的产品愿景

引用你的描述（已结构化整理）：

1. **支架的本质是用最小的学员动作换取最大的故事推进**。学员点一个按钮，剧情就向前播放一段。这种支架不是把按钮当成"评分输入"，而是把按钮当成"故事开关"。
2. **学员不应当能够预测下一次需要手动输入是在什么时候**。当系统真的要求学员手动输入时，那本身就是一种信号：系统判断学员已经具备了独立完成某个动作的能力。
3. **新动作的学习路径**：学员第一次遇到某个核心动作时，先用单击、二选一、点选等最小动作进入剧情；熟悉之后，再让学员填结构化的字段；到最后再让学员独立写一段自由文本。
4. **类比**：橙光式互动小说。前期沉浸感优先，学员是观察者，偶尔做小决定；后期再把方向盘交给学员。

这是一个典型的"逐步释放责任"（gradual release of responsibility）的教学序列，与现有框架在多处不一致。

---

## 2. 当前框架的真实情况

按数据流自上而下扫描一遍，把现状摆出来。

### 2.1 数据模型：[`response_frames`](../lib/types/core.ts) 已经存在但用法颠倒

每个 challenge 在设计阶段会输出若干 `response_frames`，类型可以是 `free_text` / `single_choice` / `multi_choice` / `form` / `ranking` / `matrix` / `allocation` / `compound`。`default_response_frame_id` 指向首轮使用的框架。Judge 在运行时可以通过 `next_response_frame` 切换框架。

数据模型本身并不限制顺序，但 [`docs/learner-response-framework-design.md` §3](./learner-response-framework-design.md) 与现行 Skill 3 Fill prompt（[seed.ts](../lib/prompt-store/seed.ts) / [all_prompts_revised.md](./all_prompts_revised.md) 中的对应章节）都规定："**通常第一轮用 free_text；如果 setup 明确要求拆分填写，可默认用 form**"。也就是说默认从最高难度开始，结构化框架反而成了"降档"。

### 2.2 Judge 的 `path_decision` 没有"渐进升档"维度

当前 `path_decision.type` 取自：`advance / retry / scaffold / branch / complete_challenge / reveal_answer_and_advance / escalate_complexity / simplify_challenge`。这八种全部围绕"评分结果"组织：表现达标向前推（advance），表现不达标退（retry / scaffold / simplify_challenge），最坏直接揭晓（reveal）。

没有"学员表现达标，因此把输入框架从 single_choice 升级为 form"这个动作。也就是说，**当前框架只能因为表现差而降档支架，不能因为表现好而升档输入难度**。

### 2.3 Judge → Narrator 是评分驱动的，不是叙事驱动的

每次学员提交输入，runtime 都会：

1. 调 Judge 评分，给出 `quality[]`（按 dim 打 good / medium / poor）；
2. Judge 输出 `narrator_directive`；
3. 调 Narrator 把 directive 翻译成学员可读的旁白；
4. 写入 evidence、ledger、积分、招式卡等。

每一次按钮、每一次提交，全流程都被当成一次"练习与评估"。没有"学员只是点一下推进剧情，系统不评分"这种轻量路径。

### 2.4 Narrator 的"钩子"形态单一，默认是开放问句

Narrator 永远要在结尾留一个让学员动手的钩子，这本身没问题——学员需要一个明确的下一步动作。问题在于这个钩子的**形态**只有一种：开放式问句，结构上预设学员要打字输入一段散文（"你打算怎么开口跟她说？""哪一类用户会受到影响？请举出一个例子"）。

我们要的钩子形态包含两类，目前只有第一类被实现：

- **问句钩子**：narrator 直接抛一个开放问题，学员需要打字回答。适用于练习模式。
- **话题钩子**（缺失）：narrator 描写一段剧情，结尾把学员的注意力锁定到一个**等待表态的瞬间**——一个具体的动作、一句没说完的话、一份摆在桌上的文件、一个对方的表情。学员不需要造句，只需要从下面的几个候选立场中选一个。这个选择推动剧情走下一段。

Narrator 当前的硬约束（第 9 条 "不给正确答案，但可以提问、给结构、给类比"、第 14 条 "末句必须是一个邀请学员合成的问法" 等）都隐含了"钩子 = 开放问句"这一假设，需要扩充为支持话题钩子。

### 2.5 没有跨挑战的"动作熟练度"维度

`learner_state` 跟踪的是 `points / unlocked_companions / completed_challenges / position`。Judge 输入有 `consecutive_poor_in_challenge / challenge_turn_idx`，但都局限于**当前挑战内**。

如果一个核心动作 `a1`（识别准备度）在 c1 已经被练过两次（且都达标），到 c2 再次出现 `a1` 时，runtime 没有任何字段能告诉 Skill 3 / Judge / Narrator："此学员对 `a1` 已经较熟"。也就是说，**支架升降档的依据只有"本挑战内的近期表现"，没有"跨挑战的累积熟练度"**。

### 2.6 学员端 UI 把所有输入都呈现为"一个外置的输入区"

[`app/learn/[id]/`](../app/learn/) 当前的 UI（[`8b83079 Redesign learner UI with bright workspace style`](../app/learn/) 之后的版本）是：narrator 旁白在主区，输入框在底部。无论 active 框架是 `free_text` 还是 `single_choice`，学员都看到一个"等我输入"的下方 UI，跟"读小说时偶尔点一下"的体感差很多。

---

## 3. 差距清单

把上面六条收敛成可执行的差距：

| # | 差距 | 现状 | 你的目标 |
|---|---|---|---|
| 3.1 | 缺失轻量交互原语 | 每次输入都触发 Judge 评分 | 存在"点一下，剧情前进"的 narrative_beat 路径，走轻量评分（写 evidence_log 但不计 grade） |
| 3.2 | 默认框架从最高难度起步 | 第一轮默认 free_text | 新核心动作首次出现时默认 narrative_choice |
| 3.3 | 升档逻辑缺失 | path_decision 只允许降档 | 应允许"学员达标，下一轮升档" |
| 3.4 | 跨挑战熟练度缺失 | 仅追踪当前挑战内的连续表现 | 维护 per-action 的累积熟练度 |
| 3.5 | Narrator 钩子形态单一 | 钩子默认是开放问句，预设学员要打字 | 增加"话题钩子"形态：narrator 把场景写到一个等待表态的瞬间，由下方候选选项承接学员立场 |
| 3.6 | UI 同一版式但输入区无变形态 | narrator + 底部文本输入区，无论 frame 类型如何 | UI 版式不变；输入区根据当前 frame 动态变形（按钮 / 表单 / 文本框） |
| 3.7 | 支架与设计意图脱钩 | 设计阶段只声明 frames，没有声明顺序与升档条件 | 设计阶段输出"动作支架阶梯"，明确每一档对应何种 frame、何种条件升档 |

---

## 4. 调整方案

按"概念 → 数据模型 → 设计期 → 运行期 → UI"的顺序展开。

### 4.1 引入概念：动作熟练度（action mastery）

在 `learner_state` 中新增字段 `action_mastery: Record<action_id, MasteryRecord>`，每条记录至少包含：

- `attempts`：此动作累积接受过的练习次数（包含轻量与重量）。
- `good_count` / `medium_count` / `poor_count`：按 grade 累积。
- `consecutive_good`：跨挑战的连续达标次数。
- `current_ladder_position`：在该动作的支架阶梯上的当前位置（0 = 最轻，2 = 最重）。
- `last_seen_at` / `last_challenge_id`：最近一次接触该动作的位置。

熟练度由 Judge 在每次涉及该 action 的有效练习后更新（narrative_beat 不更新熟练度）。

### 4.2 数据模型变更：`scaffold_ladder` 与 `narrative_beat`

#### 4.2.1 在 challenge 上增加 `scaffold_ladder`

```ts
interface ScaffoldLadderRung {
  position: number;                 // 0..N
  kind: "narrative_choice" | "form" | "free_text";
  frame_id: string;                 // 引用 challenge.response_frames 中的某个 frame
  narrative_purpose: string;        // 这一档的剧情功能（设计师写）
  gate_to_next:                     // 升档条件（运行时读）
    | { type: "after_n_correct"; n: number }
    | { type: "after_action_mastery_at_least"; threshold: number }
    | { type: "narrator_decision"; cue: string };
}

interface Challenge {
  ...
  scaffold_ladder?: ScaffoldLadderRung[];
  default_ladder_position: number;  // 通常为 0；高复杂度后期挑战可以从 1 或 2 起步
}
```

`scaffold_ladder` 是设计阶段的产物，描述本挑战中此动作的练习从何处开始、在何条件下升档。

#### 4.2.2 新的 frame 类型 `narrative_choice`

`narrative_choice` 是一种特殊的 single_choice：

- 每个 option 携带 `narrative_payoff`（学员选了之后剧情如何继续）与可选的 `cognitive_signal`（这个选择反映了学员认知的什么倾向）。
- 提交后**不走 Judge 评分通路**（或走一个轻量的"signal-only"评分通路），只走 narrator 的 narrative_beat 模式。
- 这是 §3.1 缺失的轻量原语。

```ts
interface NarrativeChoiceField {
  field_id: "choice";
  type: "radio";
  options: Array<{
    value: string;
    label: string;
    narrative_payoff: string;       // narrator 在此选择被点击后输出的故事段
    cognitive_signal?: {            // 可选；如果设了，runtime 会写入 evidence_log，但不计入 mastery
      action_id: string;
      tag: "ability_lean" | "willingness_lean" | "ambiguous";
    };
  }>;
}
```

### 4.3 Skill 3 Fill 的输出变更

Skill 3 Fill 必须输出每个 challenge 的 `scaffold_ladder`。规则：

- 在每个核心动作首次出现的挑战中，`scaffold_ladder` 必须从 `narrative_choice` 起步（至少 1 档），随后是 `form`，最终才是 `free_text`。
- 在某个核心动作已经在前置章节出现过且学员熟练度高的预期下（设计师可以读 chapter 的 arc_stage 与 binds_actions 历史推断），`scaffold_ladder` 可以从更高位起步，跳过 `narrative_choice`。
- 每档之间必须显式声明 `gate_to_next`，让 runtime 不需要猜测升档时机。
- `narrative_choice` 的每个 option 必须给出 `narrative_payoff`（不少于 30 字，让学员真的有"剧情继续"的体感）。

prompt 应当在示例 JSON 中给出三档完整的 ladder 样本：

```json
"scaffold_ladder": [
  {
    "position": 0,
    "kind": "narrative_choice",
    "frame_id": "rf_c1ch1_narrative",
    "narrative_purpose": "让学员先观察陈岚的两种可能反应，建立对'同一行为有多种解读'的初步意识",
    "gate_to_next": { "type": "after_n_correct", "n": 1 }
  },
  {
    "position": 1,
    "kind": "form",
    "frame_id": "rf_c1ch1_diagnosis_form",
    "narrative_purpose": "学员开始独立分别填写能力侧与意愿侧的具体证据",
    "gate_to_next": { "type": "after_action_mastery_at_least", "threshold": 1 }
  },
  {
    "position": 2,
    "kind": "free_text",
    "frame_id": "rf_c1ch1_free",
    "narrative_purpose": "学员独立写一段对陈岚状态的完整判断",
    "gate_to_next": null
  }
]
```

### 4.4 Judge 的 `path_decision` 增加两类升档动作

新增两个枚举值：

- `narrative_advance`：本轮学员只是点了 narrative_choice 的某个 option。Judge 走**轻量评分通路**：把 option 的 `cognitive_signal` 写入 `evidence_log`（带一个 `weight: "light"` 标记），但 `quality[]` 不打 grade，不下发 `narrator_directive`，不计入 `action_mastery` 的 good/medium/poor 计数。仅把 ladder 内部的"参与计数"推进 1 步。
- `escalate_frame`：学员在当前档位已满足 `gate_to_next` 条件，下一轮切换到 ladder 中下一档。

Judge prompt 需要新增字段：

```
## 当前动作支架阶梯
ScaffoldLadder（本挑战的支架阶梯）: {{scaffold_ladder}}
CurrentLadderPosition（学员当前所在档位）: {{current_ladder_position}}
ActionMastery（学员对当前动作的累积熟练度）: {{action_mastery_for_current_action}}
```

并新增硬规则：

- 若 `frame_in_use === "narrative_choice"` → `path_decision.type = "narrative_advance"`；写 evidence_log 的 `cognitive_signal` 字段；不打 grade；不下发 directive。
- 若 ladder 当前档位的 `gate_to_next` 条件已满足 → `path_decision.type = "escalate_frame"`，`next_response_frame` 设为下一档的 `frame_id`。

### 4.5 Narrator 增加 `narrative_beat` 模式（必须含话题钩子）

当 `path_decision.type === "narrative_advance"`，Narrator 进入 narrative_beat 模式。其格式：

- 长度 60-220 字。
- 必须直接承接学员所选 option 的 `narrative_payoff`，把它扩写为有人物、有动作、有时间地点的场景叙述。
- **末句不允许是开放问句**（不写"你打算怎么开口跟她说？""哪一类用户会受到影响？"）。
- **末句必须是话题钩子**：把场景写到一个**等待学员表态的瞬间**。允许的钩子形态包括：
    - **未完成的对话**：写出对方刚说完的一句话或一个沉默，让学员有立场可选。例："林涛把手从鼠标上拿开，目光转向你：'下月 15 号你怎么看？'"
    - **可被解读的具体细节**：把一个动作或物件摆在学员面前，让学员从下面的选项中选解读。例："陈岚合上笔记本时，手指在封面上停了一秒。"
    - **一个待表态的瞬间**：写到对方等学员的一句话，但不写学员的反应。例："会议室安静下来。所有人在等你的判断。"
- narrative_beat 必须**与下方的 narrative_choice 选项配套**：narrator 段落收尾的话题钩子，应当让下方的 2-3 个 option label 读起来像"对这个钩子的不同立场"，而不是凭空冒出的题目选项。
- 段末**不附挂提示语**（不写"请选择"或"点击下方任一选项"）。学员看到下方的按钮就知道该选。

当 `path_decision.type === "escalate_frame"`，Narrator 在 60-140 字范围内做"交接式过渡"：先收束当前小段剧情，再用一句把"现在你来写"的方向盘交给学员。这一段是**学员从轻量参与转向主动表达的明确信号**，对应"系统认为学员已经具备独立做出该动作的能力"。该段允许以开放问句收尾——这是从话题钩子向问句钩子的正式切换。

### 4.6 State Manager 与 runtime

- 在 `runTurn` 入口处先读 `learner_state.action_mastery[a]` 与当前 challenge 的 `scaffold_ladder`，决定本轮的 `frame_in_use`。
- 当本轮 `frame_in_use.kind === "narrative_choice"`，仍调 Judge 走 `narrative_advance` 路径（轻量评分），调 Narrator 的 narrative_beat 模式，把 ladder 内部的"已答次数"加 1。
- 当 ladder 的 `gate_to_next` 条件被满足，下一轮的 `frame_in_use` 切换到下一档；narrator 输出"交接式过渡"段。
- 学员每次完成一次"重量级"练习（form 或 free_text），Judge 评分后更新 `action_mastery` 的 good/medium/poor 计数与 `consecutive_good`。

### 4.7 学员端 UI（统一版式，输入区按 frame 变形态）

**只有一套版式**：Narrator 旁白在主区按对话流呈现，输入区在底部固定，与目前的练习模式 UI 完全相同。区别仅在于**底部输入区会根据当前 frame 改变形态**：

- `narrative_choice`：底部呈现 2-3 个选项按钮（按钮文案即 option.label），文本输入框隐藏。可选地在按钮组旁边加一个轻量的"我有话想直接说"入口（见 §6.4），点击即把输入区切换为 free_text 形态。
- `form`：底部呈现结构化字段（label + 表单控件），按当前实现。
- `free_text`：底部呈现文本框，按当前实现。

整个学员旅程视觉上是**一条不变的对话流**：narrator 旁白一段、学员的响应一段（按钮的选择会回显为一个学员气泡，例如"你说：先听对方说完"）、narrator 再来一段。学员不需要适应"模式切换"，frame 形态变化只表现为底部输入区的控件变化，其他视觉元素（顶部进度、招式集入口、伴学头像、艺术氛围）一律不变。

frame 形态变化时**不做明显的视觉过渡动效**（不淡入新卡片、不切换布局）。底部输入区的控件可以做一个 200ms 内的淡入淡出，避免突兀；narrator 旁白的呈现完全不变。

### 4.8 Skill 1 / Skill 4 / Skill 5 的辐射影响

- **Skill 1（gamecore）**：每个 core_action 在产出时可声明 `mastery_thresholds`（例如"达到累积 2 次 good 即视为基本掌握"），让 ladder 的 `gate_to_next` 有明确依据。
- **Skill 4（companion）**：companion 的 hooks 可以分别针对 narrative_choice 路径与 form / free_text 路径下发不同的 directive。例如新人引导型伴学在 narrative_choice 阶段更适合发声做"剧情陪伴"。
- **Skill 5（points）**：narrative_choice 不计分（或仅计极小的"参与分"），form 与 free_text 才进入主积分通路，避免学员通过点点点刷分。

---

## 5. 分阶段实施建议

不建议一次性铺开。按以下顺序，每个阶段可独立验证、可独立回滚。

### 阶段 1：数据模型 + 设计阶段产出（1-2 天）

- 在 [`lib/types/core.ts`](../lib/types/core.ts) 增加 `ScaffoldLadderRung`、`NarrativeChoiceField` 类型。
- 修改 Skill 3 Fill prompt，要求输出 `scaffold_ladder` 与 `narrative_choice` 类型的 frames。
- 不改动 runtime；仅验证 Skill 3 输出符合新 schema。
- 写最小单测覆盖 normalize 路径。

### 阶段 2：State Manager 与熟练度（1 天）

- 在 `learner_state` 中加 `action_mastery`。
- Judge 评分后更新 `action_mastery`。
- Runtime 暴露 `current_ladder_position`、`frame_in_use` 给上下文，但 UI 与 Judge prompt 暂不消费。

### 阶段 3：narrative_beat 路径（2-3 天）

- runTurn 检测 `frame_in_use.kind === "narrative_choice"` 时跳过 Judge，调 Narrator 的新 narrative_beat 模式。
- 新增 narrative_beat 模式的 narrator prompt 段落（输入是当前 option.narrative_payoff，要求输出无提问的剧情推进）。
- UI 增加故事模式渲染：narrator 旁白下方内嵌按钮。

### 阶段 4：升降档逻辑（1-2 天）

- Judge 接受 `scaffold_ladder / current_ladder_position / action_mastery` 作为输入。
- Judge 在评分后输出 `path_decision.type = "escalate_frame"` 时，runtime 切换到下一档。
- Narrator 加"交接过渡"模式。

### 阶段 5：旧数据兼容与回归（1 天）

- 已存在的 blueprint（无 `scaffold_ladder` 字段）走兼容分支：默认用现有 default_response_frame_id，不进入故事模式。
- 写一个数据迁移开关：管理员可以选择对老 blueprint 触发"重跑 Skill 3 Fill 以补 ladder"。

---

## 6. 取舍与已知风险

### 6.1 narrative_choice 的"剧情分叉"问题

如果 narrative_choice 的两个 option 各自走完全不同的剧情线，Skill 3 Fill 的复杂度会剧增（需要为每条分支写后续 setup）。**实际可行的简化**：narrative_choice 是"剧情态度选择"，不是"剧情分支跳转"——选 A 与选 B 之后，剧情主线不变，只是 narrator 会在下一个 narrative_beat 里反映学员的态度。这个约束应当写入 Skill 3 Fill 的 prompt。

### 6.2 学员可能"乱点按钮通关"

为了防止刷过场，在以下条件下不允许只用 narrative_choice 通过挑战：

- ladder 必须至少包含一档非 narrative_choice 的 frame。
- `gate_to_next` 不能只看"点击次数"，必须看"在 cognitive_signal 上展示了某种正确倾向"——这要求 Judge 在 narrative_choice 路径下保留对 evidence 的写入（即"轻量评估"）。

### 6.3 跨挑战熟练度的冷启动

第一次见到某个动作 a1 时，`action_mastery[a1].attempts === 0`。此时 ladder 的 `default_ladder_position` 应当固定为 0。当某动作首次出现的挑战在 c3 而不是 c1（取决于 Skill 3 Skeleton 的设计），应当有一段引导剧情把上下文补齐，避免学员被突然抛进 narrative_choice 而不知道剧情背景。

### 6.4 体验的"不可预测"与"用户控制感"的张力

你提出"学员不应能预测自己什么时候需要手动输入"——这是体验设计的重点，但也带来一个风险：当学员对当前内容已经很熟、希望更主动地表达时，被困在 narrative_choice 模式会让人挫败。**对策**：每个 narrative_choice frame 默认带一个第三选项"我有话想直接说"，点击后会把当前 narrative_beat 切到对应的 free_text frame。这个第三选项是学员的"快进键"，不破坏沉浸感前提下尊重个体差异。

### 6.5 frame 形态切换的节奏

UI 版式不变，但底部输入区的形态会变（按钮 → 表单 → 文本框）。如果在一个挑战里频繁切换形态（一会儿按钮、一会儿表单、一会儿又按钮），学员手指与认知都跟不上。**约束**：Skill 3 Fill 的 prompt 应当要求每个挑战内的 narrative_choice 至少连续出现 2-3 轮再升档到 form，且 form 至少出现 1 轮再升档到 free_text；不允许同一挑战内同一档位反复出现两次以上。

---

## 7. 不在本次范围内的事项

以下是相关但本次不动的部分：

- **现有 8 种 scaffold strategy**（worked_example / contrastive_cases / chunked_walkthrough 等）：那是"学员卡住时的反应式支架"，与本次的"前置渐进式支架"是两条不同的轴。两者将共存。本次只设计前置阶梯。
- **跨课程（跨 blueprint）的迁移**：本次的 mastery 局限于当前 blueprint 内。课程间的迁移（学员从课 A 带着对 a1 的熟练度进入课 B）涉及账号级的画像，不在本次。
- **多语言**：narrative_choice 的 option label 与 narrative_payoff 仍假设中文输出，未触及 i18n。

---

## 8. 已固化的设计决定

以下四项已确认，纳入实现规范：

1. **narrative_choice 走轻量评分通路**：Judge 在 `path_decision.type === "narrative_advance"` 路径下，把 option 的 `cognitive_signal` 写入 `evidence_log`（标记 `weight: "light"`），但不打 grade、不下发 directive、不计入 `action_mastery` 的 good/medium/poor 计数。这样既保留行为数据用于后续分析，也避免学员凭点击刷分。
2. **ladder 最小档数为 3**：每个核心动作首次出现的挑战必须至少包含 narrative_choice → form → free_text 三档；中间不允许跳。已经在前置章节出现过的核心动作可以从更高位起步（即跳过 narrative_choice 或 form），但同一动作首次接触时必须走完整三档。
3. **narrative_choice 选项数量上限 2-3 个**：每个 narrative_choice frame 必须给出 2 个或 3 个 option。超过 3 个会失去"小说式立场选择"的体感、变成隐形表单。Skill 3 Fill 的 prompt 应在 schema 中限定 `options.length ∈ [2, 3]`。
4. **保留学员的"我有话想直接说"快进键**：每个 narrative_choice frame 在底部按钮组旁默认提供一个低强调度的入口（例如灰阶小字），学员点击即把当前 frame 切换为对应的 free_text 形态。该入口不重置 ladder 位置，仅为本轮提供一次自由输入的窗口；下一轮仍按 ladder 推进。这是对系统决定权的小让步，尊重高能学员的主动性。

接下来进入实现，按 §5 的五个阶段顺序展开。
