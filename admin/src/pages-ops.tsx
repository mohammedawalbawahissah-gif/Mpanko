import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, downloadFile, type Page } from "./api";
import { useAuth } from "./auth";
import { Alert, Field, Loading, Pill, Stat, errText, label, useAsync, when } from "./ui";

/* ------------------------------------------------------------- dashboard */

interface DashboardData {
  role: string;
  orders_by_status: Record<string, number>;
  to_ship?: number;
  shipping_exceptions?: number;
  low_stock?: number;
  sales_last_7_days?: { day: string; currency: string; total: string; orders: number }[];
  payment_exceptions?: number;
  unresolved_reconciliation?: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading } = useAsync(() => api<DashboardData>("/reports/dashboard/"), []);
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error || "Couldn't load the dashboard."}</Alert>;
  const sales: Record<string, number> = {};
  (data.sales_last_7_days ?? []).forEach((s) => (sales[s.currency] = (sales[s.currency] ?? 0) + Number(s.total)));
  return (
    <>
      <h1>Hello, {user?.full_name.split(" ")[0] || "there"}</h1>
      <div className="stats">
        {data.to_ship !== undefined && <Stat name="Orders to ship" value={data.to_ship} />}
        {data.shipping_exceptions !== undefined && <Stat name="Delivery exceptions" value={data.shipping_exceptions} tone={data.shipping_exceptions ? "warn" : undefined} />}
        {data.low_stock !== undefined && <Stat name="Low-stock variants" value={data.low_stock} tone={data.low_stock ? "warn" : undefined} />}
        {data.payment_exceptions !== undefined && <Stat name="Payment mismatches" value={data.payment_exceptions} tone={data.payment_exceptions ? "warn" : undefined} />}
        {data.unresolved_reconciliation !== undefined && <Stat name="Unresolved reconciliation items" value={data.unresolved_reconciliation} tone={data.unresolved_reconciliation ? "warn" : undefined} />}
        {Object.entries(sales).map(([cur, total]) => <Stat key={cur} name={`Sales, last 7 days (${cur})`} value={total.toLocaleString(undefined, { maximumFractionDigits: 2 })} />)}
      </div>
      <h2>Orders by status</h2>
      <div className="stats">
        {Object.entries(data.orders_by_status).map(([s, n]) => <Stat key={s} name={label(s)} value={n} />)}
        {Object.keys(data.orders_by_status).length === 0 && <p className="muted">No orders yet.</p>}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- orders */

interface OrderRow { number: string; status: string; currency: string; grand_total: string; item_count: number; created_at: string }

export function Orders() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useAsync(
    () => api<Page<OrderRow>>(`/orders/?ordering=-created_at${status ? `&status=${status}` : ""}${query ? `&search=${encodeURIComponent(query)}` : ""}`),
    [status, query]
  );
  return (
    <>
      <h1>Orders</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <Field id="f-q" label="Order number or email"><input id="f-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field id="f-s" label="Status">
          <select id="f-s" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "expired", "refunded"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
        <button className="btn quiet">Search</button>
      </form>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Order</th><th>Placed</th><th>Status</th><th className="num">Items</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.results.map((o) => (
                <tr key={o.number}>
                  <td><Link to={`/orders/${o.number}`}>{o.number}</Link></td>
                  <td>{when(o.created_at)}</td>
                  <td><Pill value={o.status} /></td>
                  <td className="num">{o.item_count}</td>
                  <td className="num">{o.currency} {o.grand_total}</td>
                </tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={5} className="muted">No orders match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface OrderFull {
  number: string; status: string; currency: string; subtotal: string; shipping_total: string; tax_total: string; grand_total: string;
  fx_rate_note: string; contact_email: string; shipping_address: Record<string, string>; shipping_service: { service_name?: string };
  paid_at: string | null; created_at: string;
  items: { sku: string; product_name: string; variant_name: string; quantity: number; line_total: string }[];
  events: { to_status: string; note: string; created_at: string }[];
  shipments: { id: number; carrier_name: string | null; tracking_number: string; status: string }[];
}

const NEXT: Record<string, string[]> = {
  pending_payment: ["cancelled"],
  paid: ["processing", "cancelled", "refunded"],
  processing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  expired: [],
  refunded: [],
};

export function OrderDetail() {
  const { number = "" } = useParams();
  const { user } = useAuth();
  const { data: o, error, loading, reload } = useAsync(() => api<OrderFull>(`/orders/${number}/`), [number]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error || !o) return <Alert>{error || "Order not found."}</Alert>;

  const canFinance = user?.role === "finance" || user?.role === "store_admin" || user?.role === "super_admin";
  const canFulfil = user?.role === "fulfillment" || user?.role === "store_admin" || user?.role === "super_admin";

  const move = async (to: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/orders/${o.number}/transition/`, { method: "POST", body: { to, note } });
      setNote("");
      setMsg({ kind: "ok", text: `Order moved to ${label(to).toLowerCase()}.` });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="small"><Link to="/orders">Orders</Link></p>
      <h1>Order {o.number} <Pill value={o.status} /></h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="two">
        <section>
          <h2 style={{ marginTop: 0 }}>Items</h2>
          <table className="table">
            <tbody>
              {o.items.map((i) => (
                <tr key={i.sku}><td>{i.quantity} × {i.product_name}{i.variant_name && ` (${i.variant_name})`}<br /><span className="muted small">{i.sku}</span></td><td className="num">{o.currency} {i.line_total}</td></tr>
              ))}
              <tr><td className="muted">Delivery · {o.shipping_service.service_name ?? ""}</td><td className="num">{o.currency} {o.shipping_total}</td></tr>
              <tr><td className="muted">Tax</td><td className="num">{o.currency} {o.tax_total}</td></tr>
              <tr><th>Total</th><th className="num">{o.currency} {o.grand_total}</th></tr>
            </tbody>
          </table>
          {o.fx_rate_note && <p className="small muted">{o.fx_rate_note}</p>}
          {o.status !== "pending_payment" && o.status !== "cancelled" && (
            <p><button className="btn quiet" onClick={() => downloadFile(`/orders/${o.number}/invoice/`, `invoice-${o.number}.pdf`).catch((e) => setMsg({ kind: "error", text: errText(e) }))}>Download invoice (PDF)</button></p>
          )}
          <h2>Customer</h2>
          <p>
            {o.contact_email}<br />
            {o.shipping_address.recipient_name}, {o.shipping_address.phone}<br />
            {o.shipping_address.line1}{o.shipping_address.line2 && `, ${o.shipping_address.line2}`}<br />
            {o.shipping_address.city}{o.shipping_address.region && `, ${o.shipping_address.region}`} {o.shipping_address.postal_code} {o.shipping_address.country}
          </p>
        </section>
        <section>
          <h2 style={{ marginTop: 0 }}>Actions</h2>
          {(NEXT[o.status] ?? []).length === 0 && <p className="muted">No further actions for this status.</p>}
          <Field id="note" label="Note (optional)"><input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            {(NEXT[o.status] ?? []).filter((t) => (t === "refunded" ? canFinance : canFulfil || t === "cancelled")).filter((t) => t !== "refunded").map((to) => (
              <button key={to} className={`btn ${to === "cancelled" ? "danger" : ""}`} disabled={busy} onClick={() => move(to)}>Mark {label(to).toLowerCase()}</button>
            ))}
          </div>
          {canFinance && ["paid", "processing", "shipped", "delivered", "cancelled"].includes(o.status) && <RefundForm order={o} onDone={reload} />}
          {canFulfil && ["paid", "processing", "shipped"].includes(o.status) && <ShipmentForm orderNumber={o.number} chosen={o.shipping_service.service_name ?? ""} onDone={reload} />}

          <h2>Shipments</h2>
          {o.shipments.length === 0 && <p className="muted">None yet.</p>}
          {o.shipments.map((s) => (
            <p key={s.id}><Link to={`/shipments/${s.id}`}>{s.carrier_name ?? "No carrier"} {s.tracking_number}</Link> <Pill value={s.status} /></p>
          ))}
          <h2>History</h2>
          <ol className="timeline">
            {[...o.events].reverse().map((e, i) => (
              <li key={i}><strong>{label(e.to_status)}</strong>{e.note && ` · ${e.note}`}<div className="small muted">{when(e.created_at)}</div></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function RefundForm({ order, onDone }: { order: OrderFull; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(`Refund ${amount ? `${order.currency} ${amount}` : "the full remaining amount"} to the customer? This can't be undone.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ amount: string; currency: string; status: string }>("/payments/refunds/", {
        method: "POST",
        body: { order_number: order.number, amount: amount || null, reason },
      });
      setMsg({ kind: "ok", text: `Refund of ${r.currency} ${r.amount} is ${r.status}.` });
      setAmount("");
      onDone();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: "1rem" }}>
      <strong>Refund</strong>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="row" style={{ marginTop: "0.75rem" }}>
        <Field id="r-amt" label={`Amount in ${order.currency} (blank = everything left)`}><input id="r-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field id="r-why" label="Reason"><input id="r-why" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn danger" disabled={busy}>Issue refund</button>
      </div>
    </form>
  );
}

