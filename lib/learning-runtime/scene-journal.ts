// Scene Journal — the runtime's answer to "what has actually happened in
// this learner's journey so far?".
//
// Why: Narrator prompts used to receive the blueprint's chapter narrative_premise
// verbatim. That premise often introduces characters the LEARNER hasn't met yet
// (e.g., "赵海, 陈悦, 李想..."). When Narrator wrote a cross-challenge bridge,
// it would invent past interactions with unmet characters ("和陈悦的那场谈话
// 你还没完全放下..." — a conversation that never happened).
//
// This module produces three authoritative read models:
//   1. played_challenges_recap — the challenges the learner actually completed,
//      with a one-line recap pulled from the closing narrator bubble.
//   2. nameable_characters     — positive whitelist of characters the Narrator
//      is ALLOWED to name this turn (confirmed via dropped fields-artifacts +
//      characters that WILL be introduced via this challenge's on_challenge_enter
//      artifacts).
//   3. scene_beats             — the ordered list of what has happened up to now.
//
// These are fed to narrator_opening and narrator-turn templates, alongside
// a new hard rule: "only name characters in nameable_characters".

import type { Artifact, Blueprint, LearnerState } from "@/lib/types/core";
import { db } from "@/lib/db";
import {
  briefsForPendingChallengeEnter,
  extractCharactersFromArtifacts,
  type CharacterRegistryEntry,
} from "@/lib/narrator/context";
import { listDroppedArtifacts } from "@/lib/state-manager/conversation";

export interface PlayedChallengeRecap {
  chapter_id: string;
  chapter_title: string;
  challenge_id: string;
  challenge_title: string;
  milestone_summary: string;
  /** The closing narrator bubble's text (truncated to ≤ 120 chars) — gives
   *  Narrator an authoritative snippet of what the learner established
   *  on their way out of this challenge. Bridge sentences must draw from this,
   *  not from imagination. */
  closing_recap: string;
}

export interface SceneJournal {
  /** Challenges the learner completed, ordered from oldest to newest.
   *  Used by cross-challenge openings to author a TRUE bridge sentence
   *  instead of inventing one. */
  played_challenges_recap: PlayedChallengeRecap[];
  /** Positive whitelist of characters the Narrator may name. */
  nameable_characters: CharacterRegistryEntry[];
  /** Characters that WILL be confirmed via the current challenge's
   *  on_challenge_enter artifacts (so Narrator can pre-reference them even
   *  before the drop appends to the log). */
  incoming_characters: CharacterRegistryEntry[];
  /** The chapter the current challenge lives in. */
  current_chapter_id: string | null;
}

/** Build the scene journal for a learner at their current position. */
export function buildSceneJournal(args: {
  learnerId: string;
  blueprint: Blueprint;
  learner: LearnerState;
  /** Optional override: treat this challenge as "current" instead of
   *  learner.position.challenge_id (used when building the opening for a
   *  challenge the learner is about to enter). */
  currentChapterId?: string;
  currentChallengeId?: string;
}): SceneJournal {
  const {
    learnerId,
    blueprint: bp,
    learner,
    currentChapterId = learner.position.chapter_id,
    currentChallengeId = learner.position.challenge_id,
  } = args;

  // --- 1. played_challenges_recap ----------------------------------------
  // completed_challenges holds challenge ids the learner has finished.
  // We order them by when their closing narrator bubble was written.
  const completedSet = new Set(learner.completed_challenges ?? []);
  const chapterById = new Map<string, { title: string }>();
  const challengeById = new Map<
    string,
    { chapter_id: string; title: string; milestone_summary: string }
  >();
  for (const chap of bp.step3_script?.chapters ?? []) {
    chapterById.set(chap.chapter_id, { title: chap.title });
    for (const ch of chap.challenges ?? []) {
      challengeById.set(ch.challenge_id, {
        chapter_id: chap.chapter_id,
        title: ch.title,
        milestone_summary: chap.milestone?.summary ?? "",
      });
    }
  }

  // For each completed challenge, find the last narrator bubble that was
  // logged BEFORE the milestone_completed marker. Fall back to challenge
  // title if no such bubble exists.
  const recapRows = db()
    .prepare(
      `SELECT id, challenge_id, role, text, meta_json
       FROM conversation_log
       WHERE learner_id = ?
       ORDER BY id ASC`
    )
    .all(learnerId) as Array<{
    id: number;
    challenge_id: string | null;
    role: string;
    text: string;
    meta_json: string | null;
  }>;

  // Group by challenge_id; for each completed challenge, pick the LAST
  // narrator bubble that isn't the opening/system kind.
  const lastNarratorByChallenge = new Map<string, string>();
  for (const r of recapRows) {
    if (r.role !== "narrator" || !r.challenge_id) continue;
    if (!completedSet.has(r.challenge_id)) continue;
    let kind: string | null = null;
    if (r.meta_json) {
      try {
        kind = (JSON.parse(r.meta_json) as { kind?: string }).kind ?? null;
      } catch {
        /* ignore */
      }
    }
    if (kind === "challenge_opening" || kind === "chapter_intro") continue;
    lastNarratorByChallenge.set(r.challenge_id, r.text);
  }

  const played_challenges_recap: PlayedChallengeRecap[] = [];
  for (const challengeId of learner.completed_challenges ?? []) {
    const c = challengeById.get(challengeId);
    if (!c) continue;
    const closing = lastNarratorByChallenge.get(challengeId) ?? "";
    played_challenges_recap.push({
      chapter_id: c.chapter_id,
      chapter_title: chapterById.get(c.chapter_id)?.title ?? "",
      challenge_id: challengeId,
      challenge_title: c.title,
      milestone_summary: c.milestone_summary,
      closing_recap: closing.slice(0, 120),
    });
  }

  // --- 2. nameable_characters --------------------------------------------
  // All characters whose identity has been CONFIRMED (via a fields-type
  // artifact with a 姓名 field) anywhere in the journey so far.
  const droppedGroups = listDroppedArtifacts(learnerId);
  const droppedAsPseudoArtifacts = droppedGroups
    .map((g) => {
      const latest = g.versions[g.versions.length - 1];
      return latest
        ? { artifact_id: g.artifact_id, content: latest.content }
        : null;
    })
    .filter((x): x is { artifact_id: string; content: Artifact["content"] } => x !== null);
  const metCharacters = extractCharactersFromArtifacts(droppedAsPseudoArtifacts);

  // --- 3. incoming_characters --------------------------------------------
  // Characters the CURRENT challenge's on_challenge_enter artifacts will
  // introduce. They may not have dropped yet (the opening writes its text
  // before dropArtifact fires), but Narrator can safely pre-reference them.
  let incoming: CharacterRegistryEntry[] = [];
  if (currentChapterId && currentChallengeId) {
    const pending = briefsForPendingChallengeEnter(
      bp,
      currentChapterId,
      currentChallengeId
    );
    incoming = extractCharactersFromArtifacts(
      pending.map((b) => ({ artifact_id: b.artifact_id, content: b.content }))
    );
  }

  // Dedupe: if an incoming character is already met, drop it from incoming.
  const metNameSet = new Set(metCharacters.map((c) => c.name));
  const incomingUnique = incoming.filter((c) => !metNameSet.has(c.name));

  const nameable_characters: CharacterRegistryEntry[] = [
    ...metCharacters,
    ...incomingUnique,
  ];

  return {
    played_challenges_recap,
    nameable_characters,
    incoming_characters: incomingUnique,
    current_chapter_id: currentChapterId,
  };
}

