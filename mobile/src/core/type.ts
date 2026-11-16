/**
 * The app's two typefaces, the same pair as the shop, the admin and the website: Bricolage Grotesque for headings
 * and prices, Public Sans for everything that is read or tapped. Each weight is its own font file on a phone, so a
 * style's weight picks the file; the weight itself is then set back to normal so the phone does not thicken it twice.
 */
export const DISPLAY = "MpankoDisplay"; // put this in a style's fontFamily to ask for the heading face
export const BODY = "MpankoBody";

const BODY_FILES = { 400: "PublicSans_400Regular", 500: "PublicSans_500Medium", 600: "PublicSans_600SemiBold", 700: "PublicSans_700Bold", 800: "PublicSans_800ExtraBold" } as const;
const DISPLAY_FILES = { 600: "BricolageGrotesque_600SemiBold", 700: "BricolageGrotesque_700Bold", 800: "BricolageGrotesque_800ExtraBold" } as const;

/** A style's weight as a number: "bold" is 700, nothing or "normal" is 400. */
export function weightOf(weight: string | number | undefined): number {
  if (weight === "bold") return 700;
  const n = Number(weight);
  return Number.isFinite(n) && n > 0 ? n : 400;
}

/** The font file for a weight. Headings start at semi-bold; body text stops at extra-bold. */
export function fontFile(weight: string | number | undefined, display: boolean): string {
  const w = weightOf(weight);
  if (display) return w >= 750 ? DISPLAY_FILES[800] : w >= 650 ? DISPLAY_FILES[700] : weight === undefined ? DISPLAY_FILES[700] : DISPLAY_FILES[600];
  const step = w >= 750 ? 800 : w >= 650 ? 700 : w >= 550 ? 600 : w >= 450 ? 500 : 400;
  return BODY_FILES[step];
}
