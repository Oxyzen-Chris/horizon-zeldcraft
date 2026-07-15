'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import fr from '@/i18n/messages/fr.json';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import pt from '@/i18n/messages/pt.json';

const dicts = { fr, en, es, pt } as const;
export type Locale = keyof typeof dicts;

const I18nContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}>({ locale: 'fr', setLocale: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('fr');

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('locale')) as Locale | null;
    if (saved && dicts[saved]) setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    if (typeof window !== 'undefined') localStorage.setItem('locale', l);
  };

  const t = (key: string, vars?: Record<string, string | number>) => {
    const dict = dicts[locale] as Record<string, string>;
    let str = dict[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  };

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
