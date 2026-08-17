import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/browser",
  testMatch: ["**/*.electron.real.spec.ts"],
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "electron-packaged" }],
});
