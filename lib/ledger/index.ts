// Raw Call Ledger (PRD §8.2.1)

import { db } from "@/lib/db";
import type { LedgerRecord } from "@/lib/types/core";

export function writeLedger(
  r: LedgerRecord,
  extra: { learner_id: string | null; blueprint_id: string | null }
) {
  db()
    .prepare(
      `INSERT INTO ledger (
        call_id, trace_id, parent_span_id, ts_start, ts_end, stage, caller, model,
        raw_input_json, raw_output_json, tokens_json, cache_json, latency_json, cost_usd,
        context_json, lifecycle_json, user_visible, content_safety_json,
        learner_id, blueprint_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      r.call_id,
      r.trace_id,
      r.parent_span_id ?? null,
      r.ts_start,
      r.ts_end,
      r.stage,
      r.caller,
      r.model,
      JSON.stringify(r.raw_input),
      JSON.stringify(r.raw_output),
      JSON.stringify(r.tokens),
      JSON.stringify(r.cache),
      JSON.stringify(r.latency),
      r.cost_usd,
      JSON.stringify(r.context),
      JSON.stringify(r.lifecycle),
      r.user_visible ? 1 : 0,
      JSON.stringify(r.content_safety),
      extra.learner_id,
      extra.blueprint_id
    );
}

export interface LedgerFilter {
  stage?: string;
  caller?: string;
  learner_id?: string;
  blueprint_id?: string;
  trace_id?: string;
  since?: string;
  until?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function queryLedger(filter: LedgerFilter = {}): LedgerRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.stage) {
    where.push("stage = ?");
    params.push(filter.stage);
  }
  if (filter.caller) {
    where.push("caller = ?");
    params.push(filter.caller);
  }
  if (filter.learner_id) {
    where.push("learner_id = ?");
    params.push(filter.learner_id);
  }
  if (filter.blueprint_id) {
    where.push("blueprint_id = ?");
    params.push(filter.blueprint_id);
  }
  if (filter.trace_id) {
    where.push("trace_id = ?");
    params.push(filter.trace_id);
  }
  if (filter.since) {
    where.push("ts_start >= ?");
    params.push(filter.since);
  }
  if (filter.until) {
    where.push("ts_start <= ?");
    params.push(filter.until);
  }
  const sql = `
    SELECT * FROM ledger
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ts_start DESC
    LIMIT ? OFFSET ?`;
  params.push(filter.limit ?? 100);
  params.push(filter.offset ?? 0);

  const rows = db().prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToLedger);
}

export function getLedgerById(call_id: string): LedgerRecord | null {
  const row = db()
    .prepare(`SELECT * FROM ledger WHERE call_id = ?`)
    .get(call_id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToLedger(row);
}

export function getLedgerByTrace(trace_id: string): LedgerRecord[] {
  const rows = db()
    .prepare(`SELECT * FROM ledger WHERE trace_id = ? ORDER BY ts_start ASC`)
    .all(trace_id) as Array<Record<string, unknown>>;
  return rows.map(rowToLedger);
}

function rowToLedger(row: Record<string, unknown>): LedgerRecord {
  return {
    call_id: row.call_id as string,
    trace_id: row.trace_id as string,
    parent_span_id: (row.parent_span_id as string | null) ?? null,
    ts_start: row.ts_start as string,
    ts_end: row.ts_end as string,
    stage: row.stage as LedgerRecord["stage"],
    caller: row.caller as string,
    model: row.model as string,
    raw_input: JSON.parse(row.raw_input_json as string),
    raw_output: JSON.parse(row.raw_output_json as string),
    tokens: JSON.parse(row.tokens_json as string),
    cache: JSON.parse(row.cache_json as string),
    latency: JSON.parse(row.latency_json as string),
    cost_usd: row.cost_usd as number,
    context: JSON.parse(row.context_json as string),
    lifecycle: JSON.parse(row.lifecycle_json as string),
    user_visible: Boolean(row.user_visible),
    content_safety: JSON.parse(row.content_safety_json as string),
  };
}

// ============ Metrics aggregation ============

export interface MetricsSummary {
  total_calls: number;
  total_cost_usd: number;
  total_tokens: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  success_rate: number;
  cache_hit_ratio: number;
  by_caller: Array<{
    caller: string;
    count: number;
    avg_latency_ms: number;
    cost_usd: number;
    cache_hit_ratio: number;
  }>;
  by_stage: Array<{ stage: string; count: number; cost_usd: number }>;
}

export function computeMetrics(window_sec?: number): MetricsSummary {
  const sinceClause = window_sec
    ? `WHERE ts_start >= datetime('now', '-${window_sec} seconds')`
    : "";
  const rows = db()
    .prepare(`SELECT * FROM ledger ${sinceClause} ORDER BY ts_start DESC`)
    .all() as Array<Record<string, unknown>>;
  const records = rows.map(rowToLedger);

  if (records.length === 0) {
    return {
      total_calls: 0,
      total_cost_usd: 0,
      total_tokens: 0,
      avg_latency_ms: 0,
      p95_latency_ms: 0,
      success_rate: 0,
      cache_hit_ratio: 0,
      by_caller: [],
      by_stage: [],
    };
  }

  const latencies = records.map((r) => r.latency.total_duration_ms).sort((a, b) => a - b);
  const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));

  const byCaller = new Map<
    string,
    { count: number; latencySum: number; cost: number; cacheSum: number }
  >();
  const byStage = new Map<string, { count: number; cost: number }>();
  let success = 0;
  let cacheSum = 0;
  let totalTokens = 0;

  for (const r of records) {
    const c = byCaller.get(r.caller) ?? {
      count: 0,
      latencySum: 0,
      cost: 0,
      cacheSum: 0,
    };
    c.count += 1;
    c.latencySum += r.latency.total_duration_ms;
    c.cost += r.cost_usd;
    c.cacheSum += r.cache.hit_ratio;
    byCaller.set(r.caller, c);

    const s = byStage.get(r.stage) ?? { count: 0, cost: 0 };
    s.count += 1;
    s.cost += r.cost_usd;
    byStage.set(r.stage, s);

    if (r.lifecycle.status === "success") success += 1;
    cacheSum += r.cache.hit_ratio;
    totalTokens += r.tokens.total;
  }

  return {
    total_calls: records.length,
    total_cost_usd: records.reduce((a, r) => a + r.cost_usd, 0),
    total_tokens: totalTokens,
    avg_latency_ms: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p95_latency_ms: latencies[p95Idx],
    success_rate: success / records.length,
    cache_hit_ratio: cacheSum / records.length,
    by_caller: Array.from(byCaller.entries()).map(([caller, v]) => ({
      caller,
      count: v.count,
      avg_latency_ms: v.latencySum / v.count,
      cost_usd: v.cost,
      cache_hit_ratio: v.cacheSum / v.count,
    })),
    by_stage: Array.from(byStage.entries()).map(([stage, v]) => ({
      stage,
      count: v.count,
      cost_usd: v.cost,
    })),
  };
}
