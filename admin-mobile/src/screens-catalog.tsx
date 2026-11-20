import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Image, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { errText, rowsOf, useLoad, useRunner } from "./hooks";
import { CountryList, FieldsForm, type FieldDef, type Opt, type Pick, type Vals } from "./kit";
import { color } from "./theme";
import { Busy, Button, Card, Empty, Field, Notice, Pill, s } from "./ui";

const MAX_PHOTOS = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const label = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface Variant { id: number; sku: string; name: string; price: string; price_override?: string | null; attributes?: Record<string, string>; is_active?: boolean; quantity: number | null; in_stock: boolean }
interface Photo { id: number; image: string; alt_text: string; position: number }
interface Category { id: number; name: string; parent?: number | null }
interface Product {
  id: number; name: string; slug: string; description: string; category: number | null; category_name: string | null; origin_country: string; maker: string; base_price: string; currency: string; status: string; weight_grams: number;
  length_mm?: number; width_mm?: number; height_mm?: number; is_dangerous_goods?: boolean; dg_class?: string; un_number?: string; hs_code?: string; restricted_countries: string[]; variants: Variant[]; images?: Photo[];
  product_type?: number | null; made_to_order?: boolean; lead_time_days?: number | null;
}

/** "Food" then "Food › Spices": departments first, each followed by its sub-categories. */
function categoryChoices(all: Category[]): Opt[] {
  const out: Opt[] = [];
  for (const t of all.filter((c) => !c.parent)) {
    out.push({ value: String(t.id), label: t.name });
    for (const c of all.filter((x) => x.parent === t.id)) out.push({ value: String(c.id), label: `${t.name} › ${c.name}` });
  }
  const seen = new Set(out.map((o) => o.value));
  return [...out, ...all.filter((c) => !seen.has(String(c.id))).map((c) => ({ value: String(c.id), label: c.name }))];
}

const FIELDS: FieldDef[] = [
  { key: "name", label: "Name" }, { key: "description", label: "Description", kind: "area" },
  { key: "category", label: "Category", kind: "select", options: [] },
  { key: "maker", label: "Maker" }, { key: "origin_country", label: "Country of origin", kind: "country" },
  { key: "weight_grams", label: "Weight in grams", kind: "int" }, { key: "base_price", label: "Price", kind: "decimal" },
  { key: "currency", label: "Currency", kind: "select", options: [] },
  { key: "status", label: "Status", kind: "select", options: [{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }] },
  { key: "length_mm", label: "Length (mm)", kind: "int", hint: "Measure one unit in its box, in millimetres. Leaving all three at 0 uses the default box. Fill all three or none." },
  { key: "width_mm", label: "Width (mm)", kind: "int" }, { key: "height_mm", label: "Height (mm)", kind: "int" },
  { key: "hs_code", label: "Customs tariff code (HS code, optional)" },
  { key: "dangerous", label: "This product is dangerous goods (lithium batteries, aerosols, alcohol-based perfume, flammable items)", kind: "bool", hint: "Customers are then only offered shipping services cleared for dangerous goods. Labels for these parcels are booked in the carrier's own portal." },
  { key: "dg_class", label: "UN hazard class (for example 9 or 3)", show: (v) => !!v.dangerous }, { key: "un_number", label: "UN number (for example UN3481)", show: (v) => !!v.dangerous },
  { key: "product_type", label: "Product type (decides where it can ship)", kind: "select", options: [] },
  { key: "made_to_order", label: "Made to order (stock is not counted)", kind: "bool" },
  { key: "lead_time_days", label: "Days to make before it ships", kind: "int", show: (v) => !!v.made_to_order },
  { key: "restricted_countries", label: "Can't ship to", kind: "countries" },
];

export function ProductsScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = useLoad(() => api<unknown>("/products/?ordering=-created_at&page_size=100"), []);
  const list = data ? rowsOf<Product>(data) : null;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={list ?? []}
      keyExtractor={(p) => p.slug}
      ListHeaderComponent={<><Button title="Add a product" onPress={() => nav.navigate("Product", { slug: "new" })} />{error ? <Notice>{error}</Notice> : null}</>}
      ListEmptyComponent={list ? <Empty>No products yet.</Empty> : <Busy />}
      renderItem={({ item }) => (
        <Card onPress={() => nav.navigate("Product", { slug: item.slug })} label={item.name}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={[s.body, { fontWeight: "800", flex: 1 }]}>{item.name}</Text><Text style={s.body}>{item.currency} {item.base_price}</Text></View>
          <Text style={s.muted}>{item.category_name ?? "No category"} · {item.maker || "No maker"} · {item.variants.length} variant{item.variants.length === 1 ? "" : "s"}</Text>
          <View style={{ marginTop: 6 }}><Pill text={label(item.status)} tone={item.status === "published" ? "ok" : undefined} /></View>
        </Card>
      )}
    />
  );
}

