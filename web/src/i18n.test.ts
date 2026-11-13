import { describe, expect, it } from "vitest";
import { detectLanguage, translate } from "./i18n";
import { LANGUAGES, MESSAGES } from "./locales";

describe("translate", () => {
  it("returns the text in the chosen language", () => {
    expect(translate("fr", "nav.signIn")).toBe("Se connecter");
    expect(translate("es", "nav.bag")).toBe("Bolsa");
    expect(translate("en", "nav.shop")).toBe("Shop");
  });
  it("fills in {variables} and leaves unknown ones visible", () => {
    expect(translate("en", "address.example", { example: "73301" })).toBe("For example 73301");
    expect(translate("en", "address.example")).toBe("For example {example}");
  });
  it("falls back to English for a language it does not know", () => {
    expect(translate("xx", "nav.shop")).toBe("Shop");
  });
});

describe("detectLanguage", () => {
  it("picks the first supported language from the browser's list", () => {
    expect(detectLanguage(["de-DE", "fr-CA", "en"])).toBe("fr");
    expect(detectLanguage(["es"])).toBe("es");
  });
  it("defaults to English", () => {
    expect(detectLanguage(["ja-JP"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
});

describe("locale files", () => {
  const keys = Object.keys(MESSAGES.en);
  it.each(LANGUAGES.map((l) => l.code))("%s has every English key (no half-translated screens)", (code) => {
    const missing = keys.filter((k) => !(k in MESSAGES[code]));
    expect(missing).toEqual([]);
  });
  it.each(LANGUAGES.map((l) => l.code))("%s keeps the same {placeholders} as English", (code) => {
    for (const k of keys) {
      const vars = (t: string) => (t.match(/\{\w+\}/g) ?? []).sort().join();
      expect(vars((MESSAGES[code] as Record<string, string>)[k])).toBe(vars((MESSAGES.en as Record<string, string>)[k]));
    }
  });
});
