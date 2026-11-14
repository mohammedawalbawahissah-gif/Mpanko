import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusPill, pattern, routeTitle, statusLabel } from "./components";

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

describe("routeTitle", () => {
  const t = (k: string) => `T:${k}`;
  it("names the pages that do not name themselves", () => {
    expect(routeTitle("/bag", t as never)).toBe("T:bag.title");
    expect(routeTitle("/orders/find", t as never)).toBe("T:guest.find");
    expect(routeTitle("/orders/MP-1001/", t as never)).toBe("T:orders.title");
    expect(routeTitle("/checkout/complete", t as never)).toBe("T:checkout.title");
  });
  it("leaves shop, product and legal pages to set their own", () => {
    for (const p of ["/", "/shop", "/shop/kente-scarf", "/privacy", "/terms"]) expect(routeTitle(p, t as never)).toBeUndefined();
  });
  it("calls an unknown address a missing page", () => {
    expect(routeTitle("/nope/nothing", t as never)).toBe("Page not found");
  });
});
