'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import fr from '@/i18n/messages/fr.json';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import pt from '@/i18n/messages/pt.json';

const dicts = { fr, en, es, pt } as const;
export type Locale = keyof typeof dicts;

// Devise associée à chaque langue
export const CURRENCY_BY_LOCALE: Record<Locale, string> = {
  fr: '€', es: '€', pt: '€',
  en: '$',   // English (US) — utilise le dollar
};

const I18nContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  currency: string;
}>({ locale: 'fr', setLocale: () => {}, t: (k) => k, currency: '€' });

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

  return <I18nContext.Provider value={{ locale, setLocale, t, currency: CURRENCY_BY_LOCALE[locale] }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Résout le libellé localisé d'un item de besace/boutique (`item.<itemId>`), avec repli sur le
 * `fallback` (texte brut FR stocké en base) si l'itemId n'a pas d'entrée i18n — cas des objets
 * ajoutés librement par l'admin, forcément mono-langue. `t()` renvoie la clé elle-même si absente
 * du dictionnaire (voir plus haut), d'où la comparaison `translated === key`.
 */
export function itemLabel(t: Translate, itemId: string | undefined, fallback: string): string {
  if (!itemId) return fallback;
  const key = `item.${itemId}`;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

/**
 * Résout un libellé localisé générique (quête, familier…) à partir d'une clé i18n stable
 * (`QuestDef.i18nKey`, `FamiliarDef.i18nKey`…), avec repli sur `fallback` (texte brut stocké en
 * base) si la clé est absente ou non fournie (contenu créé librement par l'admin).
 */
export function localizeName(t: Translate, key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  const translated = t(key);
  return translated === key ? fallback : translated;
}
