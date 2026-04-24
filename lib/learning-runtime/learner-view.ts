// Learner-facing read models:
//   - PointsBreakdown: a full audit trail of every point-earning event
//     (evidence row + challenge lookup + complexity multiplier applied).
//   - CompanionLibrary: unlocked + locked companions with rich intro and
//     recent speech counts, used by the CompanionLibrary drawer.
//
// Pure code; no LLM calls.

import type {
  Blueprint,
  Companion,
  Complexity,
  EvidenceEntry,
  Grade,
  LearnerState,
  ScaffoldStrategy,
  SignatureMove,
} from "@/lib/types/core";
import { listEvidence } from "@/lib/state-manager";
import { db } from "@/lib/db";
import {
  DEFAULT_FRAMEWORK,
  computePoints,
  daysBetween,
  effectivePoints,
} from "@/lib/points";

// ============================================================================
// Points breakdown
// ============================================================================

export interface PointsBreakdownEntry {
  id: number;
  ts: string;
  turn_idx: number;
  chapter_id: string | null;
  chapter_title: string | null;
  challenge_id: string;
  challenge_title: string | null;
  action_id: string;
  action_name: string | null;
  grades: Record<string, Grade>;
  complexity: Complexity;
  /** Breakdown of the formula: base (sum of grade scores) × multiplier = earned. */
  base_points: number;
  complexity_multiplier: number;
  points_earned: number;
  evidence: string;
  /** If this turn was produced in scaffold / simplify_challenge mode, the
   *  strategy Judge chose (e.g., worked_example). Null for normal turns. */
  scaffold_strategy: ScaffoldStrategy | null;
  scaffold_assisted: boolean;
}

export interface PointsBreakdown {
  entries: PointsBreakdownEntry[]; // newest first
  totals: {
    raw: number;
    effective: number;
    by_action: Record<string, { raw: number; count: number; action_name: string }>;
  };
}

