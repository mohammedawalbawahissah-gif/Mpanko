import { describe, expect, it } from "vitest";
import { callLink, formatPhone } from "./phone";

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
