// Headless smoke probe: against the running dev server on :3100, navigate
// to an existing learner page, find an artifact bubble, click it, and
// verify the inline expansion behaviour (no modal popup; renderer visible
// inside the bubble; collapse button works).
//
// Run: npx tsx scripts/probe-bubble-expand.ts <learner_id>

import { chromium } from "playwright";

const LEARNER_ID = process.argv[2] ?? "u_7a1ce378";
const BASE = "http://localhost:3100";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  console.log(`[probe] visiting ${BASE}/learn/${LEARNER_ID}`);
  const res = await page.goto(`${BASE}/learn/${LEARNER_ID}`, {
    waitUntil: "domcontentloaded",
  });
  if (!res || res.status() !== 200) {
    console.error(`[probe] page not 200: ${res?.status()}`);
    process.exit(1);
  }

  // Wait for at least one artifact bubble to appear.
  const bubbleSel = "[data-test-id='msg-artifact']";
  await page.waitForSelector(bubbleSel, { timeout: 15_000 });
  const bubbleCount = await page.locator(bubbleSel).count();
  console.log(`[probe] found ${bubbleCount} artifact bubble(s)`);
  const bubble = page.locator(bubbleSel).first();

  // Pre-click: should show the expand hint, not be expanded, no modal.
  const preExpanded = await bubble.getAttribute("data-expanded");
  console.log(`[probe] before click data-expanded=${preExpanded}`);
  if (preExpanded !== "0") {
    console.error(`[probe] expected data-expanded=0 before click`);
    process.exit(2);
  }
  const hintBefore = await bubble.locator("[data-test-id='artifact-expand-hint']").count();
  console.log(`[probe] expand hint count before=${hintBefore}`);
  if (hintBefore !== 1) {
    console.error(`[probe] expected exactly one expand hint`);
    process.exit(2);
  }

  // Click the bubble.
  await bubble.click();
  // Should NOT spawn a modal.
  await page.waitForTimeout(500);
  const modalCount = await page.locator("[data-test-id='artifact-modal']").count();
  console.log(`[probe] modal count after click=${modalCount}`);
  if (modalCount !== 0) {
    console.error(`[probe] FAIL: modal popped despite inline expansion change`);
    process.exit(3);
  }

  const postExpanded = await bubble.getAttribute("data-expanded");
  console.log(`[probe] after click data-expanded=${postExpanded}`);
  if (postExpanded !== "1") {
    console.error(`[probe] expected data-expanded=1 after click`);
    process.exit(3);
  }
  // The renderer should now be visible inside the bubble.
  const rendererCount = await bubble.locator("[data-test-id^='renderer-']").count();
  console.log(`[probe] renderers inside bubble after expand=${rendererCount}`);
  if (rendererCount === 0) {
    console.error(`[probe] FAIL: no renderer found inside expanded bubble`);
    process.exit(3);
  }

  // Click collapse.
  await bubble.locator("[data-test-id='artifact-collapse']").click();
  await page.waitForTimeout(300);
  const finalExpanded = await bubble.getAttribute("data-expanded");
  console.log(`[probe] after collapse data-expanded=${finalExpanded}`);
  if (finalExpanded !== "0") {
    console.error(`[probe] expected data-expanded=0 after collapse`);
    process.exit(4);
  }

  console.log("[probe] PASS");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
