// Narrator context helpers — build the "scene awareness" data that the Narrator
// prompt consumes. Pure, side-effect-free aggregations over blueprint + state.

import type {
  Artifact,
  ArtifactContent,
  ArtifactDropMeta,
  Blueprint,
  Challenge,
  ConversationEntry,
  EvidenceEntry,
  Grade,
} from "@/lib/types/core";
import { db } from "@/lib/db";
import { listDroppedArtifacts } from "@/lib/state-manager/conversation";

/** One character registered in the current journey: learner-visible name,
 *  identity/role, and where it first surfaced. */
export interface CharacterRegistryEntry {
  name: string;
  identity: string;
  first_seen_at: string; // chapter_id or artifact_id
}

/** A compact, LLM-friendly summary of an artifact the learner has already seen. */
export interface ArtifactBrief {
  artifact_id: string;
  name: string;
  type: string;
  version: number;
  summary: string;
}

export interface SignalsHit {
  signal: string;
  /** Aggregated grade in this challenge so far, if any dim grade covered it. */
  best_grade: Grade | "none";
  hit: boolean; // shortcut: best_grade === "good"
}

/** Characters that have surfaced so far in this journey. We scrape:
 *  - Confirmed from dropped artifacts that look like personal profiles
 *    (type=fields with a 姓名/name field; name preceded by "X 的" in artifact.name).
 *  - Blueprint-declared: chapter.narrative_premise + challenge.trunk.setup are
 *    provided to the model verbatim in Block 1, so we don't re-extract them here.
 *    Instead we focus on "confirmed via artifact" so the LLM has a *source of truth*
 *    table to cite ("根据员工档案, 小陈是…"). */
export function buildCharacterRegistry(args: {
  learnerId: string;
  blueprint: Blueprint | null;
}): CharacterRegistryEntry[] {
  if (!args.blueprint) return [];
  const groups = listDroppedArtifacts(args.learnerId);
  // Reduce groups to "latest version artifact-like" objects and reuse
  // extractCharactersFromArtifacts.
  const pseudoArtifacts: Pick<Artifact, "artifact_id" | "content">[] = [];
  for (const g of groups) {
    const latest = g.versions[g.versions.length - 1];
    if (!latest) continue;
    pseudoArtifacts.push({ artifact_id: g.artifact_id, content: latest.content });
  }
  return extractCharactersFromArtifacts(pseudoArtifacts);
}

/** Pure extractor: given a set of artifacts (blueprint-time OR runtime),
 *  pull out character entries from fields-type dossiers with a 姓名/name key. */
export function extractCharactersFromArtifacts(
  artifacts: Array<{ artifact_id: string; content: ArtifactContent }>
): CharacterRegistryEntry[] {
  const entries: CharacterRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const a of artifacts) {
    const c = a.content;
    if (c.type !== "fields") continue;
    const flat = [...(c.fields ?? [])];
    for (const section of c.sections ?? []) flat.push(...section.fields);
    const nameField = flat.find((f) =>
      /^(姓名|name|称呼)$/i.test(f.key.trim())
    );
    if (!nameField || !nameField.value) continue;
    const name = nameField.value.trim();
    if (seen.has(name)) continue;
    seen.add(name);
    const roleField = flat.find((f) => /岗位|职位|role|title|职务/i.test(f.key));
    const tenure = flat.find((f) => /入职|司龄|年龄/i.test(f.key));
    const identityBits = [roleField?.value, tenure?.value].filter(Boolean);
    const identity =
      identityBits.join(" · ") ||
      flat
        .filter((f) => f !== nameField)
        .slice(0, 2)
        .map((f) => `${f.key}=${f.value}`)
        .join(" · ");
    entries.push({
      name,
      identity: identity || "(身份未明)",
      first_seen_at: a.artifact_id,
    });
  }
  return entries;
}

/** Pick the `on_challenge_enter` artifacts defined on a challenge (blueprint)
 *  and return them as briefs. Used by runNarratorOpening to pre-reference
 *  the artifacts that will drop right after the opening. */
export function briefsForPendingChallengeEnter(
  bp: Blueprint,
  chapterId: string,
  challengeId: string
): Array<ArtifactBrief & { content: ArtifactContent }> {
  const chapter = bp.step3_script?.chapters.find((c) => c.chapter_id === chapterId);
  const challenge = chapter?.challenges.find((c) => c.challenge_id === challengeId);
  const arts = (challenge?.artifacts ?? []).filter(
    (a) => a.trigger === "on_challenge_enter"
  );
  // Dedupe by artifact_id keeping lowest version (what will drop first).
  const byId = new Map<string, Artifact>();
  for (const a of arts) {
    const prev = byId.get(a.artifact_id);
    if (!prev || a.version < prev.version) byId.set(a.artifact_id, a);
  }
  return Array.from(byId.values()).map((a) => ({
    artifact_id: a.artifact_id,
    name: a.name,
    type: a.type,
    version: a.version,
    summary: summarizeArtifactContent(a.content).slice(0, 120),
    content: a.content,
  }));
}

/** Return the most recent narrator turn-response text for this learner,
 *  excluding challenge_opening / chapter_intro / orientation bubbles.
 *  Narrator uses this to avoid repeating itself across turns. */
