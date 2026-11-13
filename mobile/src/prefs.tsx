import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NativeModules, Platform } from "react-native";
import { api } from "./api";
import { LANGUAGES, pickLanguage, translate, type MessageKey } from "./core/i18n";
import { convert, formatMoney, type Rates } from "./core/money";

const KEY = "mpanko.prefs";

interface Prefs {
  /** Language of the app's own text. */
  lang: string;
  setLang: (code: string) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** The currency prices are shown in. Empty means each price in its own currency, unconverted. */
  currency: string;
  setCurrency: (code: string) => void;
  rates: Rates | null;
  /** Format an amount quoted in `from`, converted to the shopper's currency. */
  money: (amount: string | number, from: string) => string;
}

const Ctx = createContext<Prefs | null>(null);

function deviceLanguages(): string[] {
  const settings = NativeModules.SettingsManager?.settings;
  const raw: string | undefined = Platform.OS === "ios" ? settings?.AppleLocale ?? settings?.AppleLanguages?.[0] : NativeModules.I18nManager?.localeIdentifier;
  return raw ? [raw] : [];
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(() => pickLanguage(deviceLanguages()));
  const [currency, setCurrencyState] = useState("");
  const [rates, setRates] = useState<Rates | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { lang?: string; currency?: string };
        if (saved.lang && LANGUAGES.some((l) => l.code === saved.lang)) setLangState(saved.lang);
        if (saved.currency) setCurrencyState(saved.currency);
      })
      .catch(() => undefined);
    api<Rates>("/currency/rates/").then(setRates).catch(() => setRates(null));
  }, []);

  const persist = useCallback((next: { lang: string; currency: string }) => {
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);
  const setLang = useCallback((code: string) => {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    setLangState(code);
    persist({ lang: code, currency });
  }, [currency, persist]);
  const setCurrency = useCallback((code: string) => {
    setCurrencyState(code);
    persist({ lang, currency: code });
  }, [lang, persist]);

  const value = useMemo<Prefs>(() => ({
    lang, setLang, currency, setCurrency, rates,
    t: (key, vars) => translate(lang, key, vars),
    money: (amount, from) => {
      const n = Number(amount);
      return currency && currency !== from && rates ? formatMoney(convert(rates, n, from, currency), currency, lang) : formatMoney(n, from, lang);
    },
  }), [lang, setLang, currency, setCurrency, rates]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePrefs outside PrefsProvider");
  return c;
}
