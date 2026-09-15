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
 * 🔧 Cadence accélérée et configurable (`stepMs`, défaut 1500 au lieu de 4000 historique — voir
 * `configureRoaming`/`getRoamStepMs` plus bas) : corrige la demande utilisateur « fais en sorte
 * qu'ils avancent un peu plus vite [...] qu'ils marchent sans faire une pause de 2 secondes entre
 * chaque déplacement ». Les DURÉES DE MAINTIEN (marche/pause/fuite) restent exprimées en secondes
 * réelles (voir `secToTicks`) et non plus en nombre de ticks fixe, pour ne PAS raccourcir le rythme
 * de marche déjà en place malgré l'accélération de la cadence — zéro régression sur ce point.
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
 *
 * 🆕 TOUS les familiers/dragons du catalogue errent désormais, pas seulement le "Dragon errant"
 * historique (`dragon`/`dragonMarkerId`) — corrige le bug remonté par l'utilisateur : « les
 * familiers et donc les dragons (par exemple le Dragon Vert) [...] ne se déplacent pas, restent
 * fixes et rebondissent sur eux-mêmes [...] fais en sorte que les Dragons et les familiers se
 * déplacent aussi et au même titre que les PNJ ». Avant ce correctif, seul UN familier (pioché une
 * fois par `ensureRoamingIdentities` dans `dragonMarkerId`) bénéficiait du moteur d'errance
 * `advanceActor`/`stepActors` ; tous les AUTRES marqueurs `kind:'familiar'` du catalogue restaient
 * de purs marqueurs statiques, dépourvus de `facing`/`moving`, et retombaient donc dans
 * `MarkerBlock` (Platform3DWidget.tsx) sur l'ancienne rotation continue idle générique (« toupie »)
 * réservée aux objets en lévitation — exactement le symptôme observé (dragon figé qui tourne sur
 * lui-même). Le nouveau champ `familiars` (voir `RoamingFamiliarState` ci-dessous), peuplé par
 * `ensureRoamingIdentities` pour CHAQUE marqueur `kind:'familiar'` AUTRE que celui déjà assigné à
 * `dragonMarkerId` (pour ne jamais faire avancer deux fois le même marqueur via deux mécanismes
 * différents), et avancé à chaque tick de `stepActors()` exactement comme `extras` ci-dessus, est
 * PUREMENT ADDITIF : `npc`/`dragon`/`npcMarkerId`/`dragonMarkerId` et tout ce qui en dépend ailleurs
 * (ex. lib/mapFilters.ts::isLiveActorMarkerId) restent strictement inchangés, zéro régression.
 */
export interface RoamingActorPos { x: number; y: number }
/** Position/orientation EN DIRECT d'un familier (dragon ou autre) du catalogue qui erre désormais
 * au même titre que le Dragon errant historique — voir commentaire d'en-tête ci-dessus. Indexé par
 * l'id du marqueur catalogue (`MapMarker.id`, ex. "dragon.green") dans `RoamingActorsState.familiars`
 * ci-dessous : les widgets retrouvent le nom/icône/kind via ce même id auprès de `getAllMapMarkers()`,
 * seule la position/facing/moving diffère de sa fiche catalogue statique. */
