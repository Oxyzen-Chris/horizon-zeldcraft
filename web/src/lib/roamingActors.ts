'use client';

import { useEffect, useState } from 'react';
import { clamp100 } from './worldTerrain';
import type { MapMarker } from './gameState';

/**
 * Registre partagé (portée module, même technique que lib/mapFilters.ts et lib/platform3dActive.ts
 * — aucun Context nécessaire, les deux widgets sont montés simultanément dans le même arbre
 * `/game`) pour le PNJ errant et le Dragon errant qui peuplent la Plateforme 2D isométrique
 * (GameCanvas2D.tsx) depuis leur création.
 *
 * Corrige la demande utilisateur : « faire en sorte que je les vois également se déplacer dans le
 * widget Plateforme 3D, de telle manière à les voir passer de case en case, de façon cohérente avec
 * leur déplacement dans la Plateforme 2D isométrique ». Avant ce module, chaque widget gérait SA
 * PROPRE errance en `useState` local (coordonnées de VIEWPORT LOCAL pour GameCanvas2D, qui n'a même
 * pas de sens pour Platform3DWidget) : impossible de les synchroniser sans dupliquer la logique.
 *
 * Ce module devient donc la SEULE source de vérité, en coordonnées MAPMONDE (0-100 %, exactement
 * l'échelle de `players/{addr}/mapPos`, voir gameState.ts::setPlayerMapPos) plutôt qu'en coordonnées
 * de viewport : chaque widget convertit ensuite vers son propre repère d'affichage (GameCanvas2D
 * soustrait son `origin` de caméra pour revenir en coordonnées LOCALES ; Platform3DWidget soustrait
 * directement `centerCol`/`centerRow` de Synk, exactement comme pour tout marqueur catalogue via
 * `sceneMarkers`). Ainsi le PNJ/Dragon errant occupe TOUJOURS la même position mapmonde, quel que
 * soit le widget qui l'affiche, avec la même identité catalogue (voir `ensureRoamingIdentities`).
 *
 * Cadence et amplitude d'errance INCHANGÉES par rapport à l'ancienne implémentation locale de
 * GameCanvas2D.tsx (4000 ms, ±1 case aléatoire par axe) — zéro régression sur le comportement 2D
 * déjà en place. Un mécanisme d'« attache » (TETHER_X/TETHER_Y, reporté via `reportSynkWorldPos`)
 * reproduit l'effet de bord qu'avait le viewport local de GameCanvas2D (les acteurs ne pouvaient
 * pas s'éloigner de la caméra centrée sur Synk) : sans lui, en coordonnées mapmonde globales, rien
 * n'empêcherait le PNJ/Dragon de dériver indéfiniment hors de vue au fil du temps.
 */
export interface RoamingActorPos { x: number; y: number }
export interface RoamingActorsState {
  npc: RoamingActorPos;
  dragon: RoamingActorPos;
  /** Identité catalogue (voir gameState.ts::MapMarker) attribuée une fois, figée tant que le
   * catalogue reste chargé — garantit que 2D et 3D affichent le même PNJ/Dragon nommé. */
  npcMarkerId: string | null;
  dragonMarkerId: string | null;
}

const STEP_MS = 4000; // cadence historique (voir ancien setInterval de GameCanvas2D.tsx)
// Demi-amplitude d'attache autour de la dernière position connue de Synk — reprend l'ordre de
// grandeur de l'ancien viewport local COLSxROWS (10x8) de GameCanvas2D.tsx (moitié ~5x4).
const TETHER_X = 5, TETHER_Y = 4;

// Positions de départ proches du point d'apparition par défaut partagé par les deux widgets
// (voir `useState<Pos>({ x: 50, y: 88 })` dans GameCanvas2D.tsx ET Platform3DWidget.tsx) — reste
// cohérent dès le tout premier rendu, avant même la résolution de la vraie position via Firebase.
let state: RoamingActorsState = {
  npc: { x: 52, y: 87 },
  dragon: { x: 48, y: 90 },
  npcMarkerId: null,
  dragonMarkerId: null,
};

