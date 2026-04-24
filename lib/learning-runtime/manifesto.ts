// Manifesto pipeline — the end-of-chapter synthesis that turns the learner's
// own quotable-flagged first-person moments into a short first-person chapter
// statement. Fed into right-panel "我的宣言" + downstream journey manifesto.

import { randomUUID } from "node:crypto";
import { llmCall } from "@/lib/llm";
import { db } from "@/lib/db";
import { appendConversation } from "@/lib/state-manager/conversation";
import { getBlueprint } from "@/lib/blueprint";
import type { EvidenceEntry } from "@/lib/types/core";

export interface ManifestoSegment {
  id: number; // conversation_log row id
  ts: string;
  chapter_id: string;
  chapter_title: string | null;
  arc_stage_id: string | null;
  arc_stage_name: string | null;
  text: string;
  source_learner_quotes: string[];
}

/** Called at end-of-chapter (complete_challenge that advances chapters).
 *  Pulls quotable evidence in the closed chapter, pulls the learner's actual
 *  utterances from conversation_log, asks LLM to weave a manifesto. Writes as
 *  a system bubble with meta.kind="manifesto" + the segment. Returns null if
 *  no quotable material exists yet (fallback is to skip; no stub). */
export async function generateChapterManifesto(args: {
  learnerId: string;
  blueprintId: string;
  chapterId: string;
  traceId?: string;
}): Promise<ManifestoSegment | null> {
  const bp = getBlueprint(args.blueprintId);
  if (!bp) return null;
  const chapter = bp.step3_script?.chapters.find(
    (c) => c.chapter_id === args.chapterId
  );
  if (!chapter) return null;

  // Gather quotable evidence rows for this (learner, chapter).
  const evRows = db()
    .prepare(
      `SELECT * FROM evidence_log
       WHERE learner_id = ? AND challenge_id IN (
         SELECT challenge_id FROM evidence_log
         WHERE learner_id = ? AND challenge_id LIKE ?
       )
       ORDER BY id ASC`
    )
    .all(
      args.learnerId,
      args.learnerId,
      `${args.chapterId}_%` // conventionally c1_ch1, c1_ch2, etc.
    ) as Array<Record<string, unknown>>;

  const chapterChallengeIds = new Set(
    (chapter.challenges ?? []).map((ch) => ch.challenge_id)
  );
  const chapterEvidenceIds = evRows
    .filter((r) => chapterChallengeIds.has(r.challenge_id as string))
    .map((r) => r.id as number);

  // Fetch learner_input texts from conversation_log for the quotable evidence turns.
  // Strategy: for each challenge in chapter, grab all learner bubbles in order.
  const learnerTurns = db()
    .prepare(
      `SELECT id, challenge_id, turn_idx, text
       FROM conversation_log
       WHERE learner_id = ? AND role = 'learner' AND challenge_id IN (${Array.from(
         chapterChallengeIds
       )
         .map(() => "?")
         .join(",")})
       ORDER BY id ASC`
    )
    .all(args.learnerId, ...Array.from(chapterChallengeIds)) as Array<{
    id: number;
    challenge_id: string;
    turn_idx: number;
    text: string;
  }>;

  // Match quotable evidence rows to learner turns (by challenge_id + turn_idx).
  const quotableKeys = new Set<string>();
  for (const r of evRows) {
    if (!chapterChallengeIds.has(r.challenge_id as string)) continue;
    if (!r.quotable) continue;
    quotableKeys.add(`${r.challenge_id}|${r.turn_idx}`);
  }
  const quotableQuotes = learnerTurns
    .filter((t) => quotableKeys.has(`${t.challenge_id}|${t.turn_idx}`))
    .map((t) => t.text.trim());
  // Fallback: if no quotable-flagged turns, use the 3 longest learner turns in
  // the chapter as rough substitutes. Prevents empty manifestos.
  const fallbackQuotes =
    quotableQuotes.length > 0
      ? []
      : learnerTurns
          .slice()
          .sort((a, b) => b.text.length - a.text.length)
          .slice(0, 3)
          .map((t) => t.text.trim());
  const finalQuotes = quotableQuotes.length > 0 ? quotableQuotes : fallbackQuotes;
  if (finalQuotes.length === 0) return null;

  // Find arc_stage name if any
  const arcStage = chapter.arc_stage_id
    ? bp.step3_script?.journey_meta?.arc_stages?.find(
        (s) => s.id === chapter.arc_stage_id
      ) ?? null
    : null;

  const traceId = args.traceId ?? `trc_${randomUUID().slice(0, 8)}`;
  const res = await llmCall({
    caller: "manifesto_generator",
    stage: "learning",
    traceId,
    learnerId: args.learnerId,
    blueprintId: args.blueprintId,
    userVisible: true,
    variables: {
      topic: bp.topic ?? "",
      chapter_title: chapter.title,
      chapter_narrative_premise: chapter.narrative_premise,
      chapter_milestone: chapter.milestone?.summary ?? "",
      arc_stage_name: arcStage?.name ?? "",
      learner_quotes: finalQuotes.map((q, i) => `(${i + 1}) ${q}`).join("\n"),
      completed_challenge_titles: (chapter.challenges ?? [])
        .map((c) => c.title)
        .join(" · "),
    },
  });
  const text = (res.text ?? "").trim();
  if (!text || text.length < 40) return null;

  // Persist as a system bubble with kind=manifesto so the right-panel card can
  // read it back.
  const entry = appendConversation({
    learner_id: args.learnerId,
    turn_idx: 0,
    chapter_id: args.chapterId,
    challenge_id: null,
    role: "system",
    who: "manifesto",
    text,
    trace_id: traceId,
    meta: {
      kind: "manifesto",
      chapter_id: args.chapterId,
      chapter_title: chapter.title,
      arc_stage_id: chapter.arc_stage_id ?? null,
      arc_stage_name: arcStage?.name ?? null,
      source_learner_quotes: finalQuotes,
      source_evidence_ids: chapterEvidenceIds,
    },
  });

  return {
    id: entry.id,
    ts: entry.ts,
    chapter_id: args.chapterId,
    chapter_title: chapter.title,
    arc_stage_id: chapter.arc_stage_id ?? null,
    arc_stage_name: arcStage?.name ?? null,
    text,
    source_learner_quotes: finalQuotes,
  };
}

