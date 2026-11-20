import { useCallback, useState } from "react";
import { Alert, FlatList, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { label, when } from "./core/format";
import { parseTarget } from "./core/links";
import { enablePush } from "./push";
import { color, type } from "./theme";
import { Busy, Button, Card, Empty, Field, Notice, Pill, s } from "./ui";

const errText = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong. Try again.");
type Rows<T> = T[] | { results: T[] };
const rows = <T,>(d: Rows<T>): T[] => (Array.isArray(d) ? d : d.results);

/** Loads on every visit to the screen and on pull-down. */
function useList<T>(path: string) {
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(rows(await api<Rows<T>>(path)));
      setError("");
    } catch (e) {
      setError(errText(e));
    }
  }, [path]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  return { data, error, refreshing, refresh, reload: load };
}

// ---- sign in -----------------------------------------------------------------------------------------------

export function LoginScreen() {
  const { start, verify } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [enroll, setEnroll] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const signIn = () => run(async () => {
    const step = await start(email.trim(), password);
    if (step.kind === "code") setTicket(step.ticket);
    if (step.kind === "enroll") setEnroll(true);
  });
  const sendCode = () => run(() => verify(ticket, code.trim()));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.cotton }}>
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.h1, { marginTop: 32 }]}>Mpanko Admin</Text>
        <Text style={[s.muted, { marginBottom: 24 }]}>Store alerts, orders and payments for staff.</Text>
        {error ? <Notice>{error}</Notice> : null}
        {enroll ? (
          <>
            <Notice kind="info">Your account needs a second sign-in step before you can use this app. Sign in once on the Mpanko admin website, set up your authenticator there, then come back.</Notice>
            <Button title="Back" tone="quiet" onPress={() => setEnroll(false)} />
          </>
        ) : ticket ? (
          <>
            <Text style={[s.body, { marginBottom: 12 }]}>Enter the 6-digit code from your authenticator app, or a backup code.</Text>
            <Field label="Code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={10} />
            <Button title="Verify" onPress={sendCode} busy={busy} disabled={code.trim().length < 6} />
            <Button title="Start again" tone="quiet" onPress={() => { setTicket(""); setCode(""); }} />
          </>
        ) : (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
            <Button title="Sign in" onPress={signIn} busy={busy} disabled={!email.trim() || !password} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- alerts ------------------------------------------------------------------------------------------------

interface AlertRow { id: number; key: string; title: string; body: string; path: string; is_read: boolean; created_at: string }

export function AlertsScreen() {
  const nav = useNavigation<any>();
  const { data, error, refreshing, refresh, reload } = useList<AlertRow>("/notifications/inbox/");
  const open = async (a: AlertRow) => {
    if (!a.is_read) await api(`/notifications/inbox/${a.id}/read/`, { method: "POST" }).catch(() => undefined);
    reload();
    const t = parseTarget(a.path);
    if (t.screen === "order" && t.ref) nav.navigate("Order", { number: t.ref });
    else if (t.screen === "orders") nav.navigate("Orders");
    else if (t.screen === "payments") nav.navigate("Payments");
  };
  const readAll = async () => { await api("/notifications/inbox/read-all/", { method: "POST" }).catch(() => undefined); reload(); };
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={data ?? []}
      keyExtractor={(a) => String(a.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        <>
          {error ? <Notice>{error}</Notice> : null}
          {data?.some((a) => !a.is_read) ? <Button title="Mark all as read" tone="quiet" onPress={readAll} /> : null}
        </>
      }
      ListEmptyComponent={data ? <Empty>No alerts yet. New orders and anything that needs you will show up here.</Empty> : <Busy />}
      renderItem={({ item }) => (
        <Card onPress={() => open(item)} label={`${item.title}. ${item.body}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            {item.is_read ? <Text style={s.muted}>{item.title}</Text> : <Pill text={item.title} tone="warn" />}
            <Text style={s.muted}>{when(item.created_at)}</Text>
          </View>
          <Text style={[s.body, !item.is_read && { fontWeight: "700" }]}>{item.body}</Text>
        </Card>
      )}
    />
  );
}

interface ManualRow { reference: string; order_number: string; provider: string; amount: string; currency: string; contact_email: string; created_at: string; expires_at: string | null }

export function PaymentsScreen() {
  const nav = useNavigation<any>();
  const { data, error, refreshing, refresh, reload } = useList<ManualRow>("/payments/manual/");
  const [received, setReceived] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const confirm = (row: ManualRow) => {
    const amount = (received[row.reference] ?? "").trim();
    if (!amount) { setMsg({ kind: "error", text: `Type the amount you received for ${row.order_number}.` }); return; }
    Alert.alert("Payment received?", `${row.currency} ${amount} arrived for order ${row.order_number}. The order will be marked paid.`, [
      { text: "Not yet", style: "cancel" },
      {
        text: "Yes, it arrived",
        onPress: async () => {
          setBusy(row.reference); setMsg(null);
          try { await api(`/payments/manual/${row.reference}/confirm/`, { method: "POST", body: { amount } }); setMsg({ kind: "ok", text: `Order ${row.order_number} is paid.` }); reload(); }
          catch (e) { setMsg({ kind: "error", text: errText(e) }); } finally { setBusy(""); }
        },
      },
    ]);
  };
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      data={data ?? []}
      keyExtractor={(r) => r.reference}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        <>
          <Text style={[s.muted, { marginBottom: 12 }]}>Check Zelle, Cash App or your cash book first. Then type the exact amount you received. If it differs from the order, it is refused.</Text>
          {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
          {error ? <Notice>{error}</Notice> : null}
        </>
      }
      ListEmptyComponent={data ? <Empty>No manual payments are waiting.</Empty> : <Busy />}
      renderItem={({ item }) => (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[s.body, { fontWeight: "800" }]} onPress={() => nav.navigate("Order", { number: item.order_number })}>{item.order_number}</Text>
            <Text style={[s.body, { fontWeight: "700" }]}>{item.currency} {item.amount}</Text>
          </View>
          <Text style={s.muted}>{label(item.provider)} · {item.contact_email} · {when(item.created_at)}</Text>
          <View style={{ marginTop: 10 }}>
            <Field label="Amount received" keyboardType="decimal-pad" value={received[item.reference] ?? ""} onChangeText={(v) => setReceived({ ...received, [item.reference]: v })} />
            <Button title="Payment received" busy={busy === item.reference} onPress={() => confirm(item)} />
          </View>
        </Card>
      )}
    />
  );
}

// ---- me ----------------------------------------------------------------------------------------------------

interface StaffPrefs { staff?: { channels: Record<string, { enabled: boolean; available: boolean }> } }
const CHANNELS: Record<string, string> = { bell: "Alerts list in the app and website", email: "Email", push: "Phone alerts", whatsapp: "WhatsApp" };

export function MeScreen() {
  const { user, logout } = useAuth();
  const [prefs, setPrefs] = useState<StaffPrefs | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useFocusEffect(useCallback(() => { api<StaffPrefs>("/notifications/preferences/").then(setPrefs).catch((e) => setMsg({ kind: "error", text: errText(e) })); }, []));

  const toggle = async (channel: string, value: boolean) => {
    setMsg(null);
    try {
      if (channel === "push" && value && !(await enablePush())) {
        setMsg({ kind: "error", text: "Phone alerts need permission. Allow notifications for this app in your phone settings, then try again." });
        return;
      }
      if (!(channel === "push" && value)) await api("/notifications/preferences/", { method: "PUT", body: { staff: { [channel]: value } } });
      setPrefs(await api<StaffPrefs>("/notifications/preferences/"));
    } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  };
  const channels = prefs?.staff?.channels ?? {};
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={s.h1}>{user?.full_name || user?.email}</Text>
      <Text style={s.muted}>{user?.email} · {label(user?.role ?? "")}</Text>
      <Text style={s.h2}>How you are told</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      {!prefs ? <Busy /> : (
        <Card>
          {Object.entries(channels).map(([ch, cell]) => (
            <View key={ch} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.body}>{CHANNELS[ch] ?? label(ch)}</Text>
                {!cell.available && ch !== "push" ? <Text style={{ fontSize: type.xs, color: color.muted }}>Needs a verified phone number on your account.</Text> : null}
              </View>
              <Switch accessibilityLabel={CHANNELS[ch] ?? ch} value={cell.enabled} disabled={!cell.available && ch !== "push" && !cell.enabled} onValueChange={(v) => toggle(ch, v)} trackColor={{ true: color.teal, false: color.line }} />
            </View>
          ))}
        </Card>
      )}
      <Text style={[s.muted, { marginTop: 4 }]}>What you are sent depends on your role.</Text>
      <View style={{ marginTop: 24 }}>
        <Button title="Sign out" tone="quiet" onPress={() => Alert.alert("Sign out?", "This phone stops receiving store alerts.", [{ text: "Stay signed in", style: "cancel" }, { text: "Sign out", onPress: () => logout() }])} />
      </View>
    </ScrollView>
  );
}
