import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, type Page } from "./api";
import { AddressForm } from "./address";
import { Alert, Field, Loading, useAsync } from "./components";
import { useAuth } from "./context";
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
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { errors, message, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await login(email, password);
      navigate(next, { replace: true });
    });
  };
  return (
    <div className="wrap page narrow">
      <h1>Sign in</h1>
      {message && <Alert>{message}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="email" label="Email" error={errors.email}>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="password" label="Password" error={errors.password}>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="small"><Link to="/forgot-password">Forgot your password?</Link></p>
      <p className="small">New to Mpanko? <Link to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { errors, message, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await register(email, password, fullName);
      navigate(next, { replace: true });
    });
  };
  return (
    <div className="wrap page narrow">
      <h1>Create your account</h1>
      {message && <Alert>{message}</Alert>}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="name" label="Full name" error={errors.full_name}>
          <input id="name" className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="password" label="Password (at least 8 characters)" error={errors.password}>
          <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="small">Already have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
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
              <input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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

export function Account() {
  const { user, logout } = useAuth();
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
          <p>{user.full_name}<br />{user.email}</p>
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
              <input id="cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field id="new" label="New password" error={pw.errors.new_password}>
              <input id="new" className="input" type="password" autoComplete="new-password" value={fresh} onChange={(e) => setFresh(e.target.value)} />
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
    </div>
  );
}
