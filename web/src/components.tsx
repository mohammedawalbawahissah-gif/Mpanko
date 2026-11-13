import { Component, useEffect, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useCart, useCurrency } from "./context";
import { LanguageSelect, useT } from "./i18n";
import { reportError } from "./report";
import type { Product } from "./types";

/* ---------------------------------------------------------------- weave patterns */

const INK = "#141b3c";
const INDIGO = "#2a3fa0";
const GOLD = "#f2b705";
const COTTON = "#f5f6f8";
const MALACHITE = "#0e7c5a";

const PALETTES: [string, string, string][] = [
  [INDIGO, COTTON, GOLD],
  [INK, GOLD, COTTON],
  [MALACHITE, INK, GOLD],
  [COTTON, INDIGO, INK],
  [INK, INDIGO, GOLD],
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

function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="2" width="8" height="28" fill={INDIGO} />
      <rect x="12" y="2" width="8" height="28" fill={GOLD} />
      <rect x="23" y="2" width="8" height="28" fill={INK} />
    </svg>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { currency, currencies, names, setCurrency } = useCurrency();
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">{t("nav.skip")}</a>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="logo" aria-label="Mpanko home">
            <Mark />
            Mpanko
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/shop">{t("nav.shop")}</NavLink>
            {user && <NavLink to="/orders">{t("nav.orders")}</NavLink>}
            {user && <NavLink to="/support">{t("nav.help")}</NavLink>}
          </nav>
          <div className="header-tools">
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
            <Link to="/bag" className="bag-link" aria-label={t("nav.bagItems", { count })}>
              {t("nav.bag")} <span className="bag-count">{count}</span>
            </Link>
          </div>
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
      <span className="name">{product.name}</span>
      {product.maker && <span className="maker">{product.maker}</span>}
      <span className="price">{money(product.base_price, product.currency)}</span>
    </Link>
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
