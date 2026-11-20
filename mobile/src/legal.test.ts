import { describe, expect, it } from "vitest";
import { blocks } from "./screens-legal";

describe("legal page text", () => {
  it("splits headings and paragraphs", () => {
    expect(blocks("# Returns\n30 days.\n\nPlain paragraph.\n\n\n")).toEqual([{ heading: "Returns", text: "30 days." }, { text: "Plain paragraph." }]);
  });
  it("shows markup as text, not as html", () => {
    expect(blocks("<b>x</b>")[0].text).toBe("<b>x</b>");
  });
});
