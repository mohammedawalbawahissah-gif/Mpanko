export interface CrashReport {
  source: "mobile";
  message: string;
  stack: string;
  url: string;
  app_version: string;
}

/** The body for POST /client-errors/. Messages and stacks are cut to the sizes the API accepts. */
export function buildReport(error: unknown, extra = "", screen = "", version = ""): CrashReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    source: "mobile",
    message: `${err.name}: ${err.message}`.slice(0, 500),
    stack: `${extra}\n${err.stack ?? ""}`.trim().slice(0, 4000),
    url: screen.slice(0, 300),
    app_version: version.slice(0, 40),
  };
}

/** Remembers what was already sent so one broken screen can't flood the API. */
export function makeDeduper(limit = 20): (report: CrashReport) => boolean {
  const seen = new Set<string>();
  return (report) => {
    if (seen.has(report.message) || seen.size >= limit) return false;
    seen.add(report.message);
    return true;
  };
}
