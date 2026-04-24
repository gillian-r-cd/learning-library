// Persistent conversation log — the learner-facing transcript.
// Every Narrator / Companion reply and every learner input is appended here
// so that reloading /learn/<id> restores the full chat.

import { db } from "@/lib/db";
import type {
  Artifact,
  ArtifactDropMeta,
  ConversationEntry,
  ConversationRole,
  DroppedArtifactGroup,
} from "@/lib/types/core";

export interface AppendArgs {
  learner_id: string;
  turn_idx: number;
  chapter_id?: string | null;
  challenge_id?: string | null;
  role: ConversationRole;
  who?: string | null;
  text: string;
  trace_id?: string | null;
  meta?: Record<string, unknown> | null;
}

export function appendConversation(args: AppendArgs): ConversationEntry {
  const ts = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO conversation_log
         (learner_id, ts, turn_idx, chapter_id, challenge_id, role, who, text, trace_id, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.learner_id,
      ts,
      args.turn_idx,
      args.chapter_id ?? null,
      args.challenge_id ?? null,
      args.role,
      args.who ?? null,
      args.text,
      args.trace_id ?? null,
      args.meta ? JSON.stringify(args.meta) : null
    );
  return {
    id: Number(info.lastInsertRowid),
    learner_id: args.learner_id,
    ts,
    turn_idx: args.turn_idx,
    chapter_id: args.chapter_id ?? null,
    challenge_id: args.challenge_id ?? null,
    role: args.role,
    who: args.who ?? null,
    text: args.text,
    trace_id: args.trace_id ?? null,
    meta: args.meta ?? null,
  };
}