export interface RoamingFamiliarState extends RoamingActorPos { facing: SynkDirection; moving: boolean }
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
  /** Libellé/clé i18n de la QUÊTE elle-même (QuestDef.label/i18nKey — QUI EST littéralement le
   * texte de l'énigme, ex. "🪨 Énigme 1 : ... Que suis-je ?", voir i18n/messages/*.json), à ne
   * SURTOUT PAS confondre avec `name`/`i18nKey` ci-dessus qui restent le nom de l'ARCHÉTYPE PNJ
   * (ex. "Faucheur d'Automne") — uniquement renseignés si `questId` l'est. Corrige le bug remonté
   * par l'utilisateur : le pop-up de rappel affichait le nom du PNJ au lieu de la question, faute
   * de cette donnée distincte propagée jusqu'ici (voir GameCanvas2D.tsx::onExtraQuestClick /
   * Platform3DWidget.tsx::onExtraQuestClick3D, qui construisent le marqueur `kind:'quest'` à partir
   * de ces deux champs plutôt que de `name`/`i18nKey`). */
  questLabel?: string;
  questI18nKey?: string;
}
/** Faune sauvage (hibou/loup-garou) — voir WildlifeActorState/ensureWildlifeSpawns ci-dessous.
 * Corrige le bug remonté par l'utilisateur : « le loup garou et le hibou me suivent quand je me
 * déplace, comme s'ils étaient accroché à Synk ». Avant ce correctif, `Owl3D`/`Werewolf3D`
 * (Platform3DAmbientScene.tsx) étaient positionnés à un offset LOCAL fixe (ex. `[2.4,0,-3.4]`) dans
 * le repère de la scène 3D — or ce repère est recentré sur Synk à CHAQUE rendu (voir
 * `Scene()::tiles`, coordonnées `dx=centerCol+dx`/`dz=centerRow+dz` : Synk reste TOUJOURS à
 * l'origine locale, c'est le DÉCOR qui défile autour de lui). Un offset local fixe restait donc
 * TOUJOURS exactement au même endroit relatif à Synk, quel que soit l'endroit du monde où celui-ci
 * se trouvait réellement — recréant, sans le vouloir, l'ancien mécanisme d'« attache » déjà retiré
 * pour le PNJ/Dragon errant historique (voir commentaire d'en-tête du module). Ces deux créatures
 * deviennent donc de VRAIES entités mapmonde (coordonnées 0-100, comme `npc`/`dragon`/`familiars`
 * ci-dessus), qui errent avec le même moteur `advanceActor`/`stepActors`, sont localisées sur le
 * widget "Mapmonde" (voir WorldMapWidget.tsx) et dont le nombre est paramétrable en Administration
 * (voir RepRules.wildlifeOwlCount/wildlifeWerewolfCount/wildlifeBoarCount, RepRulesPanel.tsx).
 * 🔧 `'boar'` (sanglier + marcassins, troupeau) ajouté par analogie EXACTE pour corriger le même
 * bug remonté séparément par l'utilisateur pour le troupeau de sangliers dans Platform3DAmbientScene.
 * tsx (`Boar3D`/`BoarHerd3D` y étaient positionnés par translation LOCALE directe, glués à Synk et
 * orientés perpendiculairement à leur déplacement réel — « ils se déplacent en biais de côté [...]
 * je ne peux jamais les atteindre car ils glissent dans le décor »). Un point d'apparition `'boar'`
 * représente tout le petit troupeau (1 adulte + marcassins rendus en formation fixe, voir Boar3D). */
export type WildlifeKind = 'owl' | 'werewolf' | 'boar';
export interface WildlifeActorState extends RoamingActorPos { facing: SynkDirection; moving: boolean; kind: WildlifeKind }

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
  /** TOUS les familiers/dragons du catalogue AUTRES que celui déjà piloté par `dragon`/
   * `dragonMarkerId` ci-dessus (voir RoamingFamiliarState et le commentaire d'en-tête « TOUS les
   * familiers/dragons du catalogue errent désormais ») — indexé par `MapMarker.id`, vide par défaut,
   * peuplé par `ensureRoamingIdentities`. */
  familiars: Record<string, RoamingFamiliarState>;
  /** Hibou(x)/loup-garou(s) errants (voir WildlifeActorState ci-dessus) — indexé par un id stable
   * `owl-N`/`werewolf-N`, vide par défaut, peuplé par `ensureWildlifeSpawns`. */
  wildlife: Record<string, WildlifeActorState>;
}

interface ActorMotion { dx: number; dy: number; holdTicks: number }

