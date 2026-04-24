import { test, expect, request } from "@playwright/test";

async function seedSomeCalls(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", { data: { topic: `Admin Topic ${Date.now()}` } });
  const { blueprint } = await bp.json();
  for (const action of ["run_skill_1", "run_skill_2", "run_skill_3_fill", "run_skill_4", "run_skill_5"]) {
    await ctx.post("/api/design/skills", { data: { action, blueprint_id: blueprint.blueprint_id } });
  }
  const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: blueprint.blueprint_id } });
  const { learner } = await lr.json();
  for (let i = 0; i < 3; i++) {
    await ctx.post("/api/learning/turn", {
      data: {
        learner_id: learner.learner_id,
        input: "我仔细观察了对方的沟通信号并给出了基于具体情境的判断与下一步动作，长度足够。",
      },
    });
  }
  return { blueprintId: blueprint.blueprint_id, learnerId: learner.learner_id };
}

test("Admin home shows KPIs and recent calls", async ({ page, baseURL }) => {
  await seedSomeCalls(baseURL!);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "运维后台" })).toBeVisible();
  await expect(page.getByText("调用总数")).toBeVisible();
  await expect(page.getByText(/最近 5 次调用/)).toBeVisible();
});

test("Admin Ledger list + detail shows raw_input/raw_output", async ({ page, baseURL }) => {
  await seedSomeCalls(baseURL!);
  await page.goto("/admin/ledger");
  await expect(page.getByRole("heading", { name: "Raw Call Ledger" })).toBeVisible();

  // click first row
  const firstLink = page.locator("[data-test-id^='ledger-row-']").first();
  await firstLink.click();
  await expect(page.getByRole("heading", { name: "调用详情" })).toBeVisible();
  await expect(page.getByTestId("raw-input")).toBeVisible();
  await expect(page.getByTestId("raw-output")).toBeVisible();
});

test("Admin Prompts list shows system-level keys and editor works", async ({ page, baseURL }) => {
  await seedSomeCalls(baseURL!);
  await page.goto("/admin/prompts");
  await expect(page.getByRole("heading", { name: /Prompt Store/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /系统级/ })).toBeVisible();
  // click a known prompt
  await page.getByTestId("prompt-link-skill_1_gamecore.template").click();
  await expect(page.getByTestId("prompt-system")).toBeVisible();
  // edit and publish
  const existing = await page.getByTestId("prompt-system").inputValue();
  await page.getByTestId("prompt-system").fill(existing + "\n\n[edited via E2E]");
  await page.getByTestId("publish-prompt").click();
  await expect(page.getByText(/已发布 v|Published v/).first()).toBeVisible({ timeout: 5000 });
});

test("Admin Metrics dashboard loads caller breakdown", async ({ page, baseURL }) => {
  await seedSomeCalls(baseURL!);
  await page.goto("/admin/metrics");
  await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
  await expect(page.locator("[data-test-id^='metric-caller-']").first()).toBeVisible();
});

test("Trace view lists all spans for a turn", async ({ page, baseURL }) => {
  const { learnerId } = await seedSomeCalls(baseURL!);
  const ctx = await request.newContext({ baseURL });
  const t = await ctx.post("/api/learning/turn", {
    data: { learner_id: learnerId, input: "我观察到具体行为并给出推理路径与判断，证据充分，足够长度。" },
  });
  const tj = await t.json();
  await page.goto(`/admin/trace/${tj.traceId}`);
  await expect(page.getByRole("heading", { name: "Trace" })).toBeVisible();
  await expect(page.locator("[data-test-id^='trace-span-']")).toHaveCount(2); // judge + narrator minimum
});
