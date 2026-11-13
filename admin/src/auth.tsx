import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setTokens, getTokens, type Tokens } from "./api";

export interface Staff {
  id: number;
  email: string;
  full_name: string;
  role: string;
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  store_admin: "Store admin",
  fulfillment: "Fulfilment",
  finance: "Finance",
  support: "Support",
  carrier: "Carrier partner",
};

/** A login attempt either finishes, or needs a second step. */
export type LoginStep =
  | { kind: "done" }
  | { kind: "code"; ticket: string }
  | { kind: "enroll"; ticket: string };

interface Ctx {
  user: Staff | null;
  ready: boolean;
  start: (email: string, password: string) => Promise<LoginStep>;
  finish: (data: Tokens & { user?: Staff }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<Ctx | null>(null);
const ALLOWED = new Set(["super_admin", "store_admin", "fulfillment", "finance", "support", "carrier"]);

interface LoginResult extends Partial<Tokens> {
  mfa_required?: boolean;
  mfa_enrollment_required?: boolean;
  mfa_token?: string;
  user?: Staff;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!getTokens()) {
      setUser(null);
      return;
    }
    try {
      const me = await api<Staff>("/auth/me/");
      if (ALLOWED.has(me.role)) setUser(me);
      else {
        setTokens(null);
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setReady(true));
    const out = () => setUser(null);
    window.addEventListener("mpanko:signed-out", out);
    return () => window.removeEventListener("mpanko:signed-out", out);
  }, [load]);

  const finish = async (data: Tokens) => {
    setTokens({ access: data.access, refresh: data.refresh });
    await load();
  };

  const start = async (email: string, password: string): Promise<LoginStep> => {
    const r = await api<LoginResult>("/auth/login/", { method: "POST", body: { email, password } });
    if (r.mfa_required && r.mfa_token) return { kind: "code", ticket: r.mfa_token };
    if (r.mfa_enrollment_required && r.mfa_token) return { kind: "enroll", ticket: r.mfa_token };
    if (r.access && r.refresh) {
      if (r.user && !ALLOWED.has(r.user.role)) throw new Error("This sign-in is for Mpanko staff and carrier partners. Customers sign in at the shop.");
      await finish({ access: r.access, refresh: r.refresh });
      return { kind: "done" };
    }
    throw new Error("Unexpected response from the server.");
  };

  const logout = async () => {
    const t = getTokens();
    try {
      if (t) await api("/auth/logout/", { method: "POST", body: { refresh: t.refresh } });
    } catch {
      /* already invalid */
    }
    setTokens(null);
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, ready, start, finish, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
