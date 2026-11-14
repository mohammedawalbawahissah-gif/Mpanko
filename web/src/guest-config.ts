import { useEffect, useState } from "react";
import { api } from "./api";

export interface ShopConfig { guest_checkout: boolean; whatsapp_number: string; launch_countries: string[] }
const EMPTY: ShopConfig = { guest_checkout: false, whatsapp_number: "", launch_countries: [] };

let configPromise: Promise<ShopConfig> | null = null;

function loadConfig(): Promise<ShopConfig> {
  configPromise ??= api<Partial<ShopConfig>>("/config/")
    .then((c) => ({ guest_checkout: !!c.guest_checkout, whatsapp_number: c.whatsapp_number ?? "", launch_countries: c.launch_countries ?? [] }))
    .catch(() => EMPTY);
  return configPromise;
}

/** The shop's public settings. Null while we ask. */
export function useShopConfig(): ShopConfig | null {
  const [config, setConfig] = useState<ShopConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadConfig().then((v) => !cancelled && setConfig(v));
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

/** Whether the shop lets visitors check out without an account. Null while we ask. */
export function useGuestCheckoutEnabled(): boolean | null {
  const c = useShopConfig();
  return c ? c.guest_checkout : null;
}
