import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Page } from "./api";
import { useAuth } from "./auth";
import { Alert, Field, Loading, Pill, errText, label, useAsync, when } from "./ui";

type Msg = { kind: "ok" | "error"; text: string } | null;

/* ---------------------------------------------------------------- Returns */

interface ReturnRow {
  number: string; order_number: string; customer_email: string; status: string; status_label: string; reason_label: string; note: string;
  staff_note: string; refund_amount: string | null; currency: string; created_at: string;
  items: { order_item: number; product_name: string; variant_name: string; sku: string; unit_price: string; quantity: number }[];
}

export function Returns() {
  const [status, setStatus] = useState("requested");
  const { data, error, loading } = useAsync(() => api<Page<ReturnRow>>(`/returns/${status ? `?status=${status}` : ""}`), [status]);
  return (
    <>
      <h1>Returns</h1>
      <div className="row">
        <Field id="rs" label="Status">
          <select id="rs" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["requested", "approved", "received", "refunded", "rejected", "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Return</th><th>Order</th><th>Customer</th><th>Reason</th><th>Status</th><th>Asked</th></tr></thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.number}>
                  <td><Link to={`/returns/${r.number}`}>{r.number}</Link></td><td>{r.order_number}</td><td>{r.customer_email}</td>
                  <td>{r.reason_label}</td><td><Pill value={r.status} /></td><td>{when(r.created_at)}</td>
                </tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={6} className="muted">No returns here.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ReturnDetail() {
  const { number = "" } = useParams();
  const { user } = useAuth();
  const { data: r, error, loading, reload } = useAsync(() => api<ReturnRow>(`/returns/${number}/`), [number]);
  const [msg, setMsg] = useState<Msg>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [restock, setRestock] = useState(true);
  if (loading) return <Loading />;
  if (error || !r) return <Alert>{error || "Return not found."}</Alert>;
  const canRefund = ["super_admin", "store_admin", "finance"].includes(user?.role ?? "");
  const act = async (path: string, body: object, done: string) => {
    setMsg(null);
    try {
      await api(`/returns/${r.number}/${path}/`, { method: "POST", body });
      setMsg({ kind: "ok", text: done });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };
  return (
    <>
      <p className="small"><Link to="/returns">Returns</Link></p>
      <h1>{r.number} <Pill value={r.status} /></h1>
      <p>Order <Link to={`/orders/${r.order_number}`}>{r.order_number}</Link> · {r.customer_email} · {r.reason_label} · asked {when(r.created_at)}</p>
      {r.note && <p><strong>Customer note:</strong> {r.note}</p>}
      {r.staff_note && <p><strong>Message to customer:</strong> {r.staff_note}</p>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Item</th><th>SKU</th><th className="num">Qty</th><th className="num">Unit price</th></tr></thead>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.order_item}><td>{i.product_name}{i.variant_name && ` · ${i.variant_name}`}</td><td>{i.sku}</td><td className="num">{i.quantity}</td><td className="num">{r.currency} {i.unit_price}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.refund_amount && <p>Refund when received: <strong>{r.currency} {r.refund_amount}</strong></p>}

      {r.status === "requested" && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Decide</h2>
          <div className="row">
            <Field id="rn" label="Message to the customer"><input id="rn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Field id="ra" label={`Refund amount (${r.currency}), blank = item value`}><input id="ra" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          </div>
          <div className="row">
            <button className="btn" onClick={() => act("approve", { staff_note: note, ...(amount ? { refund_amount: amount } : {}) }, "Return approved. The customer has been emailed.")}>Approve return</button>
            <button className="btn quiet" disabled={!note.trim()} onClick={() => act("reject", { staff_note: note }, "Return rejected. The customer has been emailed.")}>Reject (needs a message)</button>
          </div>
        </section>
      )}
      {r.status === "approved" && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Parcel arrived?</h2>
          <label className="small"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back in stock</label>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="btn" onClick={() => act("receive", { restock }, "Marked as received.")}>Mark received</button>
          </div>
        </section>
      )}
      {r.status === "received" && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Refund</h2>
          {canRefund ? (
            <button className="btn" onClick={() => act("refund", {}, `Refunded ${r.currency} ${r.refund_amount}. The customer has been emailed.`)}>Refund {r.currency} {r.refund_amount}</button>
          ) : (
            <p className="muted">A finance or store administrator issues the refund.</p>
          )}
        </section>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Support */

interface CaseRow {
  number: string; subject: string; status: string; status_label: string; order_number: string | null; customer_email: string; updated_at: string;
  messages: { id: number; from_staff: boolean; author_name: string; body: string; created_at: string }[];
}

export function Support() {
  const [status, setStatus] = useState("open");
  const { data, error, loading } = useAsync(() => api<Page<CaseRow>>(`/support/cases/${status ? `?status=${status}` : ""}`), [status]);
  return (
    <>
      <h1>Support requests</h1>
      <div className="row">
        <Field id="ss" label="Status">
          <select id="ss" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option><option value="answered">Answered</option><option value="closed">Closed</option>
          </select>
        </Field>
      </div>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Request</th><th>Subject</th><th>Customer</th><th>Order</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {data.results.map((c) => (
                <tr key={c.number}>
                  <td><Link to={`/support/${c.number}`}>{c.number}</Link></td><td>{c.subject}</td><td>{c.customer_email}</td>
                  <td>{c.order_number ?? "—"}</td><td><Pill value={c.status} /></td><td>{when(c.updated_at)}</td>
                </tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={6} className="muted">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function SupportDetail() {
  const { number = "" } = useParams();
  const { user } = useAuth();
  const { data: c, error, loading, reload } = useAsync(() => api<CaseRow>(`/support/cases/${number}/`), [number]);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  if (loading) return <Loading />;
  if (error || !c) return <Alert>{error || "Request not found."}</Alert>;
  const canReply = ["super_admin", "store_admin", "support"].includes(user?.role ?? "");
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api(`/support/cases/${c.number}/messages/`, { method: "POST", body: { body } });
      setBody("");
      setMsg({ kind: "ok", text: "Reply sent. The customer has been emailed." });
      reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  const close = async () => {
    try {
      await api(`/support/cases/${c.number}/close/`, { method: "POST", body: {} });
      reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <>
      <p className="small"><Link to="/support">Support requests</Link></p>
      <h1>{c.subject} <Pill value={c.status} /></h1>
      <p>{c.number} · {c.customer_email}{c.order_number && <> · Order <Link to={`/orders/${c.order_number}`}>{c.order_number}</Link></>}</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {c.messages.map((m) => (
        <div key={m.id} className="card" style={{ marginBottom: "0.75rem", marginLeft: m.from_staff ? "2rem" : 0 }}>
          <p className="small muted" style={{ marginTop: 0 }}>{m.from_staff ? "Support" : c.customer_email} · {when(m.created_at)}</p>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{m.body}</p>
        </div>
      ))}
      {canReply && c.status !== "closed" && (
        <form className="form" onSubmit={send} style={{ maxWidth: "40rem" }}>
          <Field id="reply" label="Reply to the customer"><textarea id="reply" className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required /></Field>
          <div className="row"><button className="btn">Send reply</button><button type="button" className="btn quiet" onClick={close}>Close request</button></div>
        </form>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Coupons */

interface Coupon {
  id: number; code: string; description: string; kind: string; value: string; min_subtotal: string; max_discount: string | null;
  starts_at: string | null; ends_at: string | null; max_uses: number | null; per_user_limit: number | null; is_active: boolean; uses: number;
}
const KIND: Record<string, string> = { percent: "Percent off items", fixed: "Amount off items", free_shipping: "Free shipping" };

export function Coupons() {
  const list = useAsync(() => api<Coupon[]>("/coupons/"), []);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  return (
    <>
      <h1>Promotions</h1>
      <p className="muted">Discount codes customers type at checkout. Amounts are in the store currency and convert automatically.</p>
      <div className="row"><button className="btn" onClick={() => setEditing("new")}>New code</button></div>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Code</th><th>Offer</th><th>Used</th><th>Valid until</th><th>On</th><th></th></tr></thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong><div className="small muted">{c.description}</div></td>
                  <td>{KIND[c.kind]}{c.kind === "percent" ? ` ${Number(c.value)}%` : c.kind === "fixed" ? ` ${c.value}` : ""}</td>
                  <td>{c.uses}{c.max_uses ? ` of ${c.max_uses}` : ""}</td>
                  <td>{c.ends_at ? when(c.ends_at) : "No end date"}</td>
                  <td>{c.is_active ? "Yes" : "No"}</td>
                  <td><button className="link-button" onClick={() => setEditing(c)}>Edit</button></td>
                </tr>
              ))}
              {list.data.length === 0 && <tr><td colSpan={6} className="muted">No codes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CouponForm key={editing === "new" ? "new" : editing.id} coupon={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

const local = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

function CouponForm({ coupon, onClose, onSaved }: { coupon: Coupon | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: coupon?.code ?? "", description: coupon?.description ?? "", kind: coupon?.kind ?? "percent", value: coupon?.value ?? "10",
    min_subtotal: coupon?.min_subtotal ?? "0", max_discount: coupon?.max_discount ?? "", starts_at: local(coupon?.starts_at ?? null), ends_at: local(coupon?.ends_at ?? null),
    max_uses: coupon?.max_uses?.toString() ?? "", per_user_limit: coupon ? (coupon.per_user_limit?.toString() ?? "") : "1", is_active: coupon?.is_active ?? true,
  });
  const [msg, setMsg] = useState<Msg>(null);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const body = {
      ...f, value: f.kind === "free_shipping" ? "0" : f.value, max_discount: f.max_discount || null, starts_at: f.starts_at || null, ends_at: f.ends_at || null,
      max_uses: f.max_uses ? Number(f.max_uses) : null, per_user_limit: f.per_user_limit ? Number(f.per_user_limit) : null,
    };
    try {
      await api(coupon ? `/coupons/${coupon.id}/` : "/coupons/", { method: coupon ? "PATCH" : "POST", body });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>{coupon ? `Edit ${coupon.code}` : "New code"}</h2>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="form" onSubmit={save}>
        <Field id="c-code" label="Code"><input id="c-code" className="input" value={f.code} onChange={(e) => set("code", e.target.value)} required /></Field>
        <Field id="c-desc" label="Note for staff"><input id="c-desc" className="input" value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field id="c-kind" label="Offer">
          <select id="c-kind" className="select" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {f.kind !== "free_shipping" && (
          <Field id="c-val" label={f.kind === "percent" ? "Percent off" : "Amount off (store currency)"}><input id="c-val" className="input" inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value)} required /></Field>
        )}
        {f.kind === "percent" && <Field id="c-max" label="Largest discount (store currency), optional"><input id="c-max" className="input" inputMode="decimal" value={f.max_discount} onChange={(e) => set("max_discount", e.target.value)} /></Field>}
        <Field id="c-min" label="Smallest item total (store currency)"><input id="c-min" className="input" inputMode="decimal" value={f.min_subtotal} onChange={(e) => set("min_subtotal", e.target.value)} /></Field>
        <Field id="c-start" label="Starts"><input id="c-start" type="datetime-local" className="input" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></Field>
        <Field id="c-end" label="Ends"><input id="c-end" type="datetime-local" className="input" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} /></Field>
        <Field id="c-uses" label="Total uses, blank = unlimited"><input id="c-uses" className="input" inputMode="numeric" value={f.max_uses} onChange={(e) => set("max_uses", e.target.value)} /></Field>
        <Field id="c-user" label="Uses per customer, blank = unlimited"><input id="c-user" className="input" inputMode="numeric" value={f.per_user_limit} onChange={(e) => set("per_user_limit", e.target.value)} /></Field>
        <label className="small"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> Code works at checkout</label>
        <div className="row"><button className="btn">Save code</button><button type="button" className="btn quiet" onClick={onClose}>Close</button></div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------- Customers */

interface CustomerRow { id: number; email: string; full_name: string; phone: string; email_verified: boolean; is_active: boolean; date_joined: string; order_count: number; last_order_at: string | null }
interface CustomerFull extends CustomerRow {
  addresses: { label: string; recipient_name: string; line1: string; city: string; country: string; postal_code: string }[];
  orders: { number: string; status: string; currency: string; grand_total: string; created_at: string }[];
  returns: { number: string; status: string; order_number: string }[];
  support_cases: { number: string; subject: string; status: string }[];
}

export function Customers() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const { data, error, loading } = useAsync(() => api<Page<CustomerRow>>(`/customers/${applied ? `?search=${encodeURIComponent(applied)}` : ""}`), [applied]);
  return (
    <>
      <h1>Customers</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(query.trim()); }}>
        <Field id="cq" label="Search by name, email or phone"><input id="cq" className="input" value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
        <button className="btn">Search</button>
      </form>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Customer</th><th>Joined</th><th className="num">Orders</th><th>Last order</th><th>Account</th></tr></thead>
            <tbody>
              {data.results.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/customers/${c.id}`}>{c.full_name || c.email}</Link><div className="small muted">{c.full_name && c.email}</div></td>
                  <td>{when(c.date_joined)}</td><td className="num">{c.order_count}</td><td>{c.last_order_at ? when(c.last_order_at) : "—"}</td>
                  <td>{c.is_active ? "Active" : "Switched off"}</td>
                </tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={5} className="muted">No customers found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function CustomerDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: c, error, loading, reload } = useAsync(() => api<CustomerFull>(`/customers/${id}/`), [id]);
  const [msg, setMsg] = useState<Msg>(null);
  if (loading) return <Loading />;
  if (error || !c) return <Alert>{error || "Customer not found."}</Alert>;
  const canSwitch = ["super_admin", "store_admin"].includes(user?.role ?? "");
  const toggle = async () => {
    setMsg(null);
    try {
      await api(`/customers/${c.id}/`, { method: "PATCH", body: { is_active: !c.is_active } });
      reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <>
      <p className="small"><Link to="/customers">Customers</Link></p>
      <h1>{c.full_name || c.email}</h1>
      <p>{c.email}{c.phone && ` · ${c.phone}`} · joined {when(c.date_joined)} · email {c.email_verified ? "verified" : "not verified"} · {c.is_active ? "active" : "switched off"}</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {canSwitch && <p><button className="btn quiet" onClick={toggle}>{c.is_active ? "Switch account off" : "Switch account on"}</button></p>}
      <h2>Orders</h2>
      <div className="scroll"><table className="table"><tbody>
        {c.orders.map((o) => <tr key={o.number}><td><Link to={`/orders/${o.number}`}>{o.number}</Link></td><td><Pill value={o.status} /></td><td className="num">{o.currency} {o.grand_total}</td><td>{when(o.created_at)}</td></tr>)}
        {c.orders.length === 0 && <tr><td className="muted">No orders yet.</td></tr>}
      </tbody></table></div>
      <h2>Addresses</h2>
      {c.addresses.length === 0 ? <p className="muted">None saved.</p> : <ul>{c.addresses.map((a, i) => <li key={i}>{a.recipient_name}, {a.line1}, {a.city} {a.postal_code}, {a.country}</li>)}</ul>}
      {c.returns.length > 0 && <><h2>Returns</h2><ul>{c.returns.map((r) => <li key={r.number}><Link to={`/returns/${r.number}`}>{r.number}</Link> for {r.order_number}: {label(r.status)}</li>)}</ul></>}
      {c.support_cases.length > 0 && <><h2>Support requests</h2><ul>{c.support_cases.map((s) => <li key={s.number}><Link to={`/support/${s.number}`}>{s.subject}</Link>: {label(s.status)}</li>)}</ul></>}
    </>
  );
}

/* ------------------------------------------------------------------ Staff */

interface StaffRow { id: number; email: string; full_name: string; role: string; is_active: boolean; mfa_enabled: boolean }
const ROLES: Record<string, string> = {
  store_admin: "Store administrator", fulfillment: "Order / fulfillment staff", finance: "Finance staff", support: "Support staff", carrier: "Carrier partner user", super_admin: "Super administrator",
};

export function StaffPage() {
  const { user } = useAuth();
  const list = useAsync(() => api<StaffRow[]>("/staff/"), []);
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ email: "", full_name: "", role: "fulfillment" });
  const isSuper = user?.role === "super_admin";
  const grantable = Object.keys(ROLES).filter((r) => r !== "super_admin" && (isSuper || r !== "store_admin"));
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/staff/", { method: "POST", body: f });
      setMsg({ kind: "ok", text: `Invitation sent to ${f.email}. They set a password from the email, then sign in here.` });
      setF({ email: "", full_name: "", role: "fulfillment" });
      list.reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  const patch = async (id: number, body: object) => {
    setMsg(null);
    try {
      await api(`/staff/${id}/`, { method: "PATCH", body });
      list.reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <>
      <h1>Staff</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Person</th><th>Role</th><th>Two-step sign-in</th><th>Access</th></tr></thead>
            <tbody>
              {list.data.map((s) => {
                const locked = s.id === user?.id || (["super_admin", "store_admin"].includes(s.role) && !isSuper);
                return (
                  <tr key={s.id}>
                    <td>{s.full_name || s.email}<div className="small muted">{s.full_name && s.email}</div></td>
                    <td>
                      {locked ? ROLES[s.role] ?? s.role : (
                        <select aria-label={`Role for ${s.email}`} className="select" value={s.role} onChange={(e) => patch(s.id, { role: e.target.value })}>
                          {Object.keys(ROLES).filter((r) => r !== "super_admin" && (isSuper || r !== "store_admin") || r === s.role).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{s.mfa_enabled ? "On" : "Not set up"}</td>
                    <td>{locked ? (s.is_active ? "Active" : "Switched off") : <button className="link-button" onClick={() => patch(s.id, { is_active: !s.is_active })}>{s.is_active ? "Switch off" : "Switch on"}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h2>Invite someone</h2>
      <form className="form" onSubmit={invite}>
        <Field id="s-email" label="Email"><input id="s-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field id="s-name" label="Name"><input id="s-name" className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field id="s-role" label="Role">
          <select id="s-role" className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {grantable.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
          </select>
        </Field>
        <button className="btn">Send invitation</button>
      </form>
    </>
  );
}

/* -------------------------------------------------------------- Audit log */

interface AuditRow { id: number; created_at: string; actor_email: string; action: string; object_type: string; object_id: string; detail: Record<string, unknown> }

export function AuditLog() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = [applied && `search=${encodeURIComponent(applied)}`, from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&");
  const { data, error, loading } = useAsync(() => api<Page<AuditRow>>(`/audit/${qs ? `?${qs}` : ""}`), [qs]);
  return (
    <>
      <h1>Activity log</h1>
      <p className="muted">Who did what in the back office. Entries can't be edited.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
        <Field id="al-q" label="Search action, person or item"><input id="al-q" className="input" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field id="al-f" label="From"><input id="al-f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field id="al-t" label="To"><input id="al-t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn">Search</button>
      </form>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr></thead>
            <tbody>
              {data.results.map((a) => (
                <tr key={a.id}>
                  <td>{when(a.created_at)}</td><td>{a.actor_email}</td><td>{a.action}</td><td>{a.object_type} {a.object_id}</td>
                  <td className="small">{Object.entries(a.detail).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}</td>
                </tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={5} className="muted">No entries match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- policy pages */
interface PageRow { slug: string; title: string; is_draft: boolean }
interface PageFull { slug: string; title: string; body: string; version: number; is_draft: boolean; updated_at: string | null }

export function Pages() {
  const list = useAsync(() => api<PageRow[]>("/pages/"), []);
  const [slug, setSlug] = useState<string | null>(null);
  return (
    <>
      <h1>Policy pages</h1>
      <p className="muted">The privacy policy, terms, returns policy and cookie notice shown on the shop. Each starts as a draft written from how the software works. Have your lawyer review it, edit it here, then tick Published.</p>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <table className="table">
          <thead><tr><th>Page</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.data.map((p) => (
              <tr key={p.slug}>
                <td><strong>{p.title}</strong></td>
                <td>{p.is_draft ? "Draft (not yet approved)" : "Published"}</td>
                <td><button className="link-button" onClick={() => setSlug(p.slug)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {slug && <PageEditor key={slug} slug={slug} onClose={() => setSlug(null)} onSaved={() => list.reload()} />}
    </>
  );
}

function PageEditor({ slug, onClose, onSaved }: { slug: string; onClose: () => void; onSaved: () => void }) {
  const page = useAsync(() => api<PageFull>(`/pages/${slug}/`), [slug]);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [published, setPublished] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  if (page.loading || !page.data) return <Loading />;
  const p = page.data;
  const t = title ?? p.title;
  const b = body ?? p.body;
  const pub = published ?? !p.is_draft;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api(`/pages/${slug}/`, { method: "PUT", body: { title: t, body: b, is_published: pub } });
      setMsg({ kind: "ok", text: pub ? "Saved and published." : "Saved as a draft." });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>Edit {p.title} <span className="small muted">version {p.version}</span></h2>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="form" onSubmit={save}>
        <Field id="pg-title" label="Title"><input id="pg-title" className="input" value={t} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field id="pg-body" label="Text (start a heading line with #, leave a blank line between paragraphs)">
          <textarea id="pg-body" className="input" rows={18} value={b} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <label className="small"><input type="checkbox" checked={pub} onChange={(e) => setPublished(e.target.checked)} /> Published (shoppers see this text instead of the draft notice)</label>
        <div className="row"><button className="btn">Save page</button> <button type="button" className="btn quiet" onClick={onClose}>Close</button></div>
      </form>
    </div>
  );
}
