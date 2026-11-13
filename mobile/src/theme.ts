export const color = {
  ink: "#141B3C",
  indigo: "#2A3FA0",
  gold: "#F2B705",
  cotton: "#F5F6F8",
  paper: "#FFFFFF",
  line: "#DADDE6",
  muted: "#5A6180",
  ok: "#0E7C5A",
  bad: "#C2183A",
};
// Product art: a deterministic woven stripe pattern (no photos are needed to browse).
const PALETTE = ["#2A3FA0", "#F2B705", "#0E7C5A", "#C2183A", "#141B3C", "#8A5A2B", "#E8E3D8"];
export function stripes(seed: string): string[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: 7 }, (_, i) => PALETTE[(h >> (i * 3)) % PALETTE.length] ?? PALETTE[0]);
}
