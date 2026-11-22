import { defineConfig, devices } from "@playwright/test";

/**
 * All end-to-end tests run at a phone viewport (390×844, touch) — the app is phone-first.
 * The "desktop" project runs the desktop-specific spec.
 * They need a running app connected to Supabase (see README → Tests).
 */
const proxy = process.env.E2E_BROWSER_PROXY ? { server: process.env.E2E_BROWSER_PROXY, bypass: "localhost,127.0.0.1" } : undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    launchOptions: proxy ? { proxy } : {},
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: "phone",
      testIgnore: /desktop\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: "desktop",
      testMatch: /desktop\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 180_000 },
});
