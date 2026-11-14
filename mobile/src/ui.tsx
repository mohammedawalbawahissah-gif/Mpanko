import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type RefreshControlProps, type TextInputProps } from "react-native";
import { api } from "./api";
import { ALL_COUNTRIES } from "./core/countries";
import { fetchWithCache } from "./core/cache";
import type { MessageKey } from "./core/i18n";
import { photoLabel, type ProductPhoto } from "./core/images";
import { usePrefs } from "./prefs";
import { color, stripes } from "./theme";

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

/** "Email us", "Call us" and "Chat on WhatsApp". Each opens the right app and shows once the shop has set its details; while developing, placeholders stand in so the layout can be checked. (Keeps its old name because every screen already uses it.) */
export function WhatsAppButton({ onDark }: { onDark?: boolean } = {}) {
  const kind = onDark ? "light" : "quiet";
  const { t } = usePrefs();
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    api<{ whatsapp_number?: string; support_phone?: string; support_email?: string }>("/config/")
      .then((c) => {
        setNumber((c.whatsapp_number ?? "").replace(/\D/g, ""));
        setPhone((c.support_phone ?? "").trim());
        setEmail((c.support_email ?? "").trim());
      })
      .catch(() => undefined);
  }, []);
  const mail = email || (__DEV__ ? "help@mpanko.example" : "");
  const dial = phone || (__DEV__ ? "+233 00 000 0000" : "");
  const wa = number || (__DEV__ ? "233000000000" : "");
  return (
    <>
      {!!mail && <Button title={`${t("footer.email")}: ${mail}`} kind={kind} onPress={() => Linking.openURL(`mailto:${mail}`)} />}
      {!!dial && <Button title={`${t("footer.call")}: ${dial}`} kind={kind} onPress={() => Linking.openURL(`tel:${dial.replace(/[^+\d]/g, "")}`)} />}
      {!!wa && <Button title={t("footer.whatsapp")} kind={kind} onPress={() => Linking.openURL(`https://wa.me/${wa}`)} />}
    </>
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
export function FormScreen({ children, refreshControl }: { children: ReactNode; refreshControl?: ReactElement<RefreshControlProps> }) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.pad, { paddingBottom: 40 }]}
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
  h1: { fontSize: 26, fontWeight: "800", color: color.ink, marginBottom: 12 },
  h2: { fontSize: 18, fontWeight: "700", color: color.ink, marginTop: 20, marginBottom: 8 },
  muted: { color: color.muted },
  btn: { backgroundColor: color.ink, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", minHeight: 48, justifyContent: "center" },
  btnQuiet: { backgroundColor: "transparent", borderWidth: 2, borderColor: color.ink },
  btnDanger: { backgroundColor: color.bad },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  label: { fontWeight: "600", color: color.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#9AA0BA", borderRadius: 10, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: color.ink, minHeight: 46 },
  fieldError: { color: color.bad, marginTop: 4, fontSize: 13 },
  notice: { backgroundColor: "#fff", borderLeftWidth: 4, padding: 12, marginBottom: 12, borderRadius: 10 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: color.line, borderRadius: 14, marginBottom: 12, overflow: "hidden" },
  cardPad: { padding: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { alignSelf: "flex-start", backgroundColor: "#E3F1EF", color: color.ink, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: "700", overflow: "hidden" },
  choice: { backgroundColor: "#fff", borderWidth: 2, borderColor: color.line, borderRadius: 12, padding: 12, marginBottom: 8 },
  choiceOn: { borderColor: color.ink },
});
