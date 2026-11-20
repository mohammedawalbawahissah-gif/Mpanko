import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchBox, SortButtons, sortIcon, StatusPill, pattern, routeTitle, statusLabel } from "./components";

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

describe("search and sort controls", () => {
  it("one search bar carries a drop-down of what to search by", () => {
    const html = renderToStaticMarkup(<SearchBox id="q" label="Search" value="" onChange={() => undefined} field="name" onField={() => undefined} fields={[{ value: "", label: "Everything" }, { value: "name", label: "Name" }]} />);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain("<select");
    expect(html).toContain("Everything");
    expect(html).toContain("Name");
  });
  it("sort choices are buttons, with the chosen one pressed and no select box", () => {
    const html = renderToStaticMarkup(<SortButtons label="Sort by" value="b" onChange={() => undefined} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(html).not.toContain("<select");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
  });
  it("sort buttons are icons with a spoken name and a tooltip, and the chosen one is named beside them", () => {
    const html = renderToStaticMarkup(<SortButtons label="Sort by" value="-created_at" onChange={() => undefined} options={[{ value: "-created_at", label: "Newest first" }, { value: "name", label: "Name A to Z" }]} />);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Newest first"');
    expect(html).toContain('title="Name A to Z"');
    expect(html).toContain('class="sortbuttons-current"');
  });
  it("reads the icon from the sort value", () => {
    expect(sortIcon("-grand_total")).toEqual({ kind: "price", dir: "desc" });
    expect(sortIcon("created_at")).toEqual({ kind: "date", dir: "asc" });
    expect(sortIcon("name")).toEqual({ kind: "name", dir: "asc" });
  });
});
