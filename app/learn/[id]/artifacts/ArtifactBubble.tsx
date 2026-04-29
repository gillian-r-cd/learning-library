"use client";
import { useMemo, useState } from "react";
import type { ArtifactDropMeta } from "@/lib/types/core";
import { ArtifactRenderer } from "./renderers";
import { ArtifactDiffView } from "./ArtifactDiffView";

interface Props {
  meta: ArtifactDropMeta;
  name: string;
  ts: string | number;
  /** Optional: all versions of this artifact for in-place version switching. */
  versions?: Array<{
    version: number;
    content: ArtifactDropMeta["content"];
  }>;
}

const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  narrative: "文本",
  fields: "档案",
  series: "记录",
  list: "清单",
  table: "表格",
  hierarchy: "结构",
};

export default function ArtifactBubble({ meta, name, ts, versions }: Props) {
  // Inline expansion replaces the previous modal: clicking the card flips
  // the bubble between a clamped preview and the full file (with version
  // switcher + diff toggle inline). No popup, no scroll-jump — the file
  // stays where it dropped in the conversation timeline.
  const [expanded, setExpanded] = useState(false);
  const sortedVersions = useMemo(() => {
    const supplied = versions && versions.length > 0
      ? versions
      : [{ version: meta.version, content: meta.content }];
    return [...supplied].sort((a, b) => a.version - b.version);
  }, [versions, meta.version, meta.content]);
  const [currentVer, setCurrentVer] = useState<number>(
    sortedVersions[sortedVersions.length - 1]?.version ?? meta.version
  );
  const [showDiff, setShowDiff] = useState(false);

  const current =
    sortedVersions.find((v) => v.version === currentVer) ?? sortedVersions[0];
  const prevIdx = sortedVersions.findIndex((v) => v.version === currentVer) - 1;
  const previous = prevIdx >= 0 ? sortedVersions[prevIdx] : null;
  const canDiff = !!previous && ["narrative", "fields", "list"].includes(meta.type);
  const tsLabel = new Date(ts).toLocaleTimeString();

  const toggle = () => {
    setExpanded((v) => {
      // Reset diff state when collapsing so reopening starts clean.
      if (v) setShowDiff(false);
      return !v;
    });
  };

  return (
    <div
      className={`moment-card border-amber-200 bg-amber-50 max-w-[92%] transition-colors ${
        expanded ? "" : "cursor-pointer hover:bg-amber-100/70"
      }`}
      data-test-id="msg-artifact"
      data-artifact-id={meta.artifact_id}
      data-artifact-version={meta.version}
      data-expanded={expanded ? "1" : "0"}
      onClick={expanded ? undefined : toggle}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-sm text-amber-800">新文件 · {name}</span>
        <span className="chip">{ARTIFACT_TYPE_LABEL[meta.type] ?? "文件"}</span>
        {meta.version > 1 && <span className="chip chip-stale">v{meta.version}</span>}
        <span className="ml-auto text-[10px] text-muted">{tsLabel}</span>
      </div>

      {expanded ? (
        <>
          {(sortedVersions.length > 1 || canDiff) && (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {sortedVersions.length > 1 && (
                <select
                  className="btn text-xs"
                  value={currentVer}
                  onChange={(e) => {
                    setCurrentVer(Number(e.target.value));
                    setShowDiff(false);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  data-test-id="artifact-version-select"
                >
                  {sortedVersions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version}
                    </option>
                  ))}
                </select>
              )}
              {canDiff && (
                <button
                  className="btn text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDiff((s) => !s);
                  }}
                  data-test-id="artifact-diff-toggle"
                >
                  {showDiff ? "退出对比" : "对比上一版"}
                </button>
              )}
            </div>
          )}
          <div className="text-sm" data-test-id="artifact-expanded-body">
            {showDiff && previous ? (
              <ArtifactDiffView prev={previous.content} curr={current.content} />
            ) : (
              <ArtifactRenderer content={current.content} />
            )}
          </div>
          <button
            className="mt-3 text-[11px] text-amber-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            data-test-id="artifact-collapse"
          >
            收起 ↑
          </button>
        </>
      ) : (
        <>
          <div className="max-h-40 overflow-hidden text-sm relative">
            <ArtifactRenderer content={current.content} />
            <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-amber-50 to-transparent pointer-events-none" />
          </div>
          <div
            className="mt-2 text-[11px] text-amber-700"
            data-test-id="artifact-expand-hint"
          >
            打开完整文件 ↓
          </div>
        </>
      )}
    </div>
  );
}
