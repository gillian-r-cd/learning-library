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
        className="rounded-lg border border-accent/40 bg-accent/5 p-3 max-w-[92%] cursor-pointer hover:bg-accent/10 transition-colors"
        data-test-id="msg-artifact"
        data-artifact-id={meta.artifact_id}
        data-artifact-version={meta.version}
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🎒</span>
          <span className="font-semibold text-sm">{name}</span>
          <span className="chip">{meta.type}</span>
          {meta.version > 1 && <span className="chip chip-stale">v{meta.version}</span>}
          <span className="ml-auto text-[10px] text-muted">{tsLabel}</span>
        </div>
        <div className="max-h-40 overflow-hidden text-sm relative">
          <ArtifactRenderer content={meta.content} />
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-accent/5 to-transparent pointer-events-none" />
        </div>
        <div className="mt-2 text-[11px] text-accent">点击查看完整内容 →</div>
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
