import { test, expect } from "@playwright/test";

test.describe("Designer flow: create Blueprint + run all 5 skills + confirm steps", () => {
  test("end-to-end", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "UMU Learning Library" })).toBeVisible();

    await page.getByTestId("card-design").click();
    await expect(page.getByRole("heading", { name: "设计阶段" })).toBeVisible();

    // create new blueprint
    const topic = `E2E Topic ${Date.now()}`;
    await page.getByTestId("bp-topic").fill(topic);
    await page.getByTestId("create-bp").click();
    await page.waitForURL(/\/design\/bp_/, { timeout: 15_000 });
    await expect(page.getByTestId("bp-topic-display")).toHaveText(topic, { timeout: 10_000 });

    // Step 1: Gamecore
    await page.getByTestId("step-tab-1").click();
    await page.getByTestId("run-run_skill_1").click();
    await expect(page.locator("[data-test-id^='action-']").first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId("confirm-step1").click();

    // Step 2: Experience
    await page.getByTestId("step-tab-2").click();
    await page.getByTestId("run-run_skill_2").click();
    await expect(page.locator("text=体验形式").first()).toBeVisible({ timeout: 10000 });
    await page.getByTestId("confirm-step2").click();

    // Step 3: Script
    await page.getByTestId("step-tab-3").click();
    await page.getByTestId("run-run_skill_3_fill").click();
    await expect(page.locator("text=hero_journey").first()).toBeVisible({ timeout: 20000 });
    await page.getByTestId("confirm-step3").click();

    // Step 4: Companions
    await page.getByTestId("step-tab-4").click();
    await page.getByTestId("run-run_skill_4").click();
    await expect(page.locator("[data-test-id^='companion-']").first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId("confirm-step4").click();

    // Step 5: Points
    await page.getByTestId("step-tab-5").click();
    await page.getByTestId("run-run_skill_5").click();
    await expect(page.locator("text=总容量估算").first()).toBeVisible({ timeout: 10000 });
    await page.getByTestId("confirm-step5").click();
  });

  test("Copilot chat free-form input triggers Skill via intent classifier", async ({ page }) => {
    await page.goto("/design");
    const topic = `Copilot Topic ${Date.now()}`;
    await page.getByTestId("bp-topic").fill(topic);
    await page.getByTestId("create-bp").click();
    await page.waitForURL(/\/design\/bp_/, { timeout: 15_000 });
    await expect(page.getByTestId("bp-topic-display")).toHaveText(topic, { timeout: 10_000 });

    // Chat: natural-language request triggers Skill 1 via the intent classifier
    await page.getByTestId("chat-input").fill("请执行 Skill 1：Gamecore 萃取");
    await page.getByTestId("chat-send").click();
    await expect(
      page.getByText(/已生成 Gamecore 萃取结果/).first()
    ).toBeVisible({ timeout: 20_000 });
    // Step 1 panel should also be populated
    await expect(page.locator("[data-test-id^='action-']").first()).toBeVisible({ timeout: 5_000 });
  });
});
