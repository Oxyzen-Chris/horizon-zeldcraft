'use client';

import { useEffect, useState } from 'react';
import { getGameClock, getCurrentSeason, SEASON_ICONS, type Season, type GameClock } from '@/lib/gameState';
import { useWorldThemeAmbience } from '@/lib/useWorldTheme';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.weatherWidgetPos';
const COLLAPSED_KEY = 'zc.weatherWidgetCollapsed';

/**
 * Fenêtre flottante et déplaçable "Weather" (nommée en anglais — voir demande utilisateur — mais
 * dont le libellé affiché est bien traduit dans les 4 langues du jeu, comme tous les autres
 * widgets) — affiche l'horloge locale du joueur, le moment de la journée (Jour/Nuit), la phase de
 * lune courante (+ "Lune rousse" si applicable), le nom du thème d'ambiance effectivement actif
 * (Jour/Nuit intégré ou thème personnalisé programmé par l'admin — voir useWorldThemeAmbience()/
 * resolveActiveTheme dans gameState.ts) et la saison en cours. Le même hook alimente le décor
 * jour/nuit de la Plateforme 3D et de la Mapmonde — une seule résolution fait autorité pour tous
 * les widgets (aucune divergence possible entre eux).
 */
export function WeatherPanel({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 400, y: 340 }),
    onExpand: bringToFront,
  });

  const [clock, setClock] = useState<GameClock>(() => getGameClock());
  const [season, setSeason] = useState<Season | null>(null);
  const { isNight, theme: activeTheme, moonPhase } = useWorldThemeAmbience();

  // Horloge : tick chaque seconde (léger, aucun accès réseau) pour un affichage vivant.
  useEffect(() => {
    const id = setInterval(() => setClock(getGameClock()), 1000);
    return () => clearInterval(id);
  }, []);

  // Saison : rafraîchie périodiquement, même fréquence que SeasonWidget/MoonWidget (5 min).
  useEffect(() => {
    const refresh = () => { getCurrentSeason().then(setSeason).catch(() => {}); };
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  if (!enabled || !pos) return null;

  const themeName = activeTheme ? (activeTheme.i18nKey ? t(activeTheme.i18nKey) : activeTheme.name) : '…';

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-sky-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('weather.widget.title')}
        >{isNight ? (moonPhase?.emoji ?? '🌙') : '☀️'}</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-80 bg-slate-900 border-2 border-sky-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-sky-900/30 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">🌤️ {t('weather.widget.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />

      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
          <span className="text-3xl font-mono tabular-nums">{clock.hhmm}</span>
          <span className="text-2xl">{isNight ? '🌙' : '☀️'}</span>
        </div>
        <p className="text-xs text-slate-400 text-center">
          {isNight ? t('weather.widget.night') : t('weather.widget.day')}
        </p>

        {isNight && moonPhase && (
          <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-3 py-2">
            <span className="text-2xl">{moonPhase.emoji}</span>
            <div>
              <p className="text-slate-200 text-sm font-semibold">{t(`weather.moonPhase.${moonPhase.key}`)}</p>
              {moonPhase.isLuneRousse && <p className="text-[11px] text-rose-300">{t('weather.moonPhase.luneRousse')}</p>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-3 py-2">
          <span className="text-2xl">🎭</span>
          <div>
            <p className="text-slate-200 text-sm font-semibold">{themeName}</p>
            <p className="text-[11px] text-slate-400">{t('weather.widget.themeLabel')}</p>
          </div>
        </div>

        {season && (
          <div className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-3 py-2">
            <span className="text-2xl">{SEASON_ICONS[season]}</span>
            <div>
              <p className="text-slate-200 text-sm font-semibold">{t(`season.${season}`)}</p>
              <p className="text-[11px] text-slate-400">{t('season.label')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
