import type { FieldDef, Opt, Vals } from "../kit";

export const ALL_STAFF = ["super_admin", "store_admin", "fulfillment", "finance", "support"];
const SA = ["super_admin", "store_admin"];
const MONEY = ["super_admin", "store_admin", "finance"];
export const ROLE_NAMES: Record<string, string> = {
  store_admin: "Store administrator", fulfillment: "Order / fulfillment staff", finance: "Finance staff", support: "Support staff", carrier: "Carrier partner user", super_admin: "Super administrator",
};

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Filter { param: string; label: string; options: Opt[]; def?: string }
export interface Action {
  label: string;
  tone?: "primary" | "quiet" | "danger";
  path: (r: Row) => string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  fields?: FieldDef[];
  body?: (v: Vals, r: Row) => unknown;
  show?: (r: Row, role: string) => boolean;
  confirm?: string;
  /** Message after it worked. */
  done?: string | ((res: any, r: Row) => string); // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Go back to the list afterwards. */
  leave?: boolean;
  check?: (v: Vals) => string | null;
}
export interface Resource {
  key: string;
  title: string;
  intro?: string;
  group: string;
  roles: string[];
  path: string;
  filters?: Filter[];
  search?: { param: string; label: string };
  dates?: { from: string; to: string };
  idOf: (r: Row) => string;
  rowTitle: (r: Row) => string;
  rowSub?: (r: Row) => string;
  rowSide?: (r: Row) => string;
  pill?: (r: Row) => { text: string; tone?: "ok" | "warn" | "bad" };
  detail?: (id: string) => string;
  lines?: (r: Row) => [string, string][];
  blocks?: (r: Row) => { title: string; lines: string[] }[];
  fields?: FieldDef[];
  /** Who may add, change and remove. Defaults to everyone allowed to open it. */
  editRoles?: string[];
  create?: { label: string; defaults?: Vals; path?: string };
  update?: { method: "PATCH" | "PUT"; path: (r: Row) => string; blanks?: "keep" | "null"; label?: string };
  multipart?: boolean;
  /** Values to show when editing, where the stored value is shown differently (a share as a percentage). */
  prefill?: (r: Row) => Row;
  toBody?: (v: Vals, mode: "create" | "edit", r?: Row) => Vals;
  check?: (v: Vals) => string | null;
  remove?: { path: (r: Row) => string; label: string; confirm: string };
  actions?: Action[];
  empty: string;
  /** One record shown straight away, with no list (site details). */
  single?: boolean;
  readOnly?: boolean;
}

const label = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const opts = (...v: string[]): Opt[] => v.map((x) => ({ value: x, label: label(x) }));
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const tone = (st: string) => (["approved", "refunded", "handled", "sent", "won", "answered", "delivered", "published", "active"].includes(st) ? "ok" : ["rejected", "cancelled", "lost", "failed", "exception"].includes(st) ? "bad" : ["requested", "new", "open", "draft", "evidence_sent"].includes(st) ? "warn" : undefined) as "ok" | "warn" | "bad" | undefined;

