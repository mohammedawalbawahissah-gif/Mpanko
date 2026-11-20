import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Image, Modal, Pressable, Switch, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api } from "./api";
import { ALL_COUNTRIES, countryName } from "./core/countries";
import { color, type } from "./theme";
import { Button, Field, s } from "./ui";

export type Opt = { value: string; label: string };
export type Vals = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Kind = "text" | "area" | "int" | "decimal" | "bool" | "select" | "countries" | "country" | "image" | "email" | "url" | "phone" | "datetime" | "date";
export interface FieldDef {
  key: string;
  label: string;
  kind?: Kind;
  options?: Opt[];
  optionsFrom?: { path: string; value?: string; label?: string; blank?: string };
  required?: boolean;
  hint?: string;
  placeholder?: string;
  allowAll?: boolean;
  show?: (v: Vals) => boolean;
  /** Left out of the saved body (for example fields only used to build other fields). */
  local?: boolean;
}
export interface Pick { uri: string; name: string; type: string }
export type ImageVal = Pick | "remove" | null | undefined;

const rows = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : ((d as { results?: T[] } | null)?.results ?? []));

/** Loads the choices a field gets from the server (categories, carriers, businesses...). */
export function useChoices(from: FieldDef["optionsFrom"]): Opt[] | null {
  const [opts, setOpts] = useState<Opt[] | null>(null);
  useEffect(() => {
    if (!from) return;
    let live = true;
    api<unknown>(from.path)
      .then((d) => live && setOpts(rows<Record<string, unknown>>(d).map((r) => ({ value: String(r[from.value ?? "id"]), label: String(r[from.label ?? "name"]) }))))
      .catch(() => live && setOpts([]));
    return () => { live = false; };
  }, [from?.path, from?.value, from?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  return opts;
}

/** A tap-to-open list, with search, for choosing one thing (or adding to a list of things). */
export function Chooser({ label, value, options, onPick, placeholder, error, hint, showSearch }: { label: string; value: string; options: Opt[]; onPick: (v: string) => void; placeholder?: string; error?: string; hint?: string; showSearch?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())), [options, q]);
  const current = options.find((o) => o.value === value)?.label;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current ?? placeholder ?? "choose"}`} onPress={() => setOpen(true)} style={[s.input, { justifyContent: "center" }]}>
        <Text style={{ color: current ? color.ink : color.muted, fontSize: type.md }}>{current ?? placeholder ?? "Choose"}</Text>
      </Pressable>
      {!!hint && <Text style={[s.muted, { marginTop: 4 }]}>{hint}</Text>}
      {!!error && <Text style={{ color: color.bad, marginTop: 4, fontSize: type.sm }}>{error}</Text>}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: color.cotton, paddingTop: 48 }}>
          <View style={{ padding: 16 }}>
            <Text style={s.h1}>{label}</Text>
            {(showSearch ?? options.length > 12) && <TextInput accessibilityLabel="Search" placeholder="Search" placeholderTextColor={color.muted} value={q} onChangeText={setQ} style={s.input} autoCapitalize="none" />}
          </View>
          <FlatList
            data={shown}
            keyExtractor={(o) => o.value}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => { onPick(item.value); setOpen(false); setQ(""); }} style={[s.card, { minHeight: 48, justifyContent: "center", borderColor: item.value === value ? color.teal : color.line }]}>
                <Text style={s.body}>{item.label}</Text>
              </Pressable>
            )}
          />
          <View style={{ padding: 16 }}><Button title="Close" tone="quiet" onPress={() => { setOpen(false); setQ(""); }} /></View>
        </View>
      </Modal>
    </View>
  );
}

const EVERYWHERE: Opt = { value: "*", label: "Everywhere else" };
const COUNTRY_OPTS: Opt[] = ALL_COUNTRIES.map(([value, label]) => ({ value, label }));

/** Pick several countries; the chosen ones show as tags that can be removed. */
export function CountryList({ label, value, onChange, allowAll, error, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; allowAll?: boolean; error?: string; hint?: string }) {
  const name = (c: string) => (c === "*" ? EVERYWHERE.label : countryName(c));
  const opts = [...(allowAll && !value.includes("*") ? [EVERYWHERE] : []), ...COUNTRY_OPTS.filter((o) => !value.includes(o.value))];
  return (
    <View>
      {value.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {value.map((c) => (
            <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Remove ${name(c)}`} onPress={() => onChange(value.filter((x) => x !== c))} style={{ backgroundColor: color.wash, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: "center" }}>
              <Text style={{ color: color.ink, fontWeight: "700" }}>{name(c)}  ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Chooser label={label} value="" options={opts} placeholder={value.length ? "Add another country" : "Add a country"} onPick={(v) => onChange([...value, v])} error={error} hint={hint} showSearch />
    </View>
  );
}

