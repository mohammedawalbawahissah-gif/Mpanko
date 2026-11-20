import { describe, expect, it } from "vitest";
import { sortIcon } from "./sortIcon";

describe("sortIcon", () => {
  it("reads what is sorted and which way from the value", () => {
    expect(sortIcon("-created_at")).toEqual({ kind: "date", dir: "desc" });
    expect(sortIcon("created_at")).toEqual({ kind: "date", dir: "asc" });
    expect(sortIcon("base_price")).toEqual({ kind: "price", dir: "asc" });
    expect(sortIcon("-grand_total")).toEqual({ kind: "price", dir: "desc" });
    expect(sortIcon("name-desc")).toEqual({ kind: "name", dir: "desc" });
    expect(sortIcon("-order_count")).toEqual({ kind: "count", dir: "desc" });
    expect(sortIcon("status").kind).toBe("status");
    expect(sortIcon("menu").kind).toBe("menu");
    expect(sortIcon("action").kind).toBe("name");
  });
});