export function lastNarratorResponseText(learnerId: string): string {
  const row = db()
    .prepare(
      `SELECT text, meta_json FROM conversation_log
       WHERE learner_id = ? AND role = 'narrator'
       ORDER BY id DESC
       LIMIT 10`
    )
    .all(learnerId) as Array<{ text: string; meta_json: string | null }>;
  for (const r of row) {
    let kind: string | null = null;
    if (r.meta_json) {
      try {
        kind = (JSON.parse(r.meta_json) as { kind?: string }).kind ?? null;
      } catch {
        /* ignore */
      }
    }
    if (kind && ["challenge_opening", "chapter_intro", "orientation_role"].includes(kind)) {
      continue;
    }
    return r.text ?? "";
  }
  return "";
}

/** Summarize every artifact the learner has seen in the full journey,
 *  keyed for Narrator block-2 context. */
export function buildAllSeenArtifactBriefs(learnerId: string): ArtifactBrief[] {
  const groups = listDroppedArtifacts(learnerId);
  const out: ArtifactBrief[] = [];
  for (const g of groups) {
    const latest = g.versions[g.versions.length - 1];
    if (!latest) continue;
    out.push({
      artifact_id: g.artifact_id,
      name: g.name,
      type: g.type,
      version: latest.version,
      summary: summarizeArtifactContent(latest.content).slice(0, 120),
    });
  }
  return out;
}

/** Summarize an artifact just dropped this turn (Narrator needs to reference it). */
export function briefForArtifact(a: {
  artifact_id: string;
  name: string;
  type: string;
  version: number;
  content: ArtifactContent;
}): ArtifactBrief {
  return {
    artifact_id: a.artifact_id,
    name: a.name,
    type: a.type,
    version: a.version,
    summary: summarizeArtifactContent(a.content).slice(0, 120),
  };
}

/** Return each expected_signal with the best grade the learner has achieved
 *  on any dimension in this challenge so far. This is heuristic — we treat
 *  a `good` on any dim as evidence that at least one signal likely landed. */
export function getSignalsHitSoFar(args: {
  evidence: EvidenceEntry[];
  challenge: Challenge | null;
}): SignalsHit[] {
  if (!args.challenge?.trunk?.expected_signals?.length) return [];
  const signals = args.challenge.trunk.expected_signals;

  // Aggregate best-of grades per dim across all turns in this challenge.
  const byDim: Record<string, Grade> = {};
  for (const e of args.evidence) {
    if (e.challenge_id !== args.challenge.challenge_id) continue;
    for (const [dim, grade] of Object.entries(e.grades)) {
      const prev = byDim[dim];
      byDim[dim] = betterGrade(prev, grade);
    }
  }
  const bestAnyDim = Object.values(byDim).reduce<Grade | "none">(
    (acc, g) => (betterGrade(acc === "none" ? undefined : acc, g) as Grade),
    "none"
  );
  // We don't have a per-signal mapping, so we attach bestAnyDim to every signal
  // and mark them "hit" only when we see repeated `good` traces — but to keep
  // this useful, mark hit=true if ≥2 turns in this challenge graded `good` overall.
  const goodTurns = args.evidence.filter(
    (e) =>
      e.challenge_id === args.challenge!.challenge_id &&
      Object.values(e.grades).some((g) => g === "good")
  ).length;
  return signals.map((sig) => ({
    signal: sig,
    best_grade: bestAnyDim,
    hit: goodTurns >= 2,
  }));
}

/** Collapse a recent-turn conversation entry into the structured shape Narrator
 *  will read (role + who + meta.kind + text). */
export function toStructuredRecentTurn(e: ConversationEntry): {
  role: string;
  who: string | null;
  meta_kind: string | null;
  text: string;
} {
  const kindRaw = e.meta && typeof e.meta === "object" ? (e.meta as { kind?: string }).kind : null;
  return {
    role: e.role,
    who: e.who ?? null,
    meta_kind: typeof kindRaw === "string" ? kindRaw : null,
    text: artifactAwareText(e),
  };
}

// When an artifact is in recent turns, "text" alone says only "🎒 <name>" which
// loses content. Include a short summary so Narrator can reference the gist.
function artifactAwareText(e: ConversationEntry): string {
  if (e.role !== "artifact") return e.text;
  const m = e.meta as ArtifactDropMeta | null;
  if (!m || m.kind !== "artifact_drop") return e.text;
  const summary = summarizeArtifactContent(m.content).slice(0, 80);
  return `[道具·${m.type}] ${e.who ?? m.artifact_id}：${summary}`;
}

function summarizeArtifactContent(c: ArtifactContent): string {
  switch (c.type) {
    case "narrative":
      return (c.header?.subject ? `[${c.header.subject}] ` : "") + (c.body ?? "");
    case "fields": {
      const flat = [...(c.fields ?? [])];
      for (const s of c.sections ?? []) flat.push(...s.fields);
      return flat.map((f) => `${f.key}=${f.value}`).join(" · ");
    }
    case "series":
      return (c.entries ?? []).map((e) => `${e.actor ?? ""}${e.actor ? "：" : ""}${e.text}`).join(" / ");
    case "list":
      return (c.items ?? []).map((i) => i.text).join(" · ");
    case "table":
      return `${c.title ?? "表"}（${c.columns?.length ?? 0}列×${c.rows?.length ?? 0}行）`;
    case "hierarchy":
      return `${c.root?.label ?? ""} → ${(c.root?.children ?? []).map((x) => x.label).join(",")}`;
  }
  return "";
}

function betterGrade(a: Grade | undefined, b: Grade): Grade {
  const rank = (g: Grade | undefined) => (g === "good" ? 3 : g === "medium" ? 2 : g === "poor" ? 1 : 0);
  return rank(a) >= rank(b) ? (a as Grade) ?? b : b;
}

// Re-exported for callers that also need the raw artifact type.
export type { Artifact };
