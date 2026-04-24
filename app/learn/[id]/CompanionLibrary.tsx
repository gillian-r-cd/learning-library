"use client";
import { useState } from "react";
import type {
  CompanionLibrary,
  UnlockedCompanionCard,
  LockedCompanionCard,
} from "@/lib/learning-runtime/learner-view";

interface Props {
  library: CompanionLibrary;
  onClose: () => void;
}

const TYPE_ICON: Record<string, string> = {
  npc_guide: "🧭",
  npc_traveler: "🎒",
  npc_competitor: "⚔️",
  npc_adversary: "🔥",
  case_pack: "📘",
  hidden_plotline: "🗝️",
  difficulty_dial: "🎚️",
  replay_lens: "📊",
  context_variant: "🔄",
};

const OUTPUT_LABEL: Record<string, string> = {
  dialog_text: "对话台词",
  reading_artifact: "阅读型材料",
  plot_delta: "剧情变体",
  param_override: "参数调节",
  visualization: "可视化",
  scenario_override: "场景替换",
};

export default function CompanionLibraryPanel({ library, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const allCards: Array<UnlockedCompanionCard | LockedCompanionCard> = [
    ...library.unlocked,
    ...library.locked,
  ];
  const openCard = allCards.find((c) => c.companion_id === openId) ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        data-test-id="companion-library-backdrop"
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 bottom-0 w-[440px] max-w-full z-50 bg-panel border-l border-border flex flex-col"
        data-test-id="companion-library"
      >
        <div className="border-b border-border px-4 py-3 flex items-center gap-2">
          <span className="text-xl">👥</span>
          <span className="font-semibold">伴学库</span>
          <span className="chip">
            {library.unlocked.length}/{library.unlocked.length + library.locked.length}
          </span>
          <button
            className="btn text-xs ml-auto"
            onClick={onClose}
            data-test-id="companion-library-close"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {library.unlocked.length === 0 && library.locked.length === 0 && (
            <div className="text-xs text-muted text-center mt-8">
              这个旅程还没有设计伴学。
            </div>
          )}

          {library.unlocked.length > 0 && (
            <section>
              <div className="label mb-2 text-good">
                已解锁 · {library.unlocked.length} 位
              </div>
              <div className="space-y-2">
                {library.unlocked.map((c) => (
                  <UnlockedCard
                    key={c.companion_id}
                    card={c}
                    onOpen={() => setOpenId(c.companion_id)}
                  />
                ))}
              </div>
            </section>
          )}

          {library.locked.length > 0 && (
            <section>
              <div className="label mb-2 text-muted">
                未解锁 · 还有 {library.locked.length} 位
              </div>
              <div className="space-y-2">
                {library.locked.map((c) => (
                  <LockedCard
                    key={c.companion_id}
                    card={c}
                    onOpen={() => setOpenId(c.companion_id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
      {openCard && (
        <CompanionDetailModal card={openCard} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

function UnlockedCard({
  card,
  onOpen,
}: {
  card: UnlockedCompanionCard;
  onOpen: () => void;
}) {
  return (
    <button
      className="card-sub w-full text-left border-good/40 hover:border-good transition-colors"
      data-test-id={`companion-unlocked-${card.companion_id}`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span>{TYPE_ICON[card.companion_type] ?? "👤"}</span>
        <span className="font-semibold">{card.display_name}</span>
        <span className="chip chip-confirmed">Lv.{card.level}</span>
        <span className="chip">{card.companion_type}</span>
      </div>
      <div className="text-xs text-muted mt-1">
        {card.unique_value_hypothesis || "（独特价值未描述）"}
      </div>
      <div className="text-[11px] text-muted/80 mt-1">
        已发言 {card.speech_count} 次 · 解锁于{" "}
        {new Date(card.unlocked_at).toLocaleString()}
      </div>
    </button>
  );
}

function LockedCard({
  card,
  onOpen,
}: {
  card: LockedCompanionCard;
  onOpen: () => void;
}) {
  const progressPct = card.unlock_threshold
    ? Math.min(100, Math.round((card.effective_total_now / card.unlock_threshold) * 100))
    : 0;
  return (
    <button
      className="card-sub w-full text-left opacity-70 hover:opacity-100 hover:border-warn/60 transition-all"
      data-test-id={`companion-locked-${card.companion_id}`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span className="grayscale">{TYPE_ICON[card.companion_type] ?? "👤"}</span>
        <span className="font-semibold text-muted">{card.display_name}</span>
        <span className="chip">{card.companion_type}</span>
        <span className="ml-auto text-xs text-warn">
          差 {card.points_needed} 分解锁
        </span>
      </div>
      <div className="text-xs text-muted mt-1">
        {card.unique_value_hypothesis || "（独特价值未描述）"}
      </div>
      <div className="mt-2 h-1.5 bg-bg rounded-full overflow-hidden">
        <div
          className="h-full bg-warn/60"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="text-[11px] text-muted/80 mt-1">
        {card.effective_total_now} / {card.unlock_threshold} 分
        {card.unlock_order ? ` · 第 ${card.unlock_order} 位解锁` : ""}
      </div>
    </button>
  );
}

function CompanionDetailModal({
  card,
  onClose,
}: {
  card: UnlockedCompanionCard | LockedCompanionCard;
  onClose: () => void;
}) {
  const isLocked = card.status === "locked";
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      data-test-id="companion-detail-modal"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-xl border border-border max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="text-3xl">{TYPE_ICON[card.companion_type] ?? "👤"}</span>
          <div className="flex-1">
            <div className="font-semibold text-lg">{card.display_name}</div>
            <div className="text-xs text-muted">
              {card.companion_type} · 输出形式：
              {OUTPUT_LABEL[card.output_format] ?? card.output_format}
              {isLocked ? " · 未解锁" : ` · Lv.${(card as UnlockedCompanionCard).level}`}
            </div>
          </div>
          <button
            className="btn text-xs"
            onClick={onClose}
            data-test-id="companion-detail-close"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          <section>
            <div className="label">独特价值</div>
            <div className="text-muted">{card.unique_value_hypothesis || "—"}</div>
          </section>
          <section>
            <div className="label">有效性机制</div>
            <div className="text-muted">{card.effectiveness_mechanism || "—"}</div>
          </section>
          {card.persona_background && (
            <section>
              <div className="label">背景</div>
              <div className="text-muted">{card.persona_background}</div>
            </section>
          )}
          {card.personality_traits.length > 0 && (
            <section>
              <div className="label">性格特征</div>
              <div className="flex gap-1 flex-wrap mt-1">
                {card.personality_traits.map((t, i) => (
                  <span key={i} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
          {card.typical_phrases.length > 0 && (
            <section>
              <div className="label">说话风格 / 口头禅</div>
              <ul className="text-xs text-muted mt-1 list-disc list-inside">
                {card.typical_phrases.map((p, i) => (
                  <li key={i}>"{p}"</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <div className="label">何时会说话</div>
            <div className="text-xs text-muted">{card.speak_when || "—"}</div>
            <div className="label mt-1">何时保持沉默</div>
            <div className="text-xs text-muted">{card.silent_when || "—"}</div>
          </section>
          {card.relationship_stages.length > 0 && (
            <section>
              <div className="label">关系阶段</div>
              <ul className="text-xs mt-1 space-y-0.5">
                {card.relationship_stages.map((s, i) => (
                  <li key={i}>
                    <span className="chip">Lv.{s.level}</span>
                    <span className="ml-2 text-muted">{s.stance}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {card.upgrade_path.length > 0 && (
            <section>
              <div className="label">升级路径</div>
              <ul className="text-xs mt-1 space-y-0.5">
                {card.upgrade_path.map((u, i) => (
                  <li key={i}>
                    <span className="chip">Lv.{u.level}</span>
                    <span className="ml-2 text-muted">{u.delta}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="card-sub">
            {isLocked ? (
              <>
                <div className="label text-warn">解锁条件</div>
                <div className="text-xs text-warn mt-1">
                  累计达到 <span className="font-semibold">{card.unlock_threshold} 分</span>
                  （当前 {(card as LockedCompanionCard).effective_total_now} 分，还差{" "}
                  {(card as LockedCompanionCard).points_needed} 分）
                </div>
              </>
            ) : (
              <>
                <div className="label text-good">已解锁</div>
                <div className="text-xs text-muted mt-1">
                  解锁于{" "}
                  {new Date((card as UnlockedCompanionCard).unlocked_at).toLocaleString()}
                  ，已与你互动 {(card as UnlockedCompanionCard).speech_count} 次
                </div>
              </>
            )}
          </section>
          {!isLocked && (card as UnlockedCompanionCard).recent_speeches.length > 0 && (
            <section>
              <div className="label">最近发言</div>
              <ul className="text-xs mt-1 space-y-1">
                {(card as UnlockedCompanionCard).recent_speeches.map((s, i) => (
                  <li key={i} className="card-sub">
                    <div className="text-muted text-[10px]">
                      turn {s.turn_idx} · {new Date(s.ts).toLocaleString()}
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap">{s.text}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
