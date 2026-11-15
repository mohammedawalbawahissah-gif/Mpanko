import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { Alert, Loading, errText, useAsync } from "./ui";

interface Dish { id: number; name: string; section: string; price: string; currency: string; published: boolean }
interface MenuData { category: { name: string; slug: string }; items: Dish[] }

const SLUG = "qt-eatery";

/** QT Eatery's menu: set every dish's price and put it on sale, in one screen. A dish with no price cannot be ordered. */
export function MenuPrices() {
  const menu = useAsync(() => api<MenuData>(`/menu/${SLUG}/prices/`), []);
  const [rows, setRows] = useState<Dish[]>([]);
  const [fill, setFill] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (menu.data) setRows(menu.data.items); }, [menu.data]);

  const sections = Array.from(new Set(rows.map((r) => r.section)));
  const onSale = rows.filter((r) => r.published).length;
  const edit = (id: number, patch: Partial<Dish>) => { setSaved(""); setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r))); };
  const empty = (r: Dish) => !r.price || Number(r.price) <= 0;

  const applyToSection = (section: string) => {
    const value = (fill[section] ?? "").trim();
    if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) { setError("Enter a price above 0 to fill the empty prices."); return; }
    setError(""); setSaved("");
    setRows((all) => all.map((r) => (r.section === section && empty(r) ? { ...r, price: value } : r)));
  };

  const save = async () => {
    setBusy(true); setErrors({}); setError(""); setSaved("");
    try {
      const res = await api<{ changed: number }>(`/menu/${SLUG}/prices/`, { method: "POST", body: { items: rows.map((r) => ({ id: r.id, price: r.price || "0", published: r.published })) } });
      setSaved(res.changed ? `Saved. ${res.changed} dish${res.changed === 1 ? "" : "es"} updated.` : "Nothing to save. Every dish is already up to date.");
      menu.reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) { setErrors(e.fields()); setError("Fix the highlighted dishes and save again. Nothing was saved."); }
      else setError(errText(e));
    } finally { setBusy(false); }
  };

  return (
    <>
      <h1>QT Eatery menu</h1>
      <p className="muted">Set a price for each dish and tick <strong>On sale</strong>. Buyers can order a dish only when it has a price and is on sale. The rest still show on the website menu.</p>
      {menu.loading && <Loading />}
      {menu.error && <Alert>{menu.error}</Alert>}
      {error && <Alert>{error}</Alert>}
      {saved && <p role="status" className="muted"><strong>{saved}</strong></p>}
      {menu.data && rows.length === 0 && <p className="muted">The menu has not been loaded yet. Run <code>python manage.py load_qt_eatery_menu</code> on the api service first.</p>}
      {rows.length > 0 && (
        <>
          <p className="small">{onSale} of {rows.length} dishes on sale ({rows[0]?.currency}).</p>
          {sections.map((section) => (
            <section key={section} aria-labelledby={`sec-${section}`}>
              <h2 id={`sec-${section}`}>{section}</h2>
              <p className="row small">
                <label htmlFor={`fill-${section}`}>Same price for every empty dish here</label>
                <input id={`fill-${section}`} className="input narrow" inputMode="decimal" value={fill[section] ?? ""} onChange={(e) => setFill({ ...fill, [section]: e.target.value })} />
                <button type="button" className="btn quiet" onClick={() => applyToSection(section)}>Fill empty prices</button>
              </p>
              <div className="scroll">
                <table className="table">
                  <thead><tr><th>Dish</th><th>Price ({rows[0]?.currency})</th><th>On sale</th></tr></thead>
                  <tbody>
                    {rows.filter((r) => r.section === section).map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}{errors[String(r.id)] && <div role="alert" className="error small">{errors[String(r.id)]}</div>}</td>
                        <td>
                          <label className="sr-only" htmlFor={`price-${r.id}`}>Price for {r.name}</label>
                          <input id={`price-${r.id}`} className="input narrow" inputMode="decimal" value={Number(r.price) > 0 ? r.price : ""} placeholder="0.00" aria-invalid={errors[String(r.id)] ? true : undefined} onChange={(e) => edit(r.id, { price: e.target.value })} />
                        </td>
                        <td>
                          <label><input type="checkbox" checked={r.published} onChange={(e) => edit(r.id, { published: e.target.checked })} /> On sale</label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p><button type="button" className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save all prices"}</button></p>
        </>
      )}
    </>
  );
}
