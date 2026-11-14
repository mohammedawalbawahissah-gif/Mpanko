import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ALL_COUNTRIES, countryName } from "./countries";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true;
    setLoading(true);
    run()
      .then((d) => live && (setData(d), setError("")))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [run, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function Alert({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="muted" role="status">{what}…</p>;
}

export function Pill({ value }: { value: string }) {
  return <span className={`pill s-${value}`}>{label(value)}</span>;
}

export function label(v: string): string {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function Stat({ name, value, tone }: { name: string; value: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-name">{name}</div>
    </div>
  );
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function PasswordInput({ id, value, onChange, autoComplete, required }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; required?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className="input" type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      <button type="button" className="pw-toggle" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-controls={id}>{shown ? "Hide" : "Show"}</button>
    </div>
  );
}


/** Pick one country from a list. `allowAll` adds an "Everywhere else" choice, stored as "*". */
export function CountrySelect({ id, value, onChange, allowAll, required }: { id: string; value: string; onChange: (v: string) => void; allowAll?: boolean; required?: boolean }) {
  return (
    <select id={id} className="select" value={value} required={required} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a country</option>
      {allowAll && <option value="*">Everywhere else</option>}
      {ALL_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}

/** Build a list of countries by picking them one at a time. The chosen ones show as removable tags. */
export function CountryMultiSelect({ id, value, onChange, allowAll }: { id: string; value: string[]; onChange: (v: string[]) => void; allowAll?: boolean }) {
  const label = (c: string) => (c === "*" ? "Everywhere else" : countryName(c));
  return (
    <div>
      {value.length > 0 && (
        <ul className="chips" aria-label="Chosen countries" style={{ listStyle: "none", padding: 0, margin: "0 0 .5rem", display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
          {value.map((c) => (
            <li key={c} className="pill s-info" style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              {label(c)}
              <button type="button" className="link-button" aria-label={`Remove ${label(c)}`} onClick={() => onChange(value.filter((x) => x !== c))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <select id={id} className="select" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{value.length ? "Add another country" : "Add a country"}</option>
        {allowAll && !value.includes("*") && <option value="*">Everywhere else</option>}
        {ALL_COUNTRIES.filter(([code]) => !value.includes(code)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </div>
  );
}
