import type { Category } from "./types";

export interface Department {
  category: Category;
  children: Category[];
}

const byOrder = (a: Category, b: Category) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);

/** Departments (top-level categories) in shelf order, each with its sub-categories in order. Hidden or orphaned ones are left out. */
export function departments(all: Category[] | null | undefined): Department[] {
  const list = all ?? [];
  const tops = list.filter((c) => !c.parent).sort(byOrder);
  return tops.map((category) => ({ category, children: list.filter((c) => c.parent === category.id).sort(byOrder) }));
}

/** The department a category belongs to (the category itself when it is a department). */
export function departmentOf(all: Category[] | null | undefined, slug: string): Department | undefined {
  const tree = departments(all);
  return tree.find((d) => d.category.slug === slug || d.children.some((c) => c.slug === slug));
}
