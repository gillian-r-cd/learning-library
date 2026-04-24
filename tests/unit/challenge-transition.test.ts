import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `trans-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("challenge transition semantics (advance vs complete_challenge)", () => {
  it("`advance` keeps the learner in the same challenge", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, applyJudgeOutput } = await import(
      "@/lib/state-manager"
    );

    const bp = createBlueprint("transition_advance", "d_tr1");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const startChallenge = learner.position.challenge_id;

    const r = applyJudgeOutput({
      learnerId: learner.learner_id,
      grades: { d1: "good", d2: "good", d3: "good" },
      actionId: "a1",
      evidence: "perfect answer",
      complexity: "low",
      decisionType: "advance", // <- should NOT jump challenge
    });
    expect(r.advancedToNewChallenge).toBeNull();
    expect(r.completedChallenge).toBeNull();
    expect(r.state.position.challenge_id).toBe(startChallenge);
    expect(r.state.position.turn_idx).toBe(1);
  });

  it("`complete_challenge` advances to the next challenge and reports the closed one", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, applyJudgeOutput } = await import(
      "@/lib/state-manager"
    );

    const bp = createBlueprint("transition_complete", "d_tr2");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const startChallenge = learner.position.challenge_id;

    const r = applyJudgeOutput({
      learnerId: learner.learner_id,
      grades: { d1: "good", d2: "good", d3: "good" },
      actionId: "a1",
      evidence: "meets expected signals",
      complexity: "low",
      decisionType: "complete_challenge",
    });
    expect(r.completedChallenge?.challenge_id).toBe(startChallenge);
    expect(r.advancedToNewChallenge).not.toBeNull();
    expect(r.advancedToNewChallenge?.challenge_id).not.toBe(startChallenge);
    expect(r.state.completed_challenges).toContain(startChallenge);
  });

  it("runTurn emits a transition ceremony: narrator close + milestone + new opening", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, listConversation, applyJudgeOutput } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const bp = createBlueprint("transition_ceremony", "d_tr3");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    // mockJudge uses learner_input length > 120 → grade=good, and
    // challenge_turn_idx >= 2 → complete_challenge. We need a >120-char input.
    const long =
      "这是一个足够长且结构完整的高质量回答，我先从具体观察入手——对方的语气、停顿、眼神、以及手边的具体物件，都是线索。接着我做分层推理：表层行为归因、底层动机推测、以及环境因素的影响。然后我给出一个可以反驳的判断并主动列出两个反例，确保自己的结论经得起检验。整段回答约 150 字，明显超过 120 字的 good 阈值，以稳定触发 complete_challenge。";
    await runTurn({ learnerId: learner.learner_id, input: long });
    await runTurn({ learnerId: learner.learner_id, input: long });
    const before = listConversation(learner.learner_id).length;
    // 3rd turn: mock judge should now return complete_challenge
    const r = await runTurn({ learnerId: learner.learner_id, input: long });
    expect(r.openingOfNewChallenge).not.toBeNull();

    const added = listConversation(learner.learner_id).slice(before);
    const kinds = added.map((m) => ({ role: m.role, who: m.who, kind: m.meta?.kind }));
    // Must include: learner input, narrator close, milestone system, new challenge opening
    expect(kinds.some((k) => k.role === "learner")).toBe(true);
    expect(
      kinds.some((k) => k.role === "system" && k.kind === "challenge_completed")
    ).toBe(true);
    expect(
      kinds.some((k) => k.role === "narrator" && k.kind === "challenge_opening")
    ).toBe(true);

    // Ordering: narrator close (no kind) must come BEFORE the challenge_completed
    // system message, which must come BEFORE the new challenge_opening narrator.
    const idxClose = added.findIndex(
      (m) => m.role === "narrator" && !m.meta?.kind
    );
    const idxMilestone = added.findIndex(
      (m) => m.role === "system" && m.meta?.kind === "challenge_completed"
    );
    const idxNew = added.findIndex(
      (m) => m.role === "narrator" && m.meta?.kind === "challenge_opening"
    );
    expect(idxClose).toBeGreaterThanOrEqual(0);
    expect(idxMilestone).toBeGreaterThan(idxClose);
    expect(idxNew).toBeGreaterThan(idxMilestone);

    // Silence the unused-import warning for applyJudgeOutput in this file.
    void applyJudgeOutput;
  }, 60_000);
});

describe("JourneyProgress projection", () => {
  it("marks completed, current, and upcoming chapters & challenges", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState } = await import("@/lib/state-manager");
    const { getBlueprint } = await import("@/lib/blueprint");
    const { computeJourneyProgress } = await import("@/lib/learning-runtime/progress");

    const bp = createBlueprint("progress_project", "d_prog");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);

    const learner = await createLearnerState(bp.blueprint_id);
    const bpFull = getBlueprint(bp.blueprint_id)!;
    const progress = computeJourneyProgress(learner, bpFull)!;
    expect(progress.total_challenges).toBeGreaterThan(0);
    expect(progress.completed_challenges).toBe(0);

    const currentChap = progress.chapters.find((c) => c.chapter_status === "current");
    expect(currentChap).toBeDefined();
    expect(currentChap!.challenges[0].status).toBe("current");
    // Non-current challenges start as upcoming
    const upcoming = progress.chapters.find((c) => c.chapter_status === "upcoming");
    if (upcoming) {
      expect(upcoming.challenges.every((c) => c.status === "upcoming")).toBe(true);
    }
  });
});
