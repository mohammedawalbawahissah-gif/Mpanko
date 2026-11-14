import { expect, test, type Page } from "@playwright/test";

const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";

// Needs the API started with GUEST_CHECKOUT_ENABLED=true and `seed_demo` run once; otherwise these tests skip.

async function placeGuestOrder(page: Page): Promise<string | null> {
  await page.goto("/shop/kente-scarf");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.goto("/bag");
  await page.waitForLoadState("networkidle");
  const guestButton = page.getByRole("button", { name: "Check out as a guest" });
  if (!(await guestButton.isVisible())) return null;
  await guestButton.click();
  await page.getByLabel(/Email for your receipt/).fill(`admin-journey-${Date.now()}@example.com`);
  await page.getByLabel("Full name").fill("Journey Shopper");
  await page.getByLabel("Phone number for the courier").fill("+233200000003");
  await page.getByLabel("Country", { exact: true }).selectOption("GH");
  await page.getByLabel("Street address").fill("3 Test Road");
  await page.getByLabel("Town or city").fill("Tamale");
  await page.getByLabel(/^Region/).selectOption("Northern");
  await page.getByRole("button", { name: "Use this address" }).click();
  const delivery = page.getByRole("radiogroup", { name: "Delivery" }).getByRole("radio").first();
  await expect(delivery).toBeVisible({ timeout: 15_000 });
  await delivery.check();
  await page.getByRole("radio", { name: /Test payment/ }).check();
  await page.getByLabel(/I accept the terms of sale/).check();
  const pay = page.getByRole("button", { name: "Pay now" });
  await expect(pay).toBeEnabled({ timeout: 15_000 });
  await pay.click();
  await expect(page.getByRole("heading", { name: /your order is confirmed/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "View your order" }).click();
  const heading = page.getByRole("heading", { name: /^Order MP-/ });
  await expect(heading).toBeVisible();
  const text = (await heading.textContent()) ?? "";
  return text.match(/MP-[A-Z0-9-]+/)?.[0] ?? null;
}

async function signInToAdmin(page: Page, email = "admin@mpanko.test", password = "Mpanko-demo-123") {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 15_000 });
}

test("a wrong admin password is refused with a clear message", async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill("admin@mpanko.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("an admin finds a paid order and refunds it in full", async ({ page }) => {
  test.setTimeout(120_000);
  const number = await placeGuestOrder(page);
  test.skip(!number, "Guest checkout is off on this API");

  await signInToAdmin(page);
  await page.goto(`${ADMIN}/orders`);
  await page.getByLabel("Order number or email").fill(number!);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: number! }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Order ${number}`) })).toBeVisible();

  // The refund form asks for confirmation before it moves money.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue refund" }).click();
  // A full refund moves the order to Refunded, closes the refund form and writes a history entry.
  await expect(page.getByRole("heading", { level: 1, name: /Refunded/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Issue refund" })).toHaveCount(0);
  await expect(page.getByText(/Fully refunded/)).toBeVisible();
});

test("an admin can decline the refund confirmation and nothing changes", async ({ page }) => {
  test.setTimeout(120_000);
  const number = await placeGuestOrder(page);
  test.skip(!number, "Guest checkout is off on this API");

  await signInToAdmin(page);
  await page.goto(`${ADMIN}/orders/${number}`);
  await expect(page.getByRole("heading", { name: new RegExp(`Order ${number}`) })).toBeVisible();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Issue refund" }).click();
  await expect(page.getByText(/Refund of .* is /)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Issue refund" })).toBeVisible();
});

test("the admin orders list shows an empty state for a search with no match", async ({ page }) => {
  await signInToAdmin(page);
  await page.goto(`${ADMIN}/orders`);
  await page.getByLabel("Order number or email").fill("no-such-order-anywhere");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No orders match.")).toBeVisible();
});