interface CarrierOpt { id: number; name: string }

function ShipmentForm({ orderNumber, chosen, onDone }: { orderNumber: string; chosen: string; onDone: () => void }) {
  const carriers = useAsync(() => api<Page<CarrierOpt> | CarrierOpt[]>("/carriers/").catch(() => [] as CarrierOpt[]), []);
  const list: CarrierOpt[] = Array.isArray(carriers.data) ? carriers.data : carriers.data?.results ?? [];
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [service, setService] = useState(chosen);
  const [override, setOverride] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/shipments/", {
        method: "POST",
        body: { order_number: orderNumber, carrier: carrier ? Number(carrier) : null, tracking_number: tracking, service_name: service, override_reason: override },
      });
      setMsg({ kind: "ok", text: "Shipment created." });
      onDone();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: "1rem" }}>
      <strong>Create shipment</strong>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="row" style={{ marginTop: "0.75rem" }}>
        <Field id="s-car" label="Carrier">
          <select id="s-car" className="select" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            <option value="">Not assigned</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field id="s-trk" label="Tracking number"><input id="s-trk" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
        <Field id="s-svc" label="Service"><input id="s-svc" className="input" value={service} onChange={(e) => setService(e.target.value)} /></Field>
        {service !== chosen && chosen && <Field id="s-ov" label="Why not the customer's choice?"><input id="s-ov" className="input" value={override} onChange={(e) => setOverride(e.target.value)} required /></Field>}
        <button className="btn">Create shipment</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- shipments */

