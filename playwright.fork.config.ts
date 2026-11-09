import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3210);

// Runs against real contracts on the local fork. Start it first with npm run fork:up.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: ["**/fork.spec.ts"],
  outputDir: "./test-results/fork",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalSetup: "./test/e2e/fork-setup.ts",
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node scripts/fork/dev.mjs",
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { PORT: String(port) },
  },
});
