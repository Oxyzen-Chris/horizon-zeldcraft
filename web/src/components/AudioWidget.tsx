'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { useAudioPrefs } from '@/lib/audio';
import type { AudioSourceKey } from '@/lib/gameState';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.audioWidgetPos';
const COLLAPSED_KEY = 'zc.audioWidgetCollapsed';
// Taille redimensionnable (voir demande utilisateur « rend sizable le widget Audio et le contenu
// pour qu'il s'adapte à la taille de la fenêtre et continue à être lisible même si la taille [...]
// est diminuée ») — même mécanique persistée (localStorage) que Platform3DWidget.tsx::SIZE_KEY.
const SIZE_KEY = 'zc.audioWidgetSize';
const DEFAULT_W = 320, DEFAULT_H = 460;
const MIN_W = 240, MIN_H = 200;
const MAX_W = 560, MAX_H = 760;
type Size = { w: number; h: number };

const SOURCE_ICON: Record<AudioSourceKey, string> = {
  owl: '🦉', werewolf: '🐺', bat: '🦇', raptor: '🦅', bird: '🐦', boar: '🐗', witch: '🧙‍♀️',
};

/**
 * Fenêtre flottante et déplaçable "Audio" (14ᵉ widget) — voir demande utilisateur « widget Audio
 * [...] allumer, couper le son, diminuer/augmenter le son, couper le son spécifiquement à chaque
 * objet 3D qui en émet ». Contrôle général (on/off + volume) et par créature d'ambiance de la
 * Plateforme 3D (hibou, loup-garou, chauve-souris, rapaces, oiseaux/hirondelles, sangliers,
 * sorcière) — voir Platform3DAmbientScene.tsx (déclenche `playAmbientSound`) et lib/audio.ts
 * (moteur de lecture + persistance des préférences en localStorage, indépendant par navigateur).
 * Les réglages ADMIN par défaut (activé/volume/URL personnalisée par créature, voir
 * AudioAdminPanel.tsx) restent prioritaires pour la désactivation globale d'une créature ; ce
 * widget ne fait que surcoucher côté joueur (sourdine/volume personnels).
 */
export function AudioWidget({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 400, y: 420 }),
    onExpand: bringToFront,
  });

  const { master, setMaster, sources, setSource, adminSettings, keys } = useAudioPrefs();

  // ─── Redimensionnement (voir SIZE_KEY ci-dessus) — même pattern que Platform3DWidget.tsx.
  const [size, setSize] = useState<Size>({ w: DEFAULT_W, h: DEFAULT_H });
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved) { try { setSize(JSON.parse(saved)); } catch { /* ignore */ } }
  }, []);
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStart.current.x;
    const dy = e.clientY - resizeStart.current.y;
    setSize({
      w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dx)),
      h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dy)),
    });
  };
  const onResizePointerUp = () => {
    if (!resizing) return;
    setResizing(false);
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  };
  // Échelle du texte/espacements — réduit légèrement en dessous d'une largeur "confortable" pour
  // rester LISIBLE même très réduit (voir demande utilisateur), plutôt que de laisser le contenu
  // déborder/se faire couper.
  const compact = size.w < 280;

  if (!enabled || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-fuchsia-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('audio.widget.title')}
        >{master.enabled && master.volume > 0 ? '🔊' : '🔇'}</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 bg-slate-900 border-2 border-fuchsia-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-fuchsia-900/30 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className={`font-semibold truncate ${compact ? 'text-xs' : 'text-sm'}`}>🔊 {t('audio.widget.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />

      <div className={`space-y-3 overflow-y-auto ${compact ? 'p-2' : 'p-3'}`} style={{ maxHeight: size.h }}>
        <div className={`bg-slate-800/60 rounded-lg ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <span className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>{t('audio.widget.master')}</span>
            <button
              className={`text-xs px-2 py-0.5 rounded shrink-0 ${master.enabled ? 'bg-emerald-700/60 text-emerald-100' : 'bg-slate-700 text-slate-400'}`}
              onClick={() => setMaster({ enabled: !master.enabled })}
            >{master.enabled ? t('audio.widget.on') : t('audio.widget.off')}</button>
          </div>
          <input
            type="range" min={0} max={100} value={master.volume}
            onChange={(e) => setMaster({ volume: Number(e.target.value) })}
            className="w-full accent-fuchsia-500"
            aria-label={t('audio.widget.master')}
          />
        </div>

        {!compact && <p className="text-[11px] text-slate-400">{t('audio.widget.perSourceHint')}</p>}

        {keys.map((key) => {
          const adminEnabled = adminSettings[key]?.enabled !== false;
          const pref = sources[key];
          const on = pref?.enabled !== false;
          const volume = pref?.volume ?? adminSettings[key]?.volume ?? 50;
          return (
            <div key={key} className={`bg-slate-800/60 rounded-lg ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} ${!adminEnabled ? 'opacity-40' : ''}`}>
              <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                <span className={`truncate ${compact ? 'text-xs' : 'text-sm'}`}>{SOURCE_ICON[key]} {t(`audio.source.${key}`)}</span>
                <button
                  disabled={!adminEnabled}
                  className={`text-xs px-2 py-0.5 rounded shrink-0 ${on ? 'bg-emerald-700/60 text-emerald-100' : 'bg-slate-700 text-slate-400'}`}
                  onClick={() => setSource(key, { enabled: !on })}
                >{on ? t('audio.widget.on') : t('audio.widget.off')}</button>
              </div>
              <input
                type="range" min={0} max={100} value={volume} disabled={!adminEnabled || !on}
                onChange={(e) => setSource(key, { volume: Number(e.target.value) })}
                className="w-full accent-fuchsia-500"
                aria-label={t(`audio.source.${key}`)}
              />
              {!adminEnabled && <p className="text-[10px] text-amber-400 mt-0.5">{t('audio.widget.disabledByAdmin')}</p>}
            </div>
          );
        })}
      </div>

      {/* Poignée de redimensionnement (coin bas-droit) — voir SIZE_KEY/compact ci-dessus. */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-fuchsia-400/70 flex items-center justify-center text-[10px]"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      >⤡</div>
    </div>
  );
}
