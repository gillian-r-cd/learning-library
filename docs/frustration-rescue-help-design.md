# 挫败救援与点数求助方案

## 背景

当前学习运行时已经能识别一部分“我不知道”“卡住了”“给个例子”这类求助表达。系统会把这些输入传给 Judge，并让 Judge 进入 `simplify_challenge`。Narrator 会给范例、对照或拆步，但学员仍然留在同一个挑战里。这个机制降低了题目难度，却没有提供“退出当前卡点”的出口。

这会造成一个不友好的循环。学员已经表达卡住或挫败，系统仍然要求学员继续回答同一个问题。学员会感觉自己被卡在一道题里，而不是被支持着继续学习。

## 目标

本次改动要建立一个明确的救援出口。当学员连续表达卡住、明显挫败，或主动选择“揭晓并继续”时，系统直接给出参考答案和判断过程，然后推进到下一阶段。

同时，学员端需要提供一个可见的求助入口。学员不应该只能靠输入“我不会”来触发脚手架。求助入口使用点数作为消耗，形成一个可理解的选择：花少量点数换提示，花更多点数换完整答案并继续。

## 现状问题

当前 `detectSelfHelpSignal()` 只识别明确求助表达。它不会稳定识别“算了”“一直不对”“我不想答了”“这个太烦了”这类挫败表达。

当前 Judge 的最高支架路径是 `simplify_challenge`。这个路径会给 worked example，但不会推进位置。`applyJudgeOutput()` 只有在 `path_decision.type=complete_challenge` 时才会进入下一个挑战。

当前学员端没有固定求助入口。学员必须把求助意图写进输入框，系统才可能识别。

## 设计

### 1. 求助意图分层

运行时新增一个 `HelpIntent` 派生信号，用代码先识别学员状态，再注入 Judge。

`hint` 表示学员请求轻提示。典型输入包括“提示一下”“给点线索”“提醒我一下”。

`example` 表示学员请求范例或已经明显卡住。典型输入包括“给个例子”“我不知道”“没思路”“卡住了”。

`reveal` 表示学员要求退出当前卡点。典型输入包括“我放弃”“直接告诉我答案”“揭晓吧”“不想答了”“一直不对”“太烦了”。如果同一挑战连续出现两次 self-help 或 frustration 表达，也升级为 `reveal`。

### 2. Judge 新增路径

`PathDecisionType` 新增 `reveal_answer_and_advance`。

这个路径的语义是：系统确认当前挑战不再要求学员继续作答。Narrator 必须给出参考答案、判断依据和一句承接，然后运行时推进到下一挑战。

这个路径不等于正常掌握。证据记录需要标记 `scaffold_assisted=true`，并保留 `scaffold_strategy=worked_example`。后续看板可以把它理解为“救援通过”，而不是“独立掌握”。

### 3. 点数求助

学员端新增求助按钮，提供三个动作。

`hint` 消耗 1 点。系统给一个具体线索，仍停留在当前挑战。

`example` 消耗 2 点。系统给一个 worked example，仍停留在当前挑战。

`reveal` 消耗 4 点。系统给出参考答案并推进到下一挑战。

如果学员当前点数不足，系统仍允许使用 `reveal`，但会把点数扣到 0。学习系统不能因为点数不足把学员困住。点数在这里是体验成本，不是通行门槛。

### 4. 运行时协议

`POST /api/learning/turn` 接收可选 `help_request`：

```json
{
  "learner_id": "u_123",
  "help_request": {
    "kind": "hint"
  }
}
```

运行时把 `help_request` 转成标准 learner input，例如“我想花 1 点换一个提示”。这条输入仍写入 conversation log，保证调试视图能看到真实发生的求助。

Judge 会收到 `help_intent`、`help_request_kind` 和 `frustration_signal`。当 `help_intent=reveal` 时，Judge 必须输出 `reveal_answer_and_advance`。

### 5. Narrator 输出

当路径是 `reveal_answer_and_advance` 时，Narrator 不能继续追问。输出必须包含三部分：

第一，直接给出参考答案或可接受答案。

第二，用具体依据解释为什么这个答案成立。

第三，用一句话把学员带到下一个挑战。

### 6. 输入框修复

`ResponseFrameRenderer` 当前提交后不清空本地 `values`，所以消息发出去后还保留在输入框中。提交时应先保存当前 values 给 `onSubmit`，然后立即重置为 `initialValues(frame)`。如果请求失败，conversation log 已经保存了输入，输入框不需要回填旧文本。

## 测试计划

新增和更新单元测试覆盖以下行为：

- `detectHelpIntent()` 能识别提示、范例、揭晓和挫败表达。
- Judge normalizer 接受 `reveal_answer_and_advance`。
- `runTurn()` 在显式 `help_request.kind=reveal` 时推进到下一挑战，并写入点数消耗消息。
- `ResponseFrameRenderer` 的提交重置逻辑有纯函数测试覆盖，避免输入框残留。

验收标准：

- 学员主动点“揭晓并继续”后，不再停留在当前挑战。
- 学员连续表达卡住或强烈挫败时，系统直接给答案并推进。
- Judge 和 Evidence 调试信息仍然保留。
- 输入框提交后立即清空。
