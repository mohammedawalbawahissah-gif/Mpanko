import { useState } from "react";
import { Alert, Linking, ScrollView, Share, Switch, Text, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { api, ApiError, BASE } from "./api";
import type { RootParams } from "./screens-buy";
import { useAuth } from "./auth";
import { color } from "./theme";
import { usePrefs } from "./prefs";
import { Button, Input, Notice, WhatsAppButton, s } from "./ui";

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
        setMsg({ kind: "error", text: f.detail || f.non_field_errors || (Object.keys(f).length ? t("m.checkFields") : e.message) });
      } else setMsg({ kind: "error", text: e instanceof Error ? e.message : t("m.wrong") });
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
            <Notice kind="info">{t("m.emailNotVerified")}</Notice>
            <Button title={t("m.sendVerification")} kind="quiet" onPress={() => run(async () => {
              await api("/auth/verify-email/request/", { method: "POST", body: {} });
              setMsg({ kind: "ok", text: t("m.verificationSent") });
            })} />
          </View>
        )}
        {msg && <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View>}
        <View style={{ height: 16 }} />
        <Button title={t("prefs.title")} onPress={() => nav.navigate("Profile")} />
        <View style={{ height: 8 }} />
        <Button title={t("m.helpSupport")} kind="quiet" onPress={() => nav.navigate("SupportList")} />
        <View style={{ height: 8 }} />
        <WhatsAppButton />
        <View style={{ height: 8 }} />
        <Button title={t("nav.signOut")} kind="quiet" onPress={logout} />

        <Text style={s.h2}>{t("m.yourData")}</Text>
        <Text style={s.muted}>{t("m.dataIntro")}</Text>
        <View style={{ height: 8 }} />
        <Button title={t("m.shareData")} kind="quiet" onPress={() => run(async () => {
          const data = await api<unknown>("/me/export/");
          await Share.share({ title: t("m.myData"), message: JSON.stringify(data, null, 2) });
        })} />
        <View style={{ height: 8 }} />
        {deleting ? (
          <View>
            <Notice kind="info">{t("m.deleteWarn")}</Notice>
            <Input label={t("m.confirmPassword")} value={delPw} onChangeText={setDelPw} error={errors.password} secureTextEntry autoCapitalize="none" />
            <Button title={busy ? t("m.deleting") : t("m.deleteAccount")} kind="danger" disabled={busy || !delPw} onPress={() => run(async () => {
              await api("/me/delete/", { method: "POST", body: { password: delPw } });
              Alert.alert(t("m.accountDeleted"), t("m.accountDeletedBody"));
              await logout();
            })} />
            <View style={{ height: 8 }} />
            <Button title={t("m.keepAccount")} kind="quiet" onPress={() => { setDeleting(false); setDelPw(""); }} />
          </View>
        ) : (
          <Button title={t("m.deleteAccount")} kind="quiet" onPress={() => setDeleting(true)} />
        )}
        <View style={{ height: 8 }} />
        <Button title={t("m.privacyPolicy")} kind="quiet" onPress={() => Linking.openURL(`${webUrl}/privacy`)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{mode === "in" ? t("login.title") : mode === "phone" ? t("m.signInCodeTitle") : mode === "up" ? t("register.title") : t("m.resetTitle")}</Text>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {mode === "phone" && (
        <View>
          <Input label={t("phone.number")} value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" editable={!codeSent} />
          {codeSent && <Input label={t("phone.code")} value={code} onChangeText={setCode} error={errors.code} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />}
          <Button
            title={busy ? "…" : codeSent ? t("login.submit") : t("login.sendCode")}
            disabled={busy || !phone.trim() || (codeSent && code.length < 6)}
            onPress={() => run(async () => {
              if (!codeSent) {
                await requestPhoneCode(phone);
                setCodeSent(true);
                setMsg({ kind: "ok", text: t("m.codeOnWay") });
              } else await loginWithPhone(phone, code);
            })}
          />
          <Text style={[s.muted, { marginTop: 8 }]}>{t("m.onlyVerified")}</Text>
        </View>
      )}
      {mode === "up" && <Input label={t("register.name")} value={name} onChangeText={setName} error={errors.full_name} autoComplete="name" />}
      {mode !== "phone" && <Input label={t("login.email")} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />}
      {mode !== "forgot" && mode !== "phone" && <Input label={mode === "up" ? t("register.password") : t("login.password")} value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoCapitalize="none" />}
      {mode === "in" && <Button title={busy ? t("login.submitting") : t("login.submit")} disabled={busy} onPress={() => run(() => login(email, password))} />}
      {mode === "up" && (
        <View>
          <View style={[s.row, { marginBottom: 6 }]}>
            <Text style={{ flex: 1 }} onPress={() => setAgree(!agree)}>{t("register.agree")} {t("register.terms")} {t("register.and")} {t("register.privacy")}</Text>
            <Switch accessibilityLabel={t("m.acceptTermsPrivacy")} value={agree} onValueChange={setAgree} />
          </View>
          <Text style={{ color: color.teal, marginBottom: 10 }} onPress={() => Linking.openURL(`${webUrl}/terms`)}>{t("m.readTerms")}</Text>
          {!!errors.accept_terms && <Text style={s.fieldError}>{errors.accept_terms}</Text>}
          <View style={[s.row, { marginBottom: 14 }]}>
            <Text style={{ flex: 1 }} onPress={() => setMarketing(!marketing)}>{t("register.marketing")}</Text>
            <Switch accessibilityLabel={t("register.marketing")} value={marketing} onValueChange={setMarketing} />
          </View>
          <Button title={busy ? t("register.creating") : t("register.create")} disabled={busy || !agree} onPress={() => run(() => register(email, password, name, marketing))} />
        </View>
      )}
      {mode === "forgot" && <Button title={busy ? t("m.sending") : t("m.sendReset")} disabled={busy} onPress={() => run(async () => {
        await api("/auth/password-reset/", { method: "POST", body: { email } });
        setMsg({ kind: "ok", text: t("m.resetSent", { email }) });
      })} />}
      <View style={{ height: 12 }} />
      {mode !== "in" && <Button title={t("m.alreadyHave")} kind="quiet" onPress={() => { setMode("in"); setMsg(null); }} />}
      {mode === "in" && <Button title={t("login.create")} kind="quiet" onPress={() => { setMode("up"); setMsg(null); }} />}
      {mode === "in" && <View style={{ marginTop: 8 }}><Button title={t("m.signInSms")} kind="quiet" onPress={() => { setMode("phone"); setMsg(null); setCodeSent(false); setCode(""); }} /></View>}
      {mode === "in" && <View style={{ marginTop: 8 }}><Button title={t("login.forgot")} kind="quiet" onPress={() => { setMode("forgot"); setMsg(null); }} /></View>}
    </ScrollView>
  );
}
