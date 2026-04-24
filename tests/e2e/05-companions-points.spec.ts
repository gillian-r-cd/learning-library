import { test, expect, request } from "@playwright/test";

async function createReadyBlueprint(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", {
    data: { topic: `CompPoints Topic ${Date.now()}` },
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

test.describe("Companions library + Points breakdown", () => {
  test("CompanionLibrary button opens drawer with locked + unlocked sections and detail modal", async ({
    page,
    baseURL,
  }) => {
    await createReadyBlueprint(baseURL!);
    await page.goto("/learn");
    await page.getByTestId("create-learner").click();
    await page.waitForURL(/\/learn\/u_/, { timeout: 15_000 });
    await expect(page.getByTestId("open-companion-library")).toBeVisible({ timeout: 15_000 });

    // Badge format X/Y — no unlocks yet so unlocked count is 0
    const countText = await page.getByTestId("companion-library-count").innerText();
    expect(countText).toMatch(/^0\/\d+$/);

    // Open drawer
    await page.getByTestId("open-companion-library").click();
    await expect(page.getByTestId("companion-library")).toBeVisible();

    // Should contain at least one locked companion card
    const lockedCards = page.locator("[data-test-id^='companion-locked-']");
    await expect(lockedCards.first()).toBeVisible();

    // Click the first locked card → detail modal opens with unlock threshold
    await lockedCards.first().click();
    await expect(page.getByTestId("companion-detail-modal")).toBeVisible();
    await expect(page.getByTestId("companion-detail-modal")).toContainText("解锁条件");
    await page.getByTestId("companion-detail-close").click();
    await expect(page.getByTestId("companion-detail-modal")).not.toBeVisible();

    // Close drawer
    await page.getByTestId("companion-library-close").click();
    await expect(page.getByTestId("companion-library")).not.toBeVisible();
  });

  test("Points button opens modal with per-turn breakdown after a turn is played", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    // Play one turn via API so an evidence row exists with known fields.
    await ctx.post("/api/learning/turn", {
      data: {
        learner_id: learner.learner_id,
        input:
          "我观察到他早到五分钟、笔记本上密密麻麻都是产品知识点、手指一直在捻本子边角、眼睛亮但手没停，综合判断他是高意愿低能力，属于 R1。",
      },
    });

    await page.goto(`/learn/${learner.learner_id}`);
    await expect(page.getByTestId("open-points-breakdown")).toBeVisible({ timeout: 15_000 });

    // Sanity: points-total > 0 now
    const tot = await page.getByTestId("points-total").innerText();
    expect(Number(tot)).toBeGreaterThan(0);

    await page.getByTestId("open-points-breakdown").click();
    await expect(page.getByTestId("points-modal")).toBeVisible();

    // At least one entry row
    const entries = page.locator("[data-test-id^='points-entry-']");
    await expect(entries.first()).toBeVisible();

    // Entry must show the formula text and the Judge evidence
    await expect(entries.first()).toContainText("计算：");
    await expect(entries.first()).toContainText("分");

    // Raw total in the header card > 0
    const rawTotalText = await page.getByTestId("points-raw-total").innerText();
    expect(Number(rawTotalText)).toBeGreaterThan(0);

    await page.getByTestId("points-modal-close").click();
    await expect(page.getByTestId("points-modal")).not.toBeVisible();
  });

  test("After a companion unlocks, drawer count updates automatically (no reload)", async ({
    page,
    baseURL,
  }) => {
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
    const countText = await page
      .getByTestId("companion-library-count")
      .innerText();
    // e.g. "1/3" — at least one unlocked
    const [u] = countText.split("/");
    expect(Number(u)).toBeGreaterThanOrEqual(1);

    await page.getByTestId("open-companion-library").click();
    const unlockedCards = page.locator("[data-test-id^='companion-unlocked-']");
    await expect(unlockedCards.first()).toBeVisible();
    await unlockedCards.first().click();
    await expect(page.getByTestId("companion-detail-modal")).toBeVisible();
    // The detail should show "已解锁" section
    await expect(page.getByTestId("companion-detail-modal")).toContainText("已解锁");
  });
});
