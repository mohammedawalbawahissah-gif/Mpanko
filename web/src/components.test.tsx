import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusPill, pattern, statusLabel } from "./components";

describe("statusLabel", () => {
  it("makes API statuses readable", () => {
    expect(statusLabel("out_for_delivery")).toBe("Out for delivery");
    expect(statusLabel("paid")).toBe("Paid");
  });
});

describe("StatusPill", () => {
  it("shows the label and a class for styling", () => {
    const html = renderToStaticMarkup(<StatusPill status="in_transit" />);
    expect(html).toContain("In transit");
    expect(html).toContain("status in_transit");
  });
});

describe("pattern", () => {
  it("is deterministic for a seed", () => {
    expect(pattern("kente-scarf")).toEqual(pattern("kente-scarf"));
  });
  it("produces a background for any seed", () => {
    expect(Object.keys(pattern("anything"))).not.toHaveLength(0);
  });
});
