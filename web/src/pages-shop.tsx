import { useSeo } from "./seo";
import { useT } from "./i18n";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, type Page } from "./api";
import { departmentOf, departments } from "./categories";
import { Alert, AskBanner, Loading, pattern, ProductArt, ProductTile, useAsync } from "./components";
import { useAuth, useCart, useCurrency, type CartLine } from "./context";
import { useGuestCheckoutEnabled } from "./guest-config";
import type { Category, Product, Variant } from "./types";

/* ------------------------------------------------------------------- home */

function CategoryCards({ categories }: { categories: Category[] }) {
  const tree = departments(categories).slice(0, 6);
  return (
    <div className="hero-side">
      <nav className="cat-cards" aria-label="Shop by category">
        {tree.map(({ category }) => (
          <Link key={category.id} to={`/shop?category=${category.slug}`} className="cat-card">
            <span className="swatch-wrap" aria-hidden="true"><span className="swatch" style={{ ...pattern(category.slug), display: "block", height: "100%" }} /></span>
            <span className="cat-name">{category.name}</span>
          </Link>
        ))}
        <Link to="/shop" className="cat-card all">Browse all products</Link>
      </nav>
      <div className="hero-cloth" aria-hidden="true"><span>Made by African makers</span></div>
    </div>
  );
}

