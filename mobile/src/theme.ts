export const color = {
  ink: "#0A2B29",
  teal: "#0E7F74",
  turq: "#12B5AE",
  cotton: "#F1F8F7",
  paper: "#FFFFFF",
  line: "#D5E3E1",
  muted: "#4A6462",
  ok: "#0E7C5A",
  bad: "#C2183A",
  gold: "#E9A820",
  goldDeep: "#7A5600", // gold as text on a light surface
  field: "#7A9895", // the edge of a box you type in
  sand: "#FBF6E9", // a warm surface for things worth noticing
  wash: "#E6F2F0", // a cool tint for quiet chips
};
/** `font.display` in a style asks for the heading face (Bricolage Grotesque); everything else is Public Sans. */
export const font = { display: "MpankoDisplay", body: "MpankoBody" } as const;
/** One type scale for every screen, in points. */
export const type = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 } as const;
export const radius = { md: 12, lg: 20 } as const;
// Product art: a deterministic woven stripe pattern (no photos are needed to browse).
const PALETTE = ["#0E7F74", "#12B5AE", "#0B6A61", "#0A2B29", "#E9A820", "#E3F1EF", "#C2183A"];
export function stripes(seed: string): string[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: 7 }, (_, i) => PALETTE[(h >> (i * 3)) % PALETTE.length] ?? PALETTE[0]);
}
