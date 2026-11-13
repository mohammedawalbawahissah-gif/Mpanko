import { useState, type FormEvent } from "react";
import { api, ApiError, type Page } from "./api";
import { Alert, Field, Loading, Pill, errText, useAsync, when } from "./ui";

interface Variant { id: number; sku: string; name: string; price: string; quantity: number | null; in_stock: boolean }
interface Product {
  id: number; name: string; slug: string; description: string; category: number | null; category_name: string | null;
  origin_country: string; maker: string; base_price: string; currency: string; status: string; weight_grams: number;
  restricted_countries: string[]; variants: Variant[];
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
  const catList: Category[] = Array.isArray(cats.data) ? cats.data : cats.data?.results ?? [];
  const [f, setF] = useState({
    name: product?.name ?? "", description: product?.description ?? "", category: product?.category ? String(product.category) : "",
    origin_country: product?.origin_country ?? "GH", maker: product?.maker ?? "", base_price: product?.base_price ?? "", currency: product?.currency ?? "USD",
    status: product?.status ?? "draft", weight_grams: String(product?.weight_grams ?? 500), restricted: (product?.restricted_countries ?? []).join(", "),
  });
  const [variantName, setVariantName] = useState("Standard");
  const [sku, setSku] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg("");
    const body: Record<string, unknown> = {
      name: f.name, description: f.description, category: f.category ? Number(f.category) : null, origin_country: f.origin_country.toUpperCase(),
      maker: f.maker, base_price: f.base_price, currency: f.currency, status: f.status, weight_grams: Number(f.weight_grams) || 0,
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
            <select id="p-cur" className="select" value={f.currency} onChange={(e) => set("currency", e.target.value)}><option>USD</option><option>GHS</option></select>
          </Field>
          <Field id="p-s" label="Status" error={errors.status}>
            <select id="p-s" className="select" value={f.status} onChange={(e) => set("status", e.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select>
          </Field>
        </div>
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
    </>
  );
}

/* ----------------------------------------------------------------- stock */

interface StockRow { id: number; sku: string; name: string; quantity: number | null; product?: number }
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
            <thead><tr><th>SKU</th><th>Variant</th><th className="num">On hand</th><th></th></tr></thead>
            <tbody>
              {data.results.map((v) => (
                <tr key={v.id}><td>{v.sku}</td><td>{v.name}</td><td className="num">{v.quantity ?? 0}</td><td><button className="link-button" onClick={() => setOpen(v)}>Adjust</button></td></tr>
              ))}
              {data.results.length === 0 && <tr><td colSpan={4} className="muted">Nothing to show.</td></tr>}
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