// 🔧 Cadence/pauses/gel de proximité DÉSORMAIS CONFIGURABLES (voir configureRoaming ci-dessous,
// appelé par les 3 widgets dès que RepRules est chargé) — corrige la demande utilisateur :
// « fais en sorte qu'ils avancent un peu plus vite [...] qu'ils marchent sans faire une pause de
// 2 secondes entre chaque déplacement [...] mais laisse-les de temps en temps se poser
// aléatoirement 4-8 secondes [...] arrête leur déplacement [quand Synk est à côté] ». `stepMs`
// (défaut 1500, au lieu de 4000 historique) est intentionnellement identique à la durée de
// transition CSS `duration-[1500ms]` déjà câblée dans GameCanvas2D.tsx/WorldMapWidget.tsx : une
// nouvelle position cible arrive donc pile au moment où la transition précédente se termine, ce
// qui produit un glissement continu SANS le moindre temps mort (l'ancien écart 1500ms-transition vs
// 4000ms-tick laissait ~2,5s d'immobilité visuelle à chaque tick — exactement le symptôme
// « piétinent puis avancent un peu » remonté par l'utilisateur). Platform3DWidget.tsx applique la
// même durée `getRoamStepMs()` à son interpolation linéaire (voir MarkerBlock) pour rester
// cohérent en 3D. Les durées de maintien de direction (walk/escape) restent exprimées en SECONDES
// RÉELLES (`WALK_HOLD_MIN_SEC` etc. ci-dessous) et non plus en nombre de ticks fixe, afin que leur
// durée perçue reste IDENTIQUE quel que soit `stepMs` configuré (zéro régression sur le rythme de
// marche déjà en place, même après avoir accéléré la cadence des ticks).
let stepMs = 1500;
// Marge de bordure : l'acteur erre dans [ROAM_MARGIN, WORLD_SIZE-ROAM_MARGIN], jamais collé pile
// au bord 0/100 du mapmonde (où le décor/la caméra 3D deviennent moins lisibles).
const ROAM_MARGIN = 3;
// Durée (secondes réelles) pendant laquelle une direction de MARCHE tirée au sort est conservée
// avant d'en choisir une nouvelle — démarche crédible (marche un moment, s'arrête parfois, repart).
// Valeurs historiques (12-36s) préservées telles quelles malgré l'accélération de `stepMs` (voir
// commentaire ci-dessus) — converties en nombre de ticks via `secToTicks()` au moment de l'usage.
const WALK_HOLD_MIN_SEC = 12, WALK_HOLD_MAX_SEC = 36;
// Durée (secondes réelles) d'une pause volontaire (acteur immobile un moment avant de repartir) —
// DISTINCTE de la durée de marche ci-dessus, configurable (défaut 4-8s, voir RepRules.roamPauseMin/
// MaxSec) — corrige la demande utilisateur « laisse-les de temps en temps se poser aléatoirement
// 4-8 secondes [...] pour permettre au joueur [...] d'échanger avec eux ». Remplace l'ancien
// comportement où une pause réutilisait par erreur le même tirage que la marche (jusqu'à 36s de
// pause, bien plus long que souhaité pour permettre une interaction rapide).
let pauseMinSec = 4, pauseMaxSec = 8;
const PAUSE_PROBABILITY = 0.2; // probabilité de rester immobile un moment plutôt que de repartir
// Gel de proximité (Synk adjacent) — voir reportSynkPositionForFreeze/advanceActor ci-dessous.
// Corrige la demande utilisateur : « quand Synk est juste à côté de PNJ, de Dragons ou de
// familiers, fais en sorte d'arrêter leur déplacement puis, quand Synk s'en va, remets les [...] en
// marche [...] ça permet d'éviter de courir derrière eux et aux joueurs d'échanger avec eux ».
let proximityFreezeEnabled = true;
let proximityFreezeTiles = 2; // ≈ adjacence (1 case cardinale = 1 unité, 1 case diagonale ≈ 1,41)
/** Délai (secondes réelles) au bout duquel un acteur gelé par proximité REPREND sa marche même si
 * Synk reste à proximité — voir RepRules.roamProximityFreezeResumeSec. Corrige le bug remonté par
 * l'utilisateur : « une multitude de PNJ [...] s'aglutinent et restent bloqués sur Synk [...] alors
 * qu'ils devraient [...] pouvoir se remettre à se déplacer si Synk [...] n'interragit[ent] pas ».
 * Sans ce délai, un gel de proximité permanent (tant que Synk reste à portée) finissait par
 * accumuler tous les acteurs errants passant par là en une masse figée indéfiniment. */
let proximityFreezeResumeSec = 6;
/** Horodatage (ms, `Date.now()`) du DÉBUT du gel courant pour chaque acteur, indexé par un id
 * stable (voir `advanceActor` ci-dessous) — retiré dès que l'acteur ressort du rayon de proximité,
 * afin qu'une NOUVELLE approche redémarre un délai de grâce complet. */
const freezeStartedAt = new Map<string, number>();
/** Id du marqueur avec lequel le joueur est ACTUELLEMENT en interaction (pop-up de rencontre/quête
 * ouvert, voir setInteractingActorId ci-dessous) — `null` si aucun pop-up n'est ouvert. Tant que
 * cet id correspond à celui d'un acteur gelé par proximité, ce dernier reste immobile indéfiniment
 * (jamais de reprise automatique après `proximityFreezeResumeSec`, contrairement au cas général). */
let interactingActorId: string | null = null;
/** Dernière position CONNUE de Synk (coordonnées mapmonde 0-100, voir reportSynkPositionForFreeze)
 * — `null` tant qu'aucun widget n'a encore rapporté de position (aucun gel possible dans ce cas).
 * ⚠️ Sert UNIQUEMENT à geler un acteur déjà à proximité — ne le fait JAMAIS se rapprocher ni
 * s'orienter vers Synk (ce serait réintroduire l'ancien mécanisme d'« attache » déjà supprimé, voir
 * commentaire d'en-tête du module : « il ne fait pas réaliste [...] aimantés à Synk »). */
let synkPos: RoamingActorPos | null = null;
/** Convertit une durée en secondes réelles en nombre de ticks (à `stepMs` courant), jamais moins
 * de 1 — voir commentaire de `WALK_HOLD_MIN_SEC` ci-dessus sur l'intérêt de cette indirection. */
function secToTicks(sec: number): number { return Math.max(1, Math.round((sec * 1000) / stepMs)); }

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
  familiars: {},
  wildlife: {},
};

