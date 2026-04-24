# Learning Library — 实现进度（PROGRESS）

> 本文档记录 PRD.md 落地实现的每一步进度。

## 最终状态

✅ **全部跑通**。单元 24/24、E2E 9/9、TypeScript 0 错误、所有 13 张 UI 截图人工核对通过。

- `npm run test:unit` — 24 passed
- `npm run test:e2e` — 9 passed
- `npx tsc --noEmit` — clean
- `npm run dev` → http://localhost:3100 可正常访问三个入口

---

## 技术栈

- **框架**：Next.js 15.1.3（App Router）+ TypeScript + React 19
- **样式**：Tailwind CSS + 自定义组件层（`card`/`chip`/`btn-*`/`input` 等）
- **数据库**：`better-sqlite3`（单文件 SQLite；schema 做得足够通用便于迁移 Postgres）
- **LLM**：`@anthropic-ai/sdk`；默认 `LLM_MOCK=1` 跑确定性 mock，设置 `ANTHROPIC_API_KEY` 即切真实调用
- **测试**：Playwright（E2E）+ Vitest（单元）
- **端口**：dev 3100

## 目录结构

```
learning-library/
├── PRD.md / Plan.md / PROGRESS.md
├── package.json / tsconfig.json / next.config.ts
├── playwright.config.ts / vitest.config.ts
├── tailwind.config.ts / postcss.config.js
├── app/
│   ├── layout.tsx / page.tsx / globals.css / not-found.tsx
│   ├── design/
│   │   ├── page.tsx / NewBlueprintForm.tsx
│   │   └── [id]/{page, Workspace, StepPanel, ChatPanel}.tsx
│   ├── learn/
│   │   ├── page.tsx / NewLearnerForm.tsx
│   │   └── [id]/{page, LearnerSession}.tsx
│   ├── admin/
│   │   ├── page.tsx
│   │   ├── ledger/{page, [id]/page}.tsx
│   │   ├── trace/[id]/page.tsx
│   │   ├── metrics/page.tsx
│   │   └── prompts/{page, edit/{page, PromptEditor}, new/{page, NewPromptForm}}.tsx
│   └── api/
│       ├── design/{blueprints, blueprints/[id], skills, copilot}/route.ts
│       ├── learning/{learners, learners/[id], turn}/route.ts
│       └── admin/{ledger, metrics, prompts}/route.ts
├── lib/
│   ├── types/core.ts              # Blueprint / Learner / Ledger / JudgeOutput 等完整 schema
│   ├── db/index.ts                # SQLite schema + migrate
│   ├── llm/{index, mock}.ts       # llm_call 统一 SDK + 按 caller 的确定性 mock
│   ├── prompt-store/{index, render, seed}.ts  # 两级继承 + Jinja-lite 占位符 + 系统级 seed
│   ├── ledger/index.ts            # Raw Call Ledger + Metrics 聚合
│   ├── points/index.ts            # FSRS-inspired 衰减 + 恢复 + 解锁阈值
│   ├── blueprint/index.ts         # Blueprint CRUD + audit + 级联 stale
│   ├── skills/index.ts            # 5 个 Skill
│   ├── design-copilot/index.ts    # 意图分类 + Skill 分发
│   ├── state-manager/index.ts     # 量化 + 质性双层存储 + 快照 + 应用 Judge 结果
│   ├── judge/index.ts / narrator/index.ts / companions/index.ts
│   └── learning-runtime/index.ts  # 单次交互编排
├── tests/
│   ├── unit/{points, prompt-store, blueprint, learning-runtime}.test.ts
│   └── e2e/{01-designer, 02-learner, 03-admin}.spec.ts
├── scripts/
│   └── visual-tour.ts             # 造种子数据 + 抓 13 张页面截图
└── screenshots/                   # 生成的视觉验证图
```

---

## 实施时间线

### 19:10 启动
- [x] 阅读 PRD.md 并规划路径
- [x] 选定技术栈（Next.js 15 + SQLite + Anthropic SDK mock 模式）

### 19:15 – 19:30 基础设施
- [x] `package.json` / `tsconfig.json` / `tailwind.config.ts` / `next.config.ts`
- [x] `npm install`（229 包，3 分钟）
- [x] `lib/types/core.ts` — 完整 Blueprint / Learner / Judge schema
- [x] `lib/db/index.ts` — SQLite 8 张表 migration
- [x] `lib/llm/{index,mock}.ts` — **`llm_call` 统一 SDK**（PRD §8.6 的硬收敛）
  - 读 Prompt Store（两级继承）→ 渲染占位符 → 调用（或 mock）→ 写 Ledger → 计费
  - mock 为每个 caller 返回确定性 JSON，让测试稳定

