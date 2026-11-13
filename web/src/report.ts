/**
 * Sends crashes to the API so they show up beside server errors (NFR-05). Fire-and-forget: reporting must never
 * throw or slow the page, and the URL is cut to its path because query strings can carry reset-link tokens.
 */
const BASE: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
const SOURCE = "web";
const seen = new Set<string>();

export function reportError(error: unknown, extra = ""): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = `${err.name}: ${err.message}`.slice(0, 500);
    if (seen.has(message) || seen.size > 20) return; // one report per distinct error per page load
    seen.add(message);
    const body = JSON.stringify({
      source: SOURCE, message, stack: `${extra}\n${err.stack ?? ""}`.trim().slice(0, 4000),
      url: window.location.pathname, app_version: import.meta.env.VITE_APP_VERSION ?? "",
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${BASE}/client-errors/`, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(`${BASE}/client-errors/`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    /* never let the reporter itself fail */
  }
}

export function installGlobalErrorReporting(): void {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandled promise rejection"));
}
