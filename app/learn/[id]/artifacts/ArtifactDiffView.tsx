"use client";
import type { ArtifactContent } from "@/lib/types/core";
import { ArtifactRenderer } from "./renderers";

export function ArtifactDiffView({
  prev,
  curr,
}: {
  prev: ArtifactContent;
  curr: ArtifactContent;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-3" data-test-id="artifact-diff-view">
      <div className="card-sub">
        <div className="label mb-2">上一版 · v(n-1)</div>
        <ArtifactRenderer content={prev} />
      </div>
      <div className="card-sub border-accent/40">
        <div className="label mb-2 text-accent">当前版本 · v(n)</div>
        <ArtifactRenderer content={curr} />
        {prev.type === curr.type && (
          <div className="mt-3 pt-2 border-t border-border text-[11px] text-muted">
            <DiffNotes prev={prev} curr={curr} />
          </div>
        )}
      </div>
    </div>
  );
}

function DiffNotes({
  prev,
  curr,
}: {
  prev: ArtifactContent;
  curr: ArtifactContent;
}) {
  if (prev.type === "fields" && curr.type === "fields") {
    const prevMap = new Map<string, string>();
    (prev.fields ?? []).forEach((f) => prevMap.set(f.key, f.value));
    const changes: string[] = [];
    (curr.fields ?? []).forEach((f) => {
      if (!prevMap.has(f.key)) changes.push(`新增字段：${f.key}=${f.value}`);
      else if (prevMap.get(f.key) !== f.value)
        changes.push(`${f.key}：${prevMap.get(f.key)} → ${f.value}`);
    });
    if (changes.length === 0) return <span>（字段无变化）</span>;
    return (
      <ul className="space-y-0.5">
        {changes.map((c, i) => (
          <li key={i}>· {c}</li>
        ))}
      </ul>
    );
  }
  if (prev.type === "list" && curr.type === "list") {
    const prevTexts = new Set(prev.items.map((i) => i.text));
    const added = curr.items.filter((i) => !prevTexts.has(i.text));
    const currTexts = new Set(curr.items.map((i) => i.text));
    const removed = prev.items.filter((i) => !currTexts.has(i.text));
    if (added.length === 0 && removed.length === 0) return <span>（条目无变化）</span>;
    return (
      <ul className="space-y-0.5">
        {added.map((i, k) => (
          <li key={`+${k}`} className="text-good">
            + {i.text}
          </li>
        ))}
        {removed.map((i, k) => (
          <li key={`-${k}`} className="text-bad">
            − {i.text}
          </li>
        ))}
      </ul>
    );
  }
  if (prev.type === "narrative" && curr.type === "narrative") {
    if (prev.body === curr.body) return <span>（正文无变化）</span>;
    const prevLen = prev.body.length;
    const currLen = curr.body.length;
    return (
      <span>
        正文变化：{prevLen} → {currLen} 字（
        {currLen > prevLen ? `+${currLen - prevLen}` : `${currLen - prevLen}`}）
      </span>
    );
  }
  return null;
}
