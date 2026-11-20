import { Pressable, ScrollView, View } from "react-native";
import { Text } from "./text";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { api, type Page } from "./api";
import { usePrefs } from "./prefs";
import { color, font, type } from "./theme";
import type { Category, Product } from "./types";
import { mainPhoto } from "./core/images";
import { Busy, Button, KenteBand, Notice, Photo, s, useCachedAsync, useLayout, usePullRefresh } from "./ui";
import type { RootTabs } from "./screens-shop";

const byOrder = (a: Category, b: Category) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);

/** The landing page, as on the web: the promise, three facts, departments, then new products. */
export function HomeScreen() {
  const { t, money } = usePrefs();
  const nav = useNavigation<NavigationProp<RootTabs>>();
  const layout = useLayout();
  const cats = useCachedAsync("categories", () => api<Page<Category> | Category[]>("/categories/"), []);
  const products = useCachedAsync("products?cat=&q=", () => api<Page<Product>>("/products/?ordering=-created_at"), []);
  const pull = usePullRefresh(() => { cats.reload(); products.reload(); });
  const all: Category[] = Array.isArray(cats.data) ? cats.data : cats.data?.results ?? [];
  const tops = all.filter((c) => !c.parent).sort(byOrder);
  const kids = (c: Category) => all.filter((x) => x.parent === c.id).length;
  const openShop = (slug?: string) => (nav as unknown as { navigate: (n: string, p: unknown) => void }).navigate("Shop", { screen: "List", params: slug ? { category: slug } : undefined });
  const open = (slug: string) => (nav as unknown as { navigate: (n: string, p: unknown) => void }).navigate("Shop", { screen: "Product", params: { slug } });
  const tile = Math.floor((layout.width - 24 - 10) / 2);
  const facts = [
    [t("m.homeFact1Title"), t("m.homeFact1Body")],
    [t("m.homeFact2Title"), t("m.homeFact2Body")],
    [t("m.homeFact3Title"), t("m.homeFact3Body")],
  ];
  return (
    <ScrollView style={s.screen} refreshControl={pull.control} contentContainerStyle={{ paddingBottom: 24 }}>
      <KenteBand />
      <View style={{ backgroundColor: color.ink, padding: 20 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, color: "#fff", fontWeight: "700", fontSize: 26, lineHeight: 32 }}>{t("m.homeTitle")}</Text>
        <Text style={{ color: "#C5DAD6", marginTop: 8, marginBottom: 14 }}>{t("m.homeLead")}</Text>
        <Button title={t("home.shopCollection")} kind="gold" onPress={() => openShop()} />
      </View>
      <View style={{ padding: 12, gap: 10 }}>
        {facts.map(([h, b]) => (
          <View key={h} style={s.card}>
            <View style={{ padding: 14 }}>
              <Text style={{ fontWeight: "700", color: color.ink, fontSize: type.lg }}>{h}</Text>
              <Text style={[s.muted, { marginTop: 4 }]}>{b}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text accessibilityRole="header" style={[s.h2, { paddingHorizontal: 12 }]}>{t("home.departments")}</Text>
      {cats.loading && <Busy />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 12, paddingTop: 8 }}>
        {tops.slice(0, 6).map((c) => (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}, ${t("home.deptCount", { n: kids(c) })}`} onPress={() => openShop(c.slug)} style={[s.card, { width: tile, padding: 14, minHeight: 80, justifyContent: "flex-end" }]}>
            <Text style={{ fontWeight: "700", color: color.ink }}>{c.name}</Text>
            <Text style={[s.muted, { fontSize: type.xs }]}>{t("home.deptCount", { n: kids(c) })}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, marginTop: 18 }}>
        <Text accessibilityRole="header" style={s.h2}>{t("m.homeNew")}</Text>
        <Pressable accessibilityRole="button" onPress={() => openShop()} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: color.teal, fontWeight: "700" }}>{t("m.homeSeeAll")}</Text></Pressable>
      </View>
      {products.error ? <View style={s.pad}><Notice>{products.error}</Notice></View> : null}
      {products.data && products.data.results.length === 0 && <Text style={[s.muted, { padding: 12 }]}>{t("m.homeNone")}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 12 }}>
        {products.data?.results.slice(0, 12).map((p) => (
          <Pressable key={p.slug} accessibilityRole="button" accessibilityLabel={`${p.name}, ${money(p.base_price, p.currency)}`} onPress={() => open(p.slug)} style={[s.card, { width: tile }]}>
            <Photo photo={mainPhoto(p.images)} seed={p.slug} name={p.name} height={Math.round(tile * 0.75)} />
            <View style={{ padding: 10 }}>
              <Text numberOfLines={2} style={{ fontWeight: "600", color: color.ink }}>{p.name}</Text>
              <Text style={[s.price, { fontSize: type.lg }]}>{money(p.base_price, p.currency)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
