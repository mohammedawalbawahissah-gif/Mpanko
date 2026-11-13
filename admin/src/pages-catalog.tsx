import { useState, type FormEvent } from "react";
import { api, ApiError, type Page } from "./api";
import { Alert, Field, Loading, Pill, errText, useAsync, when } from "./ui";

interface Variant { id: number; sku: string; name: string; price: string; price_override?: string | null; attributes?: Record<string, string>; is_active?: boolean; quantity: number | null; in_stock: boolean }
interface Photo { id: number; image: string; alt_text: string; position: number }
interface Product {
  id: number; name: string; slug: string; description: string; category: number | null; category_name: string | null;
  origin_country: string; maker: string; base_price: string; currency: string; status: string; weight_grams: number;
  length_mm?: number; width_mm?: number; height_mm?: number; is_dangerous_goods?: boolean; dg_class?: string; un_number?: string; hs_code?: string;
  restricted_countries: string[]; variants: Variant[]; images?: Photo[];
}
interface Category { id: number; name: string }

export function Products() {
  const products = useAsync(() => api<Page<Product>>("/products/?ordering=-created_at&page_size=100"), []);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  if (editing) {
    return <ProductForm product={editing === "new" ? null : editing} onDone={() => { setEditing(null); products.reload(); }} />;
  }
  return (
    <>
      <h1>Products</h1>
      <p><button className="btn" onClick={() => setEditing("new")}>Add a product</button></p>
      {products.loading && <Loading />}
      {products.error && <Alert>{products.error}</Alert>}
      {products.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Product</th><th>Maker</th><th>Status</th><th className="num">Price</th><th className="num">Variants</th><th></th></tr></thead>
            <tbody>
              {products.data.results.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}<br /><span className="muted small">{p.category_name ?? "No category"}</span></td>
                  <td>{p.maker || "—"}</td>
                  <td><Pill value={p.status} /></td>
                  <td className="num">{p.currency} {p.base_price}</td>
                  <td className="num">{p.variants.length}</td>
                  <td><button className="link-button" onClick={() => setEditing(p)}>Edit</button></td>
                </tr>
              ))}
              {products.data.results.length === 0 && <tr><td colSpan={6} className="muted">No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ProductForm({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const cats = useAsync(() => api<Page<Category> | Category[]>("/categories/"), []);
  const money = useAsync(() => api<{ currencies: string[]; names: Record<string, string> }>("/currency/rates/"), []);
  const catList: Category[] = Array.isArray(cats.data) ? cats.data : cats.data?.results ?? [];
  const [f, setF] = useState({
    name: product?.name ?? "", description: product?.description ?? "", category: product?.category ? String(product.category) : "",
    origin_country: product?.origin_country ?? "GH", maker: product?.maker ?? "", base_price: product?.base_price ?? "", currency: product?.currency ?? "USD",
    status: product?.status ?? "draft", weight_grams: String(product?.weight_grams ?? 500),
    length_mm: String(product?.length_mm ?? 0), width_mm: String(product?.width_mm ?? 0), height_mm: String(product?.height_mm ?? 0),
    dangerous: product?.is_dangerous_goods ?? false, dg_class: product?.dg_class ?? "", un_number: product?.un_number ?? "", hs_code: product?.hs_code ?? "", restricted: (product?.restricted_countries ?? []).join(", "),
  });
  const [variantName, setVariantName] = useState("Standard");
  const [sku, setSku] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg("");
    const body: Record<string, unknown> = {
      name: f.name, description: f.description, category: f.category ? Number(f.category) : null, origin_country: f.origin_country.toUpperCase(),
      maker: f.maker, base_price: f.base_price, currency: f.currency, status: f.status, weight_grams: Number(f.weight_grams) || 0,
      length_mm: Number(f.length_mm) || 0, width_mm: Number(f.width_mm) || 0, height_mm: Number(f.height_mm) || 0,
      is_dangerous_goods: f.dangerous, dg_class: f.dangerous ? f.dg_class.trim() : "", un_number: f.dangerous ? f.un_number.trim().toUpperCase() : "", hs_code: f.hs_code.trim(),
      restricted_countries: f.restricted.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
    };
    if (!product) body.variants = [{ sku, name: variantName }];
    try {
      if (product) await api(`/products/${product.slug}/`, { method: "PATCH", body });
      else await api("/products/", { method: "POST", body });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields());
        setMsg("Check the highlighted fields.");
      } else setMsg(errText(err));
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{product ? `Edit ${product.name}` : "Add a product"}</h1>
      {msg && <Alert>{msg}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="p-n" label="Name" error={errors.name}><input id="p-n" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required /></Field>
        <Field id="p-d" label="Description" error={errors.description}><textarea id="p-d" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field id="p-c" label="Category" error={errors.category}>
          <select id="p-c" className="select" value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">None</option>
            {catList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field id="p-m" label="Maker" error={errors.maker}><input id="p-m" className="input" value={f.maker} onChange={(e) => set("maker", e.target.value)} /></Field>
        <div className="row">
          <Field id="p-o" label="Country of origin (2 letters)" error={errors.origin_country}><input id="p-o" className="input" maxLength={2} value={f.origin_country} onChange={(e) => set("origin_country", e.target.value)} /></Field>
          <Field id="p-w" label="Weight in grams" error={errors.weight_grams}><input id="p-w" className="input" inputMode="numeric" value={f.weight_grams} onChange={(e) => set("weight_grams", e.target.value)} /></Field>
        </div>
        <div className="row">
          <Field id="p-p" label="Price" error={errors.base_price}><input id="p-p" className="input" inputMode="decimal" value={f.base_price} onChange={(e) => set("base_price", e.target.value)} required /></Field>
          <Field id="p-cur" label="Currency" error={errors.currency}>
            <select id="p-cur" className="select" value={f.currency} onChange={(e) => set("currency", e.target.value)}>{(money.data?.currencies ?? ["USD", "GHS"]).map((c) => <option key={c} value={c}>{money.data?.names[c] ? `${c} · ${money.data.names[c]}` : c}</option>)}</select>
          </Field>
          <Field id="p-s" label="Status" error={errors.status}>
            <select id="p-s" className="select" value={f.status} onChange={(e) => set("status", e.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select>
          </Field>
        </div>
        <fieldset className="card" style={{ marginBottom: "1rem" }}>
          <legend>Packed size, for shipping quotes</legend>
          <p className="small muted">Measure one unit in its box, in millimetres. Carriers charge the larger of real and size-based weight, so leaving this at 0 uses the default box. Fill all three or none.</p>
          <div className="row">
            <Field id="p-l" label="Length (mm)" error={errors.length_mm}><input id="p-l" className="input" inputMode="numeric" value={f.length_mm} onChange={(e) => set("length_mm", e.target.value)} /></Field>
            <Field id="p-wd" label="Width (mm)" error={errors.width_mm}><input id="p-wd" className="input" inputMode="numeric" value={f.width_mm} onChange={(e) => set("width_mm", e.target.value)} /></Field>
            <Field id="p-h" label="Height (mm)" error={errors.height_mm}><input id="p-h" className="input" inputMode="numeric" value={f.height_mm} onChange={(e) => set("height_mm", e.target.value)} /></Field>
          </div>
          <Field id="p-hs" label="Customs tariff code (HS code, optional)" error={errors.hs_code}><input id="p-hs" className="input" value={f.hs_code} onChange={(e) => set("hs_code", e.target.value)} /></Field>
        </fieldset>
        <fieldset className="card" style={{ marginBottom: "1rem" }}>
          <legend>Dangerous goods</legend>
          <label className="small"><input type="checkbox" checked={f.dangerous} onChange={(e) => set("dangerous", e.target.checked)} /> This product is dangerous goods (lithium batteries, aerosols, alcohol-based perfume, flammable liquids ...)</label>
          {f.dangerous && (
            <>
              <p className="small muted">Customers will only be offered shipping services marked as cleared for dangerous goods in Shipping rules. Labels for these parcels are booked in the carrier's own portal.</p>
              <div className="row">
                <Field id="p-dg" label="UN hazard class (for example 9 or 3)" error={errors.dg_class}><input id="p-dg" className="input" value={f.dg_class} onChange={(e) => set("dg_class", e.target.value)} /></Field>
                <Field id="p-un" label="UN number (for example UN3481)" error={errors.un_number}><input id="p-un" className="input" value={f.un_number} onChange={(e) => set("un_number", e.target.value)} /></Field>
              </div>
            </>
          )}
        </fieldset>
        <Field id="p-r" label="Can't ship to (country codes, comma-separated)" error={errors.restricted_countries}>
          <input id="p-r" className="input" value={f.restricted} onChange={(e) => set("restricted", e.target.value)} />
        </Field>
        {!product && (
          <div className="row">
            <Field id="v-n" label="First variant name" error={errors.variants}><input id="v-n" className="input" value={variantName} onChange={(e) => setVariantName(e.target.value)} /></Field>
            <Field id="v-s" label="SKU"><input id="v-s" className="input" value={sku} onChange={(e) => setSku(e.target.value)} required /></Field>
          </div>
        )}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save product"}</button>
          <button type="button" className="btn quiet" onClick={onDone}>Cancel</button>
        </div>
      </form>
      {product && <PhotosPanel slug={product.slug} />}
      {product && <VariantsPanel slug={product.slug} />}
    </>
  );
}

/* ----------------------------------------------------------------- stock */

interface StockRow { id: number; sku: string; name: string; quantity: number | null; low_stock_threshold?: number | null; allow_backorder?: boolean; backorder_days?: number | null; product?: number }
interface Movement { id: number; delta: number; reason: string; note: string; actor_email: string | null; order_ref: string | null; created_at: string }

export function Stock() {
  const [low, setLow] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api<Page<StockRow>>(`/inventory/?page_size=200${low ? "&low=1" : ""}`), [low]);
  const [open, setOpen] = useState<StockRow | null>(null);
  return (
    <>
      <h1>Stock</h1>
      <label className="small"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Show only low stock</label>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="scroll" style={{ marginTop: "1rem" }}>
          <table className="table">
            <thead><tr><th>SKU</th><th>Variant</th><th className="num">On hand</th><th className="num">Alert at</th><th>Backorder</th><th></th></tr></thead>
            <tbody>
              {data.results.map((v) => (
                <tr key={v.id}><td>{v.sku}</td><td>{v.name}</td><td className="num">{v.quantity ?? 0}</td><td className="num">{v.low_stock_threshold ?? "—"}</td><td>{v.allow_backorder ? "On" : "Off"}</td><td><button className="link-button" onClick={() => setOpen(v)}>Adjust</button></td></tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={6} className="muted">Nothing to show.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {open && <Adjust row={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function Adjust({ row, onClose, onSaved }: { row: StockRow; onClose: () => void; onSaved: () => void }) {
  const moves = useAsync(() => api<Movement[]>(`/inventory/${row.id}/movements/`), [row.id]);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("restock");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [level, setLevel] = useState(String(row.low_stock_threshold ?? 5));
  const [info, setInfo] = useState("");
  const [back, setBack] = useState(!!row.allow_backorder);
  const [days, setDays] = useState(row.backorder_days ? String(row.backorder_days) : "");
  const saveBackorder = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setInfo("");
    try {
      await api(`/inventory/${row.id}/backorder/`, { method: "PATCH", body: { allow_backorder: back, backorder_days: back && days ? Number(days) : null } });
      setInfo("Backorder setting saved.");
    } catch (x) {
      setErr(errText(x));
    }
  };
  const saveLevel = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setInfo("");
    try {
      await api(`/inventory/${row.id}/threshold/`, { method: "PATCH", body: { low_stock_threshold: Number(level) } });
      setInfo("Alert level saved.");
    } catch (x) {
      setErr(errText(x));
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await api(`/inventory/${row.id}/adjust/`, { method: "POST", body: { delta: Number(delta), reason, note } });
      onSaved();
    } catch (x) {
      setErr(errText(x));
    }
  };
  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>{row.sku}: {row.name}</h2>
      {err && <Alert>{err}</Alert>}
      <form className="row" onSubmit={submit}>
        <Field id="a-d" label="Change (use a minus to remove)"><input id="a-d" className="input" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} required /></Field>
        <Field id="a-r" label="Reason">
          <select id="a-r" className="select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="restock">Restock</option><option value="adjustment">Correction</option><option value="return">Customer return</option></select>
        </Field>
        <Field id="a-n" label="Note"><input id="a-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <button className="btn">Save</button>
        <button type="button" className="btn quiet" onClick={onClose}>Close</button>
      </form>
      <form className="row" onSubmit={saveLevel}>
        <Field id="a-t" label="Email staff when stock falls to"><input id="a-t" className="input" inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value)} required /></Field>
        <button className="btn quiet">Save alert level</button>
      </form>
      <form className="row" onSubmit={saveBackorder}>
        <label className="small" htmlFor="a-b"><input id="a-b" type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} /> Let shoppers order this when it is out of stock</label>
        {back && <Field id="a-bd" label="Usual wait in days (optional)"><input id="a-bd" className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
        <button className="btn quiet">Save backorder setting</button>
      </form>
      {info && <Alert kind="ok">{info}</Alert>}
      <h3>Recent movements</h3>
      {moves.loading ? <Loading /> : (
        <table className="table">
          <thead><tr><th>When</th><th className="num">Change</th><th>Reason</th><th>By</th><th>Note</th></tr></thead>
          <tbody>
            {(moves.data ?? []).slice(0, 15).map((m) => (
              <tr key={m.id}><td>{when(m.created_at)}</td><td className="num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td><td>{m.reason}</td><td>{m.actor_email ?? m.order_ref ?? "system"}</td><td>{m.note}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


/* ---------------------------------------------------------------- photos */

function PhotosPanel({ slug }: { slug: string }) {
  const { data, reload } = useAsync(() => api<Product>(`/products/${slug}/`), [slug]);
  const [alt, setAlt] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const photos = data?.images ?? [];

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append("image", file);
    form.append("alt_text", alt);
    try {
      await api(`/products/${slug}/images/`, { method: "POST", body: form });
      setAlt("");
      setMsg({ kind: "ok", text: "Photo added." });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    try {
      await api(`/products/${slug}/images/${id}/`, { method: "DELETE" });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };
  const makeFirst = async (id: number) => {
    try {
      await Promise.all(photos.map((p, i) => api(`/products/${slug}/images/${p.id}/`, { method: "PATCH", body: { position: p.id === id ? 0 : i + 1 } })));
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };

  return (
    <section className="card" style={{ marginTop: "2rem" }}>
      <h2 style={{ marginTop: 0 }}>Photos</h2>
      <p className="small muted">The first photo is the main one. JPG or PNG, up to 5 MB each, 10 per product.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="row">
        {photos.map((p, i) => (
          <figure key={p.id} style={{ margin: 0, width: 140 }}>
            <img src={p.image} alt={p.alt_text} style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 4, border: "1px solid var(--line)" }} />
            <figcaption className="small">
              {i === 0 ? "Main photo" : <button className="link-button" onClick={() => makeFirst(p.id)}>Make main</button>}
              {" · "}<button className="link-button" onClick={() => remove(p.id)}>Remove</button>
            </figcaption>
          </figure>
        ))}
        {photos.length === 0 && <p className="muted">No photos yet.</p>}
      </div>
      <div className="row">
        <Field id="ph-alt" label="Describe the photo (for screen readers)"><input id="ph-alt" className="input" value={alt} onChange={(e) => setAlt(e.target.value)} /></Field>
        <Field id="ph-file" label="Add a photo"><input id="ph-file" type="file" accept="image/*" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></Field>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- variants */

const attrText = (a?: Record<string, string>) => Object.entries(a ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const [k, ...rest] = part.split("=");
    if (k.trim() && rest.length) out[k.trim()] = rest.join("=").trim();
  }
  return out;
}

function VariantsPanel({ slug }: { slug: string }) {
  const { data, reload } = useAsync(() => api<Product>(`/products/${slug}/`), [slug]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [edit, setEdit] = useState<number | "new" | null>(null);
  const variants = data?.variants ?? [];
  const current = typeof edit === "number" ? variants.find((v) => v.id === edit) : undefined;
  const [f, setF] = useState({ sku: "", name: "", attrs: "", override: "" });

  const open = (v: Variant | "new") => {
    setMsg(null);
    setEdit(v === "new" ? "new" : v.id);
    setF(v === "new" ? { sku: "", name: "", attrs: "", override: "" } : { sku: v.sku, name: v.name, attrs: attrText(v.attributes), override: v.price_override ?? "" });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const body = { sku: f.sku, name: f.name, attributes: parseAttrs(f.attrs), price_override: f.override === "" ? null : f.override };
    try {
      if (current) await api(`/products/${slug}/variants/${current.id}/`, { method: "PATCH", body });
      else await api(`/products/${slug}/variants/`, { method: "POST", body });
      setEdit(null);
      setMsg({ kind: "ok", text: "Variant saved." });
      reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };
  const toggle = async (v: Variant) => {
    setMsg(null);
    try {
      if (v.is_active === false) await api(`/products/${slug}/variants/${v.id}/`, { method: "PATCH", body: { is_active: true } });
      else await api(`/products/${slug}/variants/${v.id}/`, { method: "DELETE" });
      reload();
    } catch (x) {
      setMsg({ kind: "error", text: errText(x) });
    }
  };

  return (
    <section className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>Variants</h2>
      <p className="small muted">Sizes, colours or other options. Leave the price blank to use the product price. Turn a variant off instead of deleting it so past orders keep their history.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <table className="table">
        <thead><tr><th>Name</th><th>SKU</th><th>Options</th><th className="num">Price</th><th className="num">In stock</th><th></th></tr></thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id}>
              <td>{v.name || "—"}{v.is_active === false && <span className="muted"> (off)</span>}</td>
              <td>{v.sku}</td><td>{attrText(v.attributes) || "—"}</td>
              <td className="num">{v.price}</td><td className="num">{v.quantity ?? 0}</td>
              <td>
                <button className="link-button" onClick={() => open(v)}>Edit</button>{" · "}
                <button className="link-button" onClick={() => toggle(v)}>{v.is_active === false ? "Turn on" : "Turn off"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit === null && <p><button className="btn quiet" onClick={() => open("new")}>Add a variant</button></p>}
      {edit !== null && (
        <form className="row" onSubmit={save} style={{ marginTop: "1rem" }}>
          <Field id="vr-n" label="Name"><input id="vr-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field id="vr-s" label="SKU"><input id="vr-s" className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} required /></Field>
          <Field id="vr-a" label="Options (Size=L, Colour=Red)"><input id="vr-a" className="input" value={f.attrs} onChange={(e) => setF({ ...f, attrs: e.target.value })} /></Field>
          <Field id="vr-p" label="Price (optional)"><input id="vr-p" className="input" inputMode="decimal" value={f.override} onChange={(e) => setF({ ...f, override: e.target.value })} /></Field>
          <button className="btn">Save variant</button>
          <button type="button" className="btn quiet" onClick={() => setEdit(null)}>Cancel</button>
        </form>
      )}
    </section>
  );
}
