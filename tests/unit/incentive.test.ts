import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `incentive-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

async function seedBlueprint(topic: string) {
  const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
  const {
    runSkill1,
    runSkill2,
    runSkill3Fill,
    runSkill3Skeleton,
    runSkill4,
    runSkill5,
  } = await import("@/lib/skills");
  const bp = createBlueprint(topic, "d_inc");
  await runSkill1(bp.blueprint_id);
  await runSkill2(bp.blueprint_id);
  const sk = await runSkill3Skeleton(bp.blueprint_id);
  await runSkill3Fill(bp.blueprint_id, sk.skeleton);
  await runSkill4(bp.blueprint_id);
  await runSkill5(bp.blueprint_id);
  return getBlueprint(bp.blueprint_id)!;
}

describe("Arc stages — upstream generation wiring", () => {
  it("Skill 3 skeleton produces journey_meta.arc_stages and each chapter binds to an arc_stage_id", async () => {
    const bp = await seedBlueprint("arc stages 主题");
    const stages = bp.step3_script?.journey_meta?.arc_stages ?? [];
    expect(stages.length).toBeGreaterThan(0);
    for (const chap of bp.step3_script?.chapters ?? []) {
      expect(chap.arc_stage_id).toBeTruthy();
      expect(stages.some((s) => s.id === chap.arc_stage_id)).toBe(true);
    }
  });
});

describe("Signature moves — registered at Skill 1 and earned via AWARD_SIGNATURE_MOVE", () => {
  it("Skill 1 output puts signature_moves on each core_action", async () => {
    const bp = await seedBlueprint("signature moves 注册");
    for (const a of bp.step1_gamecore?.core_actions ?? []) {
      expect(a.signature_moves?.length).toBeGreaterThan(0);
      for (const m of a.signature_moves ?? []) {
        expect(m.move_id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.definition).toBeTruthy();
        expect(m.recognition_hint).toBeTruthy();
        expect(m.bound_actions).toContain(a.action_id);
      }
    }
  });

  it("runTurn awards a signature move when learner input matches recognition_hint + writes system bubble + persists to learner_state", async () => {
    const bp = await seedBlueprint("awards signature move");
    const { createLearnerState, listConversation, getLearnerState } = await import(
      "@/lib/state-manager"
    );
    const { runTurn } = await import("@/lib/learning-runtime");

    const learner = await createLearnerState(bp.blueprint_id);
    // The mock Judge fires AWARD_SIGNATURE_MOVE when learner input semantically
    // overlaps with a recognition_hint (token-overlap ≥ 40% on short hint
    // tokens). "同一下属" + "R1" + "能力" + "任务差异" overlaps with the
    // first-action signature_moves defined by the mock gamecore.
    const input =
      "我在同一下属身上看到两种情况：做方案时他高能力高意愿，但做CRM录入他明显低意愿。" +
      "这两件事我会用不同的准备度档位看，不一刀切。";
    await runTurn({ learnerId: learner.learner_id, input });

    const conv = listConversation(learner.learner_id);
    const moveBubble = conv.find(
      (c) =>
        c.role === "system" && c.who === "signature_move" && c.meta?.kind === "signature_move"
    );
    expect(moveBubble).toBeTruthy();
    expect(moveBubble!.text).toContain("获得招式");

    const s = getLearnerState(learner.learner_id);
    expect(s!.earned_signature_moves?.length).toBeGreaterThanOrEqual(1);
    const earned = s!.earned_signature_moves![0];
    expect(earned.count).toBeGreaterThanOrEqual(1);
    expect(earned.triggering_quote).toContain(input.slice(0, 20));
  });

  it("awarding the same move a second time increments count + announces tier crossing only at thresholds", async () => {
    const { awardSignatureMove } = await import(
      "@/lib/learning-runtime/signature-moves"
    );
    const bp = await seedBlueprint("tier crossing");
    const { createLearnerState, getLearnerState, listConversation } = await import(
      "@/lib/state-manager"
    );
    const learner = await createLearnerState(bp.blueprint_id);
    const moveId = bp.step1_gamecore!.core_actions[0].signature_moves![0].move_id;

    // Award 1st, 2nd, 3rd → thresholds [1,3,5]: tier crossings at 1 and 3.
    for (let i = 0; i < 3; i++) {
      const state = getLearnerState(learner.learner_id)!;
      awardSignatureMove({
        learner: state,
        bp,
        moveId,
        triggeringQuote: `turn ${i} quote`,
        challengeId: bp.step3_script!.chapters[0].challenges[0].challenge_id,
        turnIdx: i,
        chapterId: bp.step3_script!.chapters[0].chapter_id,
      });
    }
    const s = getLearnerState(learner.learner_id)!;
    const earned = s.earned_signature_moves!.find((e) => e.move_id === moveId)!;
    expect(earned.count).toBe(3);

    // Two system bubbles should have fired: first-earn (Lv.1) + tier-cross to Lv.2.
    const conv = listConversation(learner.learner_id);
    const announces = conv.filter(
      (c) => c.role === "system" && c.who === "signature_move"
    );
    expect(announces.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Mastery heatmap — objective ability grid", () => {
  it("aggregates evidence into action × complexity cells, tracking best grade + recent trend + turn count", async () => {
    const bp = await seedBlueprint("heatmap main");
    const { createLearnerState, writeEvidence } = await import(
      "@/lib/state-manager"
    );
    const { buildMasteryHeatmap } = await import(
      "@/lib/learning-runtime/learner-view"
    );
    const learner = await createLearnerState(bp.blueprint_id);

    const firstChallenge = bp.step3_script!.chapters[0].challenges[0];
    // Challenge has complexity="low" per Skill 3 mock.
    // Write three evidence rows: poor, medium, good (newest last).
    for (const [i, g] of (["poor", "medium", "good"] as const).entries()) {
      writeEvidence({
        learner_id: learner.learner_id,
        ts: new Date(Date.now() + i * 10).toISOString(),
        challenge_id: firstChallenge.challenge_id,
        action_id: firstChallenge.binds_actions[0],
        turn_idx: i,
        grades: { d1: g, d2: g },
        evidence: `turn ${i} ${g}`,
      });
    }

    const heatmap = buildMasteryHeatmap(learner.learner_id, bp);
    const cellKey = `${firstChallenge.binds_actions[0]}|${firstChallenge.complexity}`;
    const cell = heatmap.cells[cellKey];
    expect(cell).toBeDefined();
    expect(cell.turn_count).toBe(3);
    expect(cell.best_grade).toBe("good");
    expect(cell.recent_grades[0]).toBe("good"); // newest first
    expect(cell.best_quote).toContain("turn 2");
    expect(heatmap.good_cells).toBe(1);
    expect(heatmap.total_cells).toBe(
      heatmap.actions.length * heatmap.complexities.length
    );
  });
});

describe("Manifesto pipeline — chapter close weaves learner quotes", () => {
  it("generateChapterManifesto returns a first-person segment that embeds the learner's quotable utterances", async () => {
    const bp = await seedBlueprint("manifesto pipeline");
    const { createLearnerState, appendConversation, writeEvidence } = await import(
      "@/lib/state-manager"
    );
    const { generateChapterManifesto, listManifestoSegments } = await import(
      "@/lib/learning-runtime/manifesto"
    );

    const learner = await createLearnerState(bp.blueprint_id);
    const firstChapter = bp.step3_script!.chapters[0];
    const firstChallenge = firstChapter.challenges[0];

    // Seed a learner turn + matching evidence row flagged quotable.
    appendConversation({
      learner_id: learner.learner_id,
      turn_idx: 0,
      chapter_id: firstChapter.chapter_id,
      challenge_id: firstChallenge.challenge_id,
      role: "learner",
      text:
        "我判断他是 R1 高意愿低能力——他捻笔记本那个小动作把我拉回证据层了。",
    });
    writeEvidence({
      learner_id: learner.learner_id,
      ts: new Date().toISOString(),
      challenge_id: firstChallenge.challenge_id,
      action_id: firstChallenge.binds_actions[0],
      turn_idx: 0,
      grades: { d1: "good", d2: "good" },
      evidence: "student demonstrated good signal reading",
      quotable: true,
    });

    const seg = await generateChapterManifesto({
      learnerId: learner.learner_id,
      blueprintId: bp.blueprint_id,
      chapterId: firstChapter.chapter_id,
    });
    expect(seg).toBeTruthy();
    expect(seg!.chapter_id).toBe(firstChapter.chapter_id);
    expect(seg!.text.length).toBeGreaterThan(30);
    expect(seg!.source_learner_quotes.length).toBeGreaterThanOrEqual(1);

    // listManifestoSegments must surface it.
    const segments = listManifestoSegments(learner.learner_id);
    expect(segments).toHaveLength(1);
    expect(segments[0].chapter_id).toBe(firstChapter.chapter_id);
  });

  it("returns null when no quotable AND no learner turns exist (empty chapter)", async () => {
    const bp = await seedBlueprint("empty chapter manifesto");
    const { createLearnerState } = await import("@/lib/state-manager");
    const { generateChapterManifesto } = await import(
      "@/lib/learning-runtime/manifesto"
    );
    const learner = await createLearnerState(bp.blueprint_id);
    const firstChapter = bp.step3_script!.chapters[0];
    // No learner turns seeded for this chapter → fallback finds nothing.
    const seg = await generateChapterManifesto({
      learnerId: learner.learner_id,
      blueprintId: bp.blueprint_id,
      chapterId: firstChapter.chapter_id,
    });
    expect(seg).toBeNull();
  });
});
