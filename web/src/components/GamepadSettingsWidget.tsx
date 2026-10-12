'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget, scopedKey } from '@/lib/useDraggableWidget';
import { useEffectiveAccount } from '@/lib/effectiveAccount';
import { WidgetContextMenu } from './WidgetContextMenu';
import {
  GAMEPAD_ACTION_IDS, GAMEPAD_BUTTON_SHORT_LABEL, DEFAULT_BUTTON_ACTION_MAP, CONFIGURABLE_BUTTON_INDICES,
  getGamepadButtonMap, configureGamepadButtonMap, withButtonAction, subscribeGamepadStatus,
  getFirstConnectedGamepad, GAMEPAD_ACTION_EVENT,
  type GamepadActionId, type GamepadStatus, type GamepadActionEventDetail,
} from '@/lib/gamepadInput';

const POS_KEY = 'zc.gamepadWidgetPos';
const COLLAPSED_KEY = 'zc.gamepadWidgetCollapsed';
/** Clé localStorage (scopée par joueur, voir scopedKey) de l'association bouton → action
 * personnalisée — même schéma de persistance que les autres préférences par compte. */
const MAP_KEY = 'zc.gamepadButtonMap';

/**
 * Fenêtre flottante et déplaçable "Manette" (voir lib/gamepadInput.ts pour l'architecture complète)
 * — voir demande utilisateur « Tu créeras un nouveau widget de configuration du GamePad où le
 * joueur pourra définir, programmer ces touches, ces raccourcis ». Affiche le statut de connexion
 * (Gamepad API), la liste des 10 actions configurables avec le bouton actuellement assigné, un
 * bouton "Redéfinir" par action (appui-pour-détecter : le prochain bouton pressé sur la manette est
 * capturé et assigné) et un bouton de réinitialisation aux valeurs par défaut (disposition
 * Nintendo, voir DEFAULT_BUTTON_ACTION_MAP). Ne sonde JAMAIS la manette pour le jeu lui-même (voir
 * GameCanvas2D.tsx, émetteur unique de GAMEPAD_ACTION_EVENT) — uniquement pour sa propre fonction de
 * reprogrammation (appui-pour-détecter ci-dessous), strictement locale à ce widget.
 */
