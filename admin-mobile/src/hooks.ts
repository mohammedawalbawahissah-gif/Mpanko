import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

/** Loads when the screen opens, each time it comes back into view, and on demand. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    try { setData(await fn()); setError(""); } catch (e) { setError(errText(e)); }
  }, deps);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { data, error, reload: load, setData };
}

export type Msg = { kind: "ok" | "error"; text: string } | null;

/** One message line plus a helper that runs a request and reports how it went. */
export function useRunner() {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string | ((r: any) => string), after?: () => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ kind: "ok", text: typeof done === "function" ? done(r) : done }); after?.(); return r; }
    catch (e) { setMsg({ kind: "error", text: errText(e) }); }
    finally { setBusy(false); }
  };
  return { msg, setMsg, busy, run };
}

export const rowsOf = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : ((d as { results?: T[] } | null)?.results ?? []));
