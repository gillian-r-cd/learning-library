import { describe, it, expect } from "vitest";
import { normalizeJudgeOutput } from "@/lib/judge";

describe("normalizeJudgeOutput — tolerate LLM shape drift", () => {
  it("fills quality when missing (repro for Cannot-read-'0' bug)", () => {
    const out = normalizeJudgeOutput({}, { dimIds: ["d1", "d2"] });
    expect(out.quality).toHaveLength(2);
    expect(out.quality[0]).toMatchObject({ dim_id: "d1", grade: "medium" });
    expect(out.quality[1]).toMatchObject({ dim_id: "d2", grade: "medium" });
    expect(out.path_decision.type).toBe("retry");
    expect(out.narrator_directive.length).toBeGreaterThan(0);
    expect(out.companion_dispatch).toEqual([]);
    expect(out.event_triggers).toEqual([]);
    expect(out.path_decision.scaffold_spec).toBeNull();
  });

  it("accepts `grades` alias for `quality`", () => {
    const out = normalizeJudgeOutput(
      {
        grades: [{ dim_id: "d1", grade: "good", evidence: "ok" }],
        path_decision: { type: "advance", target: null, scaffold_spec: null },
        narrator_directive: "keep going",
      },
      { dimIds: ["d1"] }
    );
    expect(out.quality).toHaveLength(1);
    expect(out.quality[0].grade).toBe("good");
  });

  it("coerces invalid path_decision.type to retry", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "good", evidence: "x" }],
        path_decision: { type: "teleport" },
        narrator_directive: "x",
      },
      { dimIds: ["d1"] }
    );
    expect(out.path_decision.type).toBe("retry");
  });

  it("fills scaffold_spec with default strategy when type=scaffold but spec is missing", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "poor", evidence: "x" }],
        path_decision: { type: "scaffold" }, // no scaffold_spec
        narrator_directive: "先补背景",
      },
      { dimIds: ["d1", "d2"] }
    );
    expect(out.path_decision.type).toBe("scaffold");
    // New default: retrieval_prompt (softest strategy) when neither form nor
    // strategy is supplied by the model. Legacy form field is optional.
    expect(out.path_decision.scaffold_spec?.strategy).toBe("retrieval_prompt");
    expect(out.path_decision.scaffold_spec?.focus_dim).toBe("d1");
  });

  it("maps legacy scaffold_spec.form to the modern strategy", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "poor", evidence: "x" }],
        path_decision: {
          type: "scaffold",
          scaffold_spec: { form: "step_breakdown", focus_dim: "d2" },
        },
      },
      { dimIds: ["d1", "d2"] }
    );
    expect(out.path_decision.scaffold_spec?.strategy).toBe("chunked_walkthrough");
    expect(out.path_decision.scaffold_spec?.focus_dim).toBe("d2");
  });

  it("accepts simplify_challenge as a valid path_decision.type + defaults strategy to worked_example", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "poor", evidence: "x" }],
        path_decision: { type: "simplify_challenge" },
      },
      { dimIds: ["d1"] }
    );
    expect(out.path_decision.type).toBe("simplify_challenge");
    expect(out.path_decision.scaffold_spec?.strategy).toBe("worked_example");
  });

  it("accepts explicit scaffold_spec.strategy and preserves it", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "poor", evidence: "x" }],
        path_decision: {
          type: "scaffold",
          scaffold_spec: {
            strategy: "contrastive_cases",
            focus_dim: "d1",
            notes: "区分'不会'与'不愿'",
          },
        },
      },
      { dimIds: ["d1"] }
    );
    expect(out.path_decision.scaffold_spec).toMatchObject({
      strategy: "contrastive_cases",
      focus_dim: "d1",
      notes: "区分'不会'与'不愿'",
    });
  });

  it("preserves a valid next_response_frame selection", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "poor", evidence: "x" }],
        path_decision: { type: "scaffold" },
        next_response_frame: {
          frame_id: "rf_readiness_diagnosis",
          reason: "学员混淆能力和意愿",
          overrides: {
            helper_text: "先拆开填写。",
          },
        },
      },
      { dimIds: ["d1"] }
    );
    expect(out.next_response_frame).toEqual({
      frame_id: "rf_readiness_diagnosis",
      reason: "学员混淆能力和意愿",
      overrides: {
        helper_text: "先拆开填写。",
      },
    });
  });

  it("drops malformed next_response_frame selections", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "poor", evidence: "x" }],
        next_response_frame: {
          frame_id: "",
          reason: 123,
        },
      },
      { dimIds: ["d1"] }
    );
    expect(out.next_response_frame).toBeNull();
  });

  it("normalises each quality entry with default dim_id fallbacks", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [
          { grade: "good" }, // no dim_id
          { dim_id: "d7", grade: "WEIRD" }, // bad grade
        ],
      },
      { dimIds: ["d1", "d2"] }
    );
    expect(out.quality[0].dim_id).toBe("d1"); // from ctx
    expect(out.quality[0].grade).toBe("good");
    expect(out.quality[1].grade).toBe("medium"); // fallback for invalid grade
  });

  it("handles companion_dispatch with partial fields", () => {
    const out = normalizeJudgeOutput(
      {
        quality: [{ dim_id: "d1", grade: "good", evidence: "x" }],
        path_decision: { type: "advance" },
        companion_dispatch: [
          { companion_id: "cp_a", directive: "go" }, // missing role, priority
          { role: "speaker" }, // missing id
        ],
      },
      { dimIds: ["d1"] }
    );
    expect(out.companion_dispatch).toHaveLength(2);
    expect(out.companion_dispatch[0].role).toBe("speaker");
    expect(out.companion_dispatch[0].priority).toBe(50);
    expect(out.companion_dispatch[1].companion_id).toMatch(/^cp/);
  });

  it("drops malformed event_triggers but keeps DROP_ARTIFACT with valid payload", () => {
    const out = normalizeJudgeOutput(
      {
        event_triggers: [
          { type: "AWARD_POINTS", payload: { grade: "good" } },
          { type: "DROP_ARTIFACT", payload: { artifact_id: "art_profile" } },
          { type: "DROP_ARTIFACT", payload: {} }, // dropped: missing artifact_id
          { type: "DROP_ARTIFACT" }, // dropped: no payload
          { type: "UNKNOWN_EVENT", payload: { x: 1 } }, // dropped
          null, // dropped
          { notype: true }, // dropped
        ],
      },
      { dimIds: ["d1"] }
    );
    expect(out.event_triggers).toHaveLength(2);
    expect(out.event_triggers[0]).toEqual({
      type: "AWARD_POINTS",
      payload: { grade: "good" },
    });
    expect(out.event_triggers[1]).toEqual({
      type: "DROP_ARTIFACT",
      payload: { artifact_id: "art_profile" },
    });
  });

  it("preserves valid fields end-to-end", () => {
    const raw = {
      quality: [{ dim_id: "d1", grade: "good", evidence: "clear" }],
      path_decision: {
        type: "complete_challenge",
        target: null,
        scaffold_spec: null,
      },
      narrator_directive: "收束本挑战",
      companion_dispatch: [
        { companion_id: "cp_guide", role: "speaker", directive: "d", priority: 42 },
      ],
      script_branch_switch: null,
      event_triggers: [{ type: "AWARD_POINTS", payload: { grade: "good" } }],
      next_response_frame: null,
    };
    const out = normalizeJudgeOutput(raw, { dimIds: ["d1"] });
    expect(out).toEqual(raw);
  });
});
