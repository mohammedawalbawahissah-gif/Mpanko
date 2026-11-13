import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { Alert, Field } from "./components";
import type { Address } from "./types";

export const COUNTRIES: [string, string][] = [
  ["GH", "Ghana"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["NG", "Nigeria"],
  ["KE", "Kenya"], ["ZA", "South Africa"], ["CI", "Côte d'Ivoire"], ["SN", "Senegal"], ["TG", "Togo"],
  ["BJ", "Benin"], ["BF", "Burkina Faso"], ["TZ", "Tanzania"], ["UG", "Uganda"], ["RW", "Rwanda"],
  ["EG", "Egypt"], ["MA", "Morocco"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"],
  ["IE", "Ireland"], ["IT", "Italy"], ["ES", "Spain"], ["SE", "Sweden"], ["NO", "Norway"],
  ["AU", "Australia"], ["NZ", "New Zealand"], ["AE", "United Arab Emirates"], ["JP", "Japan"],
  ["BR", "Brazil"],
];

const EMPTY = { label: "", recipient_name: "", phone: "", line1: "", line2: "", city: "", region: "", postal_code: "", country: "GH", is_default: false };

export function AddressForm({ onSaved, onCancel }: { onSaved: (a: Address) => void; onCancel?: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setGeneral("");
    try {
      const saved = await api<Address>("/auth/addresses/", { method: "POST", body: form });
      setForm(EMPTY);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields());
        setGeneral(Object.keys(err.fields()).length ? "Check the highlighted fields." : err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      {general && <Alert>{general}</Alert>}
      <div className="row2">
        <Field id="a-name" label="Full name" error={errors.recipient_name}>
          <input id="a-name" className="input" autoComplete="name" value={form.recipient_name} onChange={(e) => set("recipient_name", e.target.value)} required />
        </Field>
        <Field id="a-phone" label="Phone number for the courier" error={errors.phone}>
          <input id="a-phone" className="input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} required />
        </Field>
      </div>
      <Field id="a-country" label="Country" error={errors.country}>
        <select id="a-country" className="select" style={{ width: "100%" }} value={form.country} onChange={(e) => set("country", e.target.value)}>
          {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </Field>
      <Field id="a-l1" label="Street address" error={errors.line1}>
        <input id="a-l1" className="input" autoComplete="address-line1" value={form.line1} onChange={(e) => set("line1", e.target.value)} required />
      </Field>
      <Field id="a-l2" label="Apartment, landmark or directions (optional)" error={errors.line2}>
        <input id="a-l2" className="input" autoComplete="address-line2" value={form.line2} onChange={(e) => set("line2", e.target.value)} />
      </Field>
      <div className="row2">
        <Field id="a-city" label="Town or city" error={errors.city}>
          <input id="a-city" className="input" autoComplete="address-level2" value={form.city} onChange={(e) => set("city", e.target.value)} required />
        </Field>
        <Field id="a-region" label="Region or state" error={errors.region}>
          <input id="a-region" className="input" autoComplete="address-level1" value={form.region} onChange={(e) => set("region", e.target.value)} />
        </Field>
      </div>
      <Field id="a-post" label="Postal code (if your country uses one)" error={errors.postal_code}>
        <input id="a-post" className="input" autoComplete="postal-code" value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save address"}</button>
        {onCancel && <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
