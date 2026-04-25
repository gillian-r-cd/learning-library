# 学员端结构化回复框架设计
## 1. 背景
当前学员端的输入协议很简单：`LearnerSession` 只提交一段自然语言字符串，`/api/learning/turn` 将它作为 `input` 传给 `runTurn`，运行时再把 `learnerInput` 交给 `Judge`、`Narrator` 和后续状态更新。
这让系统实现简单，但也带来一个学习体验问题：很多 Narrator 发出的任务，本质上需要学员填写一个结构化答案，例如选择一个判断、补齐一张诊断表、按优先级排序、给多个对象分别打标签。现在这些都只能被迫用自然语言表达，导致：
- 学员不知道“应该按什么结构回答”。
- Judge 需要从散文里反解析结构，评估不稳定。
- UI 无法针对任务类型提供更低认知负荷的输入体验。
本设计目标是引入一个通用的、Schema 驱动的“回复框架”机制，让大模型只需要输出结构化数据，前端用固定渲染器显示，不需要临时生成 UI。
## 2. 设计目标
1. 回复框架必须通用：同一套协议能表达自然语言、单选、多选、表单、排序、矩阵、分配等常见学习输入。
2. 回复框架必须 Schema 化：LLM 输出的是 JSON 数据结构，不输出 JSX、HTML 或临时 UI 描述。
3. 自然语言回复必须是内建框架之一，而不是旧机制之外的例外。
4. 结构化提交后，运行时必须能转成 Judge 可理解的输入，同时保留原始结构化答案用于审计和后续分析。
5. 设计期和运行期都能参与：Blueprint 提供稳定候选框架，Judge/Narrator 在运行时选择当前应启用哪个框架。
## 3. 推荐方案：Blueprint 候选框架 + 运行时激活
推荐采用混合方案：
- 设计期：Skill 3 在每个 challenge 下生成 `response_frames` 候选列表，描述这个挑战可能需要的输入框架。
- 运行期：Judge 或 Narrator 根据当前 `path_decision`、脚手架策略、已掉落道具和学员表现，选择下一轮应激活的 `frame_id`。
- 前端：只渲染当前 `active_response_frame`，不解释自然语言生成 UI。
- 提交：前端提交 `{ frame_id, response }`，服务端同时生成一段 canonical text 兼容现有 Judge 管道。
不推荐完全由 Narrator 临时生成 UI Schema，因为这样会让学员端每轮都面对模型新造的输入结构，前端校验与测试成本高。也不推荐完全设计期固定，因为学习过程中 Judge 已经知道学员是否卡住、是否需要 scaffold，应该能切换到更低负荷的输入框架。
## 4. 核心概念
### 4.1 Response Frame
`ResponseFrame` 是一个可渲染、可校验、可提交的输入框架定义。它不是 UI 代码，而是一份稳定 JSON Schema。
```ts
type ResponseFrameKind =
  | "free_text"
  | "single_choice"
  | "multi_choice"
  | "form"
  | "ranking"
  | "matrix"
  | "allocation"
  | "compound";
interface ResponseFrame {
  frame_id: string;
  version: number;
  kind: ResponseFrameKind;
  title: string;
  prompt: string;
  helper_text?: string;
  submit_label?: string;
  binds_actions: string[];
  expected_evidence_keys?: string[];
  fields: ResponseField[];
  validation?: ResponseValidation;
  fallback_frame_id?: string;
}
```

