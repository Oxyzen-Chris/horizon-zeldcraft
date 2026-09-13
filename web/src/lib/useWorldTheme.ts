'use client';

import { useEffect, useState } from 'react';
import {
  getRepRules, subscribeRepRules, getTimeState, getMoonState, subscribeWorldThemes,
  resolveIsNight, resolveActiveTheme, computeMoonPhaseFromState,
  type RepRules, type TimeState, type MoonState, type WorldThemeDef, type MoonPhaseInfo,
} from './gameState';

export interface WorldThemeAmbience {
  isNight: boolean;
  theme: WorldThemeDef | null;
  moonPhase: MoonPhaseInfo | null;
}

/**
 * Hook partagé — résolution du cycle jour/nuit + thème d'ambiance effectif + phase de lune, à
 * réutiliser par WeatherPanel.tsx, Platform3DWidget.tsx et WorldMapWidget.tsx (voir
 * resolveActiveTheme dans gameState.ts : une seule fonction/un seul hook fait autorité pour éviter
 * toute incohérence entre widgets, ex. "Nuit" affiché dans l'un et "Jour" dans l'autre au même
 * instant). Se met à jour chaque minute (l'affichage ne dépend jamais de la seconde) + s'abonne en
 * temps réel aux thèmes/règles admin pour refléter immédiatement un changement de configuration.
 */
export function useWorldThemeAmbience(): WorldThemeAmbience {
  const [rules, setRules] = useState<RepRules | null>(null);
  const [timeState, setTimeStateLocal] = useState<TimeState | null>(null);
  const [moonState, setMoonState] = useState<MoonState | null>(null);
  const [themes, setThemes] = useState<WorldThemeDef[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => subscribeRepRules(setRules), []);
  useEffect(() => {
    const refresh = () => {
      getTimeState().then(setTimeStateLocal).catch(() => {});
      getMoonState().then(setMoonState).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => subscribeWorldThemes(setThemes), []);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!rules || !timeState || !themes.length) return { isNight: false, theme: null, moonPhase: null };
  void tick; // force le recalcul chaque minute même si rules/timeState/themes n'ont pas changé
  const now = new Date();
  const isNight = resolveIsNight(timeState, rules, now);
  const theme = resolveActiveTheme(themes, now, isNight);
  const moonPhase = moonState ? computeMoonPhaseFromState(moonState, now) : null;
  return { isNight, theme, moonPhase };
}