export function GamepadSettingsWidget({ enabled = true }: { enabled?: boolean } = {}) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - 300, y: 500 }),
    onExpand: bringToFront,
  });

  const [status, setStatus] = useState<GamepadStatus>({ connected: false, id: null });
  const [buttonMap, setButtonMap] = useState<Record<number, GamepadActionId>>(() => getGamepadButtonMap());
  const [listeningFor, setListeningFor] = useState<GamepadActionId | null>(null);

  // Bouton "+" (Plus) de la manette (par défaut, voir lib/gamepadInput.ts) ouvre/ferme ce widget —
  // auto-abonnement comme les 6 autres widgets à bascule (Besace/Quêtes/Équipement/Carte/Boutique/
  // Statistiques), voir GameCanvas2D.tsx pour l'émission de l'évènement.
  useEffect(() => {
    if (!enabled) return;
    const onGamepadAction = (e: Event) => {
      const detail = (e as CustomEvent<GamepadActionEventDetail>).detail;
      if (detail?.action === 'gamepadSettings' && detail.pressed) toggleCollapsed();
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, [enabled, toggleCollapsed]);

  // Statut de connexion (voir subscribeGamepadStatus — notifie immédiatement l'état courant, puis à
  // chaque connexion/déconnexion).
  useEffect(() => {
    return subscribeGamepadStatus(setStatus);
  }, []);

  // Charge l'association bouton → action personnalisée du joueur (si déjà reprogrammée lors d'une
  // session précédente) — repli silencieux sur DEFAULT_BUTTON_ACTION_MAP (déjà actif par défaut
  // dans gamepadInput.ts) si rien n'est encore mémorisé pour ce compte.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(scopedKey(MAP_KEY, address));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<number, GamepadActionId>;
      configureGamepadButtonMap(parsed);
      setButtonMap(getGamepadButtonMap());
    } catch { /* ignore un éventuel JSON corrompu, conserve les valeurs par défaut */ }
  }, [address]);

  // Boucle "appui-pour-détecter" (voir bouton "Redéfinir" ci-dessous) : sonde la manette jusqu'à
  // détecter le FRONT montant d'un bouton configurable qui n'était PAS déjà enfoncé au moment où la
  // détection a démarré (la `baseline` évite de capturer immédiatement le bouton physique qui
  // aurait, par coïncidence, servi à ouvrir ce widget — voir action "+"/gamepadSettings ci-dessus).
  useEffect(() => {
    if (!listeningFor) return;
    let rafId = 0;
    let baseline: boolean[] | null = null;
    const tick = () => {
      const gp = getFirstConnectedGamepad();
      if (gp) {
        if (!baseline) {
          baseline = CONFIGURABLE_BUTTON_INDICES.map((i) => gp.buttons[i]?.pressed ?? false);
        } else {
          for (let k = 0; k < CONFIGURABLE_BUTTON_INDICES.length; k++) {
            const i = CONFIGURABLE_BUTTON_INDICES[k];
            const pressed = gp.buttons[i]?.pressed ?? false;
            if (pressed && !baseline[k]) {
              const next = withButtonAction(getGamepadButtonMap(), i, listeningFor);
              configureGamepadButtonMap(next);
              setButtonMap(next);
              localStorage.setItem(scopedKey(MAP_KEY, address), JSON.stringify(next));
              setListeningFor(null);
              return;
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [listeningFor, address]);

  const resetDefaults = () => {
    configureGamepadButtonMap(DEFAULT_BUTTON_ACTION_MAP);
    setButtonMap(getGamepadButtonMap());
    if (typeof window !== 'undefined') {
      localStorage.setItem(scopedKey(MAP_KEY, address), JSON.stringify(DEFAULT_BUTTON_ACTION_MAP));
    }
    setListeningFor(null);
  };

  /** Bouton actuellement assigné à `action` (recherche inverse dans `buttonMap`), ou `null` si
   * aucun bouton n'y est assigné. */
  const buttonForAction = (action: GamepadActionId): number | null => {
    for (const k of Object.keys(buttonMap)) {
      const i = Number(k);
      if (buttonMap[i] === action) return i;
    }
    return null;
  };

  if (!enabled || !pos) return null;

  if (collapsed) {
    return (
      <>
        <button
          ref={containerRef}
          className="fixed z-40 w-14 h-14 rounded-full bg-slate-900 border-2 border-lime-500 text-2xl shadow-lg flex items-center justify-center"
          style={{ left: pos.x, top: pos.y, zIndex: z }}
          onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onClick={onToggleClick}
          onContextMenu={onContextMenu}
          title={t('gamepad.title')}
        >🎮</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-40 w-80 bg-slate-900 border-2 border-lime-500 rounded-xl shadow-xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, zIndex: z, maxHeight: '70vh' }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-lime-900/30 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="font-semibold text-sm truncate">🎮 {t('gamepad.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0" data-widget-close onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />

      <div className="p-3 space-y-3 overflow-y-auto">
        <div className={`text-xs px-2 py-1.5 rounded-lg ${status.connected ? 'bg-emerald-900/40 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
          {status.connected
            ? `${t('gamepad.status.connected')}${status.id ? ` — ${status.id}` : ''}`
            : t('gamepad.status.disconnected')}
          <p className="text-[10px] text-slate-500 mt-0.5">{t('gamepad.status.hint')}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{t('gamepad.rightStickHint')}</p>
        </div>

        <div className="space-y-1.5">
          {GAMEPAD_ACTION_IDS.map((action) => {
            const btn = buttonForAction(action);
            const label = btn != null ? GAMEPAD_BUTTON_SHORT_LABEL[btn] : '—';
            const isListening = listeningFor === action;
            return (
              <div key={action} className="flex items-center justify-between gap-2 bg-slate-800/60 rounded-lg px-2 py-1.5">
                <span className="text-xs truncate">{t(`gamepad.action.${action}`)}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs font-mono bg-slate-700 rounded px-1.5 py-0.5 min-w-[1.5rem] text-center">{label}</span>
                  <button
                    className={`text-[11px] px-2 py-0.5 rounded ${isListening ? 'bg-amber-700/70 text-amber-100' : 'bg-lime-800/60 text-lime-100 hover:bg-lime-700/60'}`}
                    onClick={() => setListeningFor(isListening ? null : action)}
                  >{isListening ? t('gamepad.listening') : t('gamepad.remap')}</button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          className="w-full text-xs px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
          onClick={resetDefaults}
        >↺ {t('gamepad.reset')}</button>
      </div>
    </div>
  );
}
