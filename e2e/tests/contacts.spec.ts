import { expect, test, type Page } from "@playwright/test";

// Staff add several WhatsApp numbers, phones and emails in the admin; every one shows as its own button on the shop.
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:5174";

async function signInToAdmin(page: Page) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill("admin@mpanko.test");
  await page.getByLabel("Password").fill("Mpanko-demo-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 15_000 });
}

async function addContact(page: Page, kind: "Phone" | "WhatsApp" | "Email", label: string, value: string) {
  await page.getByRole("button", { name: "Add a contact" }).click();
  await page.getByLabel("Type", { exact: true }).selectOption({ label: kind });
  await page.getByLabel(/country code|Email address,/).fill(value);
  await page.getByLabel(/Name on the button/).fill(label);
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByRole("button", { name: "Add a contact" })).toBeVisible();
}

test("several contacts of each kind show as separate buttons on the shop", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signInToAdmin(page);
  await page.getByRole("link", { name: "Contacts" }).click();
  const added: string[] = [];
  try {
    await addContact(page, "WhatsApp", "Orders", "233200000001"); added.push("233200000001");
    await addContact(page, "WhatsApp", "Wholesale", "233200000002"); added.push("233200000002");
    await addContact(page, "Phone", "Sales", "+233200000003"); added.push("+233200000003");
    await addContact(page, "Email", "Help desk", "help@example.com"); added.push("help@example.com");

    // a second one of a kind without a name is refused, with a clear message
    await page.getByRole("button", { name: "Add a contact" }).click();
    await page.getByLabel("Type", { exact: true }).selectOption({ label: "Email" });
    await page.getByLabel(/Email address,/).fill("other@example.com");
    await page.getByRole("button", { name: "Save contact" }).click();
    await expect(page.getByText(/Give this one a name/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    const shop = await browser.newPage();
    await shop.goto("/");
    const footer = shop.getByRole("contentinfo");
    for (const [name, href] of [["Orders", "https://wa.me/233200000001"], ["Wholesale", "https://wa.me/233200000002"], ["Sales", "tel:+233200000003"], ["Help desk", "mailto:help@example.com"]]) {
      await expect(footer.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
    await shop.close();
  } finally {
    // leave the demo data as it was
    await page.getByRole("link", { name: "Contacts" }).click(); // the sign-in lasts until the page is reloaded, so move around inside the app
    for (let i = 0; i < added.length; i++) {
      const edit = page.getByRole("button", { name: "Edit" }).first();
      if (!(await edit.isVisible().catch(() => false))) break;
      await edit.click();
      await page.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("button", { name: "Add a contact" })).toBeVisible();
    }
  }
});
