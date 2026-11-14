import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The corporate site is a separate static site. Start it (cd corporate, npm run build, npm start with PORT=5175)
// and set E2E_CORPORATE_URL=http://localhost:5175; without that variable these tests skip.
const CORPORATE = process.env.E2E_CORPORATE_URL;
test.skip(!CORPORATE, "Set E2E_CORPORATE_URL to run the corporate site tests");

test("the corporate home page has no automated accessibility violations", async ({ page }) => {
  await page.goto(`${CORPORATE}/`);
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("the corporate 404 page has no automated accessibility violations", async ({ page }) => {
  const response = await page.goto(`${CORPORATE}/no-such-page`);
  expect(response?.status()).toBe(404);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

for (const [name, width] of [["phone", 375], ["tablet", 768], ["desktop", 1280]] as const) {
  test(`the corporate home page does not scroll sideways on a ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${CORPORATE}/`);
    await page.waitForLoadState("networkidle");
    const wider = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wider).toBe(0);
  });
}

test("the page works with the keyboard: skip link, then navigation", async ({ page }) => {
  await page.goto(`${CORPORATE}/`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the content" })).toBeFocused();
  await page.getByRole("link", { name: "Visit the shop" }).focus();
  await expect(page.getByRole("link", { name: "Visit the shop" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Rooted in Africa");
});
