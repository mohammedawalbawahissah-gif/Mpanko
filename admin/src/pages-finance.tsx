import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, downloadCsv } from "./api";
import { Alert, Field, Loading, Pill, errText, label, useAsync, when } from "./ui";

interface Report { columns: string[]; rows: Record<string, string | number | null>[]; count: number }

const REPORTS = [
  { key: "sales", name: "Sales by day" },
  { key: "orders", name: "Orders" },
  { key: "payments", name: "Payments" },
  { key: "refunds", name: "Refunds" },
  { key: "stock", name: "Stock levels" },
  { key: "shipping", name: "Shipping" },
] as const;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function Reports() {
  const today = new Date();
  const [kind, setKind] = useState<string>("sales");
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(iso(today));
  const [run, setRun] = useState(0);
  const path = `/reports/${kind}/?from=${from}&to=${to}`;
  const { data, error, loading } = useAsync(() => api<Report>(path), [path, run]);
  const [exportErr, setExportErr] = useState("");

  const exportCsv = async () => {
    setExportErr("");
    try {
      await downloadCsv(path, `mpanko-${kind}-${from}-to-${to}.csv`);
    } catch {
      setExportErr("You don't have access to this report, or the export failed.");
    }
  };

  return (
    <>
      <h1>Reports</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setRun((n) => n + 1); }}>
        <Field id="r-k" label="Report">
          <select id="r-k" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
        <Field id="r-f" label="From"><input id="r-f" className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field id="r-t" label="To"><input id="r-t" className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <button type="button" className="btn quiet" onClick={exportCsv}>Download CSV</button>
      </form>
      {exportErr && <Alert>{exportErr}</Alert>}
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll">
          <table className="table">
            <thead><tr>{data.columns.map((c) => <th key={c}>{label(c)}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c}>{String(r[c] ?? "")}</td>)}</tr>)}
              {data.rows.length === 0 && <tr><td colSpan={data.columns.length || 1} className="muted">No data in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------- reconciliation */

interface Run { id: number; provider: string; period_start: string; period_end: string; matched: number; exceptions: number; unresolved: number; created_at: string }
interface RecordRow { id: number; kind: string; kind_label: string; reference: string; order_number: string; internal_amount: string | null; provider_amount: string | null; currency: string; internal_status: string; provider_status: string; resolved: boolean; resolution_note: string }

export function Reconciliation() {
  const runs = useAsync(() => api<Run[]>("/payments/reconciliation/"), []);
  const now = new Date();
  const [provider, setProvider] = useState("paystack");
  const [start, setStart] = useState(iso(new Date(now.getTime() - 86400000)));
  const [end, setEnd] = useState(iso(now));
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const start_ = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ id: number; matched: number; exceptions: number }>("/payments/reconciliation/", {
        method: "POST",
        body: { provider, start: `${start}T00:00:00Z`, end: `${end}T23:59:59Z` },
      });
      setMsg({ kind: r.exceptions ? "error" : "ok", text: `${r.matched} payments matched, ${r.exceptions} need attention.` });
      runs.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Payment reconciliation</h1>
      <p className="muted">Compares our payment records with what the payment provider reports for the same period.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="row" onSubmit={start_}>
        <Field id="rc-p" label="Provider"><select id="rc-p" className="select" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="paystack">Paystack</option><option value="mock">Test provider</option></select></Field>
        <Field id="rc-s" label="From"><input id="rc-s" className="input" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field id="rc-e" label="To"><input id="rc-e" className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        <button className="btn" disabled={busy}>{busy ? "Checking…" : "Run reconciliation"}</button>
      </form>
      {runs.loading && <Loading />}
      {runs.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Run</th><th>Provider</th><th>Period</th><th className="num">Matched</th><th className="num">Exceptions</th><th className="num">Unresolved</th><th>Started</th></tr></thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/reconciliation/${r.id}`}>#{r.id}</Link></td><td>{r.provider}</td>
                  <td>{new Date(r.period_start).toLocaleDateString()} to {new Date(r.period_end).toLocaleDateString()}</td>
                  <td className="num">{r.matched}</td><td className="num">{r.exceptions}</td><td className="num">{r.unresolved}</td><td>{when(r.created_at)}</td>
                </tr>
              ))}
              {runs.data.length === 0 && <tr><td colSpan={7} className="muted">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ReconciliationRun({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => api<{ id: number; provider: string; matched: number; exceptions: number; records: RecordRow[] }>(`/payments/reconciliation/${id}/`), [id]);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error || "Run not found."}</Alert>;

  const resolve = async (rid: number) => {
    setErr("");
    try {
      await api(`/payments/reconciliation/records/${rid}/resolve/`, { method: "POST", body: { note } });
      setOpen(null);
      setNote("");
      reload();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <>
      <p className="small"><Link to="/reconciliation">Reconciliation</Link></p>
      <h1>Run #{data.id} <span className="muted">· {data.provider}</span></h1>
      <p>{data.matched} matched, {data.exceptions} exceptions.</p>
      {err && <Alert>{err}</Alert>}
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Problem</th><th>Reference</th><th>Order</th><th className="num">Ours</th><th className="num">Provider</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.records.map((r) => (
              <tr key={r.id}>
                <td>{r.kind_label}</td><td>{r.reference}</td><td>{r.order_number || "—"}</td>
                <td className="num">{r.internal_amount ? `${r.currency} ${r.internal_amount}` : "—"}</td>
                <td className="num">{r.provider_amount ? `${r.currency} ${r.provider_amount}` : "—"}</td>
                <td>{r.resolved ? <><Pill value="completed" /> <span className="small muted">{r.resolution_note}</span></> : <Pill value="exception" />}</td>
                <td>
                  {!r.resolved && (open === r.id ? (
                    <span style={{ display: "flex", gap: "0.5rem" }}>
                      <input className="input" aria-label="Resolution note" placeholder="What was done" value={note} onChange={(e) => setNote(e.target.value)} />
                      <button className="btn" disabled={!note.trim()} onClick={() => resolve(r.id)}>Save</button>
                    </span>
                  ) : <button className="link-button" onClick={() => setOpen(r.id)}>Mark resolved</button>)}
                </td>
              </tr>
            ))}
            {data.records.length === 0 && <tr><td colSpan={7} className="muted">Everything matched.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
