import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { api } from "./api";
import { useAuth } from "./auth";

type Listener = (n: number) => void;
const listeners = new Set<Listener>();
let current = 0;

/** Ask the server how many notifications are unread and tell every bell. Call after reading, deleting, or receiving one. */
export async function refreshUnread(): Promise<void> {
  try {
    const r = await api<{ count: number }>("/notifications/inbox/unread-count/");
    current = r.count;
    listeners.forEach((l) => l(current));
  } catch {
    /* offline: keep the last number */
  }
}

/** The unread count, refreshed every minute, whenever the app comes to the front, and after any change. */
export function useUnreadCount(): number {
  const { user } = useAuth();
  const [n, setN] = useState(current);
  useEffect(() => {
    if (!user) {
      setN(0);
      return;
    }
    listeners.add(setN);
    void refreshUnread();
    const timer = setInterval(() => void refreshUnread(), 60_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refreshUnread());
    return () => {
      listeners.delete(setN);
      clearInterval(timer);
      sub.remove();
    };
  }, [user]);
  return user ? n : 0;
}
