// Artifacts normalizer — defensively coerce Skill 3 output into the strict
// Artifact schema. LLMs may drop fields, mix up content with type, or invent
// trigger values. This module is the only place that should repair artifacts.

import type {
  Artifact,
  ArtifactContent,
  ArtifactFieldEntry,
  ArtifactHierarchyNode,
  ArtifactListItem,
  ArtifactSeriesEntry,
  ArtifactTrigger,
  ArtifactType,
  Challenge,
} from "@/lib/types/core";

const VALID_TYPES: ArtifactType[] = [
  "narrative",
  "fields",
  "series",
  "list",
  "table",
  "hierarchy",
];

const VALID_TRIGGERS: ArtifactTrigger[] = [
  "on_challenge_enter",
  "on_learner_request",
  "on_judge_scaffold",
];

type RawArtifact = Record<string, unknown>;

/** Normalize every artifact on a challenge. Silently repairs malformed shapes. */
export function normalizeChallengeArtifacts(challenge: Challenge): Challenge {
  const raw = (challenge as unknown as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(raw)) {
    // No artifacts field → leave as undefined so downstream code can check presence.
    return challenge;
  }
  const normalized = raw
    .map((a, idx) => normalizeArtifact(a as RawArtifact, challenge.challenge_id, idx))
    .filter((a): a is Artifact => a !== null);
  return { ...challenge, artifacts: normalized };
}

export function normalizeArtifact(
  raw: RawArtifact | null | undefined,
  challengeId: string,
  idx: number
): Artifact | null {
  if (!raw || typeof raw !== "object") return null;

  const artifact_id =
    typeof raw.artifact_id === "string" && raw.artifact_id.trim()
      ? (raw.artifact_id as string)
      : `art_${challengeId}_${idx}`;

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? (raw.name as string)
      : `道具 ${idx + 1}`;

  const icon_hint =
    typeof raw.icon_hint === "string" ? (raw.icon_hint as string) : undefined;

  const rawType = raw.type as string;
  const type: ArtifactType = VALID_TYPES.includes(rawType as ArtifactType)
    ? (rawType as ArtifactType)
    : "narrative";

  const trigger: ArtifactTrigger = VALID_TRIGGERS.includes(raw.trigger as ArtifactTrigger)
    ? (raw.trigger as ArtifactTrigger)
    : "on_challenge_enter";

  const trigger_hint =
    typeof raw.trigger_hint === "string" ? (raw.trigger_hint as string) : undefined;

  const version =
    typeof raw.version === "number" && raw.version > 0 ? Math.floor(raw.version) : 1;

  const supersedes =
    typeof raw.supersedes === "string" && raw.supersedes.trim()
      ? (raw.supersedes as string)
      : null;

  const narrator_intro =
    typeof raw.narrator_intro === "string" ? (raw.narrator_intro as string) : undefined;

  const content = normalizeContent(type, raw.content, name);

  return {
    artifact_id,
    name,
    icon_hint,
    type: content.type,
    content,
    trigger,
    trigger_hint,
    version,
    supersedes,
    narrator_intro,
  };
}

/** Coerce content into a shape that matches the declared `type`. If the input
 *  is unparseable for the declared type, fall back to a narrative wrapper that
 *  stringifies whatever came in. */
export function normalizeContent(
  type: ArtifactType,
  rawContent: unknown,
  nameForFallback: string
): ArtifactContent {
  const c = (rawContent ?? {}) as Record<string, unknown>;

  try {
    switch (type) {
      case "narrative":
        return normalizeNarrative(c, nameForFallback);
      case "fields":
        return normalizeFields(c);
      case "series":
        return normalizeSeries(c);
      case "list":
        return normalizeList(c);
      case "table":
        return normalizeTable(c);
      case "hierarchy":
        return normalizeHierarchy(c, nameForFallback);
    }
  } catch {
    // Any thrown error → fall through to narrative fallback
  }
  return fallbackToNarrative(rawContent, nameForFallback);
}

