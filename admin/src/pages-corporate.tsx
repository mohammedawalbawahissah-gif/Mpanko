import { useState, type FormEvent } from "react";
import { api, ApiError, type Page } from "./api";
import { Alert, Field, Loading, Pill, errText, useAsync, when } from "./ui";

interface Business {
  id: number; name: string; slug: string; sector: string; tagline: string; summary: string; description: string; location: string;
  website_url: string; logo_url: string; logo_alt: string; is_published: boolean; is_featured: boolean; sort_order: number;
}
interface Profile {
  company_name: string; tagline: string; intro: string; about: string; contact_email: string; phone: string; address: string;
  linkedin_url: string; instagram_url: string; facebook_url: string; x_url: string;
}
interface Enquiry {
  id: number; name: string; email: string; phone: string; business: number | null; business_name: string; message: string;
  status: "new" | "handled"; staff_note: string; handled_by_name: string; handled_at: string | null; created_at: string;
}

/* ------------------------------------------------------------ businesses */

export function Businesses() {
  const list = useAsync(() => api<Business[]>("/corporate/manage/businesses/"), []);
  const [editing, setEditing] = useState<Business | "new" | null>(null);
  if (editing) return <BusinessForm business={editing === "new" ? null : editing} onDone={() => { setEditing(null); list.reload(); }} />;
  return (
    <>
      <h1>Businesses</h1>
      <p className="muted">These appear on the corporate website. Only published businesses are shown to visitors.</p>
      <p><button className="btn" onClick={() => setEditing("new")}>Add a business</button></p>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Business</th><th>Sector</th><th>Shown on website</th><th className="num">Order</th><th></th></tr></thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}{b.is_featured && <> <span className="pill s-info">Featured</span></>}<br /><span className="muted small">{b.location || "No location"}</span></td>
                  <td>{b.sector || "—"}</td>
                  <td><Pill value={b.is_published ? "published" : "draft"} /></td>
                  <td className="num">{b.sort_order}</td>
                  <td><button className="link-button" onClick={() => setEditing(b)}>Edit</button></td>
                </tr>
              ))}
              {list.data.length === 0 && <tr><td colSpan={5} className="muted">No businesses yet. Add the first one to show it on the website.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BusinessForm({ business, onDone }: { business: Business | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: business?.name ?? "", sector: business?.sector ?? "", tagline: business?.tagline ?? "", summary: business?.summary ?? "",
    description: business?.description ?? "", location: business?.location ?? "", website_url: business?.website_url ?? "",
    logo_alt: business?.logo_alt ?? "", sort_order: String(business?.sort_order ?? 0),
    is_published: business?.is_published ?? false, is_featured: business?.is_featured ?? false,
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setError("");
    const body = new FormData();
    for (const [k, v] of Object.entries(f)) body.append(k, typeof v === "boolean" ? String(v) : v);
    if (logo) body.append("logo", logo);
    if (removeLogo && !logo) body.append("remove_logo", "true");
    try {
      await api(business ? `/corporate/manage/businesses/${business.id}/` : "/corporate/manage/businesses/", { method: business ? "PATCH" : "POST", body });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) { setErrors(err.fields()); setError("Fix the highlighted fields and save again."); }
      else setError(errText(err));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!business || !window.confirm(`Delete ${business.name}? It will disappear from the website.`)) return;
    try { await api(`/corporate/manage/businesses/${business.id}/`, { method: "DELETE" }); onDone(); } catch (err) { setError(errText(err)); }
  };

  return (
    <form onSubmit={save} className="form">
      <h1>{business ? `Edit ${business.name}` : "Add a business"}</h1>
      {error && <Alert>{error}</Alert>}
      <Field id="b-name" label="Name" error={errors.name}><input id="b-name" className="input" required value={f.name} onChange={set("name")} /></Field>
      <Field id="b-sector" label="Sector (for example, Food or Logistics)" error={errors.sector}><input id="b-sector" className="input" value={f.sector} onChange={set("sector")} /></Field>
      <Field id="b-location" label="Location" error={errors.location}><input id="b-location" className="input" value={f.location} onChange={set("location")} /></Field>
      <Field id="b-tagline" label="One-line description" error={errors.tagline}><input id="b-tagline" className="input" value={f.tagline} onChange={set("tagline")} /></Field>
      <Field id="b-summary" label="Short summary (shown in the list)" error={errors.summary}><textarea id="b-summary" className="input" rows={3} value={f.summary} onChange={set("summary")} /></Field>
      <Field id="b-desc" label="Full description (shown on its own page; leave a blank line between paragraphs)" error={errors.description}><textarea id="b-desc" className="input" rows={8} value={f.description} onChange={set("description")} /></Field>
      <Field id="b-url" label="Website address (starts with https://)" error={errors.website_url}><input id="b-url" className="input" inputMode="url" value={f.website_url} onChange={set("website_url")} /></Field>
      <Field id="b-logo" label="Logo (JPG or PNG, up to 5 MB)" error={errors.logo}>
        <input id="b-logo" type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
      </Field>
      {business?.logo_url && !logo && (
        <p className="small"><img src={business.logo_url} alt="" width={48} height={48} /> <label><input type="checkbox" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} /> Remove the current logo</label></p>
      )}
      <Field id="b-alt" label="Describe the logo (for screen readers)" error={errors.logo_alt}><input id="b-alt" className="input" value={f.logo_alt} onChange={set("logo_alt")} /></Field>
      <Field id="b-order" label="Order in the list (smaller numbers come first)" error={errors.sort_order}><input id="b-order" className="input" type="number" value={f.sort_order} onChange={set("sort_order")} /></Field>
      <p><label><input type="checkbox" checked={f.is_featured} onChange={(e) => setF({ ...f, is_featured: e.target.checked })} /> Feature on the home page</label></p>
      <p><label><input type="checkbox" checked={f.is_published} onChange={(e) => setF({ ...f, is_published: e.target.checked })} /> Show on the website</label></p>
      {errors.is_published && <p className="field-error">{errors.is_published}</p>}
      <p className="row">
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save business"}</button>
        <button className="btn quiet" type="button" onClick={onDone}>Cancel</button>
        {business && <button className="btn danger" type="button" onClick={remove}>Delete</button>}
      </p>
    </form>
  );
}

