import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getTokens, setTokens } from "./api";

function reply(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("ApiError", () => {
  it("uses the server's detail message", () => {
    expect(new ApiError(400, { detail: "Cart is empty." }).message).toBe("Cart is empty.");
  });
  it("falls back to the first field error", () => {
    expect(new ApiError(400, { email: ["Already registered."] }).message).toBe("Already registered.");
  });
  it("exposes field errors by name", () => {
    expect(new ApiError(400, { email: ["Bad email"], phone: "Bad phone" }).fields()).toEqual({ email: "Bad email", phone: "Bad phone" });
  });
  it("has a readable default", () => {
    expect(new ApiError(500, null).message).toBe("Request failed (500)");
  });
});

describe("tokens", () => {
  it("round-trips and clears", () => {
    setTokens({ access: "a", refresh: "r" });
    expect(getTokens()).toEqual({ access: "a", refresh: "r" });
    setTokens(null);
    expect(getTokens()).toBeNull();
  });
  it("survives corrupt storage", () => {
    localStorage.setItem("mpanko.tokens", "{not json");
    expect(getTokens()).toBeNull();
  });
});

describe("api()", () => {
  it("sends the bearer token and JSON body", async () => {
    setTokens({ access: "tok", refresh: "r" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ ok: true }));
    await api("/cart/items/", { method: "POST", body: { variant: 1 } });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBe(JSON.stringify({ variant: 1 }));
  });

  it("turns a network failure into a friendly error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await expect(api("/products/")).rejects.toMatchObject({ status: 0 });
  });

  it("throws ApiError with the server message on 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ detail: "Out of stock." }, 400));
    await expect(api("/checkout/", { method: "POST", body: {} })).rejects.toThrow("Out of stock.");
  });

  it("refreshes an expired token once and retries", async () => {
    setTokens({ access: "old", refresh: "ref" });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply({ detail: "expired" }, 401))
      .mockResolvedValueOnce(reply({ access: "new" }))
      .mockResolvedValueOnce(reply({ ok: 1 }));
    expect(await api("/orders/")).toEqual({ ok: 1 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(getTokens()?.access).toBe("new");
  });

  it("signs the user out when refresh fails", async () => {
    setTokens({ access: "old", refresh: "bad" });
    const signedOut = vi.fn();
    window.addEventListener("mpanko:signed-out", signedOut);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ detail: "no" }, 401));
    await expect(api("/orders/")).rejects.toBeInstanceOf(ApiError);
    expect(getTokens()).toBeNull();
    expect(signedOut).toHaveBeenCalled();
  });

  it("returns undefined for 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api("/auth/addresses/1/", { method: "DELETE" })).toBeUndefined();
  });
});
