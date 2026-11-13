import { expect, test } from "@playwright/test";

// Needs the API started with GUEST_CHECKOUT_ENABLED=true; otherwise the whole file skips.
test("a visitor checks out as a guest, pays, and finds the order again", async ({ page }) => {
  await page.goto("/shop/kente-scarf");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.goto("/bag");
  await page.waitForLoadState("networkidle");
  const guestButton = page.getByRole("button", { name: "Check out as a guest" });
  test.skip(!(await guestButton.isVisible()), "Guest checkout is off on this API");
  await guestButton.click();

  await expect(page.getByRole("heading", { name: "Check out as a guest" })).toBeVisible();
  const guestEmail = `guest-${Date.now()}@example.com`;
  await page.getByLabel(/Email for your receipt/).fill(guestEmail);
  await page.getByLabel("Full name").fill("Guest Shopper");
  await page.getByLabel("Phone number for the courier").fill("+233200000002");
  await page.getByLabel("Country", { exact: true }).selectOption("GH");
  await page.getByLabel("Street address").fill("2 Test Road");
  await page.getByLabel("Town or city").fill("Tamale");
  await page.getByLabel(/^Region/).fill("Northern");
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
  await expect(page).toHaveURL(/\/orders\/guest\/MP-/);
  await expect(page.getByRole("heading", { name: /^Order MP-/ })).toBeVisible();

  // A bad link explains itself and offers the "find my order" form.
  await page.goto("/orders/guest/MP-NOPE?token=bad");
  await expect(page.getByRole("heading", { name: "This order link isn't valid" })).toBeVisible();
  await page.getByLabel("Order number").fill("MP-NOPE");
  await page.getByLabel(/Email for your receipt/).fill(guestEmail);
  await page.getByRole("button", { name: "Email me the link" }).click();
  await expect(page.getByText(/we have emailed a link/i)).toBeVisible();
});
