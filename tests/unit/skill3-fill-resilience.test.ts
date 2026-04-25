import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `skill3-resilience-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  }
});

const failOnce = new Set<string>();
const returnErrorOnce = new Set<string>();
const failAlways = new Set<string>();
const callCountByChapter = new Map<string, number>();

vi.mock("@/lib/llm", async () => {
  return {
    llmCall: vi.fn(async (args: { variables: Record<string, unknown> }) => {
      if (!("skeleton" in args.variables)) {
        const key = "__skeleton";
        const nextCount = (callCountByChapter.get(key) ?? 0) + 1;
        callCountByChapter.set(key, nextCount);
        if (returnErrorOnce.has(key) && nextCount === 1) {
          return {
            callId: `call_skeleton_${nextCount}`,
            traceId: `trc_skeleton_${nextCount}`,
            output: { error: "Connection error." },
            parsed: undefined,
            text: "",
            tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
            latencyMs: 1,
          };
        }
        return {
          callId: `call_skeleton_${nextCount}`,
          traceId: `trc_skeleton_${nextCount}`,
          output: makeSkeleton(),
          parsed: makeSkeleton(),
          text: JSON.stringify(makeSkeleton()),
          tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
          latencyMs: 1,
        };
      }
      const sk = args.variables.skeleton as {
        chapter: {
          chapter_id: string;
          title: string;
          milestone_summary?: string;
          challenges: Array<{
            challenge_id: string;
            title: string;
            binds_actions: string[];
            complexity: "low" | "medium" | "high";
          }>;
        };
      };
      const chap = sk.chapter;
      const nextCount = (callCountByChapter.get(chap.chapter_id) ?? 0) + 1;
      callCountByChapter.set(chap.chapter_id, nextCount);

      if (failAlways.has(chap.chapter_id)) {
        throw new Error("Connection error.");
      }
      if (failOnce.has(chap.chapter_id) && nextCount === 1) {
        throw new Error("Connection error.");
      }
      if (returnErrorOnce.has(chap.chapter_id) && nextCount === 1) {
        return {
          callId: `call_${chap.chapter_id}_${nextCount}`,
          traceId: `trc_${chap.chapter_id}_${nextCount}`,
          output: { error: "Connection error." },
          parsed: undefined,
          text: "",
          tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
          latencyMs: 1,
        };
      }

      const challenges = chap.challenges.map((ch) => ({
        challenge_id: ch.challenge_id,
        title: ch.title,
        binds_actions: ch.binds_actions,
        complexity: ch.complexity,
        trunk: {
          setup: `这是 ${ch.challenge_id} 的完整场景描述，长度足够通过校验，并且每个挑战都有不同的开头。`,
          action_prompts: ["你看到了什么信号？", "你下一步如何判断？"],
          expected_signals: ["能给出具体证据", "能解释判断逻辑"],
        },
        companion_hooks: [],
        response_frames: [],
      }));

      return {
        callId: `call_${chap.chapter_id}_${nextCount}`,
        traceId: `trc_${chap.chapter_id}_${nextCount}`,
        output: { chapters: [{ chapter_id: chap.chapter_id, title: chap.title, challenges }] },
        parsed: {
          chapters: [
            {
              chapter_id: chap.chapter_id,
              title: chap.title,
              narrative_premise: `这是 ${chap.chapter_id} 的章节前提，介绍人物、处境和核心张力。`,
              milestone: { id: `m_${chap.chapter_id}`, summary: chap.milestone_summary ?? "" },
              challenges,
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

beforeEach(() => {
  failOnce.clear();
  returnErrorOnce.clear();
  failAlways.clear();
  callCountByChapter.clear();
});

describe("runSkill3Fill resilience", () => {
  it("retries a transient chapter fill connection error and completes the script", async () => {
    const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
    const { runSkill3Fill } = await import("@/lib/skills");
    const bp = createBlueprint("Skill3 transient retry", "d_skill3_retry");
    const skeleton = makeSkeleton();
    failOnce.add("c2");

    await expect(runSkill3Fill(bp.blueprint_id, skeleton)).resolves.toBeTruthy();

    expect(callCountByChapter.get("c2")).toBe(2);
    const saved = getBlueprint(bp.blueprint_id);
    expect(saved?.step3_script?.chapters.map((c) => c.chapter_id)).toEqual(["c1", "c2"]);
  });

  it("checkpoints completed chapters when a later chapter exhausts retries", async () => {
    const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
    const { runSkill3Fill } = await import("@/lib/skills");
    const bp = createBlueprint("Skill3 checkpoint on failure", "d_skill3_checkpoint");
    const skeleton = makeSkeleton();
    failAlways.add("c2");

    await expect(runSkill3Fill(bp.blueprint_id, skeleton)).rejects.toThrow(/Connection error/);

    const saved = getBlueprint(bp.blueprint_id);
    expect(saved?.step3_script?.chapters.map((c) => c.chapter_id)).toEqual(["c1"]);
    expect(saved?.step_status.step3).toBe("draft");
  });

  it("retries when llmCall returns a ledger-style connection error result", async () => {
    const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
    const { runSkill3Fill } = await import("@/lib/skills");
    const bp = createBlueprint("Skill3 returned error retry", "d_skill3_return_error");
    const skeleton = makeSkeleton();
    returnErrorOnce.add("c2");

    await expect(runSkill3Fill(bp.blueprint_id, skeleton)).resolves.toBeTruthy();

    expect(callCountByChapter.get("c2")).toBe(2);
    const saved = getBlueprint(bp.blueprint_id);
    expect(saved?.step3_script?.chapters.map((c) => c.chapter_id)).toEqual(["c1", "c2"]);
  });

  it("retries a transient skeleton connection error before fill receives the skeleton", async () => {
    const { createBlueprint } = await import("@/lib/blueprint");
    const { runSkill3Skeleton } = await import("@/lib/skills");
    const bp = createBlueprint("Skill3 skeleton retry", "d_skill3_skeleton_retry");
    bp.step1_gamecore = { core_actions: [], relation_graph: [] };
    bp.step2_experience = { mappings: [], form_library_version: "test" };
    const { updateBlueprint } = await import("@/lib/blueprint");
    updateBlueprint(bp);
    returnErrorOnce.add("__skeleton");

    const result = await runSkill3Skeleton(bp.blueprint_id);

    expect(callCountByChapter.get("__skeleton")).toBe(2);
    expect((result.skeleton as { chapters?: unknown[] }).chapters?.length).toBe(2);
  });
});

function makeSkeleton() {
  return {
    journey_meta: { arc_type: "hero_journey", tone: "cinematic_workplace", estimated_duration_min: 180 },
    chapters: [
      {
        chapter_id: "c1",
        title: "第一章",
        milestone_summary: "完成第一章",
        challenges: [
          { challenge_id: "c1_ch1", title: "ch1", binds_actions: ["a1"], complexity: "low" },
        ],
      },
      {
        chapter_id: "c2",
        title: "第二章",
        milestone_summary: "完成第二章",
        challenges: [
          { challenge_id: "c2_ch1", title: "ch1", binds_actions: ["a1"], complexity: "medium" },
        ],
      },
    ],
  };
}
