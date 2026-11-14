import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { api, ApiError, type Page } from "./api";
import { useAuth } from "./auth";
import { fieldHints, type AddressRules } from "./core/addressRules";
import { LANGUAGES } from "./core/i18n";
import { searchCurrencies } from "./core/money";
import { usePrefs } from "./prefs";
import { disablePush, enablePush } from "./push";
import { color } from "./theme";
import type { Address, User } from "./types";
import { Busy, Button, Input, Notice, Select, s, useAsync, useCountryOptions } from "./ui";
import type { MessageKey } from "./core/i18n";

type Msg = { kind: "ok" | "error"; text: string } | null;

function errorText(e: unknown, t: (k: MessageKey) => string): { text: string; fields: Record<string, string> } {
  if (e instanceof ApiError) {
    const f = e.fields();
    return { text: f.detail || (Object.keys(f).length ? t("m.checkFields") : e.message), fields: f };
  }
  return { text: e instanceof Error ? e.message : t("m.wrong"), fields: {} };
}

/** Profile, phone verification, display and notification preferences, and saved addresses (FR-PRF). */
export function ProfileScreen() {
  const { user, refreshUser } = useAuth();
  const { t, lang, setLang, currency, setCurrency, rates } = usePrefs();
  const [name, setName] = useState(user?.full_name ?? "");
  const [orderEmails, setOrderEmails] = useState(user?.notify_order_emails ?? true);
  const [sms, setSms] = useState(user?.notify_sms ?? false);
  const [whatsapp, setWhatsapp] = useState(user?.notify_whatsapp ?? false);
  const [push, setPush] = useState(user?.notify_push ?? false);
  const [marketing, setMarketing] = useState(user?.marketing_opt_in ?? false);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  // The phone is only offered a text-message switch once it has been verified.
  const verified = !!user?.phone_verified;

  const save = async () => {
    setBusy(true);
    setErrors({});
    setMsg(null);
    try {
      await api("/auth/me/", {
        method: "PATCH",
        body: { full_name: name, notify_order_emails: orderEmails, notify_sms: verified && sms, notify_whatsapp: verified && whatsapp, marketing_opt_in: marketing, preferred_currency: currency },
      });
      await refreshUser();
      setMsg({ kind: "ok", text: t("prefs.saved") });
    } catch (e) {
      const { text, fields } = errorText(e, t);
      setErrors(fields);
      setMsg({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  };

  const togglePush = async (on: boolean) => {
    setMsg(null);
    try {
      if (on) {
        if (await enablePush()) setPush(true);
        else setMsg({ kind: "error", text: t("m.notifBlocked") });
      } else {
        await disablePush();
        setPush(false);
      }
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e, t).text });
    }
  };

  if (!user) return <View style={[s.screen, s.pad]}><Text style={s.muted}>{t("m.signInTab")}</Text></View>;
  const matches = searchCurrencies(rates, search);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{t("prefs.title")}</Text>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Text style={s.h2}>{t("prefs.details")}</Text>
      <Text style={s.muted}>{user.email}</Text>
      <View style={{ height: 8 }} />
      <Input label={t("prefs.name")} value={name} onChangeText={setName} error={errors.full_name} autoComplete="name" />
      <PhoneVerify />

      <Text style={s.h2}>{t("prefs.display")}</Text>
      <Text style={s.label}>{t("prefs.currency")}</Text>
      <Text style={{ color: color.ink, marginBottom: 6 }}>{currency ? `${currency}${rates?.names?.[currency] ? ` · ${rates.names[currency]}` : ""}` : t("prefs.currencyStore")}</Text>
      <Input label={t("prefs.currencySearch")} value={search} onChangeText={setSearch} autoCapitalize="none" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {matches.map((c) => (
          <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: currency === c }} onPress={() => setCurrency(c)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: currency === c ? color.teal : "#fff", borderWidth: 1, borderColor: color.line }}>
            <Text style={{ color: currency === c ? "#fff" : color.ink, fontWeight: "600" }}>{c}</Text>
          </Pressable>
        ))}
        {!!currency && <Button title={t("prefs.currencyStore")} kind="quiet" onPress={() => setCurrency("")} />}
      </View>
      <Text style={s.label}>{t("prefs.language")}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {LANGUAGES.map((l) => <Button key={l.code} title={l.label} kind={lang === l.code ? "primary" : "quiet"} onPress={() => setLang(l.code)} />)}
      </View>

      <Text style={s.h2}>{t("prefs.notifications")}</Text>
      <Toggle label={t("prefs.orderEmails")} value={orderEmails} onChange={setOrderEmails} />
      <Toggle label={t("prefs.sms")} value={verified && sms} onChange={setSms} disabled={!verified} hint={verified ? undefined : t("prefs.smsNeedsNumber")} />
      <Toggle label={t("prefs.whatsapp")} value={verified && whatsapp} onChange={setWhatsapp} disabled={!verified} hint={verified ? undefined : t("prefs.smsNeedsNumber")} />
      <Toggle label={t("prefs.push")} value={push} onChange={togglePush} />
      <Toggle label={t("prefs.marketing")} value={marketing} onChange={setMarketing} />

      <View style={{ height: 8 }} />
      <Button title={busy ? "…" : t("prefs.save")} disabled={busy} onPress={save} />

      <Addresses />
    </ScrollView>
  );
}

