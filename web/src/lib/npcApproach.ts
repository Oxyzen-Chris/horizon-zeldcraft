'use client';

import { useEffect, useState } from 'react';
import { WORLD_SIZE } from './worldTerrain';
import type { SynkDirection } from './gameState';

/**
 * Registre partagé (portée module, même technique que `lib/roamingActors.ts`/`lib/mapFilters.ts` —
 * aucun Context nécessaire, les trois widgets « Plateforme 2D isométrique »/« Plateforme 3D »/
 * « Mapmonde » sont montés simultanément dans le même arbre `/game`) pour le PNJ qui vient
 * ACTUELLEMENT solliciter le joueur (proposition de quête/troc/combat — voir
 * `NpcEncounterPopup.tsx`, tirage aléatoire 3-5×/jour).
 *
 * Corrige la demande utilisateur : « je veux le voir progressivement arriver et se déplacer avec
 * des mouvements naturels [...] jusqu'à Synk dans le widget Plateforme 2D isométrique et le widget
 * Plateforme 3D [...] je veux que [ce PNJ] soit clairement identifié sur la mapmonde [...] avec un
 * anneau clignotant [...] et indique sa position live réelle [...] en respectant bien les filtres
 * PNJ/Familiers ». Auparavant, `NpcEncounterPopup.tsx` remontait seulement l'IDENTITÉ du PNJ
 * (`EncounterMarkerInfo`, voir son commentaire « volontairement minimal, pas de position propre »)
 * et chaque widget le matérialisait INSTANTANÉMENT juste à côté de Synk (aucun mouvement, aucune
 * présence sur la Mapmonde). Ce module ajoute la position LIVE manquante, en coordonnées MAPMONDE
 * (0-100 %, même échelle que `players/{addr}/mapPos`), avec un déplacement progressif case par case
 * vers Synk — même principe que `lib/roamingActors.ts` (direction 8 valeurs, transition CSS
 * `duration-[1500ms]` côté widgets pour la démarche visuelle, voxel 3D articulé via `facing`/
 * `moving` réutilisés tels quels par `MarkerBlock`/`NpcVoxel`).
 *
 * Cycle de vie : `beginNpcApproach()` est appelé UNE SEULE FOIS, depuis `game/page.tsx` (seul point
 * central qui détient déjà `encounterNpc`), dès que `NpcEncounterPopup` signale l'ouverture d'une
 * rencontre (transition `null → info`) ; `endNpcApproach()` symétriquement à la fermeture. Les trois
 * widgets se contentent de LIRE cet état via `useNpcApproach()` — aucun n'est responsable de
 * déclencher/arrêter l'approche, pour éviter tout déclenchement en double.
 */
export interface NpcApproachState {
  /** true tant que la rencontre est ouverte (voir onEncounterChange) — les widgets n'affichent le
   * marqueur que si true, quelle que soit sa position (peut être hors-cadre juste après le début
   * de l'approche, exactement comme le PNJ/Dragon errant peut être hors-cadre — voir npcInView). */
  active: boolean;
  x: number; y: number;
  facing: SynkDirection;
  /** false une fois arrivé à portée de Synk (immobile, en attente d'une réponse à la rencontre). */
  moving: boolean;
}

const STEP_MS = 1100; // cadence de marche (plus rapide que l'errance ambiante à 4000ms — une
// rencontre sollicitée doit arriver en quelques secondes, pas en dizaines de secondes).
const MAX_STEP = 1.1; // distance (en cases) parcourue par tick, au plus
const ARRIVE_EPS = 1.2; // distance en-deçà de laquelle le PNJ est considéré "arrivé" près de Synk
// Distance de départ (en cases) par rapport à Synk au moment où la rencontre commence — assez loin
// pour que la marche soit visible plusieurs ticks (« progressivement »), assez proche pour rester
// généralement dans le champ de la caméra 2D/3D (voir GameCanvas2D.tsx::COLS/ROWS et
// Platform3DWidget.tsx::VIEW_RADIUS) sans devoir attendre trop longtemps hors-cadre.
const START_MIN_DIST = 3, START_MAX_DIST = 6;

let state: NpcApproachState = { active: false, x: 50, y: 87, facing: 'down', moving: false };
let synkTarget = { x: 50, y: 88 }; // dernière position connue de Synk (voir reportSynkApproachTarget)
const listeners = new Set<(s: NpcApproachState) => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function notify(): void { listeners.forEach((l) => l(state)); }

