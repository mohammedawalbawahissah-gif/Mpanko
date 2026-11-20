import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { errText } from "./hooks";
import { bodyFrom, Chooser, FieldsForm, initialVals, SearchBox, SortButtons, type Vals } from "./kit";
import { GROUPS, byKey, navFor, type Action, type Row } from "./core/resources";
import { Busy, Button, Card, Empty, Field, Notice, Pill, s } from "./ui";

type Msg = { kind: "ok" | "error"; text: string } | null;
const rowsOf = (d: unknown): Row[] => (Array.isArray(d) ? d : ((d as { results?: Row[] } | null)?.results ?? []));
const nextOf = (d: unknown): string | null => ((d as { next?: string | null } | null)?.next ?? null);

/** The "More" tab: every section the person's role can open, grouped as on the web. */
export function MoreScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { user, logout } = useAuth();
  const items = navFor(user?.role ?? "");
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g);
        if (!list.length) return null;
        return (
          <View key={g}>
            <Text style={s.h2} accessibilityRole="header">{g}</Text>
            {list.map((i) => (
              <Card key={i.key} label={i.name} onPress={() => (i.res ? nav.navigate("List", { res: i.res }) : nav.navigate(i.screen!))}>
                <Text style={[s.body, { fontWeight: "700" }]}>{i.name}</Text>
              </Card>
            ))}
          </View>
        );
      })}
      <Text style={s.h2} accessibilityRole="header">You</Text>
      <Card label="Alerts and sign-in" onPress={() => nav.navigate("Me")}><Text style={[s.body, { fontWeight: "700" }]}>How you are told, and sign out</Text></Card>
      <Button title="Sign out" tone="quiet" onPress={logout} />
    </ScrollView>
  );
}

/** A list of one kind of thing, with its filters and search, as the matching page on the web. */
export function ListScreen({ route }: { route: { params: { res: string } } }) {
  const res = byKey(route.params.res)!;
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { user } = useAuth();
  const role = user?.role ?? "";
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries((res.filters ?? []).map((f) => [f.param, f.def ?? ""])));
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [searchIn, setSearchIn] = useState("");
  const [sort, setSort] = useState(res.sorts?.[0]?.value ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const qs = useMemo(() => {
    const p: string[] = [];
    for (const [k, v] of Object.entries(filters)) if (v) p.push(`${k}=${encodeURIComponent(v)}`);
    if (res.sorts && sort) p.push(`ordering=${sort}`);
    if (res.search && applied) p.push(`${res.search.param}=${encodeURIComponent(applied)}`);
    if (res.search && applied && searchIn) p.push(`search_in=${searchIn}`);
    if (res.dates && from) p.push(`${res.dates.from}=${from}`);
    if (res.dates && to) p.push(`${res.dates.to}=${to}`);
    return p.length ? `?${p.join("&")}` : "";
  }, [filters, applied, searchIn, sort, from, to, res]);
  const load = useCallback(async () => {
    try {
      const d = await api<unknown>(`${res.path}${qs}`);
      setData(rowsOf(d)); setNext(nextOf(d)); setError("");
    } catch (e) { setError(errText(e)); }
  }, [res.path, qs]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { nav.setOptions({ title: res.title }); }, [nav, res.title]);
  const more = async () => {
    if (!next) return;
    try {
      const path = next.replace(/^https?:\/\/[^/]+\/api\/v1/, "");
      const d = await api<unknown>(path);
      setData((cur) => [...(cur ?? []), ...rowsOf(d)]); setNext(nextOf(d));
    } catch (e) { setError(errText(e)); }
  };
  const canEdit = (res.editRoles ?? res.roles).includes(role);
  useEffect(() => { if (res.single) nav.replace("Record", { res: res.key, id: "profile" }); }, [res.single, res.key, nav]);
  if (res.single) return <Busy />;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      data={data ?? []}
      keyExtractor={(r) => res.idOf(r)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      onEndReached={more}
      ListHeaderComponent={
        <>
          {res.intro ? <Text style={[s.muted, { marginBottom: 12 }]}>{res.intro}</Text> : null}
          {res.create && canEdit ? <Button title={res.create.label} onPress={() => nav.navigate("Record", { res: res.key, id: "new" })} /> : null}
          {(res.filters ?? []).map((f) => <Chooser key={f.param} label={f.label} value={filters[f.param]} options={f.options} onPick={(v) => setFilters((p) => ({ ...p, [f.param]: v }))} />)}
          {res.search ? (
            <SearchBox label={res.search.label} value={q} onChange={setQ} field={searchIn} onField={setSearchIn} fields={res.search.fields ?? [{ value: "", label: "Everything" }]} onSubmit={() => setApplied(q.trim())} />
          ) : null}
          {res.sorts ? <SortButtons value={sort} options={res.sorts} onChange={setSort} /> : null}
          {res.dates ? (
            <View>
              <Field label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} autoCapitalize="none" placeholder="YYYY-MM-DD" />
              <Field label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            </View>
          ) : null}
          {error ? <Notice>{error}</Notice> : null}
        </>
      }
      ListEmptyComponent={data ? <Empty>{res.empty}</Empty> : <Busy />}
      renderItem={({ item }) => {
        const pill = res.pill?.(item);
        return (
          <Card onPress={() => nav.navigate("Record", { res: res.key, id: res.idOf(item) })} label={res.rowTitle(item)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
              <Text style={[s.body, { fontWeight: "800", flex: 1 }]}>{res.rowTitle(item)}</Text>
              {res.rowSide ? <Text style={s.muted}>{res.rowSide(item)}</Text> : null}
            </View>
            {res.rowSub ? <Text style={s.muted}>{res.rowSub(item)}</Text> : null}
            {pill ? <View style={{ marginTop: 6 }}><Pill text={pill.text} tone={pill.tone} /></View> : null}
          </Card>
        );
      }}
    />
  );
}