/** Choose a photo from the phone's library. */
export function ImagePick({ label, value, current, onChange, error, hint }: { label: string; value: ImageVal; current?: string | null; onChange: (v: ImageVal) => void; error?: string; hint?: string }) {
  const [note, setNote] = useState("");
  const choose = async () => {
    setNote("");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setNote("Allow photo access in your phone settings to choose a picture."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    if (a.fileSize && a.fileSize > 5 * 1024 * 1024) { setNote("That photo is over 5 MB. Choose a smaller one."); return; }
    const type = a.mimeType ?? "image/jpeg";
    onChange({ uri: a.uri, name: a.fileName ?? `photo.${type.split("/")[1] ?? "jpg"}`, type });
  };
  const shown = value && value !== "remove" ? value.uri : value === "remove" ? null : current;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      {shown ? <Image accessibilityIgnoresInvertColors source={{ uri: shown }} style={{ width: "100%", height: 160, borderRadius: 12, backgroundColor: color.wash, marginBottom: 8 }} resizeMode="cover" /> : null}
      <Button title={shown ? "Choose a different photo" : "Choose a photo"} tone="quiet" onPress={choose} />
      {shown ? <Button title="Remove photo" tone="quiet" onPress={() => onChange(value && value !== "remove" ? null : "remove")} /> : null}
      {!!hint && <Text style={s.muted}>{hint}</Text>}
      {!!note && <Text style={{ color: color.bad }}>{note}</Text>}
      {!!error && <Text style={{ color: color.bad }}>{error}</Text>}
    </View>
  );
}

function Check({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}>
        <Text style={[s.body, { flex: 1 }]} onPress={() => onChange(!value)}>{label}</Text>
        <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: color.teal, false: color.field }} />
      </View>
      {!!hint && <Text style={s.muted}>{hint}</Text>}
    </View>
  );
}

function ChoiceField({ f, v, set, error }: { f: FieldDef; v: Vals; set: (k: string, x: unknown) => void; error?: string }) {
  const loaded = useChoices(f.optionsFrom);
  const opts = [...(f.optionsFrom?.blank !== undefined ? [{ value: "", label: f.optionsFrom.blank }] : []), ...(f.options ?? loaded ?? [])];
  return <Chooser label={f.label} value={String(v[f.key] ?? "")} options={opts} onPick={(x) => set(f.key, x)} error={error} hint={f.hint} placeholder={loaded === null && f.optionsFrom ? "Loading…" : undefined} />;
}

/** One screen of form fields, driven by a list of field definitions. */
export function FieldsForm({ fields, vals, setVals, errors, images }: { fields: FieldDef[]; vals: Vals; setVals: (fn: (p: Vals) => Vals) => void; errors?: Record<string, string>; images?: Record<string, string | null | undefined> }): ReactNode {
  const set = (k: string, x: unknown) => setVals((p) => ({ ...p, [k]: x }));
  return (
    <>
      {fields.filter((f) => !f.show || f.show(vals)).map((f) => {
        const err = errors?.[f.key];
        const kind = f.kind ?? "text";
        if (kind === "bool") return <Check key={f.key} label={f.label} value={!!vals[f.key]} onChange={(x) => set(f.key, x)} hint={f.hint} />;
        if (kind === "select") return <ChoiceField key={f.key} f={f} v={vals} set={set} error={err} />;
        if (kind === "country") return <Chooser key={f.key} label={f.label} value={String(vals[f.key] ?? "")} options={[...(f.allowAll ? [EVERYWHERE] : []), ...COUNTRY_OPTS]} onPick={(x) => set(f.key, x)} error={err} hint={f.hint} placeholder="Choose a country" showSearch />;
        if (kind === "countries") return <CountryList key={f.key} label={f.label} value={vals[f.key] ?? []} onChange={(x) => set(f.key, x)} allowAll={f.allowAll} error={err} hint={f.hint} />;
        if (kind === "image") return <ImagePick key={f.key} label={f.label} value={vals[f.key]} current={images?.[f.key]} onChange={(x) => set(f.key, x)} error={err} hint={f.hint} />;
        const numeric = kind === "int" ? "number-pad" : kind === "decimal" ? "decimal-pad" : kind === "email" ? "email-address" : kind === "phone" ? "phone-pad" : kind === "url" ? "url" : "default";
        return (
          <View key={f.key}>
            <Field label={f.label + (f.required ? "" : "")} value={String(vals[f.key] ?? "")} onChangeText={(x) => set(f.key, x)} keyboardType={numeric} autoCapitalize={kind === "text" || kind === "area" ? "sentences" : "none"} multiline={kind === "area"} placeholder={f.placeholder ?? (kind === "datetime" ? "YYYY-MM-DDTHH:MM" : kind === "date" ? "YYYY-MM-DD" : undefined)} style={kind === "area" ? [s.input, { minHeight: 110, textAlignVertical: "top", paddingTop: 12 }] : undefined} />
            {!!f.hint && <Text style={[s.muted, { marginTop: -8, marginBottom: 12 }]}>{f.hint}</Text>}
            {!!err && <Text style={{ color: color.bad, marginTop: -8, marginBottom: 12, fontSize: type.sm }}>{err}</Text>}
          </View>
        );
      })}
    </>
  );
}

