import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_START_SERVER === "1"
    ? {
      command: "npm run dev",
      reuseExistingServer: true,
      timeout: 120_000,
      url: baseURL
    }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
