"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJSON } from "@/lib/client/fetchJson";

export interface LearnerRow {
  learner_id: string;
  topic: string;
  count: number;
  position_chapter: string;
  position_challenge: string;
  points_total: number;
  preview: string | null;
  last_role: string | null;
  last_who: string | null;
  last_ts: string | null;
}

function relativeTime(ts: string): string {
  const delta = Date.now() - new Date(ts).getTime();
  if (delta < 60_000) return "刚刚 · just now";
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  const days = Math.floor(delta / 86_400_000);
  return `${days} 天前`;
}

function roleLabel(role: string | null, who: string | null): string {
  if (role === "learner") return "学员";
  if (role === "narrator") return "Narrator";
  if (role === "companion") return who ?? "伴学";
  return who ?? "系统";
}

export default function LearnerList({ learners }: { learners: LearnerRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = learners.length > 0 && selected.size === learners.length;
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
    setSelected(allSelected ? new Set() : new Set(learners.map((l) => l.learner_id)));
  }

  async function deleteOne(id: string, topic: string) {
    if (!confirm(`确定要删除该学员旅程吗？\n\n${topic} · ${id}\n\n该学员的所有对话、积分、能力记录都会被删除，无法恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJSON<{ ok?: boolean; error?: string }>(
        `/api/learning/learners/${id}`,
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
    if (!confirm(`将批量删除 ${selectedCount} 个学员旅程及全部对话/积分记录，无法恢复。是否继续？`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJSON<{ ok?: boolean; error?: string }>(
        `/api/learning/learners/batch-delete`,
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

  if (learners.length === 0) {
    return <p className="text-sm text-muted">还没有 learner。开一个看看？</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            data-test-id="learner-select-all"
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
              data-test-id="learner-batch-delete"
            >
              {busy ? "删除中..." : `批量删除 (${selectedCount})`}
            </button>
          </div>
        )}
      </div>
      {error && <div className="text-xs text-bad">⚠️ {error}</div>}
      <ul className="space-y-2 text-sm">
        {learners.map((l) => {
          const checked = selected.has(l.learner_id);
          return (
            <li key={l.learner_id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(l.learner_id)}
                aria-label={`选择 ${l.learner_id}`}
                data-test-id={`learner-select-${l.learner_id}`}
                className="mt-3"
              />
              <Link
                href={`/learn/${l.learner_id}`}
                className="card-sub flex flex-col gap-1 hover:border-accent flex-1"
                data-test-id={`learner-link-${l.learner_id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{l.topic}</span>
                  <span className="text-muted text-xs font-mono">{l.learner_id}</span>
                  <span className="chip">{l.count} 条对话</span>
                  <span className="ml-auto text-xs text-muted">
                    {l.position_chapter} / {l.position_challenge} · {l.points_total} 分
                  </span>
                </div>
                {l.preview ? (
                  <div className="text-xs text-muted">
                    <span className="chip">{roleLabel(l.last_role, l.last_who)}</span>{" "}
                    <span className="text-text">{l.preview}</span>
                    {l.last_ts && (
                      <span className="ml-2 text-muted/70">· {relativeTime(l.last_ts)}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted">尚无对话</div>
                )}
              </Link>
              <button
                className="btn-danger-ghost mt-2"
                onClick={() => deleteOne(l.learner_id, l.topic)}
                disabled={busy}
                data-test-id={`learner-delete-${l.learner_id}`}
                title="删除该学员旅程及所有对话记录"
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
