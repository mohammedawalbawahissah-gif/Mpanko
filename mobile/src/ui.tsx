import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions, type RefreshControlProps, type TextInputProps } from "react-native";
import { Text } from "./text";
import { api } from "./api";
import { ALL_COUNTRIES } from "./core/countries";
import { fetchWithCache } from "./core/cache";
import type { MessageKey } from "./core/i18n";
import { photoLabel, type ProductPhoto } from "./core/images";
import { contactItems, type ContactConfig } from "./core/contacts";
import { layoutFor, READABLE, type Layout } from "./core/layout";
import { usePrefs } from "./prefs";
import { color, font, radius, stripes, type } from "./theme";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const load = useCallback(() => {
    setLoading(true);
    run()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, [run]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

/** Like useAsync, but keeps a saved copy and shows it when the connection is down. `savedAt` is set while showing a saved copy. */
export function useCachedAsync<T>(key: string, fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => fetchWithCache(AsyncStorage, key, fn), [key, ...deps]);
  const load = useCallback(() => {
    setLoading(true);
    run()
      .then((r) => {
        setData(r.data);
        setSavedAt(r.stale ? r.savedAt : null);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, [run]);
  useEffect(load, [load]);
  return { data, error, loading, savedAt, reload: load };
}

/** Pull-to-refresh for a list or scroll view: `<ScrollView refreshControl={pull.control}>`. Shows the spinner only for a pull, not the first load. */
export function usePullRefresh(reload: () => void) {
  const [refreshing, setRefreshing] = useState(false);
  const control = (
    <RefreshControl
      refreshing={refreshing}
      tintColor={color.teal}
      colors={[color.teal]}
      onRefresh={() => {
        setRefreshing(true);
        reload();
        setTimeout(() => setRefreshing(false), 800);
      }}
    />
  );
  return { control };
}

/** Small icons drawn from plain Views (the app has no icon font). Decorative: the button's label is what is read aloud. */
function ContactIcon({ name }: { name: "mail" | "call" | "whatsapp" }) {
  const c = color.ink;
  if (name === "mail") {
    return (
      <View style={{ width: 18, height: 13, borderWidth: 1.8, borderColor: c, borderRadius: 3, overflow: "hidden" }}>
        <View style={{ position: "absolute", top: -6, left: 3.2, width: 9, height: 9, borderRightWidth: 1.8, borderBottomWidth: 1.8, borderColor: c, transform: [{ rotate: "45deg" }] }} />
      </View>
    );
  }
  if (name === "call") {
    return (
      <View style={{ width: 11, height: 18, borderWidth: 1.8, borderColor: c, borderRadius: 3, alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ width: 4, height: 1.8, backgroundColor: c, marginBottom: 1.5 }} />
      </View>
    );
  }
  return (
    <View style={{ width: 18, height: 18, borderWidth: 1.8, borderColor: c, borderRadius: 9, borderBottomLeftRadius: 1, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />
    </View>
  );
}

function ContactChip({ icon, label, name, onPress }: { icon: "mail" | "call" | "whatsapp"; label: string; name: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} hitSlop={6} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: color.ink, opacity: pressed ? 0.7 : 1 })}>
      <ContactIcon name={icon} />
      <Text style={{ color: color.ink, fontWeight: "700", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const KIND_ICON = { email: "mail", phone: "call", whatsapp: "whatsapp" } as const;

/** Compact buttons with icons, one for each contact the shop lists (several phones, WhatsApp numbers and emails are fine). They never show the address or number; each opens the right app.
 * A contact with a name shows the name; one without shows Email, Call or WhatsApp. They show once the shop has set its details; while developing, placeholders stand in. */
export function ContactButtons() {
  const { t } = usePrefs();
  const [config, setConfig] = useState<ContactConfig | null>(null);
  useEffect(() => {
    api<ContactConfig>("/config/").then(setConfig).catch(() => undefined);
  }, []);
  const items = contactItems(config, __DEV__);
  if (!items.length) return null;
  const plain = { email: t("contact.email"), phone: t("contact.call"), whatsapp: t("contact.whatsapp") };
  const spoken = { email: t("footer.email"), phone: t("footer.call"), whatsapp: t("footer.whatsapp") };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 6 }}>
      {items.map((c, i) => (
        <ContactChip key={`${c.kind}-${i}`} icon={KIND_ICON[c.kind]} label={c.label || plain[c.kind]} name={c.label ? `${c.label}, ${spoken[c.kind]}` : spoken[c.kind]} onPress={() => Linking.openURL(c.url)} />
      ))}
    </View>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDay = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

/** A date field: tap it, pick a day from a month calendar. Value is "YYYY-MM-DD", or "" for no date. */
export function DateField({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const start = value ? new Date(`${value}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  const shift = (by: number) => setView((v) => { const d = new Date(v.y, v.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const shown = value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "";
  const close = () => setOpen(false);
  const off = (iso: string) => (!!min && iso < min) || (!!max && iso > max);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${shown || t("orders.anyDate")}`} onPress={() => { const d = value ? new Date(`${value}T00:00:00`) : new Date(); setView({ y: d.getFullYear(), m: d.getMonth() }); setOpen(true); }}
        style={[s.input, { justifyContent: "center" }]}>
        <Text style={{ color: shown ? color.ink : color.muted }}>{shown || t("orders.anyDate")}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: "#fff", padding: 16, paddingTop: 48 }}>
          <Text accessibilityRole="header" style={s.h2}>{label}</Text>
          <View style={[s.row, { marginBottom: 8 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("orders.prevMonth")} hitSlop={10} onPress={() => shift(-1)}><Text style={{ fontSize: 28, color: color.ink, paddingHorizontal: 12 }}>{"\u2039"}</Text></Pressable>
            <Text style={{ flex: 1, textAlign: "center", fontWeight: "700", color: color.ink, fontSize: 16 }}>{new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("orders.nextMonth")} hitSlop={10} onPress={() => shift(1)}><Text style={{ fontSize: 28, color: color.ink, paddingHorizontal: 12 }}>{"\u203A"}</Text></Pressable>
          </View>
          <View style={{ flexDirection: "row" }}>
            {weekdays.map((w, i) => <Text key={i} style={{ flex: 1, textAlign: "center", color: color.muted, fontWeight: "600", paddingVertical: 6 }}>{w}</Text>)}
          </View>
          {weeks.map((wk, i) => (
            <View key={i} style={{ flexDirection: "row" }}>
              {wk.map((d, j) => {
                if (!d) return <View key={j} style={{ flex: 1, height: 44 }} />;
                const iso = isoDay(view.y, view.m, d);
                const on = iso === value;
                const blocked = off(iso);
                return (
                  <Pressable key={j} accessibilityRole="button" accessibilityState={{ selected: on, disabled: blocked }} disabled={blocked}
                    onPress={() => { onChange(iso); close(); }}
                    style={{ flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: on ? color.ink : "transparent", opacity: blocked ? 0.3 : 1 }}>
                    <Text style={{ color: on ? "#fff" : color.ink, fontWeight: on ? "700" : "400" }}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={{ height: 16 }} />
          {!!value && <Button title={t("orders.clearDate")} kind="quiet" onPress={() => { onChange(""); close(); }} />}
          {!!value && <View style={{ height: 8 }} />}
          <Button title={t("common.cancel")} kind="quiet" onPress={close} />
        </View>
      </Modal>
    </View>
  );
}

/** Countries to offer: the shop's launch countries when it has set them, otherwise every country. */
export function useCountryOptions(current?: string): { value: string; label: string }[] {
  const [launch, setLaunch] = useState<string[]>([]);
  useEffect(() => {
    api<{ launch_countries?: string[] }>("/config/").then((c) => setLaunch(c.launch_countries ?? [])).catch(() => undefined);
  }, []);
  return ALL_COUNTRIES.filter(([code]) => !launch.length || launch.includes(code) || code === current).map(([value, label]) => ({ value, label }));
}

/** A pick-from-a-list field: tap it, search if the list is long, tap an item. Use instead of typing codes or names. */
export function Select({ label, value, options, onChange, error, placeholder }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; error?: string; placeholder?: string;
}) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = options.find((o) => o.value === value)?.label ?? (value || "");
  const list = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const close = () => { setOpen(false); setQ(""); };
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${shown || placeholder || t("address.choose")}`} onPress={() => setOpen(true)}
        style={[s.input, { justifyContent: "center" }, error ? { borderColor: color.bad } : null]}>
        <Text style={{ color: shown ? color.ink : color.muted }}>{shown || placeholder || t("address.choose")}</Text>
      </Pressable>
      {!!error && <Text style={{ color: color.bad, marginTop: 4 }}>{error}</Text>}
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "#fff", padding: 16, paddingTop: 48 }}>
          <Text accessibilityRole="header" style={s.h2}>{label}</Text>
          {options.length > 12 && <TextInput accessibilityLabel={t("m.searchList")} placeholder={t("m.searchList")} placeholderTextColor={color.muted} style={s.input} value={q} onChangeText={setQ} autoCapitalize="none" />}
          <FlatList
            data={list}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: item.value === value }} onPress={() => { onChange(item.value); close(); }}
                style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.line }}>
                <Text style={{ color: item.value === value ? color.teal : color.ink, fontWeight: item.value === value ? "700" : "400" }}>{item.label}</Text>
              </Pressable>
            )}
          />
          <Button title={t("common.cancel")} kind="quiet" onPress={close} />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export function Button({ title, onPress, disabled, kind = "primary", label }: { title: string; onPress: () => void; disabled?: boolean; kind?: "primary" | "quiet" | "danger" | "gold" | "light"; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, kind === "quiet" && s.btnQuiet, kind === "danger" && s.btnDanger, kind === "gold" && { backgroundColor: color.gold }, kind === "light" && { backgroundColor: "#fff" }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.btnText, (kind === "quiet" || kind === "gold" || kind === "light") && { color: color.ink }]}>{title}</Text>
    </Pressable>
  );
}

/**
 * A scrolling screen for forms. On iPhone the content lifts and scrolls so the keyboard never covers the
 * field being typed in; on Android the system already resizes the window. Dragging closes the keyboard,
 * and a button tapped while the keyboard is open works on the first tap.
 */
/** The current screen's layout: phone, tablet upright or tablet sideways. It updates when the device is turned. */
export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  return layoutFor(width);
}

/** Keeps reading screens in a comfortable column, centred, on a wide screen. */
export const readable = { width: "100%", maxWidth: READABLE, alignSelf: "center" } as const;

export function FormScreen({ children, refreshControl }: { children: ReactNode; refreshControl?: ReactElement<RefreshControlProps> }) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.pad, readable, { paddingBottom: 40 }]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
}

export function Input({ label, error, secureTextEntry, ...props }: TextInputProps & { label: string; error?: string }) {
  const [hidden, setHidden] = useState(true);
  const { t } = usePrefs();
  const isSecret = !!secureTextEntry;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <View>
        <TextInput
          accessibilityLabel={label}
          style={[s.input, isSecret && { paddingRight: 72 }, error ? { borderColor: color.bad } : null]}
          placeholderTextColor={color.muted}
          secureTextEntry={isSecret && hidden}
          {...props}
        />
        {isSecret && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? t("m.showPassword") : t("m.hidePassword")}
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            style={{ position: "absolute", right: 0, top: 0, bottom: 0, paddingHorizontal: 14, justifyContent: "center" }}
          >
            <Text style={{ color: color.teal, fontWeight: "700" }}>{hidden ? t("m.show") : t("m.hide")}</Text>
          </Pressable>
        )}
      </View>
      {!!error && <Text style={s.fieldError}>{error}</Text>}
    </View>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  const c = kind === "error" ? color.bad : kind === "ok" ? color.ok : color.teal;
  return (
    <View accessibilityRole="alert" style={[s.notice, { borderLeftColor: c }]}>
      <Text style={{ color: color.ink }}>{children}</Text>
    </View>
  );
}

/** An error with a "Try again" button, so a dropped connection is never a dead end. */
export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = usePrefs();
  return (
    <View style={{ marginBottom: 12 }}>
      <Notice>{message}</Notice>
      <View style={{ height: 8 }} />
      <Button title={t("m.tryAgain")} kind="quiet" onPress={onRetry} />
    </View>
  );
}

export function Busy({ what }: { what?: string }) {
  const { t } = usePrefs();
  return (
    <View style={{ padding: 24, alignItems: "center" }} accessible accessibilityRole="progressbar" accessibilityLabel={what ?? t("m.loading")} accessibilityLiveRegion="polite">
      <ActivityIndicator color={color.teal} />
      <Text style={{ color: color.muted, marginTop: 8 }}>{what ?? t("m.loading")}…</Text>
    </View>
  );
}

export function Art({ seed, height = 120, width }: { seed: string; height?: number; width?: number }) {
  const c = stripes(seed);
  return (
    <View style={{ height, width, flexDirection: "row" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {c.map((col, i) => <View key={i} style={{ flex: i % 3 === 0 ? 2 : 1, backgroundColor: col }} />)}
    </View>
  );
}

/** A thin woven band in kente colours, the shop's signature. Decorative only. */
export function KenteBand({ height = 5 }: { height?: number }) {
  const parts = [color.ink, color.gold, color.teal, color.bad, color.teal, color.gold];
  const widths = [26, 8, 26, 6, 26, 8];
  const cells: ReactNode[] = [];
  for (let i = 0; i < 24; i++) cells.push(<View key={i} style={{ width: widths[i % 6], height, backgroundColor: parts[i % 6] }} />);
  return (
    <View style={{ flexDirection: "row", height, overflow: "hidden", backgroundColor: color.ink }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {cells}
    </View>
  );
}

/** A product photo, saved on the phone after the first load; the striped pattern shows when there is none or it fails. */
export function Photo({ photo, seed, name, height = 120, width }: { photo: ProductPhoto | null; seed: string; name: string; height?: number; width?: number }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return <Art seed={seed} height={height} width={width} />;
  return (
    <Image
      source={{ uri: photo.image }}
      style={{ height, width: width ?? "100%", backgroundColor: color.cotton }}
      contentFit="cover"
      cachePolicy="disk"
      transition={150}
      accessibilityLabel={photoLabel(photo, name)}
      onError={() => setFailed(true)}
    />
  );
}

export function Pill({ value }: { value: string }) {
  const { t } = usePrefs();
  const bad = ["failed", "cancelled", "expired", "exception", "declined"].includes(value);
  const good = ["paid", "delivered", "succeeded"].includes(value);
  return (
    <Text style={[s.pill, good && { backgroundColor: "#D6EFE5", color: "#075A40" }, bad && { backgroundColor: "#F9D9E0", color: "#8E0F2B" }]}>
      {statusText(t, value)}
    </Text>
  );
}

/** The status in the shopper's language when we have it, otherwise the readable English form. */
export function statusText(t: (key: MessageKey) => string, v: string): string {
  const key = `status.${v}` as MessageKey;
  const text = t(key);
  return text === key ? statusLabel(v) : text;
}

/** How a payment method is named to the shopper. */
export function methodLabel(t: (key: MessageKey) => string, provider: string, currency: string): string {
  if (provider === "paystack") return currency === "GHS" ? t("checkout.methodMomo") : t("checkout.methodCard");
  if (provider === "hubtel") return `Hubtel (${t("checkout.methodMomo")})`;
  if (provider === "mtn_momo") return "MTN Mobile Money";
  if (provider === "zelle") return "Zelle";
  if (provider === "cashapp") return "Cash App";
  if (provider === "cash") return t("checkout.methodCash");
  if (provider === "mock") return t("m.testPayment");
  return provider;
}

export function statusLabel(v: string): string {
  const t = v.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.cotton },
  pad: { padding: 16 },
  h1: { fontFamily: font.display, fontSize: type.xxl, lineHeight: 32, fontWeight: "800", letterSpacing: -0.6, color: color.ink, marginBottom: 12 },
  h2: { fontFamily: font.display, fontSize: 20, lineHeight: 25, fontWeight: "700", letterSpacing: -0.3, color: color.ink, marginTop: 22, marginBottom: 8 },
  body: { fontSize: type.md, lineHeight: 24, color: color.ink },
  price: { fontFamily: font.display, fontWeight: "700", letterSpacing: -0.3, color: color.ink, fontVariant: ["tabular-nums"] },
  muted: { color: color.muted },
  btn: { backgroundColor: color.ink, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 20, alignItems: "center", minHeight: 50, justifyContent: "center" },
  btnQuiet: { backgroundColor: "transparent", borderWidth: 2, borderColor: color.ink },
  btnDanger: { backgroundColor: color.bad },
  btnText: { color: "#fff", fontWeight: "700", fontSize: type.md },
  label: { fontWeight: "600", fontSize: type.sm, color: color.ink, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: color.field, borderRadius: radius.md, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 11, fontSize: type.md, fontFamily: "PublicSans_400Regular", color: color.ink, minHeight: 48 },
  fieldError: { color: color.bad, marginTop: 4, fontSize: 13, fontWeight: "600" },
  notice: { backgroundColor: "#fff", borderWidth: 1, borderColor: color.line, borderLeftWidth: 4, padding: 12, marginBottom: 12, borderRadius: radius.md },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: color.line, borderRadius: radius.lg, marginBottom: 12, overflow: "hidden" },
  cardPad: { padding: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { alignSelf: "flex-start", backgroundColor: color.wash, color: color.ink, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, fontSize: type.xs, fontWeight: "700", overflow: "hidden" },
  choice: { backgroundColor: "#fff", borderWidth: 2, borderColor: color.line, borderRadius: radius.md, padding: 13, marginBottom: 8 },
  choiceOn: { borderColor: color.ink, backgroundColor: color.sand },
});
