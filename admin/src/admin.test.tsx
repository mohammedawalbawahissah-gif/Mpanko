import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { daysLeft } from "./pages-finance";
import { asPercent, fromPercent } from "./pages-tax";
import { Alert, Field, Pill, label, when } from "./ui";
import { BackupCodes } from "./login";

describe("percentages in the tax screens", () => {
  it("shows a share as a percentage", () => {
    expect(asPercent("0.1250")).toBe("12.5%");
    expect(asPercent("0")).toBe("0%");
    expect(asPercent("0.05")).toBe("5%");
    expect(asPercent("nonsense")).toBe("");
  });
  it("turns what staff type into a share", () => {
    expect(fromPercent("12.5")).toBe("0.125");
    expect(fromPercent("12.5%")).toBe("0.125");
    expect(fromPercent(" 0 ")).toBe("0");
    expect(fromPercent("100")).toBe("1");
  });
  it("rejects anything that is not a percentage", () => {
    for (const bad of ["", "abc", "-1", "101", "0.1.2"]) expect(fromPercent(bad)).toBe("");
  });
});

describe("chargeback deadline", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("counts days left, rounding up", () => {
    expect(daysLeft("2026-11-13T12:00:00Z", now)).toBe(3);
    expect(daysLeft("2026-11-10T18:00:00Z", now)).toBe(1);
  });
  it("goes negative once the deadline passes and is null when unknown", () => {
    expect(daysLeft("2026-11-08T00:00:00Z", now)).toBeLessThan(0);
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe("shared pieces", () => {
  it("makes API words readable", () => {
    expect(label("evidence_sent")).toBe("Evidence sent");
    expect(when(null)).toBe("—");
  });
  it("renders a status pill with a class for styling", () => {
    const html = renderToStaticMarkup(<Pill value="out_for_delivery" />);
    expect(html).toContain("s-out_for_delivery");
    expect(html).toContain("Out for delivery");
  });
  it("announces errors to screen readers and shows field errors beside the field", () => {
    expect(renderToStaticMarkup(<Alert>Nope</Alert>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Alert kind="ok">Saved</Alert>)).toContain('role="status"');
    const html = renderToStaticMarkup(<Field id="x" label="Rate" error="Too high"><input id="x" /></Field>);
    expect(html).toContain('for="x"');
    expect(html).toContain("Too high");
  });
});

describe("ApiError", () => {
  it("reads the first message and field errors from a DRF reply", () => {
    const e = new ApiError(400, { rate: ["Enter a share between 0 and 1."], country: "Unknown" });
    expect(e.message).toBe("Enter a share between 0 and 1.");
    expect(e.fields()).toEqual({ rate: "Enter a share between 0 and 1.", country: "Unknown" });
  });
  it("prefers detail", () => {
    expect(new ApiError(403, { detail: "No access" }).message).toBe("No access");
    expect(new ApiError(500, null).message).toBe("Request failed (500)");
  });
});

describe("backup codes", () => {
  it("lists every code once, with the warning that they are shown only once", () => {
    const html = renderToStaticMarkup(<BackupCodes codes={["abcd-efgh", "jkmn-pqrs"]} />);
    expect(html).toContain("abcd-efgh");
    expect(html).toContain("jkmn-pqrs");
    expect(html).toContain("We cannot show them again");
    expect(html).toContain("Download as a file");
  });
});
