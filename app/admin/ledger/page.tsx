import Link from "next/link";
import { queryLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function LedgerList({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; caller?: string; learner_id?: string; blueprint_id?: string }>;
}) {
  const sp = await searchParams;
  const rows = queryLedger({ ...sp, limit: 200 });
  return (
    <div className="mx-auto max-w-6xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          原始调用账本 <span className="text-muted font-normal text-base">Raw Call Ledger</span>
        </h1>
        <Link href="/admin" className="btn text-xs">← 返回 Back</Link>
      </header>

      <form className="card flex items-end gap-2 text-xs">
        <LabeledSelect
          name="stage"
          options={["", "design", "learning", "eval"]}
          labelZh="阶段"
          labelEn="Stage"
          defaultValue={sp.stage ?? ""}
        />
        <LabeledSelect
          name="caller"
          options={[
            "",
            "skill_1_gamecore",
            "skill_2_experience",
            "skill_3_script_skeleton",
            "skill_3_script_fill",
            "skill_4_companion",
            "design_copilot_chat",
            "judge",
            "narrator",
          ]}
          labelZh="调用者"
          labelEn="Caller"
          defaultValue={sp.caller ?? ""}
        />
        <LabeledInput name="learner_id" labelZh="学员 ID" labelEn="Learner ID" defaultValue={sp.learner_id ?? ""} />
        <LabeledInput name="blueprint_id" labelZh="蓝图 ID" labelEn="Blueprint ID" defaultValue={sp.blueprint_id ?? ""} />
        <button className="btn-primary" data-test-id="filter-apply">
          筛选 Filter
        </button>
      </form>

      <section className="card overflow-x-auto">
        <table className="text-xs w-full min-w-[900px]">
          <thead className="text-muted">
            <tr>
              <th className="text-left py-1">时间 Time</th>
              <th className="text-left py-1">阶段 Stage</th>
              <th className="text-left py-1">调用者 Caller</th>
              <th className="text-left py-1">模型 Model</th>
              <th className="text-right py-1">延迟 Latency</th>
              <th className="text-right py-1">
                Tokens <span className="normal-case text-muted/70">(in+out/cache)</span>
              </th>
              <th className="text-right py-1">Cache 命中率</th>
              <th className="text-right py-1">成本 Cost</th>
              <th className="text-left py-1">轨迹 Trace</th>
              <th className="text-left py-1">调用 Call</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.call_id} className="border-t border-border">
                <td className="py-1">{new Date(r.ts_start).toLocaleTimeString()}</td>
                <td className="py-1">{r.stage}</td>
                <td className="py-1">{r.caller}</td>
                <td className="py-1">{r.model}</td>
                <td className="py-1 text-right">{r.latency.total_duration_ms} ms</td>
                <td className="py-1 text-right">
                  {r.tokens.input}+{r.tokens.output}/{r.tokens.cache_read}
                </td>
                <td className="py-1 text-right">{(r.cache.hit_ratio * 100).toFixed(0)}%</td>
                <td className="py-1 text-right">${r.cost_usd.toFixed(4)}</td>
                <td className="py-1">
                  <Link className="text-accent" href={`/admin/trace/${r.trace_id}`}>
                    {r.trace_id}
                  </Link>
                </td>
                <td className="py-1">
                  <Link
                    className="text-accent"
                    data-test-id={`ledger-row-${r.call_id}`}
                    href={`/admin/ledger/${r.call_id}`}
                  >
                    详情 Detail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-xs text-muted">没有匹配记录。 / No matching records.</p>
        )}
      </section>
    </div>
  );
}

function LabeledSelect({
  name,
  labelZh,
  labelEn,
  options,
  defaultValue,
}: {
  name: string;
  labelZh: string;
  labelEn: string;
  options: string[];
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col">
      <span className="label mb-1">
        {labelZh} <span className="text-muted/70">{labelEn}</span>
      </span>
      <select name={name} defaultValue={defaultValue} className="input">
        {options.map((o) => (
          <option key={o} value={o}>
            {o || "(全部 All)"}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledInput({
  name,
  labelZh,
  labelEn,
  defaultValue,
}: {
  name: string;
  labelZh: string;
  labelEn: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col">
      <span className="label mb-1">
        {labelZh} <span className="text-muted/70">{labelEn}</span>
      </span>
      <input name={name} defaultValue={defaultValue} className="input" />
    </label>
  );
}
