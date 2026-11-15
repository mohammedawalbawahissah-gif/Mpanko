/**
 * How the app lays itself out for the width it has. Phones keep one column; a tablet held upright gets two,
 * and one held sideways gets three. Reading screens (forms, orders, help) never stretch wider than `READABLE`.
 */
export const READABLE = 720;
export const TABLET_MIN = 600;
export const WIDE_MIN = 900;

export type Layout = { width: number; isTablet: boolean; columns: 1 | 2 | 3; contentWidth: number };

export function layoutFor(width: number): Layout {
  const w = Math.max(0, Math.floor(width));
  const columns = w >= WIDE_MIN ? 3 : w >= TABLET_MIN ? 2 : 1;
  return { width: w, isTablet: w >= TABLET_MIN, columns, contentWidth: w };
}

/** The width of one card in a grid with `gap` between cards and `pad` at each side of the list. */
export function cardWidth(layout: Layout, gap: number, pad: number): number {
  const room = layout.width - pad * 2 - gap * (layout.columns - 1);
  return Math.floor(room / layout.columns);
}
