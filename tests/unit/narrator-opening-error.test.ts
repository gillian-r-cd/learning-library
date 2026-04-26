import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `narrator-opening-error-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

const llmCallMock = vi.fn();
vi.mock("@/lib/llm", () => ({ llmCall: llmCallMock }));

beforeEach(() => {
  llmCallMock.mockReset();
});

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

  it("accepts natural artifact references instead of falling back to deterministic text", async () => {
    const generated =
      "你是一名刚从大厂裸辞、准备半年内转型独立产品人的前端工程师。现在是周四深夜，电视还亮着，手机还在手里，你刚刷完一条短视频，下一条已经自动接上。你要把这次失控拆成能观察的回路，否则后面几周还是会被同一股惯性拖走。屏幕使用时间面板已经摊在你面前，过去 7 天每天 23:30 之后平均还要刷 92 分钟，最晚一次停在 2:11。把镜头慢下来，今晚最开始让你拿起手机的那个动作或情绪，具体是什么？";
    llmCallMock.mockResolvedValueOnce({
      text: generated,
      callId: "call_generated",
      traceId: "trc_generated",
      output: {},
      tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
      latencyMs: 1,
    });
    const { createBlueprint, updateBlueprint } = await import("@/lib/blueprint");
    const { runNarratorOpening } = await import("@/lib/narrator");

    const bp = createBlueprint("自然道具引用测试", "d_opening_artifact");
    bp.step1_gamecore = { core_actions: [], relation_graph: [] };
    bp.step3_script = {
      journey_meta: {
        arc_type: "hero_journey",
        tone: "workplace",
        estimated_duration_min: 30,
        protagonist_role: "一名刚从大厂裸辞、准备半年内转型独立产品人的前端工程师",
      },
      chapters: [
        {
          chapter_id: "c1",
          title: "第一章",
          narrative_premise: "原子习惯练习",
          milestone: { id: "m1", summary: "完成观察" },
          challenges: [
            {
              challenge_id: "ch1",
              title: "拆回路",
              binds_actions: [],
              complexity: "low",
              trunk: {
                setup: "你窝在沙发上看手机。",
                action_prompts: ["找出最开始的触发点。"],
                expected_signals: ["能说出触发点"],
              },
              companion_hooks: [],
              artifacts: [
                {
                  artifact_id: "art_screen_time",
                  version: 1,
                  name: "屏幕使用时间 · 最近 7 天",
                  type: "table",
                  trigger: "on_challenge_enter",
                  content: {
                    type: "table",
                    title: "屏幕使用时间 · 最近 7 天",
                    columns: [{ key: "after_2330", label: "23:30 后" }],
                    rows: [{ after_2330: "92 分钟" }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    updateBlueprint(bp);

    const result = await runNarratorOpening({
      learnerId: "u_opening_artifact",
      blueprintId: bp.blueprint_id,
      variant: "first",
      chapterId: "c1",
      challengeId: "ch1",
      traceId: "trc_opening_artifact",
    });

    expect(result.text).toBe(generated);
  });
});
