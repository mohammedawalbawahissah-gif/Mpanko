import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useNavigation, useFocusEffect, type NavigationProp } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { api, ApiError, idempotencyKey, type Page } from "./api";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import type { Address, Order, OrderSummary, PaymentMethod, ShippingService, TaxEstimate } from "./types";
import { OrderReturns } from "./screens-help";
import { GuestBag } from "./screens-guest";
import { AddressForm } from "./address-form";
import { Busy, Button, Input, Notice, Pill, methodLabel, s, statusText, useAsync } from "./ui";

export type RootParams = {
  Tabs: undefined; Checkout: undefined; GuestCheckout: undefined; GuestOrder: { number: string; token?: string; reference?: string }; FindOrder: undefined;
  OrderDetail: { number: string }; Return: { number: string };
  Profile: undefined; SupportList: undefined; SupportNew: { order?: string }; SupportThread: { number: string };
};
type Nav = NavigationProp<RootParams>;

/* ------------------------------------------------------------------- bag */

export function BagScreen() {
  const { user, cart, setQuantity, removeItem, refreshCart, guestEnabled } = useAuth();
  const { money, t } = usePrefs();
  const nav = useNavigation<Nav>();
  const [err, setErr] = useState("");
  useFocusEffect(useCallback(() => { if (user) refreshCart(); }, [user, refreshCart]));

  if (!user && guestEnabled) return <GuestBag />;
  if (!user) return <View style={[s.screen, s.pad]}><Text style={s.h1}>{t("bag.title")}</Text><Text style={s.muted}>{t("m.bagSignIn")}</Text></View>;
  if (cart.length === 0) return <View style={[s.screen, s.pad]}><Text style={s.h1}>{t("bag.empty")}</Text><Text style={s.muted}>{t("m.bagEmptyLine")}</Text></View>;

  const guard = async (fn: () => Promise<void>) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("m.wrong"));
    }
  };
  const byCurrency: Record<string, number> = {};
  cart.forEach((i) => (byCurrency[i.currency] = (byCurrency[i.currency] ?? 0) + Number(i.unit_price) * i.quantity));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>{t("bag.title")}</Text>
      {!!err && <Notice>{err}</Notice>}
      {cart.map((i) => (
        <View key={i.id} style={[s.card, s.cardPad]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{i.product_name}</Text>
          <Text style={s.muted}>{t("bag.each", { price: money(i.unit_price, i.currency) })}</Text>
          <View style={[s.row, { marginTop: 8 }]}>
            <View style={[s.row, { gap: 8 }]}>
              <Button title="−" kind="quiet" onPress={() => guard(() => (i.quantity > 1 ? setQuantity(i.id, i.quantity - 1) : removeItem(i.id)))} />
              <Text accessibilityLabel={t("m.quantity", { n: i.quantity })} style={{ fontWeight: "700", fontSize: 16 }}>{i.quantity}</Text>
              <Button title="+" kind="quiet" onPress={() => guard(() => setQuantity(i.id, i.quantity + 1))} />
            </View>
            <Pressable accessibilityRole="button" onPress={() => guard(() => removeItem(i.id))}><Text style={{ color: color.indigo, textDecorationLine: "underline" }}>{t("common.remove")}</Text></Pressable>
          </View>
        </View>
      ))}
      {Object.entries(byCurrency).map(([c, total]) => <Text key={c} style={{ fontWeight: "700", fontSize: 18, color: color.ink, marginVertical: 4 }}>{t("m.itemsTotal", { amount: money(total, c) })}</Text>)}
      <Text style={[s.muted, { marginBottom: 16 }]}>{t("m.deliveryAtCheckout")}</Text>
      <Button title={t("checkout.title")} onPress={() => nav.navigate("Checkout")} />
    </ScrollView>
  );
}

/* -------------------------------------------------------------- checkout */

interface Quote { services: ShippingService[]; restricted_products: string[] }
interface Rates { base: string; rates: Record<string, string>; chargeable?: string[] }
interface Attempt { reference: string; authorization_url: string; status: string }

