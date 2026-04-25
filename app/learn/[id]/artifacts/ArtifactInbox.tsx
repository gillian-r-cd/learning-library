"use client";
import { useState } from "react";
import type { DroppedArtifactGroup } from "@/lib/types/core";
import ArtifactModal from "./ArtifactModal";

interface Props {
  groups: DroppedArtifactGroup[];
  onClose: () => void;
}

export default function ArtifactInbox({ groups, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openGroup = groups.find((g) => g.artifact_id === openId) ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        data-test-id="artifact-inbox-backdrop"
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 bottom-0 w-[400px] max-w-full z-50 bg-panel/95 border-l border-accent/30 flex flex-col shadow-2xl"
        data-test-id="artifact-inbox"
      >
        <div className="border-b border-border px-4 py-3 flex items-center gap-2">
          <span className="font-semibold">道具箱</span>
          <span className="chip">{groups.length} 件</span>
          <button className="btn text-xs ml-auto" onClick={onClose} data-test-id="artifact-inbox-close">
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {groups.length === 0 && (
            <div className="text-xs text-muted text-center mt-8">
              还没有道具掉落。继续推进挑战，关键物件会陆续出现在这里。
            </div>
          )}
          {groups.map((g) => {
            const latest = g.versions[g.versions.length - 1];
            return (
              <button
                key={g.artifact_id}
                className="card-sub w-full text-left hover:border-accent/60 transition-colors"
                data-test-id={`artifact-inbox-item-${g.artifact_id}`}
                onClick={() => setOpenId(g.artifact_id)}
              >
                <div className="flex items-center gap-2">
                  <span>{g.icon_hint ?? "🎒"}</span>
                  <span className="font-semibold text-sm">{g.name}</span>
                  <span className="chip">{g.type}</span>
                  {g.versions.length > 1 && (
                    <span className="chip chip-stale">{g.versions.length} 个版本</span>
                  )}
                </div>
                <div className="text-[11px] text-muted mt-1">
                  最新 v{latest.version} · {new Date(latest.ts).toLocaleString()}
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      {openGroup && (
        <ArtifactModal
          artifactId={openGroup.artifact_id}
          name={openGroup.name}
          type={openGroup.type}
          versions={openGroup.versions.map((v) => ({
            version: v.version,
            content: v.content,
          }))}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
