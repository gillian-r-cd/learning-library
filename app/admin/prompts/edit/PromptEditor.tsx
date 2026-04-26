"use client";
import { useState } from "react";
import type { StoredPrompt } from "@/lib/prompt-store";
import { fetchJSON } from "@/lib/client/fetchJson";

export default function PromptEditor({
  keyName,
  scope,
  current,
  history,
}: {
  keyName: string;
  scope: string;
  current: StoredPrompt | null;
  history: { version: number; created_at: string; status: string; note: string | null }[];
}) {
  const [systemText, setSystemText] = useState(current?.body.system ?? "");
  const [userText, setUserText] = useState(current?.body.messages[0]?.content ?? "");
  const [temperature, setTemperature] = useState(current?.body.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(current?.body.max_tokens ?? 1024);
  const [model, setModel] = useState(current?.body.model ?? "claude-opus-4-7");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        system: systemText,
        messages: [{ role: "user", content: userText }],
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
        model,
      };
      const r = await fetchJSON<{ prompt?: { version: number }; error?: string }>(
        "/api/admin/prompts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: keyName, scope, body, note, created_by: "admin-ui" }),
        }
      );
      if (r.networkError) {
        setMsg(`⚠️ ${r.error}`);
        return;
      }
      if (r.data?.prompt) {
        setMsg(`✅ 已发布 v${r.data.prompt.version} Published v${r.data.prompt.version}`);
      } else {
        setMsg(`❌ ${r.data?.error ?? r.error ?? "unknown error"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resetToSeed() {
    if (scope !== "system") {
      setMsg("⚠️ 只能重置系统级模板 / Only system-level templates can be reset.");
      return;
    }
    const confirmed =
      typeof window !== "undefined" &&
      window.confirm(
        "将创建一个新版本，内容覆盖为代码里的默认 seed。当前自定义版本仍保留在历史里，可回看。\n\nProceed to reset to built-in default?"
      );
    if (!confirmed) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetchJSON<{
        ok?: boolean;
        new_version?: number;
        replaced_user_edit?: boolean;
        error?: string;
      }>("/api/admin/prompts/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: keyName }),
      });
      if (r.networkError) {
        setMsg(`⚠️ ${r.error}`);
        return;
      }
      if (r.data?.ok) {
        setMsg(
          `✅ 已重置为默认 seed（新版本 v${r.data.new_version}${
            r.data.replaced_user_edit ? "；之前的用户编辑已保留在历史" : ""
          }）。刷新页面查看最新内容。`
        );
      } else {
        setMsg(`❌ ${r.data?.error ?? r.error ?? "unknown error"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        <div className="card space-y-2">
          <div className="label">
            系统提示词 <span className="text-muted/70">System Prompt</span>
          </div>
          <textarea
            value={systemText}
            onChange={(e) => setSystemText(e.target.value)}
            className="input font-mono text-xs"
            rows={10}
            data-test-id="prompt-system"
          />
          <div className="label">
            用户消息模板 <span className="text-muted/70">User Message Template</span>
          </div>
          <textarea
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            className="input font-mono text-xs"
            rows={6}
            data-test-id="prompt-user"
          />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <label className="flex flex-col">
              <span className="label mb-1">
                模型 <span className="text-muted/70">Model</span>
              </span>
              <select value={model} onChange={(e) => setModel(e.target.value)} className="input">
                <option>claude-opus-4-7</option>
                <option>claude-opus-4-6</option>
                <option>claude-sonnet-4-6</option>
                <option>claude-haiku-4-5</option>
              </select>
            </label>
            <label className="flex flex-col">
              <span className="label mb-1">
                温度 <span className="text-muted/70">Temperature</span>
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="input"
              />
            </label>
            <label className="flex flex-col">
              <span className="label mb-1">
                最大 Tokens <span className="text-muted/70">Max Tokens</span>
              </span>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="input"
              />
            </label>
          </div>
          <div className="label">
            发布备注 <span className="text-muted/70">Publish note</span>
          </div>
          <input
            className="input text-xs"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="为这次变更写一行理由 / one-line reason"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn-primary"
              data-test-id="publish-prompt"
              onClick={publish}
              disabled={busy || !systemText.trim()}
            >
              {busy ? "发布中 Publishing ..." : "发布新版本 Publish"}
            </button>
            {scope === "system" && (
              <button
                className="btn"
                data-test-id="reset-prompt-to-seed"
                onClick={resetToSeed}
                disabled={busy}
                title="覆盖为代码里的默认 seed 内容 / overwrite with the built-in default"
              >
                重置为默认 Reset to default
              </button>
            )}
            {msg && <span className="text-xs text-muted">{msg}</span>}
          </div>
        </div>

        <div className="card text-xs">
          <div className="font-semibold mb-1">
            占位符速查 <span className="text-muted/70">Placeholder cheatsheet</span>
          </div>
          <p className="text-muted">
            使用 <code className="kbd">{"{{variable}}"}</code> 引用运行时变量 / Use{" "}
            <code className="kbd">{"{{variable}}"}</code> to reference runtime variables. 常用 / Common:
            <code className="kbd ml-1">{"{{topic}}"}</code>,{" "}
            <code className="kbd">{"{{core_actions}}"}</code>,{" "}
            <code className="kbd">{"{{snapshot}}"}</code>,{" "}
            <code className="kbd">{"{{learner_input}}"}</code>,{" "}
            <code className="kbd">{"{{rubric_column}}"}</code>,{" "}
            <code className="kbd">{"{{narrator_directive}}"}</code>,{" "}
            <code className="kbd">{"{{persona}}"}</code>.
          </p>
        </div>
      </div>
      <div className="card">
        <div className="font-semibold mb-2">
          版本历史 <span className="text-muted font-normal text-sm">Version history</span>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted">还没有版本。 / No versions yet.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {history.map((h) => (
              <li key={h.version} className="card-sub">
                <div className="flex items-center gap-2">
                  <span className="chip">v{h.version}</span>
                  <span className="text-muted">{h.status}</span>
                </div>
                <div className="text-muted">{new Date(h.created_at).toLocaleString()}</div>
                {h.note && <div className="mt-1">{h.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
