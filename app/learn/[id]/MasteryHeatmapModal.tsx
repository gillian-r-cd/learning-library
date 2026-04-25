"use client";
import { useState } from "react";
import type { MasteryHeatmap, HeatmapCell } from "@/lib/learning-runtime/learner-view";

interface Props {
  heatmap: MasteryHeatmap;
  onClose: () => void;
}

const GRADE_COLOR: Record<string, string> = {
  good: "bg-good/30 border-good/60 text-good",
  medium: "bg-warn/20 border-warn/50 text-warn",
  poor: "bg-bad/20 border-bad/50 text-bad",
};

const GRADE_LABEL: Record<string, string> = {
  good: "精通",
  medium: "摸到",
  poor: "初试",
};

function trend(recent: string[]): string {
  if (recent.length < 2) return "";
  // recent[0] = newest
  const rankOf = (g: string) => (g === "good" ? 2 : g === "medium" ? 1 : 0);
  const newest = rankOf(recent[0]);
  const prev = rankOf(recent[1]);
  if (newest > prev) return "上升";
  if (newest < prev) return "回落";
  return "稳定";
}

export default function MasteryHeatmapModal({ heatmap, onClose }: Props) {
  const [selected, setSelected] = useState<HeatmapCell | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
      data-test-id="mastery-heatmap-modal"
      onClick={onClose}
    >
      <div
        className="bg-panel/95 rounded-2xl border border-good/30 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex-1">
            <div className="font-semibold">能力地图</div>
            <div className="text-xs text-muted">
              每个动作 × 每档难度都有一格。把格子点亮，就是把这个主题练成自己的能力。
            </div>
          </div>
          <button className="btn text-xs" onClick={onClose} data-test-id="mastery-heatmap-close">
            关闭
          </button>
        </div>
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 text-sm">
          <span>
            覆盖度：
            <span className="text-accent font-semibold" data-test-id="mastery-good-cells">
              {heatmap.good_cells}
            </span>
            <span className="text-muted"> / {heatmap.total_cells} 格已精通</span>
          </span>
          <span className="ml-auto text-xs text-muted">
            精通 · 摸到 · 初试 · 未触及
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {heatmap.actions.length === 0 ? (
            <p className="text-xs text-muted">旅程尚未配置核心动作。</p>
          ) : (
            <table className="text-xs w-full" data-test-id="mastery-heatmap-table">
              <thead>
                <tr className="text-muted">
                  <th className="text-left py-1 pr-3">动作</th>
                  {heatmap.complexities.map((c) => (
                    <th key={c} className="text-center py-1 px-2">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.actions.map((a) => (
                  <tr key={a.action_id} className="border-t border-border">
                    <td className="py-2 pr-3 font-semibold">{a.action_name}</td>
                    {heatmap.complexities.map((c) => {
                      const cell = heatmap.cells[`${a.action_id}|${c}`];
                      if (!cell) return <td key={c} className="py-2 px-2" />;
                      const color = cell.best_grade
                        ? GRADE_COLOR[cell.best_grade]
                        : "bg-panel2 border-border text-muted/60";
                      const label = cell.best_grade
                        ? GRADE_LABEL[cell.best_grade]
                        : "未触及";
                      return (
                        <td key={c} className="py-2 px-1">
                          <button
                            className={`w-full rounded-md border p-2 text-center transition-colors hover:brightness-110 ${color}`}
                            onClick={() => setSelected(cell)}
                            data-test-id={`mastery-cell-${a.action_id}-${c}`}
                          >
                            <div className="font-semibold text-xs">{label}</div>
                            <div className="text-[10px] mt-0.5">
                              {cell.turn_count} 次 {trend(cell.recent_grades)}
                            </div>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {selected && (
          <div
            className="border-t border-border p-4 bg-panel2"
            data-test-id="mastery-cell-detail"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {selected.action_name} · {selected.complexity}
              </span>
              {selected.best_grade && (
                <span className={`chip ${GRADE_COLOR[selected.best_grade]}`}>
                  {GRADE_LABEL[selected.best_grade]}
                </span>
              )}
              <button
                className="btn text-xs ml-auto"
                onClick={() => setSelected(null)}
              >
                收起
              </button>
            </div>
            <div className="text-xs text-muted mt-1">
              累计 {selected.turn_count} 次 · 最近 {selected.recent_grades.join(", ") || "（无）"}
            </div>
            {selected.best_quote && (
              <div className="card-sub mt-2 text-xs">
                <div className="label">你的最佳评语</div>
                <div className="text-muted mt-1 whitespace-pre-wrap">
                  {selected.best_quote}
                </div>
                {selected.best_quote_challenge_title && (
                  <div className="text-[11px] text-muted/70 mt-1">
                    — 发生在挑战「{selected.best_quote_challenge_title}」
                  </div>
                )}
              </div>
            )}
            {!selected.best_quote && selected.turn_count === 0 && (
              <div className="text-xs text-muted mt-2">
                还没有练到这一格——等你到了绑定这个动作 × {selected.complexity} 难度的挑战时，它会自然被填上。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
