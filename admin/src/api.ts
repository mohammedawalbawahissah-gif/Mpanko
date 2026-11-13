const BASE: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
const TOKEN_KEY = "mpanko.admin.tokens";

export interface Tokens {
  access: string;
  refresh: string;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(messageFrom(data) || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
  /** Field-level errors, e.g. {email: "Already registered"} */
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

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: Tokens | null): void {
  try {
    if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode): the session just won't persist */
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: tokens.refresh }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const data = (await r.json()) as Partial<Tokens>;
        if (!data.access) return false;
        setTokens({ access: data.access, refresh: data.refresh ?? tokens.refresh });
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
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json"; // a browser sets the multipart boundary itself
  const tokens = getTokens();
  if (tokens) headers.Authorization = `Bearer ${tokens.access}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, { detail: "Can't reach Mpanko right now. Check your connection and try again." });
  }

  if (res.status === 401 && tokens && retry) {
    if (await refreshTokens()) return api<T>(path, opts, false);
    setTokens(null);
    window.dispatchEvent(new Event("mpanko:signed-out"));
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
  next: string | null;
  previous: string | null;
  results: T[];
}

export function idempotencyKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Download an authenticated file (such as a shipping label). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const tokens = getTokens();
  const res = await fetch(`${BASE}${path}`, { headers: tokens ? { Authorization: `Bearer ${tokens.access}` } : {} });
  if (!res.ok) throw new ApiError(res.status, null);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download a CSV export (needs the Authorization header, so a plain link won't work). */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const tokens = getTokens();
  const res = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}export=csv`, {
    headers: tokens ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, null);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
