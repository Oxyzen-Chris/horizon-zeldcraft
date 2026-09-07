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
 *
 * 🆕 PNJ de rencontre PERSISTANTS (`extras`, voir spawnExtraRoamingActor ci-dessous) — corrige la
 * demande utilisateur : « les PNJ qui viennent à la rencontre de Synk ne doivent pas disparaitre
 * ensuite [...] mais continuer à progresser, se déplacer puis revenir si besoin vers Synk ».
 * Auparavant, `lib/npcApproach.ts::endNpcApproach()` désactivait purement et simplement le PNJ de
 * rencontre à la fermeture du pop-up (`NpcEncounterPopup.tsx`) : plus aucune trace dans aucun des 3
 * widgets. Désormais, `app/game/page.tsx::handleEncounterChange` appelle `spawnExtraRoamingActor()`
 * (si `RepRules.npcPersistAfterEncounter !== false`) juste avant `endNpcApproach()`, avec la
 * DERNIÈRE position connue du PNJ (là où la rencontre s'est arrêtée) : celui-ci rejoint alors ce
 * même pool d'errance ambiante (identique algorithme `advanceActor`/`stepActors` que le PNJ/Dragon
 * errant historique) au lieu de disparaître, et peut donc — au gré du tirage aléatoire de
 * direction — revenir naturellement croiser Synk plus tard. Purement ADDITIF : `npc`/`dragon`
 * (les 2 acteurs historiques) et toute leur logique restent strictement inchangés, zéro régression.
 * Un acteur `extra` n'a PAS d'identité catalogue (aucune fiche PNJ/quête associée, contrairement à
 * `npc`/`dragon` dont l'identité est piochée dans `getAllMapMarkers()`) : il reste un PNJ visuel
 * "fantôme" non interactif (voir GameCanvas2D.tsx/Platform3DWidget.tsx, rendu en lecture seule,
 * exactement comme le marqueur `encounter.npc.live` pendant l'approche). Le nombre d'acteurs
 * persistants simultanés est plafonné (`RepRules.npcMaxPersistentExtras`, défaut 5) : au-delà, le
 * plus ANCIEN est retiré (file FIFO) pour éviter une croissance non bornée si de nombreuses
 * rencontres se terminent coup sur coup.
 */
export interface RoamingActorPos { x: number; y: number }
/** Un PNJ de rencontre "persisté" après la fermeture du pop-up (voir commentaire ci-dessus) — même
 * forme minimale qu'un `MapMarker` synthétique (voir lib/gameState.ts::MapMarker), mais géré ici
 * pour bénéficier du même moteur d'errance (`advanceActor`/`stepActors`) que `npc`/`dragon`. */
export interface ExtraRoamingActor {
  /** Stable, unique par rencontre (voir spawnExtraRoamingActor) — sert de clé React ET exempte ce
   * marqueur du "filtre intelligent" declutter (voir lib/mapFilters.ts::isLiveActorMarkerId). */
  id: string;
  kind: 'npc' | 'familiar';
  name: string;
  i18nKey?: string;
  icon: string;
  x: number; y: number;
  facing: SynkDirection;
  moving: boolean;
  /** Renseigné UNIQUEMENT si la rencontre d'origine a débouché sur une quête acceptée (offer
   * 'quest', voir NpcEncounterPopup.tsx::accept() + EncounterMarkerInfo.grantedQuestId) — rend ce
   * fantôme à nouveau CLIQUABLE (voir GameCanvas2D.tsx/Platform3DWidget.tsx) pour rouvrir un
   * rappel de l'énigme (réutilise PoiInteractionModal::QuestBody via un marqueur `kind:'quest'`
   * synthétique `{id: questId}`), plutôt que de rester muet en cas de second clic — corrige la
   * demande utilisateur « cliquer une nouvelle fois sur le PNJ même en ayant accepté la quête [...]
   * doit répondre à l'énigme [...] en lui reprécisant la question ». Les fantômes issus d'un
   * troc/combat/discussion restent volontairement non interactifs (rien à rappeler). */
  questId?: string;
}
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
  /** PNJ de rencontre persistés (voir ExtraRoamingActor ci-dessus) — vide par défaut. */
  extras: ExtraRoamingActor[];
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
  extras: [],
};

let npcMotion: ActorMotion = { dx: 0, dy: 0, holdTicks: 0 };
let dragonMotion: ActorMotion = { dx: 0, dy: 0, holdTicks: 0 };
// Une entrée de "motion" par acteur persisté (voir ExtraRoamingActor), indexée par son `id` stable
// — purgée dès qu'un acteur est retiré (plafond FIFO, voir spawnExtraRoamingActor).
const extraMotions = new Map<string, ActorMotion>();
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

// Nombre de ticks (à STEP_MS) pendant lesquels un PNJ de rencontre fraîchement persisté (voir
// spawnExtraRoamingActor) est forcé de s'ÉLOIGNER dans une direction tirée au sort, AVANT de
// rejoindre le comportement d'errance normal (pause possible incluse) ci-dessus. Corrige le bug
// remonté par l'utilisateur : « une multitude de PNJ apparaissent [...] en se déplaçant
// aléatoirement [...] dans la Plateforme 3D » — comme l'approche (lib/npcApproach.ts) se termine
// TOUJOURS adjacente à Synk, plusieurs rencontres successives faisaient auparavant apparaître
// jusqu'à `npcMaxPersistentExtras` fantômes quasiment superposés pile devant Synk (tous dans son
// petit rayon de vue 3D, voir VIEW_RADIUS), qui pouvaient ensuite rester immobiles ou dériver à
// peine (20% de chance de pause par maintien de seulement 3-9 ticks). Un maintien BEAUCOUP plus
// long (16 à 28 ticks, soit 64 à 112 s) et SANS tirage de pause garantit qu'un fantôme fraîchement
// créé quitte visiblement les abords de Synk avant de reprendre un comportement d'errance normal.
const ESCAPE_MIN_HOLD_TICKS = 16, ESCAPE_MAX_HOLD_TICKS = 28;

/** Direction de fuite tirée au sort (jamais {0,0}, contrairement à pickDirection() qui peut choisir
 * de rester immobile) — voir commentaire ci-dessus. */
function escapeMotion(): ActorMotion {
  const moveOnly = DIRECTIONS; // DIRECTIONS ne contient déjà que des déplacements réels (jamais 0,0)
  const dir = moveOnly[Math.floor(Math.random() * moveOnly.length)];
  const holdTicks = ESCAPE_MIN_HOLD_TICKS + Math.floor(Math.random() * (ESCAPE_MAX_HOLD_TICKS - ESCAPE_MIN_HOLD_TICKS + 1));
  return { dx: dir.dx, dy: dir.dy, holdTicks };
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
  // Fait avancer chaque PNJ de rencontre persisté (voir ExtraRoamingActor) exactement comme npc/
  // dragon ci-dessus — même moteur d'errance, même cadence (STEP_MS), position/motion indépendantes.
  const extras = state.extras.map((e) => {
    const motion = extraMotions.get(e.id) ?? { dx: 0, dy: 0, holdTicks: 0 };
    const result = advanceActor({ x: e.x, y: e.y }, motion);
    extraMotions.set(e.id, result.motion);
    return { ...e, x: result.pos.x, y: result.pos.y, facing: result.facing ?? e.facing, moving: result.moving };
  });
  state = {
    ...state,
    npc: npcResult.pos,
    dragon: dragonResult.pos,
    npcFacing: npcResult.facing ?? state.npcFacing,
    dragonFacing: dragonResult.facing ?? state.dragonFacing,
    npcMoving: npcResult.moving,
    dragonMoving: dragonResult.moving,
    extras,
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

/** Ajoute un PNJ de rencontre à la file d'errance persistante (voir ExtraRoamingActor et le
 * commentaire d'en-tête de ce module) — appelé UNIQUEMENT depuis `app/game/page.tsx` (juste avant
 * `endNpcApproach()`), avec la dernière position live connue du PNJ de rencontre. Idempotent (un
 * `id` déjà présent n'est pas dupliqué). `maxCount` (voir RepRules.npcMaxPersistentExtras, défaut
 * 5) plafonne la file : au-delà, le plus ANCIEN acteur persisté est retiré (FIFO) pour éviter une
 * croissance non bornée si de nombreuses rencontres se terminent coup sur coup — sa `motion`
 * associée est purgée de `extraMotions` au même moment.
 * `questId` (optionnel) : voir ExtraRoamingActor.questId — propagé tel quel, rend ce fantôme
 * cliquable pour rouvrir un rappel de l'énigme correspondante. */
export function spawnExtraRoamingActor(
  actor: { id: string; kind: 'npc' | 'familiar'; name: string; i18nKey?: string; icon: string; x: number; y: number; questId?: string },
  maxCount = 5,
): void {
  if (state.extras.some((e) => e.id === actor.id)) return;
  let next: ExtraRoamingActor[] = [...state.extras, { ...actor, facing: 'down', moving: false }];
  const cap = Math.max(1, maxCount);
  while (next.length > cap) next = next.slice(1);
  // Fuite immédiate loin de Synk (voir escapeMotion ci-dessus) au lieu d'un maintien nul qui
  // provoquait un tirage de direction quasi-immédiat (3-9 ticks, 20% de chance de pause) et donc un
  // amas de fantômes quasi immobiles pile devant Synk après plusieurs rencontres rapprochées.
  extraMotions.set(actor.id, escapeMotion());
  for (const key of Array.from(extraMotions.keys())) {
    if (!next.some((e) => e.id === key)) extraMotions.delete(key);
  }
  state = { ...state, extras: next };
  notify();
  ensureInterval();
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
