/** The number to show and dial for "Call us". While none is set, developers see an obvious placeholder so the layout can be checked. */
export const PLACEHOLDER_PHONE = "+233 00 000 0000";

export function callLink(configured: string | undefined, isDev: boolean): { href: string; label: string; placeholder: boolean } | null {
  const raw = (configured ?? "").trim();
  if (raw) return { href: `tel:${raw.replace(/[^+\d]/g, "")}`, label: formatPhone(raw), placeholder: false };
  if (isDev) return { href: `tel:${PLACEHOLDER_PHONE.replace(/[^+\d]/g, "")}`, label: PLACEHOLDER_PHONE, placeholder: true };
  return null;
}

/** "+233240000000" becomes "+233 24 000 0000"-style grouping for Ghana, and a plain grouped form for anything else. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/[^+\d]/g, "");
  const m = /^\+233(\d{2})(\d{3})(\d{4})$/.exec(d);
  if (m) return `+233 ${m[1]} ${m[2]} ${m[3]}`;
  return raw.trim();
}

export const PLACEHOLDER_EMAIL = "help@mpanko.example";
export const PLACEHOLDER_WHATSAPP = "233000000000";

export function emailLink(configured: string | undefined, isDev: boolean): { href: string; label: string; placeholder: boolean } | null {
  const raw = (configured ?? "").trim();
  if (raw) return { href: `mailto:${raw}`, label: raw, placeholder: false };
  if (isDev) return { href: `mailto:${PLACEHOLDER_EMAIL}`, label: PLACEHOLDER_EMAIL, placeholder: true };
  return null;
}

export function whatsappLink(configured: string | undefined, isDev: boolean): { href: string; placeholder: boolean } | null {
  const digits = (configured ?? "").replace(/\D/g, "");
  if (digits) return { href: `https://wa.me/${digits}`, placeholder: false };
  if (isDev) return { href: `https://wa.me/${PLACEHOLDER_WHATSAPP}`, placeholder: true };
  return null;
}
