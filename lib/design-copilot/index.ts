// Design Copilot: orchestrates chat intent → Skill dispatch. Mock-friendly.

import { llmCall } from "@/lib/llm";
import {
  runSkill1,
  runSkill2,
  runSkill3Skeleton,
  runSkill3Fill,
  runSkill4,
  runSkill5,
  confirmStep,
} from "@/lib/skills";
import { getBlueprint } from "@/lib/blueprint";

export interface CopilotChatResponse {
  reply: string;
  action?: {
    kind:
      | "run_skill_1"
      | "run_skill_2"
      | "run_skill_3_skeleton"
      | "run_skill_3_fill"
      | "run_skill_4"
      | "run_skill_5"
      | "confirm_step"
      | "none";
    details?: Record<string, unknown>;
  };
  callId?: string;
  traceId?: string;
}

export async function copilotChat(
  blueprintId: string,
  userMessage: string
): Promise<CopilotChatResponse> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("blueprint not found");

  const intent = classifyIntent(userMessage);

  // Emit a chat reply (this counts as an LLM call in the ledger)
  const chatRes = await llmCall({
    caller: "design_copilot_chat",
    stage: "design",
    blueprintId,
    variables: { topic: bp.topic, user_message: userMessage },
  });

  if (intent.kind === "run_skill_1") {
    const { callId, traceId } = await runSkill1(blueprintId, intent.details?.hint as string | undefined);
    return { reply: "已生成 Gamecore 萃取结果，请在左侧面板查看并确认。", action: { kind: "run_skill_1" }, callId, traceId };
  }
  if (intent.kind === "run_skill_2") {
    const { callId, traceId } = await runSkill2(blueprintId);
    return { reply: "已为每个核心动作选定体验形式。", action: { kind: "run_skill_2" }, callId, traceId };
  }
  if (intent.kind === "run_skill_3_skeleton") {
    const { callId, traceId, skeleton } = await runSkill3Skeleton(blueprintId);
    return {
      reply: "已生成章节-挑战骨架。确认后我继续填充剧本细节。",
      action: { kind: "run_skill_3_skeleton", details: { skeleton } },
      callId,
      traceId,
    };
  }
  if (intent.kind === "run_skill_3_fill") {
    const skeleton = intent.details?.skeleton;
    if (!skeleton) {
      // synthesize skeleton on the fly if missing
      const gen = await runSkill3Skeleton(blueprintId);
      const fill = await runSkill3Fill(blueprintId, gen.skeleton);
      return {
        reply: "已生成骨架并填充完整剧本。",
        action: { kind: "run_skill_3_fill" },
        callId: fill.callId,
        traceId: fill.traceId,
      };
    }
    const { callId, traceId } = await runSkill3Fill(blueprintId, skeleton);
    return { reply: "已完成剧本填充，请在左侧面板检查。", action: { kind: "run_skill_3_fill" }, callId, traceId };
  }
  if (intent.kind === "run_skill_4") {
    const { callId, traceId } = await runSkill4(blueprintId);
    return { reply: "已生成高级伴学清单。", action: { kind: "run_skill_4" }, callId, traceId };
  }
  if (intent.kind === "run_skill_5") {
    await runSkill5(blueprintId);
    return { reply: "已通过算法拟合积分参数。", action: { kind: "run_skill_5" } };
  }
  if (intent.kind === "confirm_step") {
    const step = intent.details?.step as "step1" | "step2" | "step3" | "step4" | "step5";
    confirmStep(blueprintId, step);
    return { reply: `已确认 ${step}，下游状态已按级联规则更新。`, action: { kind: "confirm_step", details: { step } } };
  }

  // default: just respond conversationally
  return { reply: chatRes.text, action: { kind: "none" }, callId: chatRes.callId, traceId: chatRes.traceId };
}

function classifyIntent(msg: string): {
  kind: CopilotChatResponse["action"] extends infer A
    ? A extends { kind: infer K }
      ? K
      : never
    : never;
  details?: Record<string, unknown>;
} {
  const m = msg.toLowerCase();
  if (/skill\s*1|gamecore|萃取|核心动作/.test(msg)) return { kind: "run_skill_1" };
  if (/skill\s*2|体验选型|选型|体验形式/.test(msg)) return { kind: "run_skill_2" };
  if (/骨架|skeleton/.test(msg) && /剧本|scenario|script/.test(msg)) return { kind: "run_skill_3_skeleton" };
  if (/剧本|script|章节|挑战/.test(msg)) return { kind: "run_skill_3_fill" };
  if (/伴学|companion|npc/.test(msg)) return { kind: "run_skill_4" };
  if (/积分|points|配置/.test(msg)) return { kind: "run_skill_5" };
  const confirm = msg.match(/确认\s*(step\s*\d)/i) || msg.match(/confirm\s*(step\s*\d)/i);
  if (confirm) return { kind: "confirm_step", details: { step: confirm[1].toLowerCase().replace(/\s+/g, "") } };
  if (/确认/.test(m)) {
    // Ambiguous — leave to UI to pass step explicitly
    return { kind: "none" };
  }
  return { kind: "none" };
}
