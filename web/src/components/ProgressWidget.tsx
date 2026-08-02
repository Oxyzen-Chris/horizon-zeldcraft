'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { getPlayerProgressLedger, type PlayerProgressLedger } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';
import { ProgressLedgerView } from './ProgressLedgerView';

const POS_KEY = 'zc.progressWidgetPos';
const COLLAPSED_KEY = 'zc.progressWidgetCollapsed';

// Rafraîchi automatiquement toutes les 15s pendant que le panneau est ouvert (le ledger repose sur
// des lectures Firebase ponctuelles, pas un abonnement temps réel — voir getPlayerProgressLedger()
// dans gameState.ts) afin de refléter assez vite un nouvel objet/quête/PNJ/monde/familier obtenu
// sans pour autant multiplier les lectures pendant que le joueur explore le widget.
const REFRESH_INTERVAL_MS = 15_000;

/**
 * Fenêtre flottante et déplaçable "État d'avancement / inventaire" — liste repliable par thème
 * (armes, protections, nourriture, potions & sortilèges, engins, trésors, selles, familiers,
 * quêtes classiques/PNJ/archipel/îles sauvages/Royaume par chapitre, mondes, PNJ rencontrés) avec
 * une icône ✅/❌ par élément selon que le joueur le possède ou l'a déjà possédé/résolu au moins
 * une fois. Voir demande utilisateur. Paramétrable (affichage) via `progressWidgetEnabled` dans le
 * menu Administration (même convention que HelpWidget.tsx/`helpWidgetEnabled`).
 */
export function ProgressWidget({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 400, y: 220 }),
  });

  const [ledger, setLedger] = useState<PlayerProgressLedger | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    if (!address) return;
    setRefreshing(true);
    getPlayerProgressLedger(address).then(setLedger).catch(() => {}).finally(() => setRefreshing(false));
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
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={bringToFront}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('progress.title')}
        >📖</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-96 max-h-[75vh] bg-slate-900 border-2 border-amber-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/30 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">📖 {t('progress.title')}</span>
        <div className="flex items-center gap-2">
          <button className="text-xs opacity-70 hover:opacity-100" onClick={refresh} title={t('progress.refresh')}>
            {refreshing ? '⏳' : '🔄'}
          </button>
          <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
        </div>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <p className="text-xs text-slate-400 px-3 pt-2">{t('progress.subtitle')}</p>
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
