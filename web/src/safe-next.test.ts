import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps paths inside the site", () => {
    expect(safeNext("/checkout")).toBe("/checkout");
    expect(safeNext("/orders/MP-1?tab=items#x")).toBe("/orders/MP-1?tab=items#x");
  });
  it("falls back for anything that could leave the site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "\\\\evil.example", "https://evil.example", "javascript:alert(1)", "/%5Cevil.example", "/%2F/evil.example".replace("%2F/", "/"), "/\t/evil.example", "evil", "", null, undefined, "%E0%A4%A"]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).toBe("/");
    }
  });
});
