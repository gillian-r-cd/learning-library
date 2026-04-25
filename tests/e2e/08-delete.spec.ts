import { test, expect, request } from "@playwright/test";

async function createReadyBlueprint(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const bp = await ctx.post("/api/design/blueprints", {
    data: { topic: `Delete Topic ${Date.now()}` },
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
  return blueprint.blueprint_id as string;
}

test.describe("Delete + batch delete · cascade from design to learner", () => {
  test("deleting a Blueprint also wipes its learner journeys", async ({
    page,
    baseURL,
  }) => {
    const ctx = await request.newContext({ baseURL });
    const bpId = await createReadyBlueprint(baseURL!);

    // Spin up two learners under that blueprint.
    const l1 = (await (await ctx.post("/api/learning/learners", {
      data: { blueprint_id: bpId },
    })).json()).learner.learner_id as string;
    const l2 = (await (await ctx.post("/api/learning/learners", {
      data: { blueprint_id: bpId },
    })).json()).learner.learner_id as string;

    // Both learners exist before delete.
    const beforeLearners = await ctx.get("/api/learning/learners");
    const beforeIds = (await beforeLearners.json()).learners.map((l: { learner_id: string }) => l.learner_id);
    expect(beforeIds).toContain(l1);
    expect(beforeIds).toContain(l2);

    // Delete the blueprint via the API (UI uses window.confirm which is hard
    // to drive; the API path is what the UI calls).
    const del = await ctx.delete(`/api/design/blueprints/${bpId}`);
    const delJson = await del.json();
    expect(delJson.ok).toBe(true);
    expect(delJson.deleted.blueprints).toBe(1);
    expect(delJson.deleted.learners).toBe(2);

    // Both learners gone.
    const afterLearners = await ctx.get("/api/learning/learners");
    const afterIds = (await afterLearners.json()).learners.map((l: { learner_id: string }) => l.learner_id);
    expect(afterIds).not.toContain(l1);
    expect(afterIds).not.toContain(l2);

    // Blueprint gone too.
    const lookup = await ctx.get(`/api/design/blueprints/${bpId}`);
    expect(lookup.status()).toBe(404);

    // The learner pages also 404 on the deep route.
    await page.goto(`/learn/${l1}`);
    await expect(page.getByText(/未找到|not found|404/i).first()).toBeVisible();
  });

  test("design list shows delete + batch-delete UI", async ({ page, baseURL }) => {
    const bpId = await createReadyBlueprint(baseURL!);
    await page.goto("/design");
    // Per-row delete button
    await expect(page.getByTestId(`bp-delete-${bpId}`)).toBeVisible();
    // Per-row checkbox
    await expect(page.getByTestId(`bp-select-${bpId}`)).toBeVisible();
    // Batch button hidden until something is selected
    await expect(page.getByTestId("bp-batch-delete")).toHaveCount(0);
    await page.getByTestId(`bp-select-${bpId}`).check();
    await expect(page.getByTestId("bp-batch-delete")).toBeVisible();
  });

  test("learner list shows delete + batch-delete UI; single delete via API removes the row", async ({
    page,
    baseURL,
  }) => {
    const ctx = await request.newContext({ baseURL });
    const bpId = await createReadyBlueprint(baseURL!);
    const lr = (await (await ctx.post("/api/learning/learners", {
      data: { blueprint_id: bpId },
    })).json()).learner.learner_id as string;

    await page.goto("/learn");
    await expect(page.getByTestId(`learner-delete-${lr}`)).toBeVisible();
    await expect(page.getByTestId(`learner-select-${lr}`)).toBeVisible();

    // API delete path used by the button
    const del = await ctx.delete(`/api/learning/learners/${lr}`);
    const delJson = await del.json();
    expect(delJson.ok).toBe(true);
    expect(delJson.deleted.learners).toBe(1);

    // Reload and confirm the row is gone.
    await page.reload();
    await expect(page.getByTestId(`learner-link-${lr}`)).toHaveCount(0);
  });

  test("batch delete API removes multiple blueprints in one call", async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const bp1 = await createReadyBlueprint(baseURL!);
    const bp2 = await createReadyBlueprint(baseURL!);
    const r = await ctx.post("/api/design/blueprints/batch-delete", {
      data: { ids: [bp1, bp2] },
    });
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.deleted.blueprints).toBe(2);
    expect((await ctx.get(`/api/design/blueprints/${bp1}`)).status()).toBe(404);
    expect((await ctx.get(`/api/design/blueprints/${bp2}`)).status()).toBe(404);
  });
});
