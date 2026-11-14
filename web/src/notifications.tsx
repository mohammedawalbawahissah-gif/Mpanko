import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./context";
import { useT } from "./i18n";

export interface InboxItem { id: number; key: string; title: string; body: string; path: string; is_read: boolean; created_at: string }

const CHANGED = "mpanko:inbox-changed";
/** Tell the bell (and any list) that something was read, deleted or added, so counts refresh at once. */
export const inboxChanged = () => window.dispatchEvent(new Event(CHANGED));

/** Where a notification leads: the same path the phone app uses, as a page of the shop. */
export const inboxLink = (path: string) => `/${path.replace(/^\/+/, "")}`;

/** How many notifications are unread. Checked on a timer, when the tab is shown again, and whenever the list changes. */
export function useUnreadCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    if (!user) return;
    api<{ count: number }>("/notifications/inbox/unread-count/").then((r) => setCount(r.count)).catch(() => undefined);
  }, [user]);
  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    load();
    const timer = setInterval(load, 60_000);
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener(CHANGED, load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener(CHANGED, load);
    };
  }, [user, load]);
  return count;
}

/** The bell in the header: a link to the list with the number of unread notifications. */
export function NotificationBell() {
  const { t } = useT();
  const n = useUnreadCount();
  const label = n ? `${t("notifications.title")}, ${t("notifications.unread", { n })}` : t("notifications.title");
  return (
    <Link to="/notifications" className="icon-link bell-link" aria-label={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && <span className="bell-count" aria-hidden="true">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

/* ----------------------------------------------------------- browser push */

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The browser wants the public key as bytes. */
export function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentBrowserSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return reg ? reg.pushManager.getSubscription() : null;
}

export type EnableResult = "ok" | "blocked" | "unavailable";

/** Ask permission, subscribe this browser, and tell the shop. */
export async function enableBrowserPush(): Promise<EnableResult> {
  if (!pushSupported()) return "unavailable";
  const { public_key } = await api<{ public_key: string }>("/notifications/web-push/key/");
  if (!public_key) return "unavailable";
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(public_key) }));
  const json = sub.toJSON();
  await api("/notifications/web-push/", { method: "POST", body: { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
  return "ok";
}

export async function disableBrowserPush(): Promise<void> {
  const sub = await currentBrowserSubscription();
  if (!sub) return;
  await api("/notifications/web-push/", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}
