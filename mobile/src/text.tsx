import { createContext, useContext } from "react";
import { StyleSheet, Text as PlainText, type TextProps, type TextStyle } from "react-native";
import { BODY, DISPLAY, fontFile } from "./core/type";

let loaded = false;
/** Called once the font files are in memory. Until then, and if they fail to load, text uses the phone's own font. */
export function setFontsLoaded(ok: boolean) {
  loaded = ok;
}
export function fontsLoaded() {
  return loaded;
}

const InsideText = createContext(false);

/**
 * Text in the app's typefaces. Use it exactly like React Native's Text: the weight in the style picks the right
 * font file, and `fontFamily: font.display` asks for the heading face. Text nested inside other text keeps its
 * parent's face unless it sets a weight of its own.
 */
export function Text({ style, ...rest }: TextProps) {
  const nested = useContext(InsideText);
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const ours = flat.fontFamily === undefined || flat.fontFamily === DISPLAY || flat.fontFamily === BODY;
  let fix: TextStyle | undefined;
  if (ours && !loaded) fix = flat.fontFamily ? { fontFamily: undefined } : undefined;
  else if (ours && (!nested || flat.fontWeight !== undefined || flat.fontFamily !== undefined)) fix = { fontFamily: fontFile(flat.fontWeight, flat.fontFamily === DISPLAY), fontWeight: "normal" };
  return (
    <InsideText.Provider value={true}>
      <PlainText {...rest} style={fix ? [style, fix] : style} />
    </InsideText.Provider>
  );
}
