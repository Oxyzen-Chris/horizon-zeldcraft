'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import fr from '@/i18n/messages/fr.json';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import pt from '@/i18n/messages/pt.json';
import us from '@/i18n/messages/us.json';
import { subscribeRepRules, type RepRules } from './gameState';

const dicts = { fr, en, es, pt, us } as const;
export type Locale = keyof typeof dicts;

export const SUPPORTED_LOCALES = Object.keys(dicts) as Locale[];

// Devise associée à chaque langue par défaut (avant fusion avec RepRules.currencyByLocale, voir
// I18nProvider ci-dessous — configurable par l'admin sans redéploiement). "us" (🇺🇸 anglais
// américain) utilise le dollar, tandis que "en" (🇬🇧 anglais) utilise l'euro comme fr/es/pt — ceci
// corrige une incohérence historique où "en" affichait déjà "$" malgré son drapeau 🇬🇧 (voir
// LanguageSwitcher.tsx et CHANGELOG).
export const CURRENCY_BY_LOCALE: Record<Locale, string> = {
  fr: '€', en: '€', es: '€', pt: '€',
  us: '$',   // English (US) — utilise le dollar
};

/**
 * Détecte la langue par défaut à partir des paramètres locaux du navigateur/OS du joueur
 * (`navigator.language`/`navigator.languages`), ex "en-US" → 'us', "en-GB"/"en" → 'en',
 * "fr-FR" → 'fr', "es-ES" → 'es', "pt-BR"/"pt-PT" → 'pt'. Renvoie `null` si aucune correspondance
 * (langue non supportée) — dans ce cas l'appelant retombe sur RepRules.defaultLocale (admin) puis
 * sur 'fr' (voir I18nProvider). Ne s'exécute que côté client (`navigator` indisponible en SSR).
 */
function detectBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  const candidates = (navigator.languages && navigator.languages.length > 0)
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (lower.startsWith('fr')) return 'fr';
    if (lower.startsWith('es')) return 'es';
    if (lower.startsWith('pt')) return 'pt';
    if (lower === 'en-us' || lower === 'en_us') return 'us';
    if (lower.startsWith('en')) return 'en';
  }
  return null;
}

const I18nContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  currency: string;
}>({ locale: 'fr', setLocale: () => {}, t: (k) => k, currency: '€' });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('fr');
  // Devise/langue par défaut paramétrables par l'admin (RepRules.currencyByLocale/defaultLocale,
  // voir gameState.ts) — écoutées en temps réel pour refléter tout changement admin sans reload.
  const [repRules, setRepRulesState] = useState<RepRules | null>(null);
  // true dès que la locale a été fixée explicitement par une préférence sauvegardée
  // (localStorage) ou par la détection navigateur — empêche `RepRules.defaultLocale` (repli admin,
  // priorité la plus basse) d'écraser un choix déjà déterminé par une source plus fiable.
  const localeExplicitRef = useRef(false);

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('locale')) as Locale | null;
    if (saved && dicts[saved]) {
      setLocaleState(saved);
      localeExplicitRef.current = true;
      return;
    }
    const detected = detectBrowserLocale();
    if (detected) {
      setLocaleState(detected);
      localeExplicitRef.current = true;
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeRepRules((rules) => {
      setRepRulesState(rules);
      // Repli admin : seulement si ni la préférence sauvegardée ni la détection navigateur n'ont
      // déjà fixé explicitement la langue (voir localeExplicitRef ci-dessus).
      if (!localeExplicitRef.current && rules.defaultLocale && dicts[rules.defaultLocale]) {
        setLocaleState(rules.defaultLocale);
      }
    });
    return unsub;
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localeExplicitRef.current = true;
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

  const currency = repRules?.currencyByLocale?.[locale] || CURRENCY_BY_LOCALE[locale];

  return <I18nContext.Provider value={{ locale, setLocale, t, currency }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export type Translate = (key: string, vars?: Record<string, string | number>) => string;


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
