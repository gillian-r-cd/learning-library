// Journey progress projection — used by the Learner UI's right-rail progress
// tracker so the learner can always see which chapter / challenge they're on
// and what's done.

import type { Blueprint, LearnerState } from "@/lib/types/core";

export interface JourneyProgressNode {
  chapter_id: string;
  chapter_title: string;
  milestone_summary: string;
  chapter_status: "completed" | "current" | "upcoming";
  chapter_index: number; // 1-based
  challenges: {
    challenge_id: string;
    title: string;
    complexity: string;
    binds_actions: string[];
    status: "completed" | "current" | "upcoming";
    turn_idx_in_current?: number; // only for current
  }[];
}

export interface JourneyProgress {
  total_chapters: number;
  total_challenges: number;
  completed_challenges: number;
  current_chapter_id: string;
  current_challenge_id: string;
  chapters: JourneyProgressNode[];
  /** Convenience: "3/12 challenges" for the header. */
  completion_ratio: string;
}

export function computeJourneyProgress(
  learner: LearnerState,
  bp: Blueprint
): JourneyProgress | null {
  const script = bp.step3_script;
  if (!script || !Array.isArray(script.chapters) || script.chapters.length === 0) {
    return null;
  }

  const completedSet = new Set(learner.completed_challenges);
  const currentChapterIdx = script.chapters.findIndex(
    (c) => c.chapter_id === learner.position.chapter_id
  );
  const totalChallenges = script.chapters.reduce(
    (acc, c) => acc + c.challenges.length,
    0
  );

  const chapters: JourneyProgressNode[] = script.chapters.map((chap, chapIdx) => {
    const challenges = chap.challenges.map((ch) => {
      const isCompleted = completedSet.has(ch.challenge_id);
      const isCurrent =
        ch.challenge_id === learner.position.challenge_id &&
        chap.chapter_id === learner.position.chapter_id;
      const status: "completed" | "current" | "upcoming" = isCompleted
        ? "completed"
        : isCurrent
        ? "current"
        : "upcoming";
      return {
        challenge_id: ch.challenge_id,
        title: ch.title,
        complexity: ch.complexity,
        binds_actions: ch.binds_actions,
        status,
        turn_idx_in_current: isCurrent ? learner.position.turn_idx : undefined,
      };
    });
    const chapAllDone = challenges.every((c) => c.status === "completed");
    const chapHasCurrent = challenges.some((c) => c.status === "current");
    const chapBefore = chapIdx < currentChapterIdx;
    const chapStatus: "completed" | "current" | "upcoming" =
      chapAllDone || chapBefore
        ? "completed"
        : chapHasCurrent
        ? "current"
        : "upcoming";
    return {
      chapter_id: chap.chapter_id,
      chapter_title: chap.title,
      milestone_summary: chap.milestone?.summary ?? "",
      chapter_status: chapStatus,
      chapter_index: chapIdx + 1,
      challenges,
    };
  });

  return {
    total_chapters: script.chapters.length,
    total_challenges: totalChallenges,
    completed_challenges: learner.completed_challenges.length,
    current_chapter_id: learner.position.chapter_id,
    current_challenge_id: learner.position.challenge_id,
    chapters,
    completion_ratio: `${learner.completed_challenges.length}/${totalChallenges}`,
  };
}
