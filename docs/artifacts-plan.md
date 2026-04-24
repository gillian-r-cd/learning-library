# 道具（Artifacts）系统 · 实施 Plan

> 背景：当前学员看到的场景只有 Narrator 的文字描述。像"周报"这种关键信息载体，学员无法"翻阅"，只能脑补。这导致对话进行到中段，学员常被迫问"我怎么知道周报里有什么"、"小陈是谁"，Narrator 再被迫补救。
>
> 目标：把场景里的"东西"变成可观察、可翻阅、可回放的**结构化物件**（道具），在设计阶段随剧本一并产出，在运行时按规则**丝滑掉落**到对话流，并落入独立的"道具箱"。

---

## 1 · 用户故事（与本设计的六点确认对齐）

| 确认点 | 决定 |
| --- | --- |
| A · 挂载层级 | **挑战级**（`challenge.artifacts[]`）。道具箱是学员端独立入口（点按钮看全量） |
| B · 是否独立 Skill | **不独立**。嵌入 Skill 3（剧本 fill 阶段一并产出） |
| C · 类型库 | **6 个通用抽象类型**（见第 3 节），覆盖绝大多数场景；生产道具时 type + content 双要求 |
| D · UI 呈现 | **聊天流气泡 + 右栏道具箱**双通道 |
| E · 版本化 | **支持**。同一 artifact_id 可多版本，UI 可展示前后对比 |
| F · 老数据 | **不迁移**。老 blueprint / learner 无感降级（无道具字段就不渲染） |

**用户故事（学员视角）**

1. 进入挑战第一瞬间：场景里提到的关键物件（如"桌上那份周报"）以**道具气泡**直接出现在对话流里，我能展开细看。
2. 对话中我开口问"这是什么 / 他是谁"时：Narrator 先答 + 道具气泡**丝滑掉落**。
3. 整个挑战我都能点右上角「🎒 道具箱」按钮查看已获得的所有道具，并翻看历史版本。
4. 当一个道具被"更新"（例：小陈第二天补齐了周报），我会看到**同一个道具出现新版本**，可一键对比前后差异。

---

## 2 · 核心机制设计

### 2.1 道具的元数据

每个道具包含以下字段：

```ts
interface Artifact {
  artifact_id: string;           // blueprint 内唯一（跨 challenge/chapter 引用用）
  name: string;                  // "小陈的周报草稿"
  icon_hint?: string;            // 一个 emoji 或类别（optional，前端可根据 type 选默认）
  type: ArtifactType;            // 6 种之一
  content: ArtifactContent;      // type-specific payload（见下）
  trigger: ArtifactTrigger;      // 掉落时机
  trigger_hint?: string;         // 'on_learner_request' / 'on_judge_scaffold' 时的匹配说明
  version: number;               // 默认 1。同一 artifact_id 的新版本 ≥ 2
  supersedes?: string | null;    // 该版本替代的前一版 artifact_id（即自身，表达版本链）
  narrator_intro?: string;       // 可选：掉落时 Narrator 说的那句话（剧本作者可预设，否则由 Narrator 自然生成）
}

type ArtifactTrigger =
  | "on_challenge_enter"         // 挑战开场自动掉
  | "on_learner_request"         // 学员请求后掉（Judge 检测）
  | "on_judge_scaffold";         // Judge 诊断学员卡壳因缺信息时掉

type ArtifactType =
  | "narrative"
  | "fields"
  | "series"
  | "list"
  | "table"
  | "hierarchy";
```

### 2.2 触发器三条路径

| trigger | 时机 | 谁决定 |
| --- | --- | --- |
| `on_challenge_enter` | 学员进入此挑战（`createLearnerState` 或过渡仪式结束时） | State Manager 自动触发 |
| `on_learner_request` | 学员输入里出现明确询问信号 | Judge 判断 + 输出 `event_triggers: DROP_ARTIFACT` |
| `on_judge_scaffold` | Judge 判决 scaffold 且 scaffold_spec 认为补信息能救 | Judge 输出 `event_triggers: DROP_ARTIFACT` |

### 2.3 版本化机制

- `artifact_id` + `version` 组合唯一。MVP 里 version 在**运行时动态创建**的场景极少（剧本基本静态），所以：
  - Blueprint 定义的是 v1
  - 若剧本设计者预设了"第二日周报补齐"，在 Skill 3 产出的 artifacts 数组里直接有 v2、v3 等，每个版本是独立条目，`supersedes` 指向前一版本的 artifact_id
- 运行时：同一 artifact_id 的新版本掉落时，在 conversation_log 里写一条 `role: "artifact"` 带 `meta.version` 的新条目；UI 道具箱按 artifact_id 分组，可切换版本，可开启 v(n) vs v(n-1) 的并排 diff 视图

