import { useState, type FormEvent } from "react";
import { api } from "./api";
import { BackupCodes } from "./login";
import { Alert, Field, Loading, errText, useAsync } from "./ui";

export function Security() {
  const status = useAsync(() => api<{ enabled: boolean; backup_codes_left: number }>("/auth/mfa/backup-codes/"), []);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ backup_codes: string[] }>("/auth/mfa/backup-codes/", { method: "POST", body: { code } });
      setCodes(r.backup_codes);
      setCode("");
      status.reload();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Security</h1>
      {status.loading && <Loading />}
      {status.error && <Alert>{status.error}</Alert>}
      {status.data && !status.data.enabled && <Alert kind="info">Two-step sign-in is not turned on for your account. It is set up the next time you sign in.</Alert>}
      {status.data?.enabled && (
        <section aria-labelledby="bc">
          <h2 id="bc">Backup codes</h2>
          <p>
            You have <strong>{status.data.backup_codes_left}</strong> unused backup {status.data.backup_codes_left === 1 ? "code" : "codes"}. Use one to sign in if you lose your phone.
          </p>
          {codes ? (
            <BackupCodes codes={codes} />
          ) : (
            <form className="form" onSubmit={submit} noValidate style={{ maxWidth: "24rem" }}>
              <p className="muted">Making new codes cancels the old ones. Enter the current 6-digit code from your authenticator app to continue.</p>
              {error && <Alert>{error}</Alert>}
              <Field id="mfa-code" label="6-digit code">
                <input id="mfa-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} required />
              </Field>
              <button className="btn" disabled={busy || code.length !== 6}>{busy ? "Making codes…" : "Make new backup codes"}</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
