"use client";
import type { PointsBreakdown } from "@/lib/learning-runtime/learner-view";

interface Props {
  breakdown: PointsBreakdown;
  onClose: () => void;
}

const GRADE_COLOR: Record<string, string> = {
  good: "text-good",
  medium: "text-muted",
  poor: "text-bad",
};

const GRADE_SCORE: Record<string, number> = { good: 3, medium: 1, poor: 0 };

const STRATEGY_CHIP: Record<string, string> = {
  worked_example: "范例",
  contrastive_cases: "对照",
  chunked_walkthrough: "拆步",
  analogy_bridge: "类比",
  retrieval_prompt: "回忆",
  near_transfer_demo: "迁移",
  concept_scaffold: "结构",
  self_explanation: "复述",
};

export default function PointsBreakdownModal({ breakdown, onClose }: Props) {
  const { entries, totals } = breakdown;
  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      data-test-id="points-modal"
      onClick={onClose}
    >
      <div
        className="bg-white/95 rounded-[1.5rem] border border-border max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-amber-50/80">
          <div className="flex-1">
            <div className="font-semibold">点数明细</div>
            <div className="text-xs text-muted">
              每一次加分背后的具体理由都在这里。点数 = 每维度得分之和 × 挑战复杂度倍率。
            </div>
          </div>
          <button className="btn text-xs" onClick={onClose} data-test-id="points-modal-close">
            关闭
          </button>
        </div>
        <div className="px-4 py-3 border-b border-border grid grid-cols-3 gap-3 text-sm">
          <div className="card-sub">
            <div className="label">累计原始</div>
            <div className="text-accent text-lg" data-test-id="points-raw-total">{totals.raw}</div>
          </div>
          <div className="card-sub">
            <div className="label">有效稳固值</div>
            <div className="text-good text-lg">{totals.effective}</div>
          </div>
          <div className="card-sub">
            <div className="label">按动作聚合</div>
            <div className="text-xs text-muted mt-1 space-y-0.5">
              {Object.values(totals.by_action).length === 0 && <span>（暂无）</span>}
              {Object.values(totals.by_action).map((b) => (
                <div key={b.action_name}>
                  {b.action_name}: <span className="text-accent">{b.raw}</span> 分 · {b.count} 次
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {entries.length === 0 && (
            <div className="text-xs text-muted text-center mt-8">
              你还没有完成任何一轮评分。开始对话后，每一次加分的依据都会出现在这里。
            </div>
          )}
          {entries.map((e, i) => {
            const gradeEntries = Object.entries(e.grades);
            const gradeBreakdownExpr = gradeEntries
              .map(([dim, g]) => `${dim}:${g}(${GRADE_SCORE[g] ?? 0})`)
              .join(" + ");
            return (
              <div
                key={e.id}
                className="card-sub"
                data-test-id={`points-entry-${e.id}`}
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="chip">#{entries.length - i}</span>
                  <span className="text-xs text-muted">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                  <span className="text-xs text-muted">
                    {e.chapter_title ?? e.chapter_id} · {e.challenge_title ?? e.challenge_id}
                  </span>
                  <span className="chip">{e.complexity}</span>
                  {e.scaffold_strategy && (
                    <span
                      className="chip chip-stale"
                      title={`本轮 Narrator 走了「${e.scaffold_strategy}」认知支架策略`}
                      data-test-id={`scaffold-chip-${e.scaffold_strategy}`}
                    >
                      支架 · {STRATEGY_CHIP[e.scaffold_strategy] ?? e.scaffold_strategy}
                    </span>
                  )}
                  <span className="text-accent font-semibold ml-auto">
                    +{e.points_earned} 分
                  </span>
                </div>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {gradeEntries.map(([dim, g]) => (
                    <span key={dim} className={`chip ${GRADE_COLOR[g] ?? ""}`}>
                      {dim}:{g}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-muted mt-1">
                  计算：({gradeBreakdownExpr}) = {e.base_points} ×{" "}
                  {e.complexity_multiplier} = <span className="text-accent">{e.points_earned}</span> 分
                </div>
                {e.action_name && (
                  <div className="text-[11px] text-muted mt-0.5">
                    动作：{e.action_name}（{e.action_id}）
                  </div>
                )}
                {e.evidence && (
                  <div className="text-xs text-muted mt-1 whitespace-pre-wrap">
                    评语：{e.evidence}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
