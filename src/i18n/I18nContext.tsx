/**
 * Language (English / Deutsch / Türkçe). The choice is stored in the browser; the first visit
 * follows the browser language.
 *
 *  - t(key)   for keys written in code: type-checked against the English dictionary
 *  - td(key)  for keys that come from data files (checked by `npm run validate-data` instead)
 * Every text may contain {org}, which is the fictional company name.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStorage, writeStorage } from '../hooks/useLocalStorage';
import { ORG_NAME } from '../config';
import { FLAT, LANGS, type Lang, type TKey } from './dictionaries';
import { interpolate, type Params } from './flatten';

function initialLang(): Lang {
  const stored = readStorage<string | null>('lang', null);
  if (stored && (LANGS as readonly string[]).includes(stored)) return stored as Lang;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return (LANGS as readonly string[]).includes(nav) ? (nav as Lang) : 'en';
}

/** Looks a key up; falls back to English and finally to the key itself, so a gap is visible but harmless. */
export function translate(lang: Lang, key: string, params?: Params): string {
  const text = FLAT[lang][key] ?? FLAT.en[key] ?? key;
  return interpolate(text, { org: ORG_NAME, ...params });
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, params?: Params) => string;
  td: (key: string, params?: Params) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeStorage('lang', l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<I18n>(() => {
    const td = (key: string, params?: Params) => translate(lang, key, params);
    return { lang, setLang, t: td, td };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

/** Shortcut: the translate function of the current language */
export const useT = () => useI18n().t;
