"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredPrompt } from "@/lib/prompt-store";
import type { PromptBody } from "@/lib/prompt-store/render";
import { fetchJSON } from "@/lib/client/fetchJson";

interface HistoryEntry {
  version: number;
  created_at: string;
  status: string;
  note: string | null;
  created_by: string;
  body: PromptBody;
}

export default function PromptEditor({
  keyName,
  scope,
  current,
  history,
}: {
  keyName: string;
  scope: string;
  current: StoredPrompt | null;
  history: HistoryEntry[];
}) {
  // Which version's body is currently shown in the editor. Defaults to the
  // latest published (`current`); selecting a row in the history panel loads
  // that version's body into the editor textareas.
  const [selectedVersion, setSelectedVersion] = useState<number | null>(
    current?.version ?? null
  );

  const selectedEntry = history.find((h) => h.version === selectedVersion) ?? null;
  const baseBody = selectedEntry?.body ?? current?.body ?? null;

  const [systemText, setSystemText] = useState(baseBody?.system ?? "");
  const [userText, setUserText] = useState(baseBody?.messages?.[0]?.content ?? "");
  const [temperature, setTemperature] = useState(baseBody?.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(baseBody?.max_tokens ?? 1024);
  const [model, setModel] = useState(baseBody?.model ?? "claude-opus-4-7");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function selectVersion(v: number) {
    const entry = history.find((h) => h.version === v);
    if (!entry) return;
    setSelectedVersion(v);
    setSystemText(entry.body.system ?? "");
    setUserText(entry.body.messages?.[0]?.content ?? "");
    setTemperature(entry.body.temperature ?? 0.7);
    setMaxTokens(entry.body.max_tokens ?? 1024);
    setModel(entry.body.model ?? "claude-opus-4-7");
    setMsg(null);
  }

  // Latest published version number — used to decide whether "apply" makes
  // sense (no-op if you re-apply the version that's already published).
  const latestPublishedVersion =
    history.find((h) => h.status === "published")?.version ?? current?.version ?? null;

  const isApplyingHistorical =
    selectedVersion !== null && selectedVersion !== latestPublishedVersion;

  async function publish(args?: { applyHistorical?: boolean }) {
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
      const noteForApply = args?.applyHistorical
        ? `apply v${selectedVersion} as new published${note ? ` · ${note}` : ""}`
        : note;
      const r = await fetchJSON<{ prompt?: { version: number }; error?: string }>(
        "/api/admin/prompts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: keyName,
            scope,
            body,
            note: noteForApply,
            created_by: args?.applyHistorical ? "admin-ui-apply" : "admin-ui",
          }),
        }
      );
      if (r.networkError) {
        setMsg(`⚠️ ${r.error}`);
        return;
      }
      if (r.data?.prompt) {
        const v = r.data.prompt.version;
        setMsg(
          args?.applyHistorical
            ? `✅ 已将 v${selectedVersion} 应用为最新版本 v${v} / Applied v${selectedVersion} as new v${v}`
            : `✅ 已发布 v${v} Published v${v}`
        );
        // Refresh server data so the history panel picks up the new row.
        router.refresh();
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
              onClick={() => publish()}
              disabled={busy || !systemText.trim()}
            >
              {busy ? "发布中 Publishing ..." : "发布新版本 Publish"}
            </button>
            <button
              className="btn"
              data-test-id="apply-this-version"
              onClick={() => publish({ applyHistorical: true })}
              disabled={busy || !isApplyingHistorical || !systemText.trim()}
              title={
                isApplyingHistorical
                  ? `把右侧选中的 v${selectedVersion} 应用为新的当前版本（不会丢失任何历史） / publish v${selectedVersion} as the new published version`
                  : "右侧版本历史里选一个非当前版本即可启用 / pick a non-current historical version on the right to enable"
              }
            >
              {isApplyingHistorical
                ? `应用 v${selectedVersion} Apply v${selectedVersion}`
                : "应用此版本 Apply this version"}
            </button>
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
        <p className="text-xs text-muted mb-2">
          点击任一版本即可在左侧编辑器预览其内容；如需应用，点击「应用此版本」。
          <br />
          Click any version to preview it in the editor; click &ldquo;Apply&rdquo; to publish it as the new current version.
        </p>
        {history.length === 0 ? (
          <p className="text-xs text-muted">还没有版本。 / No versions yet.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {history.map((h) => {
              const isSelected = h.version === selectedVersion;
              const isCurrent = h.version === latestPublishedVersion;
              return (
                <li key={h.version}>
                  <button
                    type="button"
                    onClick={() => selectVersion(h.version)}
                    className={`card-sub w-full text-left transition ${
                      isSelected
                        ? "border-accent ring-2 ring-accent/20"
                        : "hover:border-accent/60"
                    }`}
                    data-test-id={`prompt-version-${h.version}`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="chip">v{h.version}</span>
                      <span className="text-muted">{h.status}</span>
                      {isCurrent && (
                        <span className="chip chip-confirmed">当前 current</span>
                      )}
                      {h.created_by !== "seed" && (
                        <span className="chip" title={`created_by=${h.created_by}`}>
                          {h.created_by}
                        </span>
                      )}
                    </div>
                    <div className="text-muted">
                      {new Date(h.created_at).toLocaleString("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                      })}
                    </div>
                    {h.note && <div className="mt-1 break-words">{h.note}</div>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
