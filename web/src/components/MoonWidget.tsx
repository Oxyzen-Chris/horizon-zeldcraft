'use client';

import { useEffect, useState } from 'react';
import { isFullMoonToday, getNextFullMoonDisplayDate } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Badge "Pleine lune" affiché au même niveau que la météo (WeatherWidget) et la saison
 * (SeasonWidget) dans l'en-tête du jeu — voir game/page.tsx. Affiche soit "🌕 Pleine lune"
 * aujourd'hui, soit la date de la PROCHAINE pleine lune effective (calendrier admin > mode
 * manuel > calcul astronomique — voir gameState.ts::getNextFullMoonDisplayDate/isFullMoonToday).
 * 40 des 400 "Quêtes du Royaume" (`fullMoonOnly`) ne se débloquent qu'un jour de pleine lune —
 * voir KingdomQuestsWidget.tsx et RepRulesPanel.tsx (« Quêtes du Royaume »).
 */
export function MoonWidget() {
  const { t } = useI18n();
  const [isFull, setIsFull] = useState(false);
  const [nextDate, setNextDate] = useState<Date | null>(null);

  useEffect(() => {
    const refresh = () => {
      isFullMoonToday().then(setIsFull).catch(() => {});
      getNextFullMoonDisplayDate().then(setNextDate).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-4 py-2 text-sm" title={t('moon.hint')}>
      <span className="text-3xl">{isFull ? '🌕' : '🌘'}</span>
      <div>
        <p className="text-slate-200 font-semibold">
          {isFull ? t('moon.full') : (nextDate ? nextDate.toLocaleDateString() : '…')}
        </p>
        <p className="text-xs text-slate-400">{isFull ? t('moon.label') : t('moon.next')}</p>
      </div>
    </div>
  );
}