export function listConversation(
  learnerId: string,
  opts: { limit?: number; sinceId?: number } = {}
): ConversationEntry[] {
  const rows = db()
    .prepare(
      `SELECT * FROM conversation_log
       WHERE learner_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(learnerId, opts.sinceId ?? 0, opts.limit ?? 1000) as Array<Record<string, unknown>>;
  return rows.map(rowToEntry);
}

/** Return the CHRONOLOGICALLY latest `count` entries for this learner, in
 *  ascending (oldest-first) order. Unlike `listConversation({limit: N})`
 *  (which returns the oldest N rows — fine for a full-history load but a
 *  footgun when callers want "the tail"), this helper guarantees the tail.
 *
 *  Rationale: Narrator needs the most recent context. A previous bug in
 *  runTurn used `listConversation({limit:12}).slice(-6)` — once the transcript
 *  exceeded 12 rows, that silently returned rows 7..12 of the OLDEST 12,
 *  making Narrator respond to a turn 10 messages in the past. Use this helper
 *  whenever you mean "the last N". Optional `beforeId` lets callers page. */
export function latestConversationEntries(
  learnerId: string,
  count: number,
  opts: { beforeId?: number } = {}
): ConversationEntry[] {
  if (count <= 0) return [];
  const beforeId = opts.beforeId ?? Number.MAX_SAFE_INTEGER;
  const rows = db()
    .prepare(
      `SELECT * FROM conversation_log
       WHERE learner_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(learnerId, beforeId, count) as Array<Record<string, unknown>>;
  return rows.map(rowToEntry).reverse();
}

export function conversationCount(learnerId: string): number {
  const r = db()
    .prepare(`SELECT COUNT(*) AS n FROM conversation_log WHERE learner_id = ?`)
    .get(learnerId) as { n: number };
  return r.n;
}

/** Deprecated thin variant kept for backwards-compat in tests. Prefer
 * `ensureJourneyOrientation` which knows the full journey context. */
export function ensureBootstrapMessages(args: {
  learner_id: string;
  chapter_id: string;
  challenge_id: string;
  challenge_title: string;
  challenge_setup: string;
}): boolean {
  if (conversationCount(args.learner_id) > 0) return false;
  appendConversation({
    learner_id: args.learner_id,
    turn_idx: 0,
    chapter_id: args.chapter_id,
    challenge_id: args.challenge_id,
    role: "system",
    who: "notice",
    text: "对话历史从此刻开始持久化。此前的对话未被保存。 / Conversation history starts persisting from now on.",
    meta: { kind: "bootstrap_notice" },
  });
  appendConversation({
    learner_id: args.learner_id,
    turn_idx: 0,
    chapter_id: args.chapter_id,
    challenge_id: args.challenge_id,
    role: "narrator",
    text: `【${args.challenge_title}】${args.challenge_setup}`.trim(),
    meta: { kind: "challenge_opening", bootstrapped: true },
  });
  return true;
}

/** True if the learner already has an immersive opening bubble (new system)
 *  or the legacy `orientation_journey` marker (old system). This decides
 *  whether `ensureJourneyOrientation` has work to do. */
export function hasJourneyOrientation(learnerId: string): boolean {
  const rows = db()
    .prepare(
      `SELECT meta_json FROM conversation_log WHERE learner_id = ?`
    )
    .all(learnerId) as { meta_json: string | null }[];
  return rows.some((r) => {
    if (!r.meta_json) return false;
    try {
      const m = JSON.parse(r.meta_json) as { kind?: string };
      return (
        m.kind === "challenge_opening" ||
        m.kind === "orientation_journey" ||
        m.kind === "orientation_role"
      );
    } catch {
      return false;
    }
  });
}

export function lastConversationEntry(learnerId: string): ConversationEntry | null {
  const row = db()
    .prepare(
      `SELECT * FROM conversation_log WHERE learner_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(learnerId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToEntry(row);
}

// ---------- Artifacts ----------

/** Persist one artifact-drop as a conversation_log entry with role="artifact". */
export function dropArtifact(args: {
  learner_id: string;
  turn_idx: number;
  chapter_id: string | null;
  challenge_id: string | null;
  artifact: Artifact;
  trace_id?: string | null;
  trigger_source?: string;
}): ConversationEntry {
  const { artifact } = args;
  const meta: ArtifactDropMeta = {
    kind: "artifact_drop",
    artifact_id: artifact.artifact_id,
    version: artifact.version,
    type: artifact.type,
    content: artifact.content,
    trigger: artifact.trigger,
    supersedes: artifact.supersedes ?? null,
    ...(args.trigger_source ? { trigger_source: args.trigger_source } : {}),
  };
  return appendConversation({
    learner_id: args.learner_id,
    turn_idx: args.turn_idx,
    chapter_id: args.chapter_id,
    challenge_id: args.challenge_id,
    role: "artifact",
    who: artifact.name,
    text: `🎒 ${artifact.name}${artifact.version > 1 ? ` · v${artifact.version}` : ""}`,
    trace_id: args.trace_id ?? null,
    meta: meta as unknown as Record<string, unknown>,
  });
}

/** Returns true if this learner has already seen this (artifact_id, version). */
export function isArtifactAlreadyDropped(
  learnerId: string,
  artifactId: string,
  version: number
): boolean {
  const rows = db()
    .prepare(
      `SELECT meta_json FROM conversation_log
       WHERE learner_id = ? AND role = 'artifact'`
    )
    .all(learnerId) as { meta_json: string | null }[];
  for (const r of rows) {
    if (!r.meta_json) continue;
    try {
      const m = JSON.parse(r.meta_json) as { artifact_id?: string; version?: number };
      if (m.artifact_id === artifactId && m.version === version) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Aggregate the learner's dropped artifacts by artifact_id, versions ascending. */
export function listDroppedArtifacts(learnerId: string): DroppedArtifactGroup[] {
  const rows = db()
    .prepare(
      `SELECT id, ts, chapter_id, challenge_id, who, meta_json
       FROM conversation_log
       WHERE learner_id = ? AND role = 'artifact'
       ORDER BY id ASC`
    )
    .all(learnerId) as Array<{
    id: number;
    ts: string;
    chapter_id: string | null;
    challenge_id: string | null;
    who: string | null;
    meta_json: string | null;
  }>;

  const byId = new Map<string, DroppedArtifactGroup>();
  for (const r of rows) {
    if (!r.meta_json) continue;
    let meta: ArtifactDropMeta;
    try {
      meta = JSON.parse(r.meta_json) as ArtifactDropMeta;
    } catch {
      continue;
    }
    if (meta.kind !== "artifact_drop" || !meta.artifact_id) continue;
    const existing = byId.get(meta.artifact_id);
    const versionEntry = {
      version: meta.version,
      content: meta.content,
      trigger: meta.trigger,
      supersedes: meta.supersedes ?? null,
      conversation_id: r.id,
      ts: r.ts,
      chapter_id: r.chapter_id,
      challenge_id: r.challenge_id,
    };
    if (existing) {
      existing.versions.push(versionEntry);
    } else {
      byId.set(meta.artifact_id, {
        artifact_id: meta.artifact_id,
        name: r.who ?? meta.artifact_id,
        type: meta.type,
        versions: [versionEntry],
      });
    }
  }
  // Sort versions ascending within each group; stable insertion order for groups.
  for (const g of byId.values()) {
    g.versions.sort((a, b) => a.version - b.version);
  }
  return Array.from(byId.values());
}

function rowToEntry(r: Record<string, unknown>): ConversationEntry {
  let meta: Record<string, unknown> | null = null;
  if (typeof r.meta_json === "string" && r.meta_json) {
    try {
      meta = JSON.parse(r.meta_json) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  return {
    id: r.id as number,
    learner_id: r.learner_id as string,
    ts: r.ts as string,
    turn_idx: r.turn_idx as number,
    chapter_id: (r.chapter_id as string | null) ?? null,
    challenge_id: (r.challenge_id as string | null) ?? null,
    role: r.role as ConversationRole,
    who: (r.who as string | null) ?? null,
    text: r.text as string,
    trace_id: (r.trace_id as string | null) ?? null,
    meta,
  };
}
