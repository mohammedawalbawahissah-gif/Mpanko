import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, type Page } from "./api";
import { AddressForm } from "./address";
import { Alert, Field, Loading, PasswordInput, useAsync } from "./components";
import { useAuth, useCurrency } from "./context";
import { useT } from "./i18n";
import { countryName } from "./pages-shop";
import type { Address } from "./types";

function useSubmit() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        const f = e.fields();
        setErrors(f);
        setMessage(f.detail || f.non_field_errors || (Object.keys(f).length ? "Check the highlighted fields." : e.message));
      } else setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return { errors, message, busy, run };
}

export function Login() {
  const { login, completeMfa, requestPhoneCode, loginWithPhone } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const { errors, message, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === "phone") {
        if (!smsSent) {
          await requestPhoneCode(phone);
          setSmsSent(true);
        } else {
          await loginWithPhone(phone, code);
          navigate(next, { replace: true });
        }
        return;
      }
      if (ticket) {
        await completeMfa(ticket, code);
        navigate(next, { replace: true });
        return;
      }
      const step = await login(email, password);
      if (step) setTicket(step.mfaTicket);
      else navigate(next, { replace: true });
    });
  };
  const switchMode = (m: "email" | "phone") => {
    setMode(m);
    setSmsSent(false);
    setCode("");
  };
  return (
    <div className="wrap page narrow">
      <h1>{ticket ? t("login.mfaTitle") : t("login.title")}</h1>
      {message && <Alert>{message}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        {mode === "phone" ? (
          <>
            <Field id="phone" label={t("login.phone")} error={errors.phone}>
              <input id="phone" className="input" type="tel" autoComplete="tel" value={phone} disabled={smsSent} onChange={(e) => setPhone(e.target.value)} required />
            </Field>
            {!smsSent && <p className="small">{t("login.phoneHint")}</p>}
            {smsSent && (
              <>
                <Alert kind="info">{t("login.codeSent")}</Alert>
                <Field id="sms-code" label={t("login.smsCode")} error={errors.code}>
                  <input id="sms-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} autoFocus required />
                </Field>
              </>
            )}
          </>
        ) : !ticket ? (
          <>
            <Field id="email" label={t("login.email")} error={errors.email}>
              <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field id="password" label={t("login.password")} error={errors.password}>
              <PasswordInput id="password" autoComplete="current-password" value={password} onChange={setPassword} required />
            </Field>
          </>
        ) : (
          <Field id="code" label="6-digit code from your authenticator app" error={errors.code}>
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.trim())} autoFocus required />
          </Field>
        )}
        <button className="btn" disabled={busy}>
          {busy ? t("login.submitting") : mode === "phone" ? (smsSent ? t("login.verify") : t("login.sendCode")) : ticket ? t("login.verify") : t("login.submit")}
        </button>
      </form>
      {!ticket && (
        <p className="small">
          <button type="button" className="link-button" onClick={() => switchMode(mode === "email" ? "phone" : "email")}>
            {mode === "email" ? t("login.usePhone") : t("login.useEmail")}
          </button>
        </p>
      )}
      {!ticket && mode === "email" && <p className="small"><Link to="/forgot-password">{t("login.forgot")}</Link></p>}
      {!ticket && <p className="small">{t("login.new")} <Link to={`/register?next=${encodeURIComponent(next)}`}>{t("login.create")}</Link></p>}
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const { errors, message, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (!agree) throw new ApiError(400, { accept_terms: "Please accept the terms and privacy policy to create an account." });
      await register(email, password, fullName, marketing);
      navigate(next, { replace: true });
    });
  };
  return (
    <div className="wrap page narrow">
      <h1>{t("register.title")}</h1>
      {message && <Alert>{message}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="name" label={t("register.name")} error={errors.full_name}>
          <input id="name" className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field id="email" label={t("register.email")} error={errors.email}>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="password" label={t("register.password")} error={errors.password}>
          <PasswordInput id="password" autoComplete="new-password" value={password} onChange={setPassword} required />
        </Field>
        <Field id="agree" label="" error={errors.accept_terms}>
          <label className="small"><input id="agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t("register.agree")} <Link to="/terms">{t("register.terms")}</Link> {t("register.and")} <Link to="/privacy">{t("register.privacy")}</Link></label>
        </Field>
        <label className="small"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> {t("register.marketing")}</label>
        <button className="btn" disabled={busy}>{busy ? t("register.creating") : t("register.create")}</button>
      </form>
      <p className="small">{t("register.have")} <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
    </div>
  );
}

