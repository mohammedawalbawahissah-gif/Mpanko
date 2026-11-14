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
