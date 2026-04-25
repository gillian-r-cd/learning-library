"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Blueprint,
  LearnerState,
  EvidenceEntry,
  HelpRequest,
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
import ResponseFrameRenderer, { type ResponseFrameSubmit } from "./ResponseFrameRenderer";

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
  meta?: Record<string, unknown> | null;
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
    meta: e.meta,
  };
}

const COMPLEXITY_LABEL: Record<string, string> = {
  low: "入门",
  medium: "进阶",
  high: "高压",
};

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
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>(initialEvidence);
  const [lastJudge, setLastJudge] = useState<JudgeOutput | null>(null);
  const [showJudge, setShowJudge] = useState(false);
  const [showDevDetails, setShowDevDetails] = useState(false);
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

  async function send(response: ResponseFrameSubmit, optimisticText: string) {
    if (busy) return;
    setBusy(true);
    // Optimistic learner bubble — replaced by the authoritative record after sync.
    setMsgs((l) => [...l, { role: "learner", text: optimisticText, ts: Date.now() }]);
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
        body: JSON.stringify({ learner_id: learner.learner_id, response }),
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

  async function requestHelp(kind: HelpRequest["kind"]) {
    if (busy) return;
    setBusy(true);
    const label = helpRequestLabel(kind);
    setMsgs((l) => [...l, { role: "learner", text: label.optimisticText, ts: Date.now() }]);
    try {
      type TurnData = {
        error?: string;
        judgeOutput?: JudgeOutput;
        newUnlocks?: string[];
        newTotal?: number;
        effectiveTotal?: number;
        position?: LearnerState["position"];
      };
      const r = await fetchJSON<TurnData>("/api/learning/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          learner_id: learner.learner_id,
          help_request: { kind },
        }),
      });
      if (!r.ok || r.networkError || r.data?.error) {
        setMsgs((l) => [
          ...l,
          {
            role: "system",
            who: "error",
            text: `求助没有成功：${r.data?.error ?? r.error ?? "服务返回错误"}`,
            ts: Date.now(),
          },
        ]);
        return;
      }
      const j = r.data!;
      setLastJudge(j.judgeOutput ?? null);
      setSnapshot((prev) => ({
        ...prev,
        learner: {
          ...prev.learner,
          points: { ...prev.learner.points, total: j.newTotal ?? prev.learner.points.total },
          position: j.position ?? prev.learner.position,
        },
        effective_total: j.effectiveTotal ?? prev.effective_total,
      }));
      await syncConversation();
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
  const complexity = snapshot.current_challenge?.complexity ?? "low";
  const journeyPercent = progress
    ? Math.round((progress.completed_challenges / Math.max(1, progress.total_challenges)) * 100)
    : 0;

  return (
    <div className="flex h-[calc(100vh-48px)] stage-shell">
      <div className="flex-[3] flex flex-col border-r border-border">
        <div className="border-b border-border/80 px-4 py-3 flex items-center gap-3 text-sm bg-bg/45 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="chip !border-accent/40 !text-accent">
                {COMPLEXITY_LABEL[complexity] ?? complexity}
              </span>
              <span className="font-semibold truncate" data-test-id="challenge-title">
                {challengeTitle}
              </span>
            </div>
            <div className="text-[11px] text-muted mt-0.5">
              第 {snapshot.learner.position.turn_idx + 1} 次尝试 · 旅程 {journeyPercent}%
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn text-xs"
              onClick={() => setShowPoints(true)}
              data-test-id="open-points-breakdown"
              aria-label="查看点数明细"
            >
              点数 <span className="text-warn font-semibold" data-test-id="points-total">{totalPts}</span>
              <span className="text-muted"> · 稳固 </span>
              <span className="text-good" data-test-id="points-effective">{effPts}</span>
            </button>
            <button
              className="btn-primary text-xs"
              onClick={() => setShowInbox(true)}
              data-test-id="open-growth-backpack"
              aria-label="打开成长背包"
            >
              成长背包
            </button>
          </div>
          <div className="hidden">
            <span data-test-id="conv-count">{msgs.length} 条</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 text-sm" ref={scrollRef}>
          {msgs.length === 0 && (
            <div className="text-muted text-xs">
              还没有对话。你的行动、旁白、伴学和成长瞬间都会出现在这里。
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
        <ResponseFrameRenderer
          frame={snapshot.active_response_frame}
          busy={busy}
          onSubmit={send}
        />
        <HelpBar busy={busy} onRequestHelp={requestHelp} />
      </div>
      <div className="flex-[2] overflow-y-auto p-4 space-y-3 bg-bg/20">
        <GrowthRail
          blueprint={blueprint}
          snapshot={snapshot}
          progress={progress}
          companionLibrary={companionLibrary}
          signatureMovesLibrary={signatureMovesLibrary}
          masteryHeatmap={masteryHeatmap}
          droppedArtifacts={droppedArtifacts}
          onOpenArtifacts={() => setShowInbox(true)}
          onOpenMoves={() => setShowMoves(true)}
          onOpenCompanions={() => setShowCompanions(true)}
          onOpenHeatmap={() => setShowHeatmap(true)}
          onOpenPoints={() => setShowPoints(true)}
        />
        <ManifestoPanel segments={manifestoSegments} />
        <ProgressPanel progress={progress} />
        <CurrentChallengeCard blueprint={blueprint} snapshot={snapshot} />
        <DeveloperDetails
          open={showDevDetails}
          onToggle={() => setShowDevDetails((v) => !v)}
          lastJudge={lastJudge}
          showJudge={showJudge}
          onToggleJudge={() => setShowJudge((v) => !v)}
          evidence={evidence}
        />
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

function HelpBar({
  busy,
  onRequestHelp,
}: {
  busy: boolean;
  onRequestHelp: (kind: HelpRequest["kind"]) => void;
}) {
  return (
    <div className="border-t border-border/80 px-4 py-3 bg-bg/45 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">卡住时可以用点数换帮助：</span>
      {(["hint", "example", "reveal"] as const).map((kind) => {
        const label = helpRequestLabel(kind);
        return (
          <button
            key={kind}
            className={kind === "reveal" ? "btn-primary text-xs" : "btn text-xs"}
            onClick={() => onRequestHelp(kind)}
            disabled={busy}
            data-test-id={`help-${kind}`}
          >
            {label.buttonText}
          </button>
        );
      })}
    </div>
  );
}

function helpRequestLabel(kind: HelpRequest["kind"]) {
  if (kind === "hint") {
    return { buttonText: "提示 -1", optimisticText: "我想花 1 点换一个提示。" };
  }
  if (kind === "example") {
    return { buttonText: "范例 -2", optimisticText: "我想花 2 点看一个范例。" };
  }
  return { buttonText: "揭晓并继续 -4", optimisticText: "我想花 4 点揭晓答案并继续。" };
}

function GrowthRail({
  blueprint,
  snapshot,
  progress,
  companionLibrary,
  signatureMovesLibrary,
  masteryHeatmap,
  droppedArtifacts,
  onOpenArtifacts,
  onOpenMoves,
  onOpenCompanions,
  onOpenHeatmap,
  onOpenPoints,
}: {
  blueprint: Blueprint;
  snapshot: Snapshot;
  progress: JourneyProgress | null;
  companionLibrary: CompanionLibrary;
  signatureMovesLibrary: SignatureMovesLibrary;
  masteryHeatmap: MasteryHeatmap;
  droppedArtifacts: DroppedArtifactGroup[];
  onOpenArtifacts: () => void;
  onOpenMoves: () => void;
  onOpenCompanions: () => void;
  onOpenHeatmap: () => void;
  onOpenPoints: () => void;
}) {
  const unlockedCompanions = companionLibrary.unlocked.length;
  const totalCompanions = companionLibrary.unlocked.length + companionLibrary.locked.length;
  const unlockedMoves = signatureMovesLibrary.earned.length;
  const totalMoves = signatureMovesLibrary.earned.length + signatureMovesLibrary.locked.length;
  const completed = progress?.completed_challenges ?? 0;
  const total = progress?.total_challenges ?? 0;
  const artifactVersions = droppedArtifacts.reduce((sum, group) => sum + group.versions.length, 0);

  return (
    <section className="stage-card" data-test-id="growth-dashboard">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label">成长看板</div>
          <h2 className="text-lg font-semibold mt-1">
            {blueprint.topic ?? "这段学习"}的旅程正在成形
          </h2>
          <p className="text-xs text-muted mt-1">
            每一次回答都会变成分数、证据、道具或新的能力线索。
          </p>
        </div>
        <button className="btn text-xs" onClick={onOpenPoints}>
          点数明细
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
        <button
          className="card-sub text-left hover:border-accent/60 transition-colors"
          onClick={onOpenArtifacts}
          data-test-id="open-artifact-inbox"
        >
          <div className="text-muted">道具库</div>
          <div className="text-xl font-semibold mt-1">{droppedArtifacts.length}</div>
          <div className="text-[11px] text-muted">{artifactVersions} 个版本沉淀</div>
        </button>
        <button
          className="card-sub text-left hover:border-accent/60 transition-colors"
          onClick={onOpenMoves}
          data-test-id="open-signature-moves"
        >
          <div className="text-muted">招式</div>
          <div className="text-xl font-semibold mt-1">
            {unlockedMoves}/{Math.max(totalMoves, 1)}
          </div>
          <div className="text-[11px] text-muted">可复用的行动套路</div>
        </button>
        <button
          className="card-sub text-left hover:border-accent/60 transition-colors"
          onClick={onOpenCompanions}
          data-test-id="open-companion-library"
        >
          <div className="text-muted">伴学</div>
          <div className="text-xl font-semibold mt-1">
            {unlockedCompanions}/{Math.max(totalCompanions, 1)}
          </div>
          <div className="text-[11px] text-muted">
            {companionLibrary.locked[0]
              ? `下一位差 ${companionLibrary.locked[0].points_needed} 分`
              : "全部已点亮"}
          </div>
        </button>
        <button
          className="card-sub text-left hover:border-accent/60 transition-colors"
          onClick={onOpenHeatmap}
          data-test-id="open-mastery-heatmap"
        >
          <div className="text-muted">能力地图</div>
          <div className="text-xl font-semibold mt-1">{masteryHeatmap.good_cells}</div>
          <div className="text-[11px] text-muted">
            / {masteryHeatmap.total_cells} 个强项格
          </div>
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-muted mb-1">
          <span>旅程推进</span>
          <span>
            {completed}/{total}
          </span>
        </div>
        <div className="h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <ArcStageIndicator blueprint={blueprint} snapshot={snapshot} />
    </section>
  );
}

function DeveloperDetails({
  open,
  onToggle,
  lastJudge,
  showJudge,
  onToggleJudge,
  evidence,
}: {
  open: boolean;
  onToggle: () => void;
  lastJudge: JudgeOutput | null;
  showJudge: boolean;
  onToggleJudge: () => void;
  evidence: EvidenceEntry[];
}) {
  return (
    <section className="card border-border/70" data-test-id="developer-details">
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={onToggle}
        data-test-id="developer-details-toggle"
      >
        <span>
          <span className="label">开发者详情</span>
          <span className="block text-xs text-muted mt-1">
            Judge 与 Evidence 仍完整保留，默认收起，不打断学员主体验。
          </span>
        </span>
        <span className="chip">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {lastJudge && (
            <div className="card-sub">
              <div className="flex items-center justify-between">
                <div className="label">Judge 最近一次输出</div>
                <button className="text-xs text-accent" onClick={onToggleJudge}>
                  {showJudge ? "收起 JSON" : "展开 JSON"}
                </button>
              </div>
              {showJudge && (
                <pre className="text-[10px] text-muted whitespace-pre-wrap mt-2 max-h-64 overflow-auto">
                  {JSON.stringify(lastJudge, null, 2)}
                </pre>
              )}
            </div>
          )}
          <div className="card-sub">
            <div className="label">Evidence（最近 10 条）</div>
            <ul className="text-xs mt-2 space-y-2">
              {evidence.slice(0, 10).map((e) => (
                <li key={e.id} className="rounded-lg border border-border/80 p-2">
                  <span className="text-muted">
                    {e.action_id} · turn {e.turn_idx}:
                  </span>{" "}
                  {Object.entries(e.grades).map(([k, v]) => (
                    <span key={k} className="chip ml-1">
                      {k}:{v}
                    </span>
                  ))}
                  <div className="text-muted mt-1">{e.evidence}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

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
    <div className="mt-4 rounded-2xl border border-border/70 bg-bg/30 p-3" data-test-id="arc-stage-indicator">
      <div className="flex items-center gap-2">
        <span className="label">故事阶段</span>
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
              {passed ? "已过 " : ""}
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
    <div className="stage-card" data-test-id="current-challenge-card">
      <div className="label">当前挑战</div>
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
        className="rounded-2xl px-4 py-3 bg-accent/20 border border-accent/30 ml-auto max-w-[80%] text-right shadow-sm"
        data-test-id="msg-learner"
      >
        <div className="label mb-0.5">我的行动 · {tsLabel}</div>
        <div className="whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (msg.role === "narrator") {
    const isOpening = msg.metaKind === "challenge_opening";
    const isScaffold = msg.metaKind === "scaffold";
    const className = isOpening
      ? "scene-card max-w-[88%]"
      : isScaffold
        ? "rounded-2xl px-4 py-3 bg-accent/10 border border-accent/30 max-w-[84%]"
        : "rounded-2xl px-4 py-3 bg-panel border border-border max-w-[82%]";
    return (
      <div
        className={className}
        data-test-id={
          isOpening ? "msg-narrator-opening" : isScaffold ? "msg-narrator-scaffold" : "msg-narrator"
        }
      >
        <div className="label mb-0.5 text-muted flex items-center gap-2">
          <span>{isOpening ? "开场" : isScaffold ? "提示卡" : "旁白"} · {tsLabel}</span>
          {isOpening && msg.arcStageName && (
            <span
              className="chip chip-confirmed text-[10px]"
              data-test-id={`arc-stage-chip-${msg.arcStageName}`}
            >
              {msg.arcStageName}
            </span>
          )}
          {isOpening && !msg.arcStageName && (
            <span className="chip text-[10px]">新一幕</span>
          )}
          {isScaffold && msg.scaffoldStrategy && (
            <span className="chip text-[10px]">{msg.scaffoldStrategy}</span>
          )}
        </div>
        <div className="whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (msg.role === "companion") {
    return (
      <div
        className="rounded-2xl px-4 py-3 bg-panel2 border border-warn/20 max-w-[82%]"
        data-test-id="msg-companion"
      >
        <div className="label mb-0.5 text-warn">{msg.who ?? "伴学"}来帮你 · {tsLabel}</div>
        <div className="whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  // system events: milestone / unlock / orientation / notice / error / network
  const who = msg.who ?? "";
  if (who === "points") {
    const points = Number(msg.meta?.points_earned ?? 0);
    const total = Number(msg.meta?.total_points ?? 0);
    return (
      <div className="moment-card moment-gold max-w-[86%] mx-auto score-pulse" data-test-id="msg-system-points">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs opacity-80">刚刚点亮</div>
            <div className="text-2xl font-semibold">+{points} 分</div>
          </div>
          <div className="text-right">
            <div className="text-xs opacity-80">累计</div>
            <div className="text-lg font-semibold">{total}</div>
          </div>
        </div>
        {typeof msg.meta?.primary_reason === "string" && (
          <div className="mt-2 text-xs text-warn/90">{msg.meta.primary_reason}</div>
        )}
      </div>
    );
  }
  if (who === "milestone") {
    return (
      <div className="moment-card moment-green max-w-[88%] mx-auto" data-test-id="msg-system-milestone">
        <div className="label text-good/80">挑战完成</div>
        <div className="font-semibold mt-1 whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (who === "unlock") {
    return (
      <div className="moment-card moment-purple max-w-[88%] mx-auto" data-test-id="msg-system-unlock">
        <div className="label">新能力解锁</div>
        <div className="font-semibold mt-1 whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (who === "manifesto") {
    return (
      <div className="moment-card moment-purple max-w-[88%] mx-auto" data-test-id="msg-system-manifesto">
        <div className="label">本章宣言</div>
        <div className="font-semibold mt-1 whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  let tone = "bg-panel2 border-border text-muted";
  if (who === "orientation") tone = "bg-accent/10 border-accent/40 text-accent";
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
