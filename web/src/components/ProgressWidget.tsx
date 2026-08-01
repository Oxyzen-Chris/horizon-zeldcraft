'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { getPlayerProgressLedger, type PlayerProgressLedger } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { ProgressLedgerView } from './ProgressLedgerView';

const POS_KEY = 'zc.progressWidgetPos';
const COLLAPSED_KEY = 'zc.progressWidgetCollapsed';
interface Pos { x: number; y: number }

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

  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const [ledger, setLedger] = useState<PlayerProgressLedger | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const saved = localStorage.getItem(POS_KEY);
    if (saved) { try { setPos(JSON.parse(saved)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 400, y: 220 });
  }, []);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };
  const toggleCollapsed = () => {
    setCollapsed(prev => { localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1'); return !prev; });
  };

  if (!enabled || !pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y, zIndex: z }}
        onPointerDownCapture={bringToFront}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('progress.title')}
      >📖</button>
    );
  }

  return (
    <div
      className="fixed z-40 w-96 max-h-[75vh] bg-slate-900 border-2 border-amber-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront}
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
