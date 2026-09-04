'use client';

import { useEffect, useState } from 'react';
import { WORLD_SIZE } from './worldTerrain';
import type { MapMarker, SynkDirection } from './gameState';

/**
 * Registre partagé (portée module, même technique que lib/mapFilters.ts et lib/platform3dActive.ts
 * — aucun Context nécessaire, les deux widgets sont montés simultanément dans le même arbre
 * `/game`) pour le PNJ errant et le Dragon errant qui peuplent la Plateforme 2D isométrique
 * (GameCanvas2D.tsx) et la Plateforme 3D (Platform3DWidget.tsx).
 *
 * Corrige la demande utilisateur : « faire en sorte que je les vois également se déplacer dans le
 * widget Plateforme 3D, de telle manière à les voir passer de case en case, de façon cohérente avec
 * leur déplacement dans la Plateforme 2D isométrique ». Ce module est la SEULE source de vérité, en
 * coordonnées MAPMONDE (0-100 %, exactement l'échelle de `players/{addr}/mapPos`, voir
 * gameState.ts::setPlayerMapPos) plutôt qu'en coordonnées de viewport : chaque widget convertit
 * ensuite vers son propre repère d'affichage (GameCanvas2D soustrait son `origin` de caméra pour
 * revenir en coordonnées LOCALES ; Platform3DWidget soustrait directement `centerCol`/`centerRow`
 * de Synk, exactement comme pour tout marqueur catalogue via `sceneMarkers`). Ainsi le PNJ/Dragon
 * errant occupe TOUJOURS la même position mapmonde, quel que soit le widget qui l'affiche, avec la
 * même identité catalogue (voir `ensureRoamingIdentities`).
 *
 * 🔧 Errance NATURELLE sur TOUTE la mapmonde (et non plus « aimantée » à Synk) : demande
 * utilisateur — « il faut que les deux PNJ se déplacent sur toute la mapmonde [...] car cela ne
 * fait pas réaliste [...] quand Synk se déplace [...] les deux PNJ le suivent comme s'ils étaient
 * aimantés à Synk, cela ne fait pas naturel ». L'ancien mécanisme d'« attache » (TETHER_X/TETHER_Y
 * autour de la dernière position connue de Synk, reporté via `reportSynkWorldPos`) a donc été
 * SUPPRIMÉ : chaque acteur erre librement dans toute la plage mapmonde `[ROAM_MARGIN, WORLD_SIZE -
 * ROAM_MARGIN]`, indépendamment de la position de Synk.
 *
 * Pour rester crédible (ni téléportation ni zigzag erratique à chaque tick), chaque acteur conserve
 * désormais une DIRECTION persistante (`dx`/`dy` ∈ {-1,0,1}, tirée au sort) pendant plusieurs ticks
 * consécutifs (`randomHoldTicks`, voir plus bas) avant d'en choisir une nouvelle — reproduit une
 * démarche de PNJ qui marche un moment dans une direction, s'arrête parfois, puis repart ailleurs,
 * plutôt qu'un « saut » aléatoire indépendant sur chaque axe à chaque tick. Un bord de mapmonde
 * force immédiatement le choix d'une nouvelle direction (évite de rester bloqué contre le bord).
 * Cadence historique inchangée (`STEP_MS = 4000`) — zéro régression sur le rythme déjà en place.
 *
 * `npcFacing`/`dragonFacing` (direction 8 valeurs) et `npcMoving`/`dragonMoving` (booléen) sont
 * dérivés de la direction courante et exposés pour piloter, côté 3D, l'orientation du personnage et
 * sa démarche animée (bras/jambes articulés, voir Platform3DWidget.tsx::NpcVoxel/DragonMarker) au
 * lieu de l'ancienne rotation continue générique (« toupie ») appliquée à tous les marqueurs
 * flottants.
 */
export interface RoamingActorPos { x: number; y: number }
export interface RoamingActorsState {
  npc: RoamingActorPos;
  dragon: RoamingActorPos;
  npcFacing: SynkDirection;
  dragonFacing: SynkDirection;
  npcMoving: boolean;
  dragonMoving: boolean;
  /** Identité catalogue (voir gameState.ts::MapMarker) attribuée une fois, figée tant que le
   * catalogue reste chargé — garantit que 2D et 3D affichent le même PNJ/Dragon nommé. */
  npcMarkerId: string | null;
  dragonMarkerId: string | null;
}

interface ActorMotion { dx: number; dy: number; holdTicks: number }