/** Add, view, change, act on and remove one record: the matching detail page and form on the web. */
export function RecordScreen({ route }: { route: { params: { res: string; id: string } } }) {
  const res = byKey(route.params.res)!;
  const id = route.params.id;
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { user } = useAuth();
  const role = user?.role ?? "";
  const isNew = id === "new";
  const [row, setRow] = useState<Row | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vals, setVals] = useState<Vals>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(isNew);
  const fields = res.fields ?? [];
  const canEdit = (res.editRoles ?? res.roles).includes(role);

  const load = useCallback(async () => {
    if (isNew) { setVals({ ...initialVals(fields), ...(res.create?.defaults ?? {}) }); return; }
    try {
      const r = res.detail ? await api<Row>(res.detail(id)) : res.single ? await api<Row>(res.path) : rowsOf(await api<unknown>(`${res.path}?page_size=200`)).find((x) => res.idOf(x) === id) ?? null;
      if (!r) { setMsg({ kind: "error", text: "That item was not found." }); return; }
      setRow(r);
      setVals(initialVals(fields, { ...r, ...(res.prefill?.(r) ?? {}) }));
      if (res.single) setEditing(true);
    } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  }, [id, isNew, res]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { nav.setOptions({ title: isNew ? res.create?.label ?? res.title : row ? res.rowTitle(row) : res.title }); }, [nav, isNew, row, res]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 400) { setErrors(e.fields()); setMsg({ kind: "error", text: e.fields().non_field_errors || e.fields().detail || "Fix the highlighted fields and save again." }); }
    else setMsg({ kind: "error", text: errText(e) });
  };
  const save = async () => {
    setMsg(null); setErrors({});
    const problem = res.check?.(vals);
    if (problem) { setMsg({ kind: "error", text: problem }); return; }
    setBusy(true);
    try {
      const mode = isNew ? "create" : "edit";
      const built = bodyFrom(fields, res.toBody ? { ...vals, ...res.toBody(vals, mode, row ?? undefined) } : vals, res.update?.blanks);
      const useForm = res.multipart || built.hasFile;
      const body = useForm ? built.form : { ...built.json };
      const path = isNew ? res.create?.path ?? res.path : res.update!.path(row ?? {});
      await api(path, { method: isNew ? "POST" : res.update!.method, body });
      if (res.single) { setMsg({ kind: "ok", text: "Saved." }); load(); }
      else nav.goBack();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = () => {
    if (!res.remove || !row) return;
    Alert.alert(res.remove.label, res.remove.confirm, [{ text: "Not now", style: "cancel" }, { text: "Yes", style: "destructive", onPress: async () => {
      try { await api(res.remove!.path(row), { method: "DELETE" }); nav.goBack(); } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
    } }]);
  };

  if (!row && !isNew) return <ScrollView contentContainerStyle={{ padding: 16 }}>{msg ? <Notice>{msg.text}</Notice> : <Busy />}</ScrollView>;
  const lines = row && res.lines ? res.lines(row) : [];
  const blocks = row && res.blocks ? res.blocks(row) : [];
  const pill = row ? res.pill?.(row) : undefined;
  const actions = (res.actions ?? []).filter((a) => row && (!a.show || a.show(row, role)));
  const mayChange = canEdit && !!res.update && !isNew;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {!isNew && row ? <><Text style={s.h1}>{res.rowTitle(row)}</Text>{res.rowSub && !res.single ? <Text style={s.muted}>{res.rowSub(row)}</Text> : null}{pill ? <View style={{ marginTop: 6 }}><Pill text={pill.text} tone={pill.tone} /></View> : null}</> : null}
      {res.single && res.intro ? <Text style={[s.muted, { marginBottom: 8 }]}>{res.intro}</Text> : null}
      {msg ? <View style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></View> : null}
      {lines.length > 0 ? <View style={{ marginTop: 12 }}><Card>{lines.map(([k, v]) => <View key={k} style={{ paddingVertical: 4 }}><Text style={s.muted}>{k}</Text><Text style={s.body} selectable>{v}</Text></View>)}</Card></View> : null}
      {blocks.filter((b) => b.lines.length).map((b) => (
        <View key={b.title}>
          <Text style={s.h2}>{b.title}</Text>
          <Card>{b.lines.map((l, i) => <Text key={i} style={[s.body, { paddingVertical: 4 }]} selectable>{l}</Text>)}</Card>
        </View>
      ))}
      {actions.length ? <Text style={s.h2}>Actions</Text> : null}
      {actions.map((a) => <ActionBox key={a.label} a={a} row={row!} onDone={(text, leave) => { setMsg({ kind: "ok", text }); if (leave) nav.goBack(); else load(); }} onError={(t) => setMsg({ kind: "error", text: t })} />)}
      {(isNew || (mayChange && editing) || res.single) && fields.length ? (
        <View style={{ marginTop: 8 }}>
          {!isNew && !res.single ? <Text style={s.h2}>Change</Text> : null}
          <FieldsForm fields={fields} vals={vals} setVals={setVals} errors={errors} images={row ? { logo: row.logo_url, image: row.image_url } : undefined} />
          <Button title={busy ? "Saving…" : res.update?.label ?? (isNew ? res.create?.label ?? "Save" : "Save changes")} busy={busy} onPress={save} />
        </View>
      ) : null}
      {mayChange && !editing && !res.single ? <Button title="Edit" onPress={() => setEditing(true)} /> : null}
      {canEdit && res.remove && row ? <Button title={res.remove.label} tone="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

function ActionBox({ a, row, onDone, onError }: { a: Action; row: Row; onDone: (text: string, leave: boolean) => void; onError: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Vals>(() => initialVals(a.fields ?? [], row));
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const problem = a.check?.(vals);
    if (problem) { onError(problem); return; }
    setBusy(true);
    try {
      const body = a.body ? a.body(vals, row) : vals;
      const method = a.method ?? "POST";
      const res = await api<unknown>(a.path(row), method === "GET" ? {} : { method, body });
      onDone(typeof a.done === "function" ? a.done(res, row) : a.done ?? "Done.", !!a.leave);
      setOpen(false);
    } catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  const go = () => {
    if (a.fields?.length && !open) { setOpen(true); return; }
    if (a.confirm) Alert.alert(a.label, a.confirm, [{ text: "Not now", style: "cancel" }, { text: "Yes", onPress: run }]);
    else run();
  };
  return (
    <View style={{ marginBottom: 4 }}>
      {open ? <Card><FieldsForm fields={a.fields ?? []} vals={vals} setVals={setVals} /></Card> : null}
      <Button title={open ? `${a.label}` : a.label} tone={a.tone ?? "primary"} busy={busy} onPress={go} />
      {open ? <Button title="Cancel" tone="quiet" onPress={() => setOpen(false)} /> : null}
    </View>
  );
}
