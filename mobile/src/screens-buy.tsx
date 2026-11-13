import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation, useFocusEffect, type NavigationProp } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { api, ApiError, idempotencyKey, type Page } from "./api";
import { useAuth } from "./auth";
import { color } from "./theme";
import type { Address, Order, OrderSummary, PaymentMethod, ShippingService } from "./types";
import { Busy, Button, Input, Notice, Pill, s, statusLabel, useAsync } from "./ui";

export type RootParams = { Tabs: undefined; Checkout: undefined; OrderDetail: { number: string } };
type Nav = NavigationProp<RootParams>;

/* ------------------------------------------------------------------- bag */

export function BagScreen() {
  const { user, cart, setQuantity, removeItem, refreshCart } = useAuth();
  const nav = useNavigation<Nav>();
  const [err, setErr] = useState("");
  useFocusEffect(useCallback(() => { if (user) refreshCart(); }, [user, refreshCart]));

  if (!user) return <View style={[s.screen, s.pad]}><Text style={s.h1}>Your bag</Text><Text style={s.muted}>Sign in from the Account tab to see and fill your bag.</Text></View>;
  if (cart.length === 0) return <View style={[s.screen, s.pad]}><Text style={s.h1}>Your bag is empty</Text><Text style={s.muted}>Browse the shop and add something you like.</Text></View>;

  const guard = async (fn: () => Promise<void>) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    }
  };
  const byCurrency: Record<string, number> = {};
  cart.forEach((i) => (byCurrency[i.currency] = (byCurrency[i.currency] ?? 0) + Number(i.unit_price) * i.quantity));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Your bag</Text>
      {!!err && <Notice>{err}</Notice>}
      {cart.map((i) => (
        <View key={i.id} style={[s.card, s.cardPad]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{i.product_name}</Text>
          <Text style={s.muted}>{i.currency} {i.unit_price} each</Text>
          <View style={[s.row, { marginTop: 8 }]}>
            <View style={[s.row, { gap: 8 }]}>
              <Button title="−" kind="quiet" onPress={() => guard(() => (i.quantity > 1 ? setQuantity(i.id, i.quantity - 1) : removeItem(i.id)))} />
              <Text accessibilityLabel={`Quantity ${i.quantity}`} style={{ fontWeight: "700", fontSize: 16 }}>{i.quantity}</Text>
              <Button title="+" kind="quiet" onPress={() => guard(() => setQuantity(i.id, i.quantity + 1))} />
            </View>
            <Pressable accessibilityRole="button" onPress={() => guard(() => removeItem(i.id))}><Text style={{ color: color.indigo, textDecorationLine: "underline" }}>Remove</Text></Pressable>
          </View>
        </View>
      ))}
      {Object.entries(byCurrency).map(([c, t]) => <Text key={c} style={{ fontWeight: "700", fontSize: 18, color: color.ink, marginVertical: 4 }}>Items: {c} {t.toFixed(2)}</Text>)}
      <Text style={[s.muted, { marginBottom: 16 }]}>Delivery is added at checkout.</Text>
      <Button title="Check out" onPress={() => nav.navigate("Checkout")} />
    </ScrollView>
  );
}

/* -------------------------------------------------------------- checkout */

interface Quote { services: ShippingService[]; restricted_products: string[] }
interface Rates { base: string; rates: Record<string, string> }
interface Attempt { reference: string; authorization_url: string; status: string }