interface ShipmentRow {
  id: number; order_number: string; carrier_name: string | null; service_name: string; tracking_number: string; status: string; created_at: string;
  events: { id: number; status: string; description: string; location: string; occurred_at: string }[];
  items?: { order_item: number; sku: string; product_name: string; quantity: number }[];
  pod_recipient?: string; pod_note?: string; pod_photo?: string; delivered_at?: string | null;
  has_label?: boolean; service_code?: string; label_reference?: string;
}

export function Shipments() {
  const [status, setStatus] = useState("");
  const { data, error, loading } = useAsync(() => api<Page<ShipmentRow>>(`/shipments/${status ? `?status=${status}` : ""}`), [status]);
  return (
    <>
      <h1>Shipments</h1>
      <div className="row">
        <Field id="sf" label="Status">
          <select id="sf" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["pending", "assigned", "accepted", "declined", "in_transit", "out_for_delivery", "delivered", "exception", "returned"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Shipment</th><th>Order</th><th>Carrier</th><th>Tracking</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {data.results.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/shipments/${s.id}`}>#{s.id}</Link></td>
                  <td>{s.order_number}</td><td>{s.carrier_name ?? "—"}</td><td>{s.tracking_number || "—"}</td>
                  <td><Pill value={s.status} /></td><td>{when(s.created_at)}</td>
                </tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={6} className="muted">No shipments.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ShipmentDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: s, error, loading, reload } = useAsync(() => api<ShipmentRow>(`/shipments/${id}/`), [id]);
  const [status, setStatus] = useState("in_transit");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [recipient, setRecipient] = useState("");
  const [podNote, setPodNote] = useState("");
  const [podPhoto, setPodPhoto] = useState<File | null>(null);
  if (loading) return <Loading />;
  if (error || !s) return <Alert>{error || "Shipment not found."}</Alert>;
  const isCarrier = user?.role === "carrier";

  const act = async (path: string, body: object, done: string) => {
    setMsg(null);
    try {
      await api(`/shipments/${s.id}/${path}/`, { method: "POST", body });
      setMsg({ kind: "ok", text: done });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api(`/shipments/${s.id}/events/`, { method: "POST", body: { status, description, location } });
      setDescription("");
      setLocation("");
      setMsg({ kind: "ok", text: "Update saved. The customer can see it." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };
  const refresh = async () => {
    setMsg(null);
    try {
      const r = await api<{ new_events: number }>(`/shipments/${s.id}/refresh/`, { method: "POST", body: {} });
      setMsg({ kind: "ok", text: `${r.new_events} new tracking event${r.new_events === 1 ? "" : "s"} from the carrier.` });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };
  const [labelService, setLabelService] = useState("");
  const pickups = useAsync(() => api<Page<{ id: number; name: string; is_default: boolean; is_active: boolean }> | { id: number; name: string; is_default: boolean; is_active: boolean }[]>("/shipping/pickups/").catch(() => [] as { id: number; name: string; is_default: boolean; is_active: boolean }[]), []);
  const pickupList = (Array.isArray(pickups.data) ? pickups.data : pickups.data?.results ?? []).filter((p) => p.is_active);
  const [pickup, setPickup] = useState("");
  const createLabel = async () => {
    setMsg(null);
    try {
      await api(`/shipments/${s.id}/label/`, { method: "POST", body: { ...(labelService ? { service_code: labelService.trim() } : {}), ...(pickup ? { pickup: Number(pickup) } : {}) } });
      setMsg({ kind: "ok", text: "Label created and tracking number saved." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };
  const getLabel = async () => {
    try {
      await downloadFile(`/shipments/${s.id}/label/`, `label-${s.order_number}`);
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };
  const options = isCarrier
    ? ["accepted", "declined", "in_transit", "out_for_delivery", "delivered", "exception"]
    : ["pending", "assigned", "accepted", "declined", "in_transit", "out_for_delivery", "delivered", "exception", "returned"];

  return (
    <>
      <p className="small"><Link to="/shipments">Shipments</Link></p>
      <h1>Shipment #{s.id} <Pill value={s.status} /></h1>
      <p>Order {s.order_number} · {s.carrier_name ?? "No carrier"} · {s.service_name || "—"} · Tracking {s.tracking_number || "—"}</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {s.items && s.items.length > 0 && (
        <p className="small">In this parcel: {s.items.map((i) => `${i.quantity} × ${i.product_name}`).join(", ")}</p>
      )}
      {!isCarrier && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Shipping label</h2>
          {s.has_label ? (
            <div className="row">
              <p className="small" style={{ margin: 0 }}>Label created for {s.service_code || "this service"}.</p>
              <button className="btn quiet" onClick={getLabel}>Download label</button>
            </div>
          ) : (
            <div className="row">
              <Field id="l-s" label="Carrier service code">
                <input id="l-s" className="input" placeholder="dhl:P, fedex:INTERNATIONAL_PRIORITY or ups:65" value={labelService} onChange={(e) => setLabelService(e.target.value)} />
              </Field>
              {pickupList.length > 0 && (
                <Field id="l-p" label="Collect from">
                  <select id="l-p" className="select" value={pickup} onChange={(e) => setPickup(e.target.value)}>
                    <option value="">Default pickup location</option>
                    {pickupList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )}
              <button className="btn" onClick={createLabel}>Create label</button>
              <p className="small" style={{ margin: 0 }}>Works for DHL, FedEx and UPS carriers. Leave the code blank to use the service the customer chose.</p>
            </div>
          )}
        </section>
      )}
      {s.status === "assigned" && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>New delivery job</h2>
          <div className="row">
            <button className="btn" onClick={() => act("accept", {}, "Job accepted.")}>Accept job</button>
            <Field id="d-r" label="Reason, if declining"><input id="d-r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className="btn quiet" disabled={!reason.trim()} onClick={() => act("decline", { reason }, "Job declined.")}>Decline job</button>
          </div>
        </section>
      )}
      {["accepted", "in_transit", "out_for_delivery", "exception", "assigned"].includes(s.status) && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Proof of delivery</h2>
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            let body: object = { recipient_name: recipient, note: podNote };
            if (podPhoto) {
              const form = new FormData();
              form.append("recipient_name", recipient);
              form.append("note", podNote);
              form.append("photo", podPhoto);
              body = form;
            }
            void act("proof", body, "Marked delivered.");
          }}>
            <Field id="p-r" label="Received by"><input id="p-r" className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} required /></Field>
            <Field id="p-n" label="Note"><input id="p-n" className="input" value={podNote} onChange={(e) => setPodNote(e.target.value)} /></Field>
            <Field id="p-ph" label="Photo of the parcel or signed slip (optional)">
              <input id="p-ph" className="input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                onChange={(e) => setPodPhoto(e.target.files?.[0] ?? null)} />
            </Field>
            <button className="btn">Mark delivered</button>
          </form>
        </section>
      )}
      {s.status === "delivered" && s.pod_recipient && (
        <p className="small">
          Delivered {when(s.delivered_at)}. Received by {s.pod_recipient}{s.pod_note && ` · ${s.pod_note}`}
          {s.pod_photo && <> · <a href={s.pod_photo} target="_blank" rel="noreferrer">View delivery photo</a></>}
        </p>
      )}
      <div className="two">
        <section>
          <h2 style={{ marginTop: 0 }}>Add an update</h2>
          <form className="form" onSubmit={add}>
            <Field id="e-s" label="Status">
              <select id="e-s" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
              </select>
            </Field>
            <Field id="e-d" label="What happened"><input id="e-d" className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field id="e-l" label="Location"><input id="e-l" className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            <button className="btn">Save update</button>
          </form>
          {!isCarrier && <p><button className="btn quiet" onClick={refresh}>Pull latest from carrier</button></p>}
        </section>
        <section>
          <h2 style={{ marginTop: 0 }}>Tracking</h2>
          <ol className="timeline">
            {[...s.events].reverse().map((e) => (
              <li key={e.id}><strong>{e.description || label(e.status)}</strong> <Pill value={e.status} /><div className="small muted">{when(e.occurred_at)}{e.location && ` · ${e.location}`}</div></li>
            ))}
            {s.events.length === 0 && <li className="muted">No events yet.</li>}
          </ol>
        </section>
      </div>
    </>
  );
}

