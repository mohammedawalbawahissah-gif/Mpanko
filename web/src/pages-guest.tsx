import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, idempotencyKey } from "./api";
import { AddressForm } from "./address";
import { Alert, Field, Loading, StatusPill, statusLabel, useAsync } from "./components";
import { useAuth, useCart, useCurrency } from "./context";
import { useT } from "./i18n";
import { countryName } from "./pages-shop";
import { Checkout, CheckoutComplete, providerName } from "./pages-checkout";
import { readGuestSession, saveGuestSession } from "./guest-session";
import type { Address, Order, PaymentMethod, ShippingService, TaxEstimate } from "./types";

/* ---------------------------------------------------------------- config */

export { useGuestCheckoutEnabled } from "./guest-config";
import { useGuestCheckoutEnabled } from "./guest-config";

/** Flatten DRF's nested errors ({address: {line1: [..]}}) into one readable map. */
export function flatErrors(data: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "string") out[prefix + k] = v[0];
      else if (typeof v === "string") out[prefix + k] = v;
      else if (v && typeof v === "object") Object.assign(out, flatErrors(v, ""));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- routes */

/** /checkout: signed-in shoppers use their account; visitors get guest checkout only when the shop allows it. */
export function CheckoutRoute() {
  const { user, ready } = useAuth();
  const enabled = useGuestCheckoutEnabled();
  const location = useLocation();
  if (!ready || (!user && enabled === null)) return <Loading />;
  if (user) return <Checkout />;
  if (!enabled) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <GuestCheckout />;
}

export function CheckoutCompleteRoute() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (user) return <CheckoutComplete />;
  if (readGuestSession()) return <CheckoutComplete />;
  return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
}

/* ---------------------------------------------------------------- guest checkout */

interface PlacedGuest extends Order {
  guest_token: string;
}

