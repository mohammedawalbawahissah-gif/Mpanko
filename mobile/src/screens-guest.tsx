/** Guest checkout: buy without an account (FR-AUTH-05, FR-CHK-05). Only offered when the shop turns it on. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { api, ApiError, idempotencyKey } from "./api";
import { AddressForm } from "./address-form";
import { useAuth } from "./auth";
import { checkoutItems, isEmail, loadGuestOrder, saveGuestOrder } from "./core/guestBag";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import type { Address, Order, PaymentMethod, ShippingService, TaxEstimate } from "./types";
import { Busy, Button, Input, Notice, Pill, s, statusLabel } from "./ui";
import type { RootParams } from "./screens-buy";

type Nav = NavigationProp<RootParams>;
interface Quote { services: ShippingService[]; restricted_products: string[] }
interface Rates { base: string; rates: Record<string, string>; chargeable?: string[] }
interface Attempt { reference: string; authorization_url: string; status: string }
interface PlacedGuest extends Order { guest_token: string }

/** DRF nests errors ({address: {line1: [..]}}); flatten them to one readable map. */
export function flatErrors(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
      else if (typeof v === "string") out[k] = v;
      else if (v && typeof v === "object") Object.assign(out, flatErrors(v));
    }
  }
  return out;
}

/* ------------------------------------------------------------------- bag */

export function GuestBag() {
  const { guestLines, setGuestQuantity, removeGuestLine } = useAuth();
  const { money, t } = usePrefs();
  const nav = useNavigation<Nav>();
  const byCurrency: Record<string, number> = {};
  guestLines.forEach((l) => (byCurrency[l.currency] = (byCurrency[l.currency] ?? 0) + Number(l.unitPrice) * l.quantity));
  if (guestLines.length === 0) {
    return (
      <View style={[s.screen, s.pad]}>
        <Text style={s.h1}>Your bag is empty</Text>
        <Text style={s.muted}>Browse the shop and add something you like. You don't need an account to buy.</Text>
        <View style={{ height: 16 }} />
        <Button title={t("guest.find")} kind="quiet" onPress={() => nav.navigate("FindOrder")} />
      </View>
    );
  }
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Your bag</Text>
      {guestLines.map((l) => (
        <View key={l.variantId} style={[s.card, s.cardPad]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{l.name}{l.variantName && l.variantName !== "Default" ? ` (${l.variantName})` : ""}</Text>
          <Text style={s.muted}>{money(l.unitPrice, l.currency)} each</Text>
          <View style={[s.row, { marginTop: 8 }]}>
            <View style={[s.row, { gap: 8 }]}>
              <Button title="−" kind="quiet" onPress={() => setGuestQuantity(l.variantId, l.quantity - 1)} />
              <Text accessibilityLabel={`Quantity ${l.quantity}`} style={{ fontWeight: "700", fontSize: 16 }}>{l.quantity}</Text>
              <Button title="+" kind="quiet" onPress={() => setGuestQuantity(l.variantId, l.quantity + 1)} />
            </View>
            <Pressable accessibilityRole="button" onPress={() => removeGuestLine(l.variantId)}><Text style={{ color: color.indigo, textDecorationLine: "underline" }}>Remove</Text></Pressable>
          </View>
        </View>
      ))}
      {Object.entries(byCurrency).map(([c, total]) => <Text key={c} style={{ fontWeight: "700", fontSize: 18, color: color.ink, marginVertical: 4 }}>Items: {money(total, c)}</Text>)}
      <Text style={[s.muted, { marginBottom: 16 }]}>Delivery is added at checkout.</Text>
      <Button title={t("guest.checkout")} onPress={() => nav.navigate("GuestCheckout")} />
      <View style={{ height: 8 }} />
      <Text style={s.muted}>Have an account? Sign in from the Account tab and your bag comes with you.</Text>
      <View style={{ height: 8 }} />
      <Button title={t("guest.find")} kind="quiet" onPress={() => nav.navigate("FindOrder")} />
    </ScrollView>
  );
}

