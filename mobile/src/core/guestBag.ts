/** The bag of someone who has not signed in (guest checkout), kept on the phone, and the link to their last guest order. */
import type { KeyValueStore } from "./cache";

export const GUEST_CART_KEY = "mpanko.guestCart";
export const GUEST_ORDER_KEY = "mpanko.guestOrder";
export const MAX_QUANTITY = 20;

export interface GuestLine {
  variantId: number;
  slug: string;
  name: string;
  variantName: string;
  unitPrice: string;
  currency: string;
  quantity: number;
}

export interface GuestOrderLink {
  number: string;
  token: string;
}

const clamp = (n: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.floor(n)));

export function addLine(lines: GuestLine[], line: GuestLine): GuestLine[] {
  const found = lines.find((l) => l.variantId === line.variantId);
  if (!found) return [...lines, { ...line, quantity: clamp(line.quantity) }];
  return lines.map((l) => (l.variantId === line.variantId ? { ...l, quantity: clamp(l.quantity + line.quantity) } : l));
}

/** A quantity below 1 removes the line. */
export function setQuantity(lines: GuestLine[], variantId: number, quantity: number): GuestLine[] {
  if (quantity < 1) return removeLine(lines, variantId);
  return lines.map((l) => (l.variantId === variantId ? { ...l, quantity: clamp(quantity) } : l));
}

export function removeLine(lines: GuestLine[], variantId: number): GuestLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

export function countItems(lines: GuestLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

export function checkoutItems(lines: GuestLine[]): { variant: number; quantity: number }[] {
  return lines.map((l) => ({ variant: l.variantId, quantity: l.quantity }));
}

export function isEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

function validLine(v: unknown): v is GuestLine {
  const l = v as Partial<GuestLine> | null;
  return !!l && Number.isInteger(l.variantId) && typeof l.slug === "string" && typeof l.name === "string" && typeof l.unitPrice === "string" &&
    typeof l.currency === "string" && Number.isInteger(l.quantity) && (l.quantity as number) >= 1;
}

/** Anything unreadable is dropped rather than crashing the bag. */
export async function loadBag(store: KeyValueStore): Promise<GuestLine[]> {
  try {
    const raw = await store.getItem(GUEST_CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(validLine).map((l) => ({ ...l, variantName: l.variantName ?? "", quantity: clamp(l.quantity) })) : [];
  } catch {
    return [];
  }
}

export async function saveBag(store: KeyValueStore, lines: GuestLine[]): Promise<void> {
  try {
    if (lines.length) await store.setItem(GUEST_CART_KEY, JSON.stringify(lines));
    else await store.removeItem(GUEST_CART_KEY);
  } catch {
    /* storage full or unavailable: the bag still works for this session */
  }
}

export async function loadGuestOrder(store: KeyValueStore): Promise<GuestOrderLink | null> {
  try {
    const v = JSON.parse((await store.getItem(GUEST_ORDER_KEY)) ?? "null");
    return v && typeof v.number === "string" && typeof v.token === "string" ? { number: v.number, token: v.token } : null;
  } catch {
    return null;
  }
}

export async function saveGuestOrder(store: KeyValueStore, link: GuestOrderLink | null): Promise<void> {
  try {
    if (link) await store.setItem(GUEST_ORDER_KEY, JSON.stringify(link));
    else await store.removeItem(GUEST_ORDER_KEY);
  } catch {
    /* the emailed link still works */
  }
}

/** After sign-in, move guest lines into the account's bag. Lines the shop refuses are skipped, not fatal. */
export async function mergeIntoAccount(lines: GuestLine[], add: (variantId: number, quantity: number) => Promise<unknown>): Promise<number> {
  let moved = 0;
  for (const l of lines) {
    try {
      await add(l.variantId, l.quantity);
      moved += 1;
    } catch {
      /* no longer available */
    }
  }
  return moved;
}