---

## 3 · 道具类型库（6 种通用抽象）

**设计原则**：这 6 种是按**信息的结构维度**抽象的，不绑定业务场景。任何领域的可观察物件都能映射到其中之一：

| type | 信息结构 | 典型载体 | 不适合 |
| --- | --- | --- | --- |
| `narrative` | 一段连贯文本 + 头部元信息 | 邮件、信件、备忘录、日记、博客、报告节选、短信、便条 | 有结构化字段的 |
| `fields` | 键值对集合（可带标签） | 档案卡、简历、病历、产品规格、表单、登记册 | 多行同结构数据 |
| `series` | 按时间/顺序的条目序列 | 对话记录、时间线、事件日志、变更历史、日程 | 无序或需二维展示的 |
| `list` | 并列条目（可带状态） | 任务清单、检查表、采购清单、待办、选项 | 有明确时间顺序的 |
| `table` | 行列二维数据 | KPI 报表、工资单、出勤表、对比矩阵、得分卡 | 非结构化文本 |
| `hierarchy` | 父子嵌套树 | 组织架构、目录、大纲、思维导图、分类体系、决策树 | 平级信息 |

### 3.1 每种 type 的 content schema

#### `narrative`

```ts
{
  type: "narrative",
  content: {
    header?: {                   // 邮件头 / 信件头
      from?: string;             // 发件人/作者
      to?: string;               // 收件人
      date?: string;             // 时间
      subject?: string;          // 主题/标题
    };
    body: string;                // 正文。支持 \n\n 分段
    footer?: string;             // 脚注（手写签名、发送时间等元信息）
    annotations?: Array<{        // 文内标注（可选）
      span: [number, number];    // body 中的起止下标
      note: string;              // 注释
    }>;
  }
}
```

示例：邮件、信件、辞职信

#### `fields`

```ts
{
  type: "fields",
  content: {
    title?: string;              // "员工档案 · 小陈"
    sections?: Array<{           // 分组展示（可选，无分组则直接平铺 fields）
      heading: string;
      fields: Array<FieldEntry>;
    }>;
    fields?: Array<FieldEntry>;  // 扁平模式
  }
}

interface FieldEntry {
  key: string;                   // "姓名"
  value: string;                 // "陈雨"
  status?: "filled" | "empty" | "warning" | "highlight";  // 视觉状态
  note?: string;                 // 附注
}
```

示例：员工档案、产品规格、登记表

#### `series`

```ts
{
  type: "series",
  content: {
    title?: string;
    ordering?: "time_asc" | "time_desc" | "manual";
    entries: Array<{
      id?: string;
      timestamp?: string;        // "2026-04-22 14:30" 或 "W27 周一"
      actor?: string;            // "小陈" / "你"
      text: string;
      tag?: string;              // 可选分类
      status?: "default" | "highlight" | "muted";
    }>;
  }
}
```

示例：对话记录、事件时间线、日志

#### `list`

```ts
{
  type: "list",
  content: {
    title?: string;
    mode: "checklist" | "bullet" | "numbered";
    items: Array<{
      text: string;
      checked?: boolean;         // checklist 模式
      status?: "default" | "warning" | "done" | "empty";
      sub_items?: string[];      // 最多一级子项
    }>;
  }
}
```

示例：任务清单、检查表、菜单

#### `table`

```ts
{
  type: "table",
  content: {
    title?: string;
    columns: Array<{ key: string; label: string; align?: "left" | "right" | "center" }>;
    rows: Array<Record<string, string | number>>;   // key 对齐 columns
    row_notes?: Array<{ row_index: number; note: string }>;
    highlight?: Array<{ row: number; col: string }>;
  }
}
```

示例：KPI 数据、出勤表、对比表

#### `hierarchy`

```ts
{
  type: "hierarchy",
  content: {
    title?: string;
    root: HierarchyNode;
  }
}

interface HierarchyNode {
  label: string;
  meta?: string;                 // 副标题/属性
  status?: "default" | "highlight" | "muted";
  children?: HierarchyNode[];
}
```

示例：组织架构、目录、决策树

### 3.2 Skill 3 输出约束

Skill 3 fill 生成 challenge 时：
- 每个挑战应 0-3 个 artifacts（太多会淹没学员）
- `trigger: "on_challenge_enter"` 的 artifact 至多 1 个（避免开场信息过载）
- 每个 artifact 必须 type + content 齐整且 content 符合对应 schema
- 如果场景需要"版本演化"，可在同一 challenge（或跨 challenge）定义多个 version，用 `supersedes` 串链

