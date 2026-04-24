import Link from "next/link";
import { computeMetrics } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default function MetricsPage() {
  const m = computeMetrics();
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          指标看板 <span className="text-muted font-normal text-base">Metrics</span>
        </h1>
        <Link href="/admin" className="btn text-xs">← 返回 Back</Link>
      </header>
      <section className="grid md:grid-cols-4 gap-3">
        <KPI labelZh="调用总数" labelEn="Total calls" value={m.total_calls} />
        <KPI labelZh="总成本" labelEn="Total cost (USD)" value={`$${m.total_cost_usd.toFixed(4)}`} />
        <KPI labelZh="总 Tokens" labelEn="Total tokens" value={m.total_tokens} />
        <KPI labelZh="成功率" labelEn="Success rate" value={`${(m.success_rate * 100).toFixed(0)}%`} />
        <KPI labelZh="平均延迟" labelEn="Avg latency" value={`${m.avg_latency_ms.toFixed(0)} ms`} />
        <KPI labelZh="P95 延迟" labelEn="P95 latency" value={`${m.p95_latency_ms} ms`} />
        <KPI labelZh="Cache 命中" labelEn="Cache hit" value={`${(m.cache_hit_ratio * 100).toFixed(0)}%`} />
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">
          按 Caller 聚合 <span className="text-muted font-normal text-sm">/ By Caller</span>
        </h2>
        <table className="text-xs w-full">
          <thead className="text-muted">
            <tr>
              <th className="text-left py-1">调用者 Caller</th>
              <th className="text-right py-1">次数 Count</th>
              <th className="text-right py-1">平均延迟 Avg Latency</th>
              <th className="text-right py-1">Cache 命中率 Cache Hit</th>
              <th className="text-right py-1">成本 Cost</th>
            </tr>
          </thead>
          <tbody>
            {m.by_caller.map((c) => (
              <tr key={c.caller} className="border-t border-border" data-test-id={`metric-caller-${c.caller}`}>
                <td className="py-1">{c.caller}</td>
                <td className="py-1 text-right">{c.count}</td>
                <td className="py-1 text-right">{c.avg_latency_ms.toFixed(0)} ms</td>
                <td className="py-1 text-right">{(c.cache_hit_ratio * 100).toFixed(0)}%</td>
                <td className="py-1 text-right">${c.cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">
          按 Stage 聚合 <span className="text-muted font-normal text-sm">/ By Stage</span>
        </h2>
        <table className="text-xs w-full">
          <thead className="text-muted">
            <tr>
              <th className="text-left py-1">阶段 Stage</th>
              <th className="text-right py-1">次数 Count</th>
              <th className="text-right py-1">成本 Cost</th>
            </tr>
          </thead>
          <tbody>
            {m.by_stage.map((s) => (
              <tr key={s.stage} className="border-t border-border">
                <td className="py-1">{s.stage}</td>
                <td className="py-1 text-right">{s.count}</td>
                <td className="py-1 text-right">${s.cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
        {labelZh} <span className="text-muted/70 normal-case">{labelEn}</span>
      </div>
      <div className="text-2xl font-bold text-accent mt-1">{value}</div>
    </div>
  );
}
