/**
 * Where to go after signing in. Only a path inside this site is allowed: anything that could be read by a browser or a
 * router as another address (//host, /\host, https://host, javascript:) falls back to the home page.
 */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value) || /[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const u = new URL(value, "https://site.invalid");
    if (u.origin !== "https://site.invalid") return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
