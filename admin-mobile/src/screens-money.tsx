import { useState } from "react";
import { ScrollView, Share, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { api } from "./api";
import { when } from "./core/resources";
import { downloadAndShare } from "./files";
import { errText, rowsOf, useLoad, useRunner } from "./hooks";
import { FieldsForm, type Vals } from "./kit";
import { color } from "./theme";
import { Busy, Button, Card, Empty, Field, Notice, Pill, s } from "./ui";

const label = (v: string) => { const t = v.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- reports

interface Report { columns: string[]; rows: Record<string, string | number | null>[]; count: number }
const REPORTS = [
  { value: "sales", label: "Sales by day" }, { value: "orders", label: "Orders" }, { value: "payments", label: "Payments" },
  { value: "refunds", label: "Refunds" }, { value: "stock", label: "Stock levels" }, { value: "shipping", label: "Shipping" },
];

export function ReportsScreen() {
  const today = new Date();
  const [v, setV] = useState<Vals>({ kind: "sales", from: iso(new Date(today.getTime() - 29 * 86400000)), to: iso(today) });
  const [applied, setApplied] = useState(v);
  const path = `/reports/${applied.kind}/?from=${applied.from}&to=${applied.to}`;
  const { data, error } = useLoad(() => api<Report>(path), [path]);
  const { msg, busy, run } = useRunner();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Reports</Text>
      <FieldsForm fields={[{ key: "kind", label: "Report", kind: "select", options: REPORTS }, { key: "from", label: "From", kind: "date" }, { key: "to", label: "To", kind: "date" }]} vals={v} setVals={(f) => setV((p) => f(p))} />
      <Button title="Show report" onPress={() => setApplied(v)} />
      <Button title="Download CSV" tone="quiet" busy={busy} onPress={() => run(() => downloadAndShare(path, `mpanko-${applied.kind}-${applied.from}-to-${applied.to}.csv`), "CSV ready to share.")} />
      {msg ? <Notice kind={msg.kind}>{msg.kind === "error" ? "You don't have access to this report, or the export failed." : msg.text}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {!data && !error ? <Busy /> : null}
      {data?.rows.map((r, i) => (
        <Card key={i}>
          {data.columns.map((c) => (
            <View key={c} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
              <Text style={s.muted}>{label(c)}</Text><Text style={[s.body, { flexShrink: 1, textAlign: "right" }]}>{String(r[c] ?? "")}</Text>
            </View>
          ))}
        </Card>
      ))}
      {data && data.rows.length === 0 ? <Empty>No data in this period.</Empty> : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- reconciliation

interface Run { id: number; provider: string; period_start: string; period_end: string; matched: number; exceptions: number; unresolved: number; created_at: string }
interface Rec { id: number; kind: string; kind_label: string; reference: string; order_number: string; internal_amount: string | null; provider_amount: string | null; currency: string; internal_status: string; provider_status: string; resolved: boolean; resolution_note: string }

export function ReconciliationScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const runs = useLoad(() => api<unknown>("/payments/reconciliation/"), []);
  const now = new Date();
  const [v, setV] = useState<Vals>({ provider: "paystack", start: iso(new Date(now.getTime() - 86400000)), end: iso(now) });
  const { msg, setMsg, busy, run } = useRunner();
  const go = async () => {
    const r = await run(() => api<{ matched: number; exceptions: number }>("/payments/reconciliation/", { method: "POST", body: { provider: v.provider, start: `${v.start}T00:00:00Z`, end: `${v.end}T23:59:59Z` } }), (x) => `${x.matched} payments matched, ${x.exceptions} need attention.`, runs.reload);
    if (r && (r as { exceptions: number }).exceptions) setMsg({ kind: "error", text: `${(r as { matched: number }).matched} payments matched, ${(r as { exceptions: number }).exceptions} need attention.` });
  };
  const list = runs.data ? rowsOf<Run>(runs.data) : null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Payment reconciliation</Text>
      <Text style={s.muted}>Compares our payment records with what the payment provider reports for the same period.</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <FieldsForm fields={[{ key: "provider", label: "Provider", kind: "select", options: [{ value: "paystack", label: "Paystack" }, { value: "mock", label: "Test provider" }] }, { key: "start", label: "From", kind: "date" }, { key: "end", label: "To", kind: "date" }]} vals={v} setVals={(f) => setV((p) => f(p))} />
      <Button title={busy ? "Checking…" : "Run reconciliation"} busy={busy} onPress={go} />
      {runs.error ? <Notice>{runs.error}</Notice> : null}
      {!list && !runs.error ? <Busy /> : null}
      {list?.map((r) => (
        <Card key={r.id} onPress={() => nav.navigate("ReconciliationRun", { id: r.id })} label={`Run ${r.id}`}>
          <Text style={[s.body, { fontWeight: "800" }]}>Run #{r.id} · {r.provider}</Text>
          <Text style={s.muted}>{new Date(r.period_start).toLocaleDateString()} to {new Date(r.period_end).toLocaleDateString()} · started {when(r.created_at)}</Text>
          <Text style={s.body}>{r.matched} matched · {r.exceptions} exceptions · {r.unresolved} unresolved</Text>
        </Card>
      ))}
      {list && list.length === 0 ? <Empty>No runs yet.</Empty> : null}
    </ScrollView>
  );
}

export function ReconciliationRunScreen({ route }: { route: { params: { id: number } } }) {
  const id = route.params.id;
  const { data, error, reload } = useLoad(() => api<{ id: number; provider: string; matched: number; exceptions: number; records: Rec[] }>(`/payments/reconciliation/${id}/`), [id]);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const { msg, busy, run } = useRunner();
  if (error) return <ScrollView contentContainerStyle={{ padding: 16 }}><Notice>{error}</Notice></ScrollView>;
  if (!data) return <Busy />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Run #{data.id} · {data.provider}</Text>
      <Text style={s.body}>{data.matched} matched, {data.exceptions} exceptions.</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      {data.records.map((r) => (
        <Card key={r.id}>
          <Text style={[s.body, { fontWeight: "800" }]}>{r.kind_label}</Text>
          <Text style={s.muted}>Reference {r.reference} · Order {r.order_number || "—"}</Text>
          <Text style={s.body}>Ours: {r.internal_amount ? `${r.currency} ${r.internal_amount}` : "—"} · Provider: {r.provider_amount ? `${r.currency} ${r.provider_amount}` : "—"}</Text>
          <View style={{ marginTop: 6 }}><Pill text={r.resolved ? "Resolved" : "Needs attention"} tone={r.resolved ? "ok" : "bad"} /></View>
          {r.resolved && r.resolution_note ? <Text style={s.muted}>{r.resolution_note}</Text> : null}
          {!r.resolved ? (open === r.id ? (
            <>
              <Field label="Resolution note" placeholder="What was done" value={note} onChangeText={setNote} />
              <Button title="Save" busy={busy} disabled={!note.trim()} onPress={() => run(() => api(`/payments/reconciliation/records/${r.id}/resolve/`, { method: "POST", body: { note } }), "Marked resolved.", () => { setOpen(null); setNote(""); reload(); })} />
            </>
          ) : <Button title="Mark resolved" tone="quiet" onPress={() => { setOpen(r.id); setNote(""); }} />) : null}
        </Card>
      ))}
      {data.records.length === 0 ? <Empty>Everything matched.</Empty> : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- emails

interface Template { key: string; label: string; subject: string; body: string; is_active: boolean; customised: boolean; variables: string[] }
interface LogRow { id: number; key: string; recipient: string; subject: string; status: string; error: string; created_at: string }

export function EmailsScreen() {
  const list = useLoad(() => api<Template[]>("/notifications/templates/"), []);
  const [failedOnly, setFailedOnly] = useState(true);
  const logs = useLoad(() => api<LogRow[]>(`/notifications/logs/${failedOnly ? "?status=failed" : ""}`), [failedOnly]);
  const [open, setOpen] = useState<Template | null>(null);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Emails</Text>
      <Text style={s.muted}>Change the wording of the emails customers and staff receive, and see which ones failed to send.</Text>
      {list.error ? <Notice>{list.error}</Notice> : null}
      {!list.data && !list.error ? <Busy /> : null}
      {open ? <TemplateEditor key={open.key} t={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} /> : list.data?.map((t) => (
        <Card key={t.key} onPress={() => setOpen(t)} label={`Edit ${t.label}`}>
          <Text style={[s.body, { fontWeight: "800" }]}>{t.label}</Text>
          <Text style={s.muted}>{t.subject}</Text>
          <Text style={s.muted}>{t.customised ? "Edited" : "Standard"} · Sending {t.is_active ? "on" : "off"}</Text>
        </Card>
      ))}
      <Text style={s.h2}>Delivery log</Text>
      <Button title={failedOnly ? "Showing only failures. Show all" : "Showing all. Show only failures"} tone="quiet" onPress={() => setFailedOnly((x) => !x)} />
      {!logs.data && !logs.error ? <Busy /> : null}
      {logs.data?.map((r) => (
        <Card key={r.id}>
          <Text style={[s.body, { fontWeight: "700" }]}>{r.key} → {r.recipient}</Text>
          <Text style={s.muted}>{when(r.created_at)}</Text>
          <Pill text={label(r.status)} tone={r.status === "failed" ? "bad" : r.status === "sent" ? "ok" : undefined} />
          {r.error ? <Text style={{ color: color.bad }}>{r.error}</Text> : null}
        </Card>
      ))}
      {logs.data && logs.data.length === 0 ? <Empty>{failedOnly ? "No failed emails." : "Nothing sent yet."}</Empty> : null}
    </ScrollView>
  );
}

function TemplateEditor({ t, onClose, onSaved }: { t: Template; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Vals>({ subject: t.subject, body: t.body, active: t.is_active });
  const { msg, setMsg, busy, run } = useRunner();
  return (
    <Card>
      <Text style={s.h2}>{t.label}</Text>
      <Text style={s.muted}>You can use: {t.variables.map((x) => `{{ ${x} }}`).join("  ")}</Text>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <FieldsForm fields={[{ key: "subject", label: "Subject" }, { key: "body", label: "Message", kind: "area" }, { key: "active", label: "Send this email", kind: "bool" }]} vals={v} setVals={(f) => setV((p) => f(p))} />
      <Button title="Save wording" busy={busy} onPress={() => run(() => api(`/notifications/templates/${t.key}/`, { method: "PUT", body: { subject: v.subject, body: v.body, is_active: !!v.active } }), "Saved.", onSaved)} />
      <Button title="Send me a test" tone="quiet" onPress={async () => { setMsg(null); try { const r = await api<{ sent: boolean; to: string }>(`/notifications/templates/${t.key}/test/`, { method: "POST", body: {} }); setMsg(r.sent ? { kind: "ok", text: `Test sent to ${r.to}. It shows the last saved wording.` } : { kind: "error", text: "The test email did not send. See the delivery log." }); } catch (e) { setMsg({ kind: "error", text: errText(e) }); } }} />
      {t.customised ? <Button title="Go back to standard wording" tone="quiet" onPress={() => run(() => api(`/notifications/templates/${t.key}/`, { method: "DELETE" }), "Standard wording restored.", onSaved)} /> : null}
      <Button title="Close" tone="quiet" onPress={onClose} />
    </Card>
  );
}

// ---------------------------------------------------------------- security

export function SecurityScreen() {
  const status = useLoad(() => api<{ enabled: boolean; backup_codes_left: number }>("/auth/mfa/backup-codes/"), []);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const { msg, busy, run } = useRunner();
  const left = status.data?.backup_codes_left ?? 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Security</Text>
      {status.error ? <Notice>{status.error}</Notice> : null}
      {!status.data && !status.error ? <Busy /> : null}
      {status.data && !status.data.enabled ? <Notice kind="info">Two-step sign-in is not turned on for your account. It is set up the next time you sign in.</Notice> : null}
      {status.data?.enabled ? (
        <>
          <Text style={s.h2}>Backup codes</Text>
          <Text style={s.body}>You have {left} unused backup {left === 1 ? "code" : "codes"}. Use one to sign in if you lose your phone.</Text>
          {codes ? (
            <>
              <Text style={s.muted}>Keep these somewhere safe, such as a password manager. Each code works once if you lose your phone. We cannot show them again.</Text>
              <Card>{codes.map((c) => <Text key={c} selectable style={[s.body, { fontWeight: "800", paddingVertical: 3 }]}>{c}</Text>)}</Card>
              <Button title="Share or copy codes" tone="quiet" onPress={() => Share.share({ message: codes.join("\n") }).catch(() => undefined)} />
              <Button title="I have saved them" onPress={() => setCodes(null)} />
            </>
          ) : (
            <>
              <Text style={s.muted}>Making new codes cancels the old ones. Enter the current 6-digit code from your authenticator app to continue.</Text>
              {msg && msg.kind === "error" ? <Notice>{msg.text}</Notice> : null}
              <Field label="6-digit code" value={code} onChangeText={(x) => setCode(x.trim())} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
              <Button title={busy ? "Making codes…" : "Make new backup codes"} busy={busy} disabled={code.length !== 6} onPress={() => run(() => api<{ backup_codes: string[] }>("/auth/mfa/backup-codes/", { method: "POST", body: { code } }), "", () => undefined).then((r) => { const x = r as { backup_codes: string[] } | undefined; if (x) { setCodes(x.backup_codes); setCode(""); status.reload(); } })} />
            </>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
