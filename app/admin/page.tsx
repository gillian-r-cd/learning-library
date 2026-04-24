import Link from "next/link";
import { computeMetrics, queryLedger } from "@/lib/ledger";
import { listPromptKeys } from "@/lib/prompt-store";

export const dynamic = "force-dynamic";

export default function AdminHome() {
  const metrics = computeMetrics();
  const recent = queryLedger({ limit: 5 });
  const prompts = listPromptKeys().filter((k) => k.scope === "system");

  // Featured prompts: the ones most designers/ops will want to tweak.
  const FEATURED = [
    "skill_1_gamecore.template",
    "skill_3_script_fill.template",
    "judge.template",
    "narrator.template",
  ];
  const featured = prompts.filter((p) => FEATURED.includes(p.key));

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">运维后台 Admin Console</h1>
        <p className="text-sm text-muted">Ledger · Metrics · Prompts · Trace</p>
      </header>

      <section className="grid md:grid-cols-4 gap-3">
        <KPI labelZh="调用总数" labelEn="Total calls" value={metrics.total_calls} />
        <KPI labelZh="成本" labelEn="Cost (USD)" value={`$${metrics.total_cost_usd.toFixed(4)}`} />
        <KPI labelZh="P95 延迟" labelEn="P95 latency" value={`${metrics.p95_latency_ms} ms`} />
        <KPI labelZh="Cache 命中" labelEn="Cache hit" value={`${(metrics.cache_hit_ratio * 100).toFixed(0)}%`} />
      </section>

      <section className="grid md:grid-cols-3 gap-3">
        <Link href="/admin/ledger" className="card hover:border-accent" data-test-id="admin-ledger-link">
          <h3 className="font-semibold">
            Raw Call Ledger <span className="text-muted font-normal text-sm">原始调用账本</span>
          </h3>
          <p className="text-sm text-muted mt-2">所有 LLM 调用的原始 I/O / raw input &amp; output for every LLM call</p>
        </Link>
        <Link href="/admin/prompts" className="card hover:border-accent" data-test-id="admin-prompts-link">
          <h3 className="font-semibold">
            Prompt Store <span className="text-muted font-normal text-sm">提示词仓库</span>
          </h3>
          <p className="text-sm text-muted mt-2">
            ✏️ 系统级 + 课程级两级继承，点开任意模板即可编辑 / publish 新版本<br />
            System + course tier · click any template to edit &amp; publish
          </p>
        </Link>
        <Link href="/admin/metrics" className="card hover:border-accent" data-test-id="admin-metrics-link">
          <h3 className="font-semibold">
            Metrics <span className="text-muted font-normal text-sm">指标看板</span>
          </h3>
          <p className="text-sm text-muted mt-2">
            延迟 / 成本 / Cache / caller 分布 · latency, cost, cache ratio by caller
          </p>
        </Link>
        <Link href="/admin/scaffold" className="card hover:border-accent" data-test-id="admin-scaffold-link">
          <h3 className="font-semibold">
            Scaffold <span className="text-muted font-normal text-sm">认知支架效果</span>
          </h3>
          <p className="text-sm text-muted mt-2">
            8 种认知策略的触发次数 + 回弹率 + 分档增量。衡量 scaffold 机制是否真的在救学员。
          </p>
        </Link>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">
          ✏️ 常用提示词快速编辑 <span className="text-muted text-sm font-normal">/ Quick-edit featured prompts</span>
        </h2>
        <p className="text-xs text-muted mb-3">
          这些是设计师/运营最常改的模板。点击进入编辑器，支持 Publish 新版本 + 版本历史 + 模型切换。
          <br />
          These templates are the ones ops most often tweak. Click to open the editor — supports versioning &amp; model swap.
        </p>
        <div className="grid md:grid-cols-2 gap-2">
          {featured.map((p) => (
            <Link
              key={p.key}
              href={`/admin/prompts/edit?key=${encodeURIComponent(p.key)}&scope=system`}
              className="card-sub flex items-center justify-between hover:border-accent"
              data-test-id={`home-prompt-${p.key}`}
            >
              <span>
                <span className="font-mono text-accent text-xs">{p.key}</span>
                <span className="text-muted text-xs"> · v{p.version}</span>
              </span>
              <span className="text-xs text-muted">编辑 Edit →</span>
            </Link>
          ))}
        </div>
        <div className="mt-3">
          <Link href="/admin/prompts" className="text-xs text-accent">
            查看全部 11 条系统级模板 + 所有课程级 override → / Browse all system + course-level templates →
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">
          最近 5 次调用 <span className="text-muted text-sm font-normal">/ Recent 5 calls</span>
        </h2>
        <table className="text-xs w-full">
          <thead>
            <tr className="text-muted">
              <th className="text-left py-1">时间 Time</th>
              <th className="text-left py-1">阶段 Stage</th>
              <th className="text-left py-1">调用者 Caller</th>
              <th className="text-left py-1">模型 Model</th>
              <th className="text-right py-1">延迟 Latency</th>
              <th className="text-right py-1">Tokens</th>
              <th className="text-right py-1">成本 Cost</th>
              <th className="text-right py-1">调用 Call</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.call_id} className="border-t border-border">
                <td className="py-1">{new Date(r.ts_start).toLocaleTimeString()}</td>
                <td className="py-1">{r.stage}</td>
                <td className="py-1">{r.caller}</td>
                <td className="py-1">{r.model}</td>
                <td className="py-1 text-right">{r.latency.total_duration_ms} ms</td>
                <td className="py-1 text-right">{r.tokens.total}</td>
                <td className="py-1 text-right">${r.cost_usd.toFixed(4)}</td>
                <td className="py-1 text-right">
                  <Link href={`/admin/ledger/${r.call_id}`} className="text-accent">
                    {r.call_id}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && (
          <p className="text-xs text-muted">账本为空。跑一下设计或学习流就会有数据。 / Empty — run a design or learning flow to populate.</p>
        )}
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
        {labelZh} <span className="normal-case text-muted/70">{labelEn}</span>
      </div>
      <div className="text-2xl font-bold text-accent mt-1">{value}</div>
    </div>
  );
}
