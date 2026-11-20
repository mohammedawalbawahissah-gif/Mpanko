import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getTokens, setSignedOutHandler, setTokens, type Tokens } from "./api";
import { STAFF_ROLES } from "./core/format";
import { refreshPushRegistration, unregisterDevice } from "./push";

export interface Staff { id: number; email: string; full_name: string; role: string }
export type Step = { kind: "done" } | { kind: "code"; ticket: string } | { kind: "enroll" };

interface Ctx {
  user: Staff | null;
  ready: boolean;
  start: (email: string, password: string) => Promise<Step>;
  verify: (ticket: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

type LoginResult = Partial<Tokens> & { user?: Staff; mfa_required?: boolean; mfa_enrollment_required?: boolean; mfa_token?: string };
const C = createContext<Ctx | null>(null);
const NOT_STAFF = "This app is for Mpanko staff. Customers use the Mpanko shop app.";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const me = await api<Staff>("/auth/me/");
    if (!STAFF_ROLES.includes(me.role)) {
      await setTokens(null);
      throw new Error(NOT_STAFF);
    }
    setUser(me);
    refreshPushRegistration().catch(() => undefined);
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    (async () => {
      if (await getTokens()) await load().catch(() => setUser(null));
      setReady(true);
    })();
  }, [load]);

  const finish = async (t: Tokens) => {
    await setTokens({ access: t.access, refresh: t.refresh });
    await load();
  };

  const start = async (email: string, password: string): Promise<Step> => {
    const r = await api<LoginResult>("/auth/login/", { method: "POST", body: { email, password } });
    if (r.mfa_required && r.mfa_token) return { kind: "code", ticket: r.mfa_token };
    if (r.mfa_enrollment_required) return { kind: "enroll" };
    if (r.access && r.refresh) {
      if (r.user && !STAFF_ROLES.includes(r.user.role)) throw new Error(NOT_STAFF);
      await finish({ access: r.access, refresh: r.refresh });
      return { kind: "done" };
    }
    throw new Error("Unexpected answer from the server.");
  };

  const verify = async (ticket: string, code: string) => {
    const t = await api<Tokens>("/auth/login/mfa/", { method: "POST", body: { mfa_token: ticket, code } });
    await finish(t);
  };

  const logout = async () => {
    await unregisterDevice().catch(() => undefined);
    const t = await getTokens();
    if (t) await api("/auth/logout/", { method: "POST", body: { refresh: t.refresh } }).catch(() => undefined);
    await setTokens(null);
    setUser(null);
  };

  return <C.Provider value={{ user, ready, start, verify, logout }}>{children}</C.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
