import { test, expect, request } from "@playwright/test";

async function createReadyBlueprint(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", {
    data: { topic: `Artifact Topic ${Date.now()}` },
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

test.describe("Artifacts system · 道具功能全流程", () => {
  test("Scenario A — 挑战开场自动掉落 on_challenge_enter 道具", async ({ page, baseURL }) => {
    await createReadyBlueprint(baseURL!);
    await page.goto("/learn");
    await page.getByTestId("create-learner").click();
    await page.waitForURL(/\/learn\/u_/, { timeout: 15_000 });

    // 顶栏的道具箱按钮可见
    await expect(page.getByTestId("open-artifact-inbox")).toBeVisible({ timeout: 15_000 });

    // 挑战开场后应该有一条 artifact 气泡
    const artifactBubble = page.locator("[data-test-id='msg-artifact']");
    await expect(artifactBubble.first()).toBeVisible({ timeout: 15_000 });

    // 数量 ≥ 1
    const count = await page.getByTestId("artifact-inbox-count").innerText();
    expect(Number(count)).toBeGreaterThanOrEqual(1);

    // 点击气泡 → 原地展开（不再开 modal） → 完整渲染器应可见
    const firstBubble = artifactBubble.first();
    await firstBubble.click();
    await expect(firstBubble).toHaveAttribute("data-expanded", "1");
    // 应该不存在 modal（原地展开后没有遮罩弹窗）
    await expect(page.getByTestId("artifact-modal")).toHaveCount(0);
    // 渲染器在气泡内部可见
    const anyRenderer = firstBubble.locator("[data-test-id^='renderer-']");
    await expect(anyRenderer.first()).toBeVisible();
    // 收起按钮也在气泡内
    await page.getByTestId("artifact-collapse").click();
    await expect(firstBubble).toHaveAttribute("data-expanded", "0");
  });

  test("Scenario B — 打开道具箱面板查看已掉落道具", async ({ page, baseURL }) => {
    await createReadyBlueprint(baseURL!);
    await page.goto("/learn");
    await page.getByTestId("create-learner").click();
    await page.waitForURL(/\/learn\/u_/, { timeout: 15_000 });

    await expect(page.getByTestId("open-artifact-inbox")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("open-artifact-inbox").click();
    await expect(page.getByTestId("artifact-inbox")).toBeVisible();

    // 至少有一项
    const items = page.locator("[data-test-id^='artifact-inbox-item-']");
    await expect(items.first()).toBeVisible();

    // 点击进入 modal
    await items.first().click();
    await expect(page.getByTestId("artifact-modal")).toBeVisible();
    await page.getByTestId("artifact-modal-close").click();
    await page.getByTestId("artifact-inbox-close").click();
    await expect(page.getByTestId("artifact-inbox")).not.toBeVisible();
  });

  test("Scenario C — 学员询问触发 on_learner_request 道具掉落", async ({ page, baseURL }) => {
    await createReadyBlueprint(baseURL!);
    await page.goto("/learn");
    await page.getByTestId("create-learner").click();
    await page.waitForURL(/\/learn\/u_/, { timeout: 15_000 });

    await expect(page.getByTestId("open-artifact-inbox")).toBeVisible({ timeout: 15_000 });
    const initialCount = Number(
      await page.getByTestId("artifact-inbox-count").innerText()
    );

    // 构造一条会被 mock Judge 匹配到 "昨天/对话" trigger_hint 的询问
    await page.getByTestId("learner-input").fill(
      "我想看一下我和他昨天的对话记录，里面具体聊过哪些内容？"
    );
    await page.getByTestId("learner-send").click();

    // 等待道具数量 +1
    await expect
      .poll(
        async () => {
          const t = await page.getByTestId("artifact-inbox-count").innerText();
          return Number(t);
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(initialCount);

    // 新气泡也应出现
    const artifactBubbles = page.locator("[data-test-id='msg-artifact']");
    const bubbleCount = await artifactBubbles.count();
    expect(bubbleCount).toBeGreaterThanOrEqual(initialCount + 1);
  });

  test("Scenario D — 道具掉落后刷新页面能看到历史道具气泡与道具箱", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    // First visit — on_challenge_enter drop happens
    await page.goto(`/learn/${learner.learner_id}`);
    await expect(page.getByTestId("open-artifact-inbox")).toBeVisible({ timeout: 15_000 });
    const initial = Number(await page.getByTestId("artifact-inbox-count").innerText());
    expect(initial).toBeGreaterThanOrEqual(1);

    // Reload — the artifact bubble + inbox count should persist (stored in conversation_log).
    await page.reload();
    await expect(page.getByTestId("open-artifact-inbox")).toBeVisible({ timeout: 15_000 });
    const afterReload = Number(await page.getByTestId("artifact-inbox-count").innerText());
    expect(afterReload).toBe(initial);
    const bubble = page.locator("[data-test-id='msg-artifact']");
    await expect(bubble.first()).toBeVisible();
  });
});
