import { defineConfig, devices } from "@playwright/test";

// The API must already be running (see README): DEBUG=true with `python manage.py seed_demo` run once.
const WEB = process.env.E2E_WEB_URL ?? "http://localhost:5173";
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // CI installs Playwright's own Chromium; locally we can reuse an installed Chrome with E2E_CHANNEL=chrome.
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
  // `E2E_ALL_BROWSERS=1` also runs Firefox, Safari (WebKit) and a phone-sized Chrome. See docs/SUPPORT-MATRIX.md.
  projects: process.env.E2E_ALL_BROWSERS
    ? [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
      ]
    : undefined,
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : [
        { command: "npm run dev --prefix ../web", url: WEB, reuseExistingServer: true, timeout: 60_000 },
        { command: "npm run dev --prefix ../admin", url: ADMIN, reuseExistingServer: true, timeout: 60_000 },
      ],
});
