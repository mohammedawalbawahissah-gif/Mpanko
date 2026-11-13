import { useState, type FormEvent } from "react";
import { api } from "./api";
import { Alert, Field, Loading, Pill, errText, useAsync, when } from "./ui";

interface Template {
  key: string; label: string; subject: string; body: string; is_active: boolean; customised: boolean; variables: string[];
}
interface LogRow { id: number; key: string; recipient: string; subject: string; status: string; error: string; ref: string; created_at: string }

export function Emails() {
  const list = useAsync(() => api<Template[]>("/notifications/templates/"), []);
  const [open, setOpen] = useState<Template | null>(null);
  const [failedOnly, setFailedOnly] = useState(true);
  const logs = useAsync(() => api<LogRow[]>(`/notifications/logs/${failedOnly ? "?status=failed" : ""}`), [failedOnly]);
  return (
    <>
      <h1>Emails</h1>
      <p className="muted">Change the wording of the emails customers and staff receive, and see which ones failed to send.</p>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Email</th><th>Subject</th><th>Wording</th><th>Sending</th><th></th></tr></thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.key}>
                  <td>{t.label}</td><td>{t.subject}</td>
                  <td>{t.customised ? "Edited" : "Standard"}</td>
                  <td>{t.is_active ? "On" : "Off"}</td>
                  <td><button className="link-button" onClick={() => setOpen(t)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <Editor key={open.key} t={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} />}
      <h2>Delivery log</h2>
      <label className="small"><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Show only failures</label>
      {logs.loading && <Loading />}
      {logs.data && (
        <div className="scroll" style={{ marginTop: "1rem" }}>
          <table className="table">
            <thead><tr><th>When</th><th>Email</th><th>To</th><th>Result</th><th>Problem</th></tr></thead>
            <tbody>
              {logs.data.map((r) => (
                <tr key={r.id}><td>{when(r.created_at)}</td><td>{r.key}</td><td>{r.recipient}</td><td><Pill value={r.status} /></td><td>{r.error}</td></tr>
              ))}
              {logs.data.length === 0 && <tr><td colSpan={5} className="muted">{failedOnly ? "No failed emails." : "Nothing sent yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Editor({ t, onClose, onSaved }: { t: Template; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [active, setActive] = useState(t.is_active);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api(`/notifications/templates/${t.key}/`, { method: "PUT", body: { subject, body, is_active: active } });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  const test = async () => {
    setMsg(null);
    try {
      const r = await api<{ sent: boolean; to: string }>(`/notifications/templates/${t.key}/test/`, { method: "POST", body: {} });
      setMsg(r.sent ? { kind: "ok", text: `Test sent to ${r.to}. It shows the last saved wording.` } : { kind: "error", text: "The test email did not send. See the delivery log." });
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  const reset = async () => {
    try {
      await api(`/notifications/templates/${t.key}/`, { method: "DELETE" });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>{t.label}</h2>
      <p className="small muted">You can use: {t.variables.map((v) => `{{ ${v} }}`).join("  ")}</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="form" onSubmit={save}>
        <Field id="t-s" label="Subject"><input id="t-s" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required /></Field>
        <Field id="t-b" label="Message"><textarea id="t-b" className="input" rows={10} value={body} onChange={(e) => setBody(e.target.value)} required /></Field>
        <label className="small"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Send this email</label>
        <div className="row">
          <button className="btn">Save wording</button>
          <button type="button" className="btn quiet" onClick={test}>Send me a test</button>
          {t.customised && <button type="button" className="btn quiet" onClick={reset}>Go back to standard wording</button>}
          <button type="button" className="btn quiet" onClick={onClose}>Close</button>
        </div>
      </form>
    </div>
  );
}
