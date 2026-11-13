import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "./cache";
import {
  addLine, checkoutItems, countItems, GUEST_CART_KEY, isEmail, loadBag, loadGuestOrder, mergeIntoAccount, removeLine, saveBag, saveGuestOrder, setQuantity,
  type GuestLine,
} from "./guestBag";

const line = (id: number, quantity = 1): GuestLine => ({ variantId: id, slug: `p${id}`, name: `Product ${id}`, variantName: "", unitPrice: "10.00", currency: "USD", quantity });

function memory(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => void (data[k] = v), removeItem: async (k) => void delete data[k] };
}

describe("guest bag", () => {
  it("adds, merges the same variant, and caps at 20", () => {
    let l = addLine([], line(1, 2));
    l = addLine(l, line(2));
    l = addLine(l, line(1, 3));
    expect(l.map((x) => [x.variantId, x.quantity])).toEqual([[1, 5], [2, 1]]);
    expect(addLine(l, line(1, 99))[0].quantity).toBe(20);
    expect(countItems(l)).toBe(6);
  });
  it("changes quantity and removes at zero", () => {
    const l = [line(1, 2), line(2)];
    expect(setQuantity(l, 1, 4)[0].quantity).toBe(4);
    expect(setQuantity(l, 1, 0).map((x) => x.variantId)).toEqual([2]);
    expect(removeLine(l, 2).length).toBe(1);
  });
  it("sends only variant and quantity to checkout", () => {
    expect(checkoutItems([line(7, 3)])).toEqual([{ variant: 7, quantity: 3 }]);
  });
  it("validates an email address", () => {
    expect(isEmail(" a@b.co ")).toBe(true);
    expect(isEmail("nope")).toBe(false);
    expect(isEmail("a@b")).toBe(false);
  });
  it("saves and loads, and clears when empty", async () => {
    const store = memory();
    await saveBag(store, [line(1, 2)]);
    expect((await loadBag(store))[0].quantity).toBe(2);
    await saveBag(store, []);
    expect(store.data[GUEST_CART_KEY]).toBeUndefined();
  });
  it("drops unreadable or broken saved data", async () => {
    const store = memory();
    store.data[GUEST_CART_KEY] = "{not json";
    expect(await loadBag(store)).toEqual([]);
    store.data[GUEST_CART_KEY] = JSON.stringify([line(1), { variantId: "x" }, { ...line(2), quantity: 0 }, null]);
    expect((await loadBag(store)).map((x) => x.variantId)).toEqual([1]);
    store.data[GUEST_CART_KEY] = JSON.stringify({ a: 1 });
    expect(await loadBag(store)).toEqual([]);
  });
  it("keeps the guest order link", async () => {
    const store = memory();
    expect(await loadGuestOrder(store)).toBeNull();
    await saveGuestOrder(store, { number: "MP-1", token: "tok" });
    expect(await loadGuestOrder(store)).toEqual({ number: "MP-1", token: "tok" });
    await saveGuestOrder(store, null);
    expect(await loadGuestOrder(store)).toBeNull();
  });
  it("merges into the account and skips lines the shop refuses", async () => {
    const calls: number[] = [];
    const moved = await mergeIntoAccount([line(1), line(2), line(3)], async (id) => {
      if (id === 2) throw new Error("sold out");
      calls.push(id);
    });
    expect(moved).toBe(2);
    expect(calls).toEqual([1, 3]);
  });
});
