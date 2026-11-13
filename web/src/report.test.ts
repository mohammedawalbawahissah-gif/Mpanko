import { beforeEach, describe, expect, it, vi } from "vitest";

describe("reportError", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sends the path only, once per distinct error", async () => {
    const calls: { parts: string[] }[] = [];
    vi.stubGlobal("Blob", class { constructor(public parts: string[]) {} });
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (_u: string, b: { parts: string[] }) => (calls.push(b), true) });
    window.history.pushState({}, "", "/reset-password?uid=1&token=SECRET");
    const { reportError } = await import("./report");
    reportError(new Error("boom"));
    reportError(new Error("boom"));
    reportError(new Error("other"));
    expect(calls).toHaveLength(2);
    const body = JSON.parse(calls[0].parts[0]);
    expect(body).toMatchObject({ source: "web", message: "Error: boom", url: "/reset-password" });
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("never throws, even if the browser refuses", async () => {
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: () => { throw new Error("blocked"); } });
    const { reportError } = await import("./report");
    expect(() => reportError("string error")).not.toThrow();
  });
});