export function Home() {
  const { t } = useT();
  const cats = useAsync(() => api<Category[]>("/categories/"), []);
  const products = useAsync(() => api<Page<Product>>("/products/?ordering=-created_at"), []);
  return (
    <>
      <div className="hero-band">
        <div className="wrap">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <h1 id="hero-title">Rooted in Africa. Made for the World.</h1>
              <p>Hand-woven textiles, shea, baskets and fashion from African makers, delivered to your door with tracking.</p>
              <div className="hero-actions">
                <Link to="/shop" className="btn">{t("home.shopCollection")}</Link>
              </div>
            </div>
            <CategoryCards categories={cats.data ?? []} />
          </section>
        </div>
      </div>
      <div className="wrap">

        <section className="facts" aria-label="How Mpanko works">
          <div>
            <h3>Pay the way you pay</h3>
            <p>Cards worldwide, and Mobile Money for shoppers in Ghana.</p>
          </div>
          <div>
            <h3>Prices in your currency</h3>
            <p>Browse in dollars or cedis. You see the exact total before you pay.</p>
          </div>
          <div>
            <h3>Tracked from maker to door</h3>
            <p>Follow every order from packing to delivery, in Ghana or abroad.</p>
          </div>
        </section>

        <section className="depts" aria-labelledby="dept-title">
          <div className="section-head">
            <h2 id="dept-title">{t("home.departments")}</h2>
          </div>
          <ul className="dept-grid">
            {departments(cats.data).map(({ category, children }) => (
              <li key={category.id}>
                <Link to={`/shop?category=${category.slug}`} className="dept">
                  <span className="dept-swatch" style={pattern(category.slug)} aria-hidden="true" />
                  <span className="dept-name">{category.name}</span>
                  <span className="dept-count">{t("home.deptCount", { n: children.length })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="page" style={{ paddingTop: 0 }} aria-labelledby="new-title">
          <div className="section-head">
            <h2 id="new-title">New from our makers</h2>
            <Link to="/shop" className="btn quiet sm">See all products</Link>
          </div>
          {products.loading && <Loading what="Loading products" />}
          {products.error && <Alert>{products.error}</Alert>}
          {products.data && products.data.results.length === 0 && <p className="muted">New products are on their way. Check back soon.</p>}
          <div className="grid">
            {products.data?.results.slice(0, 12).map((p) => <ProductTile key={p.id} product={p} />)}
            {products.data && products.data.results.length > 0 && <AskBanner />}
          </div>
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- shop */

const SORTS = [
  { value: "-created_at", label: "Newest first" },
  { value: "base_price", label: "Price: low to high" },
  { value: "-base_price", label: "Price: high to low" },
  { value: "name", label: "Name A to Z" },
];

export function Shop() {
  const { t } = useT();
  useSeo("Shop African-made products", "Food, fashion, art, furniture, electronics, books and more from African makers and sellers, shipped worldwide with tracking.");
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const search = params.get("q") ?? "";
  const ordering = params.get("sort") ?? "-created_at";
  const [draft, setDraft] = useState(search);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const cats = useAsync(() => api<Category[]>("/categories/"), []);

  useEffect(() => setDraft((d) => (d.trim() === search ? d : search)), [search]);
  useEffect(() => setPage(1), [category, search, ordering]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ ordering, page: String(page) });
    if (category) qs.set("category", category);
    if (search) qs.set("search", search);
    api<Page<Product>>(`/products/?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setCount(r.count);
        setItems((prev) => (page === 1 ? r.results : [...prev, ...r.results]));
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load products."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [category, search, ordering, page]);

  // Results follow the typing after a short pause; the Search button and Enter still work straight away.
  useEffect(() => {
    const value = draft.trim();
    if (value === search) return;
    const id = window.setTimeout(() => update("q", value), 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const tree = departments(cats.data);
  const dept = category ? departmentOf(cats.data, category) : undefined;
  const selected = category ? cats.data?.find((c) => c.slug === category) : undefined;

  return (
    <div className="wrap page">
      {dept && selected && selected.slug !== dept.category.slug && (
        <p className="small crumbs"><button className="link-button" onClick={() => update("category", dept.category.slug)}>{dept.category.name}</button><span className="muted"> / {selected.name}</span></p>
      )}
      <h1>{category ? cats.data?.find((c) => c.slug === category)?.name ?? "Shop" : "All products"}</h1>
      <div className="shop-layout">
        <aside className={`filters${filtersOpen ? " open" : ""}`} aria-label={t("shop.filters")}>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update("q", draft.trim());
            }}
          >
            <label htmlFor="q" className="sr-only">Search products</label>
            <div className="search-row">
              <input id="q" className="input" type="search" placeholder="Search products" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button className="btn quiet" type="submit">{t("shop.searchButton")}</button>
            </div>
          </form>
          <button type="button" className="btn quiet filters-toggle" aria-expanded={filtersOpen} aria-controls="filter-panel" onClick={() => setFiltersOpen((o) => !o)}>
            {t("shop.filters")}{category || ordering !== SORTS[0].value ? " \u2022" : ""}
          </button>
          <div id="filter-panel" className="filter-panel">
          <nav aria-label="Categories">
            <h3>Categories</h3>
            <ul className="cat-tree">
              <li><button className="chip" aria-pressed={!category} onClick={() => update("category", "")}>All</button></li>
              {tree.map(({ category: top, children }) => {
                const open = dept?.category.id === top.id;
                return (
                  <li key={top.id} className={open ? "open" : undefined}>
                    <button className="chip" aria-pressed={category === top.slug} aria-expanded={children.length ? open : undefined} onClick={() => update("category", top.slug)}>
                      {top.name}
                    </button>
                    {open && children.length > 0 && (
                      <ul className="cat-sub">
                        <li><button className="chip sub" aria-pressed={category === top.slug} onClick={() => update("category", top.slug)}>{t("shop.allIn", { name: top.name })}</button></li>
                        {children.map((c) => (
                          <li key={c.id}>
                            <button className="chip sub" aria-pressed={category === c.slug} onClick={() => update("category", c.slug)}>{c.name}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="sort-box">
            <label htmlFor="sort"><h3>Sort by</h3></label>
            <select id="sort" className="select" style={{ width: "100%" }} value={ordering} onChange={(e) => update("sort", e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          </div>
        </aside>

        <section aria-live="polite">
          {error && <Alert>{error}</Alert>}
          {!loading && !error && items.length === 0 && (
            <div className="empty">
              <h2>No products match</h2>
              <p className="muted">Try a different search, or clear the category filter.</p>
              <button className="btn quiet" onClick={() => setParams({})}>Clear filters</button>
            </div>
          )}
          <div className="grid">
            {items.map((p) => <ProductTile key={p.id} product={p} />)}
            {!loading && !error && items.length > 0 && items.length >= count && <AskBanner />}
          </div>
          {loading && <Loading what="Loading products" />}
          {!loading && items.length < count && (
            <p style={{ marginTop: "2rem" }}>
              <button className="btn quiet" onClick={() => setPage((n) => n + 1)}>Show more products</button>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- product */

export function ProductPage() {
  const { slug = "" } = useParams();
  const { data: product, error, loading } = useAsync(() => api<Product>(`/products/${slug}/`), [slug]);
  const { add } = useCart();
  const { money, isBase, currency } = useCurrency();
  const [variantId, setVariantId] = useState<number | null>(null);
  const { t } = useT();
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useSeo(product?.name, product?.description);
  const variants = useMemo(() => product?.variants.filter((v) => v.is_active) ?? [], [product]);
  useEffect(() => {
    if (!variants.length) return;
    setVariantId((cur) => cur ?? (variants.find((v) => v.in_stock) ?? variants[0]).id);
  }, [variants]);

  if (loading) return <div className="wrap page"><Loading what="Loading product" /></div>;
  if (error || !product) {
    return (
      <div className="wrap page">
        <h1>We couldn't find that product</h1>
        <p className="muted">It may have been removed or is no longer for sale.</p>
        <Link to="/shop" className="btn">Browse all products</Link>
      </div>
    );
  }
  const variant: Variant | undefined = variants.find((v) => v.id === variantId);

  const onAdd = async () => {
    if (!variant) return;
    setAdding(true);
    setMessage(null);
    try {
      await add(product, variant, qty);
      setMessage({ kind: "ok", text: `Added ${qty} to your bag.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError ? e.message : "Couldn't add to your bag. Try again." });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="wrap page">
      <p className="small crumbs"><Link to="/shop">All products</Link>{product.category_name && <span className="muted"> / {product.category_name}</span>}</p>
      <div className="product">
        <div className="gallery">
          {product.images.length > 0 ? (
            product.images.map((img) => (
              <div className="art" key={img.id}><img src={img.image} alt={img.alt_text || product.name} /></div>
            ))
          ) : (
            <div className="art"><ProductArt product={product} /></div>
          )}
        </div>
        <div className="info">
          <h1>{product.name}</h1>
          <p className="price-big">{money(variant?.price ?? product.base_price, product.currency)}</p>
          {!isBase && <p className="small muted">Shown in {currency} for reference. You'll see the exact total at checkout.</p>}
          {product.description && <p>{product.description}</p>}
          {product.maker && (
            <div className="maker-note">
              <strong>Made by {product.maker}</strong>
              {product.origin_country && <div className="muted small">Made in {countryName(product.origin_country)}</div>}
            </div>
          )}
          {variants.length > 1 && (
            <>
              <h3 id="variant-label">Choose an option</h3>
              <div className="variant-list" role="radiogroup" aria-labelledby="variant-label">
                {variants.map((v) => (
                  <button key={v.id} role="radio" aria-checked={v.id === variantId} className="variant" disabled={!v.in_stock} onClick={() => setVariantId(v.id)}>
                    {v.name || v.sku}
                  </button>
                ))}
              </div>
            </>
          )}
          {variant?.made_to_order && <p className="stock-ok">{t("product.madeToOrder")}{variant.lead_time_days ? `. ${t("product.backorderDays", { days: variant.lead_time_days })}` : ""}</p>}
          {variant && !variant.made_to_order && (variant.on_backorder
            ? <p className="stock-ok">{t("product.backorder")}{variant.backorder_days ? `. ${t("product.backorderDays", { days: variant.backorder_days })}` : ""}</p>
            : variant.in_stock ? <p className="stock-ok">In stock</p> : <p className="stock-out">Sold out</p>)}
          <div className="buy-row">
            <div className="qty" role="group" aria-label="Quantity">
              <button aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span aria-live="polite">{qty}</span>
              <button aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(20, q + 1))}>+</button>
            </div>
            <button className="btn" style={{ flex: 1 }} disabled={!variant?.in_stock || adding} onClick={onAdd}>
              {adding ? "Adding…" : "Add to bag"}
            </button>
          </div>
          {message && (
            <Alert kind={message.kind}>
              {message.text} {message.kind === "ok" && <Link to="/bag">View your bag</Link>}
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

const REGION = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(undefined, { type: "region" }) : null;
export function countryName(code: string): string {
  try {
    return REGION?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/* -------------------------------------------------------------------- bag */

export function Bag() {
  const { t } = useT();
  const { lines, setQuantity, remove } = useCart();
  const { toNumber, money, currency, exact } = useCurrency();
  const { user } = useAuth();
  const guestEnabled = useGuestCheckoutEnabled();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That change didn't save. Try again.");
    }
  };

  if (lines.length === 0) {
    return (
      <div className="wrap page empty">
        <h1>{t("bag.empty")}</h1>
        <p className="muted">{t("bag.emptyHint")}</p>
        <Link to="/shop" className="btn">{t("common.browse")}</Link>
      </div>
    );
  }
  const subtotal = lines.reduce((sum, l) => sum + toNumber(l.unitPrice, l.currency) * l.quantity, 0);

  return (
    <div className="wrap page">
      <h1>{t("bag.title")}</h1>
      {error && <Alert>{error}</Alert>}
      <div className="bag">
        <div>
          {lines.map((l: CartLine) => (
            <div className="line" key={l.key}>
              <div className="art"><div className="pattern" style={pattern(l.slug ?? l.sku)} role="img" aria-label={l.name} /></div>
              <div>
                <strong>{l.slug ? <Link to={`/shop/${l.slug}`}>{l.name}</Link> : l.name}</strong>
                {l.variantName && <div className="muted small">{l.variantName}</div>}
                <div className="muted small">{t("bag.each", { price: money(l.unitPrice, l.currency) })}</div>
                <div className="actions">
                  <div className="qty" role="group" aria-label={`Quantity for ${l.name}`}>
                    <button aria-label="Decrease quantity" onClick={() => run(() => setQuantity(l, l.quantity - 1))} disabled={l.quantity <= 1}>−</button>
                    <span>{l.quantity}</span>
                    <button aria-label="Increase quantity" onClick={() => run(() => setQuantity(l, Math.min(99, l.quantity + 1)))}>+</button>
                  </div>
                  <button className="link-button" onClick={() => run(() => remove(l))}>{t("common.remove")}</button>
                </div>
              </div>
              <strong>{exact((toNumber(l.unitPrice, l.currency) * l.quantity).toFixed(2), currency)}</strong>
            </div>
          ))}
        </div>
        <aside className="summary" aria-label="Order summary">
          <dl>
            <dt>{t("bag.items")}</dt>
            <dd>{exact(subtotal.toFixed(2), currency)}</dd>
            <dt>{t("checkout.delivery")}</dt>
            <dd className="muted">{t("bag.chosenLater")}</dd>
          </dl>
          {user || guestEnabled ? (
            <button className="btn block" onClick={() => navigate("/checkout")}>{user ? t("bag.continue") : t("guest.checkout")}</button>
          ) : (
            <button className="btn block" onClick={() => navigate("/login?next=/checkout")}>{t("bag.signInToCheckOut")}</button>
          )}
          {!user && guestEnabled && <p className="small" style={{ marginTop: "0.75rem" }}><Link to="/login?next=/checkout">{t("guest.signIn")}</Link></p>}
          <p className="small muted" style={{ marginTop: "0.75rem" }}>{t("bag.saved")}</p>
        </aside>
      </div>
    </div>
  );
}
