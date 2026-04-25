"use client";
import { useState } from "react";
import type { ArtifactDropMeta } from "@/lib/types/core";
import { ArtifactRenderer } from "./renderers";
import ArtifactModal from "./ArtifactModal";

interface Props {
  meta: ArtifactDropMeta;
  name: string;
  ts: string | number;
  /** Optional: all versions of this artifact for history switching inside the modal. */
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
  const [open, setOpen] = useState(false);
  const tsLabel =
    typeof ts === "string"
      ? new Date(ts).toLocaleTimeString()
      : new Date(ts).toLocaleTimeString();

  // A compact preview body: the renderer inside a clamp-like panel.
  return (
    <>
      <div
        className="moment-card border-amber-200 bg-amber-50 max-w-[92%] cursor-pointer hover:bg-amber-100/70 transition-colors"
        data-test-id="msg-artifact"
        data-artifact-id={meta.artifact_id}
        data-artifact-version={meta.version}
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="font-semibold text-sm text-amber-800">新文件 · {name}</span>
          <span className="chip">{ARTIFACT_TYPE_LABEL[meta.type] ?? "文件"}</span>
          {meta.version > 1 && <span className="chip chip-stale">v{meta.version}</span>}
          <span className="ml-auto text-[10px] text-muted">{tsLabel}</span>
        </div>
        <div className="max-h-40 overflow-hidden text-sm relative">
          <ArtifactRenderer content={meta.content} />
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-amber-50 to-transparent pointer-events-none" />
        </div>
        <div className="mt-2 text-[11px] text-amber-700">打开完整文件</div>
      </div>
      {open && (
        <ArtifactModal
          artifactId={meta.artifact_id}
          name={name}
          type={meta.type}
          versions={
            versions && versions.length > 0
              ? versions
              : [{ version: meta.version, content: meta.content }]
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
