import { describe, expect, it } from "vitest";
import { badgeText, routeForPath } from "./inbox";

describe("routeForPath", () => {
  it("opens the order or support case a notification is about", () => {
    expect(routeForPath("orders/MP-1234")).toEqual({ screen: "OrderDetail", params: { number: "MP-1234" } });
    expect(routeForPath("support/SUP-9")).toEqual({ screen: "SupportThread", params: { number: "SUP-9" } });
  });
  it("falls back to the lists", () => {
    expect(routeForPath("support")).toEqual({ screen: "SupportList" });
    expect(routeForPath("orders")).toEqual({ screen: "Orders" });
    expect(routeForPath("something/else")).toEqual({ screen: "Orders" });
  });
});

describe("badgeText", () => {
  it("hides zero and caps large counts", () => {
    expect([badgeText(0), badgeText(3), badgeText(100)]).toEqual(["", "3", "99+"]);
  });
});
