import { Component, useEffect, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useCart, useCurrency } from "./context";
import { useShopConfig } from "./guest-config";
import { LanguageSelect, useT } from "./i18n";
import { whatsappLink } from "./phone";
import { ContactButtons } from "./contact";
import { NotificationBell } from "./notifications";
import { reportError } from "./report";
import type { MessageKey } from "./locales";
import type { Product } from "./types";

/* ---------------------------------------------------------------- weave patterns */

const INK = "#0a2b29";
const TEAL = "#0e7f74";
const TURQ = "#12b5ae";
const COTTON = "#f1f8f7";
const DEEP = "#0b6a61";

const GOLD = "#e9a820";
const HIBISCUS = "#c2183a";

const PALETTES: [string, string, string][] = [
  [TEAL, COTTON, TURQ],
  [INK, GOLD, COTTON],
  [DEEP, INK, GOLD],
  [INK, HIBISCUS, GOLD],
  [INK, TURQ, COTTON],
  [DEEP, INK, TURQ],
  [COTTON, TEAL, INK],
  [INK, TEAL, TURQ],
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** A repeatable woven pattern chosen deterministically from a seed (product slug / category). */
export function pattern(seed: string): CSSProperties {
  const h = hash(seed);
  const [a, b, c] = PALETTES[h % PALETTES.length];
  switch (Math.floor(h / 7) % 5) {
    case 0:
      return { backgroundImage: `repeating-linear-gradient(90deg, ${a} 0 22px, ${b} 22px 28px, ${a} 28px 56px, ${c} 56px 62px)` };
    case 1:
      return { backgroundImage: `conic-gradient(${a} 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0)`, backgroundSize: "44px 44px" };
    case 2:
      return { backgroundImage: `repeating-linear-gradient(45deg, ${a} 0 14px, ${b} 14px 20px, ${c} 20px 24px, ${b} 24px 30px)` };
    case 3:
      return {
        backgroundColor: b,
        backgroundImage: `linear-gradient(135deg, ${a} 25%, transparent 25%), linear-gradient(225deg, ${a} 25%, transparent 25%), linear-gradient(315deg, ${a} 25%, transparent 25%), linear-gradient(45deg, ${a} 25%, transparent 25%)`,
        backgroundSize: "40px 40px",
        backgroundPosition: "-20px 0, -20px 0, 0 0, 0 0",
      };
    default:
      return { backgroundColor: b, backgroundImage: `radial-gradient(circle, ${a} 5px, transparent 5.5px), radial-gradient(circle, ${c} 2px, transparent 2.5px)`, backgroundSize: "30px 30px", backgroundPosition: "0 0, 15px 15px" };
  }
}

export function ProductArt({ product }: { product: Pick<Product, "name" | "slug" | "images"> }) {
  const img = product.images[0];
  if (img) return <img src={img.image} alt={img.alt_text || product.name} loading="lazy" />;
  return <div className="pattern" style={pattern(product.slug)} role="img" aria-label={`${product.name} (photo coming soon)`} />;
}

/* ---------------------------------------------------------------------- layout */

/** Title for pages that do not set their own, so the tab never keeps the previous page's name. */
export function routeTitle(pathname: string, t: (key: MessageKey) => string): string | undefined {
  const p = pathname.replace(/\/+$/, "") || "/";
  const table: [RegExp, () => string][] = [
    [/^\/bag$/, () => t("bag.title")],
    [/^\/login$/, () => t("login.title")],
    [/^\/register$/, () => t("register.title")],
    [/^\/forgot-password$/, () => t("login.forgot")],
    [/^\/reset-password$/, () => t("login.forgot")],
    [/^\/checkout\/complete$/, () => t("checkout.title")],
    [/^\/checkout$/, () => t("checkout.title")],
    [/^\/orders\/find$/, () => t("guest.find")],
    [/^\/orders(\/.*)?$/, () => t("orders.title")],
    [/^\/verify-email$/, () => t("register.title")],
    [/^\/support(\/.*)?$/, () => t("nav.help")],
    [/^\/account$/, () => t("prefs.title")],
    [/^\/notifications$/, () => t("notifications.title")],
  ];
  for (const [re, label] of table) if (re.test(p)) return label();
  if (p === "/" || p.startsWith("/shop") || ["/privacy", "/terms", "/returns-policy", "/cookies"].includes(p)) return undefined;
  return "Page not found";
}

export function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { currency, currencies, names, setCurrency } = useCurrency();
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const title = routeTitle(pathname, t);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  // Pages that set their own title (shop, product, policies) do so themselves; every other page gets one here.
  useEffect(() => {
    if (title) document.title = `${title} \u00b7 Mpanko`;
  }, [title]);

  return (
    <>
      <a className="skip" href="#main">{t("nav.skip")}</a>
      <header className="site-header">
        <div className="wrap">
          <div className="header-left">
            <Link to="/" className="logo" aria-label="Mpanko home">
              <img src="/logo-light.svg" alt="" width={59} height={56} />
            </Link>
            <div className="header-links">
              <nav className="nav" aria-label="Main">
                <NavLink to="/shop">{t("nav.shop")}</NavLink>
                {user && <NavLink to="/orders">{t("nav.orders")}</NavLink>}
                {user && <NavLink to="/support">{t("nav.help")}</NavLink>}
              </nav>
              <div className="header-selects">
                {currencies.length > 1 && (
                  <label>
                    <span className="sr-only">{t("nav.currency")}</span>
                    <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {currencies.map((c) => (
                        <option key={c} value={c}>{names[c] ? `${c} · ${names[c]}` : c}</option>
                      ))}
                    </select>
                  </label>
                )}
                <LanguageSelect />
              </div>
            </div>
          </div>
          <div className="header-tools">
            {user ? (
              <>
                <NotificationBell />
                <Link to="/account" className="icon-link tool-account" aria-label={t("nav.account")} title={t("nav.account")}><HeaderIcon name="user" /></Link>
                <button
                  type="button"
                  className="icon-link"
                  aria-label={t("nav.signOut")}
                  title={t("nav.signOut")}
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                >
                  <HeaderIcon name="out" />
                </button>
              </>
            ) : (
              <Link to="/login" className="tool-signin">{t("nav.signIn")}</Link>
            )}
            <Link to="/bag" className="icon-link bag-link tool-bag" aria-label={t("nav.bagItems", { count })} title={t("nav.bag")}>
              <HeaderIcon name="bag" />
              <span className="bag-count" aria-hidden="true">{count}</span>
            </Link>
          </div>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <TabBar />
      <div className="weave-rule" aria-hidden="true" />
      <footer className="site-footer">
        <div className="wrap">
          <div>
            <p className="tag">Rooted in Africa. Made for the World.</p>
            <p className="small">{t("footer.sub")}</p>
          </div>
          <div>
            <h3>{t("footer.shop")}</h3>
            <ul>
              <li><Link to="/shop">{t("footer.allProducts")}</Link></li>
              <li><Link to="/bag">{t("footer.yourBag")}</Link></li>
            </ul>
          </div>
          <div>
            <h3>{t("footer.account")}</h3>
            <ul>
              <li><Link to="/account">{t("footer.profile")}</Link></li>
              <li><Link to="/orders">{t("footer.track")}</Link></li>
              <li><ContactButtons /></li>
            </ul>
          </div>
          <div>
            <h3>{t("footer.policies")}</h3>
            <ul>
              <li><Link to="/privacy">{t("footer.privacy")}</Link></li>
              <li><Link to="/terms">{t("footer.terms")}</Link></li>
              <li><Link to="/returns-policy">{t("footer.returns")}</Link></li>
              <li><Link to="/cookies">{t("footer.cookies")}</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}

/* ------------------------------------------------------------------ crash screen */

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info.componentStack ?? "");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wrap page empty" role="alert">
        <h1>Something went wrong on our side</h1>
        <p>We have been told about it. Reload the page to carry on; your bag is saved.</p>
        <button className="btn" onClick={() => window.location.reload()}>Reload the page</button>
      </div>
    );
  }
}

