'use client';

import { useEffect, useState } from 'react';
import { getCurrentSeason, SEASON_ICONS, type Season } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

/**
 * Badge de saison courante (gestion tournante printemps/été/automne/hiver — voir gameState.ts
 * `Season`/`getCurrentSeason`/`SeasonState`). Calculée par défaut depuis la date réelle, ou forcée
 * par l'admin (menu Administration → « Saisons »). De nouveaux PNJ/quêtes/trésors/POI n'apparaissent
 * qu'en fonction de la saison affichée ici — voir NpcList.tsx, QuestList.tsx, TreasureList.tsx,
 * WorldMapWidget.tsx et NpcEncounterPopup.tsx.
 */
export function SeasonWidget() {
  const { t } = useI18n();
  const [season, setSeason] = useState<Season | null>(null);

  useEffect(() => {
    const refresh = () => getCurrentSeason().then(setSeason).catch(() => {});
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  if (!season) return null;

  return (
    <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-4 py-2 text-sm" title={t('season.hint')}>
      <span className="text-3xl">{SEASON_ICONS[season]}</span>
      <div>
        <p className="text-slate-200 font-semibold">{t(`season.${season}`)}</p>
        <p className="text-xs text-slate-400">{t('season.label')}</p>
      </div>
    </div>
  );
}