export function buildPointsBreakdown(
  learnerId: string,
  bp: Blueprint
): PointsBreakdown {
  // Read ALL evidence (no limit). If a learner has thousands of turns we can
  // paginate later; today the cap is in the tens.
  const rows = db()
    .prepare(
      `SELECT * FROM evidence_log WHERE learner_id = ? ORDER BY id DESC`
    )
    .all(learnerId) as Array<Record<string, unknown>>;

  // Build lookup tables from blueprint
  const chapterOfChallenge = new Map<string, { chapter_id: string; chapter_title: string; challenge_title: string; complexity: Complexity }>();
  for (const chap of bp.step3_script?.chapters ?? []) {
    for (const ch of chap.challenges ?? []) {
      chapterOfChallenge.set(ch.challenge_id, {
        chapter_id: chap.chapter_id,
        chapter_title: chap.title,
        challenge_title: ch.title,
        complexity: ch.complexity,
      });
    }
  }
  const actionNames = new Map<string, string>();
  for (const a of bp.step1_gamecore?.core_actions ?? []) {
    actionNames.set(a.action_id, a.name);
  }

  const entries: PointsBreakdownEntry[] = rows.map((r) => {
    const grades = JSON.parse(r.grades_json as string) as Record<string, Grade>;
    const storedComplexity = typeof r.complexity === "string" ? (r.complexity as Complexity) : null;
    const challengeMeta = chapterOfChallenge.get(r.challenge_id as string);
    // Prefer stored complexity (authoritative at award time); fall back to
    // blueprint lookup for legacy rows.
    const complexity: Complexity =
      storedComplexity ?? challengeMeta?.complexity ?? "low";

    const fw = DEFAULT_FRAMEWORK.instance_params;
    const baseScores = Object.values(grades).map((g) => fw.base_points[g]);
    const base = baseScores.reduce((a, b) => a + b, 0);
    const mult = fw.complexity_multiplier[complexity];

    const storedEarned = typeof r.points_earned === "number" ? (r.points_earned as number) : null;
    const earned =
      storedEarned ?? computePoints({ grades: Object.values(grades), complexity });

    return {
      id: r.id as number,
      ts: r.ts as string,
      turn_idx: r.turn_idx as number,
      chapter_id: challengeMeta?.chapter_id ?? null,
      chapter_title: challengeMeta?.chapter_title ?? null,
      challenge_id: r.challenge_id as string,
      challenge_title: challengeMeta?.challenge_title ?? null,
      action_id: r.action_id as string,
      action_name: actionNames.get(r.action_id as string) ?? null,
      grades,
      complexity,
      base_points: base,
      complexity_multiplier: mult,
      points_earned: earned,
      evidence: r.evidence as string,
      scaffold_strategy:
        typeof r.scaffold_strategy === "string"
          ? (r.scaffold_strategy as ScaffoldStrategy)
          : null,
      scaffold_assisted: Boolean(r.scaffold_assisted),
    };
  });

  const totalsByAction: PointsBreakdown["totals"]["by_action"] = {};
  let rawTotal = 0;
  for (const e of entries) {
    rawTotal += e.points_earned;
    const bucket = totalsByAction[e.action_id] ?? {
      raw: 0,
      count: 0,
      action_name: e.action_name ?? e.action_id,
    };
    bucket.raw = Math.round((bucket.raw + e.points_earned) * 10) / 10;
    bucket.count += 1;
    totalsByAction[e.action_id] = bucket;
  }
  rawTotal = Math.round(rawTotal * 10) / 10;

  // Re-compute effective total with decay (same formula as buildSnapshot).
  const now = new Date().toISOString();
  const state = db()
    .prepare(`SELECT data_json FROM learner_states WHERE learner_id = ?`)
    .get(learnerId) as { data_json: string } | undefined;
  let effTotal = 0;
  if (state) {
    const s = JSON.parse(state.data_json) as LearnerState;
    for (const [, info] of Object.entries(s.points.by_action)) {
      const days = info.last_review_at ? daysBetween(info.last_review_at, now) : 0;
      effTotal += effectivePoints({
        raw: info.raw,
        stabilityDays: info.stability,
        elapsedDays: days,
      });
    }
    effTotal = Math.round(effTotal * 10) / 10;
  }

  return {
    entries,
    totals: { raw: rawTotal, effective: effTotal, by_action: totalsByAction },
  };
}

// ============================================================================
// Companion library
// ============================================================================

export interface CompanionRelationshipStage {
  level: number;
  stance: string;
}

export interface CompanionLibraryCard {
  companion_id: string;
  display_name: string;
  companion_type: string;
  output_format: string;
  unique_value_hypothesis: string;
  effectiveness_mechanism: string;
  persona_background: string;
  personality_traits: string[];
  typical_phrases: string[];
  relationship_stages: CompanionRelationshipStage[];
  speak_when: string;
  silent_when: string;
  upgrade_path: { level: number; delta: string }[];
  unlock_threshold: number;
  io_max_tokens: number;
}

export interface UnlockedCompanionCard extends CompanionLibraryCard {
  status: "unlocked";
  level: number;
  unlocked_at: string;
  /** Count of bubbles spoken by this companion so far. */
  speech_count: number;
  /** Up to 3 most recent bubbles the companion said (newest first). */
  recent_speeches: Array<{ turn_idx: number; ts: string; text: string }>;
}

export interface LockedCompanionCard extends CompanionLibraryCard {
  status: "locked";
  /** Current effective total — used by UI to show "差 X 分". */
  effective_total_now: number;
  points_needed: number; // max(0, threshold - effective_total_now)
  /** Teaser index — the order this companion will unlock at (1-based). */
  unlock_order: number | null;
}

export interface CompanionLibrary {
  unlocked: UnlockedCompanionCard[];
  locked: LockedCompanionCard[];
}

