// Scaffold metrics — derives per-strategy effectiveness from evidence_log.
//
// For every scaffolded evidence row (scaffold_strategy != null), we look at
// the NEXT chronological evidence row FOR THE SAME LEARNER & CHALLENGE and
// measure whether the learner's grade improved. Aggregated across learners,
// this answers the open question in Plan.md:
//   "脚手架的评价标准是什么？效果好坏如何衡量？"

import { db } from "@/lib/db";
import type { Grade, ScaffoldStrategy } from "@/lib/types/core";

export interface ScaffoldStrategyMetric {
  strategy: ScaffoldStrategy;
  fired_count: number;
  rebound_count: number; // next turn had at least one grade ≥ medium (not all-poor)
  rebound_to_good: number; // next turn had at least one grade = good
  rebound_rate: number; // rebound_count / fired_count
  rebound_to_good_rate: number;
  avg_grade_delta: number; // mean of next-turn best-grade-rank - this-turn best-grade-rank
}

export interface ScaffoldEvent {
  id: number;
  learner_id: string;
  ts: string;
  challenge_id: string;
  strategy: ScaffoldStrategy;
  /** max grade rank this turn (0=poor,1=medium,2=good). */
  this_best_rank: number;
  /** max grade rank next turn in same challenge, or null if no next turn yet. */
  next_best_rank: number | null;
  rebounded: boolean | null;
}

const GRADE_RANK: Record<Grade, number> = { poor: 0, medium: 1, good: 2 };

function bestGradeRank(grades: Record<string, Grade>): number {
  const vals = Object.values(grades);
  if (vals.length === 0) return 0;
  return Math.max(...vals.map((g) => GRADE_RANK[g] ?? 0));
}

export function listScaffoldEvents(): ScaffoldEvent[] {
  const rows = db()
    .prepare(
      `SELECT id, learner_id, ts, challenge_id, grades_json, scaffold_strategy
       FROM evidence_log
       WHERE scaffold_strategy IS NOT NULL
       ORDER BY id ASC`
    )
    .all() as Array<{
    id: number;
    learner_id: string;
    ts: string;
    challenge_id: string;
    grades_json: string;
    scaffold_strategy: string;
  }>;

  const events: ScaffoldEvent[] = [];
  for (const r of rows) {
    let grades: Record<string, Grade> = {};
    try {
      grades = JSON.parse(r.grades_json) as Record<string, Grade>;
    } catch {
      continue;
    }
    const thisBest = bestGradeRank(grades);
    // Look up the NEXT evidence row for the same (learner, challenge) after this one.
    const next = db()
      .prepare(
        `SELECT grades_json FROM evidence_log
         WHERE learner_id = ? AND challenge_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT 1`
      )
      .get(r.learner_id, r.challenge_id, r.id) as
      | { grades_json: string }
      | undefined;
    let nextBest: number | null = null;
    if (next) {
      try {
        const nextGrades = JSON.parse(next.grades_json) as Record<string, Grade>;
        nextBest = bestGradeRank(nextGrades);
      } catch {
        /* ignore */
      }
    }
    events.push({
      id: r.id,
      learner_id: r.learner_id,
      ts: r.ts,
      challenge_id: r.challenge_id,
      strategy: r.scaffold_strategy as ScaffoldStrategy,
      this_best_rank: thisBest,
      next_best_rank: nextBest,
      rebounded:
        nextBest == null
          ? null
          : nextBest >= 1 && nextBest >= thisBest, // next turn is at least medium AND not regressed
    });
  }
  return events;
}

export function aggregateStrategyMetrics(
  events: ScaffoldEvent[]
): ScaffoldStrategyMetric[] {
  const buckets = new Map<
    ScaffoldStrategy,
    {
      fired: number;
      rebound: number;
      reboundGood: number;
      deltaSum: number;
      deltaCount: number;
    }
  >();
  for (const e of events) {
    const b = buckets.get(e.strategy) ?? {
      fired: 0,
      rebound: 0,
      reboundGood: 0,
      deltaSum: 0,
      deltaCount: 0,
    };
    b.fired++;
    if (e.rebounded === true) b.rebound++;
    if (e.next_best_rank === 2) b.reboundGood++;
    if (e.next_best_rank != null) {
      b.deltaSum += e.next_best_rank - e.this_best_rank;
      b.deltaCount++;
    }
    buckets.set(e.strategy, b);
  }
  const out: ScaffoldStrategyMetric[] = [];
  for (const [strategy, b] of buckets.entries()) {
    out.push({
      strategy,
      fired_count: b.fired,
      rebound_count: b.rebound,
      rebound_to_good: b.reboundGood,
      rebound_rate: b.fired === 0 ? 0 : b.rebound / b.fired,
      rebound_to_good_rate: b.fired === 0 ? 0 : b.reboundGood / b.fired,
      avg_grade_delta: b.deltaCount === 0 ? 0 : b.deltaSum / b.deltaCount,
    });
  }
  // Sort by fired descending (most-used strategies on top).
  out.sort((a, b) => b.fired_count - a.fired_count);
  return out;
}
