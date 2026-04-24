import { describe, it, expect } from "vitest";
import {
  normalizeCompanions,
  normalizeCompanionHooks,
} from "@/lib/skills";

describe("normalizeCompanions — repairs LLM output gaps", () => {
  it("fills unlock_rule when missing (repro for difficulty_dial bug)", () => {
    const input = {
      companions: [
        {
          companion_id: "cp_difficulty_dial",
          companion_type: "difficulty_dial",
          display_name: "难度调节器",
          // unlock_rule missing — this is the real shape that crashed Step4
          // upgrade_path missing too
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = normalizeCompanions(input as any);
    expect(out.companions[0].unlock_rule).toEqual({
      type: "points_threshold",
      value: 30,
    });
    expect(out.companions[0].upgrade_path).toHaveLength(3);
    expect(out.companions[0].upgrade_path[0]).toMatchObject({ level: 1 });
  });

  it("coerces alternate unlock_rule shapes (threshold / points / number)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = (rule: unknown) => normalizeCompanions({ companions: [{ companion_id: "x", unlock_rule: rule } as any] }).companions[0].unlock_rule;
    expect(run({ threshold: 42 })).toEqual({ type: "points_threshold", value: 42 });
    expect(run({ points: 11 })).toEqual({ type: "points_threshold", value: 11 });
    expect(run(77)).toEqual({ type: "points_threshold", value: 77 });
    expect(run(null)).toEqual({ type: "points_threshold", value: 30 });
  });

  it("derives default output_format from companion_type", () => {
    const input = {
      companions: [
        { companion_id: "a", companion_type: "case_pack" },
        { companion_id: "b", companion_type: "difficulty_dial" },
        { companion_id: "c", companion_type: "replay_lens" },
        { companion_id: "d", companion_type: "hidden_plotline" },
        { companion_id: "e", companion_type: "context_variant" },
        { companion_id: "f", companion_type: "npc_traveler" },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = normalizeCompanions(input as any);
    expect(out.companions.map((c) => c.output_format)).toEqual([
      "reading_artifact",
      "param_override",
      "visualization",
      "plot_delta",
      "scenario_override",
      "dialog_text",
    ]);
  });

  it("stuffs persona defaults when missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = normalizeCompanions({ companions: [{ companion_id: "x" } as any] });
    const p = out.companions[0].persona;
    expect(p.personality_traits).toEqual([]);
    expect(p.speech_patterns.sentence_length).toBe("medium");
    expect(p.relationship_stages).toHaveLength(1);
    expect(p.interaction_rules.speak_when).toBeTruthy();
  });

  it("keeps valid fields untouched", () => {
    const input = {
      companions: [
        {
          companion_id: "cp_guide",
          companion_type: "npc_guide",
          display_name: "Elena",
          unlock_rule: { type: "points_threshold", value: 25 },
          upgrade_path: [
            { level: 1, delta: "a" },
            { level: 2, delta: "b" },
          ],
          companion_priority: 80,
          output_format: "dialog_text",
          io_spec: { max_tokens: 500 },
          unique_value_hypothesis: "h1",
          effectiveness_mechanism: "m1",
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = normalizeCompanions(input as any);
    const c = out.companions[0];
    expect(c.unlock_rule.value).toBe(25);
    expect(c.upgrade_path).toHaveLength(2);
    expect(c.companion_priority).toBe(80);
    expect(c.io_spec.max_tokens).toBe(500);
    expect(c.unique_value_hypothesis).toBe("h1");
  });
});

describe("normalizeCompanionHooks — defensive against malformed hooks", () => {
  it("returns empty array for non-array input", () => {
    expect(normalizeCompanionHooks(undefined, "ch1")).toEqual([]);
    expect(normalizeCompanionHooks(null, "ch1")).toEqual([]);
    expect(normalizeCompanionHooks("not an array", "ch1")).toEqual([]);
  });

  it("fills missing hook_id / condition / delta", () => {
    const out = normalizeCompanionHooks(
      [{ condition: {}, delta: {} }, {} as unknown],
      "ch7"
    );
    expect(out).toHaveLength(2);
    expect(out[0].hook_id).toBe("h_ch7_0");
    expect(out[0].condition.companion_type).toBe("npc_guide");
    expect(out[0].condition.min_level).toBe(1);
    expect(out[0].delta.scaffold_override).toBeNull();
    expect(out[1].hook_id).toBe("h_ch7_1");
  });

  it("preserves valid hook contents", () => {
    const out = normalizeCompanionHooks(
      [
        {
          hook_id: "h_custom",
          condition: { companion_type: "case_pack", min_level: 2 },
          delta: {
            pre_action_injection: "pre!",
            post_action_injection: "post!",
            scaffold_override: "s",
          },
        },
      ],
      "ch1"
    );
    expect(out[0]).toMatchObject({
      hook_id: "h_custom",
      condition: { companion_type: "case_pack", min_level: 2 },
      delta: { pre_action_injection: "pre!", scaffold_override: "s" },
    });
  });
});
