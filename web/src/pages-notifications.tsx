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
