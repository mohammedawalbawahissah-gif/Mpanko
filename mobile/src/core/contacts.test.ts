import { describe, expect, it } from "vitest";
import { contactItems } from "./contacts";

describe("contactItems", () => {
  const rows = [
    { kind: "phone" as const, label: "Sales", value: "+233 20 000 0001" },
    { kind: "whatsapp" as const, label: "Orders", value: "233200000002" },
    { kind: "whatsapp" as const, label: "Wholesale", value: "233200000003" },
    { kind: "email" as const, label: "", value: "help@example.com" },
  ];
  it("gives one item per contact, in order, each with the right link", () => {
    const items = contactItems({ contacts: rows }, false);
    expect(items.map((i) => i.url)).toEqual(["tel:+233200000001", "https://wa.me/233200000002", "https://wa.me/233200000003", "mailto:help@example.com"]);
    expect(items.map((i) => i.label)).toEqual(["Sales", "Orders", "Wholesale", ""]);
  });
  it("uses the single settings when the server sends no list", () => {
    expect(contactItems({ support_email: "a@b.co", support_phone: "", whatsapp_number: "233200000009" }, false).map((i) => i.kind)).toEqual(["email", "whatsapp"]);
  });
  it("shows nothing in a release build with nothing set, and placeholders while developing", () => {
    expect(contactItems(null, false)).toEqual([]);
    expect(contactItems({}, true)).toHaveLength(3);
  });
  it("skips blank entries", () => {
    expect(contactItems({ contacts: [{ kind: "email", label: "x", value: "  " }] }, false)).toEqual([]);
  });
});