function Toggle({ label, value, onChange, disabled, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={s.row}>
        <Text style={{ flex: 1, color: color.ink }} onPress={() => !disabled && onChange(!value)}>{label}</Text>
        <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} />
      </View>
      {!!hint && <Text style={[s.muted, { fontSize: 13 }]}>{hint}</Text>}
    </View>
  );
}

function PhoneVerify() {
  const { user, refreshUser } = useAuth();
  const { t } = usePrefs();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    setErrors({});
    try {
      await fn();
    } catch (e) {
      const { text, fields } = errorText(e, t);
      setErrors(fields);
      setMsg({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ marginTop: 4 }}>
      <Input label={t("phone.number")} value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" editable={!sent} />
      <Text style={[s.muted, { marginBottom: 8 }]}>{user?.phone_verified && !sent ? t("m.phoneVerifiedLine") : t("m.phoneNotVerifiedLine")}</Text>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {sent && <Input label={t("phone.code")} value={code} onChangeText={setCode} error={errors.code} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />}
      <Button
        title={busy ? "…" : sent ? t("phone.confirm") : t("phone.send")}
        kind="quiet"
        disabled={busy || !phone.trim() || (sent && code.length < 6)}
        onPress={() => run(async () => {
          if (!sent) {
            await api("/auth/phone/verify/", { method: "POST", body: { phone } });
            setSent(true);
          } else {
            await api("/auth/phone/verify/confirm/", { method: "POST", body: { phone, code } });
            setSent(false);
            setCode("");
            await refreshUser();
            setMsg({ kind: "ok", text: t("phone.done") });
          }
        })}
      />
    </View>
  );
}

const BLANK = { recipient_name: "", phone: "", line1: "", line2: "", city: "", region: "", postal_code: "", country: "GH" };

function Addresses() {
  const { t } = usePrefs();
  const list = useAsync(() => api<Page<Address>>("/auth/addresses/"), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(BLANK);
  const [rules, setRules] = useState<AddressRules | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof BLANK) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const country = f.country.toUpperCase();

  useEffect(() => {
    if (country.length !== 2) return;
    let cancelled = false;
    api<AddressRules>(`/auth/address-rules/?country=${country}`).then((r) => !cancelled && setRules(r)).catch(() => !cancelled && setRules(null));
    return () => { cancelled = true; };
  }, [country]);
  const hints = fieldHints(rules);
  const countryOptions = useCountryOptions(f.country);

  const add = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api("/auth/addresses/", { method: "POST", body: { ...f, country } });
      setF(BLANK);
      setAdding(false);
      list.reload();
    } catch (e) {
      setErrors(errorText(e, t).fields);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Text style={s.h2}>{t("prefs.addresses")}</Text>
      {list.loading && <Busy />}
      {list.data?.results.length === 0 && !adding && <Text style={s.muted}>{t("prefs.noAddresses")}</Text>}
      {list.data?.results.map((a) => (
        <View key={a.id} style={[s.card, s.cardPad]}>
          <Text style={{ fontWeight: "700", color: color.ink }}>{a.recipient_name}</Text>
          <Text style={{ color: color.ink }}>{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}{a.region ? `, ${a.region}` : ""} {a.postal_code}, {a.country}</Text>
          <Text style={s.muted}>{a.phone}</Text>
          <Button title={t("prefs.remove")} kind="quiet" onPress={async () => { await api(`/auth/addresses/${a.id}/`, { method: "DELETE" }); list.reload(); }} />
        </View>
      ))}
      {adding ? (
        <View>
          <Input label={t("m.fullName")} value={f.recipient_name} onChangeText={set("recipient_name")} error={errors.recipient_name} autoComplete="name" />
          <Input label={t("m.phoneCourier")} value={f.phone} onChangeText={set("phone")} error={errors.phone} keyboardType="phone-pad" />
          <Select label={t("m.countryCode")} value={f.country} options={countryOptions} onChange={(v) => { set("country")(v); set("region")(""); }} error={errors.country} />
          <Input label={t("m.street")} value={f.line1} onChangeText={set("line1")} error={errors.line1} />
          <Input label={t("m.line2")} value={f.line2} onChangeText={set("line2")} error={errors.line2} />
          <Input label={t("m.city")} value={f.city} onChangeText={set("city")} error={errors.city} />
          {rules?.regions?.length ? <Select label={hints.regionLabel} value={f.region} options={rules.regions.map((r) => ({ value: r, label: r }))} onChange={set("region")} error={errors.region} /> : <Input label={hints.regionLabel} value={f.region} onChangeText={set("region")} error={errors.region} />}
          {hints.showPostal && <Input label={t(hints.postalLabel)} placeholder={hints.postalPlaceholder} value={f.postal_code} onChangeText={set("postal_code")} error={errors.postal_code} autoCapitalize="characters" />}
          <Button title={busy ? "…" : t("prefs.save")} disabled={busy} onPress={add} />
          <View style={{ height: 8 }} />
          <Button title={t("common.cancel")} kind="quiet" onPress={() => { setAdding(false); setErrors({}); }} />
        </View>
      ) : (
        <Button title={t("prefs.addAddress")} kind="quiet" onPress={() => setAdding(true)} />
      )}
    </View>
  );
}

export type { User };