/** Read back all manifesto segments this learner has accumulated (newest first). */
export function listManifestoSegments(learnerId: string): ManifestoSegment[] {
  const rows = db()
    .prepare(
      `SELECT id, ts, chapter_id, text, meta_json
       FROM conversation_log
       WHERE learner_id = ? AND role = 'system' AND who = 'manifesto'
       ORDER BY id DESC`
    )
    .all(learnerId) as Array<{
    id: number;
    ts: string;
    chapter_id: string | null;
    text: string;
    meta_json: string | null;
  }>;
  return rows
    .map((r): ManifestoSegment | null => {
      if (!r.chapter_id) return null;
      let meta: {
        chapter_title?: string;
        arc_stage_id?: string | null;
        arc_stage_name?: string | null;
        source_learner_quotes?: string[];
      } = {};
      if (r.meta_json) {
        try {
          meta = JSON.parse(r.meta_json);
        } catch {
          /* ignore */
        }
      }
      return {
        id: r.id,
        ts: r.ts,
        chapter_id: r.chapter_id,
        chapter_title: meta.chapter_title ?? null,
        arc_stage_id: meta.arc_stage_id ?? null,
        arc_stage_name: meta.arc_stage_name ?? null,
        text: r.text,
        source_learner_quotes: meta.source_learner_quotes ?? [],
      };
    })
    .filter((m): m is ManifestoSegment => m !== null);
}

// Unused-import suppressant for type-only exports
export type { EvidenceEntry };