### 3.3 Normalizer 兜底

Claude 实际输出可能不合 schema。运行时 normalizer 做：
- content 与 type 不一致 → 回落成 `narrative` 把 content 字符串化
- 缺 artifact_id → 生成 `art_{challenge_id}_{idx}`
- 缺 version → 默认 1
- trigger 非枚举值 → 默认 `on_challenge_enter`
- fields/series/list/table/hierarchy 的核心数组缺失或不是数组 → 空数组兜底

---

## 4 · 数据模型变更

### 4.1 TypeScript 类型 (`lib/types/core.ts`)

新增：
- `Artifact`, `ArtifactType`, `ArtifactTrigger`, `ArtifactContent`（6 种）
- `Challenge` 加 `artifacts?: Artifact[]`
- `ConversationRole` 加 `"artifact"`
- `ConversationEntry.meta.artifact`（运行时记录掉落快照的字段约定）

### 4.2 conversation_log 表

**不需新增表**。artifact 掉落复用现有 conversation_log：
- `role = "artifact"`
- `who = artifact.name`
- `text = artifact.name + 短描述`（纯文本 fallback，便于历史滚动阅读）
- `meta_json = { kind: "artifact_drop", artifact_id, version, type, content, trigger, supersedes? }`

### 4.3 Blueprint 存储

`Blueprint.step3_script.chapters[].challenges[].artifacts` 通过现有 JSON 序列化即可，不改表结构。

---

## 5 · 剧本生成（Skill 3）变更

### 5.1 skill_3_script_fill.template 升级

Prompt 改动：
1. 在 hard rule 段增加：
   - "每个挑战可定义 0-3 个 artifacts，必须是 ArtifactType 六种之一"
   - "type 与 content 必须严格对应 schema"
   - "on_challenge_enter 类型至多 1 个"
   - "场景里提到的关键物件（周报、简历、邮件、清单、报表、组织图）必须通过 artifact 呈现"
2. 输出示例包含 1 个完整的 artifact（选 fields 类型演示周报），并在旁边给 6 种 type 的短摘要示例

### 5.2 Skill 3 后处理

`runSkill3Fill` 产出后运行新函数 `normalizeArtifacts(challenge)`：
- 为每个 artifact 走 type-specific schema 校验与兜底
- 缺 ids 自动补

### 5.3 StepPanel UI（设计阶段）

`app/design/[id]/StepPanel.tsx` 的 Step3 面板里，每个 challenge 新增 `artifacts` 展示块（简要：每个道具的 name + type + trigger + 版本号），让设计师能审校。

---

## 6 · 运行时变更

### 6.1 State Manager

新增：
- `listDroppedArtifacts(learner_id): DroppedArtifact[]` — 读 conversation_log 里所有 role=artifact 的条目，按 artifact_id 分组，返回每个 id 的所有版本
- `dropArtifact(learner_id, challenge_id, artifact, triggerSource, traceId)` — 写 conversation_log 一条
- 辅助：`isArtifactAlreadyDropped(learner_id, artifact_id, version): boolean`（幂等）

### 6.2 createLearnerState

当前写 4 段 opening；**在第 4 段 challenge_opening 之后**自动掉落第一个挑战的 `on_challenge_enter` 类型的 artifacts（按定义顺序）。

### 6.3 runTurn 过渡仪式

当前流程：narrator 收束 → system milestone → narrator 新挑战 opening。  
**扩展**：在"新挑战 opening" 之后立刻掉落新挑战的 `on_challenge_enter` 类型 artifacts。

### 6.4 Judge prompt 扩展

Judge 接收新变量：
- `available_artifacts`：学员当前挑战已看到的道具**轻量摘要**（id / name / type / version / **内容要点摘要**，而非完整 content）
- `pending_artifacts`：当前挑战已定义但尚未掉落的道具（仅 id / name / type / trigger_hint），给 Judge 判断何时掉落

Judge 的 system prompt 加规则：
- 如果学员输入表达出缺某类信息的困惑，且存在一个 `pending_artifacts` 的 trigger_hint 能对应，`event_triggers` 中追加 `{type: "DROP_ARTIFACT", payload: {artifact_id}}`
- 如果 path_decision = scaffold 且学员的困惑本质是"我不知道 X 的细节"，优先走 DROP_ARTIFACT 而不是纯文字 scaffold

### 6.5 Judge normalizer 扩展

`normalizeJudgeOutput` 现有的 `event_triggers` 扩展：
- 保留现有 `AWARD_POINTS` / `UNLOCK_CHECK` 等
- 新增合法事件类型 `DROP_ARTIFACT`，payload 校验 `{ artifact_id: string }`
- 不合法的事件条目丢弃而不报错

