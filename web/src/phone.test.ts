import { describe, expect, it } from "vitest";
import { callLink, contactLinks, emailLink, formatPhone, whatsappLink } from "./phone";

describe("callLink", () => {
  it("dials the configured number, stripping spaces and punctuation", () => {
    expect(callLink("+233 24 000 0000", false)).toMatchObject({ href: "tel:+233240000000", placeholder: false });
    expect(callLink("(020) 123-4567", false)?.href).toBe("tel:0201234567");
  });
  it("shows a placeholder only while developing", () => {
    expect(callLink("", true)).toMatchObject({ label: "+233 00 000 0000", placeholder: true });
    expect(callLink(undefined, false)).toBeNull();
  });
  it("groups Ghana numbers for reading", () => {
    expect(formatPhone("+233240000000")).toBe("+233 24 000 0000");
  });
});

describe("emailLink and whatsappLink", () => {
  it("link the configured values", () => {
    expect(emailLink("help@mpanko.com", false)).toMatchObject({ href: "mailto:help@mpanko.com", placeholder: false });
    expect(whatsappLink("+233 24 123 4567", false)?.href).toBe("https://wa.me/233241234567");
  });
  it("use placeholders only while developing", () => {
    expect(emailLink("", true)?.placeholder).toBe(true);
    expect(whatsappLink("", true)?.placeholder).toBe(true);
    expect(emailLink("", false)).toBeNull();
    expect(whatsappLink(undefined, false)).toBeNull();
  });
});


describe("contactLinks", () => {
  const rows = [
    { kind: "phone" as const, label: "Sales", value: "+233 20 000 0001" },
    { kind: "phone" as const, label: "Support", value: "+233200000002" },
    { kind: "whatsapp" as const, label: "", value: "233200000003" },
    { kind: "email" as const, label: "Orders", value: "orders@example.com" },
  ];
  it("makes one link per contact, in order, each opening the right app", () => {
    const links = contactLinks({ contacts: rows }, false);
    expect(links.map((l) => l.href)).toEqual(["tel:+233200000001", "tel:+233200000002", "https://wa.me/233200000003", "mailto:orders@example.com"]);
    expect(links.map((l) => l.label)).toEqual(["Sales", "Support", "", "Orders"]);
    expect(links[2].external).toBe(true);
  });
  it("falls back to the single settings when the server sends no list", () => {
    const links = contactLinks({ support_email: "help@example.com", support_phone: "+233240000000", whatsapp_number: "" }, false);
    expect(links.map((l) => l.kind)).toEqual(["email", "phone"]);
  });
  it("shows nothing in production when nothing is set, and placeholders while developing", () => {
    expect(contactLinks({ contacts: [] }, false)).toEqual([]);
    expect(contactLinks(null, true).every((l) => l.placeholder)).toBe(true);
    expect(contactLinks(null, true)).toHaveLength(3);
  });
  it("ignores empty entries", () => {
    expect(contactLinks({ contacts: [{ kind: "email", label: "", value: "" }] }, false)).toEqual([]);
  });
});
