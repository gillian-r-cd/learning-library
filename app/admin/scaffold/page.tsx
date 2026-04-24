import Link from "next/link";
import {
  listScaffoldEvents,
  aggregateStrategyMetrics,
} from "@/lib/scaffold-metrics";

export const dynamic = "force-dynamic";

const STRATEGY_LABEL: Record<string, string> = {
  worked_example: "给范例",
  contrastive_cases: "对照案例",
  chunked_walkthrough: "拆步·替走第一步",
  analogy_bridge: "类比搭桥",
  retrieval_prompt: "检索性提问",
  near_transfer_demo: "近迁移锚点",
  concept_scaffold: "概念结构清单",
  self_explanation: "自我解释",
};

export default function ScaffoldMetricsPage() {
  const events = listScaffoldEvents();
  const metrics = aggregateStrategyMetrics(events);
  const totalFired = events.length;
  const totalRebound = events.filter((e) => e.rebounded === true).length;
  const overallRate = totalFired === 0 ? 0 : totalRebound / totalFired;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          认知支架效果 <span className="text-muted text-lg font-normal">/ Scaffold effectiveness</span>
        </h1>
        <p className="text-sm text-muted mt-1">
          每个 evidence 行都带 scaffold_strategy（如果本轮 Judge 决策为 scaffold / simplify_challenge）。
          我们对比"支架触发那轮"和"下一轮"的最高 grade rank（poor=0 · medium=1 · good=2）来衡量学员是否被救回来。
        </p>
      </header>

      <section className="grid md:grid-cols-3 gap-3" data-test-id="scaffold-kpis">
        <KPI labelZh="支架触发次数" labelEn="Fires" value={totalFired} />
        <KPI
          labelZh="回弹率 (≥ medium)"
          labelEn="Rebound rate"
          value={`${(overallRate * 100).toFixed(0)}%`}
        />
        <KPI
          labelZh="策略种类"
          labelEn="Strategies used"
          value={metrics.length}
        />
      </section>

      <section className="card" data-test-id="scaffold-strategy-table">
        <h2 className="font-semibold mb-3">
          按策略拆解 <span className="text-muted text-sm font-normal">/ By strategy</span>
        </h2>
        {metrics.length === 0 ? (
          <p className="text-xs text-muted">
            还没有支架触发记录。等学员跑到连续 poor / 说「我不知道」时，Judge
            会产出带 scaffold_strategy 的 evidence，这里就会有数。
          </p>
        ) : (
          <table className="text-xs w-full">
            <thead>
              <tr className="text-muted">
                <th className="text-left py-1">策略 Strategy</th>
                <th className="text-right py-1">触发 Fires</th>
                <th className="text-right py-1">回弹 ≥ medium</th>
                <th className="text-right py-1">回弹到 good</th>
                <th className="text-right py-1">回弹率</th>
                <th className="text-right py-1">↗ good 率</th>
                <th className="text-right py-1">平均分档增量</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr
                  key={m.strategy}
                  className="border-t border-border"
                  data-test-id={`scaffold-row-${m.strategy}`}
                >
                  <td className="py-1">
                    <span className="chip">{m.strategy}</span>{" "}
                    <span className="text-muted">
                      {STRATEGY_LABEL[m.strategy] ?? ""}
                    </span>
                  </td>
                  <td className="py-1 text-right">{m.fired_count}</td>
                  <td className="py-1 text-right">{m.rebound_count}</td>
                  <td className="py-1 text-right">{m.rebound_to_good}</td>
                  <td className="py-1 text-right">
                    <span
                      className={
                        m.rebound_rate >= 0.5
                          ? "text-good"
                          : m.rebound_rate >= 0.3
                          ? "text-warn"
                          : "text-bad"
                      }
                    >
                      {(m.rebound_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-1 text-right">
                    {(m.rebound_to_good_rate * 100).toFixed(0)}%
                  </td>
                  <td className="py-1 text-right">
                    {m.avg_grade_delta >= 0 ? "+" : ""}
                    {m.avg_grade_delta.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-muted mt-3">
          说明：回弹率 = 支架触发后的下一轮里，学员至少拿到一个 medium 并且没回退的比例。
          平均分档增量 &gt; 0 意味着策略平均能把学员推上一档；≈ 0 是原地；&lt; 0 是反而后退。
          策略有效性需要累计多次触发后才稳定——个位数样本下数字仅供参考。
        </p>
      </section>

      <section className="card" data-test-id="scaffold-recent-events">
        <h2 className="font-semibold mb-3">
          最近 20 次支架触发 <span className="text-muted text-sm font-normal">/ Recent 20 scaffold firings</span>
        </h2>
        {events.length === 0 ? (
          <p className="text-xs text-muted">还没有记录。</p>
        ) : (
          <table className="text-xs w-full">
            <thead>
              <tr className="text-muted">
                <th className="text-left py-1">时间</th>
                <th className="text-left py-1">Learner</th>
                <th className="text-left py-1">挑战</th>
                <th className="text-left py-1">策略</th>
                <th className="text-right py-1">当轮 rank</th>
                <th className="text-right py-1">下轮 rank</th>
                <th className="text-right py-1">回弹</th>
              </tr>
            </thead>
            <tbody>
              {events
                .slice()
                .reverse()
                .slice(0, 20)
                .map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-1">{new Date(e.ts).toLocaleTimeString()}</td>
                    <td className="py-1 font-mono text-[10px]">{e.learner_id}</td>
                    <td className="py-1 font-mono text-[10px]">{e.challenge_id}</td>
                    <td className="py-1">
                      <span className="chip">{e.strategy}</span>
                    </td>
                    <td className="py-1 text-right">{e.this_best_rank}</td>
                    <td className="py-1 text-right">
                      {e.next_best_rank == null ? "—" : e.next_best_rank}
                    </td>
                    <td className="py-1 text-right">
                      {e.rebounded == null
                        ? "…"
                        : e.rebounded
                        ? "✅"
                        : "❌"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      <Link href="/admin" className="text-xs text-accent">
        ← 返回 Admin 首页
      </Link>
    </div>
  );
}

function KPI({
  labelZh,
  labelEn,
  value,
}: {
  labelZh: string;
  labelEn: string;
  value: string | number;
}) {
  return (
    <div className="card">
      <div className="label">
        {labelZh} <span className="normal-case text-muted/70">{labelEn}</span>
      </div>
      <div className="text-2xl font-bold text-accent mt-1">{value}</div>
    </div>
  );
}