export function CheckoutScreen() {
  const { cart, refreshCart } = useAuth();
  const { t } = usePrefs();
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
  const [terms, setTerms] = useState(false);
  const [duties, setDuties] = useState(false);
  const [notes, setNotes] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: string; free_shipping: boolean } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const orderRef = useRef<Order | null>(null);
  const keyRef = useRef(idempotencyKey());

  useEffect(() => {
    if (addressId === null && list.length) setAddressId((list.find((a) => a.is_default) ?? list[0]).id);
  }, [list, addressId]);
  const address = list.find((a) => a.id === addressId);
  const slugs = cart.map((i) => `${i.product_slug}:${i.quantity}`).join(",");

  useEffect(() => {
    api<Rates>("/currency/rates/").then(setRates).catch(() => setRates(null));
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setQuote(null);
    setService("");
    api<{ services: ShippingService[]; restricted_products: string[] }>(`/shipping/quote/?country=${address.country}&city=${encodeURIComponent(address.city)}&postal_code=${encodeURIComponent(address.postal_code)}&products=${encodeURIComponent(slugs)}`)
      .then((r) => {
        if (cancelled) return;
        setQuote(r);
        if (r.services.length) setService(r.services[0].service_code);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : t("m.loadDeliveryFail")));
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
  const ship = svc && !coupon?.free_shipping ? convert(svc.price, svc.currency) : 0;
  const discount = coupon ? Number(coupon.discount) : 0;
  const restricted = quote?.restricted_products ?? [];

  // Tax and likely import duties, from the same rules the server applies when the order is placed.
  const goodsForTax = Math.max(0, items - (coupon && !coupon.free_shipping ? discount : 0));
  const taxCountry = address?.country;
  useEffect(() => {
    if (!taxCountry || !svc) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    api<TaxEstimate>(`/tax/estimate/?country=${taxCountry}&currency=${currency}&goods=${goodsForTax.toFixed(2)}&shipping=${ship.toFixed(2)}`)
      .then((r) => !cancelled && setEstimate(r))
      .catch(() => !cancelled && setEstimate(null));
    return () => { cancelled = true; };
  }, [taxCountry, svc?.service_code, currency, goodsForTax, ship]); // eslint-disable-line react-hooks/exhaustive-deps
  const tax = estimate ? Number(estimate.tax) : 0;
  const dutyTotal = estimate?.duties ? Number(estimate.duties.total) : 0;
  const prepaid = estimate?.duties?.mode === "prepaid";
  const grandTotal = items - discount + ship + tax + (prepaid ? dutyTotal : 0);

  // A code is checked for one charge currency; check again if it changes.
  useEffect(() => {
    setCoupon(null);
  }, [currency]);

  const applyCode = async () => {
    setCodeError("");
    try {
      setCoupon(await api<{ code: string; discount: string; free_shipping: boolean }>("/coupons/check/", { method: "POST", body: { code: codeInput, currency } }));
    } catch (e) {
      setCoupon(null);
      setCodeError(e instanceof ApiError ? (e.fields().code || e.message) : t("m.codeFail"));
    }
  };

  const pay = async () => {
    if (!address || !svc || !provider) return;
    setPlacing(true);
    setError("");
    try {
      const order = orderRef.current ?? (await api<Order>("/checkout/", {
        method: "POST",
        body: { address_id: address.id, shipping_service: svc.service_code, currency, accept_terms: terms, duties_acknowledged: duties, delivery_notes: notes, ...(coupon ? { coupon_code: coupon.code } : {}) },
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
        setError(f.cart || f.coupon_code || f.address || f.shipping_service || f.currency || f.accept_terms || f.duties_acknowledged || f.phone || e.message);
      } else setError(t("m.wrongNoCharge"));
    } finally {
      setPlacing(false);
    }
  };

  if (cart.length === 0 && !orderRef.current) return <View style={[s.screen, s.pad]}><Text style={s.h1}>{t("bag.empty")}</Text></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {!!error && <Notice>{error}</Notice>}
      <Text style={s.h2}>{t("m.sendTo")}</Text>
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
        : <Button title={t("checkout.useDifferent")} kind="quiet" onPress={() => setAdding(true)} />}

      {address && (
        <>
          <Text style={s.h2}>{t("checkout.delivery")}</Text>
          {!quote && <Busy what={t("m.findingDelivery")} />}
          {restricted.length > 0 && <Notice>{t("m.cantShip", { items: restricted.join(", "), country: address.country })}</Notice>}
          {quote?.services.map((x) => (
            <Pressable key={x.service_code} onPress={() => setService(x.service_code)} accessibilityRole="radio" accessibilityState={{ selected: x.service_code === service }} style={[s.choice, x.service_code === service && s.choiceOn]}>
              <Text style={{ fontWeight: "700", color: color.ink }}>{x.service_name} · {x.currency} {x.price}</Text>
              <Text style={s.muted}>{x.eta_days_min && x.eta_days_max ? t("checkout.arrives", { min: x.eta_days_min, max: x.eta_days_max }) : t("checkout.etaLater")}</Text>
            </Pressable>
          ))}
          {quote && quote.services.length === 0 && restricted.length === 0 && <Notice kind="info">{t("checkout.noDelivery")}</Notice>}
        </>
      )}

      <Text style={s.h2}>{t("m.payIn")}</Text>
      <View style={[s.row, { justifyContent: "flex-start" }]}>
        {(rates?.chargeable?.length ? rates.chargeable : ["USD", "GHS"]).map((c) => <Button key={c} title={c} kind={currency === c ? "primary" : "quiet"} onPress={() => setCurrency(c)} />)}
      </View>
      <Text style={s.h2}>{t("m.paymentMethod")}</Text>
      {methods.length === 0 && <Notice kind="info">{t("checkout.noMethod", { currency })}</Notice>}
      {methods.map((m) => (
        <Pressable key={m.provider} onPress={() => setProvider(m.provider)} accessibilityRole="radio" accessibilityState={{ selected: m.provider === provider }} style={[s.choice, m.provider === provider && s.choiceOn]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{methodLabel(t, m.provider, currency)}</Text>
          <Text style={s.muted}>{m.manual ? t("checkout.manualHint") : t("checkout.finishSecure")}</Text>
        </Pressable>
      ))}

      <View style={[s.card, s.cardPad, { marginTop: 16 }]}>
        <View style={s.row}><Text>{t("checkout.items")}</Text><Text>{currency} {items.toFixed(2)}</Text></View>
        {coupon && !coupon.free_shipping && <View style={s.row}><Text>{t("checkout.code", { code: coupon.code })}</Text><Text>−{currency} {discount.toFixed(2)}</Text></View>}
        <View style={s.row}><Text>{t("checkout.delivery")}</Text><Text>{svc ? (coupon?.free_shipping ? t("checkout.free", { code: coupon.code }) : `${currency} ${ship.toFixed(2)}`) : "—"}</Text></View>
        {tax > 0 && <View style={s.row}><Text>{t("checkout.tax")}</Text><Text>{currency} {tax.toFixed(2)}</Text></View>}
        {prepaid && dutyTotal > 0 && <View style={s.row}><Text>{t("checkout.dutiesTitle")}</Text><Text>{currency} {dutyTotal.toFixed(2)}</Text></View>}
        <View style={s.row}><Text style={{ fontWeight: "800" }}>{t("checkout.total")}</Text><Text style={{ fontWeight: "800" }}>{svc ? `${currency} ${grandTotal.toFixed(2)}` : "—"}</Text></View>
        {address && address.country !== "GH" && estimate?.duties && (
          <Text style={[s.muted, { marginTop: 8, fontSize: 13 }]}>
            {estimate.duties.below_threshold
              ? t("checkout.dutiesBelow", { country: estimate.duties.country })
              : prepaid
                ? t("checkout.dutiesPrepaid", { amount: `${currency} ${dutyTotal.toFixed(2)}` })
                : t("checkout.dutiesEstimate", { amount: `${currency} ${dutyTotal.toFixed(2)}` })}
            {estimate.duties.note ? ` ${estimate.duties.note}` : ""}
          </Text>
        )}
        <Text style={[s.muted, { marginTop: 8, fontSize: 12 }]}>{t("checkout.finalNote", { currency })}</Text>
      </View>
      <Input label={t("checkout.discountCode")} value={codeInput} onChangeText={setCodeInput} autoCapitalize="characters" error={codeError} />
      <View style={[s.row, { justifyContent: "flex-start", marginBottom: 8 }]}>
        <Button title={t("checkout.apply")} kind="quiet" disabled={!codeInput.trim() || !!orderRef.current} onPress={applyCode} />
        {coupon && <Button title={t("common.remove")} kind="quiet" onPress={() => { setCoupon(null); setCodeInput(""); }} />}
      </View>
      {coupon && <Notice kind="info">{coupon.free_shipping ? t("checkout.discountFree") : t("checkout.discountDone")}</Notice>}
      <Input label={t("checkout.notes")} value={notes} onChangeText={setNotes} maxLength={300} />
      {address && address.country !== "GH" && (
        <View style={[s.row, { marginBottom: 8 }]}>
          <Text style={{ flex: 1, color: color.ink }}>{t("checkout.dutiesAccept")}</Text>
          <Switch value={duties} onValueChange={setDuties} accessibilityLabel={t("m.acceptDuties")} />
        </View>
      )}
      <View style={[s.row, { marginBottom: 12 }]}>
        <Text style={{ flex: 1, color: color.ink }}>{t("checkout.termsAccept")}</Text>
        <Switch value={terms} onValueChange={setTerms} accessibilityLabel={t("m.acceptTerms")} />
      </View>
      <Button title={placing ? t("checkout.taking") : t("checkout.pay")} disabled={placing || !address || !svc || !provider || restricted.length > 0 || !terms || (address.country !== "GH" && !duties)} onPress={pay} />
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- orders */

export function OrdersScreen() {
  const { user, guestEnabled } = useAuth();
  const { t } = usePrefs();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useAsync(() => (user ? api<Page<OrderSummary>>("/orders/") : Promise.resolve(null)), [user?.id]);
  useFocusEffect(useCallback(() => { if (user) reload(); }, [user, reload]));
  if (!user) {
    return (
      <View style={[s.screen, s.pad]}>
        <Text style={s.h1}>{t("orders.title")}</Text>
        <Text style={s.muted}>{t("m.signInOrders")}</Text>
        {guestEnabled && <View style={{ marginTop: 16 }}><Button title={t("guest.find")} kind="quiet" onPress={() => nav.navigate("FindOrder")} /></View>}
      </View>
    );
  }
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>{t("orders.title")}</Text>
      {loading && <Busy />}
      {!!error && <Notice>{error}</Notice>}
      {data?.results.length === 0 && <Text style={s.muted}>{t("orders.none")}</Text>}
      {data?.results.map((o) => (
        <Pressable key={o.number} style={[s.card, s.cardPad]} accessibilityRole="button" onPress={() => nav.navigate("OrderDetail", { number: o.number })}>
          <View style={s.row}><Text style={{ fontWeight: "700", color: color.ink }}>{o.number}</Text><Pill value={o.status} /></View>
          <Text style={s.muted}>{new Date(o.created_at).toLocaleDateString()} · {t(o.item_count === 1 ? "m.itemOne" : "m.itemMany", { n: o.item_count })} · {o.currency} {o.grand_total}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function OrderDetailScreen({ route }: { route: { params: { number: string } } }) {
  const { number } = route.params;
  const { t } = usePrefs();
  const nav = useNavigation<Nav>();
  const { data: o, error, loading, reload } = useAsync(() => api<Order>(`/orders/${number}/`), [number]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Coming back from the payment page: re-check, since the webhook may have confirmed it meanwhile.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useEffect(() => {
    if (!o || o.status !== "pending_payment") return;
    api<PaymentMethod[]>(`/payments/methods/?currency=${o.currency}`).then(setMethods).catch(() => setMethods([]));
    const timer = setInterval(reload, 6000);
    return () => clearInterval(timer);
  }, [o?.status, o?.currency, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !o) return <Busy />;
  if (error || !o) return <View style={s.pad}><Notice>{error || t("m.orderNotFound")}</Notice></View>;

  const payNow = async (provider: string) => {
    setBusy(true);
    setMsg("");
    try {
      const a = await api<Attempt>("/payments/initiate/", { method: "POST", body: { order_number: o.number, provider }, headers: { "Idempotency-Key": `pay-${o.number}-${provider}-${Date.now()}` } });
      await WebBrowser.openBrowserAsync(a.authorization_url);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("m.couldntPay"));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () =>
    Alert.alert(t("m.cancelTitle"), t("m.cancelBody"), [
      { text: t("m.keepOrder"), style: "cancel" },
      { text: t("orders.cancel"), style: "destructive", onPress: async () => {
        try { await api(`/orders/${o.number}/cancel/`, { method: "POST", body: {} }); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : t("m.couldntCancel")); }
      } },
    ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>{t("orders.orderN", { number: o.number })}</Text>
      <Pill value={o.status} />
      {!!msg && <View style={{ marginTop: 12 }}><Notice>{msg}</Notice></View>}
      {o.status === "pending_payment" && (
        <View style={{ marginTop: 12 }}>
          <Notice kind="info">{t("m.waiting")}</Notice>
          {methods.map((m) => <View key={m.provider} style={{ marginBottom: 8 }}><Button title={busy ? t("m.opening") : t("orders.payWith", { method: methodLabel(t, m.provider, o.currency) })} disabled={busy} onPress={() => payNow(m.provider)} /></View>)}
          <Button title={t("orders.cancel")} kind="quiet" onPress={cancel} />
        </View>
      )}
      <Text style={s.h2}>{t("orders.whatOrdered")}</Text>
      {o.items.map((i) => (
        <View key={i.sku} style={[s.row, { marginBottom: 6 }]}><Text style={{ flex: 1 }}>{i.quantity} × {i.product_name}{i.variant_name ? ` (${i.variant_name})` : ""}</Text><Text>{o.currency} {i.line_total}</Text></View>
      ))}
      <View style={s.row}><Text style={s.muted}>{t("checkout.delivery")}</Text><Text>{o.currency} {o.shipping_total}</Text></View>
      <View style={s.row}><Text style={{ fontWeight: "800" }}>{t("checkout.total")}</Text><Text style={{ fontWeight: "800" }}>{o.currency} {o.grand_total}</Text></View>

      <Text style={s.h2}>{t("orders.whereIs")}</Text>
      {o.shipments.length === 0 && <Text style={s.muted}>{t("orders.noTracking")}</Text>}
      {o.shipments.map((sh) => (
        <View key={sh.id} style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{sh.carrier_name ?? t("orders.courier")} {sh.tracking_number ? `· ${sh.tracking_number}` : ""}</Text>
          {[...sh.events].reverse().map((e) => (
            <View key={e.id} style={{ borderLeftWidth: 2, borderLeftColor: color.line, paddingLeft: 12, paddingVertical: 6 }}>
              <Text style={{ fontWeight: "600", color: color.ink }}>{e.description || statusText(t, e.status)}</Text>
              <Text style={s.muted}>{new Date(e.occurred_at).toLocaleString()}{e.location ? ` · ${e.location}` : ""}</Text>
            </View>
          ))}
        </View>
      ))}
      <OrderReturns orderNumber={o.number} status={o.status} />
      {o.status !== "pending_payment" && <View style={{ marginTop: 12 }}><Button title={t("m.contactOrder")} kind="quiet" onPress={() => nav.navigate("SupportNew", { order: o.number })} /></View>}
    </ScrollView>
  );
}