export function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { errors, message, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/auth/password-reset/", { method: "POST", body: { email } });
      setSent(true);
    });
  };
  return (
    <div className="wrap page narrow">
      <h1>Reset your password</h1>
      {sent ? (
        <Alert kind="ok">If an account exists for {email}, we've sent a link to reset the password. The link works for 24 hours.</Alert>
      ) : (
        <>
          {message && <Alert>{message}</Alert>}
          <form className="form" onSubmit={submit} noValidate>
            <Field id="email" label="Email" error={errors.email}>
              <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <button className="btn" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
        </>
      )}
    </div>
  );
}

export function Reset() {
  const [params] = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { errors, message, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/auth/password-reset/confirm/", { method: "POST", body: { uid, token, new_password: password } });
      setDone(true);
    });
  };
  if (!uid || !token) return <div className="wrap page narrow"><Alert>This reset link is incomplete. Request a new one.</Alert><Link className="btn" to="/forgot-password">Request a new link</Link></div>;
  return (
    <div className="wrap page narrow">
      <h1>Choose a new password</h1>
      {done ? (
        <>
          <Alert kind="ok">Your password is changed. Sign in with the new one.</Alert>
          <Link className="btn" to="/login">Sign in</Link>
        </>
      ) : (
        <>
          {message && <Alert>{message}</Alert>}
          <form className="form" onSubmit={submit} noValidate>
            <Field id="pw" label="New password (at least 8 characters)" error={errors.new_password || errors.token}>
              <PasswordInput id="pw" autoComplete="new-password" value={password} onChange={setPassword} required />
            </Field>
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
          </form>
        </>
      )}
    </div>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const { reload } = useAuth();
  const [state, setState] = useState<"working" | "ok" | "bad">("working");
  useEffect(() => {
    api("/auth/verify-email/confirm/", { method: "POST", body: { uid, token } })
      .then(() => {
        setState("ok");
        reload().catch(() => undefined);
      })
      .catch(() => setState("bad"));
  }, [uid, token, reload]);
  return (
    <div className="wrap page narrow">
      {state === "working" && <Loading what="Verifying your email" />}
      {state === "ok" && (<><h1>Email verified</h1><Link className="btn" to="/shop">Continue shopping</Link></>)}
      {state === "bad" && (<><h1>This link has expired</h1><p>Sign in and request a new verification email from your account page.</p><Link className="btn" to="/account">Go to your account</Link></>)}
    </div>
  );
}