### 4.2 Response Field
`ResponseField` 是框架中的最小输入单元。不同 `field.type` 映射到前端固定控件。
```ts
type ResponseFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "radio"
  | "checkboxes"
  | "chips"
  | "rank_order"
  | "likert"
  | "matrix_cell";
interface ResponseField {
  field_id: string;
  type: ResponseFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  help_text?: string;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  validation?: {
    min_length?: number;
    max_length?: number;
    min_items?: number;
    max_items?: number;
  };
  maps_to?: {
    action_id?: string;
    dim_id?: string;
    evidence_key?: string;
  };
}
```
### 4.3 Learner Response
学员提交的数据也必须结构化保存。
```ts
interface LearnerStructuredResponse {
  frame_id: string;
  frame_version: number;
  kind: ResponseFrameKind;
  values: Record<string, unknown>;
  canonical_text: string;
}
```
`canonical_text` 是服务端根据框架和填写值生成的标准文本，供现有 Judge prompt 继续使用。例如：
```text
学员使用结构化框架「准备度诊断表」作答：
- 对象：陈悦
- 能力判断：中
- 意愿判断：低
- 关键证据：她能说出流程，但主动回避排期承诺
- 下一步动作：先做任务拆分，再约定检查点
```
这样可以在不一次性重写 Judge 的情况下，让结构化输入接入现有学习运行时。
## 5. 数据模型扩展建议
### 5.1 Blueprint 扩展
在 `Challenge` 上增加可选字段：
```ts
interface Challenge {
  // existing fields...
  response_frames?: ResponseFrame[];
  default_response_frame_id?: string;
}
```
每个 challenge 至少应有一个 `free_text` 框架。若 Skill 3 没生成任何结构化框架，系统自动补一个默认自然语言框架：
```json
{
  "frame_id": "free_text_default",
  "version": 1,
  "kind": "free_text",
  "title": "自然语言回复",
  "prompt": "用你的话回应当前挑战。",
  "binds_actions": [],
  "fields": [
    {
      "field_id": "text",
      "type": "textarea",
      "label": "你的回复",
      "required": true,
      "validation": { "min_length": 1, "max_length": 2000 }
    }
  ]
}
```
### 5.2 Conversation Log 扩展
现有 `conversation_log` 已有 `meta_json`，可以先不新增表，直接把结构化回复存在 learner 消息的 `meta` 中：
```json
{
  "kind": "learner_response",
  "response_frame": {
    "frame_id": "rf_readiness_diagnosis",
    "frame_version": 1,
    "kind": "form"
  },
  "structured_response": {
    "values": {
      "person": "陈悦",
      "ability": "medium",
      "willingness": "low",
      "evidence": "能复述流程，但回避承诺排期"
    },
    "canonical_text": "..."
  }
}
```
后续如果要做数据分析，再迁移出独立表 `learner_responses`。
## 6. 运行时协议
### 6.1 Snapshot 增加当前可用框架
`buildSnapshot` 可以附带当前挑战的 response frames：
```ts
interface Snapshot {
  // existing fields...
  response_frames: ResponseFrame[];
  active_response_frame: ResponseFrame;
}
```
默认值为当前 challenge 的 `default_response_frame_id`，如果不存在则使用 `free_text_default`。
### 6.2 Judge 输出增加下一轮框架选择
`JudgeOutput` 增加可选字段：
```ts
interface JudgeOutput {
  // existing fields...
  next_response_frame?: {
    frame_id: string;
    reason: string;
    overrides?: {
      title?: string;
      prompt?: string;
      helper_text?: string;
    };
  } | null;
}
```
运行时只允许选择当前 challenge 已声明的 `frame_id`。`overrides` 只允许覆盖文案，不允许改变字段结构。这保证“UI Schema 不临时生成”。
### 6.3 API 输入兼容
`POST /api/learning/turn` 支持两种输入：
```json
{
  "learner_id": "u_xxx",
  "input": "自然语言回复"
}
```
以及：
```json
{
  "learner_id": "u_xxx",
  "response": {
    "frame_id": "rf_readiness_diagnosis",
    "frame_version": 1,
    "values": {
      "person": "陈悦",
      "ability": "medium",
      "willingness": "low",
      "evidence": "能复述流程，但回避承诺排期"
    }
  }
}
```
MVP 建议先实现前四类：`free_text`、`single_choice`、`multi_choice`、`form`。它们覆盖大多数“降低输入负荷”的场景，且前端和测试成本可控。
## 8. LLM 侧使用方式
### 8.1 Skill 3 生成候选框架
Skill 3 在填充 challenge 时，除 `trunk`、`artifacts`、`companion_hooks` 外，生成 `response_frames`。
示例：
```json
{
  "response_frames": [
    {
      "frame_id": "rf_free_text",
      "version": 1,
      "kind": "free_text",
      "title": "自由回应",
      "prompt": "用你的话说明你会怎么处理。",
      "binds_actions": ["a1"],
      "fields": [
        {
          "field_id": "text",
          "type": "textarea",
          "label": "你的回应",
          "required": true
        }
      ]
    },
    {
      "frame_id": "rf_readiness_diagnosis",
      "version": 1,
      "kind": "form",
      "title": "准备度诊断表",
      "prompt": "先把对象、能力、意愿和证据拆开填写。",
      "binds_actions": ["a1"],
      "expected_evidence_keys": ["person", "ability", "willingness", "evidence", "next_step"],
      "fields": [
        { "field_id": "person", "type": "text", "label": "对象", "required": true },
        {
          "field_id": "ability",
          "type": "radio",
          "label": "能力水平",
          "required": true,
          "options": [
            { "value": "low", "label": "低" },
            { "value": "medium", "label": "中" },
            { "value": "high", "label": "高" }
          ]
        },
        {
          "field_id": "willingness",
          "type": "radio",
          "label": "意愿水平",
          "required": true,
          "options": [
            { "value": "low", "label": "低" },
            { "value": "medium", "label": "中" },
            { "value": "high", "label": "高" }
          ]
        },
        { "field_id": "evidence", "type": "textarea", "label": "关键证据", "required": true },
        { "field_id": "next_step", "type": "textarea", "label": "下一步动作", "required": true }
      ]
    }
  ],
  "default_response_frame_id": "rf_free_text"
}
```

