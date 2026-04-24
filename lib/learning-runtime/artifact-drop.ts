// Artifact drop orchestration — runtime helpers used by createLearnerState and
// runTurn. Idempotent: re-dropping the same (artifact_id, version) is a no-op.

import type { Artifact, Blueprint, ConversationEntry } from "@/lib/types/core";
import {
  dropArtifact,
  isArtifactAlreadyDropped,
} from "@/lib/state-manager/conversation";
import { getBlueprint } from "@/lib/blueprint";

/** Find all artifacts on a specific challenge of a blueprint. */
export function findChallengeArtifacts(
  bp: Blueprint,
  chapterId: string,
  challengeId: string
): Artifact[] {
  const chapter = bp.step3_script?.chapters.find((c) => c.chapter_id === chapterId);
  const challenge = chapter?.challenges.find((c) => c.challenge_id === challengeId);
  return challenge?.artifacts ?? [];
}

/** Drop every on_challenge_enter artifact for a given challenge (v1 by default).
 *  Idempotent: artifacts already dropped for the learner are skipped. */
export function dropChallengeEnterArtifacts(args: {
  learnerId: string;
  blueprintId: string;
  chapterId: string;
  challengeId: string;
  turnIdx: number;
  traceId?: string | null;
}): ConversationEntry[] {
  const bp = getBlueprint(args.blueprintId);
  if (!bp) return [];

  const arts = findChallengeArtifacts(bp, args.chapterId, args.challengeId)
    .filter((a) => a.trigger === "on_challenge_enter")
    // Only drop the lowest version per artifact_id on enter; later versions
    // follow learner actions.
    .reduce<Artifact[]>((acc, a) => {
      const existing = acc.find((x) => x.artifact_id === a.artifact_id);
      if (!existing || a.version < existing.version) {
        return [...acc.filter((x) => x.artifact_id !== a.artifact_id), a];
      }
      return acc;
    }, []);

  const results: ConversationEntry[] = [];
  for (const a of arts) {
    if (isArtifactAlreadyDropped(args.learnerId, a.artifact_id, a.version)) continue;
    results.push(
      dropArtifact({
        learner_id: args.learnerId,
        turn_idx: args.turnIdx,
        chapter_id: args.chapterId,
        challenge_id: args.challengeId,
        artifact: a,
        trace_id: args.traceId ?? null,
        trigger_source: "challenge_enter",
      })
    );
  }
  return results;
}

/** Event-triggered drop (Judge returned DROP_ARTIFACT). Picks the next
 *  un-dropped version for a given artifact_id within the current challenge.
 *  If all versions are dropped, returns null (not re-dropped). */
export function dropByEvent(args: {
  learnerId: string;
  blueprintId: string;
  chapterId: string;
  challengeId: string;
  turnIdx: number;
  artifactId: string;
  traceId?: string | null;
  triggerSource?: string;
}): ConversationEntry | null {
  const bp = getBlueprint(args.blueprintId);
  if (!bp) return null;

  const all = findChallengeArtifacts(bp, args.chapterId, args.challengeId).filter(
    (a) => a.artifact_id === args.artifactId
  );
  if (all.length === 0) return null;
  // Versions ascending
  const sorted = [...all].sort((a, b) => a.version - b.version);
  const toDrop = sorted.find(
    (a) => !isArtifactAlreadyDropped(args.learnerId, a.artifact_id, a.version)
  );
  if (!toDrop) return null;
  return dropArtifact({
    learner_id: args.learnerId,
    turn_idx: args.turnIdx,
    chapter_id: args.chapterId,
    challenge_id: args.challengeId,
    artifact: toDrop,
    trace_id: args.traceId ?? null,
    trigger_source: args.triggerSource ?? "event",
  });
}

/** For Judge context: which artifacts in the current challenge have NOT been
 *  dropped yet for this learner. */
export function listPendingArtifacts(args: {
  learnerId: string;
  blueprintId: string;
  chapterId: string;
  challengeId: string;
}): Array<{
  artifact_id: string;
  name: string;
  type: string;
  trigger: string;
  trigger_hint?: string;
}> {
  const bp = getBlueprint(args.blueprintId);
  if (!bp) return [];
  const all = findChallengeArtifacts(bp, args.chapterId, args.challengeId);
  // Pick the LOWEST version that's not yet dropped per artifact_id — that's
  // what Judge should consider "next to drop".
  const byId = new Map<string, Artifact>();
  for (const a of all) {
    if (isArtifactAlreadyDropped(args.learnerId, a.artifact_id, a.version)) continue;
    const prev = byId.get(a.artifact_id);
    if (!prev || a.version < prev.version) byId.set(a.artifact_id, a);
  }
  return Array.from(byId.values()).map((a) => ({
    artifact_id: a.artifact_id,
    name: a.name,
    type: a.type,
    trigger: a.trigger,
    ...(a.trigger_hint ? { trigger_hint: a.trigger_hint } : {}),
  }));
}

/** For Judge context: a compact summary of artifacts the learner has already
 *  seen in the current challenge. Strips full content — keeps a short preview. */
export function listAvailableArtifactsSummary(args: {
  learnerId: string;
  blueprintId: string;
  chapterId: string;
  challengeId: string;
}): Array<{
  artifact_id: string;
  name: string;
  type: string;
  version: number;
  summary: string;
}> {
  const bp = getBlueprint(args.blueprintId);
  if (!bp) return [];
  const all = findChallengeArtifacts(bp, args.chapterId, args.challengeId);
  return all
    .filter((a) => isArtifactAlreadyDropped(args.learnerId, a.artifact_id, a.version))
    .map((a) => ({
      artifact_id: a.artifact_id,
      name: a.name,
      type: a.type,
      version: a.version,
      summary: summarizeContent(a).slice(0, 80),
    }));
}

function summarizeContent(a: Artifact): string {
  const c = a.content;
  switch (c.type) {
    case "narrative": {
      const head = c.header?.subject ? `[${c.header.subject}] ` : "";
      return head + (c.body?.slice(0, 100) ?? "");
    }
    case "fields": {
      const flat = c.fields ?? [];
      return flat.map((f) => `${f.key}=${f.value}`).join(" · ");
    }
    case "series":
      return (c.entries ?? []).map((e) => e.text).join(" / ");
    case "list":
      return (c.items ?? []).map((i) => i.text).join(" · ");
    case "table":
      return `表 ${c.columns?.length ?? 0}列 × ${c.rows?.length ?? 0}行`;
    case "hierarchy":
      return `${c.root?.label ?? ""} +${(c.root?.children?.length ?? 0)} 子节点`;
  }
  return "";
}