/* ------------------------------------------------------------------ small pieces */

export function ProductTile({ product }: { product: Product }) {
  const { money } = useCurrency();
  const { t } = useT();
  const inStock = product.variants.some((v) => v.in_stock && v.is_active);
  const onBackorder = inStock && !product.variants.some((v) => v.in_stock && v.is_active && !v.on_backorder);
  return (
    <Link to={`/shop/${product.slug}`} className="tile">
      <div className="art">
        <ProductArt product={product} />
        {!inStock && <span className="badge-out">{t("common.soldOut")}</span>}
        {inStock && onBackorder && <span className="badge-out">{t("common.backorder")}</span>}
      </div>
      <span className="tile-body">
        <span className="name">{product.name}</span>
        {product.maker && <span className="maker">{product.maker}</span>}
        <span className="price">{money(product.base_price, product.currency)}</span>
        {product.category_name && <span className="cat">{product.category_name}</span>}
      </span>
    </Link>
  );
}

const HEADER_ICONS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  out: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  bag: <><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  shop: <><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9" /><path d="M5 12v8h14v-8" /></>,
  orders: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5" /><path d="M12 12v9" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></>,
};

/** The small pictures that stand in for Account, Sign out and Bag in the header. */
function HeaderIcon({ name }: { name: keyof typeof HEADER_ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {HEADER_ICONS[name]}
    </svg>
  );
}

