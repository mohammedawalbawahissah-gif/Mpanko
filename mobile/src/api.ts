import * as SecureStore from "expo-secure-store";

export const BASE: string = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8000/api/v1";
const KEY = "mpanko.tokens";

export interface Tokens {
  access: string;
  refresh: string;
}

let memory: Tokens | null = null;
let loaded = false;
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

export async function getTokens(): Promise<Tokens | null> {
  if (!loaded) {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      memory = raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      memory = null;
    }
    loaded = true;
  }
  return memory;
}

export async function setTokens(t: Tokens | null): Promise<void> {
  memory = t;
  loaded = true;
  try {
    if (t) await SecureStore.setItemAsync(KEY, JSON.stringify(t));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* keychain unavailable: session lasts until the app closes */
  }
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(messageFrom(data) || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
  fields(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === "object") {
      for (const [k, v] of Object.entries(this.data as Record<string, unknown>)) {
        out[k] = Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : "";
      }
    }
    return out;
  }
}

function messageFrom(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    for (const v of Object.values(d)) {
      if (typeof v === "string") return v;
      if (Array.isArray(v) && v.length) return String(v[0]);
    }
  }
  return "";
}

let refreshing: Promise<boolean> | null = null;
async function refreshTokens(): Promise<boolean> {
  const t = await getTokens();
  if (!t) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: t.refresh }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const d = (await r.json()) as Partial<Tokens>;
        if (!d.access) return false;
        await setTokens({ access: d.access, refresh: d.refresh ?? t.refresh });
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

interface Options {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts: Options = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const tokens = await getTokens();
  if (tokens) headers.Authorization = `Bearer ${tokens.access}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, { detail: "Can't reach Mpanko. Check your connection and try again." });
  }
  if (res.status === 401 && tokens && retry) {
    if (await refreshTokens()) return api<T>(path, opts, false);
    await setTokens(null);
    onSignedOut?.();
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export interface Page<T> {
  count: number;
  results: T[];
}

export function idempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