export function buildCompanionLibrary(
  learnerId: string,
  bp: Blueprint,
  state: LearnerState,
  effectiveTotal: number
): CompanionLibrary {
  const defs = bp.step4_companions?.companions ?? [];
  if (defs.length === 0) return { unlocked: [], locked: [] };

  const unlockedMap = new Map(
    state.unlocked_companions.map((u) => [u.companion_id, u])
  );

  // Speech aggregation per companion, keyed by display_name (conversation_log
  // stores who=display_name for companion rows).
  const speechRows = db()
    .prepare(
      `SELECT who, turn_idx, ts, text FROM conversation_log
       WHERE learner_id = ? AND role = 'companion'
       ORDER BY id DESC`
    )
    .all(learnerId) as Array<{
    who: string | null;
    turn_idx: number;
    ts: string;
    text: string;
  }>;
  const speechIndex = new Map<string, Array<{ turn_idx: number; ts: string; text: string }>>();
  for (const r of speechRows) {
    if (!r.who) continue;
    const arr = speechIndex.get(r.who) ?? [];
    arr.push({ turn_idx: r.turn_idx, ts: r.ts, text: r.text });
    speechIndex.set(r.who, arr);
  }

  // Unlock order — sort definitions by unlock_threshold ascending.
  const orderedByThreshold = [...defs].sort(
    (a, b) => (a.unlock_rule?.value ?? 0) - (b.unlock_rule?.value ?? 0)
  );

  const unlocked: UnlockedCompanionCard[] = [];
  const locked: LockedCompanionCard[] = [];

  for (const c of defs) {
    const card = toBaseCard(c);
    const unlock = unlockedMap.get(c.companion_id);
    if (unlock) {
      const allSpeech = speechIndex.get(c.display_name) ?? [];
      unlocked.push({
        ...card,
        status: "unlocked",
        level: unlock.level,
        unlocked_at: unlock.unlocked_at,
        speech_count: allSpeech.length,
        recent_speeches: allSpeech.slice(0, 3),
      });
    } else {
      const needed = Math.max(
        0,
        Math.round((card.unlock_threshold - effectiveTotal) * 10) / 10
      );
      const unlockOrder =
        orderedByThreshold.findIndex((x) => x.companion_id === c.companion_id) + 1;
      locked.push({
        ...card,
        status: "locked",
        effective_total_now: Math.round(effectiveTotal * 10) / 10,
        points_needed: needed,
        unlock_order: unlockOrder > 0 ? unlockOrder : null,
      });
    }
  }

  // Sort: unlocked by unlocked_at ASC (earliest first), locked by threshold ASC
  unlocked.sort((a, b) => a.unlocked_at.localeCompare(b.unlocked_at));
  locked.sort((a, b) => a.unlock_threshold - b.unlock_threshold);

  return { unlocked, locked };
}

function toBaseCard(c: Companion): CompanionLibraryCard {
  return {
    companion_id: c.companion_id,
    display_name: c.display_name,
    companion_type: c.companion_type,
    output_format: c.output_format,
    unique_value_hypothesis: c.unique_value_hypothesis ?? "",
    effectiveness_mechanism: c.effectiveness_mechanism ?? "",
    persona_background: c.persona?.background ?? "",
    personality_traits: c.persona?.personality_traits ?? [],
    typical_phrases: c.persona?.speech_patterns?.typical_phrases ?? [],
    relationship_stages: c.persona?.relationship_stages ?? [],
    speak_when: c.persona?.interaction_rules?.speak_when ?? "",
    silent_when: c.persona?.interaction_rules?.silent_when ?? "",
    upgrade_path: c.upgrade_path ?? [],
    unlock_threshold: c.unlock_rule?.value ?? 0,
    io_max_tokens: c.io_spec?.max_tokens ?? 300,
  };
}

// ============================================================================
// Signature Moves library (subjective ability collection)
// ============================================================================