export function GuestCheckout() {
  const { t } = useT();
  const { lines } = useCart();
  const { currency: shown, payCurrency: currency, convert, exact, money } = useCurrency();
  const toNumber = (amount: string | number, from: string) => convert(amount, from, currency);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<Address | null>(null);
  const [services, setServices] = useState<ShippingService[] | null>(null);
  const [restricted, setRestricted] = useState<string[]>([]);
  const [serviceCode, setServiceCode] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [provider, setProvider] = useState("");
  const [terms, setTerms] = useState(false);
  const [duties, setDuties] = useState(false);
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<PlacedGuest | null>(null);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const key = useRef(idempotencyKey());
  const slugs = lines.filter((l) => l.slug).map((l) => `${l.slug}:${l.quantity}`).join(",");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setServices(null);
    setServiceCode("");
    api<{ services: ShippingService[]; restricted_products: string[] }>(`/shipping/quote/?country=${address.country}&city=${encodeURIComponent(address.city)}&postal_code=${encodeURIComponent(address.postal_code)}&products=${slugs}`)
      .then((r) => {
        if (cancelled) return;
        setServices(r.services);
        setRestricted(r.restricted_products);
        if (r.services.length) setServiceCode(r.services[0].service_code);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load delivery options."));
    return () => {
      cancelled = true;
    };
  }, [address, slugs]);

  useEffect(() => {
    api<PaymentMethod[]>(`/payments/methods/?currency=${currency}`)
      .then((m) => {
        setMethods(m);
        setProvider((p) => (m.some((x) => x.provider === p) ? p : m[0]?.provider ?? ""));
      })
      .catch(() => setMethods([]));
  }, [currency]);

  // A changed choice is a different order: use a fresh idempotency key.
  useEffect(() => {
    key.current = idempotencyKey();
  }, [email, address, serviceCode, currency]);

  const service = services?.find((s) => s.service_code === serviceCode);
  const itemsTotal = lines.reduce((sum, l) => sum + toNumber(l.unitPrice, l.currency) * l.quantity, 0);
  const shippingTotal = service ? toNumber(service.price, service.currency) : 0;
  const taxCountry = address?.country;
  useEffect(() => {
    if (!taxCountry || !service) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    api<TaxEstimate>(`/tax/estimate/?country=${taxCountry}&currency=${currency}&goods=${itemsTotal.toFixed(2)}&shipping=${shippingTotal.toFixed(2)}`)
      .then((r) => !cancelled && setEstimate(r))
      .catch(() => !cancelled && setEstimate(null));
    return () => {
      cancelled = true;
    };
  }, [taxCountry, service, currency, itemsTotal, shippingTotal]);

  if (lines.length === 0 && !order) {
    return (
      <div className="wrap page empty">
        <h1>{t("bag.empty")}</h1>
        <Link to="/shop" className="btn">{t("common.browse")}</Link>
      </div>
    );
  }

  const tax = estimate ? Number(estimate.tax) : 0;
  const dutyTotal = estimate?.duties ? Number(estimate.duties.total) : 0;
  const prepaid = estimate?.duties?.mode === "prepaid";
  const grandTotal = itemsTotal + shippingTotal + tax + (prepaid ? dutyTotal : 0);
  const international = !!address && address.country !== "GH";
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const canPlace = emailOk && !!address && !!service && !!provider && restricted.length === 0 && !placing && terms && (!international || duties);

  const pay = async (o: PlacedGuest) => {
    const attempt = await api<{ authorization_url: string }>("/payments/guest/initiate/", {
      method: "POST",
      body: { order_number: o.number, provider, token: o.guest_token },
      headers: { "Idempotency-Key": `pay-${o.number}-${provider}` },
    });
    window.location.href = attempt.authorization_url;
  };

  const place = async () => {
    if (!address || !service || !provider) return;
    setPlacing(true);
    setError("");
    setErrors({});
    try {
      const o =
        order ??
        (await api<PlacedGuest>("/checkout/guest/", {
          method: "POST",
          headers: { "Idempotency-Key": key.current },
          body: {
            email: email.trim(),
            items: lines.map((l) => ({ variant: l.variantId, quantity: l.quantity })),
            address: {
              recipient_name: address.recipient_name, phone: address.phone, line1: address.line1, line2: address.line2,
              city: address.city, region: address.region, postal_code: address.postal_code, country: address.country,
            },
            shipping_service: service.service_code, currency, phone: address.phone, delivery_notes: notes,
            accept_terms: terms, duties_acknowledged: duties,
          },
        }));
      setOrder(o);
      saveGuestSession({ number: o.number, token: o.guest_token });
      await pay(o);
    } catch (e) {
      if (e instanceof ApiError) {
        const f = flatErrors(e.data);
        setErrors(f);
        setError(f.items || f.address || f.shipping_service || f.currency || f.accept_terms || f.duties_acknowledged || (f.email ? "" : e.message));
      } else setError("Something went wrong. Your card was not charged. Try again.");
      setPlacing(false);
    }
  };

  return (
    <div className="wrap page">
      <h1>{t("guest.title")}</h1>
      <p className="muted">{t("guest.intro")} <Link to="/login?next=/checkout">{t("guest.signIn")}</Link></p>
      {error && <Alert>{error}</Alert>}
      <div className="bag">
        <div style={{ display: "grid", gap: "2.5rem" }}>
          <section aria-labelledby="g-contact">
            <h2 id="g-contact">{t("guest.contact")}</h2>
            <div className="form">
              <Field id="g-email" label={t("guest.email")} error={errors.email}>
                <input id="g-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!order} required />
              </Field>
            </div>
          </section>

          <section aria-labelledby="ship-to">
            <h2 id="ship-to">{t("checkout.where")}</h2>
            {address ? (
              <p>
                <strong>{address.recipient_name}</strong><br />
                {address.line1}{address.line2 && `, ${address.line2}`}, {address.city}{address.region && `, ${address.region}`} {address.postal_code}<br />
                {countryName(address.country)} · {address.phone}<br />
                {!order && <button className="link-button" onClick={() => setAddress(null)}>{t("guest.changeAddress")}</button>}
              </p>
            ) : (
              <AddressForm local onSaved={(a) => setAddress(a)} />
            )}
          </section>

          {address && (
            <section aria-labelledby="delivery">
              <h2 id="delivery">{t("checkout.delivery")}</h2>
              {services === null && <Loading what="Finding delivery options" />}
              {restricted.length > 0 && (
                <Alert>We can't ship {restricted.join(", ")} to {countryName(address.country)}. Remove {restricted.length > 1 ? "them" : "it"} from your bag or choose another address.</Alert>
              )}
              {services && services.length > 0 && (
                <div className="choice-list" role="radiogroup" aria-labelledby="delivery">
                  {services.map((s) => (
                    <label className="choice" key={s.service_code}>
                      <input type="radio" name="service" checked={s.service_code === serviceCode} onChange={() => setServiceCode(s.service_code)} disabled={!!order} />
                      <span>
                        <strong>{s.service_name}</strong> · {money(s.price, s.currency)}<br />
                        <span className="muted small">{s.eta_days_min && s.eta_days_max ? t("checkout.arrives", { min: s.eta_days_min, max: s.eta_days_max }) : t("checkout.etaLater")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {services && services.length === 0 && restricted.length === 0 && <Alert kind="info">{t("checkout.noDelivery")}</Alert>}
            </section>
          )}

          <section aria-labelledby="pay">
            <h2 id="pay">{t("checkout.payment")}</h2>
            {shown !== currency && <Alert kind="info">{t("checkout.viewing", { shown, currency })}</Alert>}
            {methods.length === 0 ? (
              <Alert kind="info">{t("checkout.noMethod", { currency })}</Alert>
            ) : (
              <div className="choice-list" role="radiogroup" aria-labelledby="pay">
                {methods.map((m) => (
                  <label className="choice" key={m.provider}>
                    <input type="radio" name="provider" checked={m.provider === provider} onChange={() => setProvider(m.provider)} />
                    <span><strong>{providerName(m.provider, currency, t)}</strong><br /><span className="muted small">{m.manual ? t("checkout.manualHint") : t("checkout.finishSecure")}</span></span>
                  </label>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="summary" aria-label="Order summary">
          <h2 style={{ fontSize: "1.2rem" }}>{t("checkout.summary")}</h2>
          {lines.map((l) => (
            <div key={l.key} className="small" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "0.4rem" }}>
              <span>{l.quantity} × {l.name}</span>
              <span>{exact((toNumber(l.unitPrice, l.currency) * l.quantity).toFixed(2), currency)}</span>
            </div>
          ))}
          <dl style={{ marginTop: "1rem" }}>
            <dt>{t("checkout.items")}</dt><dd>{exact(itemsTotal.toFixed(2), currency)}</dd>
            <dt>{t("checkout.delivery")}</dt><dd>{service ? exact(shippingTotal.toFixed(2), currency) : "—"}</dd>
            {tax > 0 && <><dt>{t("checkout.tax")}</dt><dd>{exact(tax.toFixed(2), currency)}</dd></>}
            {prepaid && dutyTotal > 0 && <><dt>{t("checkout.dutiesTitle")}</dt><dd>{exact(dutyTotal.toFixed(2), currency)}</dd></>}
            <dt className="total">{t("checkout.total")}</dt><dd className="total">{service ? exact(grandTotal.toFixed(2), currency) : "—"}</dd>
          </dl>
          <div className="form" style={{ marginTop: "1rem" }}>
            <Field id="notes" label={t("checkout.notes")}>
              <input id="notes" className="input" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("checkout.notesPlaceholder")} />
            </Field>
            {international && (
              <label className="small">
                <input type="checkbox" checked={duties} onChange={(e) => setDuties(e.target.checked)} /> {t("checkout.dutiesAccept")}
              </label>
            )}
            <label className="small">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> {t("checkout.termsAccept")}
            </label>
          </div>
          <button className="btn block" disabled={!canPlace} onClick={place}>{placing ? t("checkout.taking") : t("checkout.pay")}</button>
          <p className="small muted" style={{ marginTop: "0.75rem" }}>{t("checkout.finalNoteShort")}</p>
          <button className="link-button" onClick={() => navigate("/bag")}>{t("checkout.backToBag")}</button>
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- guest order page */

export function GuestOrder() {
  const { number = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { exact } = useCurrency();
  const { data: order, error, loading } = useAsync(() => api<Order>(`/orders/guest/${number}/?token=${encodeURIComponent(token)}`), [number, token]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (order) saveGuestSession({ number: order.number, token });
    if (order?.status === "pending_payment") {
      api<PaymentMethod[]>(`/payments/methods/?currency=${order.currency}`).then(setMethods).catch(() => setMethods([]));
    }
  }, [order, token]);

  if (loading) return <div className="wrap page"><Loading what="Loading order" /></div>;
  if (error || !order) {
    return (
      <div className="wrap page narrow">
        <h1>This order link isn't valid</h1>
        <p>It may have expired. Enter your order number and email and we'll send a new one.</p>
        <FindOrder />
      </div>
    );
  }

  const payNow = async (provider: string) => {
    setBusy(true);
    setActionError("");
    try {
      const attempt = await api<{ authorization_url: string }>("/payments/guest/initiate/", {
        method: "POST",
        body: { order_number: order.number, provider, token },
        headers: { "Idempotency-Key": `pay-${order.number}-${provider}-${Date.now()}` },
      });
      window.location.href = attempt.authorization_url;
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't start payment.");
      setBusy(false);
    }
  };

  const a = order.shipping_address;
  return (
    <div className="wrap page">
      <h1 style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>Order {order.number} <StatusPill status={order.status} /></h1>
      {actionError && <Alert>{actionError}</Alert>}
      {order.status === "pending_payment" && (
        <Alert kind="info">
          <strong>This order is waiting for payment.</strong> Your items are held for a short time.
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            {methods.map((m) => (
              <button key={m.provider} className="btn" disabled={busy} onClick={() => payNow(m.provider)}>Pay with {providerName(m.provider, order.currency)}</button>
            ))}
          </div>
        </Alert>
      )}
      <div className="two">
        <section aria-labelledby="items">
          <h2 id="items">What you ordered</h2>
          <table className="table">
            <tbody>
              {order.items.map((i) => (
                <tr key={i.sku}>
                  <td>{i.quantity} × {i.product_name}{i.variant_name && <span className="muted"> ({i.variant_name})</span>}</td>
                  <td style={{ textAlign: "right" }}>{exact(i.line_total, order.currency)}</td>
                </tr>
              ))}
              <tr><td className="muted">Delivery ({order.shipping_service.service_name ?? "standard"})</td><td style={{ textAlign: "right" }}>{exact(order.shipping_total, order.currency)}</td></tr>
              {Number(order.tax_total) > 0 && <tr><td className="muted">Tax</td><td style={{ textAlign: "right" }}>{exact(order.tax_total, order.currency)}</td></tr>}
              <tr><th scope="row">Total</th><td style={{ textAlign: "right", fontWeight: 700 }}>{exact(order.grand_total, order.currency)}</td></tr>
            </tbody>
          </table>
          <h3>Delivering to</h3>
          <p>{a.recipient_name}<br />{a.line1}{a.line2 && `, ${a.line2}`}<br />{a.city}{a.region && `, ${a.region}`} {a.postal_code}<br />{countryName(a.country ?? "")}</p>
        </section>
        <section aria-labelledby="progress">
          <h2 id="progress">Where it is</h2>
          {order.shipments.length === 0 && <p className="muted">We'll show tracking here as soon as your order is handed to the courier.</p>}
          {order.shipments.map((s) => (
            <div key={s.id} style={{ marginBottom: "1.5rem" }}>
              <p><strong>{s.carrier_name ?? "Courier"}</strong> {s.tracking_number && <>· Tracking {s.tracking_number}</>} <StatusPill status={s.status} /></p>
              <ol className="timeline">
                {s.events.map((e) => (
                  <li key={e.id}>
                    <strong>{e.description || statusLabel(e.status)}</strong>
                    <div className="small muted">{new Date(e.occurred_at).toLocaleString()}{e.location && ` · ${e.location}`}</div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      </div>
      <p className="small" style={{ marginTop: "1.5rem" }}>Questions about this order? Reply to the email we sent you. Create an account with this email to see all your orders in one place.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- find my order */

export function FindOrder() {
  const { t } = useT();
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/orders/guest/lookup/", { method: "POST", body: { number, email } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Alert kind="info">{t("guest.findSent")}</Alert>;
  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="muted">{t("guest.findIntro")}</p>
      {error && <Alert>{error}</Alert>}
      <Field id="f-number" label={t("guest.number")}>
        <input id="f-number" className="input" value={number} onChange={(e) => setNumber(e.target.value)} required />
      </Field>
      <Field id="f-email" label={t("guest.email")}>
        <input id="f-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <button className="btn" disabled={busy || !number.trim() || !email.trim()}>{t("guest.send")}</button>
    </form>
  );
}

export function FindOrderPage() {
  const { t } = useT();
  const enabled = useGuestCheckoutEnabled();
  if (enabled === null) return <Loading />;
  if (!enabled) return <Navigate to="/orders" replace />;
  return (
    <div className="wrap page narrow">
      <h1>{t("guest.find")}</h1>
      <FindOrder />
    </div>
  );
}
