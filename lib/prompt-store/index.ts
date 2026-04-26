// Two-tier Prompt Store (PRD §8.3.1)
// Resolution order: course-level override → system-level base
// Stored in DB; system-level seeded on first run.

import { db } from "@/lib/db";
import type { PromptBody } from "@/lib/prompt-store/render";
import { seedPrompts } from "@/lib/prompt-store/seed";

let seededOnce = false;
function ensureSeed() {
  if (seededOnce) return;
  seededOnce = true;
  seedPrompts();
  normalizePublishedPromptUniqueness();
}

export interface StoredPrompt {
  key: string;
  scope: string; // "system" | "course:<blueprint_id>"
  version: number;
  status: "draft" | "approved" | "published" | "rolled_back";
  body: PromptBody;
  created_at: string;
  created_by: string;
  note?: string | null;
}

export function getPublishedPrompt(key: string, scope: string): StoredPrompt | null {
  ensureSeed();
  const row = db()
    .prepare(
      `SELECT key, scope, version, status, body_json, created_at, created_by, note
       FROM prompt_store
       WHERE key = ? AND scope = ? AND status = 'published'
       ORDER BY version DESC
       LIMIT 1`
    )
    .get(key, scope) as
    | {
        key: string;
        scope: string;
        version: number;
        status: StoredPrompt["status"];
        body_json: string;
        created_at: string;
        created_by: string;
        note: string | null;
      }
    | undefined;
  if (!row) return null;
  return { ...row, body: JSON.parse(row.body_json) };
}

/** Resolve the system-level template key, allowing dynamic callers (e.g.
 * `companion:<id>`) to fall back to a shared base template. */
function systemTemplateKey(caller: string): string {
  // All `companion:*` callers share `companion.template` as their base.
  if (caller.startsWith("companion:")) return "companion.template";
  return `${caller}.template`;
}

/** Merge system + course-level. Course overrides only top-level fields that are provided. */
export function getEffectivePrompt(
  caller: string,
  blueprintId: string | null
): PromptBody & { systemVersion: number; courseVersion: number | null } {
  ensureSeed();
  const sysKey = systemTemplateKey(caller);
  const system = getPublishedPrompt(sysKey, "system");

  if (!system) {
    // No system-level template — return a clearly-marked placeholder so the
    // caller surfaces this as an error rather than emitting confusing prompts.
    return {
      system: `[MISSING_TEMPLATE] caller=${caller}. Admin must seed the prompt store.`,
      messages: [{ role: "user", content: "" }],
      systemVersion: 0,
      courseVersion: null,
    };
  }

  // Scope lookups: try caller-specific course scope first (companion:<id>.template
  // still resolved via companion.template base, but course-level overrides are
  // keyed by the full caller so each companion can have its own course override).
  const courseKey = `${caller}.template`;
  let merged: PromptBody = { ...system.body };
  let courseVersion: number | null = null;
  if (blueprintId) {
    const course = getPublishedPrompt(courseKey, `course:${blueprintId}`);
    if (course) {
      merged = {
        ...merged,
        ...course.body,
        messages: course.body.messages?.length ? course.body.messages : merged.messages,
      };
      courseVersion = course.version;
    }
  }
  return { ...merged, systemVersion: system.version, courseVersion };
}

export interface UpsertArgs {
  key: string;
  scope: string;
  status: StoredPrompt["status"];
  body: PromptBody;
  created_by: string;
  note?: string | null;
}

export function upsertPrompt(args: UpsertArgs): StoredPrompt {
  ensureSeed();
  const latest = db()
    .prepare(
      `SELECT MAX(version) AS v FROM prompt_store WHERE key = ? AND scope = ?`
    )
    .get(args.key, args.scope) as { v: number | null };
  const nextVersion = (latest?.v ?? 0) + 1;

  const createdAt = new Date().toISOString();
  const d = db();
  if (args.status === "published") {
    d.prepare(
      `UPDATE prompt_store
       SET status = 'rolled_back'
       WHERE key = ? AND scope = ? AND status = 'published'`
    ).run(args.key, args.scope);
  }
  d.prepare(
      `INSERT INTO prompt_store
         (key, scope, version, status, body_json, created_at, created_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.key,
      args.scope,
      nextVersion,
      args.status,
      JSON.stringify(args.body),
      createdAt,
      args.created_by,
      args.note ?? null
    );

  // log admin audit
  d.prepare(
      `INSERT INTO admin_audit (at, actor, action, target, diff_json) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      createdAt,
      args.created_by,
      args.status === "published" ? "publish_prompt" : "upsert_prompt",
      `${args.key}@${args.scope}#v${nextVersion}`,
      null
    );

  return {
    key: args.key,
    scope: args.scope,
    version: nextVersion,
    status: args.status,
    body: args.body,
    created_at: createdAt,
    created_by: args.created_by,
    note: args.note ?? null,
  };
}

export function listPromptKeys(): {
  key: string;
  scope: string;
  version: number;
  status: string;
  created_at: string;
}[] {
  ensureSeed();
  const rows = db()
    .prepare(
      `SELECT p.key, p.scope, p.version, p.status, p.created_at
       FROM prompt_store p
       INNER JOIN (
         SELECT key, scope, MAX(version) AS version
         FROM prompt_store
         WHERE status = 'published'
         GROUP BY key, scope
       ) latest
         ON latest.key = p.key
        AND latest.scope = p.scope
        AND latest.version = p.version
       ORDER BY p.scope, p.key`
    )
    .all() as {
    key: string;
    scope: string;
    version: number;
    status: string;
    created_at: string;
  }[];
  return rows;
}

function normalizePublishedPromptUniqueness(): void {
  db()
    .prepare(
      `UPDATE prompt_store
       SET status = 'rolled_back'
       WHERE status = 'published'
         AND EXISTS (
           SELECT 1
           FROM prompt_store newer
           WHERE newer.key = prompt_store.key
             AND newer.scope = prompt_store.scope
             AND newer.status = 'published'
             AND newer.version > prompt_store.version
         )`
    )
    .run();
}

export function getPromptHistory(
  key: string,
  scope: string
): StoredPrompt[] {
  ensureSeed();
  const rows = db()
    .prepare(
      `SELECT key, scope, version, status, body_json, created_at, created_by, note
       FROM prompt_store WHERE key = ? AND scope = ?
       ORDER BY version DESC`
    )
    .all(key, scope) as {
    key: string;
    scope: string;
    version: number;
    status: StoredPrompt["status"];
    body_json: string;
    created_at: string;
    created_by: string;
    note: string | null;
  }[];
  return rows.map((r) => ({ ...r, body: JSON.parse(r.body_json) }));
}
