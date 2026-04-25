"use client";
import { useState } from "react";
import type { JourneyProgress } from "@/lib/learning-runtime/progress";

export default function ProgressPanel({ progress }: { progress: JourneyProgress | null }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!progress) {
    return (
      <div className="stage-card">
        <div className="label">旅程进度</div>
        <p className="text-xs text-muted mt-1">
          蓝图尚未生成剧本，进度将在剧本就绪后显示。
        </p>
      </div>
    );
  }

  const percent = Math.round(
    (progress.completed_challenges / Math.max(1, progress.total_challenges)) * 100
  );

  return (
    <div className="stage-card" data-test-id="progress-panel">
      <div className="flex items-center justify-between">
        <div className="label">章节路线</div>
        <div className="text-xs text-muted">
          {progress.completion_ratio}{" "}
          <span className="text-muted/70">({percent}%)</span>
        </div>
      </div>

      {/* overall bar */}
      <div className="mt-2 h-2 rounded-full bg-panel2 overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${percent}%` }}
          data-test-id="progress-bar"
        />
      </div>

      <ul className="mt-3 space-y-2 text-xs">
        {progress.chapters.map((chap) => {
          const isCollapsed =
            collapsed[chap.chapter_id] ??
            chap.chapter_status === "completed"; // completed chapters collapse by default
          return (
            <li
              key={chap.chapter_id}
              className={
                chap.chapter_status === "current"
                  ? "card-sub !border-accent"
                  : chap.chapter_status === "completed"
                  ? "card-sub opacity-70"
                  : "card-sub"
              }
              data-test-id={`progress-chap-${chap.chapter_id}`}
              data-chapter-status={chap.chapter_status}
            >
              <button
                className="w-full text-left flex items-center gap-2"
                onClick={() =>
                  setCollapsed((s) => ({ ...s, [chap.chapter_id]: !isCollapsed }))
                }
              >
                  <span className="text-muted/70">第 {chap.chapter_index} 章</span>
                <span
                  className={
                    chap.chapter_status === "current"
                      ? "font-semibold text-accent"
                      : "font-semibold"
                  }
                >
                  {chap.chapter_title}
                </span>
                <span
                  className={`chip ${
                    chap.chapter_status === "completed"
                      ? "chip-confirmed"
                      : chap.chapter_status === "current"
                      ? "!border-accent !text-accent"
                      : "chip-draft"
                  }`}
                >
                  {chap.chapter_status === "completed"
                    ? "已完成"
                    : chap.chapter_status === "current"
                    ? "进行中"
                    : "待解锁"}
                </span>
                <span className="ml-auto text-muted/60 text-[10px]">
                  {isCollapsed ? "展开" : "收起"}
                </span>
              </button>
              {chap.milestone_summary && (
                <div className="text-muted mt-1 text-[11px]">
                  里程碑：{chap.milestone_summary}
                </div>
              )}
              {!isCollapsed && (
                <ul className="mt-2 ml-2 space-y-1 border-l border-border pl-2">
                  {chap.challenges.map((ch) => (
                    <li
                      key={ch.challenge_id}
                      className={
                        ch.status === "current"
                          ? "flex items-center gap-1.5 text-accent"
                          : ch.status === "completed"
                          ? "flex items-center gap-1.5 text-good"
                          : "flex items-center gap-1.5 text-muted"
                      }
                      data-test-id={`progress-ch-${ch.challenge_id}`}
                      data-challenge-status={ch.status}
                    >
                      <span className="w-8 shrink-0 text-[10px]">
                        {ch.status === "completed"
                          ? "完成"
                          : ch.status === "current"
                          ? "当前"
                          : "待启"}
                      </span>
                      <span className="truncate">{ch.title}</span>
                      <span className="chip text-[9px]">{ch.complexity}</span>
                      {ch.status === "current" &&
                        typeof ch.turn_idx_in_current === "number" && (
                          <span className="text-muted/80 text-[10px]">
                            · 第 {ch.turn_idx_in_current + 1} 回合
                          </span>
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
