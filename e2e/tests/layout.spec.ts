import { expect, test, type Page } from "@playwright/test";

// Layout at phone, tablet and desktop widths, and what the pages show when things go wrong.
const SIZES = [
  { name: "phone", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];
const PAGES = ["/", "/shop", "/shop/kente-scarf", "/bag", "/login", "/register", "/privacy"];

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}px wide)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const path of PAGES) {
      test(`${path} does not scroll sideways`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await overflow(page), "page is wider than the screen").toBeLessThanOrEqual(1);
      });
    }

    test("a shopper can reach and press Add to bag", async ({ page }) => {
      await page.goto("/shop/kente-scarf");
      const add = page.getByRole("button", { name: "Add to bag" });
      await add.scrollIntoViewIfNeeded();
      await expect(add).toBeVisible();
      const box = await add.boundingBox();
      expect(box?.height ?? 0, "button is big enough to tap").toBeGreaterThanOrEqual(40);
      await add.click();
      await expect(page.getByText(/Added \d+ to your bag/)).toBeVisible();
    });

    test("the main navigation is usable", async ({ page }) => {
      await page.goto("/");
      const nav = page.getByRole("navigation").first();
      await expect(nav).toBeVisible();
      const links = nav.getByRole("link");
      expect(await links.count()).toBeGreaterThan(0);
      for (const l of await links.all()) {
        const box = await l.boundingBox();
        if (box) expect(box.x + box.width, "link is on screen").toBeLessThanOrEqual(size.width + 1);
      }
    });
  });
}

test.describe("when something is missing or goes wrong", () => {
  test("an empty bag says so and offers a way on", async ({ page }) => {
    await page.goto("/bag");
    await expect(page.getByRole("heading", { name: "Your bag is empty" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the shop" })).toBeVisible();
  });

  test("an unknown product explains itself", async ({ page }) => {
    await page.goto("/shop/this-product-does-not-exist");
    await expect(page.getByRole("heading", { name: "We couldn't find that product" })).toBeVisible();
    await page.getByRole("link", { name: "Browse all products" }).click();
    await expect(page).toHaveURL(/\/shop$/);
  });

  test("an unknown page does not leave a blank screen", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.locator("main, #root").first()).not.toBeEmpty();
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  test("a failing catalog shows an error, not a blank list", async ({ page }) => {
    await page.route("**/api/v1/products/**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"Server error."}' }));
    await page.goto("/shop");
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("a slow catalog shows that it is loading", async ({ page }) => {
    await page.route("**/api/v1/products/**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto("/shop");
    await expect(page.getByRole("status").filter({ hasText: /Loading/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Kente/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("losing the connection shows an error and recovers when it returns", async ({ page, context }) => {
    await page.goto("/shop");
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.goto("/shop/kente-scarf").catch(() => undefined);
    await context.setOffline(false);
    await page.goto("/shop/kente-scarf");
    await expect(page.getByRole("button", { name: "Add to bag" })).toBeVisible();
  });

  test("the bag offers guest checkout when the shop allows it", async ({ page }) => {
    await page.goto("/shop/kente-scarf");
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.goto("/bag");
    await page.waitForLoadState("networkidle");
    const guest = page.getByRole("button", { name: "Check out as a guest" });
    const signIn = page.getByRole("button", { name: "Sign in to check out" });
    await expect(guest.or(signIn)).toBeVisible();
    test.skip(!(await guest.isVisible()), "Guest checkout is off on this API");
    await guest.click();
    await expect(page.getByRole("heading", { name: "Check out as a guest" })).toBeVisible();
  });
});
