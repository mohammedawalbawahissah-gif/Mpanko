// The signed link for the last guest order, kept on this device so we can finish paying after the redirect.
const GUEST_ORDER_KEY = "mpanko.guestOrder";
export interface GuestSession {
  number: string;
  token: string;
}
export function readGuestSession(): GuestSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(GUEST_ORDER_KEY) ?? "null");
    return v && typeof v.number === "string" && typeof v.token === "string" ? v : null;
  } catch {
    return null;
  }
}
export function saveGuestSession(s: GuestSession | null): void {
  try {
    if (s) localStorage.setItem(GUEST_ORDER_KEY, JSON.stringify(s));
    else localStorage.removeItem(GUEST_ORDER_KEY);
  } catch {
    /* private mode: the emailed link still works */
  }
}

