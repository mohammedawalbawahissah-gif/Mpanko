import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "./api";
import { fieldHints, type AddressRules } from "./core/addressRules";
import { usePrefs } from "./prefs";
import type { Address } from "./types";
import { Button, Input, Select, useCountryOptions } from "./ui";

export const BLANK = { recipient_name: "", phone: "", country: "GH", line1: "", line2: "", city: "", region: "", postal_code: "" };

/** `local` keeps the address on the phone instead of saving it to an account (guest checkout). */
export function AddressForm({ onSaved, onCancel, local = false }: { onSaved: (a: Address) => void; onCancel?: () => void; local?: boolean }) {
  const [f, setF] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof BLANK) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const [rules, setRules] = useState<AddressRules | null>(null);
  const cc = f.country.toUpperCase();
  useEffect(() => {
    if (cc.length !== 2) return;
    let cancelled = false;
    api<AddressRules>(`/auth/address-rules/?country=${cc}`).then((r) => !cancelled && setRules(r)).catch(() => !cancelled && setRules(null));
    return () => { cancelled = true; };
  }, [cc]);
  const hints = fieldHints(rules);
  const countryOptions = useCountryOptions(f.country);
  const { t } = usePrefs();
  const save = async () => {
    setErrors({});
    if (local) {
      const missing: Record<string, string> = {};
      if (!f.recipient_name.trim()) missing.recipient_name = t("m.errName");
      if (!f.phone.trim()) missing.phone = t("m.errPhone");
      if (f.country.trim().length !== 2) missing.country = t("m.errCountry");
      if (!f.line1.trim()) missing.line1 = t("m.errStreet");
      if (!f.city.trim()) missing.city = t("m.errCity");
      if (Object.keys(missing).length) return setErrors(missing);
      return onSaved({ id: 0, ...f, country: f.country.toUpperCase(), is_default: false });
    }
    setBusy(true);
    try {
      onSaved(await api<Address>("/auth/addresses/", { method: "POST", body: { ...f, country: f.country.toUpperCase() } }));
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields());
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Input label={t("m.fullName")} value={f.recipient_name} onChangeText={set("recipient_name")} error={errors.recipient_name} autoComplete="name" />
      <Input label={t("m.phoneCourier")} value={f.phone} onChangeText={set("phone")} error={errors.phone} keyboardType="phone-pad" />
      <Select label={t("m.countryCode")} value={f.country} options={countryOptions} onChange={(v) => { set("country")(v); set("region")(""); }} error={errors.country} />
      <Input label={t("m.street")} value={f.line1} onChangeText={set("line1")} error={errors.line1} />
      <Input label={t("m.line2")} value={f.line2} onChangeText={set("line2")} error={errors.line2} />
      <Input label={t("m.city")} value={f.city} onChangeText={set("city")} error={errors.city} />
      {rules?.regions?.length ? <Select label={hints.regionLabel} value={f.region} options={rules.regions.map((r) => ({ value: r, label: r }))} onChange={set("region")} error={errors.region} /> : <Input label={hints.regionLabel} value={f.region} onChangeText={set("region")} error={errors.region} />}
      {hints.showPostal && <Input label={t(hints.postalLabel)} placeholder={hints.postalPlaceholder} value={f.postal_code} onChangeText={set("postal_code")} error={errors.postal_code} autoCapitalize="characters" />}
      <Button title={busy ? t("m.saving") : t("m.saveAddress")} disabled={busy} onPress={save} />
      {onCancel && <View style={{ height: 8 }} />}
      {onCancel && <Button title={t("common.cancel")} kind="quiet" onPress={onCancel} />}
    </View>
  );
}
