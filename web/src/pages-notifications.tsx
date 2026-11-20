import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Page } from "./api";
import { Alert, Loading } from "./components";
import { useT } from "./i18n";
import { disableBrowserPush, enableBrowserPush, currentBrowserSubscription, inboxChanged, inboxLink, pushSupported, type InboxItem } from "./notifications";

export function Notifications() {
  const { t } = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Page<InboxItem>>(`/notifications/inbox/?page=${page}`)
      .then((r) => {
        if (cancelled) return;
        setItems((cur) => (page === 1 ? r.results : [...cur, ...r.results]));
        setNext(r.next);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : t("notifications.failed")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = items.filter((i) => !i.is_read).length;
  const open = async (item: InboxItem) => {
    if (!item.is_read) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)));
      await api(`/notifications/inbox/${item.id}/read/`, { method: "POST", body: {} }).catch(() => undefined);
      inboxChanged();
    }
    navigate(inboxLink(item.path));
  };
  const markAll = async () => {
    setItems((cur) => cur.map((i) => ({ ...i, is_read: true })));
    await api("/notifications/inbox/read-all/", { method: "POST", body: {} }).catch(() => undefined);
    inboxChanged();
  };
  const remove = async (id: number) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
    await api(`/notifications/inbox/${id}/`, { method: "DELETE" }).catch(() => undefined);
    inboxChanged();
  };

  return (
    <div className="wrap page">
      <h1>{t("notifications.title")}</h1>
      {error && <Alert>{error}</Alert>}
      {loading && page === 1 && <Loading what={t("notifications.title")} />}
      {!loading && !error && items.length === 0 && <p className="muted">{t("notifications.empty")}</p>}
      {items.length > 0 && (
        <p className="notif-bar">
          <span className="muted">{t("notifications.unread", { n: unread })}</span>
          {unread > 0 && <button type="button" className="btn quiet sm" onClick={markAll}>{t("notifications.markAll")}</button>}
        </p>
      )}
      <ul className="notif-list">
        {items.map((i) => (
          <li key={i.id} className={i.is_read ? "notif" : "notif unread"}>
            <Link to={inboxLink(i.path)} className="notif-main" onClick={(e) => { e.preventDefault(); void open(i); }}>
              <strong>{i.title}</strong>
              {i.body && <span>{i.body}</span>}
              <time className="small muted" dateTime={i.created_at}>{new Date(i.created_at).toLocaleString()}</time>
            </Link>
            <button type="button" className="link-button" onClick={() => remove(i.id)}>{t("notifications.delete")}</button>
          </li>
        ))}
      </ul>
      {next && <button type="button" className="btn quiet" disabled={loading} onClick={() => setPage((p) => p + 1)}>{t("notifications.more")}</button>}
    </div>
  );
}

/** A switch on the account page: show order and support updates as notifications in this browser. Hidden where the browser can't. */
export function BrowserPushToggle() {
  const { t } = useT();
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!pushSupported()) return;
    let cancelled = false;
    Promise.all([api<{ public_key: string }>("/notifications/web-push/key/"), currentBrowserSubscription()])
      .then(([k, sub]) => {
        if (cancelled) return;
        setAvailable(!!k.public_key);
        setOn(!!sub && Notification.permission === "granted");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;
  const change = async (want: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      if (want) {
        const r = await enableBrowserPush();
        if (r === "blocked") setMessage(t("notifications.blocked"));
        setOn(r === "ok");
      } else {
        await disableBrowserPush();
        setOn(false);
      }
    } catch {
      setMessage(t("notifications.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>{t("notifications.browser")}</h2>
      <p className="small muted">{t("notifications.browserHelp")}</p>
      {message && <Alert>{message}</Alert>}
      <label className="small"><input type="checkbox" checked={on} disabled={busy} onChange={(e) => void change(e.target.checked)} /> {t("notifications.browser")}</label>
    </section>
  );
}

type Cell = { enabled: boolean; locked: boolean; available: boolean };
type PrefRow = { category: string; label: string; channels: Record<"email" | "sms" | "whatsapp" | "push", Cell> };
type Prefs = { categories: PrefRow[]; marketing_opt_in: boolean; phone_verified: boolean; has_push_device: boolean };

const CHANNELS = ["email", "sms", "whatsapp", "push"] as const;

/** Account > Message settings: choose, per kind of message, how Mpanko contacts the customer. */
export function MessageSettings() {
  const { t } = useT();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Prefs>("/notifications/preferences/").then(setPrefs).catch(() => setError(t("notifications.failed")));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: object) => {
    setError("");
    try {
      setPrefs(await api<Prefs>("/notifications/preferences/", { method: "PUT", body }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(t("notifications.failed"));
    }
  };

  if (!prefs) return error ? <div className="wrap page"><Alert>{error}</Alert></div> : <div className="wrap page"><Loading /></div>;
  const name = (key: string) => t(`msg.${key}` as never);
  return (
    <div className="wrap page narrow">
      <p><Link to="/account">{t("msg.back")}</Link></p>
      <h1>{t("msg.title")}</h1>
      <p className="muted">{t("msg.intro")}</p>
      {error && <Alert>{error}</Alert>}
      <label className="small" style={{ display: "block", margin: "1rem 0" }}>
        <input type="checkbox" checked={prefs.marketing_opt_in} onChange={(e) => send({ marketing_opt_in: e.target.checked })} /> {t("msg.offersOptIn")}
      </label>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr><th scope="col" /> {CHANNELS.map((c) => <th scope="col" key={c}>{name(c)}</th>)}</tr>
          </thead>
          <tbody>
            {prefs.categories.map((row) => (
              <tr key={row.category}>
                <th scope="row">{name(row.category)}</th>
                {CHANNELS.map((ch) => {
                  const cell = row.channels[ch];
                  const needs = ch === "sms" || ch === "whatsapp" ? t("msg.needPhone") : ch === "push" ? t("msg.needPush") : "";
                  const blocked = row.category === "offers" && !prefs.marketing_opt_in;
                  return (
                    <td key={ch}>
                      {cell.locked ? (
                        <span className="small">{t("msg.alwaysOn")}</span>
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`${name(row.category)}: ${name(ch)}`}
                          title={!cell.available ? needs : undefined}
                          checked={cell.enabled}
                          disabled={blocked || (!cell.available && !cell.enabled && ch !== "push")}
                          onChange={(e) => send({ categories: { [row.category]: { [ch]: e.target.checked } } })}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!prefs.phone_verified && <p className="small muted">{t("msg.needPhone")}</p>}
      <p className="small" role="status" aria-live="polite">{saved ? t("msg.saved") : ""}</p>
    </div>
  );
}