export interface SignatureMoveCard {
  move_id: string;
  name: string;
  definition: string;
  bound_actions: string[];
  bound_action_names: string[]; // resolved names from blueprint
  status: "earned" | "locked";
  /** Tier labels; pointer to current position in progression (1/2/3). */
  tier_thresholds: number[];
  current_tier?: number; // 0 if not earned; 1/2/3 otherwise
  current_tier_label?: string; // 初识 / 娴熟 / 立派
  count?: number;
  first_earned_at?: string;
  last_earned_at?: string;
  /** Triggering quote from the first time this move was earned. */
  triggering_quote?: string;
  first_challenge_id?: string;
  first_challenge_title?: string;
}

export interface SignatureMovesLibrary {
  earned: SignatureMoveCard[]; // sorted by last_earned_at desc
  locked: SignatureMoveCard[]; // sorted by bound_action order
  total_earned_count: number;
  total_moves: number;
}

const TIER_LABEL: Record<number, string> = { 1: "初识", 2: "娴熟", 3: "立派" };

export function buildSignatureMovesLibrary(
  bp: Blueprint,
  learner: LearnerState
): SignatureMovesLibrary {
  const allMoves: SignatureMove[] = [];
  const actionNames = new Map<string, string>();
  const challengeTitles = new Map<string, string>();
  for (const a of bp.step1_gamecore?.core_actions ?? []) {
    actionNames.set(a.action_id, a.name);
    for (const m of a.signature_moves ?? []) allMoves.push(m);
  }
  for (const chap of bp.step3_script?.chapters ?? []) {
    for (const ch of chap.challenges ?? []) {
      challengeTitles.set(ch.challenge_id, ch.title);
    }
  }

  const earnedById = new Map(
    (learner.earned_signature_moves ?? []).map((e) => [e.move_id, e])
  );

  const earned: SignatureMoveCard[] = [];
  const locked: SignatureMoveCard[] = [];

  for (const m of allMoves) {
    const tiers = m.tier_thresholds ?? [1, 3, 5];
    const e = earnedById.get(m.move_id);
    const boundNames = m.bound_actions.map((id) => actionNames.get(id) ?? id);
    const card: SignatureMoveCard = {
      move_id: m.move_id,
      name: m.name,
      definition: m.definition,
      bound_actions: m.bound_actions,
      bound_action_names: boundNames,
      tier_thresholds: tiers,
      status: e ? "earned" : "locked",
    };
    if (e) {
      let tier = 0;
      for (let i = 0; i < tiers.length; i++) {
        if (e.count >= tiers[i]) tier = i + 1;
      }
      card.current_tier = tier;
      card.current_tier_label = TIER_LABEL[tier] ?? "初识";
      card.count = e.count;
      card.first_earned_at = e.first_earned_at;
      card.last_earned_at = e.last_earned_at;
      card.triggering_quote = e.triggering_quote;
      card.first_challenge_id = e.first_challenge_id;
      card.first_challenge_title = challengeTitles.get(e.first_challenge_id);
      earned.push(card);
    } else {
      locked.push(card);
    }
  }
  earned.sort((a, b) =>
    (b.last_earned_at ?? "").localeCompare(a.last_earned_at ?? "")
  );
  return {
    earned,
    locked,
    total_earned_count: earned.length,
    total_moves: allMoves.length,
  };
}

// ============================================================================
// Mastery Heatmap (objective ability grid — action × complexity)
// ============================================================================

export interface HeatmapCell {
  action_id: string;
  action_name: string;
  complexity: Complexity;
  /** Best grade ever achieved on this (action, complexity) cell.
   *  null = cell not yet touched. */
  best_grade: Grade | null;
  /** Recent-up-to-3 grades on this cell, newest first. */
  recent_grades: Grade[];
  /** Total turns that graded into this cell. */
  turn_count: number;
  /** Best quote from a "good" turn on this cell (for the expand-detail view). */
  best_quote?: string;
  best_quote_challenge_title?: string;
}

