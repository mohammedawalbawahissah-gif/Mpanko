import { useState } from "react";
import { Alert, Linking, ScrollView, Share, Switch, Text, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { api, ApiError, BASE } from "./api";
import type { RootParams } from "./screens-buy";
import { useAuth } from "./auth";
import { color } from "./theme";
import { usePrefs } from "./prefs";
import { Button, Input, Notice, s } from "./ui";

const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? BASE.replace(/\/api\/v1\/?$/, "").replace(":8000", ":5173");

export function AccountScreen() {
  const { user, logout, login, register, requestPhoneCode, loginWithPhone } = useAuth();
  const { t } = usePrefs();
  const nav = useNavigation<NavigationProp<RootParams>>();
  const [agree, setAgree] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "phone">("in");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
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
        <Text style={s.h1}>{t("account.profile")}</Text>
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
        <Button title={t("prefs.title")} onPress={() => nav.navigate("Profile")} />
        <View style={{ height: 8 }} />
        <Button title="Help and support" kind="quiet" onPress={() => nav.navigate("SupportList")} />
        <View style={{ height: 8 }} />
        <Button title="Sign out" kind="quiet" onPress={logout} />

        <Text style={s.h2}>Your data</Text>
        <Text style={s.muted}>Get a copy of everything we hold about you, or delete your account. Order records stay, without your personal details.</Text>
        <View style={{ height: 8 }} />
        <Button title="Share a copy of my data" kind="quiet" onPress={() => run(async () => {
          const data = await api<unknown>("/me/export/");
          await Share.share({ title: "My Mpanko data", message: JSON.stringify(data, null, 2) });
        })} />
        <View style={{ height: 8 }} />
        {deleting ? (
          <View>
            <Notice kind="info">Deleting your account can't be undone.</Notice>
            <Input label="Enter your password to confirm" value={delPw} onChangeText={setDelPw} error={errors.password} secureTextEntry autoCapitalize="none" />
            <Button title={busy ? "Deleting…" : "Delete my account"} kind="danger" disabled={busy || !delPw} onPress={() => run(async () => {
              await api("/me/delete/", { method: "POST", body: { password: delPw } });
              Alert.alert("Account deleted", "Your account and personal details have been removed.");
              await logout();
            })} />
            <View style={{ height: 8 }} />
            <Button title="Keep my account" kind="quiet" onPress={() => { setDeleting(false); setDelPw(""); }} />
          </View>
        ) : (
          <Button title="Delete my account" kind="quiet" onPress={() => setDeleting(true)} />
        )}
        <View style={{ height: 8 }} />
        <Button title="Privacy policy" kind="quiet" onPress={() => Linking.openURL(`${webUrl}/privacy`)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{mode === "in" ? "Sign in" : mode === "phone" ? "Sign in with a code" : mode === "up" ? "Create your account" : "Reset your password"}</Text>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {mode === "phone" && (
        <View>
          <Input label="Mobile number" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" editable={!codeSent} />
          {codeSent && <Input label="Code from the SMS" value={code} onChangeText={setCode} error={errors.code} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />}
          <Button
            title={busy ? "…" : codeSent ? "Sign in" : "Send code"}
            disabled={busy || !phone.trim() || (codeSent && code.length < 6)}
            onPress={() => run(async () => {
              if (!codeSent) {
                await requestPhoneCode(phone);
                setCodeSent(true);
                setMsg({ kind: "ok", text: "If that number is verified on an account, a code is on its way." });
              } else await loginWithPhone(phone, code);
            })}
          />
          <Text style={[s.muted, { marginTop: 8 }]}>Only numbers you have verified in your profile can sign in this way.</Text>
        </View>
      )}
      {mode === "up" && <Input label="Full name" value={name} onChangeText={setName} error={errors.full_name} autoComplete="name" />}
      {mode !== "phone" && <Input label="Email" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />}
      {mode !== "forgot" && mode !== "phone" && <Input label={mode === "up" ? "Password (at least 8 characters)" : "Password"} value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoCapitalize="none" />}
      {mode === "in" && <Button title={busy ? "Signing in…" : "Sign in"} disabled={busy} onPress={() => run(() => login(email, password))} />}
      {mode === "up" && (
        <View>
          <View style={[s.row, { marginBottom: 6 }]}>
            <Text style={{ flex: 1 }} onPress={() => setAgree(!agree)}>I accept the terms of sale and privacy policy</Text>
            <Switch accessibilityLabel="Accept terms and privacy policy" value={agree} onValueChange={setAgree} />
          </View>
          <Text style={{ color: color.indigo, marginBottom: 10 }} onPress={() => Linking.openURL(`${webUrl}/terms`)}>Read the terms</Text>
          {!!errors.accept_terms && <Text style={s.fieldError}>{errors.accept_terms}</Text>}
          <View style={[s.row, { marginBottom: 14 }]}>
            <Text style={{ flex: 1 }} onPress={() => setMarketing(!marketing)}>Send me news and offers (optional)</Text>
            <Switch accessibilityLabel="Send me news and offers" value={marketing} onValueChange={setMarketing} />
          </View>
          <Button title={busy ? "Creating account…" : "Create account"} disabled={busy || !agree} onPress={() => run(() => register(email, password, name, marketing))} />
        </View>
      )}
      {mode === "forgot" && <Button title={busy ? "Sending…" : "Send reset link"} disabled={busy} onPress={() => run(async () => {
        await api("/auth/password-reset/", { method: "POST", body: { email } });
        setMsg({ kind: "ok", text: `If an account exists for ${email}, we've sent a link to reset the password.` });
      })} />}
      <View style={{ height: 12 }} />
      {mode !== "in" && <Button title="I already have an account" kind="quiet" onPress={() => { setMode("in"); setMsg(null); }} />}
      {mode === "in" && <Button title="Create an account" kind="quiet" onPress={() => { setMode("up"); setMsg(null); }} />}
      {mode === "in" && <View style={{ marginTop: 8 }}><Button title="Sign in with a text-message code" kind="quiet" onPress={() => { setMode("phone"); setMsg(null); setCodeSent(false); setCode(""); }} /></View>}
      {mode === "in" && <View style={{ marginTop: 8 }}><Button title="Forgot your password?" kind="quiet" onPress={() => { setMode("forgot"); setMsg(null); }} /></View>}
    </ScrollView>
  );
}