### 8.2 Judge 选择下一轮框架
Judge 不生成新字段结构，只选择已有框架：
```json
{
  "path_decision": { "type": "scaffold", "target": null, "scaffold_spec": { "strategy": "concept_scaffold", "focus_dim": "d1" } },
  "next_response_frame": {
    "frame_id": "rf_readiness_diagnosis",
    "reason": "学员连续混淆能力与意愿，切换到拆分表单降低认知负荷",
    "overrides": {
      "helper_text": "这次先不用写完整方案，只要分别判断能力和意愿，并各给一个证据。"
    }
  }
}
```
## 9. 与现有项目的衔接点
- `lib/types/core.ts`：新增 `ResponseFrame`、`ResponseField`、`LearnerStructuredResponse` 类型，并挂到 `Challenge`。
- `lib/skills/index.ts`：Skill 3 fill 后 normalize challenge 时校验和补齐 `response_frames`。
- `lib/state-manager/index.ts`：`Snapshot` 增加当前可用框架和 active frame。
- `lib/judge/index.ts`：Judge prompt 和 normalizer 支持 `next_response_frame`，并限制只能选择当前 challenge 的合法 frame。
- `lib/learning-runtime/index.ts`：`runTurn` 接收结构化 response，生成 canonical text，持久化原始结构化数据。
- `app/learn/[id]/LearnerSession.tsx`：输入区从单一 input 变为 `ResponseFrameRenderer`，根据 frame kind 渲染固定控件。
- `conversation_log.meta_json`：保存 learner 的结构化响应，保持审计能力。
## 10. 校验与容错
1. 如果前端提交的 `frame_id` 不属于当前 challenge，服务端拒绝并要求刷新。
2. 如果提交的 `frame_version` 过旧但字段兼容，服务端可接受并按提交版本 canonicalize；若不兼容，要求刷新。
3. 如果结构化值未通过 required/min/max 校验，前端先阻止提交，服务端再做一次同样校验。
4. 如果 Judge 选择了不存在的 `frame_id`，normalizer 回退到当前默认框架。
5. 如果任何框架缺失，系统自动补 `free_text_default`。
## 11. MVP 范围
第一版建议只做以下范围：
- 支持 `free_text`、`single_choice`、`multi_choice`、`form`。
- Skill 3 能为每个 challenge 生成 1 个自然语言框架 + 0-2 个结构化框架。
- Judge 可以选择下一轮 `frame_id`，但不能修改字段结构。
- 前端渲染当前 active frame，并提交结构化 response。
- 服务端生成 canonical text，现有 Judge 主链路继续使用文本输入。
- conversation log 保存结构化原始值。
暂不做：
- LLM 每轮生成全新 UI schema。
- 拖拽排序、复杂矩阵、公式校验。
- 独立 `learner_responses` 表。
- 根据不同设备动态改 UI 布局。
## 12. 为什么适合本项目
这个项目的精华是 `Blueprint` 驱动运行时，而不是自由聊天。回复框架也应该成为 Blueprint 的一部分：它描述“这个挑战希望学员以什么结构练习核心动作”。同时，学习运行时已经有 Judge 判断路径、scaffold 策略和 Narrator 指令，因此让 Judge 选择下一轮输入框架，可以自然服务于“降低认知负荷”和“提高评估稳定性”。
这种设计把 LLM 的职责限定在“产出和选择结构化协议”，把 UI 的职责限定在“渲染已知协议”，把运行时的职责限定在“校验、规范化、持久化、交给 Judge”。边界清楚，适合增量落地。