export function CheckoutScreen() {
  const { cart, refreshCart } = useAuth();
  const nav = useNavigation<Nav>();
  const addrs = useAsync(() => api<Page<Address>>("/auth/addresses/"), []);
  const list = addrs.data?.results ?? [];
  const [addressId, setAddressId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [service, setService] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [provider, setProvider] = useState("");
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const orderRef = useRef<Order | null>(null);
  const keyRef = useRef(idempotencyKey());

  useEffect(() => {
    if (addressId === null && list.length) setAddressId((list.find((a) => a.is_default) ?? list[0]).id);
  }, [list, addressId]);
  const address = list.find((a) => a.id === addressId);
  const slugs = cart.map((i) => i.product_slug).join(",");

  useEffect(() => {
    api<Rates>("/currency/rates/").then(setRates).catch(() => setRates(null));
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setQuote(null);
    setService("");
    api<{ services: ShippingService[]; restricted_products: string[] }>(`/shipping/quote/?country=${address.country}&products=${encodeURIComponent(slugs)}`)
      .then((r) => {
        if (cancelled) return;
        setQuote(r);
        if (r.services.length) setService(r.services[0].service_code);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load delivery options."));
    return () => { cancelled = true; };
  }, [address, slugs]);

  useEffect(() => {
    api<PaymentMethod[]>(`/payments/methods/?currency=${currency}`)
      .then((m) => { setMethods(m); setProvider((p) => (m.some((x) => x.provider === p) ? p : m[0]?.provider ?? "")); })
      .catch(() => setMethods([]));
  }, [currency]);

  useEffect(() => { keyRef.current = idempotencyKey(); orderRef.current = null; }, [addressId, service, currency]);

  const convert = (amount: string, from: string): number => {
    const n = Number(amount);
    if (from === currency || !rates) return n;
    const rFrom = from === rates.base ? 1 : Number(rates.rates[from]);
    const rTo = currency === rates.base ? 1 : Number(rates.rates[currency]);
    return rFrom && rTo ? (n / rFrom) * rTo : n;
  };

  const svc = quote?.services.find((x) => x.service_code === service);
  const items = cart.reduce((sum, i) => sum + convert(i.unit_price, i.currency) * i.quantity, 0);
  const ship = svc ? convert(svc.price, svc.currency) : 0;
  const restricted = quote?.restricted_products ?? [];

  const pay = async () => {
    if (!address || !svc || !provider) return;
    setPlacing(true);
    setError("");
    try {
      const order = orderRef.current ?? (await api<Order>("/checkout/", {
        method: "POST",
        body: { address_id: address.id, shipping_service: svc.service_code, currency },
        headers: { "Idempotency-Key": keyRef.current },
      }));
      orderRef.current = order;
      const attempt = await api<Attempt>("/payments/initiate/", {
        method: "POST",
        body: { order_number: order.number, provider },
        headers: { "Idempotency-Key": `pay-${order.number}-${provider}` },
      });
      await refreshCart();
      nav.navigate("OrderDetail", { number: order.number });
      await WebBrowser.openBrowserAsync(attempt.authorization_url);
    } catch (e) {
      if (e instanceof ApiError) {
        const f = e.fields();
        setError(f.cart || f.address || f.shipping_service || f.currency || e.message);
      } else setError("Something went wrong. You haven't been charged. Try again.");
    } finally {
      setPlacing(false);
    }
  };

  if (cart.length === 0 && !orderRef.current) return <View style={[s.screen, s.pad]}><Text style={s.h1}>Your bag is empty</Text></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {!!error && <Notice>{error}</Notice>}
      <Text style={s.h2}>Send it to</Text>
      {addrs.loading && <Busy />}
      {!adding && list.map((a) => (
        <Pressable key={a.id} onPress={() => setAddressId(a.id)} accessibilityRole="radio" accessibilityState={{ selected: a.id === addressId }} style={[s.choice, a.id === addressId && s.choiceOn]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{a.recipient_name}</Text>
          <Text style={{ color: color.ink }}>{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city} {a.postal_code}, {a.country}</Text>
          <Text style={s.muted}>{a.phone}</Text>
        </Pressable>
      ))}
      {adding || (!addrs.loading && list.length === 0)
        ? <AddressForm onSaved={(a) => { addrs.reload(); setAddressId(a.id); setAdding(false); }} onCancel={list.length ? () => setAdding(false) : undefined} />
        : <Button title="Use a different address" kind="quiet" onPress={() => setAdding(true)} />}

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
        {["USD", "GHS"].map((c) => <Button key={c} title={c} kind={currency === c ? "primary" : "quiet"} onPress={() => setCurrency(c)} />)}
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
        <View style={s.row}><Text style={{ fontWeight: "800" }}>Total</Text><Text style={{ fontWeight: "800" }}>{svc ? `${currency} ${(items + ship).toFixed(2)}` : "—"}</Text></View>
        <Text style={[s.muted, { marginTop: 8, fontSize: 12 }]}>The exact total is calculated on our server when you pay, at today's exchange rate. You're charged the total we confirm.</Text>
      </View>
      <Button title={placing ? "Taking you to payment…" : "Pay now"} disabled={placing || !address || !svc || !provider || restricted.length > 0} onPress={pay} />
    </ScrollView>
  );
}

const BLANK = { recipient_name: "", phone: "", country: "GH", line1: "", line2: "", city: "", region: "", postal_code: "" };

function AddressForm({ onSaved, onCancel }: { onSaved: (a: Address) => void; onCancel?: () => void }) {
  const [f, setF] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof BLANK) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      onSaved(await api<Address>("/auth/addresses/", { method: "POST", body: { ...f, country: f.country.toUpperCase() } }));
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields());
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Input label="Full name" value={f.recipient_name} onChangeText={set("recipient_name")} error={errors.recipient_name} autoComplete="name" />
      <Input label="Phone number for the courier" value={f.phone} onChangeText={set("phone")} error={errors.phone} keyboardType="phone-pad" />
      <Input label="Country (2-letter code, e.g. GH, US, GB)" value={f.country} onChangeText={set("country")} error={errors.country} autoCapitalize="characters" maxLength={2} />
      <Input label="Street address" value={f.line1} onChangeText={set("line1")} error={errors.line1} />
      <Input label="Apartment or landmark (optional)" value={f.line2} onChangeText={set("line2")} error={errors.line2} />
      <Input label="Town or city" value={f.city} onChangeText={set("city")} error={errors.city} />
      <Input label="Region or state" value={f.region} onChangeText={set("region")} error={errors.region} />
      <Input label="Postal code" value={f.postal_code} onChangeText={set("postal_code")} error={errors.postal_code} />
      <Button title={busy ? "Saving…" : "Save address"} disabled={busy} onPress={save} />
      {onCancel && <View style={{ height: 8 }} />}
      {onCancel && <Button title="Cancel" kind="quiet" onPress={onCancel} />}
    </View>
  );
}

