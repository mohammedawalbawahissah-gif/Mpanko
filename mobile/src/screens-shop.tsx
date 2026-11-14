import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, ApiError, type Page } from "./api";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import type { Category, Product } from "./types";
import { mainPhoto, photoList } from "./core/images";
import { Busy, Button, Notice, Photo, s, useCachedAsync } from "./ui";

export type ShopStack = { List: undefined; Product: { slug: string } };
export type RootTabs = { Shop: undefined; Bag: undefined; Orders: undefined; Account: undefined };

export function ShopList({ navigation }: NativeStackScreenProps<ShopStack, "List">) {
  const { t, money, currency } = usePrefs();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const cats = useCachedAsync("categories", () => api<Page<Category> | Category[]>("/categories/"), []);
  const list: Category[] = Array.isArray(cats.data) ? cats.data : cats.data?.results ?? [];
  const products = useCachedAsync(
    `products?cat=${cat ?? ""}&q=${query}`,
    () => api<Page<Product>>(`/products/?ordering=-created_at${cat ? `&category=${cat}` : ""}${query ? `&search=${encodeURIComponent(query)}` : ""}`),
    [cat, query]
  );
  return (
    <View style={s.screen}>
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <TextInput
          accessibilityLabel={t("shop.search")}
          placeholder={t("shop.search")}
          placeholderTextColor={color.muted}
          returnKeyType="search"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => setQuery(q)}
          style={[s.input]}
        />
      </View>
      {!!currency && (
        <Text accessibilityRole="button" onPress={() => navigation.getParent()?.getParent()?.navigate("Profile" as never)} style={{ color: color.indigo, fontWeight: "600", paddingHorizontal: 14, paddingBottom: 2 }}>
          {t("shop.pricesIn", { currency })}
        </Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
        {[{ id: null as number | null, name: t("m.all") }, ...list].map((c) => (
          <Pressable key={String(c.id)} onPress={() => setCat(c.id)} accessibilityRole="button" accessibilityState={{ selected: cat === c.id }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: cat === c.id ? color.indigo : "#fff", borderWidth: 1, borderColor: color.line }}>
            <Text style={{ color: cat === c.id ? "#fff" : color.ink, fontWeight: "600" }}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {(products.savedAt || cats.savedAt) && !products.error ? <View style={{ paddingHorizontal: 12 }}><Notice kind="info">{t("offline.saved")}</Notice></View> : null}
      {products.loading && <Busy />}
      {products.error ? <View style={s.pad}><Notice>{products.error}</Notice><Button title={t("m.tryAgain")} onPress={products.reload} /></View> : null}
      <FlatList
        data={products.data?.results ?? []}
        keyExtractor={(p) => p.slug}
        numColumns={2}
        contentContainerStyle={{ padding: 8 }}
        columnWrapperStyle={{ gap: 8 }}
        ListEmptyComponent={products.loading ? undefined : <Text style={[s.muted, { padding: 16 }]}>{t("m.nothingMatches")}</Text>}
        renderItem={({ item }) => (
          <Pressable style={[s.card, { flex: 1 }]} accessibilityRole="button" accessibilityLabel={`${item.name}, ${money(item.base_price, item.currency)}`} onPress={() => navigation.navigate("Product", { slug: item.slug })}>
            <Photo photo={mainPhoto(item.images)} seed={item.slug} name={item.name} />
            <View style={s.cardPad}>
              <Text style={{ fontWeight: "700", color: color.ink }} numberOfLines={2}>{item.name}</Text>
              <Text style={s.muted} numberOfLines={1}>{item.maker || item.origin_country}</Text>
              <Text style={{ fontWeight: "700", color: color.ink, marginTop: 4 }}>{money(item.base_price, item.currency)}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

export function ProductScreen({ route, navigation }: NativeStackScreenProps<ShopStack, "Product">) {
  const { user, addToCart, guestEnabled, addGuestLine } = useAuth();
  const { money, t } = usePrefs();
  const { data: p, error, loading, savedAt } = useCachedAsync(`product:${route.params.slug}`, () => api<Product>(`/products/${route.params.slug}/`), [route.params.slug]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { width } = useWindowDimensions();

  if (loading) return <Busy />;
  if (error || !p) return <View style={s.pad}><Notice>{error || t("m.productNotFound")}</Notice></View>;
  const photos = photoList(p.images);
  const variants = p.variants.filter((v) => v.is_active);
  const chosen = variants.find((v) => v.id === (variantId ?? variants[0]?.id));

  const add = async () => {
    if (!chosen) return;
    if (!user && guestEnabled) {
      await addGuestLine({ variantId: chosen.id, slug: p.slug, name: p.name, variantName: chosen.name, unitPrice: chosen.price, currency: p.currency, quantity: qty });
      setMsg({ kind: "ok", text: t("m.addedToBag") });
      return;
    }
    if (!user) {
      (navigation.getParent() as unknown as { navigate: (n: string) => void }).navigate("Account");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await addToCart(chosen.id, qty);
      setMsg({ kind: "ok", text: t("m.addedToBag") });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof ApiError ? e.message : t("m.couldntAdd") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen}>
      {photos.length > 1 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {photos.map((ph) => <View key={ph.id} style={{ width }}><Photo photo={ph} seed={p.slug} name={p.name} height={260} /></View>)}
        </ScrollView>
      ) : <Photo photo={photos[0] ?? null} seed={p.slug} name={p.name} height={260} />}
      <View style={s.pad}>
        {savedAt ? <Notice kind="info">{t("offline.saved")}</Notice> : null}
        <Text style={s.h1}>{p.name}</Text>
        <Text style={s.muted}>{p.maker ? t("m.madeBy", { maker: p.maker }) : ""}{p.maker && p.origin_country ? " · " : ""}{p.origin_country}</Text>
        <Text style={{ fontSize: 22, fontWeight: "800", color: color.ink, marginVertical: 12 }}>{money(chosen?.price ?? p.base_price, p.currency)}</Text>
        <Text style={{ color: color.ink, lineHeight: 22 }}>{p.description}</Text>
        {variants.length > 1 && (
          <>
            <Text style={s.h2}>{t("m.chooseOne")}</Text>
            {variants.map((v) => (
              <Pressable key={v.id} onPress={() => setVariantId(v.id)} accessibilityRole="radio" accessibilityState={{ selected: chosen?.id === v.id }}
                style={[s.choice, chosen?.id === v.id && s.choiceOn]}>
                <Text style={{ fontWeight: "600", color: color.ink }}>{!v.in_stock ? t("m.variantSoldOut", { name: v.name }) : v.on_backorder ? t("m.variantBackorder", { name: v.name }) : v.name}</Text>
              </Pressable>
            ))}
          </>
        )}
        <View style={[s.row, { marginVertical: 16, justifyContent: "flex-start" }]}>
          <Button title="−" kind="quiet" onPress={() => setQty((n) => Math.max(1, n - 1))} />
          <Text accessibilityLabel={t("m.quantity", { n: qty })} style={{ fontSize: 18, fontWeight: "700", minWidth: 28, textAlign: "center" }}>{qty}</Text>
          <Button title="+" kind="quiet" onPress={() => setQty((n) => Math.min(20, n + 1))} />
        </View>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <Button title={!user && !guestEnabled ? t("m.signInToAdd") : busy ? t("m.adding") : t("m.addToBag")} disabled={busy || !chosen || !chosen.in_stock} onPress={add} />
        {chosen && !chosen.in_stock && <Text style={[s.muted, { marginTop: 8 }]}>{t("m.thisSoldOut")}</Text>}
        {chosen?.on_backorder && <Text style={[s.muted, { marginTop: 8 }]}>{t("product.backorder")}{chosen.backorder_days ? `. ${t("product.backorderDays", { days: chosen.backorder_days })}` : ""}</Text>}
      </View>
    </ScrollView>
  );
}
