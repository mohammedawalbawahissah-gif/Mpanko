import { describe, expect, it } from "vitest";
import { callLink, emailLink, formatPhone, whatsappLink } from "./phone";

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
