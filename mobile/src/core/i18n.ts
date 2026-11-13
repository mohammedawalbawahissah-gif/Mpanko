import { LANGUAGES, MESSAGES, type MessageKey } from "./locales";

export { LANGUAGES };
export type { MessageKey };

/** Text in the chosen language; falls back to English, then to the key. {name} placeholders are filled from `vars`. */
export function translate(lang: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `{${name}}`)) : text;
}

/** The first supported language in the phone's preference list, else English. Tags look like "fr-CA" or "es_ES". */
export function pickLanguage(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (LANGUAGES.some((l) => l.code === base)) return base;
  }
  return "en";
}
