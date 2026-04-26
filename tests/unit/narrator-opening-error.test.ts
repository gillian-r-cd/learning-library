import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `narrator-opening-error-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

const llmCallMock = vi.fn();
vi.mock("@/lib/llm", () => ({ llmCall: llmCallMock }));

describe("runNarratorOpening provider errors", () => {
  it("propagates LLM provider failures instead of writing a deterministic fallback opening", async () => {
    llmCallMock.mockRejectedValueOnce(new Error("provider down"));
    const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
    const { runNarratorOpening } = await import("@/lib/narrator");

    const bp = createBlueprint("真实开场测试", "d_opening_error");
    bp.step1_gamecore = { core_actions: [], relation_graph: [] };
    bp.step3_script = {
      journey_meta: {
        arc_type: "hero_journey",
        tone: "workplace",
        estimated_duration_min: 30,
      },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          narrative_premise: "测试开场失败",
          milestone: { id: "m1", summary: "完成" },
          challenges: [
            {
              challenge_id: "ch1",
              title: "第一关",
              binds_actions: [],
              complexity: "low",
              trunk: {
                setup: "你来到会议室。",
                action_prompts: ["观察现场。"],
                expected_signals: ["能观察"],
              },
              companion_hooks: [],
            },
          ],
        },
      ],
    };
    updateBlueprint(bp);

    await expect(
      runNarratorOpening({
        learnerId: "u_opening_error",
        blueprintId: bp.blueprint_id,
        variant: "first",
        chapterId: "c1",
        challengeId: "ch1",
        traceId: "trc_opening_error",
      })
    ).rejects.toThrow("provider down");
  });
});