### 6.6 runTurn 的事件处理

Judge 判定后，处理 `event_triggers` 数组：
- `DROP_ARTIFACT` → 查当前 challenge 的 artifacts，找 artifact_id 匹配且未掉落的最新版本 → 掉落
- 若匹配到但已掉落（含旧版本），且 blueprint 有新版本（`supersedes` 链）→ 掉落新版本
- 若未匹配到任何 artifact → 忽略（不崩）

---

## 7 · UI 变更

### 7.1 新增：Artifact 渲染器组件

`app/learn/[id]/artifacts/` 目录：
- `ArtifactBubble.tsx` — 聊天流中的道具气泡（折叠卡片 + 点击展开 modal）
- `ArtifactModal.tsx` — 全屏查看 + 版本切换 + 差异对比
- `ArtifactInbox.tsx` — 右栏/顶栏入口的道具箱面板（按 artifact_id 分组、显示版本数）
- `renderers/` 六个 type-specific 渲染组件：
  - `NarrativeRenderer.tsx`
  - `FieldsRenderer.tsx`
  - `SeriesRenderer.tsx`
  - `ListRenderer.tsx`
  - `TableRenderer.tsx`
  - `HierarchyRenderer.tsx`

### 7.2 LearnerSession.tsx 改动

- `MsgBubble` 识别 `role === "artifact"`，使用 ArtifactBubble 渲染
- 顶栏增加按钮：`🎒 道具箱 · N 件`（点击打开 ArtifactInbox 抽屉）
- 道具箱：按 artifact_id 分组，每组显示 name + type icon + version 数；点击展开看具体版本 + diff

### 7.3 版本对比视图

`ArtifactModal` 内的版本切换：
- 下拉选当前版本（默认最新）
- "对比上一版" 按钮 → 进入 side-by-side 或字段级高亮差异视图
- 差异策略按 type：
  - `narrative` — 文本 diff（段落级别）
  - `fields` — 字段级别变化标注（新增/修改/删除）
  - `series` — 新增/变更的条目高亮
  - `list` — 状态变化 / 新增删除
  - `table` — 单元格级别变化
  - `hierarchy` — 节点级变化

MVP 先实现 `narrative`, `fields`, `list` 三类的 diff；其他类先显示"v1 和 v2 并排"不做字段级 diff。

### 7.4 设计阶段 UI

`app/design/[id]/StepPanel.tsx` 的 Step3 展开 challenge 细节时：
- 显示 artifacts 列表（name / type / trigger / version / content 预览前 60 字）
- 不做编辑器（MVP：依赖 Skill 3 生成质量，不支持人工编辑 artifacts）

---

## 8 · API 变更

### 8.1 `/api/learning/learners/[id]` GET

响应里新增：
- `dropped_artifacts: DroppedArtifact[]` — 当前 learner 所有已掉落的道具（按 artifact_id 分组 + 所有版本）

### 8.2 `/api/learning/turn` POST 响应

新增：
- `droppedArtifacts: Array<{ artifact_id, version, name, type }>` — 本轮掉落的道具清单，UI 知道要追加渲染哪几个气泡

### 8.3 不需要新的独立端点

"道具箱"数据从 `/api/learning/learners/[id]` 的 `dropped_artifacts` 直接得到；不单独开端点。

---

## 9 · 类型安全边界

- Artifact 相关类型全部在 `lib/types/core.ts` 集中定义
- Content 字段使用 discriminated union 以 `type` 为区分器
- normalizer 位于 `lib/skills/artifacts-normalizer.ts`，对 Skill 3 输出做兜底
- drop 事件处理位于 `lib/learning-runtime/artifact-drop.ts`

---

## 10 · 测试计划

### 10.1 单元测试

`tests/unit/artifacts-normalizer.test.ts`
- 六种 type 的 content 校验
- type 与 content 不匹配时回落 narrative
- 缺 artifact_id 自动补
- trigger 非法值 → on_challenge_enter

`tests/unit/artifact-drop.test.ts`
- createLearnerState 自动掉落 on_challenge_enter
- runTurn 跨挑战时在 opening 后掉落新挑战的 on_challenge_enter
- 重复 DROP_ARTIFACT 事件幂等（不重复掉）
- 同一 artifact_id 的新 version 掉落会新增一条 conversation_log

`tests/unit/artifact-versioning.test.ts`
- listDroppedArtifacts 按 artifact_id 分组、version 降序
- `supersedes` 链构建正确

### 10.2 E2E（Playwright）

`tests/e2e/04-artifacts.spec.ts`

