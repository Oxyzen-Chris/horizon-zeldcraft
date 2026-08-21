'use client';

import { useEffect, useState } from 'react';
import { getPlayerProgressLedger, type PlayerProgressLedger } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';
import { ProgressLedgerView } from './ProgressLedgerView';
import { useEffectiveAccount } from '@/lib/effectiveAccount';

const POS_KEY = 'zc.questsZeldaCraftWidgetPos';
const COLLAPSED_KEY = 'zc.questsZeldaCraftWidgetCollapsed';

// Mêmes clés de thème que celles produites par getPlayerProgressLedger() dans gameState.ts — voir
// demande utilisateur : regrouper ici UNIQUEMENT les thèmes "quêtes" + "PNJ rencontrés" (déjà
// calculés par le ledger partagé), dans cet ordre d'affichage précis, sans dupliquer la moindre
// logique métier (aucune modification de gameState.ts/ProgressLedgerView.tsx nécessaire).
const QUEST_THEME_KEYS = ['npc', 'questClassic', 'questNpc', 'questArchipelago', 'questWildIsland', 'questKingdom'];

const REFRESH_INTERVAL_MS = 15_000;

/**
 * Fenêtre flottante et déplaçable "Quêtes de ZeldaCraft" — même mécanisme visuel repliable par
 * thème que "Quêtes du Royaume" (KingdomQuestsWidget.tsx), mais couvrant l'ensemble des quêtes du
 * jeu (PNJ rencontrés, quêtes classiques, quêtes PNJ, quêtes archipel, quêtes îles sauvages,
 * quêtes du Royaume par chapitre) en un seul endroit. Réutilise telle quelle la même donnée que le
 * widget "État d'avancement / inventaire" (getPlayerProgressLedger()), simplement filtrée aux
 * thèmes "quêtes". Paramétrable via `questsZeldaCraftWidgetEnabled` dans le menu Administration.
 */
export function QuestsZeldaCraftWidget({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 400, y: 280 }),
    onExpand: bringToFront,
  });

  const [ledger, setLedger] = useState<PlayerProgressLedger | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    if (!address) return;
    setRefreshing(true);
    getPlayerProgressLedger(address)
      .then(full => setLedger({ themes: QUEST_THEME_KEYS.map(k => full.themes.find(th => th.key === k)).filter((th): th is NonNullable<typeof th> => !!th) }))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    if (!address || collapsed) return;
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, collapsed]);

  if (!enabled || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-emerald-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('questsZeldaCraft.title')}
        >🧭</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-96 max-h-[75vh] bg-slate-900 border-2 border-emerald-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-emerald-900/30 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">🧭 {t('questsZeldaCraft.title')}</span>
        <div className="flex items-center gap-2">
          <button className="text-xs opacity-70 hover:opacity-100" onClick={refresh} title={t('progress.refresh')}>
            {refreshing ? '⏳' : '🔄'}
          </button>
          <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
        </div>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <p className="text-xs text-slate-400 px-3 pt-2">{t('questsZeldaCraft.subtitle')}</p>
      <div className="p-3 overflow-y-auto">
        {!address ? (
          <p className="text-xs text-slate-500 italic">{t('progress.connectFirst')}</p>
        ) : (
          <ProgressLedgerView ledger={ledger} />
        )}
      </div>
    </div>
  );
}
