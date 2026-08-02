'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import type { Pos } from '@/lib/useDraggableWidget';

/**
 * Menu contextuel partagé (clic droit) pour les 12 fenêtres flottantes du jeu — propose pour
 * l'instant une seule action "🎯 Recentrer" qui replace le widget au milieu de l'écran (voir
 * `useDraggableWidget::resetPosition`), utile si un widget devient inaccessible hors de l'écran
 * visible. Se ferme sur clic/appui en dehors du menu ou sur `Échap`. Rendu au-dessus de tous les
 * widgets (z-index 110, MAX_Z des widgets étant plafonné à 89 dans windowZOrder.ts) et des pop-up
 * plein écran (95/96), pour rester toujours cliquable quel que soit le widget concerné.
 */
export function WidgetContextMenu({ pos, onClose, onRecenter }: {
  pos: Pos | null;
  onClose: () => void;
  onRecenter: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onPointerDownOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onPointerDownOutside, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDownOutside, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pos, onClose]);

  if (!pos) return null;

  const margin = 8;
  const maxX = typeof window !== 'undefined' ? window.innerWidth - 180 - margin : pos.x;
  const maxY = typeof window !== 'undefined' ? window.innerHeight - 60 - margin : pos.y;
  const left = Math.min(Math.max(pos.x, margin), Math.max(margin, maxX));
  const top = Math.min(Math.max(pos.y, margin), Math.max(margin, maxY));

  return (
    <div
      ref={menuRef}
      className="fixed z-[110] min-w-[180px] bg-slate-900 border-2 border-slate-600 rounded-lg shadow-2xl py-1 text-sm select-none"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        className="w-full text-left px-3 py-2 hover:bg-slate-700/70"
        onClick={onRecenter}
      >
        🎯 {t('widget.contextMenu.recenter')}
      </button>
    </div>
  );
}
