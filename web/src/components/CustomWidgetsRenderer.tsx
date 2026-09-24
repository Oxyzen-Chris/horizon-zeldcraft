'use client';

import { useEffect, useState } from 'react';
import { getCustomWidgets, applyEffect, type CustomWidgetDef, type CustomWidgetButton } from '@/lib/gameState';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';
import { useEffectiveAccount } from '@/lib/effectiveAccount';
import { useI18n } from '@/lib/i18n';

interface Pos { x: number; y: number }

function animationClass(a?: string): string {
  if (a === 'pulse') return 'animate-pulse';
  if (a === 'bounce') return 'animate-bounce';
  if (a === 'glow') return 'animate-widget-glow';
  return '';
}

/**
 * Bug corrigé : contrairement aux widgets créés librement par l'admin (toujours mono-langue,
 * texte brut stocké tel quel en base — voir `CustomWidgetDef.title/content` et
 * `CustomWidgetButton.label`), les widgets LIVRÉS PAR DÉFAUT avec le jeu (voir
 * `DEFAULT_CUSTOM_WIDGETS` dans gameState.ts, ex. "📯 Communauté Horizon ZeldCraft") font partie
 * intégrante de l'interface et doivent donc être traduits comme le reste de l'UI — ils
 * s'affichaient pourtant toujours en français quelle que soit la langue sélectionnée. Cette table
 * associe chaque id de widget bundlé à ses clés i18n (titre/contenu/libellés de boutons, dans le
 * même ordre que `def.buttons`) ; tout id absent de cette table (donc tout widget réellement créé
 * par l'admin) continue d'afficher son texte brut tel que stocké, comportement 100% inchangé.
 */
const BUILTIN_WIDGET_I18N: Record<string, { title: string; content: string; buttons: string[] }> = {
  'widget.default.community': {
    title: 'widgets.community.title',
    content: 'widgets.community.content',
    buttons: ['widgets.community.followButton'],
  },
};

/** Une instance flottante/déplaçable/réductible d'un widget personnalisé (position et état réduit
 * persistés séparément par widget via `def.id`). */
function SingleCustomWidget({ def, index, address }: { def: CustomWidgetDef; index: number; address: string }) {
  const { t } = useI18n();
  const builtinI18n = BUILTIN_WIDGET_I18N[def.id];
  const title = builtinI18n ? t(builtinI18n.title) : def.title;
  const content = builtinI18n ? t(builtinI18n.content) : def.content;
  const buttonLabel = (btn: CustomWidgetButton, i: number) => builtinI18n?.buttons[i] ? t(builtinI18n.buttons[i]) : btn.label;
  const posKey = `zc.customWidget.${def.id}.pos`;
  const collapsedKey = `zc.customWidget.${def.id}.collapsed`;
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey, collapsedKey,
    // Cascade les positions par défaut pour éviter que plusieurs widgets ne se superposent.
    defaultPos: () => ({ x: 24 + (index % 4) * 80, y: window.innerHeight - 220 - Math.floor(index / 4) * 80 }),
    onExpand: bringToFront,
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Exécute l'action d'un bouton — ensemble prédéfini et sûr (pas de code arbitraire admin). */
  const runButton = async (btn: CustomWidgetButton) => {
    if (busy) return;
    setFeedback(null);
    if (btn.actionType === 'link' && btn.actionUrl) {
      window.open(btn.actionUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (btn.actionType === 'message') {
      setFeedback(btn.actionMessage || null);
      setTimeout(() => setFeedback(null), 5000);
      return;
    }
    if (btn.actionType === 'effect' && btn.effect) {
      setBusy(true);
      try {
        await applyEffect(address, btn.effect);
        setFeedback('✅');
        setTimeout(() => setFeedback(null), 3000);
      } finally {
        setBusy(false);
      }
    }
  };

  if (!pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className={`fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-purple-500 text-2xl shadow-lg flex items-center justify-center ${animationClass(def.animation)}`}
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={title}
        >{def.icon ?? '🧩'}</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-64 bg-slate-900 border-2 border-purple-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-purple-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">{def.icon ?? '🧩'} {title}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="p-3 text-xs space-y-2">
        <p className="text-slate-300 whitespace-pre-wrap">{content}</p>
        <div className="flex flex-col gap-1.5">
          {def.buttons.map((b, i) => (
            <button key={i} className="btn-secondary text-xs w-full disabled:opacity-40" disabled={busy} onClick={() => runButton(b)}>
              {buttonLabel(b, i)}
            </button>
          ))}
        </div>
        {feedback && <p className="text-emerald-400 mt-1">{feedback}</p>}
      </div>
    </div>
  );
}

/**
 * Rend l'ensemble des widgets flottants personnalisés définis par l'admin (menu Administration →
 * "Widgets personnalisés"). Un widget par définition active dont la condition `minXp` est remplie,
 * chacun avec sa propre position/état réduit persistés — même infra que `DiceRollWidget` /
 * `TeamChatWidget`, mais entièrement paramétrable sans code (titre, contenu, animation, boutons).
 */
export function CustomWidgetsRenderer({ playerXp }: { playerXp: number }) {
  const { address } = useEffectiveAccount();
  const [widgets, setWidgets] = useState<CustomWidgetDef[]>([]);

  useEffect(() => { getCustomWidgets().then(setWidgets).catch(() => {}); }, []);

  if (!address) return null;
  const visible = widgets.filter(w => w.active && (w.minXp ?? 0) <= playerXp);

  return (
    <>
      {visible.map((w, i) => <SingleCustomWidget key={w.id} def={w} index={i} address={address} />)}
    </>
  );
}
