import { chromium } from "@playwright/test";
import path from "node:path";

async function main() {
  const url = process.env.LEARNER_URL ?? "http://localhost:3100/learn/u_139efbb4";
  const out = path.join(process.cwd(), "screenshots");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, "16-progress-panel-large.png"), fullPage: false });
  console.log("saved 16-progress-panel-large.png");
  // also capture right panel close-up
  const rail = page.locator("[data-test-id='progress-panel']").first();
  if (await rail.count()) {
    await rail.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, "17-progress-panel-zoom.png"), clip: { x: 1000, y: 0, width: 680, height: 1050 } });
    console.log("saved 17-progress-panel-zoom.png");
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
