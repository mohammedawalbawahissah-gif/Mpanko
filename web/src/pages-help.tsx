import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type Page } from "./api";
import { Alert, Field, Loading, StatusPill, useAsync } from "./components";
import { useCurrency } from "./context";

/* ---------------------------------------------------------------- returns */

interface Eligibility {
  eligible: boolean; message: string; window_days: number;
  reasons: { value: string; label: string }[];
  items: { order_item: number; product_name: string; variant_name: string; max: number }[];
}
export interface ReturnRow {
  number: string; order_number: string; status: string; status_label: string; reason_label: string; staff_note: string;
  refund_amount: string | null; currency: string; created_at: string;
  items: { order_item: number; product_name: string; quantity: number }[];
}

/** The returns already made on an order, shown on the order page. */
export function OrderReturns({ orderNumber, status }: { orderNumber: string; status: string }) {
  const { exact } = useCurrency();
  const { data, reload } = useAsync(() => api<Page<ReturnRow>>(`/returns/?search=${orderNumber}`), [orderNumber]);
  const [error, setError] = useState("");
  const list = data?.results ?? [];
  const cancel = async (n: string) => {
    setError("");
    try {
      await api(`/returns/${n}/cancel/`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't cancel the return.");
    }
  };
  if (list.length === 0 && status !== "delivered") return null;
  return (
    <section aria-labelledby="returns" style={{ marginTop: "2rem" }}>
      <h2 id="returns">Returns</h2>
      {error && <Alert>{error}</Alert>}
      {list.map((r) => (
        <div key={r.number} className="card" style={{ marginBottom: "0.75rem" }}>
          <p style={{ margin: 0 }}><strong>{r.number}</strong> <StatusPill status={r.status} /></p>
          <p className="small muted" style={{ margin: "0.25rem 0" }}>{r.items.map((i) => `${i.quantity} × ${i.product_name}`).join(", ")} · {r.reason_label}</p>
          {r.staff_note && <p className="small">{r.staff_note}</p>}
          {r.status === "approved" && r.refund_amount && <p className="small">Send the items back. We refund {exact(r.refund_amount, r.currency)} when they arrive.</p>}
          {(r.status === "requested" || r.status === "approved") && <button className="link-button" onClick={() => cancel(r.number)}>Cancel this return</button>}
        </div>
      ))}
      {status === "delivered" && <Link className="btn quiet" to={`/orders/${orderNumber}/return`}>Return items</Link>}
    </section>
  );
}

export function ReturnForm() {
  const { number = "" } = useParams();
  const navigate = useNavigate();
  const { data: e, error, loading } = useAsync(() => api<Eligibility>(`/returns/eligibility/?order=${number}`), [number]);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  if (loading) return <div className="wrap page"><Loading /></div>;
  if (error || !e) return <div className="wrap page"><Alert>{error || "We couldn't load that order."}</Alert></div>;
  const chosen = Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => ({ order_item: Number(id), quantity: n }));
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await api("/returns/", { method: "POST", body: { order_number: number, reason, note, items: chosen } });
      navigate(`/orders/${number}`);
    } catch (x) {
      setProblem(x instanceof ApiError ? x.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="wrap page narrow">
      <p className="small"><Link to={`/orders/${number}`}>Order {number}</Link></p>
      <h1>Return items</h1>
      {!e.eligible ? (
        <Alert kind="info">{e.message}</Alert>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted">You can return items within {e.window_days} days of delivery. We email you our decision, and refund once the items reach us.</p>
          {problem && <Alert>{problem}</Alert>}
          {e.items.filter((i) => i.max > 0).map((i) => (
            <Field key={i.order_item} id={`q${i.order_item}`} label={`${i.product_name}${i.variant_name ? ` (${i.variant_name})` : ""}: how many to return? (up to ${i.max})`}>
              <input id={`q${i.order_item}`} className="input" type="number" min={0} max={i.max} value={qty[i.order_item] ?? 0} onChange={(ev) => setQty({ ...qty, [i.order_item]: Number(ev.target.value) })} />
            </Field>
          ))}
          <Field id="reason" label="Why are you returning them?">
            <select id="reason" className="select" value={reason} onChange={(ev) => setReason(ev.target.value)} required>
              <option value="">Choose a reason</option>
              {e.reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field id="rnote" label="Anything we should know? (optional)">
            <textarea id="rnote" className="input" rows={4} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </Field>
          <button className="btn" disabled={busy || chosen.length === 0 || !reason}>{busy ? "Sending…" : "Request return"}</button>
        </form>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- support */

interface Case {
  number: string; subject: string; status: string; status_label: string; order_number: string | null; updated_at: string;
  messages: { id: number; from_staff: boolean; author_name: string; body: string; created_at: string }[];
}

export function SupportList() {
  const { data, error, loading } = useAsync(() => api<Page<Case>>("/support/cases/"), []);
  return (
    <div className="wrap page">
      <h1>Help and support</h1>
      <p><Link className="btn" to="/support/new">Ask us something</Link></p>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && data.results.length === 0 && <p className="muted">You haven't contacted us yet.</p>}
      {data && data.results.length > 0 && (
        <table className="table">
          <thead><tr><th scope="col">Request</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
          <tbody>
            {data.results.map((c) => (
              <tr key={c.number}>
                <td><Link to={`/support/${c.number}`}>{c.subject}</Link></td><td>{c.order_number ?? "—"}</td>
                <td><StatusPill status={c.status} /></td><td>{new Date(c.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function SupportNew() {
  const navigate = useNavigate();
  const orders = useAsync(() => api<Page<{ number: string }>>("/orders/"), []);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState(new URLSearchParams(window.location.search).get("order") ?? "");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const c = await api<Case>("/support/cases/", { method: "POST", body: { subject, message, order_number: order } });
      navigate(`/support/${c.number}`);
    } catch (x) {
      setProblem(x instanceof ApiError ? x.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="wrap page narrow">
      <h1>Ask us something</h1>
      <form className="form" onSubmit={submit}>
        {problem && <Alert>{problem}</Alert>}
        <Field id="sub" label="What is it about?"><input id="sub" className="input" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} required /></Field>
        <Field id="ord" label="Which order? (optional)">
          <select id="ord" className="select" value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="">Not about an order</option>
            {orders.data?.results.map((o) => <option key={o.number} value={o.number}>{o.number}</option>)}
          </select>
        </Field>
        <Field id="msg" label="Tell us more"><textarea id="msg" className="input" rows={6} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} required /></Field>
        <button className="btn" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
      </form>
    </div>
  );
}

export function SupportThread() {
  const { number = "" } = useParams();
  const { data: c, error, loading, reload } = useAsync(() => api<Case>(`/support/cases/${number}/`), [number]);
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState("");
  if (loading) return <div className="wrap page"><Loading /></div>;
  if (error || !c) return <div className="wrap page"><Alert>{error || "We couldn't find that request."}</Alert></div>;
  const send = async (ev: FormEvent) => {
    ev.preventDefault();
    setProblem("");
    try {
      await api(`/support/cases/${c.number}/messages/`, { method: "POST", body: { body } });
      setBody("");
      reload();
    } catch (x) {
      setProblem(x instanceof ApiError ? x.message : "Couldn't send your message.");
    }
  };
  return (
    <div className="wrap page narrow">
      <p className="small"><Link to="/support">Help and support</Link></p>
      <h1 style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>{c.subject} <StatusPill status={c.status} /></h1>
      {c.order_number && <p className="small">About order <Link to={`/orders/${c.order_number}`}>{c.order_number}</Link></p>}
      {c.messages.map((m) => (
        <div key={m.id} className="card" style={{ marginBottom: "0.75rem", marginLeft: m.from_staff ? "1.5rem" : 0 }}>
          <p className="small muted" style={{ marginTop: 0 }}>{m.author_name} · {new Date(m.created_at).toLocaleString()}</p>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{m.body}</p>
        </div>
      ))}
      {c.status === "closed" ? (
        <Alert kind="info">This request is closed. <Link to="/support/new">Start a new one</Link> if you still need help.</Alert>
      ) : (
        <form className="form" onSubmit={send}>
          {problem && <Alert>{problem}</Alert>}
          <Field id="reply" label="Add a message"><textarea id="reply" className="input" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} required /></Field>
          <button className="btn">Send</button>
        </form>
      )}
    </div>
  );
}
