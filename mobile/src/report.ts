import Constants from "expo-constants";
import { BASE } from "./api";
import { buildReport, makeDeduper } from "./core/report";

const shouldSend = makeDeduper();
let currentScreen = "";
export const setCurrentScreen = (name: string) => {
  currentScreen = name;
};

/** Sends a crash to the API next to server errors. Fire-and-forget: reporting must never throw. */
export function reportError(error: unknown, extra = ""): void {
  try {
    const report = buildReport(error, extra, currentScreen, Constants.expoConfig?.version ?? "");
    if (!shouldSend(report)) return;
    void fetch(`${BASE}/client-errors/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }).catch(() => undefined);
  } catch {
    /* never let the reporter itself fail */
  }
}

/** Catches errors React doesn't (event handlers, timers, promises). Call once at start-up. */
export function installGlobalErrorReporting(): void {
  const errorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void; setGlobalHandler: (h: (e: Error, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((e, fatal) => {
    reportError(e, fatal ? "fatal" : "");
    previous(e, fatal);
  });
}
