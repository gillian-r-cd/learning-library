import { NextRequest, NextResponse } from "next/server";
import {
  getLearnerState,
  listEvidence,
  buildSnapshot,
  listConversation,
  ensureJourneyOrientation,
  listDroppedArtifacts,
  deleteLearner,
} from "@/lib/state-manager";
import { getBlueprint } from "@/lib/blueprint";
import { computeJourneyProgress } from "@/lib/learning-runtime/progress";
import {
  buildPointsBreakdown,
  buildCompanionLibrary,
  buildSignatureMovesLibrary,
  buildMasteryHeatmap,
} from "@/lib/learning-runtime/learner-view";
import { listManifestoSegments } from "@/lib/learning-runtime/manifesto";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const s = getLearnerState(id);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bp = getBlueprint(s.blueprint_id);
  // For learners who predate the immersive opening, catch them up.
  await ensureJourneyOrientation(id);
  const snapshot = buildSnapshot(id);
  const evidence = listEvidence(id, 20);
  const progress = bp ? computeJourneyProgress(s, bp) : null;

  const url = new URL(req.url);
  const sinceIdRaw = url.searchParams.get("conversation_since_id");
  const sinceId = sinceIdRaw ? Number(sinceIdRaw) : 0;
  const conversation = listConversation(id, { sinceId });

  const droppedArtifacts = listDroppedArtifacts(id);

  // Full breakdown of every points award event (learner-visible audit trail).
  const pointsBreakdown = bp ? buildPointsBreakdown(id, bp) : { entries: [], totals: { raw: 0, effective: snapshot.effective_total, by_action: {} } };

  // Companion library: unlocked + locked (with progress-to-unlock + recent speeches).
  const companionLibrary = bp ? buildCompanionLibrary(id, bp, s, snapshot.effective_total) : { unlocked: [], locked: [] };

  // Signature moves library — earned + locked, drives the "招式集" drawer.
  const signatureMovesLibrary = bp
    ? buildSignatureMovesLibrary(bp, s)
    : { earned: [], locked: [], total_earned_count: 0, total_moves: 0 };

  // Mastery heatmap — objective ability grid (actions × complexities).
  const masteryHeatmap = bp
    ? buildMasteryHeatmap(id, bp)
    : { actions: [], complexities: [], cells: {}, good_cells: 0, total_cells: 0 };

  // Manifesto segments — one per completed chapter, newest first.
  const manifestoSegments = listManifestoSegments(id);

  return NextResponse.json({
    learner: s,
    blueprint: bp,
    snapshot,
    evidence,
    conversation,
    progress,
    dropped_artifacts: droppedArtifacts,
    points_breakdown: pointsBreakdown,
    companion_library: companionLibrary,
    signature_moves_library: signatureMovesLibrary,
    mastery_heatmap: masteryHeatmap,
    manifesto_segments: manifestoSegments,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getLearnerState(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const counts = deleteLearner(id);
  return NextResponse.json({ ok: true, deleted: counts });
}
