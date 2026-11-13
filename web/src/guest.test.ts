import { beforeEach, describe, expect, it } from "vitest";
import { readGuestSession, saveGuestSession } from "./guest-session";
import { flatErrors } from "./pages-guest";

describe("guest session", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips and clears", () => {
    expect(readGuestSession()).toBeNull();
    saveGuestSession({ number: "MP-1", token: "abc" });
    expect(readGuestSession()).toEqual({ number: "MP-1", token: "abc" });
    saveGuestSession(null);
    expect(readGuestSession()).toBeNull();
  });
  it("ignores damaged storage", () => {
    localStorage.setItem("mpanko.guestOrder", "{not json");
    expect(readGuestSession()).toBeNull();
    localStorage.setItem("mpanko.guestOrder", JSON.stringify({ number: 5 }));
    expect(readGuestSession()).toBeNull();
  });
});

describe("flatErrors", () => {
  it("flattens nested address errors", () => {
    expect(flatErrors({ email: ["Enter a valid email."], address: { line1: ["Required."], city: ["Required."] } })).toEqual({
      email: "Enter a valid email.", line1: "Required.", city: "Required.",
    });
  });
  it("copes with strings and empty input", () => {
    expect(flatErrors({ detail: "No." })).toEqual({ detail: "No." });
    expect(flatErrors(null)).toEqual({});
  });
});
