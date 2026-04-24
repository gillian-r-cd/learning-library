"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJSON } from "@/lib/client/fetchJson";

export default function NewPromptForm({ scope, systemKeys }: { scope: string; systemKeys: string[] }) {
  const [key, setKey] = useState(systemKeys[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        system: "请在此处填入该课程针对 " + key + " 的系统提示词 override。",
        messages: [{ role: "user", content: "继承系统级 user 模板。" }],
        temperature: 0.7,
        max_tokens: 1024,
        model: "claude-opus-4-7",
      };
      const r = await fetchJSON<{ prompt?: { version: number }; error?: string }>(
        "/api/admin/prompts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key,
            scope,
            body,
            created_by: "admin-ui",
            note: "initial override",
          }),
        }
      );
      if (r.networkError) {
        setMsg(`⚠️ ${r.error}`);
        return;
      }
      if (r.data?.prompt) {
        router.push(
          `/admin/prompts/edit?key=${encodeURIComponent(key)}&scope=${encodeURIComponent(scope)}`
        );
      } else setMsg(`❌ ${r.data?.error ?? r.error ?? "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="label">
        作用域 <span className="text-muted/70">Scope</span>
      </div>
      <div className="chip">{scope}</div>
      <div className="label">
        选择要 override 的系统级 key <span className="text-muted/70">Pick a system-level key to override</span>
      </div>
      <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
        {systemKeys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <div className="flex gap-2 items-center">
        <button className="btn-primary" onClick={create} disabled={busy}>
          {busy ? "创建中 Creating ..." : "创建 Override · Create Override"}
        </button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  );
}