const STEP_MS = 4000; // cadence historique (voir ancien setInterval de GameCanvas2D.tsx)
// Marge de bordure : l'acteur erre dans [ROAM_MARGIN, WORLD_SIZE-ROAM_MARGIN], jamais collé pile
// au bord 0/100 du mapmonde (où le décor/la caméra 3D deviennent moins lisibles).
const ROAM_MARGIN = 3;
// Nombre de ticks (à STEP_MS) pendant lesquels une direction tirée au sort est conservée avant
// d'en choisir une nouvelle — démarche crédible (marche un moment, s'arrête parfois, repart).
const MIN_HOLD_TICKS = 3, MAX_HOLD_TICKS = 9; // 12s à 36s de marche continue dans le même axe
const PAUSE_PROBABILITY = 0.2; // probabilité de rester immobile un moment plutôt que de repartir

const DIRECTIONS: { dx: number; dy: number }[] = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
];

// Positions de départ proches du point d'apparition par défaut partagé par les deux widgets
// (voir `useState<Pos>({ x: 50, y: 88 })` dans GameCanvas2D.tsx ET Platform3DWidget.tsx) — reste
// cohérent dès le tout premier rendu, avant même la résolution de la vraie position via Firebase.
let state: RoamingActorsState = {
  npc: { x: 52, y: 87 },
  dragon: { x: 48, y: 90 },
  npcFacing: 'down',
  dragonFacing: 'down',
  npcMoving: false,
  dragonMoving: false,
  npcMarkerId: null,
  dragonMarkerId: null,
};

let npcMotion: ActorMotion = { dx: 0, dy: 0, holdTicks: 0 };
let dragonMotion: ActorMotion = { dx: 0, dy: 0, holdTicks: 0 };
const listeners = new Set<(s: RoamingActorsState) => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function notify(): void { listeners.forEach((l) => l(state)); }

/** Déduit la direction de marche à 8 valeurs à partir d'un delta (dx,dy) — copie fidèle de
 * GameCanvas2D.tsx/Platform3DWidget.tsx::directionFromDelta (non exportée là-bas) pour rester
 * cohérent visuellement entre les 3 vues (2D isométrique/3D/mapmonde). */
function directionFromDelta(dx: number, dy: number): SynkDirection | null {
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return dy < 0 ? 'up' : 'down';
  if (dy === 0) return dx < 0 ? 'left' : 'right';
  if (dx < 0) return dy < 0 ? 'up-left' : 'down-left';
  return dy < 0 ? 'up-right' : 'down-right';
}

function pickDirection(): { dx: number; dy: number } {
  if (Math.random() < PAUSE_PROBABILITY) return { dx: 0, dy: 0 };
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

function randomHoldTicks(): number {
  return MIN_HOLD_TICKS + Math.floor(Math.random() * (MAX_HOLD_TICKS - MIN_HOLD_TICKS + 1));
}

/** Fait avancer un acteur d'un tick : choisit une nouvelle direction si le maintien courant est
 * épuisé (ou si un bord de mapmonde vient d'être atteint), applique le déplacement borné à
 * `[ROAM_MARGIN, WORLD_SIZE-ROAM_MARGIN]`, et renvoie la nouvelle position/motion/facing/moving. */
function advanceActor(pos: RoamingActorPos, motion: ActorMotion): {
  pos: RoamingActorPos; motion: ActorMotion; moving: boolean; facing: SynkDirection | null;
} {
  let { dx, dy, holdTicks } = motion;
  if (holdTicks <= 0) {
    const dir = pickDirection();
    dx = dir.dx; dy = dir.dy;
    holdTicks = randomHoldTicks();
  }
  let nx = pos.x, ny = pos.y, blockedByEdge = false;
  if (dx !== 0 || dy !== 0) {
    const rawX = pos.x + dx, rawY = pos.y + dy;
    nx = Math.max(ROAM_MARGIN, Math.min(WORLD_SIZE - ROAM_MARGIN, rawX));
    ny = Math.max(ROAM_MARGIN, Math.min(WORLD_SIZE - ROAM_MARGIN, rawY));
    blockedByEdge = nx !== rawX || ny !== rawY;
  }
  holdTicks -= 1;
  // Bord de mapmonde atteint : force le choix d'une nouvelle direction au prochain tick plutôt que
  // de rester à pousser contre le mur jusqu'à épuisement du maintien courant.
  if (blockedByEdge) holdTicks = 0;
  const moving = dx !== 0 || dy !== 0;
  return { pos: { x: nx, y: ny }, motion: { dx, dy, holdTicks }, moving, facing: moving ? directionFromDelta(dx, dy) : null };
}

function stepActors(): void {
  const npcResult = advanceActor(state.npc, npcMotion);
  const dragonResult = advanceActor(state.dragon, dragonMotion);
  npcMotion = npcResult.motion;
  dragonMotion = dragonResult.motion;
  state = {
    ...state,
    npc: npcResult.pos,
    dragon: dragonResult.pos,
    npcFacing: npcResult.facing ?? state.npcFacing,
    dragonFacing: dragonResult.facing ?? state.dragonFacing,
    npcMoving: npcResult.moving,
    dragonMoving: dragonResult.moving,
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
