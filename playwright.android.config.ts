import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.ANDROID_TEST_PORT || 4174);

export default defineConfig({
  testDir: "./e2e/android",
  timeout: 120000,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Pixel 5"],
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL,
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15000,
  },
  webServer: {
    command: `yarn vite preview --mode android --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
