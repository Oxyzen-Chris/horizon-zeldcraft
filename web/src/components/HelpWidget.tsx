'use client';

import { useState } from 'react';
import { ONBOARDING_STEPS } from '@/lib/onboardingContent';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.helpWidgetPos';
const COLLAPSED_KEY = 'zc.helpWidgetCollapsed';

/**
 * Fenêtre flottante et déplaçable "Aides" — toujours disponible pendant la partie, reprend
 * exactement les explications de la visite guidée (OnboardingWizard.tsx) organisées en 3 onglets
 * (Univers & quête finale / Quêtes & dangers / Outils du Dresseur), voir onboardingContent.ts
 * (source unique partagée). Un bouton permet de rejouer la visite guidée plein écran à tout
 * moment. Paramétrable (affichage) via `helpWidgetEnabled` dans le menu Administration.
 */
export function HelpWidget({ enabled, onReplayTour }: { enabled: boolean; onReplayTour: () => void }) {
  const { t } = useI18n();
  const { z, bringToFront } = useWindowZIndex();
  const [tab, setTab] = useState(0);
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: 24, y: window.innerHeight - 90 }),
    onExpand: bringToFront,
  });

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
          title={t('help.title')}
        >❓</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  const step = ONBOARDING_STEPS[tab];

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
        <span className="text-sm font-semibold">❓ {t('help.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />

      <p className="text-xs text-slate-400 px-3 pt-2">{t('help.subtitle')}</p>

      <div className="flex gap-1 px-3 pt-2 shrink-0">
        {ONBOARDING_STEPS.map((s, i) => (
          <button
            key={i}
            className={`flex-1 text-[11px] px-1.5 py-1.5 rounded ${i === tab ? 'bg-emerald-700/50 text-white' : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'}`}
            onClick={() => setTab(i)}
          >{s.icon} {t(s.titleKey)}</button>
        ))}
      </div>

      <div className="p-3 overflow-y-auto space-y-2">
        {step.topics.map(topic => (
          <div key={topic.titleKey} className="bg-slate-800/60 border border-slate-700 rounded-lg p-2.5">
            <p className="text-xs font-semibold mb-1">{topic.icon} {t(topic.titleKey)}</p>
            <p className="text-[11px] text-slate-400">{t(topic.bodyKey)}</p>
          </div>
        ))}
      </div>

      <div className="p-3 pt-0 shrink-0">
        <button
          className="btn-secondary text-xs w-full"
          onClick={() => { toggleCollapsed(); onReplayTour(); }}
        >🔁 {t('help.replayTour')}</button>
      </div>
    </div>
  );
}
