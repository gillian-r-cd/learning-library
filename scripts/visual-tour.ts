// Visual smoke tour — seeds a blueprint + learner via API, then captures
// screenshots of every major page. Standalone script; connects to an already
// running dev server on :3100.

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3100";
const OUT = path.join(process.cwd(), "screenshots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

async function api<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await r.json()) as T;
}

async function main() {
  // 1) Seed a blueprint + run all 5 skills
  const bp = await api<{ blueprint: { blueprint_id: string } }>(
    "/api/design/blueprints",
    "POST",
    { topic: "情境领导力（Visual Tour）" }
  );
  const bpId = bp.blueprint.blueprint_id;
  for (const action of ["run_skill_1", "run_skill_2", "run_skill_3_fill", "run_skill_4", "run_skill_5"]) {
    await api("/api/design/skills", "POST", { action, blueprint_id: bpId });
  }
  for (const step of ["step1", "step2", "step3", "step4", "step5"]) {
    await api("/api/design/skills", "POST", { action: "confirm_step", blueprint_id: bpId, step });
  }

  // 2) Create learner and run a few turns
  const learner = await api<{ learner: { learner_id: string } }>(
    "/api/learning/learners",
    "POST",
    { blueprint_id: bpId }
  );
  const lid = learner.learner.learner_id;
  const input =
    "我仔细观察了对方的肢体语言与语气变化：他回避眼神、回答很短、对任务范围反复确认。结合他刚被任命的新岗位和我对他既往能力的了解，我判断他处于 R2 — 能力成长中但意愿较低。我准备采用 S2 推销型：先认可他的顾虑，再通过给出具体下一步来重新激活意愿。";
  for (let i = 0; i < 4; i++) {
    await api("/api/learning/turn", "POST", { learner_id: lid, input });
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  async function shoot(name: string, url: string) {
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log(`✓ ${name} — ${url}`);
  }

  await shoot("01-home", "/");
  await shoot("02-design-list", "/design");
  await shoot("03-design-workspace-step1", `/design/${bpId}`);
  // click through step tabs (with robust waits)
  for (const n of [3, 4, 5]) {
    const tab = page.locator(`[data-test-id="step-tab-${n}"]`).first();
    await tab.scrollIntoViewIfNeeded();
    await tab.click({ force: true, timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `0${n + 1}-design-workspace-step${n}.png`), fullPage: true });
    console.log(`✓ 0${n + 1}-design-workspace-step${n}`);
  }

  await shoot("07-learn-list", "/learn");
  await shoot("08-learner-session", `/learn/${lid}`);
  await shoot("09-admin-home", "/admin");
  await shoot("10-admin-ledger", "/admin/ledger");
  await shoot("11-admin-metrics", "/admin/metrics");
  await shoot("12-admin-prompts", "/admin/prompts");

  // open a specific prompt editor
  await page.goto(`${BASE}/admin/prompts/edit?key=skill_1_gamecore.template&scope=system`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "13-admin-prompt-editor.png"), fullPage: true });
  console.log("✓ 13-admin-prompt-editor");

  await browser.close();
  console.log(`\nScreenshots saved to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
