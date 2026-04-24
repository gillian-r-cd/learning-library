"use client";
import { useState, useRef, useEffect } from "react";
import type { Blueprint } from "@/lib/types/core";

interface Props {
  log: { role: "copilot" | "designer"; text: string }[];
  onSend: (msg: string) => Promise<void>;
  blueprint: Blueprint;
}

export default function ChatPanel({ log, onSend, blueprint }: Props) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" });
  }, [log]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      setVal("");
      await onSend(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-bg border-b border-border px-4 py-2 text-sm font-semibold">
        Design Copilot
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm" ref={scrollRef}>
        {log.length === 0 && (
          <div className="text-muted text-xs space-y-2">
            <p>
              这是与 Copilot 的对话区。执行 Skill、确认 step
              的操作请使用<span className="text-accent">左侧面板</span>上的按钮；
              此处用来和 Copilot 自然语言对话（例如：
              「把维度 d3 的 high 级别描述再写得更具体一点」「为什么选择 S2
              推销型？」）。
            </p>
          </div>
        )}
        {log.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 max-w-[90%] ${
              m.role === "copilot"
                ? "bg-panel self-start border border-border"
                : "bg-accent/20 self-end border border-accent/30 ml-auto text-right"
            }`}
            data-test-id={`chat-msg-${i}`}
          >
            <div className="label mb-0.5">{m.role === "copilot" ? "Copilot" : "设计师"}</div>
            <div className="whitespace-pre-wrap">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(val);
          }}
          className="flex gap-2"
        >
          <input
            className="input"
            placeholder={`与 Copilot 对话 · ${blueprint.topic}`}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            data-test-id="chat-input"
            disabled={busy}
          />
          <button
            type="submit"
            className="btn-primary"
            data-test-id="chat-send"
            disabled={busy || !val.trim()}
          >
            {busy ? "..." : "发送"}
          </button>
        </form>
      </div>
    </div>
  );
}
