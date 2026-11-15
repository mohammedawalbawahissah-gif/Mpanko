import { describe, expect, it } from "vitest";
import { cardWidth, layoutFor } from "./layout";

describe("layoutFor", () => {
  it("keeps one column on a phone", () => {
    expect(layoutFor(390)).toMatchObject({ isTablet: false, columns: 1 });
    expect(layoutFor(599)).toMatchObject({ isTablet: false, columns: 1 });
  });
  it("uses two columns on a tablet held upright", () => {
    expect(layoutFor(600)).toMatchObject({ isTablet: true, columns: 2 });
    expect(layoutFor(820)).toMatchObject({ isTablet: true, columns: 2 });
  });
  it("uses three columns on a wide screen", () => {
    expect(layoutFor(900)).toMatchObject({ isTablet: true, columns: 3 });
    expect(layoutFor(1180).columns).toBe(3);
  });
  it("copes with a width of zero", () => {
    expect(layoutFor(0)).toMatchObject({ width: 0, columns: 1 });
  });
});

describe("cardWidth", () => {
  it("fits the cards and the gaps inside the list", () => {
    const l = layoutFor(820);
    const w = cardWidth(l, 10, 12);
    expect(w * 2 + 10 + 24).toBeLessThanOrEqual(820);
    expect(w).toBe(393);
  });
});
