import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuData } from "./types";

const add = vi.fn(async () => undefined);
const menu: MenuData = {
  category: { name: "QT Eatery", slug: "qt-eatery", parent: "Food" },
  note: "All orders are made by request only.",
  orderable_count: 2,
  sections: [
    { name: "Pastries", items: [
      { slug: "qt-eatery-fish-pie", name: "Fish Pie", description: "All pies with your choice of fry or bake.", orderable: true, currency: "USD", lead_time_days: 1, variants: [{ id: 11, sku: "A", name: "", price: "7.50" }] },
      { slug: "qt-eatery-meat-pie", name: "Meat Pie", description: "", orderable: false, currency: "USD", lead_time_days: 1, variants: [] },
    ] },
    { name: "Drinks", items: [
      { slug: "qt-eatery-sobolo", name: "Sobolo Juice", description: "", orderable: true, currency: "USD", lead_time_days: 1, variants: [{ id: 21, sku: "S", name: "Small", price: "3.00" }, { id: 22, sku: "L", name: "Large", price: "5.00" }] },
    ] },
    { name: "Unpriced section", items: [{ slug: "x", name: "Not yet", description: "", orderable: false, currency: "USD", lead_time_days: null, variants: [] }] },
  ],
};

vi.mock("./api", () => ({ api: vi.fn(async () => menu), ApiError: class extends Error {} }));
vi.mock("./context", () => ({
  useCart: () => ({ add, lines: [{ quantity: 2 }, { quantity: 1 }] }),
  useCurrency: () => ({ money: (a: string) => `$${Number(a).toFixed(2)}` }),
}));

async function show() {
  const { MenuPage } = await import("./pages-menu");
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/menu/qt-eatery"]}><Routes><Route path="menu/:slug" element={<MenuPage />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); });
  return el;
}

describe("menu order page", () => {
  beforeEach(() => { add.mockClear(); document.body.innerHTML = ""; (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it("shows only dishes that can be ordered, in their sections, with prices", async () => {
    const el = await show();
    expect(el.querySelector("h1")?.textContent).toBe("QT Eatery menu");
    expect(el.textContent).toContain("Fish Pie");
    expect(el.textContent).toContain("$7.50");
    expect(el.textContent).toContain("Sobolo Juice");
    expect(el.textContent).not.toContain("Meat Pie");
    expect(el.textContent).not.toContain("Unpriced section");
    expect([...el.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Pastries", "Drinks"]);
    expect(el.textContent).toContain("All orders are made by request only.");
  });

  it("adds the chosen quantity and option to the bag, and offers checkout", async () => {
    const el = await show();
    const fish = el.querySelector("#dish-qt-eatery-fish-pie") as HTMLElement;
    const plus = fish.querySelector('button[aria-label^="Increase"]') as HTMLButtonElement;
    await act(async () => { plus.click(); });
    const addBtn = [...fish.querySelectorAll("button")].find((b) => b.textContent === "Add") as HTMLButtonElement;
    await act(async () => { addBtn.click(); });
    expect(add).toHaveBeenCalledWith({ name: "Fish Pie", slug: "qt-eatery-fish-pie", currency: "USD" }, expect.objectContaining({ id: 11 }), 2);
    expect(el.textContent).toContain("Added 2 × Fish Pie to your bag.");
    expect(el.textContent).toContain("3 items in your bag");
    expect(el.querySelector('a[href="/bag"]')?.textContent).toContain("check out");
  });

  it("lets the buyer pick between options of one dish", async () => {
    const el = await show();
    const sobolo = el.querySelector("#dish-qt-eatery-sobolo") as HTMLElement;
    const select = sobolo.querySelector("select") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    await act(async () => { select.value = "22"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const addBtn = [...sobolo.querySelectorAll("button")].find((b) => b.textContent === "Add") as HTMLButtonElement;
    await act(async () => { addBtn.click(); });
    expect(add).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 22 }), 1);
  });
});
