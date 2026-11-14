import { describe, expect, it } from "vitest";
import { departmentOf, departments } from "./categories";
import type { Category } from "./types";

const c = (id: number, name: string, parent: number | null = null, sort_order = 0): Category => ({ id, name, slug: name.toLowerCase(), parent, sort_order });
const all = [c(3, "Shirts", 2, 1), c(1, "Food", null, 2), c(2, "Fashion", null, 1), c(4, "Dresses", 2, 0), c(5, "Grains", 1, 0)];

describe("departments", () => {
  it("lists departments in shelf order with their sub-categories", () => {
    const tree = departments(all);
    expect(tree.map((d) => d.category.name)).toEqual(["Fashion", "Food"]);
    expect(tree[0].children.map((x) => x.name)).toEqual(["Dresses", "Shirts"]);
  });
  it("copes with nothing loaded yet", () => {
    expect(departments(null)).toEqual([]);
  });
  it("finds the department of a sub-category or of a department itself", () => {
    expect(departmentOf(all, "shirts")?.category.name).toBe("Fashion");
    expect(departmentOf(all, "food")?.category.name).toBe("Food");
    expect(departmentOf(all, "nope")).toBeUndefined();
  });
});
