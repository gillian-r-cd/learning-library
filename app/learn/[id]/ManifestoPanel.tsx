"use client";
import { useState } from "react";
import type { ManifestoSegment } from "@/lib/learning-runtime/manifesto";

export default function ManifestoPanel({
  segments,
}: {
  segments: ManifestoSegment[];
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (segments.length === 0) {
    return (
      <div className="stage-card" data-test-id="manifesto-panel-empty">
        <div className="flex items-center gap-2">
          <span className="label">我的宣言</span>
        </div>
        <div className="text-xs text-muted mt-1">
          完成一整章后，这里会用你自己的原话合成一段本章宣言，由你署名。
        </div>
      </div>
    );
  }

  return (
    <div className="stage-card" data-test-id="manifesto-panel">
      <div className="flex items-center gap-2">
        <span className="label">我的宣言</span>
        <span className="chip ml-auto">{segments.length} 章已完成</span>
      </div>
      <div className="mt-2 space-y-2">
        {segments.map((seg) => {
          const isOpen = expandedId === seg.id;
          return (
            <div
              key={seg.id}
              className="card-sub"
              data-test-id={`manifesto-segment-${seg.chapter_id}`}
            >
              <button
                className="w-full text-left"
                onClick={() => setExpandedId(isOpen ? null : seg.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">
                    {seg.chapter_title ?? seg.chapter_id}
                  </span>
                  {seg.arc_stage_name && (
                    <span className="chip">{seg.arc_stage_name}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted">
                    {isOpen ? "收起" : "展开"}
                  </span>
                </div>
                {!isOpen && (
                  <div className="text-xs text-muted mt-1 line-clamp-2">
                    {seg.text}
                  </div>
                )}
              </button>
              {isOpen && (
                <>
                  <div className="text-xs mt-2 whitespace-pre-wrap leading-relaxed italic">
                    {seg.text}
                  </div>
                  {seg.source_learner_quotes.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-muted cursor-pointer">
                        素材来源 · 你在本章说过的原话（{seg.source_learner_quotes.length} 段）
                      </summary>
                      <ul className="text-[11px] text-muted/90 mt-1 space-y-1 list-disc list-inside">
                        {seg.source_learner_quotes.map((q, i) => (
                          <li key={i} className="whitespace-pre-wrap">
                            {q}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