/** The bar along the bottom of a phone screen: the places people go most, within thumb reach. Hidden on tablets and desktops, where the header has them. */
function TabBar() {
  const { user } = useAuth();
  const { count } = useCart();
  const { t } = useT();
  return (
    <nav className="tab-bar" aria-label="Quick links">
      <NavLink to="/shop"><HeaderIcon name="shop" /><span>{t("nav.shop")}</span></NavLink>
      {user && <NavLink to="/orders"><HeaderIcon name="orders" /><span>{t("nav.orders")}</span></NavLink>}
      {user && <NavLink to="/support"><HeaderIcon name="help" /><span>{t("nav.help")}</span></NavLink>}
      <NavLink to="/bag" aria-label={t("nav.bagItems", { count })}>
        <span className="tab-icon"><HeaderIcon name="bag" />{count > 0 && <span className="bag-count" aria-hidden="true">{count}</span>}</span>
        <span aria-hidden="true">{t("nav.bag")}</span>
      </NavLink>
      <NavLink to={user ? "/account" : "/login"}><HeaderIcon name="user" /><span>{user ? t("nav.account") : t("nav.signIn")}</span></NavLink>
    </nav>
  );
}

/** "Prefer to talk?" with the Email, Call and WhatsApp buttons, for help pages. */
export function ContactUs() {
  const { t } = useT();
  return (
    <div className="call-us">
      <span className="call-us-label">{t("callus.prefer")}</span>
      <ContactButtons />
    </div>
  );
}