/* -------------------------------------------------------------- checkout */

export function GuestCheckoutScreen() {
  const { guestLines, clearGuestBag } = useAuth();
  const { t } = usePrefs();
  const nav = useNavigation<Nav>();
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<Address | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [service, setService] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [provider, setProvider] = useState("");
  const [rates, setRates] = useState<Rates | null>(null);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [terms, setTerms] = useState(false);
  const [duties, setDuties] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const placed = useRef<PlacedGuest | null>(null);
  const key = useRef(idempotencyKey());
  const slugs = guestLines.map((l) => `${l.slug}:${l.quantity}`).join(",");

  useEffect(() => { api<Rates>("/currency/rates/").then(setRates).catch(() => setRates(null)); }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setQuote(null);
    setService("");
    api<Quote>(`/shipping/quote/?country=${address.country}&city=${encodeURIComponent(address.city)}&postal_code=${encodeURIComponent(address.postal_code)}&products=${encodeURIComponent(slugs)}`)
      .then((r) => { if (!cancelled) { setQuote(r); if (r.services.length) setService(r.services[0].service_code); } })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load delivery options."));
    return () => { cancelled = true; };
  }, [address, slugs]);

  useEffect(() => {
    api<PaymentMethod[]>(`/payments/methods/?currency=${currency}`)
      .then((m) => { setMethods(m); setProvider((p) => (m.some((x) => x.provider === p) ? p : m[0]?.provider ?? "")); })
      .catch(() => setMethods([]));
  }, [currency]);

  // A changed choice is a different order, so it gets a fresh idempotency key.
  useEffect(() => { key.current = idempotencyKey(); placed.current = null; }, [email, address, service, currency]);

  const convert = (amount: string, from: string): number => {
    const n = Number(amount);
    if (from === currency || !rates) return n;
    const rFrom = from === rates.base ? 1 : Number(rates.rates[from]);
    const rTo = currency === rates.base ? 1 : Number(rates.rates[currency]);
    return rFrom && rTo ? (n / rFrom) * rTo : n;
  };
  const svc = quote?.services.find((x) => x.service_code === service);
  const items = guestLines.reduce((sum, l) => sum + convert(l.unitPrice, l.currency) * l.quantity, 0);
  const ship = svc ? convert(svc.price, svc.currency) : 0;
  const taxCountry = address?.country;
  useEffect(() => {
    if (!taxCountry || !svc) { setEstimate(null); return; }
    let cancelled = false;
    api<TaxEstimate>(`/tax/estimate/?country=${taxCountry}&currency=${currency}&goods=${items.toFixed(2)}&shipping=${ship.toFixed(2)}`)
      .then((r) => !cancelled && setEstimate(r))
      .catch(() => !cancelled && setEstimate(null));
    return () => { cancelled = true; };
  }, [taxCountry, svc?.service_code, currency, items, ship]); // eslint-disable-line react-hooks/exhaustive-deps
  const tax = estimate ? Number(estimate.tax) : 0;
  const dutyTotal = estimate?.duties ? Number(estimate.duties.total) : 0;
  const prepaid = estimate?.duties?.mode === "prepaid";
  const grandTotal = items + ship + tax + (prepaid ? dutyTotal : 0);
  const restricted = quote?.restricted_products ?? [];
  const international = !!address && address.country !== "GH";
  const canPay = isEmail(email) && !!address && !!svc && !!provider && restricted.length === 0 && terms && (!international || duties) && !placing;

  const pay = async () => {
    if (!address || !svc || !provider) return;
    setPlacing(true);
    setError("");
    setErrors({});
    try {
      const order = placed.current ?? (await api<PlacedGuest>("/checkout/guest/", {
        method: "POST",
        headers: { "Idempotency-Key": key.current },
        body: {
          email: email.trim(), items: checkoutItems(guestLines),
          address: { recipient_name: address.recipient_name, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, region: address.region, postal_code: address.postal_code, country: address.country },
          shipping_service: svc.service_code, currency, phone: address.phone, delivery_notes: notes, accept_terms: terms, duties_acknowledged: duties,
        },
      }));
      placed.current = order;
      await saveGuestOrder(AsyncStorage, { number: order.number, token: order.guest_token });
      const attempt = await api<Attempt>("/payments/guest/initiate/", {
        method: "POST",
        body: { order_number: order.number, provider, token: order.guest_token },
        headers: { "Idempotency-Key": `pay-${order.number}-${provider}` },
      });
      await clearGuestBag();
      nav.navigate("GuestOrder", { number: order.number, token: order.guest_token, reference: attempt.reference } as RootParams["GuestOrder"]);
      await WebBrowser.openBrowserAsync(attempt.authorization_url);
    } catch (e) {
      if (e instanceof ApiError) {
        const f = flatErrors(e.data);
        setErrors(f);
        setError(f.items || f.address || f.shipping_service || f.currency || f.accept_terms || f.duties_acknowledged || (f.email ? "" : e.message));
      } else setError("Something went wrong. You haven't been charged. Try again.");
    } finally {
      setPlacing(false);
    }
  };

  if (guestLines.length === 0 && !placed.current) return <View style={[s.screen, s.pad]}><Text style={s.h1}>Your bag is empty</Text></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{t("guest.title")}</Text>
      {!!error && <Notice>{error}</Notice>}
      <Input label={t("guest.email")} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Text style={s.h2}>Send it to</Text>
      {address ? (
        <View style={[s.choice, s.choiceOn]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{address.recipient_name}</Text>
          <Text style={{ color: color.ink }}>{address.line1}{address.line2 ? `, ${address.line2}` : ""}, {address.city} {address.postal_code}, {address.country}</Text>
          <Text style={s.muted}>{address.phone}</Text>
          <Pressable accessibilityRole="button" onPress={() => setAddress(null)}><Text style={{ color: color.indigo, textDecorationLine: "underline", marginTop: 6 }}>{t("guest.changeAddress")}</Text></Pressable>
        </View>
      ) : <AddressForm local onSaved={setAddress} />}

      {address && (
        <>
          <Text style={s.h2}>Delivery</Text>
          {!quote && <Busy what="Finding delivery options" />}
          {restricted.length > 0 && <Notice>We can't ship {restricted.join(", ")} to {address.country}. Remove it from your bag or pick another address.</Notice>}
          {quote?.services.map((x) => (
            <Pressable key={x.service_code} onPress={() => setService(x.service_code)} accessibilityRole="radio" accessibilityState={{ selected: x.service_code === service }} style={[s.choice, x.service_code === service && s.choiceOn]}>
              <Text style={{ fontWeight: "700", color: color.ink }}>{x.service_name} · {x.currency} {x.price}</Text>
              <Text style={s.muted}>{x.eta_days_min && x.eta_days_max ? `Arrives in ${x.eta_days_min} to ${x.eta_days_max} days` : "Delivery time confirmed after dispatch"}</Text>
            </Pressable>
          ))}
          {quote && quote.services.length === 0 && restricted.length === 0 && <Notice kind="info">We don't deliver to this country yet.</Notice>}
        </>
      )}

      <Text style={s.h2}>Pay in</Text>
      <View style={[s.row, { justifyContent: "flex-start" }]}>
        {(rates?.chargeable?.length ? rates.chargeable : ["USD", "GHS"]).map((c) => <Button key={c} title={c} kind={currency === c ? "primary" : "quiet"} onPress={() => setCurrency(c)} />)}
      </View>
      <Text style={s.h2}>Payment method</Text>
      {methods.length === 0 && <Notice kind="info">No payment method is available in {currency}. Pick another currency.</Notice>}
      {methods.map((m) => (
        <Pressable key={m.provider} onPress={() => setProvider(m.provider)} accessibilityRole="radio" accessibilityState={{ selected: m.provider === provider }} style={[s.choice, m.provider === provider && s.choiceOn]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{m.provider === "paystack" ? (currency === "GHS" ? "Mobile Money or card" : "Card") : m.provider === "mock" ? "Test payment (development only)" : m.provider}</Text>
          <Text style={s.muted}>You'll finish on a secure page, then come back.</Text>
        </Pressable>
      ))}

      <View style={[s.card, s.cardPad, { marginTop: 16 }]}>
        <View style={s.row}><Text>Items</Text><Text>{currency} {items.toFixed(2)}</Text></View>
        <View style={s.row}><Text>Delivery</Text><Text>{svc ? `${currency} ${ship.toFixed(2)}` : "—"}</Text></View>
        {tax > 0 && <View style={s.row}><Text>Tax</Text><Text>{currency} {tax.toFixed(2)}</Text></View>}
        {prepaid && dutyTotal > 0 && <View style={s.row}><Text>Import duties and taxes</Text><Text>{currency} {dutyTotal.toFixed(2)}</Text></View>}
        <View style={s.row}><Text style={{ fontWeight: "800" }}>Total</Text><Text style={{ fontWeight: "800" }}>{svc ? `${currency} ${grandTotal.toFixed(2)}` : "—"}</Text></View>
        <Text style={[s.muted, { marginTop: 8, fontSize: 12 }]}>The exact total is calculated on our server when you pay. You're charged the total we confirm.</Text>
      </View>
      <Input label="Delivery notes (optional)" value={notes} onChangeText={setNotes} maxLength={300} />
      {international && (
        <View style={[s.row, { marginBottom: 8 }]}>
          <Text style={{ flex: 1, color: color.ink }}>I understand I may have to pay import duties and taxes in my country.</Text>
          <Switch value={duties} onValueChange={setDuties} accessibilityLabel="Accept import duties and taxes" />
        </View>
      )}
      <View style={[s.row, { marginBottom: 12 }]}>
        <Text style={{ flex: 1, color: color.ink }}>I accept the terms of sale and the returns policy.</Text>
        <Switch value={terms} onValueChange={setTerms} accessibilityLabel="Accept terms of sale" />
      </View>
      <Button title={placing ? "Taking you to payment…" : "Pay now"} disabled={!canPay} onPress={pay} />
    </ScrollView>
  );
}

/* ----------------------------------------------------------- guest order */

export function GuestOrderScreen({ route }: { route: { params: { number: string; token?: string; reference?: string } } }) {
  const { number } = route.params;
  const [token, setToken] = useState(route.params.token ?? "");
  const [reference, setReference] = useState(route.params.reference ?? "");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // A link opened from an email carries the token; otherwise use the one saved when the order was placed.
  useEffect(() => {
    if (token) { saveGuestOrder(AsyncStorage, { number, token }); return; }
    loadGuestOrder(AsyncStorage).then((l) => { if (l && l.number === number) setToken(l.token); else setLoading(false); });
  }, [number, token]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setOrder(await api<Order>(`/orders/guest/${number}/?token=${encodeURIComponent(token)}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't load that order. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [number, token]);

  // Back from the payment page: ask the gateway, then reload (the webhook may not have arrived yet).
  useFocusEffect(useCallback(() => {
    (async () => {
      if (reference && token) {
        try { await api(`/payments/guest/verify/${reference}/?token=${encodeURIComponent(token)}`); } catch { /* the webhook will settle it */ }
      }
      await load();
    })();
  }, [reference, token, load]));

  useEffect(() => {
    if (!order || order.status !== "pending_payment") return;
    api<PaymentMethod[]>(`/payments/methods/?currency=${order.currency}`).then(setMethods).catch(() => setMethods([]));
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [order?.status, order?.currency, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !order) return <Busy />;
  if (!order) return <View style={s.pad}><Notice>{error || "This order link is not valid. Use Find my order to get a new one."}</Notice></View>;

  const payNow = async (provider: string) => {
    setBusy(true);
    setMsg("");
    try {
      const a = await api<Attempt>("/payments/guest/initiate/", { method: "POST", body: { order_number: order.number, provider, token }, headers: { "Idempotency-Key": `pay-${order.number}-${provider}-${Date.now()}` } });
      setReference(a.reference);
      await WebBrowser.openBrowserAsync(a.authorization_url);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't start payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Order {order.number}</Text>
      <Pill value={order.status} />
      {!!msg && <View style={{ marginTop: 12 }}><Notice>{msg}</Notice></View>}
      {order.status === "pending_payment" && (
        <View style={{ marginTop: 12 }}>
          <Notice kind="info">Waiting for payment. Your items are held for a short time.</Notice>
          {methods.map((m) => <View key={m.provider} style={{ marginBottom: 8 }}><Button title={busy ? "Opening…" : `Pay with ${m.provider === "paystack" ? (order.currency === "GHS" ? "Mobile Money or card" : "card") : m.provider}`} disabled={busy} onPress={() => payNow(m.provider)} /></View>)}
        </View>
      )}
      <Text style={s.h2}>What you ordered</Text>
      {order.items.map((i) => (
        <View key={i.sku} style={[s.row, { marginBottom: 6 }]}><Text style={{ flex: 1 }}>{i.quantity} × {i.product_name}{i.variant_name ? ` (${i.variant_name})` : ""}</Text><Text>{order.currency} {i.line_total}</Text></View>
      ))}
      <View style={s.row}><Text style={s.muted}>Delivery</Text><Text>{order.currency} {order.shipping_total}</Text></View>
      <View style={s.row}><Text style={{ fontWeight: "800" }}>Total</Text><Text style={{ fontWeight: "800" }}>{order.currency} {order.grand_total}</Text></View>
      <Text style={s.h2}>Where it is</Text>
      {order.shipments.length === 0 && <Text style={s.muted}>Tracking appears here once your order is handed to the courier. We also email you.</Text>}
      {order.shipments.map((sh) => (
        <View key={sh.id} style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{sh.carrier_name ?? "Courier"} {sh.tracking_number ? `· ${sh.tracking_number}` : ""}</Text>
          {[...sh.events].reverse().map((e) => (
            <View key={e.id} style={{ borderLeftWidth: 2, borderLeftColor: color.line, paddingLeft: 12, paddingVertical: 6 }}>
              <Text style={{ fontWeight: "600", color: color.ink }}>{e.description || statusLabel(e.status)}</Text>
              <Text style={s.muted}>{new Date(e.occurred_at).toLocaleString()}{e.location ? ` · ${e.location}` : ""}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/* ------------------------------------------------------------ find order */

export function FindOrderScreen() {
  const { t } = usePrefs();
  const nav = useNavigation<Nav>();
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ number: string; token: string } | null>(null);
  useEffect(() => { loadGuestOrder(AsyncStorage).then(setSaved); }, []);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/orders/guest/lookup/", { method: "POST", body: { number: number.trim(), email: email.trim() } });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{t("guest.find")}</Text>
      {saved && <View style={{ marginBottom: 16 }}><Button title={`Open my last order, ${saved.number}`} onPress={() => nav.navigate("GuestOrder", { number: saved.number, token: saved.token })} /></View>}
      {done ? <Notice kind="info">{t("guest.findSent")}</Notice> : (
        <>
          <Text style={[s.muted, { marginBottom: 12 }]}>{t("guest.findIntro")}</Text>
          {!!error && <Notice>{error}</Notice>}
          <Input label={t("guest.number")} value={number} onChangeText={setNumber} autoCapitalize="characters" />
          <Input label={t("guest.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Button title={busy ? "Sending…" : t("guest.send")} disabled={busy || !number.trim() || !isEmail(email)} onPress={send} />
        </>
      )}
    </ScrollView>
  );
}
