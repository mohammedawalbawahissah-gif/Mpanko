import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "./api";
import { Alert, Loading, useAsync } from "./components";
import { useCart, useCurrency } from "./context";
import { useSeo } from "./seo";
import type { MenuData, MenuItem } from "./types";

/** A menu order page: the dishes of a menu category in sections, each with a price and an Add button, then the normal bag and checkout. */
export function MenuPage() {
  const { slug = "" } = useParams();
  const { hash } = useLocation();
  const menu = useAsync(() => api<MenuData>(`/menu/${slug}/`), [slug]);
  const { add, lines } = useCart();
  const { money } = useCurrency();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState("");
  const [said, setSaid] = useState("");
  const [failed, setFailed] = useState("");
  const data = menu.data;
  useSeo(data ? `${data.category.name} menu` : undefined, data ? `Order from the ${data.category.name} menu and check out.` : undefined);

  // A link from the website (/menu/qt-eatery#dish-fish-pie) lands on that dish once the menu has loaded.
  useEffect(() => {
    if (!data || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" });
  }, [data, hash]);

  const sections = (data?.sections ?? [])
    .map((s) => ({ ...s, items: s.items.filter((i) => i.orderable) }))
    .filter((s) => s.items.length > 0);
  const inBag = lines.reduce((n, l) => n + l.quantity, 0);

  const onAdd = async (item: MenuItem) => {
    const variant = item.variants.find((v) => v.id === choice[item.slug]) ?? item.variants[0];
    const count = qty[item.slug] ?? 1;
    setAdding(item.slug); setSaid(""); setFailed("");
    try {
      await add({ name: item.name, slug: item.slug, currency: item.currency }, variant, count);
      setSaid(`Added ${count} × ${item.name} to your bag.`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not add that to your bag.");
    } finally { setAdding(""); }
  };

  return (
    <div className="wrap page menu-page">
      <p className="small crumbs"><Link to="/shop">Shop</Link><span className="muted"> / {data?.category.parent || "Food"} / {data?.category.name ?? ""}</span></p>
      <h1>{data ? `${data.category.name} menu` : "Menu"}</h1>
      {menu.loading && <Loading />}
      {menu.error && <Alert>{menu.error}</Alert>}
      {data && (
        <>
          {data.note && <p className="lede">{data.note}</p>}
          <p className="small muted">Fresh food made for you in Worcester, Massachusetts. Orders are for the United States. Tell us your choice of meat, stew or heat level in the notes at checkout.</p>
          {sections.length === 0 && <p>The menu is being priced. Please check back soon.</p>}
          {sections.length > 1 && (
            <nav aria-label="Menu sections" className="menu-nav">
              <ul>{sections.map((s, i) => <li key={s.name}><a className="chip" href={`#menu-${i}`}>{s.name}</a></li>)}</ul>
            </nav>
          )}
          <div role="status" aria-live="polite" className="menu-said">{said}</div>
          {failed && <Alert>{failed}</Alert>}
          {sections.map((s, i) => (
            <section key={s.name} id={`menu-${i}`} aria-labelledby={`menu-h-${i}`} className="menu-section">
              <h2 id={`menu-h-${i}`}>{s.name}</h2>
              <ul className="menu-items">
                {s.items.map((item) => {
                  const picked = item.variants.find((v) => v.id === choice[item.slug]) ?? item.variants[0];
                  const n = qty[item.slug] ?? 1;
                  return (
                    <li key={item.slug} id={`dish-${item.slug}`} className="dish">
                      <div className="dish-info">
                        <strong>{item.name}</strong>
                        {item.description && <span className="small muted">{item.description}</span>}
                        {item.variants.length > 1 && (
                          <>
                            <label htmlFor={`opt-${item.slug}`} className="sr-only">Option for {item.name}</label>
                            <select id={`opt-${item.slug}`} className="input" value={picked.id} onChange={(e) => setChoice({ ...choice, [item.slug]: Number(e.target.value) })}>
                              {item.variants.map((v) => <option key={v.id} value={v.id}>{v.name || v.sku} · {money(v.price, item.currency)}</option>)}
                            </select>
                          </>
                        )}
                      </div>
                      <span className="dish-price">{money(picked.price, item.currency)}</span>
                      <div className="qty" role="group" aria-label={`Quantity of ${item.name}`}>
                        <button type="button" aria-label={`Decrease quantity of ${item.name}`} onClick={() => setQty({ ...qty, [item.slug]: Math.max(1, n - 1) })}>−</button>
                        <span aria-live="polite">{n}</span>
                        <button type="button" aria-label={`Increase quantity of ${item.name}`} onClick={() => setQty({ ...qty, [item.slug]: Math.min(20, n + 1) })}>+</button>
                      </div>
                      <button type="button" className="btn" disabled={adding === item.slug} onClick={() => onAdd(item)}>{adding === item.slug ? "Adding…" : "Add"}</button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {inBag > 0 && (
            <div className="menu-bag" role="region" aria-label="Your bag">
              <span>{inBag} {inBag === 1 ? "item" : "items"} in your bag</span>
              <Link to="/bag" className="btn">View bag and check out</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
