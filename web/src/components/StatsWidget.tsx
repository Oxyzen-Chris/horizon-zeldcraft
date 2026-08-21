'use client';

import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.statsWidgetPos';
const COLLAPSED_KEY = 'zc.statsWidgetCollapsed';

export interface StatsWidgetProps {
  xp: number; xpCap: number;
  hp: number; hpMax: number;
  hunger: number; hungerMax: number;
  happiness: number; happinessMax: number; moodHint?: string;
  force: number; forceMax: number;
  spells: number; spellsMax: number;
  oxygen: number; oxygenMax: number;
  fatigue: number; fatigueMax: number;
  wallet: number; reputation: number;
  /** Affichage paramétrable (admin → "Widgets personnalisés", `statsWidgetEnabled`), défaut true. */
  enabled?: boolean;
}

function Bar({ label, value, max, color, hint }: { label: string; value: number; max: number; color: string; hint?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="text-slate-400">{Math.round(value)} / {Math.round(max)}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="text-[9px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/**
 * Fenêtre flottante et déplaçable "Statistiques" — duplique les indicateurs du tableau fixe affiché
 * en haut de page (voir game/page.tsx) afin que le joueur puisse la repositionner librement à
 * l'écran pendant la partie (à côté de la Plateforme 2D isométrique par exemple), sans perdre le
 * tableau fixe d'origine qui reste inchangé. Purement d'affichage : ne lit ni n'écrit aucune donnée
 * elle-même, tout est reçu en props depuis game/page.tsx (source unique de vérité déjà abonnée à
 * subscribePlayer), pour éviter un second abonnement Firebase redondant — même logique de calcul
 * (dispHp/dispHunger/mood…) que le tableau fixe, simplement rejouée ici en lecture seule.
 */
export function StatsWidget(props: StatsWidgetProps) {
  const { enabled = true } = props;
  const { t } = useI18n();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 300, y: 90 }),
    onExpand: bringToFront,
  });

  if (!enabled || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-cyan-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('game.stats.title')}
        >📊</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-64 bg-slate-900 border-2 border-cyan-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-cyan-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">📊 {t('game.stats.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="p-3">
        <Bar label={t('game.stats.xp')}        value={props.xp}        max={props.xpCap}        color="bg-purple-500" />
        <Bar label={t('game.stats.hp')}        value={props.hp}        max={props.hpMax}         color="bg-rose-500" />
        <Bar label={t('game.stats.hunger')}    value={props.hunger}    max={props.hungerMax}     color="bg-orange-500" />
        <Bar label={t('game.stats.happiness')} value={props.happiness} max={props.happinessMax}  color="bg-yellow-400" hint={props.moodHint} />
        <Bar label={t('game.stats.force')}     value={props.force}     max={props.forceMax}      color="bg-red-500" />
        <Bar label={t('game.stats.spells')}    value={props.spells}    max={props.spellsMax}     color="bg-indigo-500" />
        <Bar label={t('game.stats.oxygen')}    value={props.oxygen}    max={props.oxygenMax}     color="bg-sky-500" />
        <Bar label={t('game.stats.fatigue')}   value={props.fatigue}   max={props.fatigueMax}    color="bg-amber-500" />
        <div className="flex justify-between text-xs mt-3 pt-3 border-t border-slate-700">
          <span>💰 <b className="text-amber-400">{props.wallet}</b></span>
          <span>⭐ <b className={props.reputation >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{props.reputation}</b></span>
        </div>
      </div>
    </div>
  );
}