function normalizeNarrative(
  c: Record<string, unknown>,
  nameForFallback: string
): ArtifactContent {
  const headerRaw = (c.header ?? {}) as Record<string, unknown>;
  const header = {
    from: optString(headerRaw.from),
    to: optString(headerRaw.to),
    date: optString(headerRaw.date),
    subject: optString(headerRaw.subject),
  };
  const hasHeader = Object.values(header).some((v) => v !== undefined);

  const body = typeof c.body === "string" && c.body.trim()
    ? (c.body as string)
    : stringifyUnknown(c) || `（${nameForFallback} · 内容空白）`;

  const footer = optString(c.footer);

  const annRaw = Array.isArray(c.annotations) ? (c.annotations as unknown[]) : [];
  const annotations = annRaw
    .map((a) => {
      const r = (a ?? {}) as Record<string, unknown>;
      const span = Array.isArray(r.span) && r.span.length === 2
        ? ([Number(r.span[0]) || 0, Number(r.span[1]) || 0] as [number, number])
        : null;
      const note = typeof r.note === "string" ? (r.note as string) : "";
      if (!span || !note) return null;
      return { span, note };
    })
    .filter((x): x is { span: [number, number]; note: string } => x !== null);

  const out: ArtifactContent = {
    type: "narrative",
    body,
    ...(hasHeader ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(annotations.length > 0 ? { annotations } : {}),
  };
  return out;
}

function normalizeFields(c: Record<string, unknown>): ArtifactContent {
  const title = optString(c.title);
  const sectionsRaw = Array.isArray(c.sections) ? (c.sections as unknown[]) : [];
  const sections = sectionsRaw
    .map((s) => {
      const r = (s ?? {}) as Record<string, unknown>;
      const heading = typeof r.heading === "string" ? (r.heading as string) : "";
      const fields = normalizeFieldEntries(r.fields);
      if (!heading && fields.length === 0) return null;
      return { heading: heading || "（未命名分组）", fields };
    })
    .filter((x): x is { heading: string; fields: ArtifactFieldEntry[] } => x !== null);

  const flatFields = normalizeFieldEntries(c.fields);

  const out: ArtifactContent = {
    type: "fields",
    ...(title ? { title } : {}),
    ...(sections.length > 0 ? { sections } : {}),
    ...(flatFields.length > 0
      ? { fields: flatFields }
      : sections.length === 0
      ? { fields: [] }
      : {}),
  };
  return out;
}

function normalizeFieldEntries(raw: unknown): ArtifactFieldEntry[] {
  if (!Array.isArray(raw)) return [];
  const VALID_STATUS: ArtifactFieldEntry["status"][] = [
    "filled",
    "empty",
    "warning",
    "highlight",
  ];
  return (raw as unknown[])
    .map((f) => {
      const r = (f ?? {}) as Record<string, unknown>;
      const key = typeof r.key === "string" ? (r.key as string) : "";
      if (!key) return null;
      const value =
        r.value === undefined || r.value === null ? "" : String(r.value);
      const statusRaw = r.status as ArtifactFieldEntry["status"];
      return {
        key,
        value,
        ...(VALID_STATUS.includes(statusRaw) ? { status: statusRaw } : {}),
        ...(typeof r.note === "string" && r.note ? { note: r.note as string } : {}),
      };
    })
    .filter((x): x is ArtifactFieldEntry => x !== null);
}

function normalizeSeries(c: Record<string, unknown>): ArtifactContent {
  const title = optString(c.title);
  const ordering = (["time_asc", "time_desc", "manual"] as const).includes(
    c.ordering as "time_asc" | "time_desc" | "manual"
  )
    ? (c.ordering as "time_asc" | "time_desc" | "manual")
    : undefined;

  const entriesRaw = Array.isArray(c.entries) ? (c.entries as unknown[]) : [];
  const entries: ArtifactSeriesEntry[] = entriesRaw
    .map((e) => {
      const r = (e ?? {}) as Record<string, unknown>;
      const text = typeof r.text === "string" ? (r.text as string) : "";
      if (!text) return null;
      const status = (["default", "highlight", "muted"] as const).includes(
        r.status as "default" | "highlight" | "muted"
      )
        ? (r.status as "default" | "highlight" | "muted")
        : undefined;
      return {
        ...(typeof r.id === "string" ? { id: r.id as string } : {}),
        ...(typeof r.timestamp === "string" ? { timestamp: r.timestamp as string } : {}),
        ...(typeof r.actor === "string" ? { actor: r.actor as string } : {}),
        text,
        ...(typeof r.tag === "string" ? { tag: r.tag as string } : {}),
        ...(status ? { status } : {}),
      };
    })
    .filter((x): x is ArtifactSeriesEntry => x !== null);

  return {
    type: "series",
    ...(title ? { title } : {}),
    ...(ordering ? { ordering } : {}),
    entries,
  };
}

function normalizeList(c: Record<string, unknown>): ArtifactContent {
  const title = optString(c.title);
  const mode = (["checklist", "bullet", "numbered"] as const).includes(
    c.mode as "checklist" | "bullet" | "numbered"
  )
    ? (c.mode as "checklist" | "bullet" | "numbered")
    : "bullet";

  const itemsRaw = Array.isArray(c.items) ? (c.items as unknown[]) : [];
  const items: ArtifactListItem[] = itemsRaw
    .map((i) => {
      const r = (i ?? {}) as Record<string, unknown>;
      const text = typeof r.text === "string" ? (r.text as string) : "";
      if (!text) return null;
      const status = (["default", "warning", "done", "empty"] as const).includes(
        r.status as "default" | "warning" | "done" | "empty"
      )
        ? (r.status as "default" | "warning" | "done" | "empty")
        : undefined;
      const sub = Array.isArray(r.sub_items)
        ? (r.sub_items as unknown[])
            .filter((s): s is string => typeof s === "string" && s.length > 0)
        : undefined;
      return {
        text,
        ...(typeof r.checked === "boolean" ? { checked: r.checked as boolean } : {}),
        ...(status ? { status } : {}),
        ...(sub && sub.length > 0 ? { sub_items: sub } : {}),
      };
    })
    .filter((x): x is ArtifactListItem => x !== null);

  return {
    type: "list",
    ...(title ? { title } : {}),
    mode,
    items,
  };
}

function normalizeTable(c: Record<string, unknown>): ArtifactContent {
  const title = optString(c.title);
  const columnsRaw = Array.isArray(c.columns) ? (c.columns as unknown[]) : [];
  const columns = columnsRaw
    .map((col) => {
      const r = (col ?? {}) as Record<string, unknown>;
      const key = typeof r.key === "string" ? (r.key as string) : "";
      if (!key) return null;
      const label =
        typeof r.label === "string" && r.label ? (r.label as string) : key;
      const align = (["left", "right", "center"] as const).includes(
        r.align as "left" | "right" | "center"
      )
        ? (r.align as "left" | "right" | "center")
        : undefined;
      return { key, label, ...(align ? { align } : {}) };
    })
    .filter((x): x is { key: string; label: string; align?: "left" | "right" | "center" } => x !== null);

  const rowsRaw = Array.isArray(c.rows) ? (c.rows as unknown[]) : [];
  const rows = rowsRaw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const out: Record<string, string | number> = {};
      for (const col of columns) {
        const v = (row as Record<string, unknown>)[col.key];
        if (v === undefined || v === null) {
          out[col.key] = "";
        } else if (typeof v === "number") {
          out[col.key] = v;
        } else {
          out[col.key] = String(v);
        }
      }
      return out;
    })
    .filter((x): x is Record<string, string | number> => x !== null);

  const rowNotesRaw = Array.isArray(c.row_notes) ? (c.row_notes as unknown[]) : [];
  const row_notes = rowNotesRaw
    .map((n) => {
      const r = (n ?? {}) as Record<string, unknown>;
      const row_index = typeof r.row_index === "number" ? (r.row_index as number) : -1;
      const note = typeof r.note === "string" ? (r.note as string) : "";
      if (row_index < 0 || !note) return null;
      return { row_index, note };
    })
    .filter((x): x is { row_index: number; note: string } => x !== null);

  const highlightRaw = Array.isArray(c.highlight) ? (c.highlight as unknown[]) : [];
  const highlight = highlightRaw
    .map((h) => {
      const r = (h ?? {}) as Record<string, unknown>;
      const row = typeof r.row === "number" ? (r.row as number) : -1;
      const col = typeof r.col === "string" ? (r.col as string) : "";
      if (row < 0 || !col) return null;
      return { row, col };
    })
    .filter((x): x is { row: number; col: string } => x !== null);

  return {
    type: "table",
    ...(title ? { title } : {}),
    columns,
    rows,
    ...(row_notes.length > 0 ? { row_notes } : {}),
    ...(highlight.length > 0 ? { highlight } : {}),
  };
}

