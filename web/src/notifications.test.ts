import { describe, expect, it } from "vitest";
import { inboxLink, urlBase64ToBytes } from "./notifications";

describe("inboxLink", () => {
  it("turns a notification path into a page of the shop", () => {
    expect(inboxLink("orders/MP-1234")).toBe("/orders/MP-1234");
    expect(inboxLink("support/SUP-9")).toBe("/support/SUP-9");
    expect(inboxLink("/orders")).toBe("/orders");
  });
});

describe("urlBase64ToBytes", () => {
  it("decodes the URL-safe key the browser needs", () => {
    expect(Array.from(urlBase64ToBytes("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToBytes("-_8"))).toEqual([251, 255]);
  });
});
