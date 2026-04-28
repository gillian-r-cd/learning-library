import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `scaffold-ladder-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";
if (!fs.existsSync(path.dirname(TEST_DB))) {
  fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
}

import {
  normalizeChallengeResponseFrames,
  normalizeScaffoldLadder,
  resolveLadderAwareFrame,
  shouldEscalateLadder,
} from "@/lib/learning-runtime/response-frames";
import type {
  Challenge,
  LadderProgress,
  ScaffoldLadderRung,
  ResponseFrame,
  ActionMasteryRecord,
} from "@/lib/types/core";

function mkFrame(frame_id: string, kind: ResponseFrame["kind"]): ResponseFrame {
  return {
    frame_id,
    version: 1,
    kind,
    title: `frame ${frame_id}`,
    prompt: "p",
    binds_actions: ["a1"],
    fields: [
      kind === "narrative_choice"
        ? {
            field_id: "choice",
            type: "radio",
            label: "你的判断",
            required: true,
            options: [
              {
                value: "ability",
                label: "她在能力上到位",
                narrative_payoff: "你顺着她的清单往下读，每一条都干净利落。她没有铺陈，但写得克制。",
                cognitive_signal: { action_id: "a1", tag: "偏向能力解读" },
              },
              {
                value: "willingness",
                label: "她在意愿上还在观望",
                narrative_payoff: "你停在她合上笔记本的动作。这种安静像是在等你先表态。",
                cognitive_signal: { action_id: "a1", tag: "偏向意愿解读" },
              },
            ],
          }
        : kind === "form"
        ? {
            field_id: "evidence",
            type: "textarea",
            label: "证据",
            required: true,
          }
        : {
            field_id: "text",
            type: "textarea",
            label: "回复",
            required: true,
          },
    ],
  };
}

function mkChallengeWithLadder(): Challenge {
  return {
    challenge_id: "c1_ch1",
    title: "test challenge",
    binds_actions: ["a1"],
    complexity: "low",
    trunk: { setup: "x".repeat(40), action_prompts: ["p1"], expected_signals: ["s1"] },
    companion_hooks: [],
    response_frames: [
      mkFrame("rf_narrative", "narrative_choice"),
      mkFrame("rf_form", "form"),
      mkFrame("rf_free", "free_text"),
    ],
    default_response_frame_id: "rf_narrative",
    default_ladder_position: 0,
    scaffold_ladder: [
      {
        position: 0,
        kind: "narrative_choice",
        frame_id: "rf_narrative",
        narrative_purpose: "first contact",
        gate_to_next: { type: "after_n_advances", n: 1 },
      },
      {
        position: 1,
        kind: "form",
        frame_id: "rf_form",
        narrative_purpose: "structured practice",
        gate_to_next: { type: "after_action_mastery_at_least", threshold: 1 },
      },
      {
        position: 2,
        kind: "free_text",
        frame_id: "rf_free",
        narrative_purpose: "independent practice",
        gate_to_next: null,
      },
    ],
  };
}

describe("scaffold ladder normalisation", () => {
  it("preserves a valid 3-rung ladder and clamps default_ladder_position", () => {
    const ch = mkChallengeWithLadder();
    const norm = normalizeChallengeResponseFrames(ch);
    expect(norm.scaffold_ladder).toBeDefined();
    expect(norm.scaffold_ladder!.length).toBe(3);
    expect(norm.scaffold_ladder!.map((r) => r.kind)).toEqual([
      "narrative_choice",
      "form",
      "free_text",
    ]);
    expect(norm.scaffold_ladder![2].gate_to_next).toBeNull(); // last rung must terminate
    expect(norm.default_ladder_position).toBe(0);
  });

  it("drops rungs whose frame_id is missing", () => {
    const ladder: ScaffoldLadderRung[] = [
      {
        position: 0,
        kind: "narrative_choice",
        frame_id: "rf_does_not_exist",
        narrative_purpose: "x",
        gate_to_next: { type: "after_n_advances", n: 1 },
      },
      {
        position: 1,
        kind: "form",
        frame_id: "rf_form",
        narrative_purpose: "y",
        gate_to_next: null,
      },
    ];
    const frames: ResponseFrame[] = [mkFrame("rf_form", "form")];
    const result = normalizeScaffoldLadder(ladder, 0, frames);
    expect(result.ladder?.length).toBe(1);
    expect(result.ladder?.[0].frame_id).toBe("rf_form");
  });

  it("accepts single_choice rung kind and carries rung_question / required_concepts", () => {
    const ladder: ScaffoldLadderRung[] = [
      {
        position: 0,
        kind: "single_choice",
        frame_id: "rf_archetype",
        narrative_purpose: "classify into 4 archetypes",
        gate_to_next: { type: "after_action_mastery_at_least", threshold: 1 },
        rung_question: "请在下面四种状态里选一个最贴近你判断的。",
        rung_expected_output: "学员能把能力/意愿组合对应到一档",
        required_concepts: ["readiness_levels"],
      },
      {
        position: 1,
        kind: "free_text",
        frame_id: "rf_free",
        narrative_purpose: "synthesise",
        gate_to_next: null,
      },
    ];
    const frames: ResponseFrame[] = [
      {
        frame_id: "rf_archetype",
        version: 1,
        kind: "single_choice",
        title: "归类",
        prompt: "选一个",
        binds_actions: ["a1"],
        fields: [
          {
            field_id: "archetype",
            type: "radio",
            label: "组合",
            required: true,
            options: [
              { value: "R1", label: "能力低、意愿低" },
              { value: "R2", label: "能力低、意愿高" },
            ],
          },
        ],
      },
      {
        frame_id: "rf_free",
        version: 1,
        kind: "free_text",
        title: "free",
        prompt: "x",
        binds_actions: ["a1"],
        fields: [{ field_id: "text", type: "textarea", label: "x", required: true }],
      },
    ];
    const result = normalizeScaffoldLadder(ladder, 0, frames);
    expect(result.ladder?.length).toBe(2);
    expect(result.ladder?.[0].kind).toBe("single_choice");
    expect(result.ladder?.[0].rung_question).toBe(
      "请在下面四种状态里选一个最贴近你判断的。"
    );
    expect(result.ladder?.[0].required_concepts).toEqual(["readiness_levels"]);
    expect(result.ladder?.[0].rung_expected_output).toBe(
      "学员能把能力/意愿组合对应到一档"
    );
  });

  it("returns null when no rung is valid", () => {
    const ladder: ScaffoldLadderRung[] = [
      {
        position: 0,
        kind: "narrative_choice",
        frame_id: "rf_missing",
        narrative_purpose: "x",
        gate_to_next: null,
      },
    ];
    const frames: ResponseFrame[] = [mkFrame("rf_unrelated", "free_text")];
    const result = normalizeScaffoldLadder(ladder, 0, frames);
    expect(result.ladder).toBeNull();
    expect(result.defaultPosition).toBeNull();
  });
});

describe("resolveLadderAwareFrame", () => {
  it("returns the rung's frame when ladder progress is set", () => {
    const ch = mkChallengeWithLadder();
    const norm = normalizeChallengeResponseFrames(ch);
    const progress: LadderProgress = {
      challenge_id: "c1_ch1",
      position: 1,
      advances_at_position: 0,
      action_id: "a1",
      updated_at: new Date().toISOString(),
    };
    const r = resolveLadderAwareFrame({
      challenge: norm,
      ladderProgress: progress,
      selection: null,
    });
    expect(r.frame.frame_id).toBe("rf_form");
    expect(r.rung?.position).toBe(1);
  });

  it("falls back to default_response_frame_id when no ladder progress", () => {
    const ch = mkChallengeWithLadder();
    const norm = normalizeChallengeResponseFrames(ch);
    const r = resolveLadderAwareFrame({
      challenge: norm,
      ladderProgress: null,
      selection: null,
    });
    expect(r.frame.frame_id).toBe("rf_narrative");
    expect(r.rung).toBeNull();
  });

  it("explicit selection wins over ladder progress", () => {
    const ch = mkChallengeWithLadder();
    const norm = normalizeChallengeResponseFrames(ch);
    const progress: LadderProgress = {
      challenge_id: "c1_ch1",
      position: 0,
      advances_at_position: 0,
      action_id: "a1",
      updated_at: new Date().toISOString(),
    };
    const r = resolveLadderAwareFrame({
      challenge: norm,
      ladderProgress: progress,
      selection: { frame_id: "rf_form", reason: "judge override" },
    });
    expect(r.frame.frame_id).toBe("rf_form");
  });
});

describe("shouldEscalateLadder", () => {
  it("after_n_advances: counts narrative_advance turns", () => {
    const rung: ScaffoldLadderRung = {
      position: 0,
      kind: "narrative_choice",
      frame_id: "rf_n",
      narrative_purpose: "x",
      gate_to_next: { type: "after_n_advances", n: 2 },
    };
    const progressBelow: LadderProgress = {
      challenge_id: "c",
      position: 0,
      advances_at_position: 1,
      action_id: "a1",
      updated_at: "",
    };
    const progressMet: LadderProgress = { ...progressBelow, advances_at_position: 2 };
    expect(shouldEscalateLadder(rung, progressBelow)).toBe(false);
    expect(shouldEscalateLadder(rung, progressMet)).toBe(true);
  });

  it("after_action_mastery_at_least: needs cumulative good_count", () => {
    const rung: ScaffoldLadderRung = {
      position: 1,
      kind: "form",
      frame_id: "rf_f",
      narrative_purpose: "x",
      gate_to_next: { type: "after_action_mastery_at_least", threshold: 2 },
    };
    const progress: LadderProgress = {
      challenge_id: "c",
      position: 1,
      advances_at_position: 0,
      action_id: "a1",
      updated_at: "",
    };
    const masteryBelow: ActionMasteryRecord = {
      attempts: 1,
      good_count: 1,
      medium_count: 0,
      poor_count: 0,
      consecutive_good: 1,
      last_seen_at: "",
      last_challenge_id: "c",
    };
    const masteryMet: ActionMasteryRecord = { ...masteryBelow, good_count: 2 };
    expect(shouldEscalateLadder(rung, progress, masteryBelow)).toBe(false);
    expect(shouldEscalateLadder(rung, progress, masteryMet)).toBe(true);
    // Without mastery → cannot escalate.
    expect(shouldEscalateLadder(rung, progress)).toBe(false);
  });

  it("null gate (terminal rung) never escalates", () => {
    const rung: ScaffoldLadderRung = {
      position: 2,
      kind: "free_text",
      frame_id: "rf_free",
      narrative_purpose: "x",
      gate_to_next: null,
    };
    const progress: LadderProgress = {
      challenge_id: "c",
      position: 2,
      advances_at_position: 99,
      action_id: "a1",
      updated_at: "",
    };
    expect(shouldEscalateLadder(rung, progress)).toBe(false);
  });
});
