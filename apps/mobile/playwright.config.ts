import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Tests inside a file run in order, but files run side by side. Every spec
  // creates its own uniquely named E2E content, and each test gets its own
  // browser contexts (and so its own localStorage cart), so files don't
  // interfere even though they share the two fixture accounts.
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "../../output/playwright/test-results",
  reporter: process.env.CI
    ? [
        ["line"],
        [
          "html",
          { outputFolder: "../../output/playwright/report", open: "never" },
        ],
      ]
    : [
        ["list"],
        [
          "html",
          { outputFolder: "../../output/playwright/report", open: "never" },
        ],
      ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:8081",
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 430, height: 932 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Recording video for every test (and discarding it on a pass) is
    // measurable overhead; the trace already captures a failing run.
    video: process.env.CI ? "on-first-retry" : "off",
    // Without this, a bare .click()/.fill() on a locator that never
    // resolves retries until the whole-test timeout (90s) instead of
    // failing with a clear "element not found" error.
    actionTimeout: 20_000,
  },
  projects: [
    // Signs each fixture account in through the UI once and saves the
    // session for `newSignedInPage` to reuse (see e2e/auth.setup.ts).
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    { name: "mobile-web", dependencies: ["setup"] },
  ],
});
