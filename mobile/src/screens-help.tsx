import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback } from "react";
import { api, ApiError, type Page } from "./api";
import { color } from "./theme";
import type { RootParams } from "./screens-buy";
import { Busy, Button, Notice, Pill, s, useAsync } from "./ui";

type Nav = NavigationProp<RootParams>;

interface Eligibility {
  eligible: boolean; message: string; window_days: number;
  reasons: { value: string; label: string }[];
  items: { order_item: number; product_name: string; variant_name: string; max: number }[];
}
interface ReturnRow {
  number: string; status: string; reason_label: string; staff_note: string; refund_amount: string | null; currency: string;
  items: { order_item: number; product_name: string; quantity: number }[];
}
interface Case {
  number: string; subject: string; status: string; order_number: string | null; updated_at: string;
  messages: { id: number; from_staff: boolean; author_name: string; body: string; created_at: string }[];
}

const fail = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** Returns already made on an order, with the button to start one. Shown on the order screen. */
export function OrderReturns({ orderNumber, status }: { orderNumber: string; status: string }) {
  const nav = useNavigation<Nav>();
  const { data, reload } = useAsync(() => api<Page<ReturnRow>>(`/returns/?search=${orderNumber}`), [orderNumber]);
  const [error, setError] = useState("");
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const list = data?.results ?? [];
  if (list.length === 0 && status !== "delivered") return null;
  const cancel = async (n: string) => {
    setError("");
    try {
      await api(`/returns/${n}/cancel/`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setError(fail(e, "Couldn't cancel the return."));
    }
  };
  return (
    <View>
      <Text style={s.h2}>Returns</Text>
      {!!error && <Notice>{error}</Notice>}
      {list.map((r) => (
        <View key={r.number} style={[s.card, s.cardPad]}>
          <View style={s.row}><Text style={{ fontWeight: "700", color: color.ink }}>{r.number}</Text><Pill value={r.status} /></View>
          <Text style={s.muted}>{r.items.map((i) => `${i.quantity} × ${i.product_name}`).join(", ")} · {r.reason_label}</Text>
          {!!r.staff_note && <Text style={{ marginTop: 6 }}>{r.staff_note}</Text>}
          {r.status === "approved" && !!r.refund_amount && <Text style={{ marginTop: 6 }}>Send the items back. We refund {r.currency} {r.refund_amount} when they arrive.</Text>}
          {(r.status === "requested" || r.status === "approved") && <View style={{ marginTop: 8 }}><Button title="Cancel this return" kind="quiet" onPress={() => cancel(r.number)} /></View>}
        </View>
      ))}
      {status === "delivered" && <Button title="Return items" kind="quiet" onPress={() => nav.navigate("Return", { number: orderNumber })} />}
    </View>
  );
}

export function ReturnScreen({ route }: { route: { params: { number: string } } }) {
  const { number } = route.params;
  const nav = useNavigation<Nav>();
  const { data: e, error, loading } = useAsync(() => api<Eligibility>(`/returns/eligibility/?order=${number}`), [number]);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  if (loading) return <Busy />;
  if (error || !e) return <View style={s.pad}><Notice>{error || "We couldn't load that order."}</Notice></View>;
  if (!e.eligible) return <View style={s.pad}><Notice kind="info">{e.message}</Notice></View>;
  const chosen = Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => ({ order_item: Number(id), quantity: n }));
  const submit = async () => {
    setBusy(true);
    setProblem("");
    try {
      await api("/returns/", { method: "POST", body: { order_number: number, reason, note, items: chosen } });
      nav.goBack();
    } catch (x) {
      setProblem(fail(x, "Something went wrong. Try again."));
      setBusy(false);
    }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Return items</Text>
      <Text style={s.muted}>You can return items within {e.window_days} days of delivery. We email you our decision, and refund once the items reach us.</Text>
      {!!problem && <View style={{ marginTop: 12 }}><Notice>{problem}</Notice></View>}
      <Text style={s.h2}>How many of each?</Text>
      {e.items.filter((i) => i.max > 0).map((i) => {
        const n = qty[i.order_item] ?? 0;
        return (
          <View key={i.order_item} style={[s.card, s.cardPad, s.row]}>
            <Text style={{ flex: 1 }}>{i.product_name}{i.variant_name ? ` (${i.variant_name})` : ""}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${i.product_name}`} onPress={() => setQty({ ...qty, [i.order_item]: Math.max(0, n - 1) })} style={{ padding: 12 }}><Text style={{ fontSize: 22, color: color.indigo }}>−</Text></Pressable>
            <Text accessibilityLabel={`${n} to return`} style={{ minWidth: 24, textAlign: "center", fontWeight: "700" }}>{n}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`More ${i.product_name}`} onPress={() => setQty({ ...qty, [i.order_item]: Math.min(i.max, n + 1) })} style={{ padding: 12 }}><Text style={{ fontSize: 22, color: color.indigo }}>+</Text></Pressable>
          </View>
        );
      })}
      <Text style={s.h2}>Why are you returning them?</Text>
      {e.reasons.map((r) => (
        <Pressable key={r.value} accessibilityRole="radio" accessibilityState={{ selected: reason === r.value }} onPress={() => setReason(r.value)} style={[s.choice, reason === r.value && s.choiceOn]}>
          <Text>{r.label}</Text>
        </Pressable>
      ))}
      <Text style={s.label}>Anything we should know? (optional)</Text>
      <TextInput accessibilityLabel="Note" style={[s.input, { minHeight: 90, textAlignVertical: "top" }]} multiline maxLength={1000} value={note} onChangeText={setNote} />
      <View style={{ height: 16 }} />
      <Button title={busy ? "Sending…" : "Request return"} disabled={busy || chosen.length === 0 || !reason} onPress={submit} />
    </ScrollView>
  );
}

export function SupportListScreen() {
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useAsync(() => api<Page<Case>>("/support/cases/"), []);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Button title="Ask us something" onPress={() => nav.navigate("SupportNew", {})} />
      <View style={{ height: 12 }} />
      {loading && !data && <Busy />}
      {!!error && <Notice>{error}</Notice>}
      {data && data.results.length === 0 && <Text style={s.muted}>You haven't contacted us yet.</Text>}
      {data?.results.map((c) => (
        <Pressable key={c.number} accessibilityRole="button" style={[s.card, s.cardPad]} onPress={() => nav.navigate("SupportThread", { number: c.number })}>
          <View style={s.row}><Text style={{ flex: 1, fontWeight: "700", color: color.ink }}>{c.subject}</Text><Pill value={c.status} /></View>
          <Text style={s.muted}>{c.order_number ? `Order ${c.order_number} · ` : ""}{new Date(c.updated_at).toLocaleDateString()}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function SupportNewScreen({ route }: { route: { params?: { order?: string } } }) {
  const nav = useNavigation<Nav>();
  const orders = useAsync(() => api<Page<{ number: string }>>("/orders/"), []);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState(route.params?.order ?? "");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setProblem("");
    try {
      const c = await api<Case>("/support/cases/", { method: "POST", body: { subject, message, order_number: order } });
      nav.navigate("SupportThread", { number: c.number });
    } catch (x) {
      setProblem(fail(x, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Ask us something</Text>
      {!!problem && <Notice>{problem}</Notice>}
      <Text style={s.label}>What is it about?</Text>
      <TextInput accessibilityLabel="Subject" style={s.input} maxLength={150} value={subject} onChangeText={setSubject} />
      <Text style={[s.label, { marginTop: 14 }]}>Which order? (optional)</Text>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: order === "" }} onPress={() => setOrder("")} style={[s.choice, order === "" && s.choiceOn]}><Text>Not about an order</Text></Pressable>
      {orders.data?.results.slice(0, 8).map((o) => (
        <Pressable key={o.number} accessibilityRole="radio" accessibilityState={{ selected: order === o.number }} onPress={() => setOrder(o.number)} style={[s.choice, order === o.number && s.choiceOn]}><Text>{o.number}</Text></Pressable>
      ))}
      <Text style={[s.label, { marginTop: 6 }]}>Tell us more</Text>
      <TextInput accessibilityLabel="Message" style={[s.input, { minHeight: 120, textAlignVertical: "top" }]} multiline maxLength={4000} value={message} onChangeText={setMessage} />
      <View style={{ height: 16 }} />
      <Button title={busy ? "Sending…" : "Send"} disabled={busy || !subject.trim() || !message.trim()} onPress={submit} />
    </ScrollView>
  );
}

export function SupportThreadScreen({ route }: { route: { params: { number: string } } }) {
  const { number } = route.params;
  const { data: c, error, loading, reload } = useAsync(() => api<Case>(`/support/cases/${number}/`), [number]);
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  if (loading && !c) return <Busy />;
  if (error || !c) return <View style={s.pad}><Notice>{error || "We couldn't find that request."}</Notice></View>;
  const send = async () => {
    setBusy(true);
    setProblem("");
    try {
      await api(`/support/cases/${c.number}/messages/`, { method: "POST", body: { body } });
      setBody("");
      reload();
    } catch (x) {
      setProblem(fail(x, "Couldn't send your message."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{c.subject}</Text>
      <Pill value={c.status} />
      {c.messages.map((m) => (
        <View key={m.id} style={[s.card, s.cardPad, { marginTop: 12, marginLeft: m.from_staff ? 16 : 0 }]}>
          <Text style={s.muted}>{m.author_name} · {new Date(m.created_at).toLocaleString()}</Text>
          <Text style={{ marginTop: 4 }}>{m.body}</Text>
        </View>
      ))}
      {c.status === "closed" ? (
        <View style={{ marginTop: 12 }}><Notice kind="info">This request is closed. Start a new one if you still need help.</Notice></View>
      ) : (
        <View style={{ marginTop: 12 }}>
          {!!problem && <Notice>{problem}</Notice>}
          <Text style={s.label}>Add a message</Text>
          <TextInput accessibilityLabel="Message" style={[s.input, { minHeight: 90, textAlignVertical: "top" }]} multiline maxLength={4000} value={body} onChangeText={setBody} />
          <View style={{ height: 12 }} />
          <Button title={busy ? "Sending…" : "Send"} disabled={busy || !body.trim()} onPress={send} />
        </View>
      )}
    </ScrollView>
  );
}
