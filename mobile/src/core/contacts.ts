/** The shop's contact buttons: one for each contact the shop lists, in the order staff set. */
export type ContactKind = "phone" | "whatsapp" | "email";
export interface ShopContact { kind: ContactKind; label: string; value: string }
export interface ContactItem { kind: ContactKind; label: string; url: string }
export interface ContactConfig { contacts?: ShopContact[]; support_email?: string; support_phone?: string; whatsapp_number?: string }

const urlFor = (kind: ContactKind, value: string): string =>
  kind === "email" ? `mailto:${value.trim()}` : kind === "whatsapp" ? `https://wa.me/${value.replace(/\D/g, "")}` : `tel:${value.replace(/[^+\d]/g, "")}`;

/** From the server's list, or the three single settings when an older server sends no list. While developing, placeholders stand in so the layout can be checked. */
export function contactItems(config: ContactConfig | null | undefined, isDev: boolean): ContactItem[] {
  let rows: ShopContact[] = (config?.contacts ?? []).filter((c) => c && String(c.value ?? "").trim());
  if (!rows.length) {
    rows = ([
      { kind: "email", label: "", value: config?.support_email ?? "" },
      { kind: "phone", label: "", value: config?.support_phone ?? "" },
      { kind: "whatsapp", label: "", value: config?.whatsapp_number ?? "" },
    ] as ShopContact[]).filter((c) => c.value.trim());
  }
  if (!rows.length && isDev) {
    rows = [
      { kind: "email", label: "", value: "help@mpanko.example" },
      { kind: "phone", label: "", value: "+233 00 000 0000" },
      { kind: "whatsapp", label: "", value: "233000000000" },
    ];
  }
  return rows.map((c) => ({ kind: c.kind, label: (c.label ?? "").trim(), url: urlFor(c.kind, c.value) }));
}
