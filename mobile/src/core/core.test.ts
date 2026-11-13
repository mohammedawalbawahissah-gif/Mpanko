import { describe, expect, it } from "vitest";
import { fieldHints, type AddressRules } from "./addressRules";
import { pickLanguage, translate } from "./i18n";
import { LANGUAGES, MESSAGES } from "./locales";
import { convert, formatMoney, rateOf, searchCurrencies, type Rates } from "./money";
import { buildReport, makeDeduper } from "./report";
import { fetchWithCache, isOffline, MAX_AGE_MS, readCached, type KeyValueStore } from "./cache";

const rates: Rates = {
  base: "USD",
  rates: { GHS: "15", EUR: "0.9", JPY: "150", XOF: "600" },
  currencies: ["USD", "GHS", "EUR", "JPY", "XOF"],
  names: { USD: "US Dollar", GHS: "Ghanaian Cedi", EUR: "Euro", JPY: "Japanese Yen", XOF: "West African CFA Franc" },
  chargeable: ["USD", "GHS"],
};

describe("i18n", () => {
  it("translates and fills placeholders", () => {
    expect(translate("fr", "tab.bag")).not.toBe("");
    expect(translate("en", "shop.pricesIn", { currency: "GHS" })).toBe("Prices in GHS");
    expect(translate("en", "shop.pricesIn")).toBe("Prices in {currency}");
  });
  it("falls back to English for an unknown language", () => {
    expect(translate("xx", "shop.search")).toBe("Search products");
  });
  it("picks the first supported device language", () => {
    expect(pickLanguage(["de-DE", "fr_CA"])).toBe("fr");
    expect(pickLanguage(["ja-JP"])).toBe("en");
    expect(pickLanguage([])).toBe("en");
  });
  it.each(LANGUAGES.map((l) => l.code))("%s has every English key with the same placeholders", (code) => {
    const en = MESSAGES.en as Record<string, string>;
    const other = MESSAGES[code] as Record<string, string>;
    const vars = (t: string) => (t.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(en)) {
      expect(other[k], `${code} is missing ${k}`).toBeDefined();
      expect(vars(other[k])).toBe(vars(en[k]));
    }
  });
});

describe("money", () => {
  it("converts through the base currency", () => {
    expect(convert(rates, 10, "USD", "GHS")).toBeCloseTo(150);
    expect(convert(rates, 150, "GHS", "USD")).toBeCloseTo(10);
    expect(convert(rates, 15, "GHS", "EUR")).toBeCloseTo(0.9);
  });
  it("leaves the amount alone when it cannot convert", () => {
    expect(convert(null, 10, "USD", "GHS")).toBe(10);
    expect(convert(rates, 10, "USD", "ZZZ")).toBe(10);
    expect(convert(rates, 10, "USD", "")).toBe(10);
    expect(rateOf(rates, "ZZZ")).toBeNull();
  });
  it("formats with the currency symbol, or the code if the phone does not know the currency", () => {
    expect(formatMoney(40, "USD", "en-US")).toBe("$40.00");
    expect(formatMoney(40, "ZZZZ", "en")).toBe("ZZZZ 40.00");
  });
  it("searches by code or name, best matches first", () => {
    expect(searchCurrencies(rates, "")).toEqual(["USD", "GHS"]);
    expect(searchCurrencies(rates, "ghs")[0]).toBe("GHS");
    expect(searchCurrencies(rates, "franc")).toEqual(["XOF"]);
    expect(searchCurrencies(rates, "zzz")).toEqual([]);
    expect(searchCurrencies(null, "usd")).toEqual([]);
  });
});

