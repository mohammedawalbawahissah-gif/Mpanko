import { describe, expect, it } from "vitest";
import { parseTarget } from "./links";

describe("alert links", () => {
  it("opens an order from a push link or a stored path", () => {
    expect(parseTarget("mpanko-admin://orders/MP-1001")).toEqual({ screen: "order", ref: "MP-1001" });
    expect(parseTarget("orders/MP-1001")).toEqual({ screen: "order", ref: "MP-1001" });
  });
  it("opens the lists for alerts without a reference", () => {
    expect(parseTarget("mpanko-admin://orders")).toEqual({ screen: "orders" });
    expect(parseTarget("manual-payments")).toEqual({ screen: "payments" });
    expect(parseTarget("/support/")).toEqual({ screen: "support" });
  });
  it("falls back to the alerts list for anything unknown or empty", () => {
    expect(parseTarget("")).toEqual({ screen: "alerts" });
    expect(parseTarget(null)).toEqual({ screen: "alerts" });
    expect(parseTarget("mpanko-admin://nowhere/1")).toEqual({ screen: "alerts" });
  });
});
