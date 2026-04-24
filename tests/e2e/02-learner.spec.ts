import { test, expect, request } from "@playwright/test";

// helper: create a fully-built blueprint via API so the learner UI has something to run
async function createReadyBlueprint(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", { data: { topic: `Learner Topic ${Date.now()}` } });
  const { blueprint } = await bp.json();
  for (const action of ["run_skill_1", "run_skill_2", "run_skill_3_fill", "run_skill_4", "run_skill_5"]) {
    const r = await ctx.post("/api/design/skills", { data: { action, blueprint_id: blueprint.blueprint_id } });
    const j = await r.json();
    expect(j.ok, `${action} failed: ${j.error}`).toBeTruthy();
  }
  return blueprint.blueprint_id;
}

test("Learner: start session, send turn, see narrator + state update", async ({ page, baseURL }) => {
  await createReadyBlueprint(baseURL!);
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "学员旅程" })).toBeVisible();
  await page.getByTestId("create-learner").click();
  await page.waitForURL(/\/learn\/u_/, { timeout: 15_000 });

  // On learner session page. Immersive opening writes exactly 1 narrator bubble up front.
  await expect(page.getByTestId("challenge-title")).toBeVisible({ timeout: 15_000 });
  // The opening now uses msg-narrator-opening; turn responses use msg-narrator.
  const narratorLocator = page.locator(
    "[data-test-id='msg-narrator'], [data-test-id='msg-narrator-opening']"
  );
  await expect(narratorLocator.first()).toBeVisible();
  const openingCount = await narratorLocator.count();
  expect(openingCount).toBeGreaterThanOrEqual(1);

  const longInput =
    "我观察到对方回避眼神、语气犹豫，结合他承担跨部门任务的事实，我判断他能力中等但意愿低，倾向准备度 R2，我选择 S2 推销型，先肯定再给方向，并给他一个明确的下一步动作。";
  await page.getByTestId("learner-input").fill(longInput);
  await page.getByTestId("learner-send").click();

  // Sending a turn adds one more narrator bubble (the reply). Use the same
  // combined selector so opening bubbles (which use msg-narrator-opening)
  // continue to count.
  await expect(narratorLocator).toHaveCount(openingCount + 1, { timeout: 30_000 });

  // Points should update from 0
  const pts = await page.getByTestId("points-total").innerText();
  expect(Number(pts)).toBeGreaterThan(0);
});

test("Learner: several turns trigger companion unlock", async ({ page, baseURL }) => {
  const bpId = await createReadyBlueprint(baseURL!);
  const ctx = await request.newContext({ baseURL });
  const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
  const { learner } = await lr.json();

  const strong =
    "高质量长回答：从信息采集到推理路径再到结论判断，我都给出具体依据。我观察到对方的语气与肢体语言，结合他承担的任务与历史绩效，我判断他处于 R2 阶段，应采用 S2 推销型风格建立共识并明确下一步。补充一个反例来强化判断。";
  let unlocked = false;
  for (let i = 0; i < 20; i++) {
    const r = await ctx.post("/api/learning/turn", {
      data: { learner_id: learner.learner_id, input: strong },
    });
    const j = await r.json();
    if (j.newUnlocks?.length > 0) {
      unlocked = true;
      break;
    }
  }
  expect(unlocked).toBeTruthy();

  await page.goto(`/learn/${learner.learner_id}`);
  await expect(page.locator("[data-test-id^='unlocked-']").first()).toBeVisible({ timeout: 10000 });
});
