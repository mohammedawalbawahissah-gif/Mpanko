import { describe, expect, it } from "vitest";
import { label, nextSteps, when } from "./format";

describe("formatting", () => {
  it("makes statuses readable", () => expect(label("pending_payment")).toBe("Pending payment"));
  it("says how long ago", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(when("2026-11-20T11:59:50Z", now)).toBe("Just now");
    expect(when("2026-11-20T11:30:00Z", now)).toBe("30 min ago");
    expect(when("2026-11-20T09:00:00Z", now)).toBe("3 h ago");
    expect(when("2026-11-10T09:00:00Z", now)).toBe("2026-11-10");
    expect(when(null, now)).toBe("");
  });
});

describe("order steps", () => {
  it("offers fulfilment steps to fulfilment roles only", () => {
    expect(nextSteps("paid", "fulfillment")).toEqual(["processing", "cancelled"]);
    expect(nextSteps("paid", "support")).toEqual([]);
  });
  it("never offers payment states", () => {
    for (const s of ["pending_payment", "paid", "processing", "shipped"]) expect(nextSteps(s, "super_admin")).not.toContain("paid");
  });
  it("lets finance cancel but not ship", () => {
    expect(nextSteps("processing", "finance")).toEqual(["cancelled"]);
  });
});
