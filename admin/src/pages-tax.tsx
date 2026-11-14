import { useState, type FormEvent } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { Alert, CountrySelect, Field, Loading, errText, useAsync } from "./ui";

interface TaxRule { id: number; country: string; name: string; rate: string; applies_to_shipping: boolean; is_active: boolean }
interface DutyRule { id: number; country: string; de_minimis: string; duty_rate: string; import_vat_rate: string; note: string; is_active: boolean }

/** "0.1250" -> "12.5%". Shown next to every rate so staff never have to read a decimal share. */
export function asPercent(share: string | number): string {
  const n = Number(share) * 100;
  if (!Number.isFinite(n)) return "";
  return `${Number(n.toFixed(2))}%`;
}

/** "12.5" or "12.5%" -> "0.125". Returns "" when it is not a percentage between 0 and 100. */
export function fromPercent(text: string): string {
  const n = Number(text.trim().replace(/%$/, ""));
  if (text.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return "";
  return String(Number((n / 100).toFixed(6)));
}

type SetMsg = (m: { kind: "ok" | "error"; text: string } | null) => void;

export function TaxAndDuties() {
  const { user } = useAuth();
  const canEdit = user?.role === "store_admin" || user?.role === "super_admin" || user?.role === "finance";
  const tax = useAsync(() => api<TaxRule[]>("/tax/rules/"), []);
  const duties = useAsync(() => api<DutyRule[]>("/tax/duties/"), []);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const run = async (fn: () => Promise<unknown>, done: string, after: () => void) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: done });
      after();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };

  return (
    <>
      <h1>Tax and duties</h1>
      <p className="muted">
        Tax is charged at checkout and added to the total. Import duties are an estimate shown to the buyer, who normally pays them
        to the carrier or customs on delivery. Set <code>DUTIES_MODE=prepaid</code> on the server only if your carrier or broker remits
        duties for you. Rates here are guidance from your tax adviser, not something Mpanko works out on its own.
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!canEdit && <Alert kind="info">You can view these rules. Only finance and store admins can change them.</Alert>}

      <h2>Tax we charge</h2>
      <p className="small muted">A country's own rule wins. The rule for “*” covers every country without one. With no rule at all, the server's default rate applies.</p>
      {tax.loading && <Loading />}
      {tax.error && <Alert>{tax.error}</Alert>}
      {tax.data && (
        <table className="table">
          <thead><tr><th>Country</th><th>Tax</th><th className="num">Rate</th><th>On shipping</th><th></th></tr></thead>
          <tbody>
            {tax.data.map((r) => (
              <tr key={r.id}>
                <td>{r.country === "*" ? "Everywhere else" : r.country}</td>
                <td>{r.name}{!r.is_active && <span className="muted"> (off)</span>}</td>
                <td className="num">{asPercent(r.rate)}</td>
                <td>{r.applies_to_shipping ? "Yes" : "No"}</td>
                <td>
                  {canEdit && (
                    <>
                      <button className="link-button" onClick={() => run(() => api(`/tax/rules/${r.id}/`, { method: "PATCH", body: { is_active: !r.is_active } }), "Rule updated.", tax.reload)}>{r.is_active ? "Turn off" : "Turn on"}</button>{" "}
                      <button className="link-button" onClick={() => run(() => api(`/tax/rules/${r.id}/`, { method: "DELETE" }), "Rule removed.", tax.reload)}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {tax.data.length === 0 && <tr><td colSpan={5} className="muted">No rules yet. The server's default rate is used for every order.</td></tr>}
          </tbody>
        </table>
      )}
      {canEdit && <TaxForm onSaved={tax.reload} setMsg={setMsg} />}

      <h2 style={{ marginTop: "2.5rem" }}>Import duties buyers may owe</h2>
      <p className="small muted">The duty-free amount is in the store currency. Orders at or below it show no duty.</p>
      {duties.loading && <Loading />}
      {duties.data && (
        <table className="table">
          <thead><tr><th>Country</th><th className="num">Duty-free up to</th><th className="num">Duty</th><th className="num">Import VAT</th><th>Note to the buyer</th><th></th></tr></thead>
          <tbody>
            {duties.data.map((r) => (
              <tr key={r.id}>
                <td>{r.country}{!r.is_active && <span className="muted"> (off)</span>}</td>
                <td className="num">{r.de_minimis}</td>
                <td className="num">{asPercent(r.duty_rate)}</td>
                <td className="num">{asPercent(r.import_vat_rate)}</td>
                <td>{r.note}</td>
                <td>
                  {canEdit && (
                    <>
                      <button className="link-button" onClick={() => run(() => api(`/tax/duties/${r.id}/`, { method: "PATCH", body: { is_active: !r.is_active } }), "Rule updated.", duties.reload)}>{r.is_active ? "Turn off" : "Turn on"}</button>{" "}
                      <button className="link-button" onClick={() => run(() => api(`/tax/duties/${r.id}/`, { method: "DELETE" }), "Rule removed.", duties.reload)}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {duties.data.length === 0 && <tr><td colSpan={6} className="muted">No countries yet. Buyers see no duty estimate.</td></tr>}
          </tbody>
        </table>
      )}
      {canEdit && <DutyForm onSaved={duties.reload} setMsg={setMsg} />}
    </>
  );
}

function TaxForm({ onSaved, setMsg }: { onSaved: () => void; setMsg: SetMsg }) {
  const blank = { country: "", name: "VAT", rate: "", shipping: false };
  const [f, setF] = useState(blank);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const share = fromPercent(f.rate);
    if (share === "") return setMsg({ kind: "error", text: "Enter the tax rate as a percentage between 0 and 100, for example 12.5." });
    try {
      await api("/tax/rules/", { method: "POST", body: { country: f.country.trim().toUpperCase(), name: f.name, rate: share, applies_to_shipping: f.shipping } });
      setF(blank);
      setMsg({ kind: "ok", text: "Tax rule added." });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <form className="row card" onSubmit={submit}>
      <Field id="t-c" label="Country"><CountrySelect id="t-c" allowAll required value={f.country} onChange={(v) => setF({ ...f, country: v })} /></Field>
      <Field id="t-n" label="Name on the invoice"><input id="t-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field id="t-r" label="Rate (%)"><input id="t-r" className="input" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required /></Field>
      <label className="small"><input type="checkbox" checked={f.shipping} onChange={(e) => setF({ ...f, shipping: e.target.checked })} /> Also charge on shipping</label>
      <button className="btn">Add tax rule</button>
    </form>
  );
}

function DutyForm({ onSaved, setMsg }: { onSaved: () => void; setMsg: SetMsg }) {
  const blank = { country: "", de_minimis: "0", duty: "", vat: "0", note: "" };
  const [f, setF] = useState(blank);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const duty = fromPercent(f.duty);
    const vat = fromPercent(f.vat);
    if (duty === "" || vat === "") return setMsg({ kind: "error", text: "Enter duty and import VAT as percentages between 0 and 100." });
    try {
      await api("/tax/duties/", { method: "POST", body: { country: f.country.trim().toUpperCase(), de_minimis: f.de_minimis || "0", duty_rate: duty, import_vat_rate: vat, note: f.note } });
      setF(blank);
      setMsg({ kind: "ok", text: "Duty rule added." });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <form className="row card" onSubmit={submit}>
      <Field id="d-c" label="Country"><CountrySelect id="d-c" required value={f.country} onChange={(v) => setF({ ...f, country: v })} /></Field>
      <Field id="d-m" label="Duty-free up to"><input id="d-m" className="input" inputMode="decimal" value={f.de_minimis} onChange={(e) => setF({ ...f, de_minimis: e.target.value })} /></Field>
      <Field id="d-d" label="Duty (%)"><input id="d-d" className="input" inputMode="decimal" value={f.duty} onChange={(e) => setF({ ...f, duty: e.target.value })} required /></Field>
      <Field id="d-v" label="Import VAT (%)"><input id="d-v" className="input" inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} /></Field>
      <Field id="d-n" label="Note to the buyer"><input id="d-n" className="input" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Paid to the carrier on delivery" /></Field>
      <button className="btn">Add duty rule</button>
    </form>
  );
}