/** Values to start a form with. */
export function initialVals(fields: FieldDef[], row?: Vals | null): Vals {
  const v: Vals = {};
  for (const f of fields) {
    const k = f.kind ?? "text";
    const cur = row?.[f.key];
    if (k === "bool") v[f.key] = cur ?? false;
    else if (k === "countries") v[f.key] = Array.isArray(cur) ? cur : [];
    else if (k === "image") v[f.key] = null;
    else if (k === "datetime") v[f.key] = typeof cur === "string" ? cur.slice(0, 16) : "";
    else v[f.key] = cur === null || cur === undefined ? "" : String(cur);
  }
  return v;
}

/** The request body for a form: JSON normally, multipart when a photo is attached or changed. */
export function bodyFrom(fields: FieldDef[], vals: Vals, blanks: "keep" | "null" = "keep"): { json: Vals; form: FormData; hasFile: boolean } {
  const json: Vals = {};
  const form = new FormData();
  let multipart = false;
  for (const f of fields) {
    if (f.local || (f.show && !f.show(vals))) continue;
    const k = f.kind ?? "text";
    const v = vals[f.key];
    if (k === "image") {
      if (v && v !== "remove") { form.append(f.key, { uri: v.uri, name: v.name, type: v.type } as unknown as Blob); multipart = true; }
      else if (v === "remove") { form.append(`remove_${f.key}`, "true"); multipart = true; }
      continue;
    }
    let out: unknown = v;
    if (k === "int") out = v === "" || v === null || v === undefined ? (blanks === "null" ? null : "") : Number(v);
    else if (k === "decimal" && v === "" && blanks === "null") out = null;
    else if (k === "datetime" || k === "date") out = v === "" ? null : v;
    else if (k === "select" && v === "" && blanks === "null") out = null;
    json[f.key] = out;
    if (k === "countries") (out as string[]).forEach((c) => form.append(f.key, c));
    else form.append(f.key, typeof out === "boolean" ? String(out) : out === null || out === undefined ? "" : String(out));
  }
  return { json, form, hasFile: multipart };
}

// ---------------------------------------------------------------- search and sort

/** One search bar with a drop-down (on the left) that picks which detail to search by. */
export function SearchBox({ label, value, onChange, field, onField, fields, onSubmit }: {
  label: string; value: string; onChange: (v: string) => void; field: string; onField: (v: string) => void; fields: Opt[]; onSubmit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = fields.find((f) => f.value === field)?.label ?? fields[0]?.label ?? "";
  return (
    <View style={{ marginBottom: 14 }}>
      <View accessibilityRole="search" style={{ flexDirection: "row", alignItems: "stretch" }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Search in: ${shown}`} onPress={() => setOpen(true)}
          style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: "center", backgroundColor: color.wash, borderWidth: 1.5, borderColor: color.field, borderRightWidth: 0, borderTopLeftRadius: 12, borderBottomLeftRadius: 12, maxWidth: "42%" }}>
          <Text numberOfLines={1} style={{ fontWeight: "700", color: color.ink }}>{shown} {"▾"}</Text>
        </Pressable>
        <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={color.muted} returnKeyType="search" autoCapitalize="none" autoCorrect={false}
          value={value} onChangeText={onChange} onSubmitEditing={onSubmit} style={[s.input, { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }]} />
      </View>
      <Button title="Search" tone="quiet" onPress={onSubmit} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 8 }}>
            <Text accessibilityRole="header" style={[s.h2, { padding: 12, marginTop: 0, marginBottom: 0 }]}>Search in</Text>
            {fields.map((f) => (
              <Pressable key={f.value} accessibilityRole="button" accessibilityState={{ selected: f.value === field }} onPress={() => { onField(f.value); setOpen(false); }}
                style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: "center", borderTopWidth: 1, borderTopColor: color.line }}>
                <Text style={{ color: f.value === field ? color.teal : color.ink, fontWeight: f.value === field ? "700" : "400", fontSize: type.md }}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Sort choices as a wrapped row of buttons; the chosen one is filled in. */
export function SortButtons({ label = "Sort by", value, options, onChange }: { label?: string; value: string; options: Opt[]; onChange: (v: string) => void }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
              style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1.5, borderColor: on ? color.ink : color.line, backgroundColor: on ? color.ink : "#fff" }}>
              <Text style={{ color: on ? "#fff" : color.ink, fontWeight: "600" }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
