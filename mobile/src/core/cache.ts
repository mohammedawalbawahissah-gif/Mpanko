/** Saved copies of catalog pages so browsing still works on a poor or missing connection. */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface Cached<T> {
  data: T;
  /** When this copy was saved (ms since epoch). */
  savedAt: number;
  /** True when it is a saved copy rather than fresh from the server. */
  stale: boolean;
}

const PREFIX = "mpanko.cache.";
/** Saved copies older than this are not shown. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Only connection failures fall back to a saved copy. A server answer (even an error) is shown as it is. */
export function isOffline(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 0;
}

export async function readCached<T>(store: KeyValueStore, key: string, now = Date.now()): Promise<Cached<T> | null> {
  try {
    const raw = await store.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { data?: T; savedAt?: number };
    if (v.data === undefined || typeof v.savedAt !== "number") return null;
    if (now - v.savedAt > MAX_AGE_MS || v.savedAt > now + 60_000) return null;
    return { data: v.data, savedAt: v.savedAt, stale: true };
  } catch {
    return null;
  }
}

export async function writeCached<T>(store: KeyValueStore, key: string, data: T, now = Date.now()): Promise<void> {
  try {
    await store.setItem(PREFIX + key, JSON.stringify({ data, savedAt: now }));
  } catch {
    /* a full or unavailable disk must never break browsing */
  }
}

/**
 * Fetch fresh data and save it. If the connection is down, return the saved copy instead (marked stale).
 * If there is none, the original error is thrown.
 */
export async function fetchWithCache<T>(store: KeyValueStore, key: string, fetcher: () => Promise<T>, now = () => Date.now()): Promise<Cached<T>> {
  try {
    const data = await fetcher();
    const savedAt = now();
    await writeCached(store, key, data, savedAt);
    return { data, savedAt, stale: false };
  } catch (e) {
    if (isOffline(e)) {
      const saved = await readCached<T>(store, key, now());
      if (saved) return saved;
    }
    throw e;
  }
}
