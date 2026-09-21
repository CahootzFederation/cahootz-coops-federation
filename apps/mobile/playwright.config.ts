import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
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
    video: "retain-on-failure",
  },
});
