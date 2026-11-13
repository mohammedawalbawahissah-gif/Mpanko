import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGUAGES, MESSAGES, type MessageKey } from "./locales";

const KEY = "mpanko.lang";

/** Pure lookup so it can be tested without React: falls back to English, then to the key itself. */
export function translate(lang: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `{${name}}`)) : text;
}

/** First supported language the browser prefers, else English. */
export function detectLanguage(preferred: readonly string[] = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []): string {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if (LANGUAGES.some((l) => l.code === base)) return base;
  }
  return "en";
}

interface I18nState {
  lang: string;
  setLang: (code: string) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    /* storage unavailable: fall through to the browser's preference */
  }
  return detectLanguage();
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((code: string) => {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    setLangState(code);
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* the choice just won't persist */
    }
  }, []);
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) return { lang: "en", setLang: () => undefined, t: (key, vars) => translate("en", key, vars) }; // tests and static renders
  return ctx;
}

export function LanguageSelect() {
  const { lang, setLang, t } = useT();
  return (
    <label>
      <span className="sr-only">{t("nav.language")}</span>
      <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("nav.language")}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