function PhonePanel({ onVerified }: { onVerified: () => void | Promise<void> }) {
  const { user } = useAuth();
  const { t } = useT();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const f = useSubmit();
  const verified = !!user?.phone_verified && !sent;
  const send = (e: FormEvent) => {
    e.preventDefault();
    f.run(async () => {
      await api("/auth/phone/verify/", { method: "POST", body: { phone } });
      setSent(true);
      setDone(false);
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    f.run(async () => {
      await api("/auth/phone/verify/confirm/", { method: "POST", body: { phone, code } });
      setSent(false);
      setCode("");
      setDone(true);
      await onVerified();
    });
  };
  return (
    <section aria-labelledby="phone-title" style={{ margin: "2rem 0" }}>
      <h2 id="phone-title">{t("phone.title")}</h2>
      <p className="small">{t("phone.intro")} <strong>{verified || done ? t("phone.verified") : t("phone.notVerified")}</strong></p>
      {f.message && <Alert>{f.message}</Alert>}
      {done && <Alert kind="ok">{t("phone.done")}</Alert>}
      <form className="form" onSubmit={sent ? confirm : send} noValidate>
        <Field id="vp-phone" label={t("phone.number")} error={f.errors.phone}>
          <input id="vp-phone" className="input" type="tel" autoComplete="tel" value={phone} disabled={sent} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {sent && (
          <Field id="vp-code" label={t("phone.code")} error={f.errors.code}>
            <input id="vp-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} autoFocus />
          </Field>
        )}
        <button className="btn" disabled={f.busy || !phone.trim() || (sent && code.length < 6)}>{sent ? t("phone.confirm") : t("phone.send")}</button>
      </form>
    </section>
  );
}

function ProfileForm({ onSaved }: { onSaved: () => void | Promise<void> }) {
  const { user } = useAuth();
  const { currencies, names } = useCurrency();
  const [name, setName] = useState(user?.full_name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [orderEmails, setOrderEmails] = useState(user?.notify_order_emails ?? true);
  const [marketing, setMarketing] = useState(user?.marketing_opt_in ?? false);
  const [sms, setSms] = useState(user?.notify_sms ?? false);
  const [currency, setCurrency] = useState(user?.preferred_currency ?? "");
  const f = useSubmit();
  const save = (e: FormEvent) => {
    e.preventDefault();
    f.run(async () => {
      await api("/auth/me/", {
        method: "PATCH",
        body: { full_name: name, phone, notify_order_emails: orderEmails, marketing_opt_in: marketing, notify_sms: sms, preferred_currency: currency },
      });
      await onSaved();
    });
  };
  return (
    <form className="form" onSubmit={save} noValidate>
      {f.message && <Alert>{f.message}</Alert>}
      <Field id="pf-name" label="Full name" error={f.errors.full_name}><input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
      <Field id="pf-phone" label="Phone" error={f.errors.phone}><input id="pf-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></Field>
      <Field id="pf-cur" label="Show prices in" error={f.errors.preferred_currency}>
        <select id="pf-cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="">Not set</option>
          {currencies.map((c) => <option key={c} value={c}>{names[c] ? `${c} · ${names[c]}` : c}</option>)}
        </select>
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 1rem" }}>
        <legend className="small">Contact me about</legend>
        <label className="small"><input type="checkbox" checked={orderEmails} onChange={(e) => setOrderEmails(e.target.checked)} /> Shipping and delivery updates by email</label><br />
        <label className="small"><input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Text messages about my orders</label><br />
        <label className="small"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> News and offers</label>
      </fieldset>
      <button className="btn" disabled={f.busy}>Save details</button>
    </form>
  );
}

export function Account() {
  const { user, logout, reload } = useAuth();
  const navigate = useNavigate();
  const addresses = useAsync(() => api<Page<Address>>("/auth/addresses/"), []);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const pw = useSubmit();

  if (!user) return <Loading />;

  const resend = async () => {
    try {
      await api("/auth/verify-email/request/", { method: "POST", body: {} });
      setNote("Verification email sent. Check your inbox.");
    } catch {
      setNote("Couldn't send the email. Try again shortly.");
    }
  };
  const removeAddress = async (id: number) => {
    await api(`/auth/addresses/${id}/`, { method: "DELETE" });
    addresses.reload();
  };
  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    pw.run(async () => {
      await api("/auth/change-password/", { method: "POST", body: { current_password: current, new_password: fresh } });
      setCurrent("");
      setFresh("");
      setNote("Password changed.");
    });
  };

  return (
    <div className="wrap page">
      <h1>Your account</h1>
      {note && <Alert kind="ok">{note}</Alert>}
      <div className="two">
        <section aria-labelledby="me">
          <h2 id="me">Details</h2>
          <p>{user.email}</p>
          <ProfileForm key={`${user.id}-${user.phone}`} onSaved={async () => { await reload(); setNote("Details saved."); }} />
          <PhonePanel key={`p-${user.phone}-${user.phone_verified}`} onVerified={reload} />
          {!user.email_verified && (
            <Alert kind="info">
              Your email isn't verified yet. <button className="link-button" onClick={resend}>Send the verification email</button>
            </Alert>
          )}
          <p><Link to="/orders">Your orders</Link></p>
          <button className="btn quiet" onClick={async () => { await logout(); navigate("/"); }}>Sign out</button>

          <h2 style={{ marginTop: "2.5rem" }}>Change password</h2>
          {pw.message && <Alert>{pw.message}</Alert>}
          <form className="form" onSubmit={changePassword} noValidate>
            <Field id="cur" label="Current password" error={pw.errors.current_password}>
              <PasswordInput id="cur" autoComplete="current-password" value={current} onChange={setCurrent} />
            </Field>
            <Field id="new" label="New password" error={pw.errors.new_password}>
              <PasswordInput id="new" autoComplete="new-password" value={fresh} onChange={setFresh} />
            </Field>
            <button className="btn" disabled={pw.busy}>Change password</button>
          </form>
        </section>

        <section aria-labelledby="addr">
          <h2 id="addr">Delivery addresses</h2>
          {addresses.loading && <Loading />}
          {addresses.data?.results.length === 0 && !adding && <p className="muted">No saved addresses yet.</p>}
          {addresses.data?.results.map((a) => (
            <p key={a.id}>
              <strong>{a.recipient_name}</strong><br />
              {a.line1}{a.line2 && `, ${a.line2}`}, {a.city}{a.region && `, ${a.region}`} {a.postal_code}<br />
              {countryName(a.country)} · {a.phone}<br />
              <button className="link-button" onClick={() => removeAddress(a.id)}>Remove</button>
            </p>
          ))}
          {adding ? (
            <AddressForm onSaved={() => { setAdding(false); addresses.reload(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button className="btn quiet" onClick={() => setAdding(true)}>Add an address</button>
          )}
        </section>
      </div>
      <PrivacyPanel onDeleted={async () => { await logout(); navigate("/"); }} />
    </div>
  );
}

function PrivacyPanel({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const del = useSubmit();
  const exportData = async () => {
    try {
      await downloadFile("/me/export/", "mpanko-my-data.json");
    } catch {
      setNote("Couldn't download your data. Try again shortly.");
    }
  };
  const remove = (e: FormEvent) => {
    e.preventDefault();
    del.run(async () => {
      await api("/me/delete/", { method: "POST", body: { password } });
      onDeleted();
    });
  };
  return (
    <section aria-labelledby="priv" style={{ marginTop: "3rem" }}>
      <h2 id="priv">Your data</h2>
      {note && <Alert>{note}</Alert>}
      <p>Download a copy of everything we hold about you, or delete your account. See our <Link to="/privacy">privacy policy</Link>.</p>
      <button className="btn quiet" onClick={exportData}>Download my data</button>
      {open ? (
        <form className="form" onSubmit={remove} noValidate style={{ marginTop: "1.5rem" }}>
          <Alert kind="info">Deleting your account removes your details, addresses and messages. We keep order records without your personal details, as the law requires. This can't be undone.</Alert>
          {del.message && <Alert>{del.message}</Alert>}
          <Field id="delpw" label="Enter your password to confirm" error={del.errors.password}>
            <PasswordInput id="delpw" autoComplete="current-password" value={password} onChange={setPassword} />
          </Field>
          <button className="btn" disabled={del.busy}>Delete my account</button>{" "}
          <button type="button" className="btn quiet" onClick={() => setOpen(false)}>Keep my account</button>
        </form>
      ) : (
        <p><button className="link-button" onClick={() => setOpen(true)}>Delete my account</button></p>
      )}
    </section>
  );
}
