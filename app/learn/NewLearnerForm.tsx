"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Blueprint } from "@/lib/types/core";
import { fetchJSON } from "@/lib/client/fetchJson";

export default function NewLearnerForm({ blueprints }: { blueprints: Blueprint[] }) {
  const [bpId, setBpId] = useState(blueprints[0]?.blueprint_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    if (!bpId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJSON<{ learner?: { learner_id: string }; error?: string }>(
        "/api/learning/learners",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blueprint_id: bpId }),
        }
      );
      if (!r.ok) {
        setError(r.error ?? "创建失败");
        return;
      }
      if (r.data?.learner) router.push(`/learn/${r.data.learner.learner_id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <div className="label mb-1">选择 Blueprint</div>
          <select
            className="input"
            value={bpId}
            onChange={(e) => setBpId(e.target.value)}
            data-test-id="new-learner-bp"
          >
            {blueprints.map((b) => (
              <option key={b.blueprint_id} value={b.blueprint_id}>
                {b.topic} — {b.blueprint_id}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn-primary"
          data-test-id="create-learner"
          onClick={create}
          disabled={busy || !bpId}
        >
          {busy ? "创建中..." : "开启旅程"}
        </button>
      </div>
      {error && <div className="text-xs text-bad">⚠️ {error}</div>}
    </section>
  );
}