export function ProductScreen({ route }: { route: { params: { slug: string } } }) {
  const slug = route.params.slug;
  const isNew = slug === "new";
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: product, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : api<Product>(`/products/${slug}/`)), [slug]);
  const cats = useLoad(() => api<unknown>("/categories/"), []);
  const types = useLoad(() => api<unknown>("/product-types/"), []);
  const money = useLoad(() => api<{ currencies: string[] }>("/currency/rates/").catch(() => ({ currencies: ["USD", "GHS"] })), []);
  const [vals, setVals] = useState<Vals | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [variantName, setVariantName] = useState("Standard");
  const [sku, setSku] = useState("");
  const [newPhotos, setNewPhotos] = useState<Pick[]>([]);
  const [note, setNote] = useState("");
  const { msg, setMsg, busy, run } = useRunner();
  useEffect(() => {
    if (vals) return;
    if (isNew) setVals({ name: "", description: "", category: "", origin_country: "GH", maker: "", base_price: "", currency: "USD", status: "draft", weight_grams: "500", length_mm: "0", width_mm: "0", height_mm: "0", hs_code: "", dangerous: false, dg_class: "", un_number: "", product_type: "", made_to_order: false, lead_time_days: "", restricted_countries: [] });
    else if (product) setVals({ name: product.name, description: product.description, category: product.category ? String(product.category) : "", origin_country: product.origin_country, maker: product.maker, base_price: product.base_price, currency: product.currency, status: product.status, weight_grams: String(product.weight_grams ?? 500), length_mm: String(product.length_mm ?? 0), width_mm: String(product.width_mm ?? 0), height_mm: String(product.height_mm ?? 0), hs_code: product.hs_code ?? "", dangerous: !!product.is_dangerous_goods, dg_class: product.dg_class ?? "", un_number: product.un_number ?? "", product_type: product.product_type ? String(product.product_type) : "", made_to_order: !!product.made_to_order, lead_time_days: product.lead_time_days ? String(product.lead_time_days) : "", restricted_countries: product.restricted_countries ?? [] });
  }, [vals, isNew, product]);
  const fields = useMemo<FieldDef[]>(() => FIELDS.map((f) => (f.key === "category" ? { ...f, options: [{ value: "", label: "None" }, ...categoryChoices(rowsOf<Category>(cats.data))] } : f.key === "product_type" ? { ...f, options: [{ value: "", label: "None" }, ...rowsOf<{ id: number; name: string }>(types.data).map((t) => ({ value: String(t.id), label: t.name }))] } : f.key === "currency" ? { ...f, options: (money.data?.currencies ?? ["USD", "GHS"]).map((c) => ({ value: c, label: c })) } : f)), [cats.data, types.data, money.data]);
  if (!vals) return <ScrollView contentContainerStyle={{ padding: 16 }}>{error ? <Notice>{error}</Notice> : <Busy />}</ScrollView>;

  const addPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setNote("Allow photo access in your phone settings to choose pictures."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.85 });
    if (r.canceled) return;
    const problems: string[] = [];
    const ok: Pick[] = [];
    for (const a of r.assets) {
      const name = a.fileName ?? "photo.jpg";
      if (a.fileSize && a.fileSize > MAX_BYTES) problems.push(`${name} is over 5 MB.`);
      else if (newPhotos.length + ok.length >= MAX_PHOTOS) problems.push(`${name} was left out: a product can have at most ${MAX_PHOTOS} photos.`);
      else ok.push({ uri: a.uri, name, type: a.mimeType ?? "image/jpeg" });
    }
    setNewPhotos((c) => [...c, ...ok]); setNote(problems.join(" "));
  };

  const save = async () => {
    setErrors({}); setMsg(null);
    const v = vals;
    const body: Record<string, unknown> = {
      name: v.name, description: v.description, category: v.category ? Number(v.category) : null, origin_country: String(v.origin_country).toUpperCase(), maker: v.maker, base_price: v.base_price, currency: v.currency, status: v.status,
      weight_grams: Number(v.weight_grams) || 0, length_mm: Number(v.length_mm) || 0, width_mm: Number(v.width_mm) || 0, height_mm: Number(v.height_mm) || 0,
      is_dangerous_goods: !!v.dangerous, dg_class: v.dangerous ? String(v.dg_class).trim() : "", un_number: v.dangerous ? String(v.un_number).trim().toUpperCase() : "", hs_code: String(v.hs_code).trim(),
      product_type: v.product_type ? Number(v.product_type) : null, made_to_order: !!v.made_to_order, lead_time_days: v.made_to_order && v.lead_time_days ? Number(v.lead_time_days) : null, restricted_countries: v.restricted_countries,
    };
    if (isNew) body.variants = [{ sku, name: variantName }];
    try {
      if (!isNew) { await run(() => api(`/products/${slug}/`, { method: "PATCH", body }), "Product saved.", reload); return; }
      const created = await api<Product>("/products/", { method: "POST", body });
      const failed: string[] = [];
      for (const p of newPhotos) {
        const form = new FormData();
        form.append("image", { uri: p.uri, name: p.name, type: p.type } as unknown as Blob);
        form.append("alt_text", String(v.name));
        try { await api(`/products/${created.slug}/images/`, { method: "POST", body: form }); } catch { failed.push(p.name); }
      }
      if (failed.length) { Alert.alert("Saved, with a problem", `The product was saved, but these photos did not upload: ${failed.join(", ")}. Add them on the next screen.`); nav.replace("Product", { slug: created.slug }); }
      else nav.goBack();
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fields()); setMsg({ kind: "error", text: "Check the highlighted fields." }); } else setMsg({ kind: "error", text: errText(e) });
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{isNew ? "Add a product" : `Edit ${product?.name ?? ""}`}</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <FieldsForm fields={fields} vals={vals} setVals={(f) => setVals((p) => f(p ?? {}))} errors={errors} />
      {isNew ? (
        <>
          <Text style={s.h2}>First variant</Text>
          <Field label="First variant name" value={variantName} onChangeText={setVariantName} />
          {errors.variants ? <Text style={{ color: color.bad }}>{errors.variants}</Text> : null}
          <Field label="SKU" value={sku} onChangeText={setSku} autoCapitalize="characters" />
          <Text style={s.h2}>Photos</Text>
          <Text style={s.muted}>The first photo is the main one. JPG or PNG, up to 5 MB each, {MAX_PHOTOS} per product. You can add or change them later.</Text>
          {note ? <Notice>{note}</Notice> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 10 }}>
            {newPhotos.map((p, i) => (
              <View key={p.uri} style={{ width: 140 }}>
                <Image accessibilityIgnoresInvertColors source={{ uri: p.uri }} style={{ width: 140, height: 140, borderRadius: 8, backgroundColor: color.wash }} />
                <Text style={s.muted}>{i === 0 ? "Main photo" : ""}</Text>
                {i > 0 ? <Button title="Make main" tone="quiet" onPress={() => setNewPhotos((c) => [p, ...c.filter((x) => x !== p)])} /> : null}
                <Button title="Remove" tone="quiet" onPress={() => setNewPhotos((c) => c.filter((x) => x !== p))} />
              </View>
            ))}
          </View>
          <Button title="Add photos" tone="quiet" onPress={addPhotos} />
        </>
      ) : null}
      <Button title={busy ? "Saving…" : isNew ? "Add product" : "Save changes"} busy={busy} onPress={save} />
      {!isNew && product ? <><PhotosPanel slug={slug} /><VariantsPanel slug={slug} /></> : null}
    </ScrollView>
  );
}

