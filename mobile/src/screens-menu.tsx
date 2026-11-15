import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import type { MenuData, MenuItem } from "./types";
import { Busy, Button, ErrorRetry, Notice, s, useCachedAsync } from "./ui";
import type { ShopStack } from "./screens-shop";

/** The QT Eatery order page: every dish in the flyer's sections, each with a quantity and an Add button. */
export function MenuScreen({ route, navigation }: NativeStackScreenProps<ShopStack, "Menu">) {
  const { user, addToCart, guestEnabled, addGuestLine, guestLines } = useAuth();
  const { t, money } = usePrefs();
  const { data, error, loading, reload } = useCachedAsync(`menu:${route.params.slug}`, () => api<MenuData>(`/menu/${route.params.slug}/`), [route.params.slug]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ slug: string; kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState(0);

  if (loading) return <Busy />;
  if (error || !data) return <View style={s.pad}><ErrorRetry message={error ?? t("m.productNotFound")} onRetry={reload} /></View>;

  const add = async (item: MenuItem) => {
    const variant = item.variants.find((v) => v.id === pick[item.slug]) ?? item.variants[0];
    if (!variant) return;
    const n = qty[item.slug] ?? 1;
    if (!user && guestEnabled) {
      await addGuestLine({ variantId: variant.id, slug: item.slug, name: item.name, variantName: variant.name, unitPrice: variant.price, currency: item.currency, quantity: n });
      setAdded((a) => a + n);
      setMsg({ slug: item.slug, kind: "ok", text: t("m.addedToBag") });
      return;
    }
    if (!user) {
      (navigation.getParent() as unknown as { navigate: (n: string) => void }).navigate("Account");
      return;
    }
    setBusy(item.slug);
    setMsg(null);
    try {
      await addToCart(variant.id, n);
      setAdded((a) => a + n);
      setMsg({ slug: item.slug, kind: "ok", text: t("m.addedToBag") });
    } catch (e) {
      setMsg({ slug: item.slug, kind: "error", text: e instanceof ApiError ? e.message : t("m.couldntAdd") });
    } finally {
      setBusy(null);
    }
  };

  const inBag = guestLines.length;

  return (
    <View style={[s.screen, { flex: 1 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <View style={s.pad}>
          <Text accessibilityRole="header" style={s.h1}>{t("menu.title", { name: data.category.name })}</Text>
          {!!data.note && <Text style={[s.muted, { marginTop: 4 }]}>{data.note}</Text>}
          <Text style={[s.muted, { marginTop: 8 }]}>{t("menu.hint")}</Text>
        </View>
        {data.sections.map((sec) => (
          <View key={sec.name} style={{ paddingHorizontal: 14, marginBottom: 12 }}>
            <Text accessibilityRole="header" style={s.h2}>{sec.name}</Text>
            {sec.items.map((item) => {
              const variant = item.variants.find((v) => v.id === pick[item.slug]) ?? item.variants[0];
              const n = qty[item.slug] ?? 1;
              return (
                <View key={item.slug} style={[s.card, { padding: 12, marginTop: 8 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ flex: 1, fontWeight: "700", color: color.ink }}>{item.name}</Text>
                    <Text style={{ fontWeight: "800", color: color.ink }}>{item.orderable && variant ? money(variant.price, item.currency) : t("menu.soon")}</Text>
                  </View>
                  {!!item.description && <Text style={[s.muted, { marginTop: 2 }]}>{item.description}</Text>}
                  {item.orderable && item.variants.length > 1 && item.variants.map((v) => (
                    <Pressable key={v.id} onPress={() => setPick((p) => ({ ...p, [item.slug]: v.id }))} accessibilityRole="radio" accessibilityState={{ selected: variant?.id === v.id }}
                      style={[s.choice, variant?.id === v.id && s.choiceOn]}>
                      <Text style={{ fontWeight: "600", color: color.ink }}>{v.name} · {money(v.price, item.currency)}</Text>
                    </Pressable>
                  ))}
                  {item.orderable && (
                    <View style={[s.row, { marginTop: 8, justifyContent: "flex-start" }]}>
                      <Button title="−" label={t("m.fewer", { name: item.name })} kind="quiet" onPress={() => setQty((q) => ({ ...q, [item.slug]: Math.max(1, n - 1) }))} />
                      <Text accessibilityLabel={t("m.quantity", { n })} style={{ fontSize: 16, fontWeight: "700", minWidth: 28, textAlign: "center" }}>{n}</Text>
                      <Button title="+" label={t("m.more", { name: item.name })} kind="quiet" onPress={() => setQty((q) => ({ ...q, [item.slug]: Math.min(20, n + 1) }))} />
                      <Button title={!user && !guestEnabled ? t("m.signInToAdd") : busy === item.slug ? t("m.adding") : t("m.addToBag")} disabled={busy === item.slug} onPress={() => add(item)} />
                    </View>
                  )}
                  {msg?.slug === item.slug && <Notice kind={msg.kind}>{msg.text}</Notice>}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {(added > 0 || inBag > 0) && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderColor: color.line }}>
          <Button title={t("menu.viewBag")} onPress={() => (navigation.getParent() as unknown as { navigate: (n: string) => void }).navigate("Bag")} />
        </View>
      )}
    </View>
  );
}
