import { describe, expect, it } from "vitest";
import { DEV_API_URL, resolveApiBase } from "./apiBase";

describe("resolveApiBase", () => {
  it("falls back to the emulator address only in development", () => {
    expect(resolveApiBase(undefined, true)).toBe(DEV_API_URL);
    expect(() => resolveApiBase(undefined, false)).toThrow();
    expect(() => resolveApiBase("", false)).toThrow();
  });
  it("refuses placeholders and plain http in a release build", () => {
    expect(() => resolveApiBase("https://YOUR-API.up.railway.app/api/v1", false)).toThrow();
    expect(() => resolveApiBase("http://api.example.com/api/v1", false)).toThrow();
  });
  it("accepts a real https address", () => {
    expect(resolveApiBase("https://api.example.com/api/v1/", false)).toBe("https://api.example.com/api/v1");
  });
});
