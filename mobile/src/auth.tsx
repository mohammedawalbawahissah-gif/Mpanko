import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getTokens, setSignedOutHandler, setTokens, type Tokens } from "./api";
import type { CartItem, User } from "./types";

interface Ctx {
  user: User | null;
  ready: boolean;
  cart: CartItem[];
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshCart: () => Promise<void>;
  addToCart: (variantId: number, quantity: number) => Promise<void>;
  setQuantity: (id: number, quantity: number) => Promise<void>;
  removeItem: (id: number) => Promise<void>;
}

const C = createContext<Ctx | null>(null);
type LoginResult = Partial<Tokens> & { user?: User; mfa_required?: boolean; mfa_enrollment_required?: boolean };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);

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
    await refreshCart();
  };

  const value: Ctx = {
    user,
    ready,
    cart,
    login: async (email, password) => accept(await api<LoginResult>("/auth/login/", { method: "POST", body: { email, password } })),
    register: async (email, password, fullName) => {
      await api("/auth/register/", { method: "POST", body: { email, password, full_name: fullName } });
      await accept(await api<LoginResult>("/auth/login/", { method: "POST", body: { email, password } }));
    },
    logout: async () => {
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
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
