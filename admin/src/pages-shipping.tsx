import { useState, type FormEvent } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { Alert, CountryMultiSelect, CountrySelect, Field, Loading, errText, useAsync } from "./ui";

interface Rate {
  id: number; zone: number; service_code: string; service_name: string; base_price: string; price_per_kg: string;
  min_weight_grams: number; max_weight_grams: number | null; eta_days_min: number | null; eta_days_max: number | null; allows_dangerous_goods: boolean; is_active: boolean;
}
interface Zone { id: number; name: string; countries: string[]; is_active: boolean; rates: Rate[] }
interface Blocked { id: number; country: string; reason: string }

export function ShippingRules() {
  const { user } = useAuth();
  const canEdit = user?.role === "store_admin" || user?.role === "super_admin";
  const zones = useAsync(() => api<Zone[]>("/shipping/zones/"), []);
  const blocked = useAsync(() => api<Blocked[]>("/shipping/blocked/"), []);
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
      <h1>Shipping rules</h1>
      <p className="muted">
        Group countries into zones and set the services and prices for each. Customers are only offered services from the zone their
        address is in. Prices are in the store currency (USD) and are base price plus the per-kg price for each started kilogram.
        Until you add a rate here, the simple flat rates are used.
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!canEdit && <Alert kind="info">You can view these rules. Only store admins can change them.</Alert>}
      {zones.loading && <Loading />}
      {zones.error && <Alert>{zones.error}</Alert>}
      {zones.data?.map((z) => (
        <section key={z.id} className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>{z.name} {!z.is_active && <span className="muted">(off)</span>}</h2>
          <p className="small">Countries: {z.countries.join(", ")}</p>
          <table className="table">
            <thead><tr><th>Service</th><th className="num">Base</th><th className="num">Per kg</th><th>Weight (g)</th><th>Days</th><th></th></tr></thead>
            <tbody>
              {z.rates.map((r) => (
                <tr key={r.id}>
                  <td>{r.service_name}<div className="small muted">{r.service_code}{!r.is_active && " · off"}{r.allows_dangerous_goods && " · dangerous goods ok"}</div></td>
                  <td className="num">{r.base_price}</td><td className="num">{r.price_per_kg}</td>
                  <td>{r.min_weight_grams}{r.max_weight_grams !== null ? ` to ${r.max_weight_grams}` : "+"}</td>
                  <td>{r.eta_days_min ?? "?"}{r.eta_days_max ? ` to ${r.eta_days_max}` : ""}</td>
                  <td>
                    {canEdit && (
                      <>
                        <button className="link-button" onClick={() => run(() => api(`/shipping/rates/${r.id}/`, { method: "PATCH", body: { is_active: !r.is_active } }), "Rate updated.", zones.reload)}>{r.is_active ? "Turn off" : "Turn on"}</button>{" "}
                        <button className="link-button" onClick={() => run(() => api(`/shipping/rates/${r.id}/`, { method: "DELETE" }), "Rate removed.", zones.reload)}>Remove</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {z.rates.length === 0 && <tr><td colSpan={6} className="muted">No services yet. Customers in this zone won't be offered delivery.</td></tr>}
            </tbody>
          </table>
          {canEdit && <RateForm zone={z.id} onSaved={zones.reload} setMsg={setMsg} />}
          {canEdit && (
            <p>
              <button className="btn quiet" onClick={() => run(() => api(`/shipping/zones/${z.id}/`, { method: "PATCH", body: { is_active: !z.is_active } }), "Zone updated.", zones.reload)}>{z.is_active ? "Turn zone off" : "Turn zone on"}</button>{" "}
              <button className="btn quiet" onClick={() => run(() => api(`/shipping/zones/${z.id}/`, { method: "DELETE" }), "Zone removed.", zones.reload)}>Remove zone</button>
            </p>
          )}
        </section>
      ))}
      {canEdit && <ZoneForm onSaved={zones.reload} setMsg={setMsg} />}

      <h2>Countries we don't ship to</h2>
      {blocked.data && (
        <table className="table">
          <thead><tr><th>Country</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {blocked.data.map((b) => (
              <tr key={b.id}>
                <td>{b.country}</td><td>{b.reason}</td>
                <td>{canEdit && <button className="link-button" onClick={() => run(() => api(`/shipping/blocked/${b.id}/`, { method: "DELETE" }), "Country unblocked.", blocked.reload)}>Unblock</button>}</td>
              </tr>
            ))}
            {blocked.data.length === 0 && <tr><td colSpan={3} className="muted">None.</td></tr>}
          </tbody>
        </table>
      )}
      {canEdit && <BlockForm onSaved={blocked.reload} setMsg={setMsg} />}
    </>
  );
}

type SetMsg = (m: { kind: "ok" | "error"; text: string } | null) => void;

function ZoneForm({ onSaved, setMsg }: { onSaved: () => void; setMsg: SetMsg }) {
  const [name, setName] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (countries.length === 0) {
      setMsg({ kind: "error", text: "Choose at least one country for this zone." });
      return;
    }
    try {
      await api("/shipping/zones/", { method: "POST", body: { name, countries } });
      setName("");
      setCountries([]);
      setMsg({ kind: "ok", text: "Zone added. Now add a service to it." });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <form className="row card" onSubmit={submit} style={{ marginBottom: "1.5rem" }}>
      <Field id="z-n" label="New zone name"><input id="z-n" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field id="z-c" label="Countries in this zone"><CountryMultiSelect id="z-c" allowAll value={countries} onChange={setCountries} /></Field>
      <button className="btn">Add zone</button>
    </form>
  );
}

function RateForm({ zone, onSaved, setMsg }: { zone: number; onSaved: () => void; setMsg: SetMsg }) {
  const blank = { service_code: "", service_name: "", base_price: "", price_per_kg: "0", min_weight_grams: "0", max_weight_grams: "", eta_days_min: "", eta_days_max: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [dg, setDg] = useState(false);
  const num = (v: string) => (v === "" ? null : Number(v));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/shipping/rates/", {
        method: "POST",
        body: {
          zone, service_code: f.service_code, service_name: f.service_name, base_price: f.base_price, price_per_kg: f.price_per_kg,
          min_weight_grams: Number(f.min_weight_grams), max_weight_grams: num(f.max_weight_grams), eta_days_min: num(f.eta_days_min), eta_days_max: num(f.eta_days_max), allows_dangerous_goods: dg,
        },
      });
      setF(blank);
      setDg(false);
      setMsg({ kind: "ok", text: "Service added." });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  const id = (k: string) => `r${zone}-${k}`;
  return (
    <form className="row" onSubmit={submit}>
      <Field id={id("n")} label="Service name"><input id={id("n")} className="input" value={f.service_name} onChange={set("service_name")} required /></Field>
      <Field id={id("c")} label="Code (letters, no spaces)"><input id={id("c")} className="input" value={f.service_code} onChange={set("service_code")} required /></Field>
      <Field id={id("b")} label="Base price"><input id={id("b")} className="input" inputMode="decimal" value={f.base_price} onChange={set("base_price")} required /></Field>
      <Field id={id("k")} label="Per kg"><input id={id("k")} className="input" inputMode="decimal" value={f.price_per_kg} onChange={set("price_per_kg")} /></Field>
      <Field id={id("lo")} label="From (g)"><input id={id("lo")} className="input" inputMode="numeric" value={f.min_weight_grams} onChange={set("min_weight_grams")} /></Field>
      <Field id={id("hi")} label="Up to (g)"><input id={id("hi")} className="input" inputMode="numeric" value={f.max_weight_grams} onChange={set("max_weight_grams")} /></Field>
      <Field id={id("d1")} label="Days from"><input id={id("d1")} className="input" inputMode="numeric" value={f.eta_days_min} onChange={set("eta_days_min")} /></Field>
      <Field id={id("d2")} label="Days to"><input id={id("d2")} className="input" inputMode="numeric" value={f.eta_days_max} onChange={set("eta_days_max")} /></Field>
      <label className="small"><input type="checkbox" checked={dg} onChange={(e) => setDg(e.target.checked)} /> Cleared for dangerous goods</label>
      <button className="btn quiet">Add service</button>
    </form>
  );
}

function BlockForm({ onSaved, setMsg }: { onSaved: () => void; setMsg: SetMsg }) {
  const [country, setCountry] = useState("");
  const [reason, setReason] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/shipping/blocked/", { method: "POST", body: { country, reason } });
      setCountry("");
      setReason("");
      setMsg({ kind: "ok", text: "Country blocked." });
      onSaved();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  return (
    <form className="row" onSubmit={submit} style={{ marginTop: "1rem" }}>
      <Field id="bl-c" label="Country"><CountrySelect id="bl-c" required value={country} onChange={setCountry} /></Field>
      <Field id="bl-r" label="Reason"><input id="bl-r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <button className="btn quiet">Block country</button>
    </form>
  );
}
