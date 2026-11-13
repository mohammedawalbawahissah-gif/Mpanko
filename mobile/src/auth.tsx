import { refreshPushRegistration, unregisterDevice } from "./push";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, getTokens, setSignedOutHandler, setTokens, type Tokens } from "./api";
import { addLine, loadBag, mergeIntoAccount, removeLine, saveBag, setQuantity as setGuestQty, type GuestLine } from "./core/guestBag";
import type { CartItem, User } from "./types";

interface Ctx {
  user: User | null;
  ready: boolean;
  cart: CartItem[];
  login: (email: string, password: string) => Promise<void>;
  /** Ask for an SMS sign-in code; the reply never reveals whether the number has an account. */
  requestPhoneCode: (phone: string) => Promise<void>;
  loginWithPhone: (phone: string, code: string) => Promise<void>;
  /** Re-read the signed-in customer, after a profile change. */
  refreshUser: () => Promise<void>;
  register: (email: string, password: string, fullName: string, marketing?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshCart: () => Promise<void>;
  addToCart: (variantId: number, quantity: number) => Promise<void>;
  setQuantity: (id: number, quantity: number) => Promise<void>;
  removeItem: (id: number) => Promise<void>;
  /** Guest checkout: whether the shop lets visitors buy without an account, and their bag until they do. */
  guestEnabled: boolean;
  guestLines: GuestLine[];
  addGuestLine: (line: GuestLine) => Promise<void>;
  setGuestQuantity: (variantId: number, quantity: number) => Promise<void>;
  removeGuestLine: (variantId: number) => Promise<void>;
  clearGuestBag: () => Promise<void>;
}

const C = createContext<Ctx | null>(null);
type LoginResult = Partial<Tokens> & { user?: User; mfa_required?: boolean; mfa_enrollment_required?: boolean };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [guestEnabled, setGuestEnabled] = useState(false);
  const [guestLines, setGuestLines] = useState<GuestLine[]>([]);

  const updateGuest = useCallback(async (next: GuestLine[]) => {
    setGuestLines(next);
    await saveBag(AsyncStorage, next);
  }, []);

  useEffect(() => {
    loadBag(AsyncStorage).then(setGuestLines);
    api<{ guest_checkout?: boolean }>("/config/").then((c) => setGuestEnabled(!!c.guest_checkout)).catch(() => setGuestEnabled(false));
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      const r = await api<{ items: CartItem[] }>("/cart/");
      setCart(r.items);
    } catch {
      setCart([]);
    }
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      setUser(null);
      setCart([]);
    });
    (async () => {
      if (await getTokens()) {
        try {
          setUser(await api<User>("/auth/me/"));
          await refreshCart();
          refreshPushRegistration().catch(() => undefined);
        } catch {
          setUser(null);
        }
      }
      setReady(true);
    })();
  }, [refreshCart]);

  const accept = async (r: LoginResult) => {
    if (r.mfa_required || r.mfa_enrollment_required) throw new Error("Staff accounts sign in at the admin dashboard.");
    if (!r.access || !r.refresh || !r.user) throw new Error("Unexpected response from the server.");
    await setTokens({ access: r.access, refresh: r.refresh });
    setUser(r.user);
    // Whatever they put in the bag before signing in moves into their account.
    const waiting = await loadBag(AsyncStorage);
    if (waiting.length) {
      await mergeIntoAccount(waiting, (variant, quantity) => api("/cart/items/", { method: "POST", body: { variant, quantity } }));
      await updateGuest([]);
    }
    await refreshCart();
    refreshPushRegistration().catch(() => undefined);
  };

  const value: Ctx = {
    user,
    ready,
    cart,
    login: async (email, password) => accept(await api<LoginResult>("/auth/login/", { method: "POST", body: { email, password } })),
    requestPhoneCode: async (phone) => {
      await api("/auth/phone/login/", { method: "POST", body: { phone } });
    },
    loginWithPhone: async (phone, code) => accept(await api<LoginResult>("/auth/phone/login/confirm/", { method: "POST", body: { phone, code } })),
    refreshUser: async () => {
      setUser(await api<User>("/auth/me/"));
    },
    register: async (email, password, fullName, marketing = false) => {
      await api("/auth/register/", { method: "POST", body: { email, password, full_name: fullName, accept_terms: true, marketing_opt_in: marketing } });
      await accept(await api<LoginResult>("/auth/login/", { method: "POST", body: { email, password } }));
    },
    logout: async () => {
      await unregisterDevice().catch(() => undefined);
      const t = await getTokens();
      try {
        if (t) await api("/auth/logout/", { method: "POST", body: { refresh: t.refresh } });
      } catch {
        /* token already invalid */
      }
      await setTokens(null);
      setUser(null);
      setCart([]);
    },
    refreshCart,
    addToCart: async (variantId, quantity) => {
      const r = await api<{ items: CartItem[] }>("/cart/items/", { method: "POST", body: { variant: variantId, quantity } });
      setCart(r.items);
    },
    setQuantity: async (id, quantity) => {
      const r = await api<{ items: CartItem[] }>(`/cart/items/${id}/`, { method: "PATCH", body: { quantity } });
      setCart(r.items);
    },
    removeItem: async (id) => {
      const r = await api<{ items: CartItem[] }>(`/cart/items/${id}/`, { method: "DELETE" });
      setCart(r.items);
    },
    guestEnabled,
    guestLines,
    addGuestLine: (line) => updateGuest(addLine(guestLines, line)),
    setGuestQuantity: (variantId, quantity) => updateGuest(setGuestQty(guestLines, variantId, quantity)),
    removeGuestLine: (variantId) => updateGuest(removeLine(guestLines, variantId)),
    clearGuestBag: () => updateGuest([]),
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
