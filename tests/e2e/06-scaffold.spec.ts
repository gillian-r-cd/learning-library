import { test, expect, request } from "@playwright/test";

async function createReadyBlueprint(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", {
    data: { topic: `Scaffold Topic ${Date.now()}` },
  });
  const { blueprint } = await bp.json();
  for (const action of [
    "run_skill_1",
    "run_skill_2",
    "run_skill_3_fill",
    "run_skill_4",
    "run_skill_5",
  ]) {
    const r = await ctx.post("/api/design/skills", {
      data: { action, blueprint_id: blueprint.blueprint_id },
    });
    const j = await r.json();
    expect(j.ok, `${action} failed: ${j.error}`).toBeTruthy();
  }
  return blueprint.blueprint_id;
}

test.describe("Scaffold system · 认知支架全流程", () => {
  test('学员说"我不知道了" → Judge 强制 simplify_challenge + worked_example，evidence 带 scaffold_strategy', async ({
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    const r = await ctx.post("/api/learning/turn", {
      data: { learner_id: learner.learner_id, input: "我不知道了" },
    });
    const j = await r.json();
    expect(j.judgeOutput.path_decision.type).toBe("simplify_challenge");
    expect(j.judgeOutput.path_decision.scaffold_spec.strategy).toBe("worked_example");
  });

  test("Points modal 的条目在 scaffold 触发时显示「🧱 支架」chip", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    // One poor-grade turn to create a scaffold-tagged evidence row.
    await ctx.post("/api/learning/turn", {
      data: { learner_id: learner.learner_id, input: "不会" },
    });

    await page.goto(`/learn/${learner.learner_id}`);
    await expect(page.getByTestId("open-points-breakdown")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("open-points-breakdown").click();
    await expect(page.getByTestId("points-modal")).toBeVisible();

    const scaffoldChip = page.locator("[data-test-id^='scaffold-chip-']").first();
    await expect(scaffoldChip).toBeVisible();
    await expect(scaffoldChip).toContainText("支架");
  });

  test("Admin /scaffold 面板加载 + 出现 worked_example 策略行", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();
    // Trigger a simplify_challenge (worked_example) via self-help signal.
    await ctx.post("/api/learning/turn", {
      data: { learner_id: learner.learner_id, input: "我不知道了" },
    });

    await page.goto("/admin/scaffold");
    await expect(page.locator("h1")).toContainText("认知支架效果");
    await expect(page.getByTestId("scaffold-strategy-table")).toBeVisible();
    await expect(page.getByTestId("scaffold-row-worked_example")).toBeVisible();
  });

  test("Scaffold 触发后，conversation_log 的 narrator 气泡 meta.kind=scaffold", async ({
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    await ctx.post("/api/learning/turn", {
      data: { learner_id: learner.learner_id, input: "我不知道了" },
    });

    const snap = await ctx.get(`/api/learning/learners/${learner.learner_id}`);
    const j = await snap.json();
    const scaffoldNarrator = (j.conversation ?? []).find(
      (c: { role: string; meta?: { kind?: string; strategy?: string } }) =>
        c.role === "narrator" &&
        c.meta?.kind === "scaffold" &&
        c.meta?.strategy === "worked_example"
    );
    expect(scaffoldNarrator).toBeTruthy();
  });
});