let npcMotion: ActorMotion = { dx: 0, dy: 0, holdTicks: 0 };
let dragonMotion: ActorMotion = { dx: 0, dy: 0, holdTicks: 0 };
// Une entrée de "motion" par acteur persisté (voir ExtraRoamingActor), indexée par son `id` stable
// — purgée dès qu'un acteur est retiré (plafond FIFO, voir spawnExtraRoamingActor).
const extraMotions = new Map<string, ActorMotion>();
// Une entrée de "motion" par familier généraliste (voir RoamingFamiliarState), indexée par son id
// catalogue — jamais purgée (contrairement à extraMotions) : un familier du catalogue reste
// PERMANENT tant que le catalogue est chargé, aucun plafond FIFO ne s'applique ici.
const familiarMotions = new Map<string, ActorMotion>();
// Une entrée de "motion" par hibou/loup-garou errant (voir WildlifeActorState), indexée par son id
// stable `owl-N`/`werewolf-N` — régénérée intégralement par `ensureWildlifeSpawns` à chaque
// changement de comptage/seed (contrairement à familiarMotions, la faune n'a pas d'identité
// catalogue permanente : elle est purement procédurale).
const wildlifeMotions = new Map<string, ActorMotion>();
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

/** Nombre de ticks pour un maintien : MARCHE (12-36s réelles, historique) si `dx`/`dy` indique un
 * vrai déplacement, sinon PAUSE volontaire (4-8s réelles par défaut, `pauseMinSec`/`pauseMaxSec`,
 * voir configureRoaming) — remplace l'ancien `randomHoldTicks()` unique qui appliquait par erreur
 * la même plage (jusqu'à 36s) aux deux cas, rendant les pauses bien trop longues pour permettre une
 * interaction rapide avec le joueur. */
function randomHoldTicks(isPause: boolean): number {
  const minSec = isPause ? pauseMinSec : WALK_HOLD_MIN_SEC;
  const maxSec = isPause ? pauseMaxSec : WALK_HOLD_MAX_SEC;
  const minTicks = secToTicks(minSec), maxTicks = Math.max(minTicks, secToTicks(maxSec));
  return minTicks + Math.floor(Math.random() * (maxTicks - minTicks + 1));
}

// Durée (secondes réelles, voir secToTicks) pendant laquelle un PNJ de rencontre fraîchement
// persisté (voir spawnExtraRoamingActor) est forcé de s'ÉLOIGNER dans une direction tirée au sort,
// AVANT de rejoindre le comportement d'errance normal (pause possible incluse) ci-dessus. Corrige
// le bug remonté par l'utilisateur : « une multitude de PNJ apparaissent [...] en se déplaçant
// aléatoirement [...] dans la Plateforme 3D » — comme l'approche (lib/npcApproach.ts) se termine
// TOUJOURS adjacente à Synk, plusieurs rencontres successives faisaient auparavant apparaître
// jusqu'à `npcMaxPersistentExtras` fantômes quasiment superposés pile devant Synk (tous dans son
// petit rayon de vue 3D, voir VIEW_RADIUS), qui pouvaient ensuite rester immobiles ou dériver à
// peine. Un maintien BEAUCOUP plus long (64 à 112 s réelles) et SANS tirage de pause garantit qu'un
// fantôme fraîchement créé quitte visiblement les abords de Synk avant de reprendre un
// comportement d'errance normal. Exprimé en secondes (et non plus en ticks fixes) pour rester
// EXACTEMENT la même durée réelle malgré l'accélération de `stepMs` (voir commentaire plus haut).
const ESCAPE_MIN_HOLD_SEC = 64, ESCAPE_MAX_HOLD_SEC = 112;

/** Direction de fuite tirée au sort (jamais {0,0}, contrairement à pickDirection() qui peut choisir
 * de rester immobile) — voir commentaire ci-dessus. */
function escapeMotion(): ActorMotion {
  const moveOnly = DIRECTIONS; // DIRECTIONS ne contient déjà que des déplacements réels (jamais 0,0)
  const dir = moveOnly[Math.floor(Math.random() * moveOnly.length)];
  const minTicks = secToTicks(ESCAPE_MIN_HOLD_SEC), maxTicks = Math.max(minTicks, secToTicks(ESCAPE_MAX_HOLD_SEC));
  const holdTicks = minTicks + Math.floor(Math.random() * (maxTicks - minTicks + 1));
  return { dx: dir.dx, dy: dir.dy, holdTicks };
}

/** Distance (mapmonde, échelle 0-100) entre `pos` et la dernière position connue de Synk, ou
 * `Infinity` si celle-ci n'a jamais été rapportée (aucun gel possible). */
function distanceToSynk(pos: RoamingActorPos): number {
  if (!synkPos) return Infinity;
  return Math.hypot(pos.x - synkPos.x, pos.y - synkPos.y);
}

