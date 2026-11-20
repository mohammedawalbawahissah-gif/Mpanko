import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { color, type } from "./theme";

export function Button({ title, onPress, disabled, tone = "primary", busy }: { title: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "quiet" | "danger"; busy?: boolean }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={[s.btn, tone === "quiet" && s.btnQuiet, tone === "danger" && s.btnDanger, off && { opacity: 0.55 }]}
    >
      {busy ? <ActivityIndicator color={tone === "quiet" ? color.teal : "#fff"} /> : <Text style={[s.btnText, tone === "quiet" && { color: color.teal }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={color.muted} style={s.input} {...props} />
    </View>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  const tone = kind === "ok" ? color.ok : kind === "info" ? color.teal : color.bad;
  return (
    <View accessibilityRole="alert" style={[s.notice, { borderColor: tone }]}>
      <Text style={{ color: tone, fontSize: type.sm, fontWeight: "600" }}>{children}</Text>
    </View>
  );
}

export function Pill({ text, tone }: { text: string; tone?: "ok" | "warn" | "bad" }) {
  const bg = tone === "ok" ? "#DDF3EA" : tone === "bad" ? "#FBE3E8" : tone === "warn" ? "#FFF1CC" : color.wash;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: type.xs, fontWeight: "700", color: color.ink }}>{text}</Text>
    </View>
  );
}

export function Card({ children, onPress, label }: { children: ReactNode; onPress?: () => void; label?: string }) {
  if (!onPress) return <View style={s.card}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.card, pressed && { backgroundColor: color.cotton }]}>
      {children}
    </Pressable>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text style={{ color: color.muted, textAlign: "center", padding: 32, fontSize: type.md }}>{children}</Text>;
}

export function Busy() {
  return <ActivityIndicator accessibilityLabel="Loading" color={color.teal} style={{ margin: 32 }} />;
}

export const s = StyleSheet.create({
  btn: { backgroundColor: color.teal, borderRadius: 12, minHeight: 48, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", marginVertical: 6 },
  btnQuiet: { backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.teal },
  btnDanger: { backgroundColor: color.bad },
  btnText: { color: "#fff", fontWeight: "800", fontSize: type.md },
  label: { fontSize: type.sm, fontWeight: "700", color: color.ink, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: color.field, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, fontSize: type.md, color: color.ink, backgroundColor: "#fff" },
  notice: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 14, backgroundColor: "#fff" },
  card: { backgroundColor: color.paper, borderRadius: 14, borderWidth: 1, borderColor: color.line, padding: 14, marginBottom: 10 },
  h1: { fontSize: type.xl, fontWeight: "800", color: color.ink, marginBottom: 8 },
  h2: { fontSize: type.lg, fontWeight: "800", color: color.ink, marginTop: 18, marginBottom: 8 },
  muted: { fontSize: type.sm, color: color.muted },
  body: { fontSize: type.md, color: color.ink },
});
