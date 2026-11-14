import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The corporate site reads its content from the Mpanko API. Start the API with `seed_demo` run once, then the site
// (cd corporate, npm run build, API_URL=http://localhost:8000 PORT=5175 npm start) and set E2E_CORPORATE_URL=http://localhost:5175.
// Without that variable these tests skip.
const CORPORATE = process.env.E2E_CORPORATE_URL;
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";
test.skip(!CORPORATE, "Set E2E_CORPORATE_URL to run the corporate site tests");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PAGES = ["/", "/about", "/businesses", "/businesses/demo-shop", "/contact"];

async function signInToAdmin(page: Page) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill("admin@mpanko.test");
  await page.getByLabel("Password").fill("Mpanko-demo-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 15_000 });
}

for (const path of PAGES) {
  test(`corporate ${path} has no automated accessibility violations`, async ({ page }) => {
    await page.goto(`${CORPORATE}${path}`);
    await page.waitForLoadState("networkidle");
    const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test("the corporate 404 page has no automated accessibility violations", async ({ page }) => {
  const response = await page.goto(`${CORPORATE}/no-such-page`);
  expect(response?.status()).toBe(404);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

for (const [name, width] of [["phone", 375], ["tablet", 768], ["desktop", 1280]] as const) {
  test(`corporate pages do not scroll sideways on a ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of PAGES) {
      await page.goto(`${CORPORATE}${path}`);
      await page.waitForLoadState("networkidle");
      const wider = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(wider, path).toBe(0);
    }
  });
}

test("the page works with the keyboard: skip link first", async ({ page }) => {
  await page.goto(`${CORPORATE}/`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the content" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a business from the API has its own page with a way to enquire about it", async ({ page }) => {
  await page.goto(`${CORPORATE}/businesses`);
  await page.getByRole("link", { name: /Demo shop/ }).first().click();
  await expect(page).toHaveURL(/\/businesses\/demo-shop$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo shop");
  await page.getByRole("link", { name: "Ask about Demo shop" }).click();
  await expect(page.getByLabel("What is it about?")).toHaveValue("demo-shop");
});

test("the contact form explains mistakes and keeps what was typed", async ({ page }) => {
  await page.goto(`${CORPORATE}/contact`);
  await page.getByLabel("Your name").fill("Ama Mensah");
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByLabel("Your message").fill("Short");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Ama Mensah");
  await expect(page.getByText(/valid email/i).first()).toBeVisible();
});

test("a message sent on the website reaches the admin inbox, and staff can mark it handled", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const marker = `E2E enquiry ${Date.now()}`;
  await page.goto(`${CORPORATE}/contact`);
  await page.getByLabel("Your name").fill("Journey Visitor");
  await page.getByLabel("Email", { exact: true }).fill("visitor@example.com");
  await page.getByLabel("Your message").fill(`${marker}: do you ship to Canada?`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();

  const staff = await (await browser.newContext()).newPage();
  await signInToAdmin(staff);
  await staff.getByRole("link", { name: "Enquiries" }).click();
  await staff.getByRole("row", { name: /Journey Visitor/ }).first().getByRole("button", { name: "Open" }).click();
  await expect(staff.getByText(/do you ship to Canada/).first()).toBeVisible();
  await staff.getByLabel(/Internal note/).fill("Replied by email");
  await staff.getByRole("button", { name: "Mark as handled" }).click();
  await staff.getByLabel("Show").selectOption("handled");
  await expect(staff.getByRole("row", { name: /Journey Visitor/ }).first()).toContainText("Handled");
});

test("a business added in the admin appears on the website once published", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `E2E Trading ${Date.now()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const staff = await (await browser.newContext()).newPage();
  await signInToAdmin(staff);
  await staff.getByRole("link", { name: "Businesses" }).click();
  await staff.getByRole("button", { name: "Add a business" }).click();
  await staff.getByLabel("Name", { exact: true }).fill(name);
  await staff.getByLabel("Short summary (shown in the list)").fill("A business added during the end-to-end test.");
  await staff.getByRole("button", { name: "Save business" }).click();
  await expect(staff.getByRole("row", { name: new RegExp(name) })).toContainText("Draft");

  // Drafts are never shown to visitors.
  expect((await page.goto(`${CORPORATE}/businesses/${slug}`))?.status()).toBe(404);

  await staff.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Edit" }).click();
  await staff.getByLabel("Show on the website").check();
  await staff.getByRole("button", { name: "Save business" }).click();
  await expect(staff.getByRole("row", { name: new RegExp(name) })).toContainText("Published");

  // The site remembers an answer for up to a minute, so look for the business on its own page, which was not asked about before.
  await expect.poll(async () => (await page.goto(`${CORPORATE}/businesses/${slug}`))?.status(), { timeout: 90_000, intervals: [2_000] }).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
});