### 19:30 – 19:45 核心模块
- [x] `lib/prompt-store/{index,render,seed}.ts` —
  - 11 条系统级 prompt 首启动自动 seed
  - 课程级按 `course:<blueprint_id>` scope 叠加
  - `getEffectivePrompt` 做 课程→系统 回落合并
  - `renderTemplate` Jinja-lite `{{var.path}}` 占位符
  - `upsertPrompt` 版本号自动 +1，写 `admin_audit`
- [x] `lib/ledger/index.ts` — `writeLedger` / `queryLedger` / `getLedgerByTrace` / `computeMetrics`（延迟 p95、cache、cost、按 caller/stage 聚合）
- [x] `lib/points/index.ts` — FSRS-inspired `R(t)=exp(-t/S)` + 知识类型差异化 + `floor_ratio` + 解锁阈值分配

### 19:45 – 20:00 业务逻辑
- [x] `lib/blueprint/index.ts` — 创建/更新/审计 + 级联 stale（PRD §5.5 完整矩阵的简化版）
- [x] `lib/skills/index.ts` — 5 个 Skill（Skill 3 两 pass：骨架+填充）
- [x] `lib/design-copilot/index.ts` — 文本意图分类 → Skill 分发
- [x] `lib/state-manager/index.ts` — 量化层 + 质性层（evidence_log append-only）+ Snapshot + 应用 Judge 输出
- [x] `lib/judge/index.ts` + `lib/narrator/index.ts` + `lib/companions/index.ts`
- [x] `lib/learning-runtime/index.ts` — 单次交互编排：Snapshot → Judge → State 更新 → Narrator || Companions 并行

### 20:00 – 20:20 UI
- [x] `app/layout.tsx` + `app/page.tsx` — 导航栏 + 首页 3 卡片
- [x] 设计阶段：workspace 左步骤面板（5 tab）+ 右 Copilot 对话
- [x] 学员旅程：左聊天（Narrator / Companion 分色气泡）+ 右侧 已解锁伴学 / 解锁阈值 / Judge JSON / Evidence
- [x] 运维后台：Home（KPI + 最近 5 次调用）/ Ledger 列表 + 详情（raw_input/output 完整 JSON）/ Trace 视图 / Metrics / **Prompt Store（系统级按 设计/学习 分组 + 课程级按 Blueprint 分组）** / Prompt Editor（版本历史 + Publish）

### 20:20 – 20:30 烟囱测试
API 烟囱：
- `POST /api/design/blueprints` → 创建成功
- 5 个 `POST /api/design/skills` 依次 ok:true
- `POST /api/learning/learners` → 成功
- `POST /api/learning/turn` → Judge + Narrator + State 更新链路通
- 跑 10 轮触发 `cp_guide`（第 5 轮）+ `cp_case`（第 10 轮）解锁
- `/api/admin/ledger` / `/api/admin/metrics` 正确

### 20:30 – 20:42 测试
- [x] 单元 4 个套件 24 个用例 全绿
  - points.test.ts（15）衰减 / 恢复 / 阈值 / 初始稳定度等
  - prompt-store.test.ts（3）两级继承 + 占位符渲染
  - blueprint.test.ts（3）CRUD + 级联 + 5 Skill 全链路
  - learning-runtime.test.ts（3）单轮 + 多轮解锁 + Ledger 覆盖
- [x] E2E 9 个用例 全绿
  - Designer：创建 Blueprint → 5 Skills 全跑 → 确认每步
  - Designer：Copilot 快捷指令触发
  - Learner：创建会话 → 发送 turn → 看到 Narrator + points 更新
  - Learner：多轮后解锁伴学并可见
  - Admin：Home KPI + Ledger 列表 / 详情 raw I/O / Trace / Metrics / Prompt Editor Publish
- [x] 修了 2 个测试问题：
  1. Playwright 默认 testid 属性是 `data-testid` 而我的代码用 `data-test-id` → 在 playwright.config 配 `testIdAttribute: "data-test-id"`
  2. Learner 页面 snapshot 异步 refetch 时序 → 改为 turn 响应后乐观更新 snapshot

