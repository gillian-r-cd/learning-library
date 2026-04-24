"use client";
import type {
  ArtifactContent,
  ArtifactFieldsContent,
  ArtifactHierarchyContent,
  ArtifactHierarchyNode,
  ArtifactListContent,
  ArtifactNarrativeContent,
  ArtifactSeriesContent,
  ArtifactTableContent,
} from "@/lib/types/core";

/** Dispatch to a type-specific renderer based on content.type. */
export function ArtifactRenderer({ content }: { content: ArtifactContent }) {
  switch (content.type) {
    case "narrative":
      return <NarrativeRenderer content={content} />;
    case "fields":
      return <FieldsRenderer content={content} />;
    case "series":
      return <SeriesRenderer content={content} />;
    case "list":
      return <ListRenderer content={content} />;
    case "table":
      return <TableRenderer content={content} />;
    case "hierarchy":
      return <HierarchyRenderer content={content} />;
  }
}

export function NarrativeRenderer({
  content,
}: {
  content: ArtifactNarrativeContent & { type: "narrative" };
}) {
  const h = content.header;
  return (
    <div data-test-id="renderer-narrative" className="space-y-2">
      {h && (h.from || h.to || h.date || h.subject) && (
        <div className="card-sub text-xs space-y-0.5">
          {h.subject && (
            <div>
              <span className="label">主题：</span>
              <span className="font-semibold">{h.subject}</span>
            </div>
          )}
          {h.from && (
            <div>
              <span className="label">From：</span>
              {h.from}
            </div>
          )}
          {h.to && (
            <div>
              <span className="label">To：</span>
              {h.to}
            </div>
          )}
          {h.date && (
            <div>
              <span className="label">Date：</span>
              {h.date}
            </div>
          )}
        </div>
      )}
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{content.body}</div>
      {content.footer && (
        <div className="text-xs text-muted mt-2">— {content.footer}</div>
      )}
    </div>
  );
}

export function FieldsRenderer({
  content,
}: {
  content: ArtifactFieldsContent & { type: "fields" };
}) {
  const renderEntries = (fields: NonNullable<ArtifactFieldsContent["fields"]>) => (
    <ul className="text-xs space-y-1">
      {fields.map((f, i) => (
        <li key={`${f.key}-${i}`} className="flex gap-2">
          <span className="text-muted min-w-[72px]">{f.key}</span>
          <span
            className={
              f.status === "highlight"
                ? "text-accent"
                : f.status === "warning"
                ? "text-warn"
                : f.status === "empty"
                ? "text-muted italic"
                : ""
            }
          >
            {f.value || (f.status === "empty" ? "(空)" : "")}
          </span>
          {f.note && <span className="text-muted/70">（{f.note}）</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <div data-test-id="renderer-fields" className="space-y-2">
      {content.title && <div className="font-semibold">{content.title}</div>}
      {content.sections && content.sections.length > 0
        ? content.sections.map((s, i) => (
            <div key={i}>
              <div className="label">{s.heading}</div>
              {renderEntries(s.fields)}
            </div>
          ))
        : renderEntries(content.fields ?? [])}
    </div>
  );
}

export function SeriesRenderer({
  content,
}: {
  content: ArtifactSeriesContent & { type: "series" };
}) {
  return (
    <div data-test-id="renderer-series" className="space-y-2">
      {content.title && <div className="font-semibold">{content.title}</div>}
      <ol className="relative border-l border-border pl-3 space-y-2">
        {content.entries.map((e, i) => (
          <li
            key={e.id ?? i}
            className={
              "text-xs " + (e.status === "muted" ? "text-muted/70" : "")
            }
          >
            {e.timestamp && (
              <span className="label mr-1">{e.timestamp}</span>
            )}
            {e.actor && (
              <span
                className={
                  e.status === "highlight" ? "text-accent font-semibold" : "font-semibold"
                }
              >
                {e.actor}：
              </span>
            )}
            <span className="whitespace-pre-wrap">{e.text}</span>
            {e.tag && <span className="chip ml-2">{e.tag}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ListRenderer({
  content,
}: {
  content: ArtifactListContent & { type: "list" };
}) {
  return (
    <div data-test-id="renderer-list" className="space-y-2">
      {content.title && <div className="font-semibold">{content.title}</div>}
      <ul className="text-xs space-y-1">
        {content.items.map((it, i) => {
          const marker =
            content.mode === "checklist"
              ? it.checked
                ? "☑"
                : "☐"
              : content.mode === "numbered"
              ? `${i + 1}.`
              : "•";
          return (
            <li key={i}>
              <span
                className={
                  it.status === "done"
                    ? "text-good"
                    : it.status === "warning"
                    ? "text-warn"
                    : it.status === "empty"
                    ? "text-muted italic"
                    : ""
                }
              >
                <span className="mr-1">{marker}</span>
                {it.text}
              </span>
              {it.sub_items && it.sub_items.length > 0 && (
                <ul className="ml-5 text-muted space-y-0.5 mt-0.5">
                  {it.sub_items.map((s, k) => (
                    <li key={k}>— {s}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TableRenderer({
  content,
}: {
  content: ArtifactTableContent & { type: "table" };
}) {
  const highlightSet = new Set(
    (content.highlight ?? []).map((h) => `${h.row}|${h.col}`)
  );
  return (
    <div data-test-id="renderer-table" className="space-y-2">
      {content.title && <div className="font-semibold">{content.title}</div>}
      <div className="overflow-x-auto">
        <table className="text-xs w-full border-collapse">
          <thead>
            <tr className="text-muted">
              {content.columns.map((c) => (
                <th
                  key={c.key}
                  className={`py-1 pr-2 text-${c.align ?? "left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((r, ri) => (
              <tr key={ri} className="border-t border-border">
                {content.columns.map((c) => {
                  const k = `${ri}|${c.key}`;
                  return (
                    <td
                      key={c.key}
                      className={
                        "py-1 pr-2 " +
                        (highlightSet.has(k) ? "text-accent font-semibold" : "")
                      }
                    >
                      {String(r[c.key] ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {content.row_notes && content.row_notes.length > 0 && (
        <ul className="text-[10px] text-muted space-y-0.5">
          {content.row_notes.map((n, i) => (
            <li key={i}>
              行 {n.row_index + 1}：{n.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HierarchyRenderer({
  content,
}: {
  content: ArtifactHierarchyContent & { type: "hierarchy" };
}) {
  return (
    <div data-test-id="renderer-hierarchy" className="space-y-2">
      {content.title && <div className="font-semibold">{content.title}</div>}
      <HierarchyNode node={content.root} depth={0} />
    </div>
  );
}

function HierarchyNode({
  node,
  depth,
}: {
  node: ArtifactHierarchyNode;
  depth: number;
}) {
  return (
    <div style={{ paddingLeft: depth * 12 }} className="text-xs">
      <div
        className={
          node.status === "highlight"
            ? "text-accent font-semibold"
            : node.status === "muted"
            ? "text-muted/70"
            : ""
        }
      >
        {depth > 0 && <span className="text-muted">└ </span>}
        {node.label}
        {node.meta && <span className="text-muted ml-2">（{node.meta}）</span>}
      </div>
      {node.children && node.children.length > 0 && (
        <div>
          {node.children.map((c, i) => (
            <HierarchyNode key={i} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
