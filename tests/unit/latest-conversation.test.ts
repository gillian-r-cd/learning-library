import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join(process.cwd(), "data", `latest-conv-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

/**
 * Regression for the "cross-challenge context bleed" bug:
 *
 * runTurn previously did `listConversation({limit:12}).slice(-6)` to compute
 * Narrator's recent_turns. `listConversation` returns the OLDEST N rows with
 * `ORDER BY id ASC LIMIT N`, so once a transcript grew past 12 entries, the
 * slice silently returned rows 7..12 of the OLDEST 12, leaving Narrator
 * responding to a learner input ten messages in the past — often from a
 * completed challenge, with the wrong subject.
 */
describe("latestConversationEntries — tail-correct by construction", () => {
  it("returns the last N entries in chronological order (bug repro)", async () => {
    const {
      appendConversation,
      latestConversationEntries,
      listConversation,
    } = await import("@/lib/state-manager");
    const learnerId = `u_tail_${Date.now()}`;
    for (let i = 1; i <= 20; i++) {
      appendConversation({
        learner_id: learnerId,
        turn_idx: i,
        chapter_id: "c1",
        challenge_id: "c1_ch1",
        role: "learner",
        text: `msg-${i}`,
      });
    }

    // The new helper returns the true tail (15..20).
    const tail = latestConversationEntries(learnerId, 6);
    expect(tail).toHaveLength(6);
    expect(tail.map((t) => t.text)).toEqual([
      "msg-15",
      "msg-16",
      "msg-17",
      "msg-18",
      "msg-19",
      "msg-20",
    ]);

    // Prove the old usage pattern would have been wrong here:
    // listConversation(limit=12).slice(-6) returns 7..12, NOT 15..20.
    const buggy = listConversation(learnerId, { limit: 12 }).slice(-6);
    expect(buggy.map((t) => t.text)).toEqual([
      "msg-7",
      "msg-8",
      "msg-9",
      "msg-10",
      "msg-11",
      "msg-12",
    ]);
  });

  it("short transcripts work (fewer entries than count)", async () => {
    const { appendConversation, latestConversationEntries } = await import(
      "@/lib/state-manager"
    );
    const learnerId = `u_short_${Date.now()}`;
    appendConversation({
      learner_id: learnerId,
      turn_idx: 0,
      chapter_id: "c1",
      challenge_id: "c1_ch1",
      role: "learner",
      text: "only one",
    });
    const tail = latestConversationEntries(learnerId, 10);
    expect(tail).toHaveLength(1);
    expect(tail[0].text).toBe("only one");
  });

  it("beforeId paging walks backwards", async () => {
    const { appendConversation, latestConversationEntries } = await import(
      "@/lib/state-manager"
    );
    const learnerId = `u_page_${Date.now()}`;
    const ids: number[] = [];
    for (let i = 1; i <= 10; i++) {
      const e = appendConversation({
        learner_id: learnerId,
        turn_idx: i,
        chapter_id: "c1",
        challenge_id: "c1_ch1",
        role: "learner",
        text: `m${i}`,
      });
      ids.push(e.id);
    }
    const page1 = latestConversationEntries(learnerId, 3); // m8..m10
    expect(page1.map((e) => e.text)).toEqual(["m8", "m9", "m10"]);
    const page2 = latestConversationEntries(learnerId, 3, {
      beforeId: page1[0].id,
    });
    expect(page2.map((e) => e.text)).toEqual(["m5", "m6", "m7"]);
  });
});

describe("Narrator contract — learnerInput always equals the current turn", () => {
  it("runNarrator's prompt variables receive args.learnerInput verbatim", async () => {
    // We exercise runNarrator directly (not through runTurn), so the learner
    // input we pass in MUST show up in the mock output. The mock uses
    // pickLearnerEcho on learner_input to build a response.
    const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Fill,
      runSkill3Skeleton,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const { createLearnerState, buildSnapshot } = await import(
      "@/lib/state-manager"
    );

    const bp = createBlueprint("learner_input 直通主题", "d_direct");
    await runSkill1(bp.blueprint_id);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    await runSkill5(bp.blueprint_id);
    expect(getBlueprint(bp.blueprint_id)).not.toBeNull();

    const learner = await createLearnerState(bp.blueprint_id);
    const snapshot = buildSnapshot(learner.learner_id);

    const { runNarrator } = await import("@/lib/narrator");
    const { text: out } = await runNarrator({
      snapshot,
      judgeOutput: {
        quality: [{ dim_id: "d1", grade: "good", evidence: "e" }],
        path_decision: { type: "advance", target: null, scaffold_spec: null },
        narrator_directive: "按 directive 收尾",
        companion_dispatch: [],
        script_branch_switch: null,
        event_triggers: [],
      },
      learnerInput: "UNIQUE_CURRENT_TURN_INPUT_ABC",
      // Intentionally give a STALE recent_turns tail to try to trick the narrator.
      recentTurns: [
        { role: "learner", text: "STALE_OLD_INPUT_XYZ" },
        { role: "narrator", text: "stale narrator reply" },
      ],
      traceId: "trc_test",
    });

    // Mock narrator echoes a semantic fragment of learner_input (truncated).
    // It must echo the CURRENT input's distinctive prefix, not the stale tail.
    expect(out).toContain("UNIQUE_CURRE");
    expect(out).not.toContain("STALE_OLD");
  });
});