describe("address hints", () => {
  const us: AddressRules = { country: "US", postal_code: "required", region_required: true, region_label: "State", postal_example: "90210" };
  it("shows what a country needs", () => {
    const h = fieldHints(us);
    expect(h.showPostal).toBe(true);
    expect(h.postalLabel).toBe("address.postalRequired");
    expect(h.regionLabel).toBe("State");
    expect(h.postalPlaceholder).toBe("90210");
  });
  it("hides the postal code where the country has none, and marks optional regions", () => {
    const h = fieldHints({ ...us, country: "AE", postal_code: "none", region_required: false, region_label: "Emirate" });
    expect(h.showPostal).toBe(false);
    expect(h.regionLabel).toBe("Emirate (optional)");
  });
  it("is permissive while the rules load", () => {
    expect(fieldHints(null).showPostal).toBe(true);
  });
});

describe("crash reports", () => {
  it("builds a bounded report", () => {
    const r = buildReport(new Error("boom"), "in Checkout", "Checkout", "1.0.0");
    expect(r.source).toBe("mobile");
    expect(r.message).toBe("Error: boom");
    expect(r.url).toBe("Checkout");
    expect(buildReport("x".repeat(9000)).message.length).toBeLessThanOrEqual(500);
    expect(buildReport(new Error("x"), "y".repeat(9000)).stack.length).toBeLessThanOrEqual(4000);
  });
  it("sends the same message only once, and stops at the limit", () => {
    const ok = makeDeduper(2);
    expect(ok(buildReport(new Error("a")))).toBe(true);
    expect(ok(buildReport(new Error("a")))).toBe(false);
    expect(ok(buildReport(new Error("b")))).toBe(true);
    expect(ok(buildReport(new Error("c")))).toBe(false);
  });
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

describe("offline catalog cache", () => {
  const offline = Object.assign(new Error("Can't reach Mpanko."), { status: 0 });
  const serverError = Object.assign(new Error("Server error"), { status: 500 });

  it("returns fresh data and saves a copy", async () => {
    const store = memoryStore();
    const r = await fetchWithCache(store, "products", async () => ({ n: 1 }), () => 1000);
    expect(r).toEqual({ data: { n: 1 }, savedAt: 1000, stale: false });
    expect((await readCached(store, "products", 2000))?.data).toEqual({ n: 1 });
  });
  it("falls back to the saved copy only when the connection is down", async () => {
    const store = memoryStore();
    await fetchWithCache(store, "products", async () => ({ n: 1 }), () => 1000);
    const r = await fetchWithCache(store, "products", async () => { throw offline; }, () => 5000);
    expect(r).toEqual({ data: { n: 1 }, savedAt: 1000, stale: true });
    await expect(fetchWithCache(store, "products", async () => { throw serverError; }, () => 5000)).rejects.toBe(serverError);
  });
  it("throws the original error when nothing was saved", async () => {
    await expect(fetchWithCache(memoryStore(), "x", async () => { throw offline; })).rejects.toBe(offline);
  });
  it("does not show copies that are too old, from the future, or damaged", async () => {
    const store = memoryStore();
    await fetchWithCache(store, "a", async () => 1, () => 1000);
    expect(await readCached(store, "a", 1000 + MAX_AGE_MS + 1)).toBeNull();
    await fetchWithCache(store, "future", async () => 2, () => 1_000_000);
    expect(await readCached(store, "future", 1)).toBeNull();
    store.data.set("mpanko.cache.b", "{broken");
    expect(await readCached(store, "b")).toBeNull();
  });
  it("keeps separate copies per key, and survives a failing disk", async () => {
    const store = memoryStore();
    await fetchWithCache(store, "cat=1", async () => "one", () => 1);
    await fetchWithCache(store, "cat=2", async () => "two", () => 1);
    expect((await readCached<string>(store, "cat=2", 2))?.data).toBe("two");
    const broken: KeyValueStore = { getItem: async () => { throw new Error("x"); }, setItem: async () => { throw new Error("x"); }, removeItem: async () => undefined };
    const r = await fetchWithCache(broken, "k", async () => 7);
    expect(r.data).toBe(7);
  });
  it("recognises connection failures", () => {
    expect(isOffline(offline)).toBe(true);
    expect(isOffline(serverError)).toBe(false);
    expect(isOffline(null)).toBe(false);
  });
});
