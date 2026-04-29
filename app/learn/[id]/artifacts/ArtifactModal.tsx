"use client";
import { useState, useMemo } from "react";
import type { ArtifactContent, ArtifactType } from "@/lib/types/core";
import { ArtifactRenderer } from "./renderers";
import { ArtifactDiffView } from "./ArtifactDiffView";

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
            <ArtifactDiffView prev={previous.content} curr={current.content} />
          ) : (
            <ArtifactRenderer content={current.content} />
          )}
        </div>
      </div>
    </div>
  );
}
