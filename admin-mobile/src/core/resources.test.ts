import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asPercent, byKey, fromPercent, GROUPS, navFor, NAV, RESOURCES } from "./resources";

describe("admin sections", () => {
  it("every menu entry opens a real list or a registered screen", () => {
    const app = readFileSync("App.tsx", "utf8");
    for (const n of NAV) {
      if (n.res) expect(byKey(n.res), n.name).toBeTruthy();
      else expect(app.includes(`name="${n.screen}"`), n.name).toBe(true);
      expect(GROUPS).toContain(n.group);
    }
  });
  it("resource keys are unique", () => {
    const keys = RESOURCES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("shows each role only its sections", () => {
    expect(navFor("support").some((n) => n.key === "staff")).toBe(false);
    expect(navFor("super_admin").some((n) => n.key === "staff")).toBe(true);
    expect(navFor("finance").some((n) => n.key === "reconciliation")).toBe(true);
  });
  it("converts shares to percentages and back without float noise", () => {
    expect(asPercent("0.125")).toBe("12.5%");
    expect(fromPercent("12.5%")).toBe("0.125");
    expect(fromPercent("abc")).toBe("");
  });
});
