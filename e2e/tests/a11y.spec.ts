import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Automated WCAG 2.2 A/AA checks. These catch the mechanical failures (contrast, names, labels, landmarks);
// they do not replace a manual screen-reader and keyboard pass.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n   ")}`);
  expect(summary, `accessibility problems on ${label}`).toEqual([]);
}

const PUBLIC = ["/", "/shop", "/shop/kente-scarf", "/bag", "/login", "/register", "/forgot-password", "/orders/find", "/does-not-exist", "/privacy", "/terms", "/returns-policy", "/cookies"];

for (const path of PUBLIC) {
  test(`web ${path} has no automated accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await scan(page, path);
  });
}

test("signed-in web pages have no automated accessibility violations", async ({ page }) => {
  test.setTimeout(180_000); // registers, then scans five pages; slow computers need longer than the 60 s default
  const email = `a11y-${Date.now()}@example.com`;
  await page.goto("/shop/kente-scarf");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.goto("/register?next=/checkout");
  await page.getByLabel("Full name").fill("A11y Shopper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill("A11y-pass-12345");
  await page.getByLabel(/I accept the/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  // Match the path, not the whole address: the register page is /register?next=/checkout and also contains "/checkout".
  await page.waitForURL((url) => url.pathname === "/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await scan(page, "/checkout");
  for (const path of ["/account", "/orders", "/support", "/support/new"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await scan(page, path);
  }
});

test("the language picker still passes after switching language", async ({ page }) => {
  await page.goto("/shop");
  await page.getByLabel(/language/i).first().selectOption("fr");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await scan(page, "/shop in French");
});

// --- staff dashboard ------------------------------------------------------------------------------------------
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";

test("admin sign-in page has no automated accessibility violations", async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await page.waitForLoadState("networkidle");
  await scan(page, "admin /login");
});

test("admin pages have no automated accessibility violations", async ({ page }) => {
  test.setTimeout(240_000); // nineteen pages
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill("admin@mpanko.test");
  await page.getByLabel("Password").fill("Mpanko-demo-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 15_000 });
  for (const path of ["/", "/orders", "/returns", "/support", "/customers", "/coupons", "/pages", "/staff", "/audit", "/security", "/shipments", "/shipping-rules", "/products", "/stock", "/reports", "/emails", "/chargebacks", "/tax", "/reconciliation"]) {
    await page.goto(`${ADMIN}${path}`);
    await page.waitForLoadState("networkidle");
    await scan(page, `admin ${path}`);
  }
});
