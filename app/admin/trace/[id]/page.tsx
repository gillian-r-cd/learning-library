import Link from "next/link";
import { getLedgerByTrace } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function TraceView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const records = getLedgerByTrace(id);
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          调用轨迹 <span className="text-muted font-normal text-base">Trace</span>
        </h1>
        <span className="chip">{id}</span>
        <Link href="/admin/ledger" className="btn text-xs">← 返回账本 Back to Ledger</Link>
      </header>
      {records.length === 0 ? (
        <p className="card text-sm text-muted">
          未找到该 trace 的记录。 / No records found for this trace.
        </p>
      ) : (
        <section className="card space-y-2">
          {records.map((r, i) => (
            <div key={r.call_id} className="card-sub" data-test-id={`trace-span-${i}`}>
              <div className="flex items-center gap-2">
                <span className="chip">{r.caller}</span>
                <span className="text-xs text-muted">{r.model}</span>
                <span className="text-xs text-muted">
                  {new Date(r.ts_start).toLocaleTimeString()} ({r.latency.total_duration_ms} ms)
                </span>
                <span className="ml-auto">
                  <Link href={`/admin/ledger/${r.call_id}`} className="text-accent text-xs">
                    详情 Detail
                  </Link>
                </span>
              </div>
              <div className="mt-1 text-[10px] text-muted">
                父节点 parent: {r.parent_span_id ?? "—"} · tokens {r.tokens.total} · 成本 cost $
                {r.cost_usd.toFixed(5)}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
