import { test, expect, request } from "@playwright/test";

async function createReadyBlueprint(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", {
    data: { topic: `Incentive Topic ${Date.now()}` },
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

test.describe("Incentive architecture · 英雄之旅 / 招式集 / 能力地图 / 宣言", () => {
  test("Arc indicator shows current stage + opening bubble wears arc chip", async ({
    page,
    baseURL,
  }) => {
    await createReadyBlueprint(baseURL!);
    await page.goto("/learn");
    await page.getByTestId("create-learner").click();
    await page.waitForURL(/\/learn\/u_/, { timeout: 15_000 });

    // Right-panel arc indicator card visible
    await expect(page.getByTestId("arc-stage-indicator")).toBeVisible({ timeout: 15_000 });
    // Current stage chip exists (mock blueprint has arc_s1=觉察 bound to c1)
    await expect(page.getByTestId("arc-stage-current")).toBeVisible();

    // Opening narrator bubble has arc stage chip
    const openingBubble = page.getByTestId("msg-narrator-opening").first();
    await expect(openingBubble).toBeVisible();
    const arcChip = page.locator("[data-test-id^='arc-stage-chip-']").first();
    await expect(arcChip).toBeVisible();
  });

  test("Signature moves: top-bar button + earned after learner input matches recognition", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    // Input that overlaps with sm_a1_task_split recognition hint
    // ("同一下属身上给出两个不同 R 档并引用任务差异").
    await ctx.post("/api/learning/turn", {
      data: {
        learner_id: learner.learner_id,
        input:
          "我在同一下属身上看到两种情况：做方案时他高能力高意愿，但做CRM录入他明显低意愿。我会按任务差异分别给不同的准备度档位。",
      },
    });

    await page.goto(`/learn/${learner.learner_id}`);
    await expect(page.getByTestId("open-signature-moves")).toBeVisible({ timeout: 15_000 });
    // Badge should show at least 1 earned
    const count = await page.getByTestId("signature-moves-count").innerText();
    const [earned] = count.split("/");
    expect(Number(earned)).toBeGreaterThanOrEqual(1);

    await page.getByTestId("open-signature-moves").click();
    await expect(page.getByTestId("signature-moves")).toBeVisible();
    const earnedCards = page.locator("[data-test-id^='move-earned-']");
    await expect(earnedCards.first()).toBeVisible();
  });

  test("Mastery heatmap: top-bar button + modal + cells reflect evidence", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    // One strong turn to turn on a cell.
    await ctx.post("/api/learning/turn", {
      data: {
        learner_id: learner.learner_id,
        input:
          "高质量长回答：我从信息采集到推理路径再到结论判断都给出具体依据。我观察到对方的语气与肢体语言，结合他承担的任务与历史绩效，判断他处于 R2 阶段，建议采用 S2 推销型。",
      },
    });

    await page.goto(`/learn/${learner.learner_id}`);
    await expect(page.getByTestId("open-mastery-heatmap")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("open-mastery-heatmap").click();
    await expect(page.getByTestId("mastery-heatmap-modal")).toBeVisible();
    await expect(page.getByTestId("mastery-heatmap-table")).toBeVisible();
    // A cell for (a1, low) should exist and be clickable
    const firstCell = page.locator("[data-test-id^='mastery-cell-']").first();
    await expect(firstCell).toBeVisible();
    await firstCell.click();
    await expect(page.getByTestId("mastery-cell-detail")).toBeVisible();
  });

  test("Manifesto panel: empty on day one, card after a chapter closes", async ({
    page,
    baseURL,
  }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    const ctx = await request.newContext({ baseURL });
    const lr = await ctx.post("/api/learning/learners", { data: { blueprint_id: bpId } });
    const { learner } = await lr.json();

    // Initial page — empty state visible
    await page.goto(`/learn/${learner.learner_id}`);
    await expect(page.getByTestId("manifesto-panel-empty")).toBeVisible({ timeout: 15_000 });

    // Directly invoke the manifesto pipeline via a helper test-only route.
    // We don't have such route today, so instead we simulate by seeding
    // quotable evidence + calling the pipeline through the state-manager
    // write path. But simpler: create the needed state via DB directly and
    // then refresh the page.
    // Must be > 120 chars to trigger mock Judge's `grade=good`. Pad to be safe.
    const strong =
      "我判断他处在 R2 阶段——依据是他在客户面谈时眼神追线索、语气克制，我还注意到他手上那份跟进笔记的页脚笔迹很密，这说明投入度是高的但执行自信不足。" +
      "综合来看他的能力在中段、意愿在高段。我认为用 S2 推销型对他最合适：先用具体场景带他演练一次，再把方向盘交给他。" +
      "依据是他过去三周的客户反馈曲线，显示他在话术执行上卡点集中在开场破冰的前 30 秒。";
    // Play enough good turns that mock Judge will complete challenges and
    // eventually close chapter 1 (3 challenges × 3 good turns each = 9).
    let priorChapterId = "";
    let transitioned = false;
    for (let i = 0; i < 80; i++) {
      const r = await ctx.post("/api/learning/turn", {
        data: { learner_id: learner.learner_id, input: strong },
      });
      const j = await r.json();
      const nextCh = j.openingOfNewChallenge?.chapter_id ?? j.position?.chapter_id;
      if (priorChapterId && nextCh && nextCh !== priorChapterId) {
        transitioned = true;
        break;
      }
      priorChapterId = nextCh ?? priorChapterId;
    }
    expect(transitioned).toBe(true);

    // Verify via API response that at least one manifesto_segment exists,
    // which is the canonical signal a chapter closed + manifesto fired.
    const check = await ctx.get(`/api/learning/learners/${learner.learner_id}`);
    const state = await check.json();
    const hasManifesto = (state.manifesto_segments ?? []).length > 0;
    expect(hasManifesto).toBe(true);

    await page.reload();
    await expect(page.getByTestId("manifesto-panel")).toBeVisible({ timeout: 15_000 });
    const seg = page.locator("[data-test-id^='manifesto-segment-']").first();
    await expect(seg).toBeVisible();
  });
});
