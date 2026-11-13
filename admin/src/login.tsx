import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import QRCode from "qrcode";
import { api, ApiError, type Tokens } from "./api";
import { useAuth, type LoginStep } from "./auth";
import { Alert, Field, PasswordInput, errText } from "./ui";

export function Login() {
  const { user, ready, start, finish } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await start(email, password);
      if (s.kind !== "done") setStep(s);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="brand">Mpanko admin</div>
      {error && <Alert>{error}</Alert>}
      {!step && (
        <form className="form" onSubmit={submit} noValidate>
          <Field id="email" label="Email">
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field id="pw" label="Password">
            <PasswordInput id="pw" autoComplete="current-password" value={password} onChange={setPassword} required />
          </Field>
          <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      )}
      {step?.kind === "code" && (
        <CodeStep ticket={step.ticket} onDone={finish} onBack={() => setStep(null)} />
      )}
      {step?.kind === "enroll" && (
        <EnrollStep ticket={step.ticket} onDone={finish} />
      )}
    </main>
  );
}

function CodeStep({ ticket, onDone, onBack }: { ticket: string; onDone: (t: Tokens) => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const t = await api<Tokens>("/auth/login/mfa/", { method: "POST", body: { mfa_token: ticket, code } });
      await onDone(t);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 && /sign in again/i.test(err.message) ? "Your sign-in timed out. Start again." : errText(err));
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1>Enter your code</h1>
      <p className="muted">Open your authenticator app and enter the 6-digit code for Mpanko.</p>
      {error && <Alert>{error}</Alert>}
      <Field id="code" label="6-digit code">
        <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.trim())} autoFocus required />
      </Field>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button className="btn" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Verify"}</button>
        <button type="button" className="btn quiet" onClick={onBack}>Back</button>
      </div>
    </form>
  );
}

function EnrollStep({ ticket, onDone }: { ticket: string; onDone: (t: Tokens) => Promise<void> }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ secret: string; otpauth_uri: string }>("/auth/mfa/setup/", { method: "POST", body: { mfa_token: ticket } })
      .then(async (s) => {
        setSetup(s);
        setQr(await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 192 }));
      })
      .catch((e: unknown) => setError(errText(e)));
  }, [ticket]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const t = await api<Tokens>("/auth/mfa/confirm/", { method: "POST", body: { mfa_token: ticket, code } });
      await onDone(t);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1>Set up two-step sign-in</h1>
      <p>Staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar).</p>
      {error && <Alert>{error}</Alert>}
      {setup && (
        <>
          <p>Scan this code with the app, then enter the 6-digit code it shows.</p>
          {qr && <div className="qr"><img src={qr} width={192} height={192} alt="QR code for your authenticator app" /></div>}
          <p className="small muted">Can't scan? Enter this key in the app: <code className="secret">{setup.secret}</code></p>
          <Field id="code" label="6-digit code">
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.trim())} required />
          </Field>
          <button className="btn" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Turn on and sign in"}</button>
        </>
      )}
    </form>
  );
}
