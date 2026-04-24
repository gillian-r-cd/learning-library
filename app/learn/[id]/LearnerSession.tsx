"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Blueprint,
  LearnerState,
  EvidenceEntry,
  JudgeOutput,
  ConversationEntry,
  ConversationRole,
  ArtifactDropMeta,
  DroppedArtifactGroup,
} from "@/lib/types/core";
import type { Snapshot } from "@/lib/state-manager";
import type { JourneyProgress } from "@/lib/learning-runtime/progress";
import type {
  CompanionLibrary,
  PointsBreakdown,
  SignatureMovesLibrary,
  MasteryHeatmap,
} from "@/lib/learning-runtime/learner-view";
import type { ManifestoSegment } from "@/lib/learning-runtime/manifesto";
import { fetchJSON } from "@/lib/client/fetchJson";
import ProgressPanel from "./ProgressPanel";
import ArtifactBubble from "./artifacts/ArtifactBubble";
import ArtifactInbox from "./artifacts/ArtifactInbox";
import PointsBreakdownModal from "./PointsBreakdownModal";
import CompanionLibraryPanel from "./CompanionLibrary";
import SignatureMovesInbox from "./SignatureMovesInbox";
import MasteryHeatmapModal from "./MasteryHeatmapModal";
import ManifestoPanel from "./ManifestoPanel";

interface Msg {
  id?: number; // server-assigned conversation_log.id, undefined for optimistic bubbles
  role: ConversationRole;
  who?: string | null;
  text: string;
  ts: string | number;
  /** Only populated when role === "artifact". */
  artifactMeta?: ArtifactDropMeta;
  /** Sub-kind of the bubble (challenge_opening / scaffold / manifesto / etc).
   *  Drives subtle visual differentiation. */
  metaKind?: string | null;
  /** For challenge_opening bubbles: the arc-stage name to badge on the bubble. */
  arcStageName?: string | null;
  /** For scaffold bubbles: the cognitive strategy for the badge. */
  scaffoldStrategy?: string | null;
}

function entryToMsg(e: ConversationEntry): Msg {
  const meta =
    e.role === "artifact" && e.meta && (e.meta as { kind?: string }).kind === "artifact_drop"
      ? (e.meta as unknown as ArtifactDropMeta)
      : undefined;
  const kindRaw =
    e.meta && typeof e.meta === "object"
      ? (e.meta as { kind?: string }).kind ?? null
      : null;
  const arcStage =
    e.meta && typeof e.meta === "object"
      ? (e.meta as { arc_stage?: string }).arc_stage ?? null
      : null;
  const scaffoldStrategy =
    e.meta && typeof e.meta === "object"
      ? (e.meta as { strategy?: string }).strategy ?? null
      : null;
  return {
    id: e.id,
    role: e.role,
    who: e.who,
    text: e.text,
    ts: e.ts,
    artifactMeta: meta,
    metaKind: kindRaw,
    arcStageName: arcStage,
    scaffoldStrategy: kindRaw === "scaffold" ? scaffoldStrategy : null,
  };
}

