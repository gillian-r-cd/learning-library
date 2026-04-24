import Link from "next/link";
import { notFound } from "next/navigation";
import { getLedgerById } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function LedgerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getLedgerById(id);
  if (!r) notFound();
  return (
    <div className="mx-auto max-w-6xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          调用详情 <span className="text-muted font-normal text-base">Call Detail</span>
        </h1>
        <span className="chip">{r.call_id}</span>
        <Link href="/admin/ledger" className="btn text-xs">← 返回 Back</Link>
        <Link href={`/admin/trace/${r.trace_id}`} className="btn text-xs">查看轨迹 View trace</Link>
      </header>

      <section className="grid md:grid-cols-4 gap-3 text-sm">
        <Info labelZh="阶段" labelEn="Stage" value={r.stage} />
        <Info labelZh="调用者" labelEn="Caller" value={r.caller} />
        <Info labelZh="模型" labelEn="Model" value={r.model} />
        <Info labelZh="状态" labelEn="Status" value={r.lifecycle.status} />
        <Info labelZh="延迟" labelEn="Latency" value={`${r.latency.total_duration_ms} ms`} />
        <Info labelZh="首 token" labelEn="TTFT" value={`${r.latency.time_to_first_token_ms} ms`} />
        <Info labelZh="Tokens" labelEn="Tokens" value={`${r.tokens.total}`} />
        <Info labelZh="Cache 命中" labelEn="Cache hit" value={`${(r.cache.hit_ratio * 100).toFixed(0)}%`} />
        <Info labelZh="成本" labelEn="Cost" value={`$${r.cost_usd.toFixed(5)}`} />
        <Info labelZh="学员可见" labelEn="User visible" value={String(r.user_visible)} />
        <Info
          labelZh="蓝图 ID"
          labelEn="Blueprint ID"
          value={(r.context as { blueprint_id?: string }).blueprint_id ?? "-"}
        />
        <Info
          labelZh="学员 ID"
          labelEn="Learner ID"
          value={(r.context as { learner_id?: string }).learner_id ?? "-"}
        />
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-2">
            原始输入 <span className="text-muted font-normal text-sm">Raw Input</span>
          </h3>
          <pre className="text-[10px] whitespace-pre-wrap text-muted" data-test-id="raw-input">
            {JSON.stringify(r.raw_input, null, 2)}
          </pre>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-2">
            原始输出 <span className="text-muted font-normal text-sm">Raw Output</span>
          </h3>
          <pre className="text-[10px] whitespace-pre-wrap text-muted" data-test-id="raw-output">
            {JSON.stringify(r.raw_output, null, 2)}
          </pre>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4 text-xs">
        <div className="card">
          <h3 className="font-semibold mb-2">
            上下文 <span className="text-muted font-normal text-sm">Context</span>
          </h3>
          <pre className="whitespace-pre-wrap text-muted">{JSON.stringify(r.context, null, 2)}</pre>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-2">
            生命周期 &amp; Tokens <span className="text-muted font-normal text-sm">Lifecycle &amp; Tokens</span>
          </h3>
          <pre className="whitespace-pre-wrap text-muted">
            {JSON.stringify(
              { lifecycle: r.lifecycle, tokens: r.tokens, cache: r.cache, latency: r.latency },
              null,
              2
            )}
          </pre>
        </div>
      </section>
    </div>
  );
}

function Info({
  labelZh,
  labelEn,
  value,
}: {
  labelZh: string;
  labelEn: string;
  value: string;
}) {
  return (
    <div className="card-sub">
      <div className="label">
        {labelZh} <span className="text-muted/70 normal-case">{labelEn}</span>
      </div>
      <div>{value}</div>
    </div>
  );
}
