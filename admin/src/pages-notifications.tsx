import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "./api";
import { Alert, CountryMultiSelect, Field, Loading, Pill, errText, useAsync, when } from "./ui";

type Rows<T> = T[] | { results: T[] };
const rows = <T,>(d: Rows<T> | null | undefined): T[] => (Array.isArray(d) ? d : d?.results ?? []);

// ---- alerts for me ------------------------------------------------------------------------------------------

interface InboxRow { id: number; key: string; title: string; body: string; path: string; is_read: boolean; created_at: string }
interface StaffCell { enabled: boolean; available: boolean }
interface Prefs { staff?: { label: string; channels: Record<string, StaffCell> } }

const CHANNEL_NAMES: Record<string, { name: string; hint: string }> = {
  bell: { name: "Alerts list", hint: "Shows here in the admin" },
  email: { name: "Email", hint: "To your sign-in address" },
  push: { name: "Phone", hint: "Needs the Mpanko Admin phone app signed in" },
  whatsapp: { name: "WhatsApp", hint: "Needs a verified phone number on your account" },
};

/** Where an alert should take you. The server stores "orders/MP-1001"-style paths. */
export function target(path: string): string {
  const p = path.replace(/^\/+/, "");
  if (!p) return "/";
  const [head, ...rest] = p.split("/");
  const map: Record<string, string> = { orders: "orders", support: "support", returns: "returns", stock: "stock", payments: "manual-payments", "manual-payments": "manual-payments", chargebacks: "chargebacks", enquiries: "enquiries" };
  return map[head] ? `/${[map[head], ...rest].join("/")}` : "/";
}