/** Direction de marche à 8 valeurs à partir d'un delta continu (et non ±1 entier comme dans
 * `lib/roamingActors.ts`, ce module utilisant des pas fractionnaires) — seuil de 0.15 case pour
 * ignorer le bruit d'arrondi proche de zéro sur un axe. */
function directionFromDelta(dx: number, dy: number): SynkDirection | null {
  const sx = dx > 0.15 ? 1 : dx < -0.15 ? -1 : 0;
  const sy = dy > 0.15 ? 1 : dy < -0.15 ? -1 : 0;
  if (sx === 0 && sy === 0) return null;
  if (sx === 0) return sy < 0 ? 'up' : 'down';
  if (sy === 0) return sx < 0 ? 'left' : 'right';
  return sx < 0 ? (sy < 0 ? 'up-left' : 'down-left') : (sy < 0 ? 'up-right' : 'down-right');
}

/** Case cible juste à côté de Synk (au nord, ou au sud si Synk est collé au bord haut de la
 * mapmonde) — même logique que l'ancienne `encounterCell` locale de GameCanvas2D.tsx/
 * WorldMapWidget.tsx, reportée ici en coordonnées mapmonde absolues. */
function targetCellFor(synk: { x: number; y: number }): { x: number; y: number } {
  return { x: synk.x, y: synk.y > 1 ? synk.y - 1 : Math.min(WORLD_SIZE, synk.y + 1) };
}

function stepApproach(): void {
  if (!state.active) return;
  const target = targetCellFor(synkTarget);
  const dx = target.x - state.x, dy = target.y - state.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE_EPS) {
    if (state.moving) { state = { ...state, moving: false }; notify(); }
    return;
  }
  const stepLen = Math.min(MAX_STEP, dist);
  const ux = dx / dist, uy = dy / dist;
  const nx = Math.max(0, Math.min(WORLD_SIZE, state.x + ux * stepLen));
  const ny = Math.max(0, Math.min(WORLD_SIZE, state.y + uy * stepLen));
  state = { ...state, x: nx, y: ny, facing: directionFromDelta(dx, dy) ?? state.facing, moving: true };
  notify();
}

function ensureInterval(): void {
  if (intervalId || listeners.size === 0) return;
  intervalId = setInterval(stepApproach, STEP_MS);
}
function maybeStopInterval(): void {
  if (listeners.size === 0 && intervalId) { clearInterval(intervalId); intervalId = null; }
}

/** Renseigné en continu par GameCanvas2D.tsx/Platform3DWidget.tsx (déjà abonnés à
 * `subscribePlayerMapPos`) — indépendant de `active`, pour que la cible soit toujours à jour dès
 * que `beginNpcApproach()` est appelé. */
export function reportSynkApproachTarget(x: number, y: number): void {
  synkTarget = { x, y };
}

/** Démarre une nouvelle approche à une distance aléatoire de Synk (voir START_MIN_DIST/MAX_DIST) —
 * idempotent si déjà active (ne relance pas une position de départ en cours de rencontre). */
export function beginNpcApproach(): void {
  if (state.active) return;
  const angle = Math.random() * Math.PI * 2;
  const radius = START_MIN_DIST + Math.random() * (START_MAX_DIST - START_MIN_DIST);
  const startX = Math.max(0, Math.min(WORLD_SIZE, synkTarget.x + Math.cos(angle) * radius));
  const startY = Math.max(0, Math.min(WORLD_SIZE, synkTarget.y + Math.sin(angle) * radius));
  const dx = synkTarget.x - startX, dy = synkTarget.y - startY;
  state = { active: true, x: startX, y: startY, facing: directionFromDelta(dx, dy) ?? 'down', moving: true };
  notify();
  ensureInterval();
}

/** Termine l'approche (rencontre refusée/acceptée/fermée) — masque le marqueur dans les 3 widgets. */
export function endNpcApproach(): void {
  if (!state.active) return;
  state = { ...state, active: false, moving: false };
  notify();
}

export function getNpcApproachState(): NpcApproachState { return state; }

export function subscribeNpcApproach(cb: (s: NpcApproachState) => void): () => void {
  listeners.add(cb);
  ensureInterval();
  return () => { listeners.delete(cb); maybeStopInterval(); };
}

/** Hook React — s'abonne à l'approche partagée tant que le composant appelant reste monté. */
export function useNpcApproach(): NpcApproachState {
  const [s, setS] = useState(state);
  useEffect(() => subscribeNpcApproach(setS), []);
  return s;
}
