import { useCallback, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
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

export function Button({ title, onPress, disabled, kind = "primary" }: { title: string; onPress: () => void; disabled?: boolean; kind?: "primary" | "quiet" | "danger" }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, kind === "quiet" && s.btnQuiet, kind === "danger" && s.btnDanger, disabled && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.btnText, kind === "quiet" && { color: color.teal }]}>{title}</Text>
    </Pressable>
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

export function Busy({ what }: { what?: string }) {
  const { t } = usePrefs();
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <ActivityIndicator color={color.teal} />
      <Text style={{ color: color.muted, marginTop: 8 }}>{what ?? t("m.loading")}…</Text>
    </View>
  );
}

export function Art({ seed, height = 120 }: { seed: string; height?: number }) {
  const c = stripes(seed);
  return (
    <View style={{ height, flexDirection: "row" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {c.map((col, i) => <View key={i} style={{ flex: i % 3 === 0 ? 2 : 1, backgroundColor: col }} />)}
    </View>
  );
}

/** A product photo, saved on the phone after the first load; the striped pattern shows when there is none or it fails. */
export function Photo({ photo, seed, name, height = 120 }: { photo: ProductPhoto | null; seed: string; name: string; height?: number }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return <Art seed={seed} height={height} />;
  return (
    <Image
      source={{ uri: photo.image }}
      style={{ height, width: "100%", backgroundColor: color.cotton }}
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
  btn: { backgroundColor: color.teal, borderRadius: 4, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", minHeight: 48, justifyContent: "center" },
  btnQuiet: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.line },
  btnDanger: { backgroundColor: color.bad },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  label: { fontWeight: "600", color: color.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#9AA0BA", borderRadius: 4, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: color.ink, minHeight: 46 },
  fieldError: { color: color.bad, marginTop: 4, fontSize: 13 },
  notice: { backgroundColor: "#fff", borderLeftWidth: 4, padding: 12, marginBottom: 12, borderRadius: 4 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: color.line, borderRadius: 4, marginBottom: 12, overflow: "hidden" },
  cardPad: { padding: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { alignSelf: "flex-start", backgroundColor: "#E3F1EF", color: color.ink, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: "700", overflow: "hidden" },
  choice: { backgroundColor: "#fff", borderWidth: 2, borderColor: color.line, borderRadius: 4, padding: 12, marginBottom: 8 },
  choiceOn: { borderColor: color.teal },
});
