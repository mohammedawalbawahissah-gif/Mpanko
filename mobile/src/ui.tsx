import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
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

export function Button({ title, onPress, disabled, kind = "primary" }: { title: string; onPress: () => void; disabled?: boolean; kind?: "primary" | "quiet" | "danger" }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, kind === "quiet" && s.btnQuiet, kind === "danger" && s.btnDanger, disabled && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.btnText, kind === "quiet" && { color: color.indigo }]}>{title}</Text>
    </Pressable>
  );
}

export function Input({ label, error, secureTextEntry, ...props }: TextInputProps & { label: string; error?: string }) {
  const [hidden, setHidden] = useState(true);
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
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            style={{ position: "absolute", right: 0, top: 0, bottom: 0, paddingHorizontal: 14, justifyContent: "center" }}
          >
            <Text style={{ color: color.indigo, fontWeight: "700" }}>{hidden ? "Show" : "Hide"}</Text>
          </Pressable>
        )}
      </View>
      {!!error && <Text style={s.fieldError}>{error}</Text>}
    </View>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  const c = kind === "error" ? color.bad : kind === "ok" ? color.ok : color.indigo;
  return (
    <View accessibilityRole="alert" style={[s.notice, { borderLeftColor: c }]}>
      <Text style={{ color: color.ink }}>{children}</Text>
    </View>
  );
}

export function Busy({ what = "Loading" }: { what?: string }) {
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <ActivityIndicator color={color.indigo} />
      <Text style={{ color: color.muted, marginTop: 8 }}>{what}…</Text>
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

export function Pill({ value }: { value: string }) {
  const bad = ["failed", "cancelled", "expired", "exception", "declined"].includes(value);
  const good = ["paid", "delivered", "succeeded"].includes(value);
  return (
    <Text style={[s.pill, good && { backgroundColor: "#D6EFE5", color: "#075A40" }, bad && { backgroundColor: "#F9D9E0", color: "#8E0F2B" }]}>
      {statusLabel(value)}
    </Text>
  );
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
  btn: { backgroundColor: color.indigo, borderRadius: 4, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", minHeight: 48, justifyContent: "center" },
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
  pill: { alignSelf: "flex-start", backgroundColor: "#E7E9F3", color: color.ink, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: "700", overflow: "hidden" },
  choice: { backgroundColor: "#fff", borderWidth: 2, borderColor: color.line, borderRadius: 4, padding: 12, marginBottom: 8 },
  choiceOn: { borderColor: color.indigo },
});
