import { expect, test } from "@playwright/test";

const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;
const password = "E2e-pass-12345";

test("a new shopper browses, registers, pays and sees the order", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: /shop/i }).first()).toBeVisible();
  await page.getByRole("link", { name: /kente scarf/i }).first().click();
  await expect(page).toHaveURL(/\/shop\/kente-scarf/);
  await expect(page).toHaveTitle(/Kente/i);

  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.goto("/register?next=/checkout");
  await page.getByLabel("Full name").fill("E2E Shopper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel(/I accept the/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.waitForLoadState("networkidle"); // the form remounts once the saved addresses load
  await page.getByLabel("Full name").fill("E2E Shopper");
  await expect(page.getByLabel("Full name")).toHaveValue("E2E Shopper");
  await page.getByLabel("Phone number for the courier").fill("+233200000001");
  await page.getByLabel("Country", { exact: true }).selectOption("GH");
  await page.getByLabel("Street address").fill("1 Test Road");
  await page.getByLabel("Town or city").fill("Tamale");
  await page.getByLabel(/^Region/).fill("Northern");
  await page.getByRole("button", { name: "Save address" }).click();

  const delivery = page.getByRole("radiogroup", { name: "Delivery" }).getByRole("radio").first();
  await expect(delivery).toBeVisible({ timeout: 15_000 });
  await delivery.check();
  await page.getByRole("radio", { name: /Test payment/ }).check();
  await page.getByLabel(/I accept the terms of sale/).check();
  const pay = page.getByRole("button", { name: "Pay now" });
  await expect(pay).toBeEnabled({ timeout: 15_000 });
  await pay.click();

  await expect(page.getByRole("heading", { name: /your order is confirmed/i })).toBeVisible({ timeout: 20_000 });
  await page.goto("/orders");
  await expect(page.getByRole("link", { name: /^MP-/ }).first()).toBeVisible();
});

test("policy pages and cookie notice work without signing in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Cookie notice" })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("region", { name: "Cookie notice" })).toBeHidden();
  for (const [path, heading] of [["/privacy", /privacy policy/i], ["/terms", /terms of sale/i], ["/returns-policy", /returns policy/i]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("registration needs the terms ticked", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("No Terms");
  await page.getByLabel("Email").fill(`noterms-${stamp}@example.com`);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/accept the terms and privacy policy/i)).toBeVisible();
});