/* ---------------------------------------------------------------- orders */

export function OrdersScreen() {
  const { user } = useAuth();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useAsync(() => (user ? api<Page<OrderSummary>>("/orders/") : Promise.resolve(null)), [user?.id]);
  useFocusEffect(useCallback(() => { if (user) reload(); }, [user, reload]));
  if (!user) return <View style={[s.screen, s.pad]}><Text style={s.h1}>Your orders</Text><Text style={s.muted}>Sign in from the Account tab to see your orders.</Text></View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Your orders</Text>
      {loading && <Busy />}
      {!!error && <Notice>{error}</Notice>}
      {data?.results.length === 0 && <Text style={s.muted}>You haven't placed an order yet.</Text>}
      {data?.results.map((o) => (
        <Pressable key={o.number} style={[s.card, s.cardPad]} accessibilityRole="button" onPress={() => nav.navigate("OrderDetail", { number: o.number })}>
          <View style={s.row}><Text style={{ fontWeight: "700", color: color.ink }}>{o.number}</Text><Pill value={o.status} /></View>
          <Text style={s.muted}>{new Date(o.created_at).toLocaleDateString()} · {o.item_count} item{o.item_count === 1 ? "" : "s"} · {o.currency} {o.grand_total}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function OrderDetailScreen({ route }: { route: { params: { number: string } } }) {
  const { number } = route.params;
  const { data: o, error, loading, reload } = useAsync(() => api<Order>(`/orders/${number}/`), [number]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Coming back from the payment page: re-check, since the webhook may have confirmed it meanwhile.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useEffect(() => {
    if (!o || o.status !== "pending_payment") return;
    api<PaymentMethod[]>(`/payments/methods/?currency=${o.currency}`).then(setMethods).catch(() => setMethods([]));
    const t = setInterval(reload, 6000);
    return () => clearInterval(t);
  }, [o?.status, o?.currency, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !o) return <Busy />;
  if (error || !o) return <View style={s.pad}><Notice>{error || "We couldn't find that order."}</Notice></View>;

  const payNow = async (provider: string) => {
    setBusy(true);
    setMsg("");
    try {
      const a = await api<Attempt>("/payments/initiate/", { method: "POST", body: { order_number: o.number, provider }, headers: { "Idempotency-Key": `pay-${o.number}-${provider}-${Date.now()}` } });
      await WebBrowser.openBrowserAsync(a.authorization_url);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't start payment.");
    } finally {
      setBusy(false);
    }
  };
  const cancel = () =>
    Alert.alert("Cancel this order?", "Your items will go back on sale.", [
      { text: "Keep order", style: "cancel" },
      { text: "Cancel order", style: "destructive", onPress: async () => {
        try { await api(`/orders/${o.number}/cancel/`, { method: "POST", body: {} }); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't cancel."); }
      } },
    ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Order {o.number}</Text>
      <Pill value={o.status} />
      {!!msg && <View style={{ marginTop: 12 }}><Notice>{msg}</Notice></View>}
      {o.status === "pending_payment" && (
        <View style={{ marginTop: 12 }}>
          <Notice kind="info">Waiting for payment. Your items are held for a short time.</Notice>
          {methods.map((m) => <View key={m.provider} style={{ marginBottom: 8 }}><Button title={busy ? "Opening…" : `Pay with ${m.provider === "paystack" ? (o.currency === "GHS" ? "Mobile Money or card" : "card") : m.provider}`} disabled={busy} onPress={() => payNow(m.provider)} /></View>)}
          <Button title="Cancel order" kind="quiet" onPress={cancel} />
        </View>
      )}
      <Text style={s.h2}>What you ordered</Text>
      {o.items.map((i) => (
        <View key={i.sku} style={[s.row, { marginBottom: 6 }]}><Text style={{ flex: 1 }}>{i.quantity} × {i.product_name}{i.variant_name ? ` (${i.variant_name})` : ""}</Text><Text>{o.currency} {i.line_total}</Text></View>
      ))}
      <View style={s.row}><Text style={s.muted}>Delivery</Text><Text>{o.currency} {o.shipping_total}</Text></View>
      <View style={s.row}><Text style={{ fontWeight: "800" }}>Total</Text><Text style={{ fontWeight: "800" }}>{o.currency} {o.grand_total}</Text></View>

      <Text style={s.h2}>Where it is</Text>
      {o.shipments.length === 0 && <Text style={s.muted}>Tracking appears here once your order is handed to the courier.</Text>}
      {o.shipments.map((sh) => (
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
