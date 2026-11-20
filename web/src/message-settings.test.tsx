import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cell = (enabled: boolean, extra = {}) => ({ enabled, locked: false, available: true, ...extra });
const data = {
  marketing_opt_in: false, phone_verified: true, has_push_device: false,
  categories: ["orders", "support", "reminders", "offers"].map((category) => ({
    category, label: category,
    channels: { email: cell(true, { locked: category === "orders" || category === "support" }), sms: cell(false), whatsapp: cell(false), push: cell(false, { available: false }) },
  })),
};
const calls: { path: string; method?: string; body?: unknown }[] = [];
vi.mock("./api", () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => { calls.push({ path, ...opts }); return data; }),
  ApiError: class extends Error {},
}));

async function show() {
  const { MessageSettings } = await import("./pages-notifications");
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<MemoryRouter><MessageSettings /></MemoryRouter>); });
  await act(async () => { await Promise.resolve(); });
  return el;
}

beforeEach(() => { calls.length = 0; document.body.innerHTML = ""; });

describe("MessageSettings", () => {
  it("shows every kind of message and marks order and support email as always on", async () => {
    const el = await show();
    expect(el.textContent).toContain("Orders and payments");
    expect(el.textContent).toContain("News and offers");
    expect(el.textContent?.match(/Always on/g)).toHaveLength(2);
    expect((el.querySelector('input[aria-label="News and offers: Text"]') as HTMLInputElement).disabled).toBe(true);
  });

  it("saves a switch straight away", async () => {
    const el = await show();
    const box = el.querySelector('input[aria-label="Reminders and requests: Text"]') as HTMLInputElement;
    await act(async () => { box.click(); });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ categories: { reminders: { sms: true } } });
  });
});
