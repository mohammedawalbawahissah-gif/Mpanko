import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { api } from "./api";
import { ApiError } from "./api";
import { useAuth } from "./auth";
import { Button, Input, Notice, s } from "./ui";

export function AccountScreen() {
  const { user, logout, login, register } = useAuth();
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErrors({});
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        const f = e.fields();
        setErrors(f);
        setMsg({ kind: "error", text: f.detail || f.non_field_errors || (Object.keys(f).length ? "Check the highlighted fields." : e.message) });
      } else setMsg({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.pad}>
        <Text style={s.h1}>Your account</Text>
        <Text style={{ fontWeight: "700" }}>{user.full_name}</Text>
        <Text style={s.muted}>{user.email}</Text>
        {!user.email_verified && (
          <View style={{ marginTop: 12 }}>
            <Notice kind="info">Your email isn't verified yet.</Notice>
            <Button title="Send verification email" kind="quiet" onPress={() => run(async () => {
              await api("/auth/verify-email/request/", { method: "POST", body: {} });
              setMsg({ kind: "ok", text: "Verification email sent. Check your inbox." });
            })} />
          </View>
        )}
        {msg && <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View>}
        <View style={{ height: 16 }} />
        <Button title="Sign out" kind="quiet" onPress={logout} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{mode === "in" ? "Sign in" : mode === "up" ? "Create your account" : "Reset your password"}</Text>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {mode === "up" && <Input label="Full name" value={name} onChangeText={setName} error={errors.full_name} autoComplete="name" />}
      <Input label="Email" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      {mode !== "forgot" && <Input label={mode === "up" ? "Password (at least 8 characters)" : "Password"} value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoCapitalize="none" />}
      {mode === "in" && <Button title={busy ? "Signing in…" : "Sign in"} disabled={busy} onPress={() => run(() => login(email, password))} />}
      {mode === "up" && <Button title={busy ? "Creating account…" : "Create account"} disabled={busy} onPress={() => run(() => register(email, password, name))} />}
      {mode === "forgot" && <Button title={busy ? "Sending…" : "Send reset link"} disabled={busy} onPress={() => run(async () => {
        await api("/auth/password-reset/", { method: "POST", body: { email } });
        setMsg({ kind: "ok", text: `If an account exists for ${email}, we've sent a link to reset the password.` });
      })} />}
      <View style={{ height: 12 }} />
      {mode !== "in" && <Button title="I already have an account" kind="quiet" onPress={() => { setMode("in"); setMsg(null); }} />}
      {mode === "in" && <Button title="Create an account" kind="quiet" onPress={() => { setMode("up"); setMsg(null); }} />}
      {mode === "in" && <View style={{ marginTop: 8 }}><Button title="Forgot your password?" kind="quiet" onPress={() => { setMode("forgot"); setMsg(null); }} /></View>}
    </ScrollView>
  );
}
