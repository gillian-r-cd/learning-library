import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `bp-test-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;

beforeAll(() => {
  if (!fs.existsSync(path.dirname(TEST_DB))) fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
});

describe("blueprint CRUD + cascade", () => {
  it("creates and retrieves a blueprint", async () => {
    const { createBlueprint, getBlueprint } = await import("@/lib/blueprint");
    const bp = createBlueprint("情境领导力", "d_test");
    expect(bp.blueprint_id).toMatch(/^bp_/);
    expect(bp.status).toBe("in_design");
    const got = getBlueprint(bp.blueprint_id);
    expect(got?.topic).toBe("情境领导力");
  });

  it("cascades downstream steps to stale when upstream changes", async () => {
    const { createBlueprint, cascadeStale, updateBlueprint } = await import("@/lib/blueprint");
    const bp = createBlueprint("领导力", "d_test");
    bp.step_status = {
      step1: "confirmed",
      step2: "confirmed",
      step3: "confirmed",
      step4: "confirmed",
      step5: "confirmed",
    };
    updateBlueprint(bp);
    cascadeStale(bp, "step2");
    expect(bp.step_status.step1).toBe("confirmed");
    expect(bp.step_status.step2).toBe("confirmed");
    expect(bp.step_status.step3).toBe("stale");
    expect(bp.step_status.step4).toBe("stale");
    expect(bp.step_status.step5).toBe("stale");
  });
});

describe("design skills end-to-end (mock mode)", () => {
  it("runs all 5 skills and produces a ready-ish blueprint", async () => {
    process.env.LLM_MOCK = "1";
    const { createBlueprint } = await import("@/lib/blueprint");
    const {
      runSkill1,
      runSkill2,
      runSkill3Skeleton,
      runSkill3Fill,
      runSkill4,
      runSkill5,
    } = await import("@/lib/skills");
    const bp = createBlueprint("情境领导力", "d_e2e");
    const r1 = await runSkill1(bp.blueprint_id);
    expect(r1.blueprint.step1_gamecore?.core_actions.length).toBeGreaterThan(0);
    await runSkill2(bp.blueprint_id);
    const sk = await runSkill3Skeleton(bp.blueprint_id);
    expect(sk.skeleton).toBeTruthy();
    await runSkill3Fill(bp.blueprint_id, sk.skeleton);
    await runSkill4(bp.blueprint_id);
    const r5 = await runSkill5(bp.blueprint_id);
    expect(r5.blueprint.step5_points?.total_capacity).toBeGreaterThan(0);
    expect(r5.blueprint.step5_points?.instance_params.unlock_thresholds.length).toBeGreaterThan(0);
  });
});