let synkPos: RoamingActorPos = { x: 50, y: 88 };
const listeners = new Set<(s: RoamingActorsState) => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function notify(): void { listeners.forEach((l) => l(state)); }

/** Clampe `v` à la fois dans la fenêtre d'attache [center±half] ET dans les bornes mapmonde 0-100. */
function clampTethered(v: number, center: number, half: number): number {
  return clamp100(Math.max(center - half, Math.min(center + half, v)));
}

function stepActors(): void {
  state = {
    ...state,
    npc: {
      x: clampTethered(state.npc.x + (Math.random() < 0.5 ? -1 : 1), synkPos.x, TETHER_X),
      y: clampTethered(state.npc.y + (Math.random() < 0.5 ? -1 : 1), synkPos.y, TETHER_Y),
    },
    dragon: {
      x: clampTethered(state.dragon.x + (Math.random() < 0.5 ? -1 : 1), synkPos.x, TETHER_X),
      y: clampTethered(state.dragon.y + (Math.random() < 0.5 ? -1 : 1), synkPos.y, TETHER_Y),
    },
  };
  notify();
}

function ensureInterval(): void {
  if (intervalId || listeners.size === 0) return;
  intervalId = setInterval(stepActors, STEP_MS);
}
function maybeStopInterval(): void {
  if (listeners.size === 0 && intervalId) { clearInterval(intervalId); intervalId = null; }
}

/** Signale la position mapmonde courante de Synk — appelé par les DEUX widgets depuis leur effet
 * `worldPos` existant. Purement une donnée de référence pour l'attache (ci-dessus) : ne déclenche
 * jamais lui-même de notification (le prochain tick de `stepActors` suffit à recentrer si besoin). */
export function reportSynkWorldPos(x: number, y: number): void {
  synkPos = { x, y };
}

/** Attribue au PNJ/Dragon errant une véritable entrée du catalogue, dès que celui-ci est chargé —
 * idempotent (premier appelant gagne, quel que soit le widget) afin que 2D et 3D affichent
 * TOUJOURS la même identité. Reprend exactement l'ancienne logique locale de GameCanvas2D.tsx
 * (dragon errant préférant un familier "dragon.*", voir DragonSkin.tsx::dragonKindFromId). */
export function ensureRoamingIdentities(markers: MapMarker[]): void {
  if (state.npcMarkerId && state.dragonMarkerId) return;
  let changed = false;
  const next = { ...state };
  if (!next.npcMarkerId) {
    const pool = markers.filter((m) => m.kind === 'npc');
    if (pool.length) { next.npcMarkerId = pool[Math.floor(Math.random() * pool.length)].id; changed = true; }
  }
  if (!next.dragonMarkerId) {
    const familiars = markers.filter((m) => m.kind === 'familiar');
    const dragons = familiars.filter((m) => /^dragon\./i.test(m.id));
    const pool = dragons.length ? dragons : familiars;
    if (pool.length) { next.dragonMarkerId = pool[Math.floor(Math.random() * pool.length)].id; changed = true; }
  }
  if (changed) { state = next; notify(); }
}

export function getRoamingActorsState(): RoamingActorsState { return state; }

export function subscribeRoamingActors(cb: (s: RoamingActorsState) => void): () => void {
  listeners.add(cb);
  ensureInterval();
  return () => { listeners.delete(cb); maybeStopInterval(); };
}

/** Hook React — s'abonne à l'errance partagée tant que le composant appelant reste monté (démarre
 * l'intervalle de mouvement au premier abonné, l'arrête au dernier — jamais de minuteur qui tourne
 * dans le vide si aucun des deux widgets n'est monté). */
export function useRoamingActors(): RoamingActorsState {
  const [s, setS] = useState(state);
  useEffect(() => subscribeRoamingActors(setS), []);
  return s;
}
