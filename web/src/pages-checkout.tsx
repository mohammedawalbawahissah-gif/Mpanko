import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, idempotencyKey, type Page } from "./api";
import { AddressForm } from "./address";
import { Alert, Loading, StatusPill, statusLabel, useAsync } from "./components";
import { useCart, useCurrency } from "./context";
import { countryName } from "./pages-shop";
import type { Address, Order, OrderSummary, PaymentMethod, ShippingService } from "./types";

interface Attempt {
  reference: string;
  authorization_url: string;
  status: string;
}

/* --------------------------------------------------------------- checkout */

export function Checkout() {
  const { lines } = useCart();
  const { currency, toNumber, exact, money } = useCurrency();
  const navigate = useNavigate();
  const addresses = useAsync(() => api<Page<Address>>("/auth/addresses/"), []);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [services, setServices] = useState<ShippingService[] | null>(null);
  const [restricted, setRestricted] = useState<string[]>([]);
  const [serviceCode, setServiceCode] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [provider, setProvider] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const key = useRef(idempotencyKey());

  const list = addresses.data?.results ?? [];
  useEffect(() => {
    if (addressId === null && list.length) setAddressId((list.find((a) => a.is_default) ?? list[0]).id);
  }, [list, addressId]);

  const address = list.find((a) => a.id === addressId);
  const slugs = lines.map((l) => l.slug).filter(Boolean).join(",");

  // Shipping options depend on the destination (and on any product that cannot go there).
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setServices(null);
    setServiceCode("");
    api<{ services: ShippingService[]; restricted_products: string[] }>(`/shipping/quote/?country=${address.country}&products=${slugs}`)
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
  }, [addressId, serviceCode, currency]);

  if (lines.length === 0 && !order) {
    return (
      <div className="wrap page empty">
        <h1>Your bag is empty</h1>
        <Link to="/shop" className="btn">Browse the shop</Link>
      </div>
    );
  }

  const service = services?.find((s) => s.service_code === serviceCode);
  const itemsTotal = lines.reduce((sum, l) => sum + toNumber(l.unitPrice, l.currency) * l.quantity, 0);
  const shippingTotal = service ? toNumber(service.price, service.currency) : 0;

  const startPayment = async (o: Order) => {
    const attempt = await api<Attempt>("/payments/initiate/", {
      method: "POST",
      body: { order_number: o.number, provider },
      headers: { "Idempotency-Key": `pay-${o.number}-${provider}` },
    });
    window.location.href = attempt.authorization_url;
  };

  const place = async () => {
    if (!address || !service || !provider) return;
    setPlacing(true);
    setError("");
    try {
      const o =
        order ??
        (await api<Order>("/checkout/", {
          method: "POST",
          body: { address_id: address.id, shipping_service: service.service_code, currency },
          headers: { "Idempotency-Key": key.current },
        }));
      setOrder(o);
      await startPayment(o);
    } catch (e) {
      if (e instanceof ApiError) {
        const f = e.fields();
        setError(f.cart || f.address || f.shipping_service || f.currency || e.message);
      } else setError("Something went wrong. Your card was not charged. Try again.");
      setPlacing(false);
    }
  };

  const canPlace = !!address && !!service && !!provider && restricted.length === 0 && !placing;

  return (
    <div className="wrap page">
      <h1>Checkout</h1>
      {error && <Alert>{error}</Alert>}
      <div className="bag">
        <div style={{ display: "grid", gap: "2.5rem" }}>
          <section aria-labelledby="ship-to">
            <h2 id="ship-to">Where should we send it?</h2>
            {addresses.loading && <Loading what="Loading addresses" />}
            {list.length > 0 && !adding && (
              <div className="choice-list" role="radiogroup" aria-labelledby="ship-to">
                {list.map((a) => (
                  <label className="choice" key={a.id}>
                    <input type="radio" name="address" checked={a.id === addressId} onChange={() => setAddressId(a.id)} disabled={!!order} />
                    <span>
                      <strong>{a.recipient_name}</strong><br />
                      {a.line1}{a.line2 && `, ${a.line2}`}, {a.city}{a.region && `, ${a.region}`} {a.postal_code}<br />
                      {countryName(a.country)} · {a.phone}
                    </span>
                  </label>
                ))}
                <button className="link-button" style={{ justifySelf: "start" }} onClick={() => setAdding(true)}>Use a different address</button>
              </div>
            )}
            {(adding || (!addresses.loading && list.length === 0)) && (
              <AddressForm
                onSaved={(a) => {
                  addresses.reload();
                  setAddressId(a.id);
                  setAdding(false);
                }}
                onCancel={list.length ? () => setAdding(false) : undefined}
              />
            )}
          </section>

          {address && (
            <section aria-labelledby="delivery">
              <h2 id="delivery">Delivery</h2>
              {services === null && <Loading what="Finding delivery options" />}
              {restricted.length > 0 && (
                <Alert>
                  We can't ship {restricted.join(", ")} to {countryName(address.country)}. Remove {restricted.length > 1 ? "them" : "it"} from your bag or choose another address.
                </Alert>
              )}
              {services && services.length > 0 && (
                <div className="choice-list" role="radiogroup" aria-labelledby="delivery">
                  {services.map((s) => (
                    <label className="choice" key={s.service_code}>
                      <input type="radio" name="service" checked={s.service_code === serviceCode} onChange={() => setServiceCode(s.service_code)} disabled={!!order} />
                      <span>
                        <strong>{s.service_name}</strong> · {money(s.price, s.currency)}<br />
                        <span className="muted small">{s.eta_days_min && s.eta_days_max ? `Arrives in ${s.eta_days_min} to ${s.eta_days_max} days` : "Delivery time confirmed after dispatch"}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {services && services.length === 0 && restricted.length === 0 && <Alert kind="info">We don't deliver to this country yet.</Alert>}
            </section>
          )}

          <section aria-labelledby="pay">
            <h2 id="pay">Payment</h2>
            {methods.length === 0 ? (
              <Alert kind="info">No payment method is available in {currency}. Switch currency at the top of the page.</Alert>
            ) : (
              <div className="choice-list" role="radiogroup" aria-labelledby="pay">
                {methods.map((m) => (
                  <label className="choice" key={m.provider}>
                    <input type="radio" name="provider" checked={m.provider === provider} onChange={() => setProvider(m.provider)} />
                    <span>
                      <strong>{providerName(m.provider, currency)}</strong>
                      <br /><span className="muted small">You'll finish paying on a secure page, then come back here.</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="summary" aria-label="Order summary">
          <h2 style={{ fontSize: "1.2rem" }}>Order summary</h2>
          {lines.map((l) => (
            <div key={l.key} className="small" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "0.4rem" }}>
              <span>{l.quantity} × {l.name}</span>
              <span>{exact((toNumber(l.unitPrice, l.currency) * l.quantity).toFixed(2), currency)}</span>
            </div>
          ))}
          <dl style={{ marginTop: "1rem" }}>
            <dt>Items</dt><dd>{exact(itemsTotal.toFixed(2), currency)}</dd>
            <dt>Delivery</dt><dd>{service ? exact(shippingTotal.toFixed(2), currency) : "—"}</dd>
            <dt className="total">Total</dt><dd className="total">{service ? exact((itemsTotal + shippingTotal).toFixed(2), currency) : "—"}</dd>
          </dl>
          <button className="btn block" disabled={!canPlace} onClick={place}>
            {placing ? "Taking you to payment…" : "Pay now"}
          </button>
          <p className="small muted" style={{ marginTop: "0.75rem" }}>
            The final amount is calculated on our server when you pay, using today's exchange rate for {currency}. You're charged exactly the total we confirm.
          </p>
          <button className="link-button" onClick={() => navigate("/bag")}>Back to bag</button>
          {order && <p className="small">Order {order.number} is waiting for payment. <Link to={`/orders/${order.number}`}>View order</Link></p>}
        </aside>
      </div>
    </div>
  );
}

export function providerName(provider: string, currency: string): string {
  if (provider === "paystack") return currency === "GHS" ? "Mobile Money or card" : "Card";
  if (provider === "mock") return "Test payment (development only)";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/* ------------------------------------------------------ after the payment */

interface Verified {
  payment_status: string;
  order_number: string;
  order_status: string;
}

export function CheckoutComplete() {
  const [params] = useSearchParams();
  const reference = params.get("reference") ?? params.get("trxref") ?? "";
  const { refresh } = useCart();
  const [result, setResult] = useState<Verified | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    let tries = 0;
    const check = async () => {
      try {
        const r = await api<Verified>(`/payments/verify/${reference}/`);
        if (cancelled) return;
        setResult(r);
        if (r.payment_status === "pending" && tries++ < 6) setTimeout(check, 2500);
        else refresh().catch(() => undefined);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't confirm your payment.");
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [reference, refresh]);

  if (!reference) {
    return <div className="wrap page"><h1>Nothing to confirm</h1><Link to="/orders" className="btn">See your orders</Link></div>;
  }
  if (error) return <div className="wrap page"><Alert>{error}</Alert><Link to="/orders" className="btn">See your orders</Link></div>;
  if (!result) return <div className="wrap page"><Loading what="Confirming your payment" /></div>;

  return (
    <div className="wrap page narrow">
      {result.payment_status === "succeeded" && (
        <>
          <h1>Thank you. Your order is confirmed.</h1>
          <p>Order <strong>{result.order_number}</strong> is paid. We've emailed your confirmation and will send tracking as soon as it ships.</p>
          <Link className="btn" to={`/orders/${result.order_number}`}>View your order</Link>
        </>
      )}
      {result.payment_status === "pending" && (
        <>
          <h1>We're still confirming your payment</h1>
          <p>This can take a minute. You don't need to pay again. Check your order for the latest status.</p>
          <Link className="btn" to={`/orders/${result.order_number}`}>View your order</Link>
        </>
      )}
      {(result.payment_status === "failed" || result.payment_status === "mismatch") && (
        <>
          <h1>The payment didn't go through</h1>
          <p>You haven't been charged for this attempt. Your items are held for a short time while you try again.</p>
          <Link className="btn" to={`/orders/${result.order_number}`}>Try paying again</Link>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- orders */

export function Orders() {
  const { currency, exact } = useCurrency();
  const { data, error, loading } = useAsync(() => api<Page<OrderSummary>>("/orders/"), []);
  void currency;
  return (
    <div className="wrap page">
      <h1>Your orders</h1>
      {loading && <Loading what="Loading orders" />}
      {error && <Alert>{error}</Alert>}
      {data && data.results.length === 0 && (
        <div className="empty">
          <p className="muted">You haven't placed an order yet.</p>
          <Link className="btn" to="/shop">Start shopping</Link>
        </div>
      )}
      {data && data.results.length > 0 && (
        <table className="table">
          <thead>
            <tr><th scope="col">Order</th><th scope="col">Placed</th><th scope="col">Status</th><th scope="col">Items</th><th scope="col">Total</th></tr>
          </thead>
          <tbody>
            {data.results.map((o) => (
              <tr key={o.number}>
                <td><Link to={`/orders/${o.number}`}>{o.number}</Link></td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
                <td><StatusPill status={o.status} /></td>
                <td>{o.item_count}</td>
                <td>{exact(o.grand_total, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function OrderDetail() {
  const { number = "" } = useParams();
  const { exact } = useCurrency();
  const { data: order, error, loading, reload } = useAsync(() => api<Order>(`/orders/${number}/`), [number]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (order?.status === "pending_payment") {
      api<PaymentMethod[]>(`/payments/methods/?currency=${order.currency}`).then(setMethods).catch(() => setMethods([]));
    }
  }, [order]);

  if (loading) return <div className="wrap page"><Loading what="Loading order" /></div>;
  if (error || !order) return <div className="wrap page"><h1>We couldn't find that order</h1><Link to="/orders" className="btn">Back to your orders</Link></div>;

  const payNow = async (provider: string) => {
    setBusy(true);
    setActionError("");
    try {
      const attempt = await api<Attempt>("/payments/initiate/", {
        method: "POST",
        body: { order_number: order.number, provider },
        headers: { "Idempotency-Key": `pay-${order.number}-${provider}-${Date.now()}` },
      });
      window.location.href = attempt.authorization_url;
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't start payment.");
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setActionError("");
    try {
      await api(`/orders/${order.number}/cancel/`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't cancel this order.");
    } finally {
      setBusy(false);
    }
  };

  const a = order.shipping_address;
  return (
    <div className="wrap page">
      <p className="small"><Link to="/orders">Your orders</Link></p>
      <h1 style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>Order {order.number} <StatusPill status={order.status} /></h1>
      {actionError && <Alert>{actionError}</Alert>}
      {order.status === "pending_payment" && (
        <Alert kind="info">
          <strong>This order is waiting for payment.</strong> Your items are held for a short time.
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            {methods.map((m) => (
              <button key={m.provider} className="btn" disabled={busy} onClick={() => payNow(m.provider)}>Pay with {providerName(m.provider, order.currency)}</button>
            ))}
            <button className="btn quiet" disabled={busy} onClick={cancel}>Cancel order</button>
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
          {order.fx_rate_note && <p className="small muted">Exchange rate used: {order.fx_rate_note}</p>}
          <h3>Delivering to</h3>
          <p>
            {a.recipient_name}<br />{a.line1}{a.line2 && `, ${a.line2}`}<br />{a.city}{a.region && `, ${a.region}`} {a.postal_code}<br />{countryName(a.country ?? "")}
          </p>
        </section>

        <section aria-labelledby="progress">
          <h2 id="progress">Where it is</h2>
          {order.shipments.length === 0 && <p className="muted">We'll show tracking here as soon as your order is handed to the courier.</p>}
          {order.shipments.map((s) => (
            <div key={s.id} style={{ marginBottom: "1.5rem" }}>
              <p>
                <strong>{s.carrier_name ?? "Courier"}</strong> {s.tracking_number && <>· Tracking {s.tracking_number}</>} <StatusPill status={s.status} />
              </p>
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
          <h3>Order history</h3>
          <ol className="timeline" style={{ display: "flex", flexDirection: "column-reverse" }}>
            {[...order.events].reverse().map((e, i) => (
              <li key={i}>
                <strong>{statusLabel(e.to_status)}</strong>
                <div className="small muted">{new Date(e.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
