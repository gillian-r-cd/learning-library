import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `skill3-validate-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  }
});

// Drive llmCall via a vi.mock so we can return a deliberately broken fill
// response (Claude dropped the tail on truncation). This is the exact failure
// mode that caused the bp_3a8c1c9b c2_ch4/c3_ch3/c3_ch4/c4_ch3 duplicates.
vi.mock("@/lib/llm", async () => {
  return {
    llmCall: vi.fn(async (args: { variables: Record<string, unknown> }) => {
      const sk = args.variables.skeleton as {
        chapter: {
          chapter_id: string;
          title: string;
          challenges: { challenge_id: string; title: string; binds_actions: string[]; complexity: string }[];
        };
      };
      const chap = sk.chapter;
      // Simulate truncation: return ONLY the first challenge for every chapter.
      const firstOnly = chap.challenges.slice(0, 1).map((ch) => ({
        challenge_id: ch.challenge_id,
        title: ch.title,
        binds_actions: ch.binds_actions,
        complexity: ch.complexity,
        trunk: {
          setup: "场景：你被指派去和一位下属沟通一项紧急任务。你会先观察什么？更长一些的 setup 以通过 30 字的最小长度检查。",
          action_prompts: ["描述你读到的信号。"],
          expected_signals: ["能给出判断依据"],
        },
        companion_hooks: [],
        response_frames: (ch as { response_frames?: unknown }).response_frames,
        default_response_frame_id: (ch as { default_response_frame_id?: string }).default_response_frame_id,
      }));
      return {
        callId: "call_mock",
        traceId: "trc_mock",
        output: { chapters: [{ chapter_id: chap.chapter_id, title: chap.title, challenges: firstOnly }] },
        parsed: {
          chapters: [
            {
              chapter_id: chap.chapter_id,
              title: chap.title,
              narrative_premise: "premise",
              milestone: { id: `m_${chap.chapter_id}`, summary: "" },
              challenges: firstOnly,
            },
          ],
        },
        text: "",
        tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
        latencyMs: 1,
      };
    }),
  };
});

describe("runSkill3Fill strict validation", () => {
  it("rejects a fill that is missing skeleton challenge_ids (truncation signature)", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const bp = createBlueprint("情境领导力 · validation", "d_validate");
    // runSkill3Fill only needs the blueprint to exist — it does not check
    // step1/step2 status. Keep the test fixture minimal so it survives type
    // changes to Step1Gamecore / Step2Experience.

    const { runSkill3Fill } = await import("@/lib/skills");
    const skeleton = {
      journey_meta: { arc_type: "hero_journey", tone: "cinematic_workplace", estimated_duration_min: 180 },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          milestone_summary: "",
          challenges: [
            { challenge_id: "c1_ch1", title: "ch1", binds_actions: ["a1"], complexity: "low" },
            { challenge_id: "c1_ch2", title: "ch2", binds_actions: ["a1"], complexity: "low" },
            { challenge_id: "c1_ch3", title: "ch3", binds_actions: ["a1"], complexity: "low" },
          ],
        },
      ],
    };
    await expect(runSkill3Fill(bp.blueprint_id, skeleton)).rejects.toThrow(
      /missing challenges.*c1_ch2.*c1_ch3|missing challenges.*c1_ch3.*c1_ch2/
    );
  });

  it("normalizes response_frames and always adds free_text_default", async () => {
    const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
    const bp = createBlueprint("情境领导力 · response frames", "d_frames");

    const { runSkill3Fill } = await import("@/lib/skills");
    const skeleton = {
      journey_meta: { arc_type: "hero_journey", tone: "cinematic_workplace", estimated_duration_min: 180 },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          milestone_summary: "",
          challenges: [
            {
              challenge_id: "c1_ch1",
              title: "ch1",
              binds_actions: ["a1"],
              complexity: "low",
              default_response_frame_id: "rf_form",
              response_frames: [
                {
                  frame_id: "rf_form",
                  version: 1,
                  kind: "form",
                  title: "准备度诊断表",
                  prompt: "拆开填写。",
                  binds_actions: ["a1"],
                  fields: [
                    { field_id: "person", type: "text", label: "对象", required: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    await runSkill3Fill(bp.blueprint_id, skeleton);

    const saved = getBlueprint(bp.blueprint_id);
    const challenge = saved?.step3_script?.chapters[0]?.challenges[0];
    expect(challenge?.default_response_frame_id).toBe("rf_form");
    expect(challenge?.response_frames?.map((f) => f.frame_id)).toEqual([
      "free_text_default",
      "rf_form",
    ]);
  });
});
