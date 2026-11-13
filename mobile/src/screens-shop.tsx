import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, ApiError, type Page } from "./api";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import type { Category, Product } from "./types";
import { Art, Busy, Button, Notice, s, useAsync } from "./ui";

export type ShopStack = { List: undefined; Product: { slug: string } };
export type RootTabs = { Shop: undefined; Bag: undefined; Orders: undefined; Account: undefined };

export function ShopList({ navigation }: NativeStackScreenProps<ShopStack, "List">) {
  const { t, money, currency } = usePrefs();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const cats = useAsync(() => api<Page<Category> | Category[]>("/categories/"), []);
  const list: Category[] = Array.isArray(cats.data) ? cats.data : cats.data?.results ?? [];
  const products = useAsync(
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
        {[{ id: null as number | null, name: "All" }, ...list].map((c) => (
          <Pressable key={String(c.id)} onPress={() => setCat(c.id)} accessibilityRole="button" accessibilityState={{ selected: cat === c.id }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: cat === c.id ? color.indigo : "#fff", borderWidth: 1, borderColor: color.line }}>
            <Text style={{ color: cat === c.id ? "#fff" : color.ink, fontWeight: "600" }}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {products.loading && <Busy />}
      {products.error ? <View style={s.pad}><Notice>{products.error}</Notice><Button title="Try again" onPress={products.reload} /></View> : null}
      <FlatList
        data={products.data?.results ?? []}
        keyExtractor={(p) => p.slug}
        numColumns={2}
        contentContainerStyle={{ padding: 8 }}
        columnWrapperStyle={{ gap: 8 }}
        ListEmptyComponent={products.loading ? null : <Text style={[s.muted, { padding: 16 }]}>Nothing matches. Try a different search.</Text>}
        renderItem={({ item }) => (
          <Pressable style={[s.card, { flex: 1 }]} accessibilityRole="button" accessibilityLabel={`${item.name}, ${money(item.base_price, item.currency)}`} onPress={() => navigation.navigate("Product", { slug: item.slug })}>
            <Art seed={item.slug} />
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
  const { user, addToCart } = useAuth();
  const { money } = usePrefs();
  const { data: p, error, loading } = useAsync(() => api<Product>(`/products/${route.params.slug}/`), [route.params.slug]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Busy />;
  if (error || !p) return <View style={s.pad}><Notice>{error || "Product not found."}</Notice></View>;
  const variants = p.variants.filter((v) => v.is_active);
  const chosen = variants.find((v) => v.id === (variantId ?? variants[0]?.id));

  const add = async () => {
    if (!chosen) return;
    if (!user) {
      (navigation.getParent() as unknown as { navigate: (n: string) => void }).navigate("Account");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await addToCart(chosen.id, qty);
      setMsg({ kind: "ok", text: "Added to your bag." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof ApiError ? e.message : "Couldn't add to your bag." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen}>
      <Art seed={p.slug} height={200} />
      <View style={s.pad}>
        <Text style={s.h1}>{p.name}</Text>
        <Text style={s.muted}>{p.maker ? `Made by ${p.maker}` : ""}{p.maker && p.origin_country ? " · " : ""}{p.origin_country}</Text>
        <Text style={{ fontSize: 22, fontWeight: "800", color: color.ink, marginVertical: 12 }}>{money(chosen?.price ?? p.base_price, p.currency)}</Text>
        <Text style={{ color: color.ink, lineHeight: 22 }}>{p.description}</Text>
        {variants.length > 1 && (
          <>
            <Text style={s.h2}>Choose one</Text>
            {variants.map((v) => (
              <Pressable key={v.id} onPress={() => setVariantId(v.id)} accessibilityRole="radio" accessibilityState={{ selected: chosen?.id === v.id }}
                style={[s.choice, chosen?.id === v.id && s.choiceOn]}>
                <Text style={{ fontWeight: "600", color: color.ink }}>{v.name}{!v.in_stock ? " (sold out)" : ""}</Text>
              </Pressable>
            ))}
          </>
        )}
        <View style={[s.row, { marginVertical: 16, justifyContent: "flex-start" }]}>
          <Button title="−" kind="quiet" onPress={() => setQty((n) => Math.max(1, n - 1))} />
          <Text accessibilityLabel={`Quantity ${qty}`} style={{ fontSize: 18, fontWeight: "700", minWidth: 28, textAlign: "center" }}>{qty}</Text>
          <Button title="+" kind="quiet" onPress={() => setQty((n) => Math.min(20, n + 1))} />
        </View>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <Button title={!user ? "Sign in to add to bag" : busy ? "Adding…" : "Add to bag"} disabled={busy || !chosen || !chosen.in_stock} onPress={add} />
        {chosen && !chosen.in_stock && <Text style={[s.muted, { marginTop: 8 }]}>This one is sold out.</Text>}
      </View>
    </ScrollView>
  );
}
