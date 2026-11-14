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
};
// Product art: a deterministic woven stripe pattern (no photos are needed to browse).
const PALETTE = ["#0E7F74", "#12B5AE", "#0B6A61", "#0A2B29", "#7FD9D3", "#E3F1EF", "#4A6462"];
export function stripes(seed: string): string[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: 7 }, (_, i) => PALETTE[(h >> (i * 3)) % PALETTE.length] ?? PALETTE[0]);
}
