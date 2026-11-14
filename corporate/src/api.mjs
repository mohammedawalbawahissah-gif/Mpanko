// Reads the corporate content from the Mpanko API. Cached for a minute; if the API is down the last good copy is used,
// and with no copy at all the caller falls back to the wording in content.mjs.
const TTL_MS = 60_000;
const TIMEOUT_MS = 4_000;

export function createApi({ apiUrl, fetchImpl = fetch, now = () => Date.now() }) {
  const cache = new Map(); // key -> { at, data }

  async function getJson(path) {
    const res = await fetchImpl(apiUrl + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`API answered ${res.status}`);
    return { data: await res.json() };
  }

  async function cached(key, path) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    try {
      const out = await getJson(path);
      const value = out.notFound ? { status: "missing" } : { status: "ok", data: out.data };
      cache.set(key, { at: now(), value });
      return value;
    } catch {
      if (hit) return hit.value; // stale beats nothing
      return { status: "down" };
    }
  }

  return {
    configured: Boolean(apiUrl),
    /** { status: "ok", data: { profile, businesses } } | { status: "down" } */
    site: () => (apiUrl ? cached("site", "/api/v1/corporate/site/") : Promise.resolve({ status: "down" })),
    /** { status: "ok", data } | { status: "missing" } | { status: "down" } */
    business: (slug) => (apiUrl ? cached(`b:${slug}`, `/api/v1/corporate/businesses/${encodeURIComponent(slug)}/`) : Promise.resolve({ status: "down" })),
    /** Send a contact message. Returns { ok: true } or { ok: false, kind: "invalid"|"busy"|"down", errors? }. */
    async contact(payload) {
      if (!apiUrl) return { ok: false, kind: "down" };
      try {
        const res = await fetchImpl(apiUrl + "/api/v1/corporate/contact/", {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS * 2),
        });
        if (res.status === 201) return { ok: true };
        if (res.status === 400) return { ok: false, kind: "invalid", errors: await res.json().catch(() => ({})) };
        if (res.status === 429) return { ok: false, kind: "busy" };
        return { ok: false, kind: "down" };
      } catch {
        return { ok: false, kind: "down" };
      }
    },
    clear: () => cache.clear(),
  };
}
