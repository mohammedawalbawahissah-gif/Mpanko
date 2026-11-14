/** Where tapping a notification goes. `path` is what the server sends: "orders/MP-1234", "support/SUP-9", "orders" or "support". */
export type InboxTarget =
  | { screen: "OrderDetail"; params: { number: string } }
  | { screen: "SupportThread"; params: { number: string } }
  | { screen: "SupportList" }
  | { screen: "Orders" };

export function routeForPath(path: string): InboxTarget {
  const [area, ref] = path.replace(/^\/+/, "").split("/");
  if (area === "support") return ref ? { screen: "SupportThread", params: { number: ref } } : { screen: "SupportList" };
  if (area === "orders" && ref) return { screen: "OrderDetail", params: { number: ref } };
  return { screen: "Orders" };
}

/** The number on the bell: nothing at 0, and "99+" past 99. */
export function badgeText(n: number): string {
  return n <= 0 ? "" : n > 99 ? "99+" : String(n);
}
