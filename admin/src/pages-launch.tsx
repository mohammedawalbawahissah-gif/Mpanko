import { useState, type FormEvent } from "react";
import { api, ApiError, type Page } from "./api";
import { Alert, CountryMultiSelect, CountrySelect, Field, Loading, errText, useAsync } from "./ui";

interface ProductType { id: number; name: string; notes: string; restricted_countries: string[]; restriction_note: string; product_count: number }
interface Pickup {
  id: number; name: string; contact_name: string; phone: string; email: string; line1: string; city: string; region: string;
  postal_code: string; country: string; is_default: boolean; is_active: boolean;
}

/* ------------------------------------------------------------ product types */

export function ProductTypes() {
  const list = useAsync(() => api<Page<ProductType> | ProductType[]>("/product-types/"), []);
  const rows = Array.isArray(list.data) ? list.data : list.data?.results ?? [];
  const [editing, setEditing] = useState<ProductType | "new" | null>(null);
  if (editing) return <TypeForm item={editing === "new" ? null : editing} onDone={() => { setEditing(null); list.reload(); }} />;
  return (
    <>
      <h1>Product types</h1>
      <p className="muted">A product type holds shipping rules that apply to every product of that type, such as countries a food or liquid cannot go to.</p>
      <p><button className="btn" onClick={() => setEditing("new")}>Add a product type</button></p>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Type</th><th>Can't ship to</th><th className="num">Products</th><th></th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td>{t.restricted_countries.join(", ") || "No limits"}</td><td className="num">{t.product_count}</td>
                  <td><button className="link-button" onClick={() => setEditing(t)}>Edit</button></td></tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="muted">No product types yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TypeForm({ item, onDone }: { item: ProductType | null; onDone: () => void }) {
  const [f, setF] = useState<{ name: string; notes: string; restricted: string[]; restriction_note: string }>({ name: item?.name ?? "", notes: item?.notes ?? "", restricted: item?.restricted_countries ?? [], restriction_note: item?.restriction_note ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const set = (k: "name" | "notes" | "restriction_note", v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setMsg("");
    const body = { name: f.name, notes: f.notes, restriction_note: f.restriction_note, restricted_countries: f.restricted };
    try {
      if (item) await api(`/product-types/${item.id}/`, { method: "PATCH", body });
      else await api("/product-types/", { method: "POST", body });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields()); setMsg("Check the highlighted fields."); } else setMsg(errText(err));
    }
  };
  const remove = async () => {
    if (!item) return;
    try { await api(`/product-types/${item.id}/`, { method: "DELETE" }); onDone(); } catch (err) { setMsg(errText(err)); }
  };
  return (
    <>
      <h1>{item ? `Edit ${item.name}` : "Add a product type"}</h1>
      {msg && <Alert>{msg}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="pt-n" label="Name" error={errors.name}><input id="pt-n" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required /></Field>
        <Field id="pt-c" label="Can't ship to" error={errors.restricted_countries}><CountryMultiSelect id="pt-c" value={f.restricted} onChange={(v) => setF((x) => ({ ...x, restricted: v }))} /></Field>
        <Field id="pt-r" label="Message shown to shoppers in those countries" error={errors.restriction_note}><input id="pt-r" className="input" value={f.restriction_note} onChange={(e) => set("restriction_note", e.target.value)} /></Field>
        <Field id="pt-o" label="Internal notes" error={errors.notes}><textarea id="pt-o" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <p><button className="btn">Save product type</button> <button type="button" className="btn quiet" onClick={onDone}>Cancel</button>
          {item && <> <button type="button" className="btn quiet" onClick={remove}>Delete</button></>}</p>
      </form>
    </>
  );
}

/* ------------------------------------------------------------ pickup locations */

export function PickupLocations() {
  const list = useAsync(() => api<Page<Pickup> | Pickup[]>("/shipping/pickups/"), []);
  const rows = Array.isArray(list.data) ? list.data : list.data?.results ?? [];
  const [editing, setEditing] = useState<Pickup | "new" | null>(null);
  if (editing) return <PickupForm item={editing === "new" ? null : editing} onDone={() => { setEditing(null); list.reload(); }} />;
  return (
    <>
      <h1>Pickup locations</h1>
      <p className="muted">Places a courier collects parcels from. The default one is used unless you pick another when you book a label.</p>
      <p><button className="btn" onClick={() => setEditing("new")}>Add a pickup location</button></p>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Name</th><th>Address</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}><td>{p.name}{p.is_default && <> <span className="pill s-info">Default</span></>}</td>
                  <td>{[p.line1, p.city, p.region, p.country].filter(Boolean).join(", ")}</td><td>{p.is_active ? "In use" : "Switched off"}</td>
                  <td><button className="link-button" onClick={() => setEditing(p)}>Edit</button></td></tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="muted">No pickup locations yet. Parcels use the address set in the server settings.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PickupForm({ item, onDone }: { item: Pickup | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: item?.name ?? "", contact_name: item?.contact_name ?? "", phone: item?.phone ?? "", email: item?.email ?? "", line1: item?.line1 ?? "",
    city: item?.city ?? "", region: item?.region ?? "", postal_code: item?.postal_code ?? "", country: item?.country ?? "GH",
    is_default: item?.is_default ?? false, is_active: item?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setMsg("");
    const body = { ...f, country: f.country.toUpperCase() };
    try {
      if (item) await api(`/shipping/pickups/${item.id}/`, { method: "PATCH", body });
      else await api("/shipping/pickups/", { method: "POST", body });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields()); setMsg("Check the highlighted fields."); } else setMsg(errText(err));
    }
  };
  const text = (k: "name" | "contact_name" | "phone" | "email" | "line1" | "city" | "region" | "postal_code", label: string, required = false) => (
    <Field id={`pk-${k}`} label={label} error={errors[k]}><input id={`pk-${k}`} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} required={required} /></Field>
  );
  return (
    <>
      <h1>{item ? `Edit ${item.name}` : "Add a pickup location"}</h1>
      {msg && <Alert>{msg}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        {text("name", "Name (for example Tamale workshop)", true)}
        {text("contact_name", "Contact person")}
        {text("phone", "Phone")}
        {text("email", "Email")}
        {text("line1", "Street address", true)}
        {text("city", "City", true)}
        {text("region", "Region")}
        {text("postal_code", "Postal code")}
        <Field id="pk-country" label="Country" error={errors.country}><CountrySelect id="pk-country" required value={f.country} onChange={(v) => set("country", v)} /></Field>
        <label className="small"><input type="checkbox" checked={f.is_default} onChange={(e) => set("is_default", e.target.checked)} /> Use as the default pickup location</label>
        <label className="small"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> In use</label>
        <p><button className="btn">Save pickup location</button> <button type="button" className="btn quiet" onClick={onDone}>Cancel</button></p>
      </form>
    </>
  );
}
