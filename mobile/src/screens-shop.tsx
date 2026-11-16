import { useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import { Text } from "./text";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, ApiError, type Page } from "./api";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { color, font, type } from "./theme";
import type { Category, Product } from "./types";
import { mainPhoto, photoList } from "./core/images";
import { Busy, Button, ErrorRetry, KenteBand, Notice, Photo, s, useCachedAsync, useLayout, usePullRefresh } from "./ui";

const GRID_GAP = 10;
export type ShopStack = { List: undefined; Product: { slug: string }; Menu: { slug: string } };
export type RootTabs = { Shop: undefined; Bag: undefined; Orders: undefined; Account: undefined };

export function ShopList({ navigation }: NativeStackScreenProps<ShopStack, "List">) {
  const { t, money, currency } = usePrefs();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null); // a category address (slug), which the shop API filters on
  // Search as you type: wait for a short pause so each keystroke is not a request.
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);
  const layout = useLayout();
  // Tall cards with the photo on top, like the shop on the web: two across on a phone, more on a tablet.
  const gridCols = layout.columns + 1;
  const tileWidth = Math.floor((layout.width - 24 - GRID_GAP * (gridCols - 1)) / gridCols);
  const cats = useCachedAsync("categories", () => api<Page<Category> | Category[]>("/categories/"), []);
  const all: Category[] = Array.isArray(cats.data) ? cats.data : cats.data?.results ?? [];
  const byOrder = (a: Category, b: Category) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);
  const tops = all.filter((c) => !c.parent).sort(byOrder);
  const chosen = all.find((c) => c.slug === cat);
  const topOfChosen = chosen ? (chosen.parent ? all.find((c) => c.id === chosen.parent) : chosen) : undefined;
  const subs = topOfChosen ? all.filter((c) => c.parent === topOfChosen.id).sort(byOrder) : [];
  const products = useCachedAsync(
    `products?cat=${cat ?? ""}&q=${query}`,
    () => api<Page<Product>>(`/products/?ordering=-created_at${cat ? `&category=${cat}` : ""}${query ? `&search=${encodeURIComponent(query)}` : ""}`),
    [cat, query]
  );
  const pull = usePullRefresh(() => {
    products.reload();
    cats.reload();
  });
  return (
    <View style={s.screen}>
      <KenteBand />
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <TextInput
          accessibilityLabel={t("shop.search")}
          placeholder={t("shop.search")}
          placeholderTextColor={color.muted}
          returnKeyType="search"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => setQuery(q.trim())}
          style={[s.input]}
        />
      </View>
      {!!currency && (
        <Text accessibilityRole="button" onPress={() => navigation.getParent()?.getParent()?.navigate("Profile" as never)} style={{ color: color.teal, fontWeight: "600", paddingHorizontal: 14, paddingVertical: 12 }}>
          {t("shop.pricesIn", { currency })}
        </Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
        {[{ id: 0, slug: null as string | null, name: t("m.all") }, ...tops].map((c) => (
          <Pressable key={String(c.id)} onPress={() => setCat(c.slug)} accessibilityRole="button" accessibilityState={{ selected: topOfChosen ? topOfChosen.slug === c.slug : c.slug === null }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: "center", borderRadius: 999, backgroundColor: (topOfChosen ? topOfChosen.slug === c.slug : c.slug === null) ? color.ink : "#fff", borderWidth: 1, borderColor: color.line }}>
            <Text style={{ color: (topOfChosen ? topOfChosen.slug === c.slug : c.slug === null) ? "#fff" : color.ink, fontWeight: "600" }}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {subs.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8 }}>
          {[{ id: -1, slug: topOfChosen!.slug, name: t("m.all"), is_menu: false }, ...subs].map((c) => (
            <Pressable key={String(c.id)} onPress={() => (c.is_menu ? navigation.navigate("Menu", { slug: c.slug }) : setCat(c.slug))} accessibilityRole="button" accessibilityState={{ selected: cat === c.slug }}
              style={{ paddingHorizontal: 12, paddingVertical: 6, minHeight: 44, justifyContent: "center", borderRadius: 999, backgroundColor: cat === c.slug ? color.gold : "#fff", borderWidth: 1, borderColor: cat === c.slug ? color.gold : color.line }}>
              <Text style={{ color: color.ink, fontWeight: "700" }}>{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {(products.savedAt || cats.savedAt) && !products.error ? <View style={{ paddingHorizontal: 12 }}><Notice kind="info">{t("offline.saved")}</Notice></View> : null}
      {products.loading && <Busy />}
      {products.error ? <View style={s.pad}><Notice>{products.error}</Notice><Button title={t("m.tryAgain")} onPress={products.reload} /></View> : null}
      <FlatList
        key={`cols-${gridCols}`}
        numColumns={gridCols}
        columnWrapperStyle={{ gap: GRID_GAP }}
        data={products.data?.results ?? []}
        keyExtractor={(p) => p.slug}
        refreshControl={pull.control}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={products.loading ? undefined : <Text style={[s.muted, { padding: 16 }]}>{t("m.nothingMatches")}</Text>}
        ListFooterComponent={
          products.data && products.data.results.length > 0 ? (
            <View style={{ backgroundColor: color.ink, borderRadius: 20, padding: 18, marginTop: 4, marginBottom: 24 }}>
              <Text accessibilityRole="header" style={{ fontFamily: font.display, color: "#fff", fontWeight: "700", fontSize: 20, marginBottom: 4 }}>{t("shop.askTitle")}</Text>
              <Text style={{ color: "#C5DAD6", marginBottom: 12 }}>{t("shop.askBody")}</Text>
              <Button title={t("m.askUs")} kind="gold" onPress={() => navigation.getParent()?.getParent()?.navigate("SupportNew" as never)} />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            style={[s.card, { width: tileWidth, marginBottom: GRID_GAP }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${money(item.base_price, item.currency)}`}
            onPress={() => navigation.navigate("Product", { slug: item.slug })}
          >
            <Photo photo={mainPhoto(item.images)} seed={item.slug} name={item.name} height={Math.round(tileWidth * 0.75)} />
            <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
              {!!item.category_name && <Text numberOfLines={1} style={{ fontSize: type.xs, fontWeight: "700", color: "#0B6A61", marginBottom: 2 }}>{item.category_name}</Text>}
              <Text style={{ fontWeight: "600", color: color.ink, fontSize: 15, lineHeight: 20 }} numberOfLines={2}>{item.name}</Text>
              <Text style={[s.muted, { fontSize: type.xs, marginTop: 2 }]} numberOfLines={1}>{item.maker || item.origin_country}</Text>
              <View style={{ flex: 1, minHeight: 8 }} />
              <Text style={[s.price, { fontSize: type.lg }]}>{money(item.base_price, item.currency)}</Text>
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
  const { data: p, error, loading, savedAt, reload } = useCachedAsync(`product:${route.params.slug}`, () => api<Product>(`/products/${route.params.slug}/`), [route.params.slug]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const layout = useLayout();
  const { width } = useWindowDimensions();
  const productName = p?.name;
  useEffect(() => {
    if (productName) navigation.setOptions({ title: productName });
  }, [productName, navigation]);

  if (loading) return <Busy />;
  if (error || !p) return <View style={s.pad}>{error ? <ErrorRetry message={error} onRetry={reload} /> : <Notice>{t("m.productNotFound")}</Notice>}</View>;
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

  const galleryWidth = layout.isTablet ? Math.floor(width / 2) : width;
  const photoHeight = layout.isTablet ? 380 : 260;
  const gallery = photos.length > 1 ? (
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      {photos.map((ph) => <View key={ph.id} style={{ width: galleryWidth }}><Photo photo={ph} seed={p.slug} name={p.name} height={photoHeight} /></View>)}
    </ScrollView>
  ) : <Photo photo={photos[0] ?? null} seed={p.slug} name={p.name} height={photoHeight} />;

  return (
    <ScrollView style={s.screen}>
      <View style={layout.isTablet ? { flexDirection: "row", alignItems: "flex-start" } : undefined}>
      <View style={layout.isTablet ? { width: galleryWidth } : undefined}>{gallery}</View>
      <View style={[s.pad, layout.isTablet && { flex: 1 }]}>
        {savedAt ? <Notice kind="info">{t("offline.saved")}</Notice> : null}
        <Text accessibilityRole="header" style={s.h1}>{p.name}</Text>
        <Text style={s.muted}>{p.maker ? t("m.madeBy", { maker: p.maker }) : ""}{p.maker && p.origin_country ? " · " : ""}{p.origin_country}</Text>
        <Text style={[s.price, { fontSize: 26, marginVertical: 12 }]}>{money(chosen?.price ?? p.base_price, p.currency)}</Text>
        <Text style={s.body}>{p.description}</Text>
        {variants.length > 1 && (
          <>
            <Text accessibilityRole="header" style={s.h2}>{t("m.chooseOne")}</Text>
            {variants.map((v) => (
              <Pressable key={v.id} onPress={() => setVariantId(v.id)} accessibilityRole="radio" accessibilityState={{ selected: chosen?.id === v.id }}
                style={[s.choice, chosen?.id === v.id && s.choiceOn]}>
                <Text style={{ fontWeight: "600", color: color.ink }}>{!v.in_stock ? t("m.variantSoldOut", { name: v.name }) : v.on_backorder ? t("m.variantBackorder", { name: v.name }) : v.name}</Text>
              </Pressable>
            ))}
          </>
        )}
        <View style={[s.row, { marginVertical: 16, justifyContent: "flex-start" }]}>
          <Button title="−" label={t("m.fewer", { name: p.name })} kind="quiet" onPress={() => setQty((n) => Math.max(1, n - 1))} />
          <Text accessibilityLabel={t("m.quantity", { n: qty })} style={{ fontSize: 18, fontWeight: "700", minWidth: 28, textAlign: "center" }}>{qty}</Text>
          <Button title="+" label={t("m.more", { name: p.name })} kind="quiet" onPress={() => setQty((n) => Math.min(20, n + 1))} />
        </View>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <Button title={!user && !guestEnabled ? t("m.signInToAdd") : busy ? t("m.adding") : t("m.addToBag")} disabled={busy || !chosen || !chosen.in_stock} onPress={add} />
        {chosen && !chosen.in_stock && <Text style={[s.muted, { marginTop: 8 }]}>{t("m.thisSoldOut")}</Text>}
        {chosen?.made_to_order && <Text style={[s.muted, { marginTop: 8 }]}>{t("product.madeToOrder")}{chosen.lead_time_days ? `. ${t("product.backorderDays", { days: chosen.lead_time_days })}` : ""}</Text>}
        {chosen?.on_backorder && !chosen.made_to_order && <Text style={[s.muted, { marginTop: 8 }]}>{t("product.backorder")}{chosen.backorder_days ? `. ${t("product.backorderDays", { days: chosen.backorder_days })}` : ""}</Text>}
      </View>
      </View>
    </ScrollView>
  );
}
