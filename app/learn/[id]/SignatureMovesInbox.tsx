"use client";
import { useState } from "react";
import type { SignatureMovesLibrary, SignatureMoveCard } from "@/lib/learning-runtime/learner-view";

interface Props {
  library: SignatureMovesLibrary;
  onClose: () => void;
}

export default function SignatureMovesInbox({ library, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const allCards: SignatureMoveCard[] = [...library.earned, ...library.locked];
  const openCard = allCards.find((c) => c.move_id === openId) ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        data-test-id="signature-moves-backdrop"
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 bottom-0 w-[440px] max-w-full z-50 bg-panel border-l border-border flex flex-col"
        data-test-id="signature-moves"
      >
        <div className="border-b border-border px-4 py-3 flex items-center gap-2">
          <span className="text-xl">⚔️</span>
          <span className="font-semibold">我的招式集</span>
          <span className="chip">
            {library.total_earned_count}/{library.total_moves}
          </span>
          <button
            className="btn text-xs ml-auto"
            onClick={onClose}
            data-test-id="signature-moves-close"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {library.total_moves === 0 && (
            <div className="text-xs text-muted text-center mt-8">
              当前旅程没有注册招式。
            </div>
          )}

          {library.earned.length > 0 && (
            <section>
              <div className="label mb-2 text-good">
                已获 · {library.earned.length} 招
              </div>
              <div className="space-y-2">
                {library.earned.map((c) => (
                  <EarnedMoveCard
                    key={c.move_id}
                    card={c}
                    onOpen={() => setOpenId(c.move_id)}
                  />
                ))}
              </div>
            </section>
          )}

          {library.locked.length > 0 && (
            <section>
              <div className="label mb-2 text-muted">
                尚未获得 · 还有 {library.locked.length} 招可解
              </div>
              <div className="space-y-2">
                {library.locked.map((c) => (
                  <LockedMoveCard
                    key={c.move_id}
                    card={c}
                    onOpen={() => setOpenId(c.move_id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
      {openCard && (
        <MoveDetailModal card={openCard} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

function EarnedMoveCard({
  card,
  onOpen,
}: {
  card: SignatureMoveCard;
  onOpen: () => void;
}) {
  return (
    <button
      className="card-sub w-full text-left border-good/40 hover:border-good transition-colors"
      data-test-id={`move-earned-${card.move_id}`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">⚔️</span>
        <span className="font-semibold">{card.name}</span>
        {card.current_tier_label && (
          <span className="chip chip-confirmed">{card.current_tier_label}</span>
        )}
        <span className="ml-auto text-[11px] text-muted">
          × {card.count ?? 0}
        </span>
      </div>
      <div className="text-xs text-muted mt-1">{card.definition}</div>
      {card.triggering_quote && (
        <div className="text-[11px] text-muted/80 mt-1 italic">
          「{card.triggering_quote.slice(0, 60)}
          {card.triggering_quote.length > 60 ? "…" : ""}」
        </div>
      )}
    </button>
  );
}

function LockedMoveCard({
  card,
  onOpen,
}: {
  card: SignatureMoveCard;
  onOpen: () => void;
}) {
  return (
    <button
      className="card-sub w-full text-left opacity-70 hover:opacity-100 hover:border-warn/60 transition-all"
      data-test-id={`move-locked-${card.move_id}`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg grayscale">⚔️</span>
        <span className="font-semibold text-muted">{card.name}</span>
        <span className="ml-auto chip">{card.bound_action_names.join(" / ")}</span>
      </div>
      <div className="text-xs text-muted mt-1">{card.definition}</div>
      <div className="text-[11px] text-muted/80 mt-1">
        在练「{card.bound_action_names.join("、")}」时，展示出定义里的模式即可获得
      </div>
    </button>
  );
}

function MoveDetailModal({
  card,
  onClose,
}: {
  card: SignatureMoveCard;
  onClose: () => void;
}) {
  const isEarned = card.status === "earned";
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      data-test-id="move-detail-modal"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-xl border border-border max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="text-3xl">⚔️</span>
          <div className="flex-1">
            <div className="font-semibold text-lg">{card.name}</div>
            <div className="text-xs text-muted">
              {isEarned
                ? `${card.current_tier_label} · 累计 ${card.count} 次`
                : "尚未获得"}
            </div>
          </div>
          <button
            className="btn text-xs"
            onClick={onClose}
            data-test-id="move-detail-close"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          <section>
            <div className="label">定义</div>
            <div>{card.definition}</div>
          </section>
          <section>
            <div className="label">归属核心动作</div>
            <div className="flex gap-1 flex-wrap mt-1">
              {card.bound_action_names.map((n, i) => (
                <span key={i} className="chip">
                  {n}
                </span>
              ))}
            </div>
          </section>
          <section>
            <div className="label">分级门槛</div>
            <div className="flex gap-2 mt-1 text-xs">
              {["初识", "娴熟", "立派"].map((lbl, i) => (
                <span
                  key={lbl}
                  className={
                    "chip " +
                    (isEarned && (card.current_tier ?? 0) > i
                      ? "chip-confirmed"
                      : "")
                  }
                >
                  {lbl}（≥{card.tier_thresholds[i]} 次）
                </span>
              ))}
            </div>
          </section>
          {isEarned && card.triggering_quote && (
            <section className="card-sub">
              <div className="label">首次获得 · 你说过的话</div>
              <div className="text-sm italic mt-1">
                「{card.triggering_quote}」
              </div>
              {card.first_challenge_title && (
                <div className="text-[11px] text-muted mt-2">
                  — 发生在挑战「{card.first_challenge_title}」
                </div>
              )}
              {card.first_earned_at && (
                <div className="text-[11px] text-muted">
                  {new Date(card.first_earned_at).toLocaleString()}
                </div>
              )}
            </section>
          )}
          {!isEarned && (
            <section className="card-sub">
              <div className="label text-warn">如何获得</div>
              <div className="text-xs text-muted mt-1">
                在练「{card.bound_action_names.join("、")}」的回合里，清晰地展示出这一招的定义所描述的认知模式——Judge
                识别到即会奖励给你。
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
