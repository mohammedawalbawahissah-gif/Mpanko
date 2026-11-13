import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, getTokens, setTokens, type Tokens } from "./api";
import type { Product, ServerCartItem, User, Variant } from "./types";

/* ------------------------------------------------------------------ Auth */

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse extends Tokens {
  user: User;
  mfa_required?: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!getTokens()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<User>("/auth/me/"));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    reload().finally(() => setReady(true));
    const onOut = () => setUser(null);
    window.addEventListener("mpanko:signed-out", onOut);
    return () => window.removeEventListener("mpanko:signed-out", onOut);
  }, [reload]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<LoginResponse>("/auth/login/", { method: "POST", body: { email, password } });
    if (data.mfa_required || !data.access) {
      throw new ApiError(400, { detail: "Staff accounts sign in at the admin dashboard." });
    }
    setTokens({ access: data.access, refresh: data.refresh });
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      await api("/auth/register/", { method: "POST", body: { email, password, full_name: fullName } });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    const tokens = getTokens();
    if (tokens) {
      try {
        await api("/auth/logout/", { method: "POST", body: { refresh: tokens.refresh } });
      } catch {
        /* token may already be invalid; signing out locally is what matters */
      }
    }
    setTokens(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, register, logout, reload }), [user, ready, login, register, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/* -------------------------------------------------------------- Currency */

interface RatesResponse {
  base: string;
  rates: Record<string, string>;
  currencies: string[];
}

interface CurrencyState {
  currency: string;
  currencies: string[];
  setCurrency: (c: string) => void;
  /** Convert an amount quoted in `from` into the shopper's currency and format it. */
  money: (amount: string | number, from?: string) => string;
  /** Same conversion as `money` but returns the number, so lines can be summed before formatting. */
  toNumber: (amount: string | number, from?: string) => number;
  /** Format an amount that is already in `currency` (orders, checkout totals). */
  exact: (amount: string | number, currency: string) => string;
  isBase: boolean;
}

const CurrencyContext = createContext<CurrencyState | null>(null);
const CURRENCY_KEY = "mpanko.currency";

function format(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<RatesResponse>({ base: "USD", rates: { USD: "1" }, currencies: ["USD"] });
  const [currency, setCurrencyState] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENCY_KEY) ?? "USD";
    } catch {
      return "USD";
    }
  });

  useEffect(() => {
    api<RatesResponse>("/currency/rates/")
      .then((r) => {
        setRates(r);
        setCurrencyState((c) => (r.currencies.includes(c) ? c : r.base));
      })
      .catch(() => undefined); // keep base-currency display if rates cannot load
  }, []);

  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<CurrencyState>(() => {
    const rate = (code: string) => Number(rates.rates[code] ?? (code === rates.base ? 1 : NaN));
    return {
      currency,
      currencies: rates.currencies,
      setCurrency,
      isBase: currency === rates.base,
      toNumber: (amount, from = rates.base) => {
        const fromRate = rate(from);
        const toRate = rate(currency);
        const n = Number(amount);
        return isFinite(fromRate) && isFinite(toRate) ? (n / fromRate) * toRate : n;
      },
      money: (amount, from = rates.base) => {
        const n = Number(amount);
        const fromRate = rate(from);
        const toRate = rate(currency);
        if (!isFinite(fromRate) || !isFinite(toRate)) return format(n, from);
        return format((n / fromRate) * toRate, currency);
      },
      exact: (amount, code) => format(Number(amount), code),
    };
  }, [rates, currency, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyState {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency outside CurrencyProvider");
  return ctx;
}

/* ------------------------------------------------------------------ Cart */

export interface CartLine {
  key: string;
  variantId: number;
  sku: string;
  name: string;
  variantName: string;
  unitPrice: string;
  currency: string;
  quantity: number;
  slug?: string;
  serverId?: number;
}

interface CartState {
  lines: CartLine[];
  count: number;
  busy: boolean;
  add: (product: Product, variant: Variant, quantity: number) => Promise<void>;
  setQuantity: (line: CartLine, quantity: number) => Promise<void>;
  remove: (line: CartLine) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartState | null>(null);
const GUEST_CART_KEY = "mpanko.guestCart";

function readGuest(): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(GUEST_CART_KEY) ?? "[]") as CartLine[];
  } catch {
    return [];
  }
}