**测试场景 A · 首轮挑战掉落道具**
- 创建 blueprint（mock LLM 的 skill_3 fill 产出带 artifacts 的剧本）
- 启动 learner
- 验证聊天流里出现 artifact 气泡（`data-test-id="msg-artifact"`）
- 验证右上角道具箱按钮显示 "🎒 1 件"
- 点击气泡 → 弹出 ArtifactModal → 验证 content 正确渲染

**测试场景 B · 道具箱面板**
- 点击 "🎒 道具箱" 按钮
- 验证面板展开，所有已掉落道具可见
- 点击某个道具 → 打开 Modal

**测试场景 C · 学员询问触发 on_learner_request**
- 挑战中，学员发送 "小陈是谁？"（mock Judge 返回 DROP_ARTIFACT 事件）
- 验证聊天流追加一条 artifact 气泡
- 验证道具箱数量 +1

**测试场景 D · 版本升级**
- mock 一个挑战含 v1 和 v2 的同 artifact_id
- 学员行动触发 v2 掉落
- 验证道具箱显示 "v1, v2" 两个版本
- 进入 Modal，切换版本能看到两版不同的内容
- 进入 "对比上一版" → 验证差异标注可见

**测试场景 E · 老 blueprint 无感降级**
- 创建一个没有 artifacts 的老式 blueprint（不带 artifacts 字段）
- 启动 learner → 不应崩溃
- 验证聊天流正常，道具箱按钮显示 "🎒 0 件" 或隐藏

### 10.3 视觉/回归

- 保留现有 57 个单元 + 9 个 E2E 全部继续通过
- 新增约 12-15 个单元 + 4-5 个 E2E
- 用 Playwright 跑**mock 模式**全绿后，**真实 LLM** 下做 1 次端到端 smoke（创建 blueprint → 学员走 3 轮），人工确认：
  - 挑战开场道具是否自然掉落
  - 点进道具箱是否能打开看到
  - Narrator 的文字是否正确引用道具名

---

## 11 · 执行顺序（严格按此 checklist）

### 阶段 1 · 类型与数据层
- [ ] 1. 更新 `lib/types/core.ts` 加 Artifact 类型族
- [ ] 2. 更新 `ConversationRole` 和 `ConversationEntry.meta`
- [ ] 3. 写 `lib/skills/artifacts-normalizer.ts`
- [ ] 4. 单元测试 artifacts-normalizer

### 阶段 2 · 剧本生成
- [ ] 5. 升级 `lib/prompt-store/seed.ts` 的 skill_3_script_fill.template（含 6 种 type 的 schema 说明 + 1 个完整示例）
- [ ] 6. 在 `runSkill3Fill` 后调用 normalizer
- [ ] 7. `app/design/[id]/StepPanel.tsx` Step3 加 artifacts 展示

### 阶段 3 · 运行时
- [ ] 8. `lib/state-manager/conversation.ts` 加 `dropArtifact` / `listDroppedArtifacts`
- [ ] 9. `lib/learning-runtime/artifact-drop.ts` 封装掉落逻辑（幂等、版本处理）
- [ ] 10. `createLearnerState` 开场后自动掉落 on_challenge_enter
- [ ] 11. `runTurn` 跨挑战仪式末尾掉落 on_challenge_enter；处理 event_triggers 里的 DROP_ARTIFACT

### 阶段 4 · Judge 感知
- [ ] 12. `lib/judge/index.ts` 在 variables 里加 `available_artifacts` / `pending_artifacts`
- [ ] 13. `judge.template` 加掉落规则段
- [ ] 14. `normalizeJudgeOutput` 接受 DROP_ARTIFACT event
- [ ] 15. 单元测试 event 处理

### 阶段 5 · UI
- [ ] 16. 写 6 个 renderers
- [ ] 17. `ArtifactBubble` + `ArtifactModal`
- [ ] 18. `ArtifactInbox` 道具箱面板
- [ ] 19. `LearnerSession.tsx` 接入（顶栏按钮 + MsgBubble 识别 artifact role）
- [ ] 20. 版本 diff（先做 narrative/fields/list 三类）
- [ ] 21. API 响应加 `dropped_artifacts` / `droppedArtifacts`

### 阶段 6 · 测试
- [ ] 22. 写 4-5 个 E2E
- [ ] 23. 跑 `npm run test:unit`，全绿
- [ ] 24. 跑 `npm run test:e2e`，全绿
- [ ] 25. 启 dev server 用真实 LLM 跑一遍，截图目视校验
- [ ] 26. 把 dev server 留给用户测试

完成全部 26 步 + 测试全绿后才回报。