### 20:42 – 20:50 视觉校验
- [x] `scripts/visual-tour.ts`：造种子 + 抓 13 张 fullpage 截图
- [x] 全部页面人工审阅通过，无布局错位 / 无空白页 / 无乱码

### 20:50 – 20:55 最终回归
- [x] 清理 data/ 重跑 unit + E2E：24/24 + 9/9 稳定通过
- [x] `npx tsc --noEmit` 无错
- [x] 写 PROGRESS.md 最终报告

---

## 对 PRD 的落实对照

| PRD 章节 | 实现位置 | 状态 |
| --- | --- | --- |
| §2 术语 | `lib/types/core.ts` TS 类型 | ✅ |
| §4 系统架构 | `app/` + `lib/` 三层 | ✅ |
| §5.1 Design Copilot + Blueprint + Skills | `lib/design-copilot` + `lib/skills` + `lib/blueprint` | ✅ |
| §5.2 Blueprint Schema | `lib/types/core.ts` Blueprint interface | ✅ |
| §5.3.1–5 五个环节 | `lib/skills/index.ts` 五个函数 + mock 产出 | ✅ |
| §5.4 步骤面板 UI | `app/design/[id]/Workspace.tsx` + `StepPanel.tsx` + `ChatPanel.tsx` | ✅ |
| §5.5 回退级联 | `lib/blueprint/cascadeStale` + 单元测试 | ✅ |
| §6.2 嵌套循环 | Chapter → Challenge → turn 的数据结构 | ✅ |
| §6.3.1 State Manager 双层 | `lib/state-manager` + evidence_log 表 | ✅ |
| §6.3.2 Judge + Schema | `lib/judge` + `JudgeOutput` TS 类型 | ✅ |
| §6.3.3 Narrator 三层上下文 | `lib/narrator` + `recentTurns` 滑窗 | ✅ |
| §6.3.4 Companion 注册 + persona | `lib/companions` + mock seeded 3 种类型 | ✅ |
| §6.3.5 单次交互流程 | `lib/learning-runtime/runTurn` | ✅ |
| §7.1 通用积分框架 + FSRS 衰减 | `lib/points` + 15 个单元测试 | ✅ |
| §7.3 Blueprint→Runtime 编译 | `lib/state-manager/buildSnapshot` 每次读 Blueprint 实时解析 | ✅ |
| §8.2.1 Raw Call Ledger | `lib/ledger` + `admin/ledger/*` 页面 | ✅ |
| §8.2.2 Metrics Dashboard | `admin/metrics` + `computeMetrics` 6 类指标 | ✅ |
| §8.2.3 Tracing | `admin/trace/[id]` 按 trace_id 串联 span | ✅ |
| §8.3 两级 Prompt Store | `lib/prompt-store` + `admin/prompts/*` UI | ✅ |
| §8.6 `llm_call` 统一 SDK | `lib/llm/index.ts` 是唯一出口，所有调用都入 Ledger | ✅ |

---

## 验收清单

- [x] 设计师能在 UI 创建 Blueprint 并跑完 5 步
- [x] 学员能进入旅程、发送回复、看到 Narrator 旁白 + Companion 对话
- [x] 达到阈值自动解锁伴学，前端实时显示
- [x] 每次 LLM 调用都进 Ledger，可查原始 input/output
- [x] Ledger 详情页显示 tokens / cache / latency / cost / context 完整字段
- [x] Trace 页按 trace_id 串起一次交互的全部 span
- [x] Metrics 页按 caller 聚合延迟 / 成本 / cache
- [x] Prompt Store 按系统级（设计/学习/通用）+ 课程级分层清晰展示
- [x] Prompt Editor 支持编辑 system / user / model / temperature / max_tokens 并 Publish 新版本
- [x] 版本历史保留
- [x] TypeScript 严格模式 0 错误
- [x] Playwright E2E 全绿
- [x] Vitest 单元全绿

## 运行方式

```bash
# 开发
npm run dev                              # → http://localhost:3100

# 测试
npm run test:unit                        # Vitest
npm run test:e2e                         # Playwright（会自动起 dev）
npm test                                 # 两者合并

# 视觉巡检
npm run dev &                            # 后台起服务
npx tsx scripts/visual-tour.ts           # 抓 13 张截图到 screenshots/

# 切换到真实 LLM
export ANTHROPIC_API_KEY=sk-...
npm run dev                              # 自动跳出 mock 模式
```