function normalizeHierarchy(
  c: Record<string, unknown>,
  nameForFallback: string
): ArtifactContent {
  const title = optString(c.title);
  const rootRaw = (c.root ?? {}) as Record<string, unknown>;
  const root = normalizeHierarchyNode(rootRaw, nameForFallback);
  return {
    type: "hierarchy",
    ...(title ? { title } : {}),
    root,
  };
}

function normalizeHierarchyNode(
  r: Record<string, unknown>,
  fallback: string,
  isRoot = true
): ArtifactHierarchyNode {
  // Root always gets a label (fallback if missing). Child nodes with no label
  // are dropped by the caller; here we just return null-ish via empty label for
  // non-root, which is filtered by the caller.
  const hasLabel = typeof r.label === "string" && r.label.trim().length > 0;
  const label = hasLabel ? (r.label as string) : isRoot ? fallback : "";
  const meta = optString(r.meta);
  const status = (["default", "highlight", "muted"] as const).includes(
    r.status as "default" | "highlight" | "muted"
  )
    ? (r.status as "default" | "highlight" | "muted")
    : undefined;
  const childrenRaw = Array.isArray(r.children) ? (r.children as unknown[]) : [];
  const children = childrenRaw
    .map((c) => normalizeHierarchyNode((c ?? {}) as Record<string, unknown>, fallback, false))
    .filter((n) => n.label);
  return {
    label,
    ...(meta ? { meta } : {}),
    ...(status ? { status } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function fallbackToNarrative(raw: unknown, name: string): ArtifactContent {
  return {
    type: "narrative",
    body: stringifyUnknown(raw) || `（${name} · 内容不可识别）`,
  };
}

function stringifyUnknown(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? (v as string) : undefined;
}
