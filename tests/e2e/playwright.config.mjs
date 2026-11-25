import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./env.mjs";
import { LAUNCH_ARGS } from "./helpers.mjs";

// One Foundry server and one world for all tests: they run one after another.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  globalSetup: "./global-setup.mjs",
  globalTeardown: "./global-teardown.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "./results",
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1600, height: 1000 },
    launchOptions: { args: LAUNCH_ARGS },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