export interface MasteryHeatmap {
  /** Actions in the order they appear in Step1Gamecore. */
  actions: Array<{ action_id: string; action_name: string }>;
  /** Complexity levels covered by the blueprint. */
  complexities: Complexity[];
  /** Cells keyed by `${action_id}|${complexity}`. */
  cells: Record<string, HeatmapCell>;
  /** Count of cells with best_grade === "good". */
  good_cells: number;
  /** Total cell count (actions × complexities). */
  total_cells: number;
}

export function buildMasteryHeatmap(
  learnerId: string,
  bp: Blueprint
): MasteryHeatmap {
  const actions = (bp.step1_gamecore?.core_actions ?? []).map((a) => ({
    action_id: a.action_id,
    action_name: a.name,
  }));
  // Complexities come from the first action's matrix (they're uniform per PRD).
  const complexities: Complexity[] =
    (bp.step1_gamecore?.core_actions?.[0]?.quality_matrix?.complexity_levels as Complexity[]) ?? [
      "low",
      "medium",
      "high",
    ];

  // Build challenge_id → {complexity, binds_actions, title}
  const challengeMeta = new Map<
    string,
    { complexity: Complexity; binds_actions: string[]; title: string }
  >();
  for (const chap of bp.step3_script?.chapters ?? []) {
    for (const ch of chap.challenges ?? []) {
      challengeMeta.set(ch.challenge_id, {
        complexity: ch.complexity,
        binds_actions: ch.binds_actions,
        title: ch.title,
      });
    }
  }

  // Pull all evidence for this learner.
  const rows = db()
    .prepare(
      `SELECT id, challenge_id, action_id, grades_json, evidence, ts
       FROM evidence_log WHERE learner_id = ?
       ORDER BY id ASC`
    )
    .all(learnerId) as Array<{
    id: number;
    challenge_id: string;
    action_id: string;
    grades_json: string;
    evidence: string;
    ts: string;
  }>;

  const cells: Record<string, HeatmapCell> = {};
  for (const a of actions) {
    for (const c of complexities) {
      cells[`${a.action_id}|${c}`] = {
        action_id: a.action_id,
        action_name: a.action_name,
        complexity: c,
        best_grade: null,
        recent_grades: [],
        turn_count: 0,
      };
    }
  }

  const rankOf = (g: Grade) => (g === "good" ? 2 : g === "medium" ? 1 : 0);
  for (const r of rows) {
    let grades: Record<string, Grade> = {};
    try {
      grades = JSON.parse(r.grades_json) as Record<string, Grade>;
    } catch {
      continue;
    }
    const chMeta = challengeMeta.get(r.challenge_id);
    if (!chMeta) continue;
    const cellKey = `${r.action_id}|${chMeta.complexity}`;
    const cell = cells[cellKey];
    if (!cell) continue;
    // Use the row's best grade as the turn's grade.
    const best = (Object.values(grades) as Grade[]).reduce<Grade>(
      (acc, g) => (rankOf(g) > rankOf(acc) ? g : acc),
      "poor"
    );
    cell.turn_count += 1;
    cell.recent_grades.unshift(best);
    if (cell.recent_grades.length > 3) cell.recent_grades.length = 3;
    if (!cell.best_grade || rankOf(best) > rankOf(cell.best_grade)) {
      cell.best_grade = best;
      if (best === "good") {
        // Keep the *most recent* "good"-graded evidence as the best quote.
        cell.best_quote = r.evidence?.slice(0, 200);
        cell.best_quote_challenge_title = chMeta.title;
      }
    }
  }

  const goodCells = Object.values(cells).filter(
    (c) => c.best_grade === "good"
  ).length;
  return {
    actions,
    complexities,
    cells,
    good_cells: goodCells,
    total_cells: actions.length * complexities.length,
  };
}

// Re-export (intentionally unused warning suppressant for the evidence import)
export type { EvidenceEntry };
