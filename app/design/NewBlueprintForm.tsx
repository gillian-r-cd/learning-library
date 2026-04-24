"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJSON } from "@/lib/client/fetchJson";

export default function NewBlueprintForm() {
  const [topic, setTopic] = useState("情境领导力");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchJSON<{ blueprint?: { blueprint_id: string }; error?: string }>(
        "/api/design/blueprints",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic }),
        }
      );
      if (!r.ok) {
        setError(r.error ?? "创建失败 / Failed to create");
        return;
      }
      if (r.data?.blueprint) {
        router.push(`/design/${r.data.blueprint.blueprint_id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <div className="label mb-1">主题名</div>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            data-test-id="bp-topic"
            className="input"
            placeholder="如：情境领导力"
          />
        </div>
        <button
          className="btn-primary"
          data-test-id="create-bp"
          onClick={create}
          disabled={loading || !topic.trim()}
        >
          {loading ? "创建中..." : "新建 Blueprint"}
        </button>
      </div>
      {error && <div className="text-xs text-bad">⚠️ {error}</div>}
    </section>
  );
}
