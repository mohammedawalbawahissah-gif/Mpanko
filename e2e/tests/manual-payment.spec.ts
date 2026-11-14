import { expect, test } from "@playwright/test";

const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";

// Needs the API started with GUEST_CHECKOUT_ENABLED=true and PAYMENT_PROVIDERS_ENABLED=mock,zelle (and ZELLE_RECIPIENT set).
// Skips itself when Zelle is not offered.
test("a shopper pays by Zelle and finance confirms the payment in the admin", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/shop/kente-scarf");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.goto("/bag");
  await page.waitForLoadState("networkidle");
  const guestButton = page.getByRole("button", { name: "Check out as a guest" });
  test.skip(!(await guestButton.isVisible()), "Guest checkout is off on this API");
  await guestButton.click();
  await page.getByLabel(/Email for your receipt/).fill(`zelle-${Date.now()}@example.com`);
  await page.getByLabel("Full name").fill("Zelle Shopper");
  await page.getByLabel("Phone number for the courier").fill("+12025550123");
  await page.getByLabel("Country", { exact: true }).selectOption("US");
  await page.getByLabel("Street address").fill("1 Main Street");
  await page.getByLabel("Town or city").fill("Austin");
  await page.getByLabel(/^Region|^State/).fill("TX");
  await page.getByLabel(/ZIP|Postal/i).fill("73301");
  await page.getByRole("button", { name: "Use this address" }).click();
  const delivery = page.getByRole("radiogroup", { name: "Delivery" }).getByRole("radio").first();
  await expect(delivery).toBeVisible({ timeout: 15_000 });
  await delivery.check();
  const zelle = page.getByRole("radio", { name: /Zelle/ });
  test.skip(!(await zelle.isVisible()), "Zelle is not enabled on this API");
  await zelle.check();
  await page.getByLabel(/I accept the terms of sale/).check();
  const duties = page.getByLabel(/duties|import/i);
  if (await duties.first().isVisible().catch(() => false)) await duties.first().check().catch(() => undefined);
  const pay = page.getByRole("button", { name: "Pay now" });
  await expect(pay).toBeEnabled({ timeout: 15_000 });
  await pay.click();

  // The shopper is told how to pay and that the order is waiting, not "paid".
  await expect(page.getByRole("heading", { name: "Pay to finish your order" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Send exactly USD/)).toBeVisible();
  const instructions = (await page.getByText(/Send exactly USD/).textContent()) ?? "";
  const number = instructions.match(/MP-[A-Z0-9-]+/)?.[0];
  const amount = instructions.match(/USD ([0-9.]+)/)?.[1];
  expect(number && amount).toBeTruthy();

  // Finance sees it, a wrong amount is refused, the right amount marks the order paid.
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill("admin@mpanko.test");
  await page.getByLabel("Password").fill("Mpanko-demo-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`${ADMIN}/manual-payments`);
  const row = page.getByRole("row", { name: new RegExp(number!) });
  await expect(row).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await row.getByLabel(/Amount received/).fill("0.01");
  await row.getByRole("button", { name: "Payment received" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await row.getByLabel(/Amount received/).fill(amount!);
  await row.getByRole("button", { name: "Payment received" }).click();
  await expect(page.getByText(`Order ${number} is paid.`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("row", { name: new RegExp(number!) })).toHaveCount(0);
});
