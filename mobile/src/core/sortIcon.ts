export type SortKind = "date" | "name" | "price" | "count" | "status" | "menu";

/** Which icon a sort choice gets, read from its value ("-created_at", "name-desc", "grand_total"). */
export function sortIcon(value: string): { kind: SortKind; dir: "asc" | "desc" } {
  const dir = value.startsWith("-") || value.endsWith("-desc") ? "desc" : "asc";
  const key = value.replace(/^-/, "").replace(/-desc$/, "");
  const kind: SortKind = /created|joined|updated|date|_at$/.test(key) ? "date" : /price|total/.test(key) ? "price" : /count/.test(key) ? "count" : key === "status" ? "status" : key === "menu" ? "menu" : "name";
  return { kind, dir };
}
