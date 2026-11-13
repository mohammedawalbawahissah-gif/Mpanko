import { useEffect, useState } from "react";
import { api } from "./api";

let configPromise: Promise<boolean> | null = null;

/** Whether the shop lets visitors check out without an account. Null while we ask. */
export function useGuestCheckoutEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    configPromise ??= api<{ guest_checkout?: boolean }>("/config/").then((c) => !!c.guest_checkout).catch(() => false);
    let cancelled = false;
    configPromise.then((v) => !cancelled && setEnabled(v));
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