function writeGuest(lines: CartLine[]): void {
  try {
    if (lines.length) localStorage.setItem(GUEST_CART_KEY, JSON.stringify(lines));
    else localStorage.removeItem(GUEST_CART_KEY);
  } catch {
    /* ignore */
  }
}

function fromServer(items: ServerCartItem[], previous: CartLine[]): CartLine[] {
  return items.map((i) => {
    const known = previous.find((p) => p.variantId === i.variant);
    return {
      key: `s${i.id}`,
      serverId: i.id,
      variantId: i.variant,
      sku: i.sku,
      name: i.product_name,
      variantName: known?.variantName ?? "",
      unitPrice: i.unit_price,
      currency: i.currency,
      quantity: i.quantity,
      slug: i.product_slug || known?.slug,
    };
  });
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const [lines, setLines] = useState<CartLine[]>(() => readGuest());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setLines(readGuest());
      return;
    }
    const cart = await api<{ items: ServerCartItem[] }>("/cart/");
    setLines((prev) => fromServer(cart.items, prev));
  }, [user]);

  // On sign-in, merge the guest bag into the account's bag once, then switch to the server cart.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      if (user) {
        const guest = readGuest();
        for (const g of guest) {
          try {
            await api("/cart/items/", { method: "POST", body: { variant: g.variantId, quantity: g.quantity } });
          } catch {
            /* item may be unavailable now; skip it */
          }
        }
        if (guest.length) writeGuest([]);
        const cart = await api<{ items: ServerCartItem[] }>("/cart/");
        if (!cancelled) setLines((prev) => fromServer(cart.items, [...prev, ...guest]));
      } else if (!cancelled) {
        setLines(readGuest());
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, ready]);

  const add = useCallback(
    async (product: Product, variant: Variant, quantity: number) => {
      setBusy(true);
      try {
        if (user) {
          const cart = await api<{ items: ServerCartItem[] }>("/cart/items/", { method: "POST", body: { variant: variant.id, quantity } });
          const meta: CartLine = { key: "", variantId: variant.id, sku: variant.sku, name: product.name, variantName: variant.name, unitPrice: variant.price, currency: product.currency, quantity, slug: product.slug };
          setLines((prev) => fromServer(cart.items, [...prev, meta]));
        } else {
          const next = readGuest();
          const found = next.find((l) => l.variantId === variant.id);
          if (found) found.quantity = Math.min(99, found.quantity + quantity);
          else
            next.push({ key: `g${variant.id}`, variantId: variant.id, sku: variant.sku, name: product.name, variantName: variant.name, unitPrice: variant.price, currency: product.currency, quantity, slug: product.slug });
          writeGuest(next);
          setLines(next);
        }
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  const setQuantity = useCallback(
    async (line: CartLine, quantity: number) => {
      if (quantity < 1) return;
      if (user && line.serverId) {
        const cart = await api<{ items: ServerCartItem[] }>(`/cart/items/${line.serverId}/`, { method: "PATCH", body: { quantity } });
        setLines((prev) => fromServer(cart.items, prev));
      } else {
        const next = readGuest().map((l) => (l.variantId === line.variantId ? { ...l, quantity } : l));
        writeGuest(next);
        setLines(next);
      }
    },
    [user],
  );

  const remove = useCallback(
    async (line: CartLine) => {
      if (user && line.serverId) {
        const cart = await api<{ items: ServerCartItem[] }>(`/cart/items/${line.serverId}/`, { method: "DELETE" });
        setLines((prev) => fromServer(cart.items, prev));
      } else {
        const next = readGuest().filter((l) => l.variantId !== line.variantId);
        writeGuest(next);
        setLines(next);
      }
    },
    [user],
  );

  const value = useMemo(
    () => ({ lines, count: lines.reduce((n, l) => n + l.quantity, 0), busy, add, setQuantity, remove, refresh }),
    [lines, busy, add, setQuantity, remove, refresh],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}