/** "0.1250" -> "12.5%". */
export function asPercent(share: string | number): string {
  const n = Number(share) * 100;
  return Number.isFinite(n) ? `${Number(n.toFixed(2))}%` : "";
}
/** "12.5" or "12.5%" -> "0.125"; "" when it is not a percentage between 0 and 100. */
export function fromPercent(text: string): string {
  const n = Number(text.trim().replace(/%$/, ""));
  if (text.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return "";
  return String(Number((n / 100).toFixed(6)));
}

const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

const COUPON_KIND: Record<string, string> = { percent: "Percent off", fixed: "Amount off", free_shipping: "Free shipping" };

export const RESOURCES: Resource[] = [
  // ---------------------------------------------------------------- Sell
  {
    key: "returns", title: "Returns", group: "Sell", roles: ALL_STAFF, path: "/returns/", empty: "No returns here.",
    filters: [{ param: "status", label: "Status", def: "requested", options: [{ value: "", label: "All" }, ...opts("requested", "approved", "received", "refunded", "rejected", "cancelled")] }],
    idOf: (r) => r.number, rowTitle: (r) => r.number, rowSub: (r) => `${r.order_number} · ${r.customer_email} · ${r.reason_label}`, rowSide: (r) => day(r.created_at), pill: (r) => ({ text: r.status_label || label(r.status), tone: tone(r.status) }),
    detail: (id) => `/returns/${id}/`,
    lines: (r) => [["Order", r.order_number], ["Customer", r.customer_email], ["Reason", r.reason_label], ["Asked", when(r.created_at)], ...(r.note ? [["Customer note", r.note]] : []), ...(r.staff_note ? [["Message to customer", r.staff_note]] : []), ...(r.refund_amount ? [["Refund when received", `${r.currency} ${r.refund_amount}`]] : [])] as [string, string][],
    blocks: (r) => [{ title: "Items", lines: (r.items ?? []).map((i: Row) => `${i.quantity} × ${i.product_name}${i.variant_name ? ` · ${i.variant_name}` : ""} (${i.sku}) — ${r.currency} ${i.unit_price}`) }],
    actions: [
      { label: "Approve return", path: (r) => `/returns/${r.number}/approve/`, method: "POST", show: (r) => r.status === "requested", fields: [{ key: "staff_note", label: "Message to the customer" }, { key: "refund_amount", label: "Refund amount, blank = item value", kind: "decimal" }], body: (v) => ({ staff_note: v.staff_note, ...(v.refund_amount ? { refund_amount: v.refund_amount } : {}) }), done: "Return approved. The customer has been emailed.", leave: true },
      { label: "Reject return", tone: "danger", path: (r) => `/returns/${r.number}/reject/`, method: "POST", show: (r) => r.status === "requested", fields: [{ key: "staff_note", label: "Message to the customer (required)" }], check: (v) => (String(v.staff_note ?? "").trim() ? null : "A message to the customer is needed to reject."), body: (v) => ({ staff_note: v.staff_note }), done: "Return rejected. The customer has been emailed.", leave: true },
      { label: "Mark received", path: (r) => `/returns/${r.number}/receive/`, method: "POST", show: (r) => r.status === "approved", fields: [{ key: "restock", label: "Put the items back in stock", kind: "bool" }], body: (v) => ({ restock: !!v.restock }), done: "Marked as received." },
      { label: "Refund", tone: "danger", path: (r) => `/returns/${r.number}/refund/`, method: "POST", show: (r, role) => r.status === "received" && MONEY.includes(role), confirm: "Refund this return to the customer?", body: () => ({}), done: (_x, r) => `Refunded ${r.currency} ${r.refund_amount}. The customer has been emailed.` },
    ],
    readOnly: true,
  },
  {
    key: "support", title: "Support", group: "Sell", roles: ALL_STAFF, path: "/support/cases/", empty: "No support requests here.",
    filters: [{ param: "status", label: "Status", def: "open", options: [{ value: "", label: "All" }, ...opts("open", "answered", "closed")] }],
    idOf: (r) => r.number, rowTitle: (r) => r.subject, rowSub: (r) => `${r.number} · ${r.customer_email}`, rowSide: (r) => day(r.updated_at), pill: (r) => ({ text: r.status_label || label(r.status), tone: tone(r.status) }),
    detail: (id) => `/support/cases/${id}/`,
    lines: (r) => [["Request", r.number], ["Customer", r.customer_email], ...(r.order_number ? [["Order", r.order_number]] : [])] as [string, string][],
    blocks: (r) => [{ title: "Conversation", lines: (r.messages ?? []).map((m: Row) => `${m.from_staff ? "Support" : r.customer_email} · ${when(m.created_at)}\n${m.body}`) }],
    actions: [
      { label: "Send reply", path: (r) => `/support/cases/${r.number}/messages/`, method: "POST", show: (r) => r.status !== "closed", fields: [{ key: "body", label: "Reply to the customer", kind: "area" }], check: (v) => (String(v.body ?? "").trim() ? null : "Write a reply first."), body: (v) => ({ body: v.body }), done: "Reply sent." },
      { label: "Close request", tone: "quiet", path: (r) => `/support/cases/${r.number}/close/`, method: "POST", show: (r) => r.status !== "closed", confirm: "Close this request?", body: () => ({}), done: "Request closed." },
    ],
    readOnly: true,
  },
  {
    key: "customers", title: "Customers", group: "Sell", roles: ["super_admin", "store_admin", "support"], path: "/customers/", empty: "No customers found.",
    search: { param: "search", label: "Search by name, email or phone" },
    idOf: (r) => String(r.id), rowTitle: (r) => r.full_name || r.email, rowSub: (r) => `${r.full_name ? r.email + " · " : ""}${r.order_count} order${r.order_count === 1 ? "" : "s"}`, rowSide: (r) => day(r.date_joined), pill: (r) => ({ text: r.is_active ? "Active" : "Switched off", tone: r.is_active ? "ok" : "bad" }),
    detail: (id) => `/customers/${id}/`,
    lines: (r) => [["Email", `${r.email} (${r.email_verified ? "verified" : "not verified"})`], ...(r.phone ? [["Phone", r.phone]] : []), ["Joined", when(r.date_joined)], ["Account", r.is_active ? "Active" : "Switched off"]] as [string, string][],
    blocks: (r) => [
      { title: "Orders", lines: (r.orders ?? []).map((o: Row) => `${o.number} · ${label(o.status)} · ${o.currency} ${o.grand_total} · ${day(o.created_at)}`) },
      { title: "Addresses", lines: (r.addresses ?? []).map((a: Row) => `${a.recipient_name}, ${a.line1}, ${a.city} ${a.postal_code}, ${a.country}`) },
      { title: "Returns", lines: (r.returns ?? []).map((x: Row) => `${x.number} for ${x.order_number}: ${label(x.status)}`) },
      { title: "Support requests", lines: (r.support_cases ?? []).map((x: Row) => `${x.subject}: ${label(x.status)}`) },
    ],
    actions: [
      { label: "Switch account off", tone: "danger", path: (r) => `/customers/${r.id}/`, method: "PATCH", show: (r, role) => r.is_active && SA.includes(role), confirm: "Switch this customer's account off? They will not be able to sign in.", body: () => ({ is_active: false }), done: "Account switched off." },
      { label: "Switch account on", path: (r) => `/customers/${r.id}/`, method: "PATCH", show: (r, role) => !r.is_active && SA.includes(role), body: () => ({ is_active: true }), done: "Account switched on." },
    ],
    readOnly: true,
  },
  {
    key: "coupons", title: "Promotions", intro: "Discount codes customers type at checkout. Amounts are in the store currency and convert automatically.", group: "Sell", roles: SA, path: "/coupons/", empty: "No codes yet.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.code, rowSub: (r) => `${COUPON_KIND[r.kind] ?? r.kind}${r.kind === "percent" ? ` ${Number(r.value)}%` : r.kind === "fixed" ? ` ${r.value}` : ""} · used ${r.uses}${r.max_uses ? ` of ${r.max_uses}` : ""}`, rowSide: (r) => (r.ends_at ? `Until ${day(r.ends_at)}` : "No end date"), pill: (r) => ({ text: r.is_active ? "On" : "Off", tone: r.is_active ? "ok" : undefined }),
    fields: [
      { key: "code", label: "Code" }, { key: "description", label: "Note for staff" },
      { key: "kind", label: "Offer", kind: "select", options: Object.entries(COUPON_KIND).map(([value, l]) => ({ value, label: l })) },
      { key: "value", label: "Amount or percent off", kind: "decimal", show: (v) => v.kind !== "free_shipping", hint: "Percent for percent offers; the store currency for amount offers." },
      { key: "max_discount", label: "Largest discount (store currency), optional", kind: "decimal", show: (v) => v.kind === "percent" },
      { key: "min_subtotal", label: "Smallest item total (store currency)", kind: "decimal" },
      { key: "starts_at", label: "Starts", kind: "datetime" }, { key: "ends_at", label: "Ends", kind: "datetime" },
      { key: "max_uses", label: "Total uses, blank = unlimited", kind: "int" }, { key: "per_user_limit", label: "Uses per customer, blank = unlimited", kind: "int" },
      { key: "is_active", label: "On", kind: "bool" },
    ],
    create: { label: "New code", defaults: { kind: "percent", value: "10", min_subtotal: "0", per_user_limit: "1", is_active: true } },
    update: { method: "PATCH", path: (r) => `/coupons/${r.id}/` },
    toBody: (v) => ({ ...v, value: v.kind === "free_shipping" ? "0" : v.value, max_discount: v.max_discount || null, starts_at: v.starts_at || null, ends_at: v.ends_at || null, max_uses: num(v.max_uses), per_user_limit: num(v.per_user_limit) }),
  },
  {
    key: "enquiries", title: "Enquiries", intro: "Messages sent through the corporate website's contact form.", group: "Content", roles: ["super_admin", "store_admin", "support"], path: "/corporate/manage/messages/", empty: "No enquiries here.",
    filters: [{ param: "status", label: "Show", options: [{ value: "", label: "All" }, { value: "new", label: "New" }, { value: "handled", label: "Handled" }] }],
    idOf: (r) => String(r.id), rowTitle: (r) => r.name, rowSub: (r) => `${r.business_name || "General"} · ${r.email}`, rowSide: (r) => day(r.created_at), pill: (r) => ({ text: label(r.status), tone: tone(r.status) }),
    lines: (r) => [["Email", r.email], ...(r.phone ? [["Phone", r.phone]] : []), ["About", r.business_name || "General"], ["Received", when(r.created_at)], ["Status", `${label(r.status)}${r.handled_by_name ? ` by ${r.handled_by_name}` : ""}`], ["Message", r.message]] as [string, string][],
    actions: [
      { label: "Mark as handled", path: (r) => `/corporate/manage/messages/${r.id}/`, method: "PATCH", show: (r) => r.status === "new", fields: [{ key: "staff_note", label: "Internal note (visitors never see this)", kind: "area" }], body: (v) => ({ status: "handled", staff_note: v.staff_note ?? "" }), done: "Marked as handled.", leave: true },
      { label: "Reopen", tone: "quiet", path: (r) => `/corporate/manage/messages/${r.id}/`, method: "PATCH", show: (r) => r.status === "handled", fields: [{ key: "staff_note", label: "Internal note (visitors never see this)", kind: "area" }], body: (v) => ({ status: "new", staff_note: v.staff_note ?? "" }), done: "Reopened.", leave: true },
      { label: "Save note", tone: "quiet", path: (r) => `/corporate/manage/messages/${r.id}/`, method: "PATCH", fields: [{ key: "staff_note", label: "Internal note (visitors never see this)", kind: "area" }], body: (v, r) => ({ status: r.status, staff_note: v.staff_note ?? "" }), done: "Note saved." },
    ],
    readOnly: true,
  },
  {
    key: "announcements", title: "Announcements", intro: "Messages to customers who agreed to offers. Customers choose whether they get them by email, by phone alert, or not at all.", group: "Content", roles: SA, path: "/notifications/campaigns/", empty: "No announcements yet.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.title, rowSub: (r) => r.subject, rowSide: (r) => (r.sent_at ? day(r.sent_at) : day(r.created_at)), pill: (r) => ({ text: label(r.status), tone: tone(r.status) }),
    lines: (r) => (r.status !== "draft" ? [["Sent", when(r.sent_at)], ["Emailed", String(r.emailed)], ["App alerts", String(r.pushed)], ["Skipped", String(r.skipped)]] : []) as [string, string][],
    fields: [
      { key: "title", label: "Name (only staff see this)" }, { key: "subject", label: "Subject line" },
      { key: "body", label: "Message (a blank line starts a new paragraph)", kind: "area" },
      { key: "link", label: "Link (optional, for example a product page)", kind: "url", placeholder: "https://" },
      { key: "countries", label: "Countries (leave empty for everyone who agreed)", kind: "countries" },
      { key: "send_email", label: "Send by email", kind: "bool" }, { key: "send_push", label: "Send as a phone alert", kind: "bool" },
    ],
    create: { label: "New announcement", defaults: { send_email: true, send_push: true } },
    update: { method: "PATCH", path: (r) => `/notifications/campaigns/${r.id}/` },
    remove: { path: (r) => `/notifications/campaigns/${r.id}/`, label: "Delete draft", confirm: "Delete this draft?" },
    actions: [
      { label: "Who this reaches", tone: "quiet", path: (r) => `/notifications/campaigns/${r.id}/preview/`, method: "GET", show: (r) => r.status === "draft", done: (x) => `${x.people} people: ${x.email} by email, ${x.push} by phone alert.` },
      { label: "Send me a test", tone: "quiet", path: (r) => `/notifications/campaigns/${r.id}/test/`, method: "POST", show: (r) => r.status === "draft", body: () => ({}), done: "Test email sent to your address." },
      { label: "Send to customers", tone: "danger", path: (r) => `/notifications/campaigns/${r.id}/send/`, method: "POST", show: (r) => r.status === "draft", confirm: "Send this announcement now? It cannot be undone or sent again.", body: () => ({}), done: "Sending started.", leave: true },
    ],
  },
  // ---------------------------------------------------------------- Fulfil
  {
    key: "pickups", title: "Pickup locations", group: "Fulfil", roles: ["super_admin", "store_admin", "fulfillment"], editRoles: ["super_admin", "store_admin"], path: "/shipping/pickups/", empty: "No pickup locations yet.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.name, rowSub: (r) => `${r.line1}, ${r.city}, ${r.country}`, pill: (r) => ({ text: r.is_default ? "Default" : r.is_active ? "In use" : "Off", tone: r.is_active ? "ok" : undefined }),
    fields: [
      { key: "name", label: "Name" }, { key: "contact_name", label: "Contact person" }, { key: "phone", label: "Phone", kind: "phone" }, { key: "email", label: "Email", kind: "email" },
      { key: "line1", label: "Street address" }, { key: "city", label: "City" }, { key: "region", label: "Region" }, { key: "postal_code", label: "Postal code" },
      { key: "country", label: "Country", kind: "country" },
      { key: "is_default", label: "Use as the default pickup location", kind: "bool" }, { key: "is_active", label: "In use", kind: "bool" },
    ],
    create: { label: "Add a pickup location", defaults: { country: "GH", is_active: true } },
    update: { method: "PATCH", path: (r) => `/shipping/pickups/${r.id}/` },
    toBody: (v) => ({ ...v, country: String(v.country).toUpperCase() }),
    remove: { path: (r) => `/shipping/pickups/${r.id}/`, label: "Delete", confirm: "Delete this pickup location?" },
  },
  // ---------------------------------------------------------------- Catalog
  {
    key: "product-types", title: "Product types", group: "Catalog", roles: SA, path: "/product-types/", empty: "No product types yet.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.name, rowSub: (r) => `${r.product_count} product${r.product_count === 1 ? "" : "s"}${(r.restricted_countries ?? []).length ? ` · can't ship to ${(r.restricted_countries ?? []).join(", ")}` : ""}`,
    fields: [
      { key: "name", label: "Name" }, { key: "restricted_countries", label: "Can't ship to", kind: "countries" },
      { key: "restriction_note", label: "Message shown to shoppers in those countries" }, { key: "notes", label: "Internal notes", kind: "area" },
    ],
    create: { label: "Add a product type" }, update: { method: "PATCH", path: (r) => `/product-types/${r.id}/` },
    remove: { path: (r) => `/product-types/${r.id}/`, label: "Delete", confirm: "Delete this product type?" },
  },
  // ---------------------------------------------------------------- Money
  {
    key: "chargebacks", title: "Chargebacks", intro: "A chargeback is a customer's bank asking for a payment back. Send your evidence (tracking, proof of delivery, messages) in your payment provider's dashboard before the deadline, then note what you sent here.", group: "Money", roles: MONEY, path: "/payments/disputes/", empty: "No chargebacks here.",
    filters: [{ param: "status", label: "Show", def: "open", options: [{ value: "open", label: "Evidence needed" }, { value: "evidence_sent", label: "Evidence sent" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "", label: "All" }] }],
    idOf: (r) => String(r.id), rowTitle: (r) => r.order_number, rowSub: (r) => `${r.currency} ${r.amount} · ${label(r.category || "dispute")}`, rowSide: (r) => (r.respond_by ? `Reply by ${day(r.respond_by)}` : ""), pill: (r) => ({ text: label(r.status), tone: tone(r.status) }),
    lines: (r) => [["Opened", when(r.opened_at)], ["Provider status", r.provider_status || "unknown"], ...(r.resolution ? [["Outcome", r.resolution]] : []), ["Payment", r.payment_reference]] as [string, string][],
    actions: [
      { label: "Mark evidence as sent", path: (r) => `/payments/disputes/${r.id}/`, method: "PATCH", show: (r) => r.status === "open", fields: [{ key: "notes", label: "What you sent and when", kind: "area" }], body: (v) => ({ notes: v.notes ?? "", status: "evidence_sent" }), done: "Marked as evidence sent." },
      { label: "Save notes", tone: "quiet", path: (r) => `/payments/disputes/${r.id}/`, method: "PATCH", fields: [{ key: "notes", label: "What you sent and when", kind: "area" }], body: (v) => ({ notes: v.notes ?? "" }), done: "Notes saved." },
    ],
    readOnly: true,
  },
  {
    key: "tax", title: "Tax we charge", group: "Money", roles: MONEY, path: "/tax/rules/", empty: "No tax rules yet.",
    intro: "Tax added to orders, by country. Rates are shown as percentages.",
    idOf: (r) => String(r.id), rowTitle: (r) => `${r.country === "*" ? "Everywhere else" : r.country} · ${r.name}`, rowSub: (r) => `${asPercent(r.rate)}${r.applies_to_shipping ? " · on shipping too" : ""}`, pill: (r) => ({ text: r.is_active ? "On" : "Off", tone: r.is_active ? "ok" : undefined }),
    fields: [
      { key: "country", label: "Country", kind: "country", allowAll: true }, { key: "name", label: "Name on the invoice" },
      { key: "rate", label: "Rate (%)", kind: "decimal" }, { key: "applies_to_shipping", label: "Also charged on shipping", kind: "bool" }, { key: "is_active", label: "On", kind: "bool" },
    ],
    create: { label: "Add a tax rule", defaults: { name: "VAT", is_active: true } }, update: { method: "PATCH", path: (r) => `/tax/rules/${r.id}/` },
    prefill: (r) => ({ rate: String(Number(r.rate) * 100) }),
    check: (v) => (fromPercent(String(v.rate ?? "")) === "" ? "Enter the tax rate as a percentage between 0 and 100, for example 12.5." : null),
    toBody: (v) => ({ ...v, country: String(v.country).toUpperCase(), rate: fromPercent(String(v.rate)) }),
    remove: { path: (r) => `/tax/rules/${r.id}/`, label: "Remove", confirm: "Remove this tax rule?" },
  },
  {
    key: "duties", title: "Import duties", group: "Money", roles: MONEY, path: "/tax/duties/", empty: "No duty rules yet.",
    intro: "What a buyer may pay the carrier on delivery in each country.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.country, rowSub: (r) => `Duty-free up to ${r.de_minimis} · duty ${asPercent(r.duty_rate)} · import VAT ${asPercent(r.import_vat_rate)}`, pill: (r) => ({ text: r.is_active ? "On" : "Off", tone: r.is_active ? "ok" : undefined }),
    fields: [
      { key: "country", label: "Country", kind: "country" }, { key: "de_minimis", label: "Duty-free up to", kind: "decimal" },
      { key: "duty_rate", label: "Duty (%)", kind: "decimal" }, { key: "import_vat_rate", label: "Import VAT (%)", kind: "decimal" },
      { key: "note", label: "Note to the buyer", placeholder: "Paid to the carrier on delivery" }, { key: "is_active", label: "On", kind: "bool" },
    ],
    create: { label: "Add a duty rule", defaults: { de_minimis: "0", import_vat_rate: "0", is_active: true } }, update: { method: "PATCH", path: (r) => `/tax/duties/${r.id}/` },
    prefill: (r) => ({ duty_rate: String(Number(r.duty_rate) * 100), import_vat_rate: String(Number(r.import_vat_rate) * 100) }),
    check: (v) => (fromPercent(String(v.duty_rate ?? "")) === "" || fromPercent(String(v.import_vat_rate ?? "0")) === "" ? "Enter duty and import VAT as percentages between 0 and 100." : null),
    toBody: (v) => ({ ...v, country: String(v.country).toUpperCase(), de_minimis: v.de_minimis || "0", duty_rate: fromPercent(String(v.duty_rate)), import_vat_rate: fromPercent(String(v.import_vat_rate)) }),
    remove: { path: (r) => `/tax/duties/${r.id}/`, label: "Remove", confirm: "Remove this duty rule?" },
  },
  // ---------------------------------------------------------------- Content
  {
    key: "businesses", title: "Businesses", group: "Content", roles: SA, path: "/corporate/manage/businesses/", empty: "No businesses yet.", multipart: true,
    idOf: (r) => String(r.id), rowTitle: (r) => r.name, rowSub: (r) => [r.sector, r.location].filter(Boolean).join(" · "), rowSide: (r) => `Order ${r.sort_order}`, pill: (r) => ({ text: r.is_published ? "Shown" : "Hidden", tone: r.is_published ? "ok" : undefined }),
    fields: [
      { key: "name", label: "Name" }, { key: "sector", label: "Sector (for example, Food or Logistics)" }, { key: "location", label: "Location" },
      { key: "tagline", label: "One-line description" }, { key: "summary", label: "Short summary (shown in the list)", kind: "area" },
      { key: "description", label: "Full description (shown on its own page; leave a blank line between paragraphs)", kind: "area" },
      { key: "highlights", label: "Key points (one per line, shown as a list on its page)", kind: "area" },
      { key: "website_url", label: "Website address (starts with https://)", kind: "url" },
      { key: "logo", label: "Logo (JPG or PNG, up to 5 MB)", kind: "image" }, { key: "logo_alt", label: "Describe the logo (for screen readers)" },
      { key: "image", label: "Photo for its page (JPG or PNG, up to 5 MB)", kind: "image" }, { key: "image_alt", label: "Describe the photo (for screen readers)" },
      { key: "cta_label", label: "Extra button name (for example Donate or Book now; blank hides it)" },
      { key: "cta_url", label: "Extra button address (blank sends visitors to the contact form about this business)", kind: "url" },
      { key: "disclaimer", label: "Small print at the bottom of its page (for example licensing wording)", kind: "area" },
      { key: "sort_order", label: "Order in the list (smaller numbers come first)", kind: "int" },
      { key: "is_published", label: "Shown on the website", kind: "bool" }, { key: "is_featured", label: "Featured", kind: "bool" },
    ],
    create: { label: "Add a business", defaults: { sort_order: "0" } }, update: { method: "PATCH", path: (r) => `/corporate/manage/businesses/${r.id}/` },
    remove: { path: (r) => `/corporate/manage/businesses/${r.id}/`, label: "Delete", confirm: "Delete this business? It will disappear from the website." },
  },
  {
    key: "site-pages", title: "Site pages", group: "Content", roles: SA, path: "/corporate/manage/pages/", empty: "No site pages yet.", multipart: true,
    idOf: (r) => String(r.id), rowTitle: (r) => r.title, rowSub: (r) => label(r.slug), pill: (r) => ({ text: r.is_published ? "Shown" : "Hidden", tone: r.is_published ? "ok" : undefined }),
    fields: [
      { key: "slug", label: "Which page is this?", kind: "select", options: [{ value: "founder", label: "Founder" }, { value: "magazia", label: "Magazia" }] },
      { key: "title", label: "Title" }, { key: "kicker", label: "Short line under the title (for example Founder and CEO)" },
      { key: "summary", label: "Summary (one or two sentences)", kind: "area" }, { key: "body", label: "Full text (leave a blank line between paragraphs)", kind: "area" },
      { key: "quote", label: "Quotation (optional)", kind: "area" }, { key: "quote_by", label: "Quotation is by" },
      { key: "highlights", label: "List (one per line). For a timeline write the year, a bar, then the text, for example: 2024 | Became Magazia", kind: "area" },
      { key: "image", label: "Photo (JPG or PNG, up to 5 MB)", kind: "image" }, { key: "image_alt", label: "Describe the photo (for screen readers)" },
      { key: "is_published", label: "Shown on the website", kind: "bool" },
    ],
    create: { label: "Add a site page", defaults: { slug: "founder" } }, update: { method: "PATCH", path: (r) => `/corporate/manage/pages/${r.id}/` },
    toBody: (v, mode) => { const b = { ...v }; if (mode === "edit") delete b.slug; return b; },
  },
  {
    key: "gallery", title: "Gallery", group: "Content", roles: SA, path: "/corporate/manage/gallery/", empty: "No photos yet.", multipart: true,
    idOf: (r) => String(r.id), rowTitle: (r) => r.alt, rowSub: (r) => r.business_name || "Whole site", rowSide: (r) => `Order ${r.sort_order}`, pill: (r) => ({ text: r.is_published ? "Shown" : "Hidden", tone: r.is_published ? "ok" : undefined }),
    fields: [
      { key: "business", label: "Shows on", kind: "select", optionsFrom: { path: "/corporate/manage/businesses/", blank: "Whole site" } },
      { key: "image", label: "Photo (JPG or PNG, up to 5 MB)", kind: "image" }, { key: "alt", label: "Describe the photo (for screen readers)" },
      { key: "caption", label: "Caption (optional, shown under the photo)" }, { key: "sort_order", label: "Order (smaller numbers come first)", kind: "int" }, { key: "is_published", label: "Shown on the website", kind: "bool" },
    ],
    create: { label: "Add a photo", defaults: { sort_order: "100", is_published: true } }, update: { method: "PATCH", path: (r) => `/corporate/manage/gallery/${r.id}/` },
    remove: { path: (r) => `/corporate/manage/gallery/${r.id}/`, label: "Delete", confirm: "Delete this photo?" },
  },
  {
    key: "contacts", title: "Contacts", group: "Content", roles: SA, path: "/corporate/manage/contacts/", empty: "No contacts yet.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.label || label(r.kind), rowSub: (r) => `${label(r.kind)} · ${r.value}`, rowSide: (r) => `Order ${r.sort_order}`, pill: (r) => ({ text: r.is_active ? "Shown" : "Hidden", tone: r.is_active ? "ok" : undefined }),
    fields: [
      { key: "kind", label: "Type", kind: "select", options: [{ value: "phone", label: "Phone" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }] },
      { key: "value", label: "Number or address", hint: "Phone number with its country code (+233240000000), a WhatsApp number (233240000000), or an email address." },
      { key: "label", label: "Name on the button, such as Sales or Support (needed when you have more than one of this type)" },
      { key: "sort_order", label: "Order (smaller numbers come first)", kind: "int" }, { key: "is_active", label: "Shown", kind: "bool" },
    ],
    create: { label: "Add a contact", defaults: { kind: "phone", sort_order: "100", is_active: true } }, update: { method: "PATCH", path: (r) => `/corporate/manage/contacts/${r.id}/` },
    toBody: (v) => ({ ...v, sort_order: Number(v.sort_order) || 0 }),
    remove: { path: (r) => `/corporate/manage/contacts/${r.id}/`, label: "Delete", confirm: "Delete this contact?" },
  },
  {
    key: "site-details", title: "Site details", intro: "The company name, wording and contact details on the corporate website.", group: "Content", roles: SA, path: "/corporate/manage/profile/", empty: "", single: true,
    idOf: () => "profile", rowTitle: (r) => r.company_name || "Site details",
    fields: [
      { key: "company_name", label: "Company name" }, { key: "tagline", label: "Tagline" }, { key: "intro", label: "Introduction (home page)", kind: "area" },
      { key: "about", label: "About us (leave a blank line between paragraphs)", kind: "area" }, { key: "vision", label: "Vision (card on the About page)", kind: "area" },
      { key: "mission", label: "Mission (card on the About page)", kind: "area" }, { key: "approach", label: "Approach (card on the About page)", kind: "area" },
      { key: "contact_email", label: "Contact email", kind: "email" }, { key: "phone", label: "Phone", kind: "phone" }, { key: "phone_label", label: "Phone name" },
      { key: "phone_2", label: "Second phone", kind: "phone" }, { key: "phone_2_label", label: "Second phone name" }, { key: "address", label: "Address", kind: "area" },
      { key: "linkedin_url", label: "LinkedIn address", kind: "url" }, { key: "instagram_url", label: "Instagram address", kind: "url" }, { key: "facebook_url", label: "Facebook address", kind: "url" }, { key: "x_url", label: "X address", kind: "url" },
    ],
    update: { method: "PUT", path: () => "/corporate/manage/profile/", label: "Save site details" },
  },
  {
    key: "pages", title: "Policy pages", intro: "The privacy policy, terms, returns policy and cookie notice shown on the shop. Each starts as a draft written from how the software works. Have your lawyer review it, edit it here, and publish it.", group: "Content", roles: SA, path: "/pages/", empty: "No pages.",
    idOf: (r) => r.slug, rowTitle: (r) => r.title, rowSub: (r) => (r.is_draft ? "Draft (not yet approved)" : "Published"), pill: (r) => ({ text: r.is_draft ? "Draft" : "Published", tone: r.is_draft ? "warn" : "ok" }),
    detail: (id) => `/pages/${id}/`,
    prefill: (r) => ({ is_published: !r.is_draft }),
    fields: [
      { key: "title", label: "Title" }, { key: "body", label: "Text (start a heading line with #, leave a blank line between paragraphs)", kind: "area" },
      { key: "is_published", label: "Published (visible to shoppers)", kind: "bool" },
    ],
    update: { method: "PUT", path: (r) => `/pages/${r.slug}/` },
  },
  // ---------------------------------------------------------------- Settings
  {
    key: "staff", title: "Staff", group: "Settings", roles: SA, path: "/staff/", empty: "No staff yet.",
    idOf: (r) => String(r.id), rowTitle: (r) => r.full_name || r.email, rowSub: (r) => `${r.email} · ${ROLE_NAMES[r.role] ?? r.role}`, pill: (r) => ({ text: r.is_active ? (r.mfa_enabled ? "Active · 2-step" : "Active") : "Off", tone: r.is_active ? "ok" : "bad" }),
    fields: [
      { key: "email", label: "Email", kind: "email" }, { key: "full_name", label: "Name" },
      { key: "role", label: "Role", kind: "select", options: Object.entries(ROLE_NAMES).filter(([k]) => k !== "super_admin").map(([value, l]) => ({ value, label: l })) },
    ],
    create: { label: "Invite someone", defaults: { role: "fulfillment" } },
    lines: (r) => [["Email", r.email], ["Role", ROLE_NAMES[r.role] ?? r.role], ["Two-step sign-in", r.mfa_enabled ? "On" : "Not set up"], ["Account", r.is_active ? "Active" : "Switched off"]] as [string, string][],
    actions: [
      ...["store_admin", "fulfillment", "finance", "support", "carrier"].map((role): Action => ({ label: `Make ${ROLE_NAMES[role].toLowerCase()}`, tone: "quiet", path: (r) => `/staff/${r.id}/`, method: "PATCH", show: (r, me) => r.role !== role && r.role !== "super_admin" && (me === "super_admin" || role !== "store_admin") && (me === "super_admin" || r.role !== "store_admin"), confirm: `Change this person's role to ${ROLE_NAMES[role]}?`, body: () => ({ role }), done: "Role changed." })),
      { label: "Switch off", tone: "danger", path: (r) => `/staff/${r.id}/`, method: "PATCH", show: (r) => r.is_active && r.role !== "super_admin", confirm: "Switch this account off? They will be signed out.", body: () => ({ is_active: false }), done: "Account switched off." },
      { label: "Switch on", path: (r) => `/staff/${r.id}/`, method: "PATCH", show: (r) => !r.is_active, body: () => ({ is_active: true }), done: "Account switched on." },
    ],
  },
  {
    key: "audit", title: "Activity log", intro: "Who did what in the back office. Entries can't be edited.", group: "Settings", roles: SA, path: "/audit/", empty: "No entries match.",
    search: { param: "search", label: "Search action, person or item" }, dates: { from: "from", to: "to" },
    idOf: (r) => String(r.id), rowTitle: (r) => r.action, rowSub: (r) => `${r.actor_email} · ${r.object_type} ${r.object_id}`, rowSide: (r) => when(r.created_at),
    lines: (r) => [["When", when(r.created_at)], ["Who", r.actor_email], ["Action", r.action], ["Item", `${r.object_type} ${r.object_id}`], ...Object.entries(r.detail ?? {}).map(([k, v]) => [k, String(v)])] as [string, string][],
    readOnly: true,
  },
];

export const byKey = (key: string) => RESOURCES.find((r) => r.key === key);

/** The menu, as the web admin groups it. Entries with `res` open a generic list; the rest open a custom screen. */
export interface NavItem { key: string; name: string; group: string; roles: string[]; res?: string; screen?: string }
export const NAV: NavItem[] = [
  { key: "manual-payments", name: "Manual payments", group: "Sell", roles: MONEY, screen: "Payments" },
  { key: "returns", name: "Returns", group: "Sell", roles: ALL_STAFF, res: "returns" },
  { key: "support", name: "Support", group: "Sell", roles: ALL_STAFF, res: "support" },
  { key: "customers", name: "Customers", group: "Sell", roles: ["super_admin", "store_admin", "support"], res: "customers" },
  { key: "coupons", name: "Promotions", group: "Sell", roles: SA, res: "coupons" },
  { key: "shipments", name: "Shipments", group: "Fulfil", roles: ["super_admin", "store_admin", "fulfillment", "carrier"], screen: "Shipments" },
  { key: "shipping-rules", name: "Shipping rules", group: "Fulfil", roles: ["super_admin", "store_admin", "fulfillment"], screen: "ShippingRules" },
  { key: "pickups", name: "Pickup locations", group: "Fulfil", roles: ["super_admin", "store_admin", "fulfillment"], res: "pickups" },
  { key: "products", name: "Products", group: "Catalog", roles: SA, screen: "Products" },
  { key: "menu-prices", name: "QT Eatery menu", group: "Catalog", roles: SA, screen: "MenuPrices" },
  { key: "stock", name: "Stock", group: "Catalog", roles: ["super_admin", "store_admin", "fulfillment"], screen: "Stock" },
  { key: "product-types", name: "Product types", group: "Catalog", roles: SA, res: "product-types" },
  { key: "reconciliation", name: "Reconciliation", group: "Money", roles: MONEY, screen: "Reconciliation" },
  { key: "chargebacks", name: "Chargebacks", group: "Money", roles: MONEY, res: "chargebacks" },
  { key: "tax", name: "Tax", group: "Money", roles: MONEY, res: "tax" },
  { key: "duties", name: "Import duties", group: "Money", roles: MONEY, res: "duties" },
  { key: "reports", name: "Reports", group: "Money", roles: ["super_admin", "store_admin", "finance", "fulfillment"], screen: "Reports" },
  { key: "pages", name: "Policy pages", group: "Content", roles: SA, res: "pages" },
  { key: "announcements", name: "Announcements", group: "Content", roles: SA, res: "announcements" },
  { key: "emails", name: "Emails", group: "Content", roles: SA, screen: "Emails" },
  { key: "businesses", name: "Businesses", group: "Content", roles: SA, res: "businesses" },
  { key: "site-details", name: "Site details", group: "Content", roles: SA, res: "site-details" },
  { key: "site-pages", name: "Site pages", group: "Content", roles: SA, res: "site-pages" },
  { key: "gallery", name: "Gallery", group: "Content", roles: SA, res: "gallery" },
  { key: "contacts", name: "Contacts", group: "Content", roles: SA, res: "contacts" },
  { key: "enquiries", name: "Enquiries", group: "Content", roles: ["super_admin", "store_admin", "support"], res: "enquiries" },
  { key: "staff", name: "Staff", group: "Settings", roles: SA, res: "staff" },
  { key: "audit", name: "Activity log", group: "Settings", roles: SA, res: "audit" },
  { key: "security", name: "Security", group: "Settings", roles: ALL_STAFF, screen: "Security" },
];
export const GROUPS = ["Sell", "Fulfil", "Catalog", "Money", "Content", "Settings"];
export const navFor = (role: string) => NAV.filter((n) => n.roles.includes(role));
