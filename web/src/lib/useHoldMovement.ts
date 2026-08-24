'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface HoldMovementOptions {
  /** Intervalle (ms) entre deux pas tant que la touche/le bouton reste maintenu(e) en "marche". */
  walkStepMs: number;
  /** Intervalle (ms) entre deux pas une fois basculé en "course" (après le seuil de maintien). */
  runStepMs: number;
  /** Durée de maintien ininterrompu (ms) avant de basculer de la marche à la course. */
  runHoldThresholdMs: number;
  /** Optionnel : notifié à chaque bascule marche⇄course (pour piloter un état React d'affichage,
   * ex. SynkSkin.tsx::running — évite d'appeler `isRunning()` en polling). */
  onRunChange?: (running: boolean) => void;
}

/**
 * Hook de déplacement à cadence entièrement pilotée par le jeu — remplace la dépendance à la
 * répétition automatique native du clavier (délai/cadence variables selon l'OS/le pilote, cause du
 * bug rapporté "Synk avance de 2 cases par appui") par un contrôle explicite : `press(dx,dy)`
 * déclenche IMMÉDIATEMENT un premier pas (comportement historique d'un simple appui/clic) puis
 * démarre une cadence de marche (`walkStepMs`) ; si la direction reste maintenue SANS interruption
 * pendant `runHoldThresholdMs`, la cadence bascule sur la course (`runStepMs`), jusqu'à `release()`.
 * `update(dx,dy)` change uniquement la direction ciblée SANS réinitialiser la cadence ni le seuil de
 * course déjà entamé (permet par ex. de passer d'un déplacement cardinal à une diagonale en gardant
 * l'élan de course, quand le clavier combine plusieurs flèches enfoncées simultanément).
 *
 * Utilisé identiquement par GameCanvas2D.tsx (Plateforme 2D isométrique) et Platform3DWidget.tsx
 * (Plateforme 3D) pour le clavier, le pavé directionnel virtuel ET les boutons de souris maintenus,
 * garantissant EXACTEMENT le même ressenti de déplacement dans les deux vues (voir RepRules
 * .movementWalkStepMs/movementRunStepMs/movementRunHoldThresholdMs, réglables en Administration).
 */
export function useHoldMovement(move: (dx: number, dy: number) => void, opts: HoldMovementOptions) {
  const activeRef = useRef<{ dx: number; dy: number } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thresholdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const moveRef = useRef(move);
  useEffect(() => { moveRef.current = move; }, [move]);
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; }, [opts]);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (thresholdTimerRef.current) { clearTimeout(thresholdTimerRef.current); thresholdTimerRef.current = null; }
  }, []);

  const startInterval = useCallback((ms: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const a = activeRef.current;
      if (a) moveRef.current(a.dx, a.dy);
    }, Math.max(30, ms));
  }, []);

  /** Démarre (ou redémarre depuis zéro) un maintien de direction — 1er pas immédiat + cadence marche. */
  const press = useCallback((dx: number, dy: number) => {
    activeRef.current = { dx, dy };
    if (runningRef.current) optsRef.current.onRunChange?.(false);
    runningRef.current = false;
    moveRef.current(dx, dy);
    clearTimers();
    startInterval(optsRef.current.walkStepMs);
    thresholdTimerRef.current = setTimeout(() => {
      runningRef.current = true;
      optsRef.current.onRunChange?.(true);
      // Pas immédiat au moment précis de la bascule marche→course : SANS cela, l'ancienne cadence
      // marche (walkStepMs, ex. 220ms) vient d'être coupée (le dernier pas peut dater de presque
      // walkStepMs) et la nouvelle cadence course (runStepMs, ex. 110ms) ne produira son premier pas
      // qu'après un délai supplémentaire — l'écart total entre le DERNIER pas "marche" et le PREMIER
      // pas "course" peut donc dépasser `WALK_STOP_DELAY_MS` (le délai d'inactivité, côté appelant,
      // qui remet `isRunning`/`isWalking` à false pour détecter un relâchement de touche). Ce trou de
      // cadence déclenchait alors ce reset PENDANT que la touche restait pourtant maintenue,
      // repassant `isRunning` à false quelques dizaines de ms à peine après être passé à true — et
      // plus rien ne le repassait à true ensuite (cette transition n'est notifiée qu'une seule fois
      // par maintien). Corrige le bug rapporté « je ne vois jamais Synk courir en maintenant une
      // touche plus de 3s » : ce pas immédiat comble exactement ce trou.
      const a = activeRef.current;
      if (a) moveRef.current(a.dx, a.dy);
      startInterval(optsRef.current.runStepMs);
    }, Math.max(0, optsRef.current.runHoldThresholdMs));
  }, [clearTimers, startInterval]);

  /** Change la direction ciblée d'un maintien EN COURS, sans réinitialiser cadence/seuil de course. */
  const update = useCallback((dx: number, dy: number) => {
    activeRef.current = { dx, dy };
  }, []);

  /** Arrête tout maintien en cours (relâchement de touche/bouton). */
  const release = useCallback(() => {
    activeRef.current = null;
    if (runningRef.current) optsRef.current.onRunChange?.(false);
    runningRef.current = false;
    clearTimers();
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Objet retourné MÉMOÏSÉ (voir dépendances ci-dessous, toutes des useCallback à identité stable) —
  // corrige le bug rapporté "je ne peux jamais me mettre à courir en maintenant une touche" :
  // GameCanvas2D.tsx et Platform3DWidget.tsx référencent tous deux cet objet dans le tableau de
  // dépendances de leur `useEffect` d'écoute clavier (ex. `}, [collapsed, hold]);`) pour pouvoir
  // relâcher proprement le maintien au démontage/changement de vue. Sans mémoïsation, CE hook
  // renvoyait un NOUVEL objet littéral à CHAQUE rendu du composant appelant — et comme `move(dx,dy)`
  // change la position de Synk (donc re-render) à CHAQUE pas, cela réexécutait cet effet à chaque
  // pas, dont le nettoyage appelait `release()` et annulait ainsi l'intervalle ET le minuteur de
  // bascule marche→course AVANT que celui-ci (`runHoldThresholdMs`, ex. 1.5s) n'ait jamais le temps
  // de se déclencher : la course ne pouvait donc jamais s'activer. `isRunning`/`isActive` restent
  // des fermetures sur les refs internes (toujours à jour), donc aucune perte de fraîcheur des
  // données malgré la mémoïsation.
  return useMemo(() => ({
    press, update, release,
    isRunning: () => runningRef.current,
    isActive: () => activeRef.current !== null,
  }), [press, update, release]);
}
