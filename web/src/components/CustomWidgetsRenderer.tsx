'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { getCustomWidgets, applyEffect, type CustomWidgetDef, type CustomWidgetButton } from '@/lib/gameState';

interface Pos { x: number; y: number }

function animationClass(a?: string): string {
  if (a === 'pulse') return 'animate-pulse';
  if (a === 'bounce') return 'animate-bounce';
  if (a === 'glow') return 'animate-widget-glow';
  return '';
}

/** Une instance flottante/déplaçable/réductible d'un widget personnalisé (position et état réduit
 * persistés séparément par widget via `def.id`). */
function SingleCustomWidget({ def, index, address }: { def: CustomWidgetDef; index: number; address: string }) {
  const posKey = `zc.customWidget.${def.id}.pos`;
  const collapsedKey = `zc.customWidget.${def.id}.collapsed`;
  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCollapsed((localStorage.getItem(collapsedKey) ?? '1') === '1');
    const saved = localStorage.getItem(posKey);
    if (saved) { try { setPos(JSON.parse(saved)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') {
      // Cascade les positions par défaut pour éviter que plusieurs widgets ne se superposent.
      setPos({ x: 24 + (index % 4) * 80, y: window.innerHeight - 220 - Math.floor(index / 4) * 80 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (pos) localStorage.setItem(posKey, JSON.stringify(pos));
  };
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      localStorage.setItem(collapsedKey, prev ? '0' : '1');
      return !prev;
    });
  };

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
      <button
        className={`fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-purple-500 text-2xl shadow-lg flex items-center justify-center ${animationClass(def.animation)}`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={def.title}
      >{def.icon ?? '🧩'}</button>
    );
  }

  return (
    <div
      className="fixed z-40 w-64 bg-slate-900 border-2 border-purple-500 rounded-xl shadow-xl select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-purple-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">{def.icon ?? '🧩'} {def.title}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0" onClick={toggleCollapsed}>✕</button>
      </div>
      <div className="p-3 text-xs space-y-2">
        <p className="text-slate-300 whitespace-pre-wrap">{def.content}</p>
        <div className="flex flex-col gap-1.5">
          {def.buttons.map((b, i) => (
            <button key={i} className="btn-secondary text-xs w-full disabled:opacity-40" disabled={busy} onClick={() => runButton(b)}>
              {b.label}
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
  const { address } = useAccount();
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