export default function LearnerSession({
  learner,
  blueprint,
  snapshot: initialSnapshot,
  evidence: initialEvidence,
  conversation: initialConversation,
  progress: initialProgress,
  droppedArtifacts: initialDroppedArtifacts,
  pointsBreakdown: initialPointsBreakdown,
  companionLibrary: initialCompanionLibrary,
  signatureMovesLibrary: initialSignatureMovesLibrary,
  masteryHeatmap: initialMasteryHeatmap,
  manifestoSegments: initialManifestoSegments,
}: {
  learner: LearnerState;
  blueprint: Blueprint;
  snapshot: Snapshot;
  evidence: EvidenceEntry[];
  conversation: ConversationEntry[];
  progress: JourneyProgress | null;
  droppedArtifacts: DroppedArtifactGroup[];
  pointsBreakdown: PointsBreakdown;
  companionLibrary: CompanionLibrary;
  signatureMovesLibrary: SignatureMovesLibrary;
  masteryHeatmap: MasteryHeatmap;
  manifestoSegments: ManifestoSegment[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>(() => initialConversation.map(entryToMsg));
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [progress, setProgress] = useState<JourneyProgress | null>(initialProgress);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>(initialEvidence);
  const [lastJudge, setLastJudge] = useState<JudgeOutput | null>(null);
  const [showJudge, setShowJudge] = useState(false);
  const [droppedArtifacts, setDroppedArtifacts] =
    useState<DroppedArtifactGroup[]>(initialDroppedArtifacts);
  const [showInbox, setShowInbox] = useState(false);
  const [pointsBreakdown, setPointsBreakdown] =
    useState<PointsBreakdown>(initialPointsBreakdown);
  const [showPoints, setShowPoints] = useState(false);
  const [companionLibrary, setCompanionLibrary] =
    useState<CompanionLibrary>(initialCompanionLibrary);
  const [showCompanions, setShowCompanions] = useState(false);
  const [signatureMovesLibrary, setSignatureMovesLibrary] =
    useState<SignatureMovesLibrary>(initialSignatureMovesLibrary);
  const [showMoves, setShowMoves] = useState(false);
  const [masteryHeatmap, setMasteryHeatmap] =
    useState<MasteryHeatmap>(initialMasteryHeatmap);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [manifestoSegments, setManifestoSegments] =
    useState<ManifestoSegment[]>(initialManifestoSegments);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest message whenever msgs changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  /** Pull any conversation entries added since the highest id we already have. */
  async function syncConversation() {
    const maxId = msgs.reduce((m, x) => (x.id && x.id > m ? x.id : m), 0);
    const r = await fetchJSON<{ conversation?: ConversationEntry[] }>(
      `/api/learning/learners/${learner.learner_id}?conversation_since_id=${maxId}`,
      { cache: "no-store" }
    );
    if (r.ok && r.data?.conversation?.length) {
      const added = r.data.conversation.map(entryToMsg);
      // Replace any optimistic bubbles (id === undefined) with authoritative copies
      // by filtering them out, then appending the server additions.
      setMsgs((prev) => {
        const kept = prev.filter((m) => m.id !== undefined);
        return [...kept, ...added];
      });
    }
  }

  async function send() {
    const text = val.trim();
    if (!text || busy) return;
    setBusy(true);
    // Optimistic learner bubble — replaced by the authoritative record after sync.
    setMsgs((l) => [...l, { role: "learner", text, ts: Date.now() }]);
    setVal("");
    try {
      type TurnData = {
        error?: string;
        narratorText?: string;
        companionSpeeches?: { display_name: string; text: string }[];
        newUnlocks?: string[];
        judgeOutput?: JudgeOutput;
        newTotal?: number;
        effectiveTotal?: number;
        position?: LearnerState["position"];
        openingOfNewChallenge?: { title: string; setup: string } | null;
      };
      const r = await fetchJSON<TurnData>("/api/learning/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ learner_id: learner.learner_id, input: text }),
      });
      if (r.networkError) {
        setMsgs((l) => [
          ...l,
          {
            role: "system",
            who: "network",
            text: `⚠️ ${r.error} 你刚才的输入已经保存到日志；等服务恢复后刷新即可继续。`,
            ts: Date.now(),
          },
        ]);
        return;
      }
      if (!r.ok || r.data?.error) {
        setMsgs((l) => [
          ...l,
          {
            role: "system",
            who: "error",
            text: `❌ ${r.data?.error ?? r.error ?? "服务返回错误"}`,
            ts: Date.now(),
          },
        ]);
        return;
      }
      const j = r.data!;
      setLastJudge(j.judgeOutput ?? null);

      // Optimistic snapshot so the right rail updates instantly.
      setSnapshot((prev) => ({
        ...prev,
        learner: {
          ...prev.learner,
          points: { ...prev.learner.points, total: j.newTotal ?? prev.learner.points.total },
          position: j.position ?? prev.learner.position,
          unlocked_companions: [
            ...prev.learner.unlocked_companions,
            ...(j.newUnlocks ?? []).map((id) => ({
              companion_id: id,
              level: 1,
              unlocked_at: new Date().toISOString(),
            })),
          ],
        },
        effective_total: j.effectiveTotal ?? prev.effective_total,
        active_companions: [
          ...prev.active_companions,
          ...(j.newUnlocks ?? []).map((id) => ({ companion_id: id, level: 1 })),
        ],
      }));

      // Authoritative sync: pulls learner_input + narrator + companions + unlock
      // + optional cross-challenge opening in the exact order the server persisted them.
      await syncConversation();

      // Evidence + challenge-title + progress + dropped_artifacts +
      // points_breakdown + companion_library may have changed.
      const sres = await fetchJSON<{
        snapshot?: Snapshot;
        evidence?: EvidenceEntry[];
        progress?: JourneyProgress;
        dropped_artifacts?: DroppedArtifactGroup[];
        points_breakdown?: PointsBreakdown;
        companion_library?: CompanionLibrary;
        signature_moves_library?: SignatureMovesLibrary;
        mastery_heatmap?: MasteryHeatmap;
        manifesto_segments?: ManifestoSegment[];
      }>(`/api/learning/learners/${learner.learner_id}`, { cache: "no-store" });
      if (sres.ok && sres.data) {
        if (sres.data.snapshot) setSnapshot(sres.data.snapshot);
        if (sres.data.evidence) setEvidence(sres.data.evidence);
        if (sres.data.progress) setProgress(sres.data.progress);
        if (sres.data.dropped_artifacts) setDroppedArtifacts(sres.data.dropped_artifacts);
        if (sres.data.points_breakdown) setPointsBreakdown(sres.data.points_breakdown);
        if (sres.data.companion_library) setCompanionLibrary(sres.data.companion_library);
        if (sres.data.signature_moves_library)
          setSignatureMovesLibrary(sres.data.signature_moves_library);
        if (sres.data.mastery_heatmap) setMasteryHeatmap(sres.data.mastery_heatmap);
        if (sres.data.manifesto_segments)
          setManifestoSegments(sres.data.manifesto_segments);
      }
    } finally {
      setBusy(false);
    }
  }

  const challengeTitle = snapshot.current_challenge?.title ?? "—";
  const totalPts = snapshot.learner.points.total;
  const effPts = snapshot.effective_total;

  return (
    <div className="flex h-[calc(100vh-48px)]">
      <div className="flex-[3] flex flex-col border-r border-border">
        <div className="border-b border-border px-4 py-2 flex items-center gap-3 text-sm">
          <span className="font-semibold" data-test-id="challenge-title">
            {challengeTitle}
          </span>
          <span className="chip">{snapshot.current_challenge?.complexity ?? "?"}</span>
          <span className="chip">turn #{snapshot.learner.position.turn_idx}</span>
          <span className="chip text-muted" data-test-id="conv-count">
            {msgs.length} 条 · {msgs.length} msgs
          </span>
          <button
            className="btn text-xs ml-auto"
            onClick={() => setShowInbox(true)}
            data-test-id="open-artifact-inbox"
            aria-label="打开道具箱"
          >
            🎒 道具箱 · <span data-test-id="artifact-inbox-count">{droppedArtifacts.length}</span> 件
          </button>
          <button
            className="btn text-xs"
            onClick={() => setShowMoves(true)}
            data-test-id="open-signature-moves"
            aria-label="打开招式集"
          >
            ⚔️ 招式集 ·{" "}
            <span data-test-id="signature-moves-count">
              {signatureMovesLibrary.total_earned_count}/
              {signatureMovesLibrary.total_moves}
            </span>
          </button>
          <button
            className="btn text-xs"
            onClick={() => setShowCompanions(true)}
            data-test-id="open-companion-library"
            aria-label="打开伴学库"
          >
            👥 伴学库 ·{" "}
            <span data-test-id="companion-library-count">
              {companionLibrary.unlocked.length}/
              {companionLibrary.unlocked.length + companionLibrary.locked.length}
            </span>
          </button>
          <button
            className="btn text-xs"
            onClick={() => setShowHeatmap(true)}
            data-test-id="open-mastery-heatmap"
            aria-label="打开能力地图"
          >
            🎯 能力地图 ·{" "}
            <span data-test-id="mastery-heatmap-count">
              {masteryHeatmap.good_cells}/{masteryHeatmap.total_cells}
            </span>
          </button>
          <button
            className="btn text-xs"
            onClick={() => setShowPoints(true)}
            data-test-id="open-points-breakdown"
            aria-label="查看点数明细"
          >
            🪙 点数：
            <span className="text-accent" data-test-id="points-total">
              {totalPts}
            </span>{" "}
            · 有效
            <span className="text-good ml-0.5" data-test-id="points-effective">
              {effPts}
            </span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm" ref={scrollRef}>
          {msgs.length === 0 && (
            <div className="text-muted text-xs">
              还没有对话。你的输入、Narrator 旁白、Companion 发言都会出现在这里，且会完整保存到数据库，刷新或下次回来都看得到。
            </div>
          )}
          {msgs.map((m, i) => (
            <MsgBubble
              key={m.id ?? `opt-${i}`}
              msg={m}
              droppedArtifacts={droppedArtifacts}
            />
          ))}
        </div>
        <div className="border-t border-border p-3 flex gap-2">
          <input
            className="input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="自然语言回复挑战..."
            data-test-id="learner-input"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="btn-primary"
            onClick={send}
            data-test-id="learner-send"
            disabled={busy || !val.trim()}
          >
            {busy ? "..." : "发送"}
          </button>
        </div>
      </div>
      <div className="flex-[2] overflow-y-auto p-4 space-y-3">
        <ArcStageIndicator blueprint={blueprint} snapshot={snapshot} />
        <ProgressPanel progress={progress} />
        <ManifestoPanel segments={manifestoSegments} />
        <CurrentChallengeCard blueprint={blueprint} snapshot={snapshot} />
        <button
          className="card w-full text-left hover:border-accent/60 transition-colors"
          onClick={() => setShowCompanions(true)}
          data-test-id="right-panel-open-companions"
        >
          <div className="flex items-center gap-2">
            <span className="label">伴学 / Companions</span>
            <span className="chip ml-auto">
              {companionLibrary.unlocked.length}/
              {companionLibrary.unlocked.length + companionLibrary.locked.length}
            </span>
          </div>
          {companionLibrary.unlocked.length === 0 ? (
            <div className="text-xs text-muted mt-1">
              尚未解锁；继续做核心动作累积积分。点击查看全部伴学介绍 →
            </div>
          ) : (
            <>
              <ul className="text-xs mt-1 space-y-1">
                {companionLibrary.unlocked.slice(0, 3).map((c) => (
                  <li
                    key={c.companion_id}
                    data-test-id={`unlocked-${c.companion_id}`}
                  >
                    <span className="chip chip-confirmed">Lv.{c.level}</span>{" "}
                    {c.display_name}
                  </li>
                ))}
                {companionLibrary.unlocked.length > 3 && (
                  <li className="text-muted">
                    …还有 {companionLibrary.unlocked.length - 3} 位
                  </li>
                )}
              </ul>
              <div className="text-[11px] text-accent mt-1">
                点击查看每位伴学能做什么 →
              </div>
            </>
          )}
          {companionLibrary.locked.length > 0 && (
            <div className="text-[11px] text-muted mt-2 border-t border-border pt-2">
              下一位解锁：
              <span className="text-warn">
                {companionLibrary.locked[0].display_name}
              </span>
              （差 {companionLibrary.locked[0].points_needed} 分）
            </div>
          )}
        </button>
        {lastJudge && (
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="label">Judge 最近一次输出 / Latest Judge</div>
              <button className="text-xs text-accent" onClick={() => setShowJudge((v) => !v)}>
                {showJudge ? "收起" : "展开"}
              </button>
            </div>
            {showJudge && (
              <pre className="text-[10px] text-muted whitespace-pre-wrap mt-1">
                {JSON.stringify(lastJudge, null, 2)}
              </pre>
            )}
          </div>
        )}
        <div className="card">
          <div className="label">Evidence（最近 10 条）/ Recent evidence</div>
          <ul className="text-xs mt-1 space-y-1">
            {evidence.slice(0, 10).map((e) => (
              <li key={e.id} className="card-sub">
                <span className="text-muted">
                  {e.action_id} · turn {e.turn_idx}:
                </span>{" "}
                {Object.entries(e.grades).map(([k, v]) => (
                  <span key={k} className="chip ml-1">
                    {k}:{v}
                  </span>
                ))}
                <div className="text-muted mt-0.5">{e.evidence}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {showInbox && (
        <ArtifactInbox
          groups={droppedArtifacts}
          onClose={() => setShowInbox(false)}
        />
      )}
      {showCompanions && (
        <CompanionLibraryPanel
          library={companionLibrary}
          onClose={() => setShowCompanions(false)}
        />
      )}
      {showMoves && (
        <SignatureMovesInbox
          library={signatureMovesLibrary}
          onClose={() => setShowMoves(false)}
        />
      )}
      {showHeatmap && (
        <MasteryHeatmapModal
          heatmap={masteryHeatmap}
          onClose={() => setShowHeatmap(false)}
        />
      )}
      {showPoints && (
        <PointsBreakdownModal
          breakdown={pointsBreakdown}
          onClose={() => setShowPoints(false)}
        />
      )}
    </div>
  );
}

/** Hero's-journey arc stage indicator — shows the learner which stage of the
 *  arc the current chapter belongs to. Permanently mounted at the top of the
 *  right panel so learners always know "where they are" in their arc. */
function ArcStageIndicator({
  blueprint,
  snapshot,
}: {
  blueprint: Blueprint;
  snapshot: Snapshot;
}) {
  const chapter = blueprint.step3_script?.chapters.find(
    (c) => c.chapter_id === snapshot.current_challenge?.chapter_id
  );
  const stages = blueprint.step3_script?.journey_meta?.arc_stages ?? [];
  if (stages.length === 0) return null;
  const current = chapter?.arc_stage_id
    ? stages.find((s) => s.id === chapter.arc_stage_id) ?? null
    : null;
  return (
    <div className="card" data-test-id="arc-stage-indicator">
      <div className="flex items-center gap-2">
        <span>🧭</span>
        <span className="label">英雄之旅 / Arc</span>
        {current && (
          <span
            className="chip chip-confirmed ml-auto"
            data-test-id="arc-stage-current"
          >
            {current.position + 1}/{stages.length} · {current.name}
          </span>
        )}
      </div>
      <div className="flex gap-1 flex-wrap mt-2">
        {stages.map((s) => {
          const passed = current && s.position < current.position;
          const isCurrent = current && s.id === current.id;
          return (
            <span
              key={s.id}
              className={`chip text-[10px] ${
                isCurrent
                  ? "chip-confirmed"
                  : passed
                  ? "text-good border-good/30 bg-good/5"
                  : "text-muted"
              }`}
              title={s.signature_question}
            >
              {passed ? "✓ " : ""}
              {s.name}
            </span>
          );
        })}
      </div>
      {current && (
        <div className="text-[11px] text-muted mt-2">
          本阶段问题：<span className="italic">{current.signature_question}</span>
        </div>
      )}
    </div>
  );
}

function CurrentChallengeCard({
  blueprint,
  snapshot,
}: {
  blueprint: Blueprint;
  snapshot: Snapshot;
}) {
  const current = snapshot.current_challenge;
  if (!current) return null;
  const ch = blueprint.step3_script?.chapters.find((c) => c.chapter_id === current.chapter_id);
  const cl = ch?.challenges.find((c) => c.challenge_id === current.challenge_id);
  if (!cl) return null;
  return (
    <div className="card" data-test-id="current-challenge-card">
      <div className="label">
        当前挑战 <span className="text-muted/70">Current challenge</span>
      </div>
      <div className="font-semibold mt-1">{cl.title}</div>
      {cl.trunk?.setup && (
        <div className="text-xs text-muted mt-1 whitespace-pre-wrap">{cl.trunk.setup}</div>
      )}
      {(cl.trunk?.action_prompts?.length ?? 0) > 0 && (
        <div className="mt-2">
          <div className="label text-[10px]">你要思考</div>
          <ul className="list-disc list-inside text-xs text-muted mt-0.5 space-y-0.5">
            {cl.trunk!.action_prompts.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MsgBubble({
  msg,
  droppedArtifacts,
}: {
  msg: Msg;
  droppedArtifacts: DroppedArtifactGroup[];
}) {
  const tsLabel =
    typeof msg.ts === "string"
      ? new Date(msg.ts).toLocaleTimeString()
      : new Date(msg.ts).toLocaleTimeString();
  if (msg.role === "artifact" && msg.artifactMeta) {
    const group = droppedArtifacts.find(
      (g) => g.artifact_id === msg.artifactMeta!.artifact_id
    );
    const versions = group
      ? group.versions.map((v) => ({ version: v.version, content: v.content }))
      : [{ version: msg.artifactMeta.version, content: msg.artifactMeta.content }];
    return (
      <ArtifactBubble
        meta={msg.artifactMeta}
        name={msg.who ?? msg.artifactMeta.artifact_id}
        ts={msg.ts}
        versions={versions}
      />
    );
  }
  if (msg.role === "learner") {
    return (
      <div
        className="rounded-lg px-3 py-2 bg-accent/20 border border-accent/30 ml-auto max-w-[80%] text-right"
        data-test-id="msg-learner"
      >
        <div className="label mb-0.5">学员 · {tsLabel}</div>
        <div className="whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (msg.role === "narrator") {
    // Subtle visual differentiation for challenge_opening (threshold moment).
    const isOpening = msg.metaKind === "challenge_opening";
    const className = isOpening
      ? "rounded-lg px-3 py-2.5 bg-panel border-l-2 border-l-accent border-y border-r border-border max-w-[80%]"
      : "rounded-lg px-3 py-2 bg-panel border border-border max-w-[80%]";
    return (
      <div
        className={className}
        data-test-id={isOpening ? "msg-narrator-opening" : "msg-narrator"}
      >
        <div className="label mb-0.5 text-muted flex items-center gap-2">
          <span>Narrator · {tsLabel}</span>
          {isOpening && msg.arcStageName && (
            <span
              className="chip chip-confirmed text-[10px]"
              data-test-id={`arc-stage-chip-${msg.arcStageName}`}
            >
              🧭 {msg.arcStageName}
            </span>
          )}
          {isOpening && !msg.arcStageName && (
            <span className="chip text-[10px]">🎬 新一幕</span>
          )}
        </div>
        <div className="whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (msg.role === "companion") {
    return (
      <div
        className="rounded-lg px-3 py-2 bg-panel2 border border-warn/20 max-w-[80%]"
        data-test-id="msg-companion"
      >
        <div className="label mb-0.5 text-warn">{msg.who ?? "伴学"} · {tsLabel}</div>
        <div className="whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  // system events: milestone / unlock / orientation / notice / error / network
  const who = msg.who ?? "";
  let tone = "bg-panel2 border-border text-muted";
  if (who === "milestone") tone = "bg-good/10 border-good/40 text-good";
  else if (who === "unlock") tone = "bg-warn/10 border-warn/40 text-warn";
  else if (who === "orientation") tone = "bg-accent/10 border-accent/40 text-accent";
  else if (who === "error" || who === "network") tone = "bg-bad/10 border-bad/40 text-bad";
  return (
    <div
      className={`rounded-lg px-3 py-1.5 border text-xs max-w-[90%] mx-auto text-center whitespace-pre-wrap ${tone}`}
      data-test-id={`msg-system-${who || "generic"}`}
    >
      {msg.text}
    </div>
  );
}
