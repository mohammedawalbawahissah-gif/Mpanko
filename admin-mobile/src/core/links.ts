/** Where a staff alert should open. Alerts carry a link such as mpanko-admin://orders/MP-1001 or the stored path "orders/MP-1001". */
export type Target = { screen: "alerts" | "orders" | "order" | "payments" | "support" | "other"; ref?: string };

const SCREENS: Record<string, Target["screen"]> = {
  orders: "orders",
  "manual-payments": "payments",
  payments: "payments",
  support: "support",
  returns: "support",
  chargebacks: "orders",
  stock: "other",
  enquiries: "other",
};

export function parseTarget(link: string | null | undefined): Target {
  if (!link) return { screen: "alerts" };
  const path = link.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^\/+|\/+$/g, "");
  if (!path) return { screen: "alerts" };
  const [head, ...rest] = path.split("/");
  const screen = SCREENS[head ?? ""];
  if (!screen) return { screen: "alerts" };
  const ref = rest.join("/") || undefined;
  if (screen === "orders" && head === "orders" && ref) return { screen: "order", ref };
  return ref ? { screen, ref } : { screen };
}
