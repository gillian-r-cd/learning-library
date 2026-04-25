"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJSON } from "@/lib/client/fetchJson";
import type { Blueprint } from "@/lib/types/core";

type BlueprintRow = Pick<Blueprint, "blueprint_id" | "topic" | "step_status">;

export default function BlueprintList({ blueprints }: { blueprints: BlueprintRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = blueprints.length > 0 && selected.size === blueprints.length;
  const selectedCount = selected.size;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(blueprints.map((b) => b.blueprint_id)));
  }

  async function deleteOne(id: string, topic: string) {
    if (!confirm(`确定要删除「${topic}」吗？\n\n该 Blueprint 下的所有学员旅程、对话记录、积分都会被一并删除，无法恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJSON<{ ok?: boolean; error?: string }>(
        `/api/design/blueprints/${id}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        setError(r.error ?? "删除失败 / Failed to delete");
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (selectedCount === 0) return;
    if (!confirm(`将批量删除 ${selectedCount} 个 Blueprint 及其下所有学员旅程，无法恢复。是否继续？`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJSON<{ ok?: boolean; error?: string }>(
        `/api/design/blueprints/batch-delete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: selectedIds }),
        }
      );
      if (!r.ok) {
        setError(r.error ?? "批量删除失败 / Batch delete failed");
        return;
      }
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (blueprints.length === 0) {
    return <p className="text-sm text-muted">还没有 Blueprint，新建一个吧。</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            data-test-id="bp-select-all"
          />
          全选 / Select all
        </label>
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted">已选 {selectedCount} 个</span>
            <button
              className="btn-danger"
              onClick={deleteSelected}
              disabled={busy}
              data-test-id="bp-batch-delete"
            >
              {busy ? "删除中..." : `批量删除 (${selectedCount})`}
            </button>
          </div>
        )}
      </div>
      {error && <div className="text-xs text-bad">⚠️ {error}</div>}
      <ul className="space-y-2 text-sm">
        {blueprints.map((bp) => {
          const checked = selected.has(bp.blueprint_id);
          return (
            <li key={bp.blueprint_id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(bp.blueprint_id)}
                aria-label={`选择 ${bp.topic}`}
                data-test-id={`bp-select-${bp.blueprint_id}`}
              />
              <Link
                href={`/design/${bp.blueprint_id}`}
                className="card-sub flex items-center justify-between hover:border-accent flex-1"
                data-test-id={`bp-link-${bp.blueprint_id}`}
              >
                <span>
                  <span className="font-semibold">{bp.topic}</span>{" "}
                  <span className="text-muted text-xs">{bp.blueprint_id}</span>
                </span>
                <span className="flex gap-1">
                  {(["step1", "step2", "step3", "step4", "step5"] as const).map((k) => (
                    <span key={k} className={`chip chip-${bp.step_status[k]}`}>
                      {k}
                    </span>
                  ))}
                </span>
              </Link>
              <button
                className="btn-danger-ghost"
                onClick={() => deleteOne(bp.blueprint_id, bp.topic)}
                disabled={busy}
                data-test-id={`bp-delete-${bp.blueprint_id}`}
                title="删除该 Blueprint 及其所有学员旅程"
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
