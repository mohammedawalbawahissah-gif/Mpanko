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

export type ContactKind = "phone" | "whatsapp" | "email";
export interface ShopContact { kind: ContactKind; label: string; value: string }
export interface ContactLink { kind: ContactKind; label: string; href: string; external: boolean; placeholder: boolean }

/** Every contact the shop lists, ready to show as a button: a link for each, in the order staff set. If the server sent none (an older server),
 * the three single settings stand in. While developing, a placeholder of each kind shows if nothing is set, so the layout can be checked. */
export function contactLinks(
  config: { contacts?: ShopContact[]; support_email?: string; support_phone?: string; whatsapp_number?: string } | null | undefined,
  isDev: boolean,
): ContactLink[] {
  let rows: ShopContact[] = (config?.contacts ?? []).filter((c) => c && c.value);
  if (!rows.length) {
    rows = [
      { kind: "email" as const, label: "", value: config?.support_email ?? "" },
      { kind: "phone" as const, label: "", value: config?.support_phone ?? "" },
      { kind: "whatsapp" as const, label: "", value: config?.whatsapp_number ?? "" },
    ].filter((c) => c.value.trim());
  }
  const out: ContactLink[] = rows.map((c) => {
    if (c.kind === "email") return { kind: c.kind, label: c.label, href: `mailto:${c.value.trim()}`, external: false, placeholder: false };
    if (c.kind === "whatsapp") return { kind: c.kind, label: c.label, href: `https://wa.me/${c.value.replace(/\D/g, "")}`, external: true, placeholder: false };
    return { kind: c.kind, label: c.label, href: `tel:${c.value.replace(/[^+\d]/g, "")}`, external: false, placeholder: false };
  });
  if (!out.length && isDev) {
    const mail = emailLink(undefined, true), call = callLink(undefined, true), wa = whatsappLink(undefined, true);
    return [
      { kind: "email", label: "", href: mail!.href, external: false, placeholder: true },
      { kind: "phone", label: "", href: call!.href, external: false, placeholder: true },
      { kind: "whatsapp", label: "", href: wa!.href, external: true, placeholder: true },
    ];
  }
  return out;
}
