import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: false, // shared SQLite DB
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    testIdAttribute: "data-test-id",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // IMPORTANT: e2e uses a separate DB directory so that `rm -rf data` during
  // development does not clobber user-created Blueprints in dev. The setup
  // below runs a shell snippet before dev starts to make the directory.
  webServer: {
    command:
      "mkdir -p ./.e2e-data && LLM_MOCK=1 LL_DB_PATH=./.e2e-data/e2e.db npm run dev",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
