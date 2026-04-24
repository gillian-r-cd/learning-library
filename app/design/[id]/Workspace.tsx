"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Blueprint } from "@/lib/types/core";
import { fetchJSON, type FetchJsonResult } from "@/lib/client/fetchJson";
import StepPanel from "./StepPanel";
import ChatPanel from "./ChatPanel";

type SkillsResponse = {
  ok?: boolean;
  blueprint?: Blueprint;
  error?: string;
};

type CopilotResponse = {
  reply?: string;
  error?: string;
};

type BlueprintResponse = {
  blueprint?: Blueprint;
  error?: string;
};

export default function Workspace({ initialBlueprint }: { initialBlueprint: Blueprint }) {
  const [bp, setBp] = useState<Blueprint>(initialBlueprint);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [log, setLog] = useState<{ role: "copilot" | "designer"; text: string }[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const router = useRouter();

  /**
   * Classify a fetchJSON result into three outcomes the UI cares about:
   *   - "fatal": the blueprint was deleted — switch to full-page recovery screen.
   *   - "network": server unreachable — keep user's state, show actionable message.
   *   - "ok" / "api_error": forward to caller.
   */
  function classify<T extends { error?: string }>(
    r: FetchJsonResult<T>
  ): { kind: "fatal" | "network" | "ok" | "api_error"; message: string } {
    if (r.networkError) {
      return {
        kind: "network",
        message: r.error ?? "无法连接到服务器 / Unable to reach server",
      };
    }
    if (r.status === 404 || r.data?.error === "blueprint not found") {
      return { kind: "fatal", message: "这个 Blueprint 在数据库里找不到了。" };
    }
    if (!r.ok) {
      return { kind: "api_error", message: r.error ?? "API error" };
    }
    return { kind: "ok", message: "" };
  }

  async function refresh() {
    const r = await fetchJSON<BlueprintResponse>(
      `/api/design/blueprints/${bp.blueprint_id}`,
      { cache: "no-store" }
    );
    const c = classify(r);
    if (c.kind === "fatal") {
      setFatal("这个 Blueprint 在数据库里找不到了（通常是开发期清过数据）。请返回设计列表并重新创建。");
      return;
    }
    if (c.kind === "network") {
      // Silent on background refresh; runAction/sendChat surface the error.
      return;
    }
    if (r.data?.blueprint) setBp(r.data.blueprint);
  }

  async function runAction(action: string, extra?: Record<string, unknown>) {
    if (fatal) return;
    setLog((l) => [...l, { role: "copilot", text: `⚙️ 正在执行 ${action} ...` }]);
    const r = await fetchJSON<SkillsResponse>("/api/design/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, blueprint_id: bp.blueprint_id, ...(extra ?? {}) }),
    });
    const c = classify(r);
    if (c.kind === "fatal") {
      setFatal(
        "这个 Blueprint 在数据库里找不到了（通常是开发期清过数据）。请返回设计列表并重新创建。"
      );
      return;
    }
    if (c.kind === "network") {
      setLog((l) => [
        ...l,
        {
          role: "copilot",
          text: `⚠️ ${c.message} （你的输入没有丢失，服务恢复后点一下「刷新重试」或再点一次操作即可继续。）`,
        },
      ]);
      return;
    }
    if (r.data?.blueprint) setBp(r.data.blueprint);
    const ok = r.data?.ok;
    setLog((l) => [
      ...l,
      { role: "copilot", text: ok ? `✅ ${action} 完成` : `❌ ${r.data?.error ?? c.message}` },
    ]);
    return r.data;
  }

  async function sendChat(message: string) {
    if (fatal) return;
    setLog((l) => [...l, { role: "designer", text: message }]);
    const r = await fetchJSON<CopilotResponse>("/api/design/copilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blueprint_id: bp.blueprint_id, message }),
    });
    const c = classify(r);
    if (c.kind === "fatal") {
      setFatal(
        "这个 Blueprint 在数据库里找不到了（通常是开发期清过数据）。请返回设计列表并重新创建。"
      );
      return;
    }
    if (c.kind === "network") {
      setLog((l) => [
        ...l,
        {
          role: "copilot",
          text: `⚠️ ${c.message} （你的消息没有发出去。服务恢复后重发即可。）`,
        },
      ]);
      return;
    }
    const reply = r.data?.reply ?? r.data?.error ?? c.message ?? "(no reply)";
    setLog((l) => [...l, { role: "copilot", text: reply }]);
    await refresh();
  }

  if (fatal) {
    return (
      <div className="mx-auto max-w-xl p-10 space-y-4">
        <h1 className="text-2xl font-bold">Blueprint 丢失</h1>
        <p className="text-sm text-muted">{fatal}</p>
        <div className="text-xs text-muted">
          bp_id: <code className="kbd">{bp.blueprint_id}</code>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => router.push("/design")}>
            返回设计列表
          </button>
          <button className="btn" onClick={() => location.reload()}>
            刷新重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* left panel */}
      <div className="flex-[3] border-r border-border overflow-y-auto">
        <div className="sticky top-0 z-10 bg-bg border-b border-border px-4 py-2 flex items-center gap-3">
          <h1 className="font-semibold" data-test-id="bp-topic-display">
            {bp.topic}
          </h1>
          <span className="text-xs text-muted">{bp.blueprint_id}</span>
          <span className={`chip ${bp.status === "ready" ? "chip-confirmed" : ""}`}>{bp.status}</span>
          <div className="ml-auto flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`btn ${activeStep === n ? "!border-accent !text-accent" : ""}`}
                data-test-id={`step-tab-${n}`}
                onClick={() => setActiveStep(n as 1 | 2 | 3 | 4 | 5)}
              >
                Step {n}{" "}
                <span className={`chip chip-${bp.step_status[`step${n}` as "step1"]}`}>
                  {bp.step_status[`step${n}` as "step1"]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          <StepPanel step={activeStep} blueprint={bp} onAction={runAction} />
        </div>
      </div>
      {/* right chat */}
      <div className="flex-[2] flex flex-col">
        <ChatPanel log={log} onSend={sendChat} blueprint={bp} />
      </div>
    </div>
  );
}
