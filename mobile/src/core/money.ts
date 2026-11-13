export interface Rates {
  base: string;
  rates: Record<string, string>;
  currencies: string[];
  names?: Record<string, string>;
  chargeable?: string[];
}

/** Units of `code` per 1 unit of the base currency, or null if we hold no rate for it. */
export function rateOf(rates: Rates, code: string): number | null {
  if (code === rates.base) return 1;
  const n = Number(rates.rates[code]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Convert between any two currencies we hold rates for. Returns the amount unchanged if either rate is missing. */
export function convert(rates: Rates | null, amount: number, from: string, to: string): number {
  if (!rates || !to || from === to) return amount;
  const rFrom = rateOf(rates, from);
  const rTo = rateOf(rates, to);
  return rFrom && rTo ? (amount / rFrom) * rTo : amount;
}

/** "$40.00", "GH₵450.00" ... using the phone's own formatting; plain "CODE 40.00" if the currency is unknown to it. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Currencies whose code or name contains the text, best matches first. */
export function searchCurrencies(rates: Rates | null, query: string, limit = 8): string[] {
  if (!rates) return [];
  const q = query.trim().toLowerCase();
  if (!q) return rates.chargeable?.length ? rates.chargeable.slice(0, limit) : rates.currencies.slice(0, limit);
  const scored = rates.currencies.flatMap((code) => {
    const name = (rates.names?.[code] ?? "").toLowerCase();
    const c = code.toLowerCase();
    const score = c === q ? 0 : c.startsWith(q) ? 1 : name.startsWith(q) ? 2 : c.includes(q) || name.includes(q) ? 3 : -1;
    return score < 0 ? [] : [{ code, score }];
  });
  return scored.sort((a, b) => a.score - b.score || a.code.localeCompare(b.code)).slice(0, limit).map((x) => x.code);
}