/* ---------------------------------------------------------- site details */

export function SiteDetails() {
  const { data, error, loading } = useAsync(() => api<Profile>("/corporate/manage/profile/"), []);
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  return data ? <ProfileForm profile={data} /> : null;
}

function ProfileForm({ profile }: { profile: Profile }) {
  const [f, setF] = useState<Profile>(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setMsg(null);
    try {
      await api("/corporate/manage/profile/", { method: "PUT", body: f });
      setMsg({ kind: "ok", text: "Site details saved. The website shows them within a minute." });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) { setErrors(err.fields()); setMsg({ kind: "error", text: "Fix the highlighted fields and save again." }); }
      else setMsg({ kind: "error", text: errText(err) });
    } finally { setBusy(false); }
  };
  const text = (k: keyof Profile, label: string, extra: { type?: string; inputMode?: "url" | "tel" | "email" } = {}) => (
    <Field id={`p-${k}`} label={label} error={errors[k]}><input id={`p-${k}`} className="input" value={f[k]} onChange={set(k)} {...extra} /></Field>
  );
  return (
    <form onSubmit={save} className="form">
      <h1>Site details</h1>
      <p className="muted">The company name, wording and contact details on the corporate website.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {text("company_name", "Company name")}
      {text("tagline", "Tagline")}
      <Field id="p-intro" label="Introduction (home page)" error={errors.intro}><textarea id="p-intro" className="input" rows={3} value={f.intro} onChange={set("intro")} /></Field>
      <Field id="p-about" label="About us (leave a blank line between paragraphs)" error={errors.about}><textarea id="p-about" className="input" rows={8} value={f.about} onChange={set("about")} /></Field>
      {text("contact_email", "Contact email", { type: "email", inputMode: "email" })}
      {text("phone", "Phone", { inputMode: "tel" })}
      {text("address", "Address")}
      {text("linkedin_url", "LinkedIn address", { inputMode: "url" })}
      {text("instagram_url", "Instagram address", { inputMode: "url" })}
      {text("facebook_url", "Facebook address", { inputMode: "url" })}
      {text("x_url", "X address", { inputMode: "url" })}
      <p><button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save site details"}</button></p>
    </form>
  );
}

/* -------------------------------------------------------------- enquiries */

export function Enquiries() {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<Enquiry | null>(null);
  const list = useAsync(() => api<Page<Enquiry> | Enquiry[]>(`/corporate/manage/messages/${status ? `?status=${status}` : ""}`), [status]);
  const rows: Enquiry[] = Array.isArray(list.data) ? list.data : list.data?.results ?? [];
  if (open) return <EnquiryDetail enquiry={open} onDone={() => { setOpen(null); list.reload(); }} />;
  return (
    <>
      <h1>Enquiries</h1>
      <p className="muted">Messages sent through the corporate website's contact form.</p>
      <Field id="enq-status" label="Show">
        <select id="enq-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="new">New</option><option value="handled">Handled</option>
        </select>
      </Field>
      {list.loading && <Loading />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>From</th><th>About</th><th>Received</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}<br /><span className="muted small">{m.email}</span></td>
                  <td>{m.business_name || "General"}</td>
                  <td>{when(m.created_at)}</td>
                  <td><Pill value={m.status} /></td>
                  <td><button className="link-button" onClick={() => setOpen(m)}>Open</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No enquiries here.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function EnquiryDetail({ enquiry, onDone }: { enquiry: Enquiry; onDone: () => void }) {
  const [note, setNote] = useState(enquiry.staff_note);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (status: "new" | "handled") => {
    setBusy(true); setMsg(null);
    try {
      await api(`/corporate/manage/messages/${enquiry.id}/`, { method: "PATCH", body: { status, staff_note: note } });
      onDone();
    } catch (err) { setMsg({ kind: "error", text: errText(err) }); setBusy(false); }
  };
  return (
    <>
      <h1>Enquiry from {enquiry.name}</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <dl className="facts">
        <dt>Email</dt><dd><a href={`mailto:${enquiry.email}`}>{enquiry.email}</a></dd>
        {enquiry.phone && <><dt>Phone</dt><dd>{enquiry.phone}</dd></>}
        <dt>About</dt><dd>{enquiry.business_name || "General"}</dd>
        <dt>Received</dt><dd>{when(enquiry.created_at)}</dd>
        <dt>Status</dt><dd><Pill value={enquiry.status} />{enquiry.handled_by_name && <> by {enquiry.handled_by_name}</>}</dd>
      </dl>
      <h2>Message</h2>
      <p className="pre">{enquiry.message}</p>
      <Field id="enq-note" label="Internal note (visitors never see this)"><textarea id="enq-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <p className="row">
        {enquiry.status === "new"
          ? <button className="btn" disabled={busy} onClick={() => save("handled")}>Mark as handled</button>
          : <button className="btn quiet" disabled={busy} onClick={() => save("new")}>Reopen</button>}
        <button className="btn quiet" disabled={busy} onClick={() => save(enquiry.status)}>Save note</button>
        <button className="btn quiet" onClick={onDone}>Back</button>
      </p>
    </>
  );
}