function PhotosPanel({ slug }: { slug: string }) {
  const { data, reload } = useLoad(() => api<Product>(`/products/${slug}/`), [slug]);
  const { msg, setMsg, busy, run } = useRunner();
  const [alt, setAlt] = useState("");
  const photos = data?.images ?? [];
  const upload = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ kind: "error", text: "Allow photo access in your phone settings to choose pictures." }); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.85 });
    if (r.canceled) return;
    const problems: string[] = [];
    let added = 0;
    await run(async () => {
      for (const a of r.assets) {
        const name = a.fileName ?? "photo.jpg";
        if (a.fileSize && a.fileSize > MAX_BYTES) { problems.push(`${name} is over 5 MB.`); continue; }
        if (photos.length + added >= MAX_PHOTOS) { problems.push(`${name} was left out: a product can have at most ${MAX_PHOTOS} photos.`); continue; }
        const form = new FormData();
        form.append("image", { uri: a.uri, name, type: a.mimeType ?? "image/jpeg" } as unknown as Blob);
        form.append("alt_text", alt);
        await api(`/products/${slug}/images/`, { method: "POST", body: form });
        added += 1;
      }
    }, () => `${added} added. ${problems.join(" ")}`.trim(), () => { setAlt(""); reload(); });
    reload();
  };
  return (
    <View>
      <Text style={s.h2}>Photos</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {photos.map((p, i) => (
          <View key={p.id} style={{ width: 140 }}>
            <Image accessibilityLabel={p.alt_text} source={{ uri: p.image }} style={{ width: 140, height: 140, borderRadius: 8, backgroundColor: color.wash }} />
            <Text style={s.muted}>{i === 0 ? "Main photo" : ""}</Text>
            {i > 0 ? <Button title="Make main" tone="quiet" onPress={() => run(() => Promise.all(photos.map((q, j) => api(`/products/${slug}/images/${q.id}/`, { method: "PATCH", body: { position: q.id === p.id ? 0 : j + 1 } }))), "Main photo changed.", reload)} /> : null}
            <Button title="Remove" tone="quiet" onPress={() => Alert.alert("Remove this photo?", "", [{ text: "Not now", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => run(() => api(`/products/${slug}/images/${p.id}/`, { method: "DELETE" }), "Photo removed.", reload) }])} />
          </View>
        ))}
      </View>
      {photos.length === 0 ? <Text style={s.muted}>No photos yet.</Text> : null}
      <Field label="Describe the photo (for screen readers)" value={alt} onChangeText={setAlt} />
      <Button title="Add photos" tone="quiet" busy={busy} onPress={upload} />
    </View>
  );
}

