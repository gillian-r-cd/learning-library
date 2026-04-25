"use client";
import { useState, useMemo } from "react";
import type { ArtifactContent, ArtifactType } from "@/lib/types/core";
import { ArtifactRenderer } from "./renderers";

interface Version {
  version: number;
  content: ArtifactContent;
}

interface Props {
  artifactId: string;
  name: string;
  type: ArtifactType;
  versions: Version[];
  onClose: () => void;
}

const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  narrative: "文本",
  fields: "档案",
  series: "记录",
  list: "清单",
  table: "表格",
  hierarchy: "结构",
};

export default function ArtifactModal({
  artifactId,
  name,
  type,
  versions,
  onClose,
}: Props) {
  const sorted = useMemo(
    () => [...versions].sort((a, b) => a.version - b.version),
    [versions]
  );
  const [currentVer, setCurrentVer] = useState<number>(
    sorted[sorted.length - 1]?.version ?? 1
  );
  const [showDiff, setShowDiff] = useState(false);

  const current = sorted.find((v) => v.version === currentVer) ?? sorted[0];
  const prevIndex = sorted.findIndex((v) => v.version === currentVer) - 1;
  const previous = prevIndex >= 0 ? sorted[prevIndex] : null;
  const canDiff = !!previous && ["narrative", "fields", "list"].includes(type);

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      data-test-id="artifact-modal"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[1.5rem] border border-border max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-panel2/60">
          <span className="text-2xl">📁</span>
          <div className="flex-1">
            <div className="font-semibold">{name}</div>
            <div className="text-xs text-muted">
              已收进文件夹 · <span className="chip">{ARTIFACT_TYPE_LABEL[type] ?? "文件"}</span>
            </div>
          </div>
          {sorted.length > 1 && (
            <select
              className="btn text-xs"
              value={currentVer}
              onChange={(e) => {
                setCurrentVer(Number(e.target.value));
                setShowDiff(false);
              }}
              data-test-id="artifact-version-select"
            >
              {sorted.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
          )}
          {canDiff && (
            <button
              className="btn text-xs"
              onClick={() => setShowDiff((s) => !s)}
              data-test-id="artifact-diff-toggle"
            >
              {showDiff ? "退出对比" : "对比上一版"}
            </button>
          )}
          <button className="btn text-xs" onClick={onClose} data-test-id="artifact-modal-close">
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4" data-test-id="artifact-modal-body">
          {showDiff && previous ? (
            <DiffView prev={previous.content} curr={current.content} />
          ) : (
            <ArtifactRenderer content={current.content} />
          )}
        </div>
      </div>
    </div>
  );
}

function DiffView({
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

function DiffNotes({ prev, curr }: { prev: ArtifactContent; curr: ArtifactContent }) {
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