export function Alerts() {
  const inbox = useAsync(() => api<Rows<InboxRow>>("/notifications/inbox/"), []);
  const prefs = useAsync(() => api<Prefs>("/notifications/preferences/"), []);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const list = rows(inbox.data);
  const go = useNavigate();

  const markAll = async () => {
    try { await api("/notifications/inbox/read-all/", { method: "POST" }); inbox.reload(); window.dispatchEvent(new Event("mpanko:alerts")); }
    catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  };
  const open = async (r: InboxRow) => {
    if (!r.is_read) { try { await api(`/notifications/inbox/${r.id}/read/`, { method: "POST" }); window.dispatchEvent(new Event("mpanko:alerts")); } catch { /* the link still works */ } }
    go(target(r.path));
  };
  const toggle = async (channel: string, value: boolean) => {
    setMsg(null);
    try {
      await api("/notifications/preferences/", { method: "PUT", body: { staff: { [channel]: value } } });
      prefs.reload();
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  };

  return (
    <>
      <h1>Alerts</h1>
      <p className="muted">New orders, manual payments to confirm, failed payments, returns, support cases and low stock land here. Choose below where else you want to hear about them.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <h2>How you are told</h2>
      {prefs.loading && <Loading />}
      {prefs.data?.staff && (
        <div className="card">
          {Object.entries(prefs.data.staff.channels).map(([ch, cell]) => (
            <p key={ch} style={{ margin: "0.4rem 0" }}>
              <label>
                <input type="checkbox" checked={cell.enabled} disabled={!cell.available && !cell.enabled} onChange={(e) => toggle(ch, e.target.checked)} />{" "}
                <strong>{CHANNEL_NAMES[ch]?.name ?? ch}</strong> <span className="muted small">{cell.available ? CHANNEL_NAMES[ch]?.hint : `${CHANNEL_NAMES[ch]?.hint}. Not set up for you yet.`}</span>
              </label>
            </p>
          ))}
          <p className="small muted">What you are sent depends on your role. Finance sees payment alerts, fulfilment sees orders to pack, support sees cases.</p>
        </div>
      )}
      <h2>Recent alerts</h2>
      <p><button className="btn quiet" onClick={markAll} disabled={!list.some((r) => !r.is_read)}>Mark all as read</button></p>
      {inbox.loading && <Loading />}
      {inbox.error && <Alert>{inbox.error}</Alert>}
      {inbox.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>When</th><th>Alert</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.created_at)}</td>
                  <td>{!r.is_read && <Pill value="new" />} <strong>{r.title}</strong><br /><span className="muted small">{r.body}</span></td>
                  <td><button className="link-button" onClick={() => open(r)}>Open</button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={3} className="muted">Nothing yet. New orders and anything that needs you will show here.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- announcements ------------------------------------------------------------------------------------------

interface Campaign {
  id: number; title: string; subject: string; body: string; link: string; send_email: boolean; send_push: boolean; countries: string[];
  status: "draft" | "sending" | "sent"; sent_at: string | null; emailed: number; pushed: number; skipped: number; created_at: string;
}
interface Audience {
  customers: number; agreed_to_offers: number; offers_by_channel: Record<string, number>; countries: { country: string; customers: number }[];
}

export function Announcements() {
  const list = useAsync(() => api<Rows<Campaign>>("/notifications/campaigns/"), []);
  const audience = useAsync(() => api<Audience>("/notifications/audience/"), []);
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  if (editing) return <CampaignForm campaign={editing === "new" ? null : editing} onDone={() => { setEditing(null); list.reload(); audience.reload(); }} />;
  const a = audience.data;
  return (
    <>
      <h1>Announcements</h1>
      <p className="muted">Send news, offers and updates to customers who agreed to receive them. Write one, send yourself a test, check who it will reach, then send. Each announcement can be sent once.</p>
      <h2 style={{ marginTop: 0 }}>Your customers</h2>
      {audience.loading && <Loading />}
      {a && (
        <div className="two">
          <section className="card">
            <p style={{ margin: 0 }}><strong>{a.customers}</strong> customers, <strong>{a.agreed_to_offers}</strong> agreed to news and offers.</p>
            <p className="small muted">Of those who agreed, how many can be reached by:</p>
            <ul className="small">
              <li>Email: {a.offers_by_channel.email}</li>
              <li>App and browser alerts: {a.offers_by_channel.push}</li>
              <li>Text: {a.offers_by_channel.sms}</li>
              <li>WhatsApp: {a.offers_by_channel.whatsapp}</li>
            </ul>
          </section>
          <section className="card">
            <strong>Where they are</strong>
            <table className="table" style={{ marginTop: "0.5rem" }}>
              <tbody>
                {a.countries.slice(0, 12).map((c) => <tr key={c.country}><td>{c.country}</td><td className="num">{c.customers}</td></tr>)}
                {a.countries.length === 0 && <tr><td className="muted">No customers yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}
      <h2>Announcements</h2>
      <p><button className="btn" onClick={() => setEditing("new")}>Write an announcement</button></p>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Name</th><th>Status</th><th>Who</th><th className="num">Emailed</th><th className="num">App</th><th></th></tr></thead>
            <tbody>
              {rows(list.data).map((c) => (
                <tr key={c.id}>
                  <td>{c.title}<br /><span className="muted small">{c.subject}</span></td>
                  <td><Pill value={c.status} />{c.sent_at && <div className="small muted">{when(c.sent_at)}</div>}</td>
                  <td>{c.countries.length ? c.countries.join(", ") : "Everyone who agreed"}</td>
                  <td className="num">{c.status === "draft" ? "" : c.emailed}</td>
                  <td className="num">{c.status === "draft" ? "" : c.pushed}</td>
                  <td><button className="link-button" onClick={() => setEditing(c)}>{c.status === "draft" ? "Open" : "View"}</button></td>
                </tr>
              ))}
              {rows(list.data).length === 0 && <tr><td colSpan={6} className="muted">No announcements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CampaignForm({ campaign, onDone }: { campaign: Campaign | null; onDone: () => void }) {
  const [saved, setSaved] = useState<Campaign | null>(campaign);
  const [f, setF] = useState({ title: campaign?.title ?? "", subject: campaign?.subject ?? "", body: campaign?.body ?? "", link: campaign?.link ?? "", send_email: campaign?.send_email ?? true, send_push: campaign?.send_push ?? true, countries: campaign?.countries ?? [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reach, setReach] = useState<{ people: number; email: number; push: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = !!saved && saved.status !== "draft";
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((p) => ({ ...p, [k]: v })); setReach(null); };

  const save = async (): Promise<Campaign | null> => {
    setBusy(true); setErrors({}); setMsg(null);
    try {
      const c = await api<Campaign>(saved ? `/notifications/campaigns/${saved.id}/` : "/notifications/campaigns/", { method: saved ? "PATCH" : "POST", body: f });
      setSaved(c);
      return c;
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) { setErrors(err.fields()); setMsg({ kind: "error", text: errors.non_field_errors || "Fix the highlighted fields and try again." }); }
      else setMsg({ kind: "error", text: errText(err) });
      return null;
    } finally { setBusy(false); }
  };
  const onSave = async (e: FormEvent) => { e.preventDefault(); const c = await save(); if (c) setMsg({ kind: "ok", text: "Saved." }); };
  const check = async () => {
    const c = await save(); if (!c) return;
    try { setReach(await api(`/notifications/campaigns/${c.id}/preview/`)); } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  };
  const test = async () => {
    const c = await save(); if (!c) return;
    try { await api(`/notifications/campaigns/${c.id}/test/`, { method: "POST" }); setMsg({ kind: "ok", text: "Test email sent to your address." }); } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  };
  const send = async () => {
    const c = await save(); if (!c) return;
    let r = reach;
    try { r = await api(`/notifications/campaigns/${c.id}/preview/`); setReach(r); } catch { /* the send itself reports problems */ }
    if (!window.confirm(`Send "${c.subject}" to ${r ? `${r.people} ${r.people === 1 ? "person" : "people"}` : "everyone who agreed"}? This cannot be undone or sent again.`)) return;
    setBusy(true);
    try { await api(`/notifications/campaigns/${c.id}/send/`, { method: "POST" }); onDone(); } catch (e) { setMsg({ kind: "error", text: errText(e) }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!saved || !window.confirm("Delete this draft?")) return;
    try { await api(`/notifications/campaigns/${saved.id}/`, { method: "DELETE" }); onDone(); } catch (e) { setMsg({ kind: "error", text: errText(e) }); }
  };

  return (
    <form onSubmit={onSave} className="form">
      <p className="small"><button type="button" className="link-button" onClick={onDone}>Announcements</button></p>
      <h1>{saved ? saved.title : "New announcement"} {saved && <Pill value={saved.status} />}</h1>
      {locked && <Alert kind="info">Sent {saved?.sent_at ? when(saved.sent_at) : ""}. Emailed {saved?.emailed}, app alerts {saved?.pushed}, skipped {saved?.skipped}. A sent announcement cannot be changed.</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <Field id="c-title" label="Name (only staff see this)" error={errors.title}><input id="c-title" className="input" required value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field id="c-subject" label="Subject line" error={errors.subject}><input id="c-subject" className="input" required value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
        <Field id="c-body" label="Message (a blank line starts a new paragraph)" error={errors.body}><textarea id="c-body" className="input" rows={8} required value={f.body} onChange={(e) => set("body", e.target.value)} /></Field>
        <Field id="c-link" label="Link (optional, for example a product page)" error={errors.link}><input id="c-link" className="input" type="url" placeholder="https://" value={f.link} onChange={(e) => set("link", e.target.value)} /></Field>
        <Field id="c-countries" label="Countries (leave empty for everyone who agreed)" error={errors.countries}><CountryMultiSelect id="c-countries" value={f.countries} onChange={(v) => set("countries", v)} /></Field>
        <p>
          <label><input type="checkbox" checked={f.send_email} onChange={(e) => set("send_email", e.target.checked)} /> Email</label>{" "}
          <label style={{ marginLeft: "1rem" }}><input type="checkbox" checked={f.send_push} onChange={(e) => set("send_push", e.target.checked)} /> App list, phone and browser alert</label>
        </p>
        <p className="small muted">Only customers who ticked "Send me news and offers" are included, and every email has an unsubscribe link.</p>
      </fieldset>
      {reach && <Alert kind="info">This reaches {reach.people} {reach.people === 1 ? "person" : "people"} right now: {reach.email} by email and {reach.push} by phone or browser alert. Everyone also gets it in their app list.</Alert>}
      {!locked && (
        <div className="row">
          <button className="btn" disabled={busy}>Save draft</button>
          <button type="button" className="btn quiet" disabled={busy} onClick={check}>Check who it reaches</button>
          <button type="button" className="btn quiet" disabled={busy} onClick={test}>Email me a test</button>
          <button type="button" className="btn" disabled={busy} onClick={send}>Send to customers</button>
          {saved && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete draft</button>}
        </div>
      )}
    </form>
  );
}
