import { expect, test, type Page } from "@playwright/test";

// The phone and tablet designs: a bottom bar and a Filters button on phones, no phone-only controls on tablets,
// and admin tables that turn into labelled cards on a phone.
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";

async function signInToShop(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("customer@mpanko.test");
  await page.getByLabel(/^Password/).fill("Mpanko-demo-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("link", { name: "Account" }).or(page.getByRole("navigation", { name: "Quick links" }).getByRole("link", { name: "Account" })).first()).toBeVisible({ timeout: 15_000 });
}

async function signInToAdmin(page: Page) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill("admin@mpanko.test");
  await page.getByLabel("Password").fill("Mpanko-demo-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("the main links sit in a bar along the bottom, within reach of a thumb", async ({ page }) => {
    await signInToShop(page);
    const bar = page.getByRole("navigation", { name: "Quick links" });
    await bar.getByRole("link", { name: "Shop" }).click(); // the sign-in lasts until the page is reloaded, so move around inside the app
    await expect(bar).toBeVisible();
    for (const name of ["Shop", "My orders", "Help", "Account"]) await expect(bar.getByRole("link", { name })).toBeVisible();
    const box = await bar.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(790);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  });

  test("the currency and language choices are always in view, with no Menu button", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
    await expect(page.getByLabel("Language")).toBeVisible();
  });

  test("categories and sorting open from a Filters button", async ({ page }) => {
    await page.goto("/shop");
    const toggle = page.getByRole("button", { name: /^Filters/ });
    await expect(page.getByLabel("Sort by")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Sort by")).toBeVisible();
  });

  test("an admin table becomes a stack of cards with each value labelled", async ({ page }) => {
    await signInToAdmin(page);
    await page.goto(`${ADMIN}/orders`);
    const first = page.locator("table.table tbody tr").first();
    await expect(first).toBeVisible();
    await expect(first.locator("td").first()).toHaveAttribute("data-label", /Order/i);
    expect(await first.evaluate((el) => getComputedStyle(el).display)).toBe("block");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 1100 } });

  test("the shop keeps the full header and has no phone-only controls", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("navigation", { name: "Quick links" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Filters/ })).toBeHidden();
    await expect(page.getByLabel("Sort by")).toBeVisible();
    await expect(page.getByLabel("Language")).toBeVisible();
  });

  test("the admin menu opens as a panel and closes with Escape", async ({ page }) => {
    await signInToAdmin(page);
    await page.goto(`${ADMIN}/orders`);
    const menu = page.getByRole("button", { name: "Menu" });
    await menu.click();
    await expect(page.getByRole("link", { name: "Products" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Products" })).toBeHidden();
  });
});
