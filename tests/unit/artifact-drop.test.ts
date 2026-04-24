import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `artifact-drop-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

async function buildBlueprint(topic: string) {
  const { createBlueprint } = await import("@/lib/blueprint");
  const {
    runSkill1,
    runSkill2,
    runSkill3Fill,
    runSkill3Skeleton,
    runSkill4,
    runSkill5,
  } = await import("@/lib/skills");
  const bp = createBlueprint(topic, "d_art");
  await runSkill1(bp.blueprint_id);
  await runSkill2(bp.blueprint_id);
  const sk = await runSkill3Skeleton(bp.blueprint_id);
  await runSkill3Fill(bp.blueprint_id, sk.skeleton);
  await runSkill4(bp.blueprint_id);
  await runSkill5(bp.blueprint_id);
  return bp.blueprint_id;
}

describe("artifact drop — runtime integration", () => {
  it("createLearnerState drops on_challenge_enter artifacts after the 4-step opening", async () => {
    const bpId = await buildBlueprint("道具开场主题");
    const { createLearnerState, listConversation, listDroppedArtifacts } =
      await import("@/lib/state-manager");

    const learner = await createLearnerState(bpId);
    const conv = listConversation(learner.learner_id);
    // At least one artifact entry should be present (mock always adds one for ch0).
    const artifactEntries = conv.filter((c) => c.role === "artifact");
    expect(artifactEntries.length).toBeGreaterThanOrEqual(1);
    // Meta should carry the expected shape
    const first = artifactEntries[0];
    expect(first.meta?.kind).toBe("artifact_drop");
    expect(first.meta?.artifact_id).toBeTruthy();
    expect(first.meta?.version).toBe(1);

    const groups = listDroppedArtifacts(learner.learner_id);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].versions).toHaveLength(1);
  });

  it("dropping the same artifact twice is idempotent", async () => {
    const bpId = await buildBlueprint("道具幂等主题");
    const { createLearnerState, listConversation } = await import(
      "@/lib/state-manager"
    );
    const { dropChallengeEnterArtifacts } = await import(
      "@/lib/learning-runtime/artifact-drop"
    );

    const learner = await createLearnerState(bpId);
    const before = listConversation(learner.learner_id).filter((c) => c.role === "artifact").length;

    // Re-invoke drop for the same challenge — must not add any new entries.
    const { buildSnapshot } = await import("@/lib/state-manager");
    const snap = buildSnapshot(learner.learner_id);
    dropChallengeEnterArtifacts({
      learnerId: learner.learner_id,
      blueprintId: snap.learner.blueprint_id,
      chapterId: snap.learner.position.chapter_id,
      challengeId: snap.learner.position.challenge_id,
      turnIdx: 0,
    });
    const after = listConversation(learner.learner_id).filter((c) => c.role === "artifact").length;
    expect(after).toBe(before);
  });

  it("DROP_ARTIFACT event from Judge appends an artifact entry on runTurn", async () => {
    const bpId = await buildBlueprint("DROP_ARTIFACT 触发主题");
    const { createLearnerState, listConversation } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const learner = await createLearnerState(bpId);
    const beforeCount = listConversation(learner.learner_id).filter((c) => c.role === "artifact").length;

    // The mock Judge fires DROP_ARTIFACT when the learner asks "是谁" style
    // questions AND there is a matching pending artifact.
    // Mock blueprint's chi===0 challenge carries a pending artifact with
    // trigger_hint keyword "昨天" — ask about that.
    const result = await runTurn({
      learnerId: learner.learner_id,
      input: "我想看一下我和他昨天的对话记录，里面聊过什么？",
    });

    expect(result.droppedArtifacts.length).toBeGreaterThanOrEqual(1);

    const afterCount = listConversation(learner.learner_id).filter((c) => c.role === "artifact").length;
    expect(afterCount).toBe(beforeCount + result.droppedArtifacts.length);
  });

  it("listPendingArtifacts excludes artifacts that have already been dropped", async () => {
    const bpId = await buildBlueprint("pending artifacts 主题");
    const { createLearnerState } = await import("@/lib/state-manager");
    const { listPendingArtifacts } = await import(
      "@/lib/learning-runtime/artifact-drop"
    );

    const learner = await createLearnerState(bpId);
    const { buildSnapshot } = await import("@/lib/state-manager");
    const snap = buildSnapshot(learner.learner_id);

    const pending = listPendingArtifacts({
      learnerId: learner.learner_id,
      blueprintId: snap.learner.blueprint_id,
      chapterId: snap.learner.position.chapter_id,
      challengeId: snap.learner.position.challenge_id,
    });
    // One on_challenge_enter artifact was dropped → should NOT be in pending.
    // The on_learner_request one should still be pending.
    expect(pending.some((p) => p.trigger === "on_learner_request")).toBe(true);
    expect(pending.some((p) => p.trigger === "on_challenge_enter")).toBe(false);
  });
});
