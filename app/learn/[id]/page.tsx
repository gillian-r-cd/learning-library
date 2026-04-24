import { notFound } from "next/navigation";
import {
  getLearnerState,
  buildSnapshot,
  listEvidence,
  listConversation,
  ensureJourneyOrientation,
  listDroppedArtifacts,
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
import LearnerSession from "./LearnerSession";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = getLearnerState(id);
  if (!learner) notFound();
  const bp = getBlueprint(learner.blueprint_id);
  if (!bp) notFound();

  await ensureJourneyOrientation(id);

  const snapshot = buildSnapshot(id);
  const evidence = listEvidence(id, 20);
  const conversation = listConversation(id, { limit: 1000 });
  const progress = computeJourneyProgress(learner, bp);
  const droppedArtifacts = listDroppedArtifacts(id);
  const pointsBreakdown = buildPointsBreakdown(id, bp);
  const companionLibrary = buildCompanionLibrary(
    id,
    bp,
    learner,
    snapshot.effective_total
  );
  const signatureMovesLibrary = buildSignatureMovesLibrary(bp, learner);
  const masteryHeatmap = buildMasteryHeatmap(id, bp);
  const manifestoSegments = listManifestoSegments(id);

  return (
    <LearnerSession
      learner={learner}
      blueprint={bp}
      snapshot={snapshot}
      evidence={evidence}
      conversation={conversation}
      progress={progress}
      droppedArtifacts={droppedArtifacts}
      pointsBreakdown={pointsBreakdown}
      companionLibrary={companionLibrary}
      signatureMovesLibrary={signatureMovesLibrary}
      masteryHeatmap={masteryHeatmap}
      manifestoSegments={manifestoSegments}
    />
  );
}