/** A woven band at the end of a product list: a way forward when nothing in the list is quite right. */
export function AskBanner() {
  const { t } = useT();
  const whatsapp = whatsappLink(useShopConfig()?.whatsapp_number, import.meta.env.DEV)?.href;
  return (
    <aside className="ask-banner">
      <div className="ask-art" style={pattern("ask-us")} aria-hidden="true" />
      <div className="ask-copy">
        <h3>{t("shop.askTitle")}</h3>
        <p>{t("shop.askBody")}</p>
      </div>
      {whatsapp ? (
        <a className="btn" href={whatsapp} target="_blank" rel="noopener noreferrer">{t("shop.askButton")}</a>
      ) : (
        <Link to="/support/new" className="btn">{t("shop.askButton")}</Link>
      )}
    </aside>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Field({ label, error, children, id }: { label: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <span className="error-text" id={`${id}-err`}>{error}</span>}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="loading" role="status">{what}…</p>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fn()
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`status ${status}`}>{statusLabel(status)}</span>;
}


/** Password field with a show/hide button. Drop-in for <input type="password">. */
export function PasswordInput({ id, value, onChange, autoComplete, required }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; required?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className="input" type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      <button type="button" className="pw-toggle" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-controls={id}>
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------- search and sort */

export interface SearchField { value: string; label: string }

/** One search bar with a drop-down that picks which detail to search by. */
export function SearchBox({ id, label, value, onChange, field, onField, fields, placeholder, onSubmit, submitLabel }: {
  id: string; label: string; value: string; onChange: (v: string) => void; field: string; onField: (v: string) => void; fields: SearchField[];
  placeholder?: string; onSubmit?: () => void; submitLabel?: string;
}) {
  const { t } = useT();
  return (
    <div className="searchbox" role="search">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={`${id}-in`} className="select" aria-label={t("search.in")} value={field} onChange={(e) => onField(e.target.value)}>
        {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <input id={id} className="input" type="search" placeholder={placeholder ?? label} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit?.(); } }} />
      {submitLabel && <button className="btn quiet" type="button" onClick={() => onSubmit?.()}>{submitLabel}</button>}
    </div>
  );
}

export type SortKind = "date" | "name" | "price" | "count" | "status" | "menu";

/** Which icon a sort choice gets, read from its value ("-created_at", "name-desc", "grand_total"). */
export function sortIcon(value: string): { kind: SortKind; dir: "asc" | "desc" } {
  const dir = value.startsWith("-") || value.endsWith("-desc") ? "desc" : "asc";
  const key = value.replace(/^-/, "").replace(/-desc$/, "");
  const kind: SortKind = /created|joined|updated|date|_at$/.test(key) ? "date" : /price|total/.test(key) ? "price" : /count/.test(key) ? "count" : key === "status" ? "status" : key === "menu" ? "menu" : "name";
  return { kind, dir };
}

/** The icon for one sort choice: what it sorts by on the left, which way on the right. */
export function SortIcon({ value }: { value: string }) {
  const { kind, dir } = sortIcon(value);
  const glyph = (t: string) => <text x="8" y="15" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor" stroke="none">{t}</text>;
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "date" && <><rect x="1" y="4" width="14" height="13" rx="2" /><path d="M1 8h14M5 2v3M11 2v3" /></>}
      {kind === "name" && glyph("A")}
      {kind === "price" && glyph("$")}
      {kind === "count" && glyph("#")}
      {kind === "status" && <path d="M3 11l4 4 8-9" />}
      {kind === "menu" && <path d="M2 5h12M2 10h12M2 15h12" />}
      {kind !== "status" && kind !== "menu" && (dir === "desc" ? <path d="M23 3v14M19 13l4 4 4-4" /> : <path d="M23 17V3M19 7l4-4 4 4" />)}
    </svg>
  );
}

/** Sort choices as icon buttons (each has a name for screen readers and a tooltip); the chosen one is filled in and named beside them. */
export function SortButtons({ label = "Sort by", value, options, onChange }: { label?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const current = options.find((o) => o.value === value)?.label;
  return (
    <div className="sortbuttons" role="group" aria-label={label}>
      <span className="sortbuttons-label">{label}</span>
      {options.map((o) => (
        <button key={o.value} type="button" className="sortbtn" title={o.label} aria-label={o.label} aria-pressed={value === o.value} onClick={() => onChange(o.value)}><SortIcon value={o.value} /></button>
      ))}
      {current && <span className="sortbuttons-current" aria-live="polite">{current}</span>}
    </div>
  );
}
