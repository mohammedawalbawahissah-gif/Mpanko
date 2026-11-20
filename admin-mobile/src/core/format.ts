export function label(v: string): string {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function when(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toISOString().slice(0, 10);
}

/** The next steps staff can take on an order, by role. Payment states are set only by verified payments, so they are never offered. */
const NEXT: Record<string, string[]> = {
  paid: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  pending_payment: ["cancelled"],
};

export function nextSteps(status: string, role: string): string[] {
  const fulfil = ["super_admin", "store_admin", "fulfillment"].includes(role);
  return (NEXT[status] ?? []).filter((to) => fulfil || to === "cancelled" && role === "finance");
}

export const STAFF_ROLES = ["super_admin", "store_admin", "fulfillment", "finance", "support"];
export const PAYMENT_ROLES = ["super_admin", "store_admin", "finance"];
