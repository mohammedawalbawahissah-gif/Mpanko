import { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { api } from "./api";
import { useAuth } from "./auth";
import { downloadAndShare } from "./files";
import { errText, rowsOf, useLoad, useRunner } from "./hooks";
import { Chooser, FieldsForm, ImagePick, type FieldDef, type ImageVal, type Opt, type Vals } from "./kit";
import { when } from "./core/resources";
import { color } from "./theme";
import { Busy, Button, Card, Empty, Field, Notice, Pill, s } from "./ui";

const label = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const opts = (...v: string[]): Opt[] => v.map((x) => ({ value: x, label: label(x) }));
const TONE: Record<string, "ok" | "warn" | "bad" | undefined> = { paid: "ok", delivered: "ok", pending_payment: "warn", cancelled: "bad", expired: "bad", refunded: "bad", exception: "bad", in_transit: "warn", out_for_delivery: "warn" };
const canFinanceRole = (r: string) => ["finance", "store_admin", "super_admin"].includes(r);
const canFulfilRole = (r: string) => ["fulfillment", "store_admin", "super_admin"].includes(r);

// ---------------------------------------------------------------- dashboard

interface DashboardData {
  role: string; orders_by_status: Record<string, number>; to_ship?: number; shipping_exceptions?: number; low_stock?: number;
  sales_last_7_days?: { day: string; currency: string; total: string; orders: number }[]; payment_exceptions?: number; unresolved_reconciliation?: number;
}

function Stat({ name, value, warn, onPress }: { name: string; value: string | number; warn?: boolean; onPress?: () => void }) {
  return (
    <View style={{ width: "50%", paddingRight: 8 }}>
      <Card onPress={onPress} label={`${name}: ${value}`}>
        <Text style={[s.muted, { marginBottom: 4 }]}>{name}</Text>
        <Text style={{ fontSize: 26, fontWeight: "800", color: warn ? color.bad : color.ink }}>{value}</Text>
      </Card>
    </View>
  );
}

export function DashboardScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api<DashboardData>("/reports/dashboard/"), []);
  const [refreshing, setRefreshing] = useState(false);
  const sales: Record<string, number> = {};
  (data?.sales_last_7_days ?? []).forEach((x) => { sales[x.currency] = (sales[x.currency] ?? 0) + Number(x.total); });
  const go = (screen: string) => () => nav.navigate(screen);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}>
      <Text style={s.h1}>Hello, {user?.full_name?.split(" ")[0] || user?.email.split("@")[0] || "there"}</Text>
      {error ? <Notice>{error}</Notice> : null}
      {!data && !error ? <Busy /> : null}
      {data ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {data.to_ship !== undefined && <Stat name="Orders to ship" value={data.to_ship} onPress={() => nav.navigate("Tabs", { screen: "Orders" })} />}
            {data.shipping_exceptions !== undefined && <Stat name="Delivery exceptions" value={data.shipping_exceptions} warn={!!data.shipping_exceptions} onPress={go("Shipments")} />}
            {data.low_stock !== undefined && <Stat name="Low-stock variants" value={data.low_stock} warn={!!data.low_stock} onPress={go("Stock")} />}
            {data.payment_exceptions !== undefined && <Stat name="Payment mismatches" value={data.payment_exceptions} warn={!!data.payment_exceptions} onPress={go("Reconciliation")} />}
            {data.unresolved_reconciliation !== undefined && <Stat name="Unresolved reconciliation items" value={data.unresolved_reconciliation} warn={!!data.unresolved_reconciliation} onPress={go("Reconciliation")} />}
            {Object.entries(sales).map(([cur, total]) => <Stat key={cur} name={`Sales, last 7 days (${cur})`} value={total.toLocaleString(undefined, { maximumFractionDigits: 2 })} />)}
          </View>
          <Text style={s.h2}>Orders by status</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {Object.entries(data.orders_by_status).map(([k, n]) => <Stat key={k} name={label(k)} value={n} />)}
          </View>
          {Object.keys(data.orders_by_status).length === 0 ? <Empty>No orders yet.</Empty> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- orders

interface OrderRow { number: string; status: string; currency: string; grand_total: string; item_count: number; created_at: string }

export function OrdersScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("-created_at");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const path = `/orders/?ordering=${sort}${status ? `&status=${status}` : ""}${query ? `&search=${encodeURIComponent(query)}` : ""}${from ? `&placed_from=${from}` : ""}${to ? `&placed_to=${to}` : ""}`;
  const { data, error, reload } = useLoad(() => api<unknown>(path), [path]);
  const [refreshing, setRefreshing] = useState(false);
  const list = data ? rowsOf<OrderRow>(data) : null;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      data={list ?? []}
      keyExtractor={(o) => o.number}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <>
          <Field label="Order number or email" value={q} onChangeText={setQ} autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => setQuery(q.trim())} />
          <Chooser label="Status" value={status} options={[{ value: "", label: "All" }, ...opts("pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "expired", "refunded")]} onPick={setStatus} />
          <Field label="Placed from (YYYY-MM-DD)" value={from} onChangeText={setFrom} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          <Field label="Placed until (YYYY-MM-DD)" value={to} onChangeText={setTo} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          <Chooser label="Sort by" value={sort} options={[{ value: "-created_at", label: "Newest first" }, { value: "created_at", label: "Oldest first" }, { value: "-grand_total", label: "Total: high to low" }, { value: "grand_total", label: "Total: low to high" }, { value: "status", label: "Status" }]} onPick={setSort} />
          <Button title="Search" tone="quiet" onPress={() => setQuery(q.trim())} />
          {error ? <Notice>{error}</Notice> : null}
        </>
      }
      ListEmptyComponent={list ? <Empty>No orders match.</Empty> : <Busy />}
      renderItem={({ item }) => (
        <Card onPress={() => nav.navigate("Order", { number: item.number })} label={`Order ${item.number}, ${label(item.status)}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={[s.body, { fontWeight: "800" }]}>{item.number}</Text>
            <Text style={[s.body, { fontWeight: "700" }]}>{item.currency} {item.grand_total}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Pill text={label(item.status)} tone={TONE[item.status]} />
            <Text style={s.muted}>{item.item_count} item{item.item_count === 1 ? "" : "s"} · {when(item.created_at)}</Text>
          </View>
        </Card>
      )}
    />
  );
}

interface OrderFull {
  number: string; status: string; currency: string; subtotal: string; shipping_total: string; tax_total: string; grand_total: string; fx_rate_note: string;
  contact_email: string; shipping_address: Record<string, string>; shipping_service: { service_name?: string }; paid_at: string | null; created_at: string;
  items: { sku: string; product_name: string; variant_name: string; quantity: number; line_total: string }[];
  events: { to_status: string; note: string; created_at: string }[];
  shipments: { id: number; carrier_name: string | null; tracking_number: string; status: string }[];
}
const NEXT: Record<string, string[]> = {
  pending_payment: ["cancelled"], paid: ["processing", "cancelled", "refunded"], processing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"], delivered: ["refunded"], cancelled: [], expired: [], refunded: [],
};

export function OrderScreen({ route }: { route: { params: { number: string } } }) {
  const { number } = route.params;
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { user } = useAuth();
  const role = user?.role ?? "";
  const { data: o, error, reload } = useLoad(() => api<OrderFull>(`/orders/${number}/`), [number]);
  const { msg, setMsg, busy, run } = useRunner();
  const [note, setNote] = useState("");
  if (!o) return <ScrollView contentContainerStyle={{ padding: 16 }}>{error ? <Notice>{error}</Notice> : <Busy />}</ScrollView>;
  const a = o.shipping_address;
  const steps = (NEXT[o.status] ?? []).filter((t) => (t === "refunded" ? false : canFulfilRole(role) || t === "cancelled"));
  const isPickup = /pickup/i.test(o.shipping_service?.service_name ?? "");
  const sure = (title: string, text: string, fn: () => void) => { /* confirmation lives in the button label for brevity */ void title; void text; fn(); };
  void sure;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Order {o.number}</Text>
      <Pill text={label(o.status)} tone={TONE[o.status]} />
      <Text style={[s.muted, { marginTop: 6 }]}>Placed {when(o.created_at)}{o.paid_at ? ` · paid ${when(o.paid_at)}` : ""}</Text>
      {msg ? <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View> : null}
      <Text style={s.h2}>Items</Text>
      <Card>
        {o.items.map((i) => (
          <View key={i.sku} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
            <Text style={[s.body, { flex: 1, paddingRight: 8 }]}>{i.quantity} × {i.product_name}{i.variant_name ? ` (${i.variant_name})` : ""}</Text>
            <Text style={s.body}>{o.currency} {i.line_total}</Text>
          </View>
        ))}
        {([["Items", o.subtotal], ["Shipping", o.shipping_total], ["Tax", o.tax_total]] as const).map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 4 }}><Text style={s.muted}>{k}</Text><Text style={s.muted}>{o.currency} {v}</Text></View>
        ))}
        <View style={{ borderTopWidth: 1, borderColor: color.line, marginTop: 8, paddingTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[s.body, { fontWeight: "800" }]}>Total</Text><Text style={[s.body, { fontWeight: "800" }]}>{o.currency} {o.grand_total}</Text>
        </View>
        {o.fx_rate_note ? <Text style={[s.muted, { marginTop: 6 }]}>{o.fx_rate_note}</Text> : null}
      </Card>
      <Button title="Download invoice (PDF)" tone="quiet" onPress={() => run(() => downloadAndShare(`/orders/${o.number}/invoice/`, `invoice-${o.number}.pdf`), "Invoice ready.")} />
      <Text style={s.h2}>Customer</Text>
      <Card>
        <Text style={s.body}>{a.recipient_name}</Text>
        <Text style={s.muted}>{o.contact_email}{a.phone ? ` · ${a.phone}` : ""}</Text>
        <Text style={[s.body, { marginTop: 6 }]}>{[a.line1, a.line2, a.city, a.region, a.postal_code, a.country].filter(Boolean).join(", ")}</Text>
        <Text style={[s.muted, { marginTop: 6 }]}>{o.shipping_service?.service_name ?? ""}</Text>
      </Card>
      <Text style={s.h2}>Actions</Text>
      {(NEXT[o.status] ?? []).length === 0 ? <Text style={s.muted}>No further actions for this status.</Text> : null}
      {steps.length ? <Field label="Note (optional)" value={note} onChangeText={setNote} /> : null}
      {steps.map((to) => <Button key={to} title={`Mark ${label(to).toLowerCase()}`} tone={to === "cancelled" ? "danger" : "primary"} busy={busy} onPress={() => run(() => api(`/orders/${o.number}/transition/`, { method: "POST", body: { to, note } }), `Order moved to ${label(to).toLowerCase()}.`, () => { setNote(""); reload(); })} />)}
      {canFulfilRole(role) && ["paid", "processing"].includes(o.status) && isPickup ? <Button title="Tell customer it is ready to collect" tone="quiet" busy={busy} onPress={() => run(() => api(`/orders/${o.number}/ready-for-pickup/`, { method: "POST" }), "The customer has been told their order is ready to collect.")} /> : null}
      {canFinanceRole(role) && ["paid", "processing", "shipped", "delivered", "cancelled"].includes(o.status) ? <RefundBox order={o} onDone={reload} /> : null}
      {canFulfilRole(role) && ["paid", "processing", "shipped"].includes(o.status) ? <ShipmentBox order={o} onDone={reload} setMsg={setMsg} /> : null}
      <Text style={s.h2}>Shipments</Text>
      {o.shipments.length === 0 ? <Text style={s.muted}>None yet.</Text> : null}
      {o.shipments.map((sh) => (
        <Card key={sh.id} onPress={() => nav.navigate("Shipment", { id: String(sh.id) })} label={`Shipment ${sh.id}`}>
          <Text style={s.body}>{sh.carrier_name ?? "No carrier"} {sh.tracking_number}</Text>
          <View style={{ marginTop: 6 }}><Pill text={label(sh.status)} tone={TONE[sh.status]} /></View>
        </Card>
      ))}
      <Text style={s.h2}>History</Text>
      <Card>
        {[...o.events].reverse().map((e, i) => (
          <View key={i} style={{ paddingVertical: 4 }}>
            <Text style={[s.body, { fontWeight: "700" }]}>{label(e.to_status)}{e.note ? ` · ${e.note}` : ""}</Text>
            <Text style={s.muted}>{when(e.created_at)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function RefundBox({ order, onDone }: { order: OrderFull; onDone: () => void }) {
  const { msg, busy, run } = useRunner();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Card>
      <Text style={[s.body, { fontWeight: "800", marginBottom: 8 }]}>Refund money to the customer</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Field label={`Amount in ${order.currency} (blank = everything left)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Reason" value={reason} onChangeText={setReason} />
      <Button title="Issue refund" tone="danger" busy={busy} onPress={() => run(() => api<{ amount: string; currency: string; status: string }>("/payments/refunds/", { method: "POST", body: { order_number: order.number, amount: amount || null, reason } }), (r) => `Refund of ${r.currency} ${r.amount} is ${r.status}.`, () => { setAmount(""); onDone(); })} />
    </Card>
  );
}

function ShipmentBox({ order, onDone, setMsg }: { order: OrderFull; onDone: () => void; setMsg: (m: { kind: "ok" | "error"; text: string } | null) => void }) {
  const chosen = order.shipping_service?.service_name ?? "";
  const { busy, run } = useRunner();
  const [vals, setVals] = useState<Vals>({ carrier: "", tracking_number: "", service_name: chosen, override_reason: "" });
  const fields: FieldDef[] = [
    { key: "carrier", label: "Carrier", kind: "select", optionsFrom: { path: "/carriers/", blank: "Not assigned" } },
    { key: "tracking_number", label: "Tracking number" }, { key: "service_name", label: "Service" },
    { key: "override_reason", label: "Why not the customer's choice?", show: (v) => !!chosen && v.service_name !== chosen },
  ];
  return (
    <Card>
      <Text style={[s.body, { fontWeight: "800", marginBottom: 8 }]}>Create shipment</Text>
      <FieldsForm fields={fields} vals={vals} setVals={(f) => setVals(f)} />
      <Button title="Create shipment" busy={busy} onPress={async () => { setMsg(null); await run(() => api("/shipments/", { method: "POST", body: { order_number: order.number, carrier: vals.carrier ? Number(vals.carrier) : null, tracking_number: vals.tracking_number, service_name: vals.service_name, override_reason: vals.override_reason } }), "Shipment created.", onDone); }} />
    </Card>
  );
}

// ---------------------------------------------------------------- shipments

interface ShipmentRow {
  id: number; order_number: string; carrier_name: string | null; service_name: string; tracking_number: string; status: string; created_at: string;
  events: { id: number; status: string; description: string; location: string; occurred_at: string }[];
  items?: { order_item: number; sku: string; product_name: string; quantity: number }[];
  pod_recipient?: string; pod_note?: string; pod_photo?: string; delivered_at?: string | null; has_label?: boolean; service_code?: string;
}

export function ShipmentsScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [status, setStatus] = useState("");
  const { data, error } = useLoad(() => api<unknown>(`/shipments/${status ? `?status=${status}` : ""}`), [status]);
  const list = data ? rowsOf<ShipmentRow>(data) : null;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={list ?? []}
      keyExtractor={(x) => String(x.id)}
      ListHeaderComponent={<><Chooser label="Status" value={status} options={[{ value: "", label: "All" }, ...opts("pending", "assigned", "accepted", "declined", "in_transit", "out_for_delivery", "delivered", "exception", "returned")]} onPick={setStatus} />{error ? <Notice>{error}</Notice> : null}</>}
      ListEmptyComponent={list ? <Empty>No shipments here.</Empty> : <Busy />}
      renderItem={({ item }) => (
        <Card onPress={() => nav.navigate("Shipment", { id: String(item.id) })} label={`Shipment ${item.id}`}>
          <Text style={[s.body, { fontWeight: "800" }]}>#{item.id} · Order {item.order_number}</Text>
          <Text style={s.muted}>{item.carrier_name ?? "No carrier"} · {item.service_name || "—"} · {item.tracking_number || "No tracking yet"}</Text>
          <View style={{ marginTop: 6 }}><Pill text={label(item.status)} tone={TONE[item.status]} /></View>
        </Card>
      )}
    />
  );
}

const LABEL_SERVICES: Opt[] = [
  { value: "", label: "The service the customer chose" },
  { value: "dhl:P", label: "DHL Express Worldwide" }, { value: "dhl:D", label: "DHL Express Worldwide (documents)" },
  { value: "fedex:INTERNATIONAL_PRIORITY", label: "FedEx International Priority" }, { value: "fedex:INTERNATIONAL_ECONOMY", label: "FedEx International Economy" },
  { value: "ups:07", label: "UPS Worldwide Express" }, { value: "ups:08", label: "UPS Worldwide Expedited" }, { value: "ups:11", label: "UPS Standard" }, { value: "ups:54", label: "UPS Worldwide Express Plus" },
];

export function ShipmentScreen({ route }: { route: { params: { id: string } } }) {
  const id = route.params.id;
  const { user } = useAuth();
  const isCarrier = user?.role === "carrier";
  const { data: sh, error, reload } = useLoad(() => api<ShipmentRow>(`/shipments/${id}/`), [id]);
  const { msg, busy, run } = useRunner();
  const [reason, setReason] = useState("");
  const [recipient, setRecipient] = useState("");
  const [podNote, setPodNote] = useState("");
  const [photo, setPhoto] = useState<ImageVal>(null);
  const [status, setStatus] = useState("in_transit");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [service, setService] = useState("");
  const [pickup, setPickup] = useState("");
  const pickups = useLoad(() => api<unknown>("/shipping/pickups/").catch(() => []), []);
  const pickupOpts = useMemo<Opt[]>(() => [{ value: "", label: "Default pickup location" }, ...rowsOf<{ id: number; name: string; is_active: boolean }>(pickups.data).filter((p) => p.is_active).map((p) => ({ value: String(p.id), label: p.name }))], [pickups.data]);
  if (!sh) return <ScrollView contentContainerStyle={{ padding: 16 }}>{error ? <Notice>{error}</Notice> : <Busy />}</ScrollView>;
  const options = isCarrier ? ["accepted", "declined", "in_transit", "out_for_delivery", "delivered", "exception"] : ["pending", "assigned", "accepted", "declined", "in_transit", "out_for_delivery", "delivered", "exception", "returned"];
  const act = (path: string, body: unknown, done: string) => run(() => api(`/shipments/${sh.id}/${path}/`, { method: "POST", body }), done, reload);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Shipment #{sh.id}</Text>
      <Pill text={label(sh.status)} tone={TONE[sh.status]} />
      <Text style={[s.muted, { marginTop: 6 }]}>Order {sh.order_number} · {sh.carrier_name ?? "No carrier"} · {sh.service_name || "—"} · Tracking {sh.tracking_number || "—"}</Text>
      {sh.items?.length ? <Text style={[s.body, { marginTop: 6 }]}>In this parcel: {sh.items.map((i) => `${i.quantity} × ${i.product_name}`).join(", ")}</Text> : null}
      {msg ? <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View> : null}
      {!isCarrier ? (
        <>
          <Text style={s.h2}>Shipping label</Text>
          <Card>
            {sh.has_label ? (
              <><Text style={s.body}>Label created for {sh.service_code || "this service"}.</Text><Button title="Download label" tone="quiet" onPress={() => run(() => downloadAndShare(`/shipments/${sh.id}/label/`, `label-${sh.order_number}.pdf`), "Label ready.")} /></>
            ) : (
              <>
                <Text style={[s.muted, { marginBottom: 8 }]}>Works for DHL, FedEx and UPS carriers. Leave the service blank to use the one the customer chose.</Text>
                <Chooser label="Carrier service code" value={service} options={LABEL_SERVICES} onPick={setService} />
                <Chooser label="Collect from" value={pickup} options={pickupOpts} onPick={setPickup} />
                <Button title="Create label" busy={busy} onPress={() => run(() => api(`/shipments/${sh.id}/label/`, { method: "POST", body: { ...(service ? { service_code: service.trim() } : {}), ...(pickup ? { pickup: Number(pickup) } : {}) } }), "Label created and tracking number saved.", reload)} />
              </>
            )}
          </Card>
        </>
      ) : null}
      {sh.status === "assigned" ? (
        <>
          <Text style={s.h2}>New delivery job</Text>
          <Card>
            <Button title="Accept job" busy={busy} onPress={() => act("accept", {}, "Job accepted.")} />
            <Field label="Reason, if declining" value={reason} onChangeText={setReason} />
            <Button title="Decline job" tone="quiet" disabled={!reason.trim()} onPress={() => act("decline", { reason }, "Job declined.")} />
          </Card>
        </>
      ) : null}
      {["accepted", "in_transit", "out_for_delivery", "exception", "assigned"].includes(sh.status) ? (
        <>
          <Text style={s.h2}>Proof of delivery</Text>
          <Card>
            <Field label="Received by" value={recipient} onChangeText={setRecipient} />
            <Field label="Note" value={podNote} onChangeText={setPodNote} />
            <ImagePick label="Photo of the parcel or signed slip (optional)" value={photo} onChange={setPhoto} />
            <Button title="Mark delivered" busy={busy} disabled={!recipient.trim()} onPress={() => {
              let body: unknown = { recipient_name: recipient, note: podNote };
              if (photo && photo !== "remove") { const f = new FormData(); f.append("recipient_name", recipient); f.append("note", podNote); f.append("photo", { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob); body = f; }
              return act("proof", body, "Marked delivered.");
            }} />
          </Card>
        </>
      ) : null}
      {sh.status === "delivered" && sh.pod_recipient ? <Text style={[s.body, { marginTop: 12 }]}>Delivered {when(sh.delivered_at)}. Received by {sh.pod_recipient}{sh.pod_note ? ` · ${sh.pod_note}` : ""}</Text> : null}
      <Text style={s.h2}>Add an update</Text>
      <Card>
        <Chooser label="Status" value={status} options={opts(...options)} onPick={setStatus} />
        <Field label="What happened" value={description} onChangeText={setDescription} />
        <Field label="Location" value={location} onChangeText={setLocation} />
        <Button title="Save update" busy={busy} onPress={() => run(() => api(`/shipments/${sh.id}/events/`, { method: "POST", body: { status, description, location } }), "Update saved. The customer can see it.", () => { setDescription(""); setLocation(""); reload(); })} />
        {!isCarrier ? <Button title="Pull latest from carrier" tone="quiet" busy={busy} onPress={() => run(() => api<{ new_events: number }>(`/shipments/${sh.id}/refresh/`, { method: "POST", body: {} }), (r) => `${r.new_events} new tracking event${r.new_events === 1 ? "" : "s"} from the carrier.`, reload)} /> : null}
      </Card>
      <Text style={s.h2}>Tracking</Text>
      <Card>
        {[...sh.events].reverse().map((e) => (
          <View key={e.id} style={{ paddingVertical: 4 }}>
            <Text style={[s.body, { fontWeight: "700" }]}>{e.description || label(e.status)} · {label(e.status)}</Text>
            <Text style={s.muted}>{when(e.occurred_at)}{e.location ? ` · ${e.location}` : ""}</Text>
          </View>
        ))}
        {sh.events.length === 0 ? <Text style={s.muted}>No events yet.</Text> : null}
      </Card>
    </ScrollView>
  );
}

// ---------------------------------------------------------------- stock

interface StockRow { id: number; sku: string; name: string; quantity: number | null; low_stock_threshold?: number | null; allow_backorder?: boolean; backorder_days?: number | null }

export function StockScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [low, setLow] = useState(false);
  const { data, error } = useLoad(() => api<unknown>(`/inventory/?page_size=200${low ? "&low=1" : ""}`), [low]);
  const list = data ? rowsOf<StockRow>(data) : null;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={list ?? []}
      keyExtractor={(x) => String(x.id)}
      ListHeaderComponent={<><Button title={low ? "Showing low stock only. Show all" : "Show only low stock"} tone="quiet" onPress={() => setLow(!low)} />{error ? <Notice>{error}</Notice> : null}</>}
      ListEmptyComponent={list ? <Empty>Nothing to show.</Empty> : <Busy />}
      renderItem={({ item }) => (
        <Card onPress={() => nav.navigate("Adjust", { id: String(item.id) })} label={`${item.sku}, ${item.quantity ?? "not tracked"}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[s.body, { fontWeight: "800" }]}>{item.sku}</Text>
            <Text style={[s.body, { fontWeight: "800", color: item.low_stock_threshold != null && item.quantity != null && item.quantity <= item.low_stock_threshold ? color.bad : color.ink }]}>{item.quantity ?? "—"}</Text>
          </View>
          <Text style={s.muted}>{item.name} · alert at {item.low_stock_threshold ?? "—"}{item.allow_backorder ? " · backorder on" : ""}</Text>
        </Card>
      )}
    />
  );
}

export function AdjustScreen({ route }: { route: { params: { id: string } } }) {
  const id = route.params.id;
  const row = useLoad(() => api<unknown>(`/inventory/?page_size=200`).then((d) => rowsOf<StockRow>(d).find((x) => String(x.id) === id) ?? null), [id]);
  const moves = useLoad(() => api<{ id: number; delta: number; reason: string; note: string; actor_email: string | null; order_ref: string | null; created_at: string }[]>(`/inventory/${id}/movements/`), [id]);
  const { msg, busy, run } = useRunner();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("restock");
  const [note, setNote] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [back, setBack] = useState<boolean | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const r = row.data;
  if (!r) return <ScrollView contentContainerStyle={{ padding: 16 }}>{row.error ? <Notice>{row.error}</Notice> : <Busy />}</ScrollView>;
  const lv = level ?? String(r.low_stock_threshold ?? "");
  const bo = back ?? !!r.allow_backorder;
  const dy = days ?? String(r.backorder_days ?? "");
  const refresh = () => { row.reload(); moves.reload(); };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{r.sku}</Text>
      <Text style={s.muted}>{r.name} · on hand {r.quantity ?? "not tracked"}</Text>
      {msg ? <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View> : null}
      <Text style={s.h2}>Change the count</Text>
      <Card>
        <Field label="Change (use a minus to remove)" value={delta} onChangeText={setDelta} keyboardType="numbers-and-punctuation" />
        <Chooser label="Reason" value={reason} options={[{ value: "restock", label: "Restock" }, { value: "adjustment", label: "Correction" }, { value: "return", label: "Customer return" }]} onPick={setReason} />
        <Field label="Note" value={note} onChangeText={setNote} />
        <Button title="Save change" busy={busy} disabled={!delta.trim()} onPress={() => run(() => api(`/inventory/${id}/adjust/`, { method: "POST", body: { delta: Number(delta), reason, note } }), "Stock updated.", () => { setDelta(""); setNote(""); refresh(); })} />
      </Card>
      <Text style={s.h2}>Alerts and backorder</Text>
      <Card>
        <Field label="Email staff when stock falls to" value={lv} onChangeText={setLevel} keyboardType="number-pad" />
        <Button title="Save alert level" tone="quiet" busy={busy} onPress={() => run(() => api(`/inventory/${id}/threshold/`, { method: "PATCH", body: { low_stock_threshold: Number(lv) } }), "Alert level saved.", refresh)} />
        <FieldsForm fields={[{ key: "b", label: "Let customers order when it is out of stock (backorder)", kind: "bool" }]} vals={{ b: bo }} setVals={(f) => setBack(!!f({ b: bo }).b)} />
        {bo ? <Field label="Usual wait in days (optional)" value={dy} onChangeText={setDays} keyboardType="number-pad" /> : null}
        <Button title="Save backorder setting" tone="quiet" busy={busy} onPress={() => run(() => api(`/inventory/${id}/backorder/`, { method: "PATCH", body: { allow_backorder: bo, backorder_days: bo && dy ? Number(dy) : null } }), "Backorder setting saved.", refresh)} />
      </Card>
      <Text style={s.h2}>Recent changes</Text>
      <Card>
        {(moves.data ?? []).map((m) => (
          <View key={m.id} style={{ paddingVertical: 4 }}>
            <Text style={[s.body, { fontWeight: "700" }]}>{m.delta > 0 ? `+${m.delta}` : m.delta} · {label(m.reason)}{m.order_ref ? ` · ${m.order_ref}` : ""}</Text>
            <Text style={s.muted}>{when(m.created_at)} · {m.actor_email ?? "system"}{m.note ? ` · ${m.note}` : ""}</Text>
          </View>
        ))}
        {moves.data && moves.data.length === 0 ? <Text style={s.muted}>No changes yet.</Text> : null}
        {moves.error ? <Text style={{ color: color.bad }}>{moves.error || errText(null)}</Text> : null}
      </Card>
    </ScrollView>
  );
}