/** Fait avancer un acteur d'un tick : choisit une nouvelle direction si le maintien courant est
 * épuisé (ou si un bord de mapmonde vient d'être atteint), applique le déplacement borné à
 * `[ROAM_MARGIN, WORLD_SIZE-ROAM_MARGIN]`, et renvoie la nouvelle position/motion/facing/moving.
 * 🔒 Gel de proximité (voir commentaire de `proximityFreezeEnabled` ci-dessus) : si Synk se trouve
 * à `proximityFreezeTiles` cases ou moins, l'acteur reste IMMOBILE — `motion` (direction ET
 * `holdTicks` restants) n'est PAS consommé, afin que l'acteur reprenne EXACTEMENT là où il en était
 * (même direction, même maintien restant) une fois le gel levé, plutôt que de perdre sa
 * progression ou de tirer immédiatement une nouvelle direction aléatoire. Le gel n'est TOUTEFOIS
 * plus permanent (voir `proximityFreezeResumeSec`/`freezeStartedAt` ci-dessus) : passé ce délai
 * sans interaction du joueur avec CET acteur précis (`interactingActorId`), il reprend sa marche
 * même si Synk reste à proximité — corrige l'aglutination de PNJ signalée par l'utilisateur. */
function advanceActor(pos: RoamingActorPos, motion: ActorMotion, id: string): {
  pos: RoamingActorPos; motion: ActorMotion; moving: boolean; facing: SynkDirection | null;
} {
  const withinRange = proximityFreezeEnabled && distanceToSynk(pos) <= proximityFreezeTiles;
  if (withinRange) {
    const now = Date.now();
    let startedAt = freezeStartedAt.get(id);
    if (startedAt === undefined) { startedAt = now; freezeStartedAt.set(id, now); }
    const elapsedSec = (now - startedAt) / 1000;
    const interacting = interactingActorId !== null && interactingActorId === id;
    if (interacting || elapsedSec < proximityFreezeResumeSec) {
      return { pos, motion, moving: false, facing: null };
    }
    // Délai de grâce écoulé et aucune interaction en cours : l'acteur reprend sa marche normale
    // ci-dessous MÊME s'il reste géographiquement à proximité (tant qu'il ne s'en éloigne pas puis
    // ne s'en rapproche pas à nouveau, `freezeStartedAt` n'est pas réinitialisé — voir ci-dessous).
  } else {
    freezeStartedAt.delete(id);
  }
  let { dx, dy, holdTicks } = motion;
  if (holdTicks <= 0) {
    const dir = pickDirection();
    dx = dir.dx; dy = dir.dy;
    holdTicks = randomHoldTicks(dx === 0 && dy === 0);
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
  const npcResult = advanceActor(state.npc, npcMotion, state.npcMarkerId ?? 'main-npc');
  const dragonResult = advanceActor(state.dragon, dragonMotion, state.dragonMarkerId ?? 'main-dragon');
  npcMotion = npcResult.motion;
  dragonMotion = dragonResult.motion;
  // Fait avancer chaque PNJ de rencontre persisté (voir ExtraRoamingActor) exactement comme npc/
  // dragon ci-dessus — même moteur d'errance, même cadence (STEP_MS), position/motion indépendantes.
  const extras = state.extras.map((e) => {
    const motion = extraMotions.get(e.id) ?? { dx: 0, dy: 0, holdTicks: 0 };
    const result = advanceActor({ x: e.x, y: e.y }, motion, e.id);
    extraMotions.set(e.id, result.motion);
    return { ...e, x: result.pos.x, y: result.pos.y, facing: result.facing ?? e.facing, moving: result.moving };
  });
  // Fait avancer TOUS les familiers/dragons généralistes du catalogue (voir RoamingFamiliarState et
  // le commentaire d'en-tête « TOUS les familiers/dragons du catalogue errent désormais ») — même
  // moteur d'errance que ci-dessus, chacun avec sa propre motion indépendante.
  const familiarIds = Object.keys(state.familiars);
  let familiars = state.familiars;
  if (familiarIds.length) {
    familiars = { ...state.familiars };
    for (const id of familiarIds) {
      const cur = state.familiars[id];
      const motion = familiarMotions.get(id) ?? { dx: 0, dy: 0, holdTicks: 0 };
      const result = advanceActor({ x: cur.x, y: cur.y }, motion, id);
      familiarMotions.set(id, result.motion);
      familiars[id] = { x: result.pos.x, y: result.pos.y, facing: result.facing ?? cur.facing, moving: result.moving };
    }
  }
  // Fait avancer la faune errante (hibou(x)/loup-garou(s), voir WildlifeActorState/
  // ensureWildlifeSpawns) exactement comme familiars ci-dessus — même moteur d'errance/gel de
  // proximité, chacun avec sa propre motion indépendante.
  const wildlifeIds = Object.keys(state.wildlife);
  let wildlife = state.wildlife;
  if (wildlifeIds.length) {
    wildlife = { ...state.wildlife };
    for (const id of wildlifeIds) {
      const cur = state.wildlife[id];
      const motion = wildlifeMotions.get(id) ?? { dx: 0, dy: 0, holdTicks: 0 };
      const result = advanceActor({ x: cur.x, y: cur.y }, motion, id);
      wildlifeMotions.set(id, result.motion);
      wildlife[id] = { x: result.pos.x, y: result.pos.y, facing: result.facing ?? cur.facing, moving: result.moving, kind: cur.kind };
    }
  }
  state = {
    ...state,
    npc: npcResult.pos,
    dragon: dragonResult.pos,
    npcFacing: npcResult.facing ?? state.npcFacing,
    dragonFacing: dragonResult.facing ?? state.dragonFacing,
    npcMoving: npcResult.moving,
    dragonMoving: dragonResult.moving,
    extras,
    familiars,
    wildlife,
  };
  notify();
}

function ensureInterval(): void {
  if (intervalId || listeners.size === 0) return;
  intervalId = setInterval(stepActors, stepMs);
}
function maybeStopInterval(): void {
  if (listeners.size === 0 && intervalId) { clearInterval(intervalId); intervalId = null; }
}

/** Cadence courante (ms) entre deux positions cible des acteurs errants — voir `stepMs` ci-dessus.
 * Lu par GameCanvas2D.tsx/WorldMapWidget.tsx (durée de transition CSS) et Platform3DWidget.tsx
 * (durée de l'interpolation linéaire 3D) pour rester PARFAITEMENT synchronisés avec la cadence
 * réelle des ticks, quelle que soit la valeur configurée en Administration. */
export function getRoamStepMs(): number { return stepMs; }

/** Reçoit la config Administration (voir RepRules.roamStepMs/roamPauseMinSec/roamPauseMaxSec/
 * roamProximityFreezeEnabled/roamProximityFreezeTiles, RepRulesPanel.tsx section « 🚶 Déplacement
 * des PNJ/Familiers errants ») — appelé par les 3 widgets dès que les règles sont chargées, aucun
 * effet si `undefined`/absent (conserve alors les valeurs par défaut ci-dessus). Redémarre
 * l'intervalle de mouvement en cours SI `stepMs` change réellement (un `setInterval` déjà créé ne
 * reprend jamais tout seul un nouveau délai) — idempotent et sans effet si la valeur ne change pas
 * (évite de réinitialiser inutilement l'intervalle à chaque re-render des widgets appelants). */
export function configureRoaming(cfg: {
  stepMs?: number; pauseMinSec?: number; pauseMaxSec?: number;
  proximityFreezeEnabled?: boolean; proximityFreezeTiles?: number; proximityFreezeResumeSec?: number;
}): void {
  if (typeof cfg.stepMs === 'number' && cfg.stepMs > 0 && cfg.stepMs !== stepMs) {
    stepMs = cfg.stepMs;
    if (intervalId) { clearInterval(intervalId); intervalId = null; ensureInterval(); }
  }
  if (typeof cfg.pauseMinSec === 'number' && cfg.pauseMinSec > 0) pauseMinSec = cfg.pauseMinSec;
  if (typeof cfg.pauseMaxSec === 'number' && cfg.pauseMaxSec > 0) pauseMaxSec = cfg.pauseMaxSec;
  if (typeof cfg.proximityFreezeEnabled === 'boolean') proximityFreezeEnabled = cfg.proximityFreezeEnabled;
  if (typeof cfg.proximityFreezeTiles === 'number' && cfg.proximityFreezeTiles >= 0) proximityFreezeTiles = cfg.proximityFreezeTiles;
  if (typeof cfg.proximityFreezeResumeSec === 'number' && cfg.proximityFreezeResumeSec >= 0) proximityFreezeResumeSec = cfg.proximityFreezeResumeSec;
}

/** À appeler par les widgets à chaque ouverture/fermeture d'un pop-up de rencontre/quête (voir
 * `interactionMarker` dans GameCanvas2D.tsx/Platform3DWidget.tsx/WorldMapWidget.tsx) avec l'id du
 * marqueur concerné (`null` à la fermeture) — tant que cet id reste renseigné, l'acteur
 * correspondant reste gelé indéfiniment MÊME au-delà de `proximityFreezeResumeSec` (voir
 * `advanceActor` ci-dessus), pour ne jamais faire fuir un PNJ/familier en pleine discussion. */
export function setInteractingActorId(id: string | null): void {
  interactingActorId = id;
}

/** Rapporte la position COURANTE de Synk (coordonnées mapmonde 0-100, même échelle que
 * `players/{addr}/mapPos`) — utilisée UNIQUEMENT pour geler un acteur déjà à proximité (voir
 * `advanceActor`/`proximityFreezeTiles` ci-dessus), JAMAIS pour le faire suivre/s'orienter vers
 * Synk (voir avertissement sur `synkPos` ci-dessus). Appelée par les 3 widgets (GameCanvas2D.tsx/
 * Platform3DWidget.tsx/WorldMapWidget.tsx) à chaque mise à jour de `players/{addr}/mapPos`, exactement
 * comme `reportSynkApproachTarget` (lib/npcApproach.ts) — plusieurs widgets peuvent chacun être
 * démonté/masqué indépendamment, donc tous rapportent la même valeur pour garantir qu'elle reste
 * alimentée quel que soit celui effectivement monté. */
export function reportSynkPositionForFreeze(x: number, y: number): void {
  synkPos = { x, y };
}

/** Attribue au PNJ/Dragon errant une véritable entrée du catalogue, dès que celui-ci est chargé —
 * idempotent (premier appelant gagne, quel que soit le widget) afin que 2D et 3D affichent
 * TOUJOURS la même identité. Reprend exactement l'ancienne logique locale de GameCanvas2D.tsx
 * (dragon errant préférant un familier "dragon.*", voir DragonSkin.tsx::dragonKindFromId).
 *
 * 🆕 Peuple AUSSI `familiars` (voir RoamingFamiliarState) pour CHAQUE marqueur `kind:'familiar'` du
 * catalogue AUTRE que celui déjà assigné à `dragonMarkerId` — voir le commentaire d'en-tête du
 * module. L'ancien early-return (`if (npcMarkerId && dragonMarkerId) return`) a été retiré pour que
 * cette étape s'exécute même après que npc/dragon aient déjà été assignés lors d'un appel
 * précédent ; la boucle reste idempotente (un id déjà présent dans `familiars` n'est jamais
 * retraité), donc sûre à appeler plusieurs fois (une fois par widget monté, voir GameCanvas2D.tsx/
 * Platform3DWidget.tsx) sans jamais réinitialiser une position déjà en mouvement. */
export function ensureRoamingIdentities(markers: MapMarker[]): void {
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
  let familiarsCopy: Record<string, RoamingFamiliarState> | null = null;
  for (const m of markers) {
    if (m.kind !== 'familiar') continue;
    if (m.id === next.dragonMarkerId) continue; // déjà piloté par dragon/dragonMarkerId ci-dessus
    if (next.familiars[m.id]) continue; // déjà tracké (idempotent)
    if (!familiarsCopy) familiarsCopy = { ...next.familiars };
    familiarsCopy[m.id] = { x: m.x, y: m.y, facing: 'down', moving: false };
    familiarMotions.set(m.id, { dx: 0, dy: 0, holdTicks: 0 });
    changed = true;
  }
  if (familiarsCopy) next.familiars = familiarsCopy;
  if (changed) { state = next; notify(); ensureInterval(); }
}

// Point d'apparition par défaut partagé (voir commentaire de `state` ci-dessus) — sert d'ancrage
// pour garantir qu'au moins 1 hibou ET 1 loup-garou apparaissent à portée raisonnable du joueur
// (voir `ensureWildlifeSpawns` ci-dessous), au lieu d'un tirage 100% uniforme sur toute la
// mapmonde qui pourrait statistiquement placer les 25 individus loin de tout parcours réaliste.
const DEFAULT_SPAWN = { x: 50, y: 88 };
// Rayon (cases mapmonde) dans lequel le PREMIER hibou et le PREMIER loup-garou générés sont forcés
// d'apparaître autour de DEFAULT_SPAWN — garantit une rencontre quasi certaine en tout début de
// partie sans pour autant les coller littéralement sur le point d'apparition (peu naturel).
const GUARANTEED_ENCOUNTER_MIN_RADIUS = 12, GUARANTEED_ENCOUNTER_MAX_RADIUS = 25;

function clampWorld(v: number): number {
  return Math.max(ROAM_MARGIN, Math.min(WORLD_SIZE - ROAM_MARGIN, v));
}

/** Tire une position aléatoire : soit UNIFORME sur toute la plage d'errance (`guaranteed=false`),
 * soit à une distance `[GUARANTEED_ENCOUNTER_MIN_RADIUS, ...MAX_RADIUS]` de `DEFAULT_SPAWN` (angle
 * aléatoire) si `guaranteed=true` — voir commentaire ci-dessus. */
function randomWildlifeSpawn(guaranteed: boolean): RoamingActorPos {
  if (guaranteed) {
    const angle = Math.random() * Math.PI * 2;
    const radius = GUARANTEED_ENCOUNTER_MIN_RADIUS + Math.random() * (GUARANTEED_ENCOUNTER_MAX_RADIUS - GUARANTEED_ENCOUNTER_MIN_RADIUS);
    return { x: clampWorld(DEFAULT_SPAWN.x + Math.cos(angle) * radius), y: clampWorld(DEFAULT_SPAWN.y + Math.sin(angle) * radius) };
  }
  return { x: ROAM_MARGIN + Math.random() * (WORLD_SIZE - 2 * ROAM_MARGIN), y: ROAM_MARGIN + Math.random() * (WORLD_SIZE - 2 * ROAM_MARGIN) };
}

// Derniers paramètres appliqués (voir ensureWildlifeSpawns) — évite de régénérer TOUTES les
// positions à chaque appel (un appel a lieu depuis chacun des 3 widgets à leur montage) : seule une
// VRAIE variation d'un des 4 paramètres (dont `seedVersion`, incrémenté par le bouton Administration
// « 🎲 Regénérer les positions ») déclenche une régénération complète.
let lastWildlifeEnabled: boolean | null = null;
let lastWildlifeOwlCount = -1;
let lastWildlifeWerewolfCount = -1;
let lastWildlifeBoarCount = -1;
let lastWildlifeSeedVersion = -1;

/** (Re)génère la faune errante (hibou(x)/loup-garou(s)/troupeau(x) de sangliers) — voir
 * WildlifeActorState/RepRules.wildlife* (RepRulesPanel.tsx). Idempotent : n'effectue RIEN si
 * `enabled`/`owlCount`/`werewolfCount`/`boarCount`/`seedVersion` sont IDENTIQUES au dernier appel
 * ayant réellement régénéré la faune (permet un appel sans risque depuis les 3 widgets à chaque
 * montage/changement de RepRules). `seedVersion` (voir RepRules.wildlifeSpawnSeed) est un simple
 * compteur : l'incrémenter (bouton Administration) force une régénération avec de NOUVELLES
 * positions aléatoires même si les comptages n'ont pas changé. `enabled=false` vide entièrement
 * `wildlife` (aucune faune affichée dans aucun widget) sans pour autant perdre les compteurs suivis
 * ci-dessus (réactiver restaure le même comptage). `boarCount` par défaut à 0 (paramètre optionnel)
 * pour rester rétro-compatible avec d'éventuels appelants non mis à jour. */
export function ensureWildlifeSpawns(enabled: boolean, owlCount: number, werewolfCount: number, seedVersion: number, boarCount = 0): void {
  const safeOwl = Math.max(0, Math.round(owlCount));
  const safeWere = Math.max(0, Math.round(werewolfCount));
  const safeBoar = Math.max(0, Math.round(boarCount));
  if (enabled === lastWildlifeEnabled && safeOwl === lastWildlifeOwlCount && safeWere === lastWildlifeWerewolfCount
    && safeBoar === lastWildlifeBoarCount && seedVersion === lastWildlifeSeedVersion) {
    return; // rien n'a réellement changé — évite de re-tirer aléatoirement à chaque montage de widget
  }
  lastWildlifeEnabled = enabled; lastWildlifeOwlCount = safeOwl; lastWildlifeWerewolfCount = safeWere;
  lastWildlifeBoarCount = safeBoar; lastWildlifeSeedVersion = seedVersion;
  wildlifeMotions.clear();
  const wildlife: Record<string, WildlifeActorState> = {};
  if (enabled) {
    for (let i = 0; i < safeOwl; i++) {
      const pos = randomWildlifeSpawn(i === 0);
      wildlife[`owl-${i}`] = { ...pos, facing: 'down', moving: false, kind: 'owl' };
      wildlifeMotions.set(`owl-${i}`, { dx: 0, dy: 0, holdTicks: 0 });
    }
    for (let i = 0; i < safeWere; i++) {
      const pos = randomWildlifeSpawn(i === 0);
      wildlife[`werewolf-${i}`] = { ...pos, facing: 'down', moving: false, kind: 'werewolf' };
      wildlifeMotions.set(`werewolf-${i}`, { dx: 0, dy: 0, holdTicks: 0 });
    }
    for (let i = 0; i < safeBoar; i++) {
      const pos = randomWildlifeSpawn(i === 0);
      wildlife[`boar-${i}`] = { ...pos, facing: 'down', moving: false, kind: 'boar' };
      wildlifeMotions.set(`boar-${i}`, { dx: 0, dy: 0, holdTicks: 0 });
    }
  }
  state = { ...state, wildlife };
  notify();
  ensureInterval();
}

/** Ajoute un PNJ de rencontre à la file d'errance persistante (voir ExtraRoamingActor et le
 * commentaire d'en-tête de ce module) — appelé UNIQUEMENT depuis `app/game/page.tsx` (juste avant
 * `endNpcApproach()`), avec la dernière position live connue du PNJ de rencontre. Idempotent (un
 * `id` déjà présent n'est pas dupliqué). `maxCount` (voir RepRules.npcMaxPersistentExtras, défaut
 * 5) plafonne la file : au-delà, le plus ANCIEN acteur persisté est retiré (FIFO) pour éviter une
 * croissance non bornée si de nombreuses rencontres se terminent coup sur coup — sa `motion`
 * associée est purgée de `extraMotions` au même moment.
 * `questId` (optionnel) : voir ExtraRoamingActor.questId — propagé tel quel, rend ce fantôme
 * cliquable pour rouvrir un rappel de l'énigme correspondante. `questLabel`/`questI18nKey`
 * (optionnels) : voir ExtraRoamingActor.questLabel/questI18nKey — texte de l'énigme elle-même,
 * distinct de `name`/`i18nKey` (nom de l'archétype PNJ). */
export function spawnExtraRoamingActor(
  actor: {
    id: string; kind: 'npc' | 'familiar'; name: string; i18nKey?: string; icon: string; x: number; y: number;
    questId?: string; questLabel?: string; questI18nKey?: string;
  },
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
