# Mpanko design system

One look across the four apps: the shop (`web/`), the admin (`admin/`), the phone app (`mobile/`) and the website (`corporate/`).

## Colours (unchanged)

Ink `#0a2b29`, teal `#0e7f74`, turquoise `#12b5ae`, gold `#e9a820`, hibiscus `#c2183a`, cotton `#f1f8f7`, and the kente band.

Added, as supporting tones only:

| Name | Value | Used for |
|---|---|---|
| sand | `#fbf6e9` | a warm surface for things worth noticing: the chosen option, the maker note, a pull quote |
| wash | `#e6f2f0` | quiet chips, table headings, hovers |
| field | `#7a9895` | the edge of a box you type in (3:1 against white) |
| gold-deep | `#7a5600` | gold as text on a light surface |

## Type

Two typefaces everywhere. **Bricolage Grotesque** for headings, prices and figures; **Public Sans** for reading text, labels, buttons and tables.

Sizes come from one scale: 13, 14.4, 16, 18, 22 px, then fluid heading sizes (`--t-xs` to `--t-hero` in the stylesheets; `type` in `mobile/src/theme.ts`). Prices and counts use tabular figures so columns line up.

On the phone each weight is its own font file. `mobile/src/text.tsx` exports a `Text` that picks the file from the style's `fontWeight`; add `fontFamily: font.display` for the heading face. Import `Text` from there, not from `react-native`.

## Shape

- The chrome is ink in all four apps (shop header, admin sidebar, website header, app header), closed by the kente band, with gold marking where you are.
- Buttons and chips are pills. Primary is ink; gold is for the main action on an ink surface.
- Cards: white, 20 px corners, a hairline edge and a soft ink-tinted shadow (`--shadow-sm`, `--shadow-md` on hover). Inputs: 12 px corners.
- Products are tall cards with the cloth or photo on top, the category, the name, the maker, then the price.