const attrText = (a?: Record<string, string>) => Object.entries(a ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) { const [k, ...rest] = part.split("="); if (k.trim() && rest.length) out[k.trim()] = rest.join("=").trim(); }
  return out;
}

function VariantsPanel({ slug }: { slug: string }) {
  const { data, reload } = useLoad(() => api<Product>(`/products/${slug}/`), [slug]);
  const { msg, busy, run } = useRunner();
  const [edit, setEdit] = useState<number | "new" | null>(null);
  const [f, setF] = useState({ sku: "", name: "", attrs: "", override: "" });
  const variants = data?.variants ?? [];
  const current = typeof edit === "number" ? variants.find((v) => v.id === edit) : undefined;
  const open = (v: Variant | "new") => { setEdit(v === "new" ? "new" : v.id); setF(v === "new" ? { sku: "", name: "", attrs: "", override: "" } : { sku: v.sku, name: v.name, attrs: attrText(v.attributes), override: v.price_override ?? "" }); };
  return (
    <View>
      <Text style={s.h2}>Variants</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      {variants.map((v) => (
        <Card key={v.id}>
          <Text style={[s.body, { fontWeight: "800" }]}>{v.name} · {v.sku}{v.is_active === false ? " (off)" : ""}</Text>
          <Text style={s.muted}>{attrText(v.attributes) || "No options"} · {v.price} · {v.quantity === null ? "made to order" : `${v.quantity} in stock`}</Text>
          <Button title="Edit" tone="quiet" onPress={() => open(v)} />
          <Button title={v.is_active === false ? "Turn on" : "Turn off"} tone="quiet" onPress={() => run(() => (v.is_active === false ? api(`/products/${slug}/variants/${v.id}/`, { method: "PATCH", body: { is_active: true } }) : api(`/products/${slug}/variants/${v.id}/`, { method: "DELETE" })), "Variant updated.", reload)} />
        </Card>
      ))}
      {edit === null ? <Button title="Add a variant" tone="quiet" onPress={() => open("new")} /> : (
        <Card>
          <Text style={[s.body, { fontWeight: "800", marginBottom: 8 }]}>{current ? `Edit ${current.name}` : "New variant"}</Text>
          <Field label="Name" value={f.name} onChangeText={(x) => setF({ ...f, name: x })} />
          <Field label="SKU" value={f.sku} onChangeText={(x) => setF({ ...f, sku: x })} autoCapitalize="characters" />
          <Field label="Options (Size=L, Colour=Red)" value={f.attrs} onChangeText={(x) => setF({ ...f, attrs: x })} />
          <Field label="Price (optional)" value={f.override} onChangeText={(x) => setF({ ...f, override: x })} keyboardType="decimal-pad" />
          <Button title="Save variant" busy={busy} onPress={() => run(() => { const body = { sku: f.sku, name: f.name, attributes: parseAttrs(f.attrs), price_override: f.override === "" ? null : f.override }; return current ? api(`/products/${slug}/variants/${current.id}/`, { method: "PATCH", body }) : api(`/products/${slug}/variants/`, { method: "POST", body }); }, "Variant saved.", () => { setEdit(null); reload(); })} />
          <Button title="Cancel" tone="quiet" onPress={() => setEdit(null)} />
        </Card>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- QT Eatery menu

interface Dish { id: number; name: string; section: string; price: string; currency: string; published: boolean }
const SLUG = "qt-eatery";

export function MenuPricesScreen() {
  const menu = useLoad(() => api<{ category: { name: string }; items: Dish[] }>(`/menu/${SLUG}/prices/`), []);
  const [rows, setRows] = useState<Dish[]>([]);
  const [fill, setFill] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const { msg, setMsg, busy, run } = useRunner();
  useEffect(() => { if (menu.data) setRows(menu.data.items); }, [menu.data]);
  const sections = Array.from(new Set(rows.map((r) => r.section)));
  const edit = (id: number, patch: Partial<Dish>) => { setSaved(""); setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r))); };
  const empty = (r: Dish) => !r.price || Number(r.price) <= 0;
  const fillSection = (section: string) => {
    const value = (fill[section] ?? "").trim();
    if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) { setMsg({ kind: "error", text: "Enter a price above 0 to fill the empty prices." }); return; }
    setMsg(null); setSaved("");
    setRows((all) => all.map((r) => (r.section === section && empty(r) ? { ...r, price: value } : r)));
  };
  const save = async () => {
    setErrors({});
    try {
      await run(async () => {
        try { const res = await api<{ changed: number }>(`/menu/${SLUG}/prices/`, { method: "POST", body: { items: rows.map((r) => ({ id: r.id, price: r.price || "0", published: r.published })) } }); setSaved(res.changed ? `Saved. ${res.changed} dish${res.changed === 1 ? "" : "es"} updated.` : "Nothing to save. Every dish is already up to date."); menu.reload(); }
        catch (e) { if (e instanceof ApiError && e.status === 400) { setErrors(e.fields()); throw new Error("Fix the highlighted dishes and save again. Nothing was saved."); } throw e; }
      }, "Done.");
    } catch { /* shown by run */ }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>QT Eatery menu</Text>
      <Text style={s.muted}>Set a price for each dish and switch on "On sale". Buyers can order a dish only when it has a price and is on sale. The rest still show on the website menu.</Text>
      {menu.error ? <Notice>{menu.error}</Notice> : null}
      {msg && msg.kind === "error" ? <Notice>{msg.text}</Notice> : null}
      {saved ? <Notice kind="ok">{saved}</Notice> : null}
      {menu.data && rows.length === 0 ? <Empty>The menu has not been loaded yet. Run "python manage.py load_qt_eatery_menu" on the api service first.</Empty> : null}
      {rows.length ? <Text style={[s.muted, { marginTop: 8 }]}>{rows.filter((r) => r.published).length} of {rows.length} dishes on sale ({rows[0]?.currency}).</Text> : null}
      {sections.map((section) => (
        <View key={section}>
          <Text style={s.h2}>{section}</Text>
          <Field label="Same price for every empty dish here" value={fill[section] ?? ""} onChangeText={(x) => setFill({ ...fill, [section]: x })} keyboardType="decimal-pad" />
          <Button title="Fill empty prices" tone="quiet" onPress={() => fillSection(section)} />
          {rows.filter((r) => r.section === section).map((r) => (
            <Card key={r.id}>
              <Text style={[s.body, { fontWeight: "700" }]}>{r.name}</Text>
              {errors[String(r.id)] ? <Text style={{ color: color.bad }}>{errors[String(r.id)]}</Text> : null}
              <Field label={`Price (${r.currency})`} value={Number(r.price) > 0 ? r.price : ""} onChangeText={(x) => edit(r.id, { price: x })} keyboardType="decimal-pad" placeholder="0.00" />
              <FieldsForm fields={[{ key: "p", label: "On sale", kind: "bool" }]} vals={{ p: r.published }} setVals={(fn) => edit(r.id, { published: !!fn({ p: r.published }).p })} />
            </Card>
          ))}
        </View>
      ))}
      {rows.length ? <Button title={busy ? "Saving…" : "Save all prices"} busy={busy} onPress={save} /> : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- shipping rules

interface Rate { id: number; zone: number; service_code: string; service_name: string; base_price: string; price_per_kg: string; min_weight_grams: number; max_weight_grams: number | null; eta_days_min: number | null; eta_days_max: number | null; allows_dangerous_goods: boolean; is_active: boolean }
interface Zone { id: number; name: string; countries: string[]; is_active: boolean; rates: Rate[] }
interface Blocked { id: number; country: string; reason: string }

export function ShippingRulesScreen() {
  const { user } = useAuth();
  const canEdit = ["super_admin", "store_admin"].includes(user?.role ?? "");
  const zones = useLoad(() => api<Zone[]>("/shipping/zones/"), []);
  const blocked = useLoad(() => api<Blocked[]>("/shipping/blocked/"), []);
  const { msg, busy, run } = useRunner();
  const [zone, setZone] = useState<Vals>({ name: "", countries: [] });
  const [block, setBlock] = useState<Vals>({ country: "", reason: "" });
  const [rateFor, setRateFor] = useState<number | null>(null);
  const blankRate: Vals = { service_code: "", service_name: "", base_price: "", price_per_kg: "0", min_weight_grams: "0", max_weight_grams: "", eta_days_min: "", eta_days_max: "", dg: false };
  const [rate, setRate] = useState<Vals>(blankRate);
  const both = () => { zones.reload(); blocked.reload(); };
  const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const confirm = (t: string, fn: () => void) => Alert.alert(t, "", [{ text: "Not now", style: "cancel" }, { text: "Yes", style: "destructive", onPress: fn }]);
  const rateFields: FieldDef[] = [
    { key: "service_name", label: "Service name" }, { key: "service_code", label: "Code (letters, no spaces)" }, { key: "base_price", label: "Base price", kind: "decimal" }, { key: "price_per_kg", label: "Per kg", kind: "decimal" },
    { key: "min_weight_grams", label: "From (g)", kind: "int" }, { key: "max_weight_grams", label: "Up to (g)", kind: "int" }, { key: "eta_days_min", label: "Days from", kind: "int" }, { key: "eta_days_max", label: "Days to", kind: "int" },
    { key: "dg", label: "Cleared for dangerous goods", kind: "bool" },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Shipping rules</Text>
      <Text style={s.muted}>Group countries into zones and set the services and prices for each. Customers are only offered services from the zone their address is in. Prices are in the store currency (USD): base price plus the per-kg price for each started kilogram. Until you add a rate here, the simple flat rates are used.</Text>
      {msg ? <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View> : null}
      {!canEdit ? <Notice kind="info">You can view these rules. Only store admins can change them.</Notice> : null}
      {zones.error ? <Notice>{zones.error}</Notice> : null}
      {!zones.data && !zones.error ? <Busy /> : null}
      {zones.data?.map((z) => (
        <Card key={z.id}>
          <Text style={[s.body, { fontWeight: "800" }]}>{z.name}{z.is_active ? "" : " (off)"}</Text>
          <Text style={s.muted}>Countries: {z.countries.join(", ")}</Text>
          {z.rates.map((r) => (
            <View key={r.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: color.line, marginTop: 8 }}>
              <Text style={[s.body, { fontWeight: "700" }]}>{r.service_name}{r.is_active ? "" : " (off)"}</Text>
              <Text style={s.muted}>{r.service_code} · base {r.base_price} · per kg {r.price_per_kg} · {r.min_weight_grams}–{r.max_weight_grams ?? "no limit"} g · {r.eta_days_min ?? "?"}–{r.eta_days_max ?? "?"} days{r.allows_dangerous_goods ? " · dangerous goods ok" : ""}</Text>
              {canEdit ? <>
                <Button title={r.is_active ? "Turn off" : "Turn on"} tone="quiet" onPress={() => run(() => api(`/shipping/rates/${r.id}/`, { method: "PATCH", body: { is_active: !r.is_active } }), "Rate updated.", both)} />
                <Button title="Remove" tone="quiet" onPress={() => confirm("Remove this service?", () => run(() => api(`/shipping/rates/${r.id}/`, { method: "DELETE" }), "Rate removed.", both))} />
              </> : null}
            </View>
          ))}
          {canEdit ? (
            <>
              {rateFor === z.id ? (
                <View style={{ marginTop: 10 }}>
                  <FieldsForm fields={rateFields} vals={rate} setVals={(f) => setRate((p) => f(p))} />
                  <Button title="Add service" busy={busy} onPress={() => run(() => api("/shipping/rates/", { method: "POST", body: { zone: z.id, service_code: rate.service_code, service_name: rate.service_name, base_price: rate.base_price, price_per_kg: rate.price_per_kg, min_weight_grams: Number(rate.min_weight_grams), max_weight_grams: num(rate.max_weight_grams), eta_days_min: num(rate.eta_days_min), eta_days_max: num(rate.eta_days_max), allows_dangerous_goods: !!rate.dg } }), "Service added.", () => { setRate(blankRate); setRateFor(null); both(); })} />
                  <Button title="Cancel" tone="quiet" onPress={() => setRateFor(null)} />
                </View>
              ) : <Button title="Add a service" tone="quiet" onPress={() => { setRate(blankRate); setRateFor(z.id); }} />}
              <Button title={z.is_active ? "Turn zone off" : "Turn zone on"} tone="quiet" onPress={() => run(() => api(`/shipping/zones/${z.id}/`, { method: "PATCH", body: { is_active: !z.is_active } }), "Zone updated.", both)} />
              <Button title="Remove zone" tone="danger" onPress={() => confirm("Remove this zone and its services?", () => run(() => api(`/shipping/zones/${z.id}/`, { method: "DELETE" }), "Zone removed.", both))} />
            </>
          ) : null}
        </Card>
      ))}
      {canEdit ? (
        <>
          <Text style={s.h2}>New zone</Text>
          <Card>
            <Field label="New zone name" value={String(zone.name)} onChangeText={(x) => setZone({ ...zone, name: x })} />
            <CountryList label="Countries in this zone" value={zone.countries} onChange={(c) => setZone({ ...zone, countries: c })} allowAll />
            <Button title="Add zone" busy={busy} onPress={() => { if (!zone.countries.length) return run(() => Promise.reject(new Error("Choose at least one country for this zone.")), ""); return run(() => api("/shipping/zones/", { method: "POST", body: { name: zone.name, countries: zone.countries } }), "Zone added. Now add a service to it.", () => { setZone({ name: "", countries: [] }); both(); }); }} />
          </Card>
        </>
      ) : null}
      <Text style={s.h2}>Countries we don't ship to</Text>
      {blocked.data?.map((b) => (
        <Card key={b.id}>
          <Text style={[s.body, { fontWeight: "700" }]}>{b.country}</Text><Text style={s.muted}>{b.reason}</Text>
          {canEdit ? <Button title="Unblock" tone="quiet" onPress={() => run(() => api(`/shipping/blocked/${b.id}/`, { method: "DELETE" }), "Country unblocked.", both)} /> : null}
        </Card>
      ))}
      {blocked.data && blocked.data.length === 0 ? <Text style={s.muted}>None.</Text> : null}
      {canEdit ? (
        <Card>
          <FieldsForm fields={[{ key: "country", label: "Country", kind: "country" }, { key: "reason", label: "Reason" }]} vals={block} setVals={(f) => setBlock((p) => f(p))} />
          <Button title="Block country" busy={busy} onPress={() => run(() => api("/shipping/blocked/", { method: "POST", body: { country: block.country, reason: block.reason } }), "Country blocked.", () => { setBlock({ country: "", reason: "" }); both(); })} />
        </Card>
      ) : null}
    </ScrollView>
  );
}
