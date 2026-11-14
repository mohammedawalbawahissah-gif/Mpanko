import { Component, useEffect, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useCart, useCurrency } from "./context";
import { useShopConfig } from "./guest-config";
import { LanguageSelect, useT } from "./i18n";
import { callLink } from "./phone";
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
  const config = useShopConfig();
  const whatsapp = (config?.whatsapp_number ?? "").replace(/\D/g, "");
  const call = callLink(config?.support_phone, import.meta.env.DEV);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const title = routeTitle(pathname, t);
  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
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
          <Link to="/" className="logo" aria-label="Mpanko home">
            <img src="/logo.svg" alt="" width={59} height={56} />
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/shop">{t("nav.shop")}</NavLink>
            {user && <NavLink to="/orders">{t("nav.orders")}</NavLink>}
            {user && <NavLink to="/support">{t("nav.help")}</NavLink>}
          </nav>
          <button type="button" className="menu-toggle link-button" aria-expanded={menuOpen} aria-controls="header-tools" onClick={() => setMenuOpen((o) => !o)}>{t("nav.menu")}</button>
          <div id="header-tools" className={`header-tools${menuOpen ? " open" : ""}`}>
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
            {user ? (
              <>
                <Link to="/account">{t("nav.account")}</Link>
                <button
                  className="link-button"
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                >
                  {t("nav.signOut")}
                </button>
              </>
            ) : (
              <Link to="/login">{t("nav.signIn")}</Link>
            )}
          </div>
          <Link to="/bag" className="bag-link" aria-label={t("nav.bagItems", { count })}>
            {t("nav.bag")} <span className="bag-count">{count}</span>
          </Link>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
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
              {call && <li><a href={call.href} className="call-link">{t("footer.call")}: <span className="nowrap">{call.label}</span></a>{call.placeholder && <span className="small muted"> (placeholder)</span>}</li>}
              {whatsapp && <li><a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">{t("footer.whatsapp")}</a></li>}
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

/** A woven band at the end of a product list: a way forward when nothing in the list is quite right. */
export function AskBanner() {
  const { t } = useT();
  const whatsapp = (useShopConfig()?.whatsapp_number ?? "").replace(/\D/g, "");
  return (
    <aside className="ask-banner">
      <div className="ask-art" style={pattern("ask-us")} aria-hidden="true" />
      <div className="ask-copy">
        <h3>{t("shop.askTitle")}</h3>
        <p>{t("shop.askBody")}</p>
      </div>
      {whatsapp ? (
        <a className="btn" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">{t("shop.askButton")}</a>
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
