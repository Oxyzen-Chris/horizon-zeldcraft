'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  subscribePlayer, subscribeInventory, getKingdomQuestMarker, subscribeSolvedQuestIds,
  getZorghonEncounter, subscribeZorghonEncounter, subscribeEquipment, applyEffect,
  DEFAULT_PLATFORM3D_OBJECT_FLAGS, RKEY, dropInventoryItemAt, DEFAULT_AUDIO_SETTINGS,
  subscribeTakenParchmentIds, subscribeHiddenDragonFamiliarTaken, DEFAULT_SHOP,
  type MapMarker, type MapPoiType, type RepRules, type PlayerState, type InventoryItem,
  type ZorghonEncounterState, type SynkDirection, type EquipSlot, type EquippedItem,
  type Platform3DObjectKind, type Platform3DObjectFlags, type AudioSourceKey, type AudioSourceSetting,
} from '@/lib/gameState';
import { useHiddenTreasureIds } from '@/lib/treasureVisibility';
import { useWorldDrops, worldDropToMarker } from '@/lib/worldDrops';
import {
  worldTileAt, clamp100, WORLD_SIZE, TERRAIN_COLOR, PROP_ICON, PROP_I18N_KEY, hashRand,
  isObstacleAt, configureStargates, STARGATE_RING_RADIUS, type Tile,
} from '@/lib/worldTerrain';
import { STAGE_NAMES } from '@/lib/contract';
import { useI18n, localizeName } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget, scopedKey, readScoped } from '@/lib/useDraggableWidget';
import { useHoldMovement } from '@/lib/useHoldMovement';
import { setPlatform3DActive } from '@/lib/platform3dActive';
import { setUndergroundActive } from '@/lib/undergroundActive';
import { useRoamingActors, ensureRoamingIdentities, configureRoaming, reportSynkPositionForFreeze, reportWorldPois, setInteractingActorId, getRoamStepMs, ensureWildlifeSpawns, isWorldPosBlockedByLivingActor, isWorldPosBlockedByStaticMarker } from '@/lib/roamingActors';
import { useNpcApproach, reportSynkApproachTarget } from '@/lib/npcApproach';
import { WidgetContextMenu } from './WidgetContextMenu';
import { PoiInteractionModal } from './PoiInteractionModal';
import { HutRestModal } from './HutRestModal';
import { useEffectiveAccount } from '@/lib/effectiveAccount';
import { useWorldThemeAmbience } from '@/lib/useWorldTheme';
import { Platform3DAmbientScene, Owl3D, Werewolf3D, Boar3D, Zombie3D, Ghoul3D, Skeleton3D } from './Platform3DAmbientScene';
import { CryptTunnelScene, CRYPT_STAIR_STEPS, cryptDestinationRoomFor, HIDDEN_DRAGON_CRYPT_ID, CryptDoor, Torch, BEDROOM_OBSTACLES, PARCHMENT_OBSTACLES, type RoomObstacle } from './CryptTunnelScene';
import { ParchmentPopup } from './ParchmentPopup';
import { HiddenFamiliarPopup } from './HiddenFamiliarPopup';
import { useAdminAudioSettings, playAmbientSound } from '@/lib/audio';
import type { EncounterMarkerInfo } from './NpcEncounterPopup';

const POS_KEY = 'zc.platform3dWidgetPos';
const COLLAPSED_KEY = 'zc.platform3dWidgetCollapsed';

// Rayon (en cellules mapmonde, même échelle 0-100% que WorldMapWidget.tsx/GameCanvas2D.tsx) de
// terrain 3D effectivement rendu autour de Synk — volontairement plus petit que le COLSxROWS de la
// Plateforme 2D isométrique (fenêtre bien plus grande) car chaque cellule ici coûte un mesh 3D
// (perf), largement suffisant pour une exploration immersive centrée sur Synk.
const VIEW_RADIUS = 7;
const STEP_PCT = 1; // même pas qu'en 2D — voir GameCanvas2D.tsx::STEP_PCT (cohérence des 3 vues)
const CANVAS_W = 460, CANVAS_H = 360;
// Bornes du redimensionnement à la souris (coin bas-droit, voir onResizePointerMove) — plafond
// volontairement généreux (grand écran) ; le bouton "Plein écran" (RepRules.platform3dResizableEnabled)
// utilise en plus l'API Fullscreen native du navigateur pour agrandir jusqu'aux capacités maximales
// de l'écran, au-delà de ce plafond de redimensionnement manuel.
const MIN_W = 380, MIN_H = 300, MAX_W = 1400, MAX_H = 920;
const SIZE_KEY = 'zc.platform3dWidgetSize';
const WALK_STOP_DELAY_MS = 220; // identique à GameCanvas2D.tsx (voir sa constante du même nom)

/** Pont caméra ↔ conteneur DOM externe : `<Canvas>` de React Three Fiber ne propage PAS les
 * événements HTML5 natifs `dragover`/`drop` jusqu'aux meshes (seuls les vrais éléments DOM les
 * reçoivent), donc le glisser-déposer d'un objet de la besace (voir demande utilisateur "besace
 * → widget Plateforme 3D") est géré sur le `<div>` enveloppant `<Canvas>` (voir `fullscreenRef`
 * plus bas) avec un raycast manuel. Ce petit composant, monté SOUS `<Canvas>`, expose la caméra
 * R3F courante (mise à jour en continu par OrbitControls) via une ref lue par le gestionnaire
 * `onDrop` externe — sans lui, le raycast utiliserait la position de caméra INITIALE figée et
 * calculerait une position erronée dès que le joueur a orbité/zoomé à la souris. */
function CameraBridge({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree();
  useEffect(() => { cameraRef.current = camera; }, [camera, cameraRef]);
  return null;
}

/** 🔒 Positionne la caméra à la sortie d'une crypte (voir doc de `pendingExitCameraRef` dans le
 * composant parent pour l'historique complet des deux bugs corrigés : course avec `CryptCamera`,
 * puis décor non garanti dégagé à distance fixe). Monté DANS le `<Canvas>`, aux côtés de
 * `<CameraBridge>`/`<Scene>`, UNIQUEMENT une fois revenu au monde extérieur (donc après le
 * démontage réel de `<CryptTunnelScene>`) — chaque incrément de `requestId` (une sortie de crypte)
 * redéclenche un seul passage de cet effet, qui recule la caméra PAR VRAI RAYCAST contre la scène
 * déjà montée (arbres/huttes/châteaux/etc., quels qu'ils soient) au lieu de deviner une distance
 * sûre par un calcul de tuile — robuste quel que soit le décor aléatoire propre à chaque crypte. */
function CryptExitCameraGuard({ requestId, pendingRef }: { requestId: number; pendingRef: React.MutableRefObject<{ angle: number; radius: number } | null> }) {
  const { scene, camera } = useThree();
  const appliedForRef = useRef(-1);
  useFrame(() => {
    if (appliedForRef.current === requestId) return;
    appliedForRef.current = requestId;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const target = new THREE.Vector3(...CAMERA_TARGET);
    const raycaster = new THREE.Raycaster();
    let radius = pending.radius;
    const MAX_RADIUS = pending.radius + 10;
    const pos = new THREE.Vector3();
    while (radius <= MAX_RADIUS) {
      pos.set(Math.sin(pending.angle) * radius, CRYPT_EXIT_CAMERA_HEIGHT, Math.cos(pending.angle) * radius);
      const dir = pos.clone().sub(target);
      const dist = dir.length();
      dir.normalize();
      raycaster.set(target, dir);
      raycaster.near = 0.6; // ignore Synk lui-même (juste devant la cible)
      raycaster.far = dist - 0.3; // marge avant d'atteindre la position candidate de la caméra
      const blocked = raycaster.intersectObjects(scene.children, true).length > 0;
      if (!blocked) break;
      radius += 1;
    }
    camera.position.copy(pos);
    camera.lookAt(target);
  });
  return null;
}


interface Pos { x: number; y: number }
interface Size { w: number; h: number }

/** Couleur de tunique de Synk par stade — même palette (approximative) que SynkSkin.tsx::STAGE_TUNIC,
 * dupliquée ici en constante locale car STAGE_TUNIC n'est pas exportée (purement cosmétique, aucune
 * logique de jeu dupliquée). */
const STAGE_COLOR_3D: Record<string, string> = {
  egg: '#3f9142', hatched: '#379a45', juvenile: '#22823a', adult: '#166534', ancient: '#15803d',
};

/** Couleur par famille de marqueur (voir gameState.ts::MapMarkerKind) — registre extensible : il
 * suffit d'ajouter une entrée ici pour qu'un nouveau type de marqueur soit immédiatement représenté
 * en 3D, sans toucher au reste du composant (même esprit que TERRAIN_COLOR/PROP_ICON). */
const MARKER_COLOR: Record<string, string> = {
  npc: '#a855f7', familiar: '#f59e0b', treasure: '#eab308', world: '#8b5cf6',
  poi: '#94a3b8', quest: '#22d3ee', zorghon: '#dc2626', captive: '#f472b6',
};

/** Couleur d'accent par rareté d'équipement (voir gameState.ts::ItemRarity) — purement cosmétique
 * (teinte du métal/de la gemme de l'objet équipé rendu sur le modèle 3D de Synk), sans impact sur
 * le calcul de rareté lui-même (défini ailleurs, voir EquipmentWidget.tsx). */
const RARITY_COLOR_3D: Record<string, string> = {
  common: '#9ca3af', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b',
};

/** Angle de rotation (radians) du modèle de Synk par direction affichée — même 8 directions que
 * GameCanvas2D.tsx/SynkSkin.tsx (voir SynkDirection).
 *
 * 🔒 Bug corrigé (rapporté par l'utilisateur) : la tête/le corps de Synk (et du PNJ/Dragon errant,
 * qui partage cette même table via `MarkerBlock`) se tournaient en MIROIR par rapport à la
 * direction réelle de déplacement — appuyer sur ← faisait pivoter le modèle vers la droite de
 * l'écran, et inversement pour →. Cause : avec `group rotation={[0, angle, 0]}` appliqué à un
 * modèle dont le visage regarde +Z au repos (angle 0, voir les yeux de `SynkVoxel` positionnés à
 * z>0), la formule de rotation Y de Three.js donne un vecteur de visage
 * `(sin(angle), 0, cos(angle))` ; hors la caméra par défaut (`[0, 3.2, 5.6]`, regardant vers
 * l'origine) a son axe « droite écran » aligné sur +X monde. Les valeurs précédentes avaient donc
 * le signe inversé pour toute direction comportant une composante gauche/droite (seuls `down`
 * (visage vers la caméra) et `up` (visage à l'opposé) n'ont pas de composante X et n'étaient donc
 * pas affectés). Corrigé en inversant le signe de chaque angle latéral — NE PAS réintroduire
 * l'ancien mapping, et NE PAS toucher à la logique de déplacement (dx/dy, useHoldMovement,
 * directionFromDelta) qui reste strictement inchangée et fonctionne correctement. */
const FACING_ANGLE: Record<SynkDirection, number> = {
  down: 0, 'down-left': -Math.PI / 4, left: -Math.PI / 2, 'up-left': -(3 * Math.PI) / 4,
  up: Math.PI, 'up-right': (3 * Math.PI) / 4, right: Math.PI / 2, 'down-right': Math.PI / 4,
};

/** Direction à 180° de chaque direction à 8 valeurs — utilisée pour retourner Synk à l'opposé de
 * la porte qu'il vient de franchir (voir demande utilisateur « il faut que Synk soit orienté vers
 * la direction de la sortie [...] et pas face à la porte qu'il vient d'ouvrir ») : au lieu de
 * recalculer un angle, on inverse simplement la direction à 8 valeurs déjà utilisée par `facing`,
 * garantissant un résultat toujours valide (une des 8 clés de `FACING_ANGLE`) sans aucun calcul
 * d'angle flottant. */
const OPPOSITE_DIRECTION: Record<SynkDirection, SynkDirection> = {
  up: 'down', down: 'up', left: 'right', right: 'left',
  'up-left': 'down-right', 'down-right': 'up-left', 'up-right': 'down-left', 'down-left': 'up-right',
};

/** 🔒 Bug corrigé (rapporté par l'utilisateur, captures d'écran à l'appui : caméra "zoomée" sur le
 * toit/la croix de la crypte, puis — après un premier correctif encore insuffisant — écran
 * totalement envahi de vert/noir). Historique des deux correctifs successifs :
 * 1) La pose de sortie était initialement un vecteur MONDE FIXE (`[0, 3.2, 5.6]`), correct
 *    UNIQUEMENT si Synk ressort en regardant vers 'down' (axe +Z) : Synk étant repositionné à
 *    l'emplacement même de la crypte, une direction de sortie différente pouvait placer la caméra
 *    du MÊME côté que le bâtiment (au lieu du côté opposé) et donc l'intersecter.
 * 2) Premier correctif (rendu obsolète) : calculer la position EN FONCTION de la direction de
 *    sortie via `FACING_ANGLE`, pour toujours placer la caméra du côté vers lequel Synk regarde
 *    désormais. Rejoué en Playwright (harnais `?debugCrypt=&debugFacing=`), ce correctif s'est
 *    révélé INSUFFISANT : le bâtiment de la crypte a beau être toujours évité, l'orientation du
 *    bâtiment en coordonnées monde est FIXE (son arche regarde toujours +Z, voir `MarkerBlock`),
 *    rien à voir avec la direction de sortie — en réalité, le risque venait du DÉCOR ALÉATOIRE
 *    environnant (arbres/huttes/châteaux dispersés par tuile, voir `worldTerrain.ts::worldTileAt`,
 *    ~8 % de chance par tuile) : tourner la caméra vers une direction quelconque pouvait très bien
 *    la faire atterrir EN PLEIN DANS un sapin décoratif voisin, aucun côté n'étant garanti dégagé.
 * Correctif définitif : conserver le calcul angle→position (même convention que le modèle 3D de
 * Synk, `(sin(angle), 0, cos(angle))`), mais AGRANDIR le rayon tuile par tuile (voir `exitCrypt`,
 * boucle utilisant `worldTileAt`/`isObstacleAt`) jusqu'à retomber sur une tuile sans décor ni
 * bâtiment POI catalogue — garantit une vue dégagée dans TOUTES les directions, sans jamais
 * black-screener, quel que soit le décor aléatoire propre à chaque crypte. */
const CRYPT_EXIT_CAMERA_HEIGHT = 3.2;
const CRYPT_EXIT_CAMERA_RADIUS = 5.6;

/** Angle (degrés écran, sens horaire depuis le haut) de l'aiguille de la boussole HTML/CSS pour
 * chaque direction affichée — voir la boussole N/E/S/O du composant parent (demande utilisateur
 * « place [...] une boussole translucide Nord, Est, Sud, Ouest [...] qui permet de savoir dans
 * quelle direction s'oriente/se dirige Synk »). Indépendant de FACING_ANGLE (radians 3D du modèle) :
 * ici Nord=haut de la rose des vents=0°, Est=90°, Sud=180°, Ouest=270°, remplis à 45° pour les
 * diagonales — cohérent avec le repère MONDE FIXE de `dispatchMove` (Haut=Nord, Droite=Est, etc.).
 */
const COMPASS_NEEDLE_DEG: Record<SynkDirection, number> = {
  up: 0, 'up-right': 45, right: 90, 'down-right': 135, down: 180, 'down-left': 225, left: 270, 'up-left': 315,
};

/** Déduit la direction de marche à 8 valeurs à partir d'un delta (dx,dy) — copie fidèle de
 * GameCanvas2D.tsx::directionFromDelta (non exportée là-bas) pour rester cohérent visuellement
 * entre les deux plateformes. */
function directionFromDelta(dx: number, dy: number): SynkDirection | null {
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return dy < 0 ? 'up' : 'down';
  if (dy === 0) return dx < 0 ? 'left' : 'right';
  if (dx < 0) return dy < 0 ? 'up-left' : 'down-left';
  return dy < 0 ? 'up-right' : 'down-right';
}

/** Rayon (unités 3D) approximant l'encombrement au sol de Synk, ajouté à la demi-largeur/profondeur
 * de chaque `RoomObstacle` lors du test de collision (voir `isInsideRoomObstacle`/`moveRoom`) — évite
 * que Synk ne paraisse à moitié enfoncé dans un meuble avant d'être bloqué (demande utilisateur
 * « il ne faut [...] pas que je passe au travers des objets dans la pièce comme le lit ou la table
 * de chevet ou la table »). */
const SYNK_ROOM_COLLIDE_PAD = 0.22;

/** Vrai si le point (x, z), dans le repère LOCAL de la salle (voir `BEDROOM_OBSTACLES`/
 * `PARCHMENT_OBSTACLES`), tombe à l'intérieur de l'empreinte d'un meuble — demi-largeur/profondeur
 * élargies de `SYNK_ROOM_COLLIDE_PAD` pour englober l'encombrement de Synk (voir sa doc). */
function isInsideRoomObstacle(x: number, z: number, o: RoomObstacle, pad: number = SYNK_ROOM_COLLIDE_PAD): boolean {
  return Math.abs(x - o.x) <= o.halfX + pad && Math.abs(z - o.z) <= o.halfZ + pad;
}

/** Hauteur (unités 3D) de la surface sur laquelle Synk se tient DEBOUT pour une tuile donnée —
 * réutilise EXACTEMENT les mêmes formules que `TerrainBlock`/`PropBlock` ci-dessus (roche : sommet
 * du bloc surélevé ; eau : surface du bloc d'eau abaissé/assombri selon la profondeur ; prairie/
 * sable/sentier : dalle plate à y=0), afin qu'aucune divergence visuelle ne puisse apparaître entre
 * le décor et la position de Synk. Utilisée à la fois pour le rendu (voir SYNK_GROUND_OFFSET) et
 * pour le calcul du dénivelé de saut/chute en « cubes » (voir tileClimbCubes). */
function tileStandTopY(tile: Tile): number {
  if (tile.terrain === 'rock') return Math.min(1.9, (tile.altitudeM ?? 300) / 2800);
  if (tile.terrain === 'water') return -0.5 - Math.min(1, (tile.depthM ?? 1) / 300) * 0.3;
  return 0;
}

/** Dénivelé exprimé en « cubes » (voir RepRules.platform3dCubeHeightM) pour le calcul des dégâts de
 * chute/escalade en Plateforme 3D — basé sur l'altitude BRUTE en mètres (`tile.altitudeM`, non
 * plafonnée par la formule de rendu ci-dessus) afin de conserver une plage utile pour distinguer une
 * simple colline ambiante (quelques dizaines de mètres) d'un véritable sommet de montagne (jusqu'à
 * `ALTITUDE_MAX_M` = 6000 m, voir worldTerrain.ts) — seules les dalles 'rock' ont une altitude (voir
 * worldTileAt), toutes les autres valent conventionnellement 0 cube. */
function tileClimbCubes(tile: Tile, cubeHeightM: number): number {
  if (tile.terrain !== 'rock') return 0;
  return (tile.altitudeM ?? 300) / Math.max(1, cubeHeightM);
}

/** Clé de registre `Platform3DObjectKind` correspondant au terrain/décor d'une tuile — voir
 * gameState.ts::Platform3DObjectKind/DEFAULT_PLATFORM3D_OBJECT_FLAGS. */
function platform3dTerrainKind(terrain: Tile['terrain']): Platform3DObjectKind {
  return (`terrain:${terrain}`) as Platform3DObjectKind;
}
function platform3dPropKind(prop: NonNullable<Tile['prop']>): Platform3DObjectKind {
  return (`prop:${prop}`) as Platform3DObjectKind;
}

/** Résout les 3 interrupteurs (obstacle/climbable/water) applicables à une tuile, en combinant le
 * registre admin-paramétrable (`RepRules.platform3dObjectFlags`, voir RepRulesPanel.tsx) avec les
 * valeurs par défaut (repli si le registre est incomplet) — un décor (arbre/hutte/château/portail)
 * posé sur la tuile peut À LUI SEUL la rendre obstacle (ex: arbre), même si le terrain sous-jacent
 * (prairie) ne l'est pas ; `climbable`/`water` restent des propriétés du TERRAIN uniquement (un
 * décor ne rend jamais une case escaladable ou aquatique). */
function platform3dTileFlags(tile: Tile, registry: Record<Platform3DObjectKind, Platform3DObjectFlags> | undefined): { obstacle: boolean; climbable: boolean; water: boolean } {
  const reg = registry ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS;
  const terrainKind = platform3dTerrainKind(tile.terrain);
  const terrainFlags = reg[terrainKind] ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS[terrainKind];
  const propFlags = tile.prop ? (reg[platform3dPropKind(tile.prop)] ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS[platform3dPropKind(tile.prop)]) : undefined;
  return {
    obstacle: !!terrainFlags?.obstacle || !!propFlags?.obstacle,
    climbable: !!terrainFlags?.climbable,
    water: !!terrainFlags?.water,
  };
}

/** Décalage vertical (unités 3D) entre le centre du groupe `SynkVoxel` et le sol : les bottes de
 * Synk descendent jusqu'à y≈-0.41 en coordonnées locales (torse -0.03, jambes -0.15±0.12, bottes
 * -0.32±0.06) alors que les dalles plates (prairie/sable/sentier) sont des blocs OPAQUES occupant
 * tout l'espace y∈[-1,0] : sans ce décalage, le bas du corps de Synk est rendu À L'INTÉRIEUR du
 * bloc de terrain et donc invisible (bug « jambes/pieds invisibles »). Appliqué en plus de la
 * hauteur de la dalle courante (`standY`, voir tileStandTopY) pour que Synk tienne aussi correctement
 * debout sur un bloc de montagne surélevé. */
const SYNK_GROUND_OFFSET = 0.41;

/** Bloc de terrain voxel (façon Minecraft) : prairie/sable/sentier en dalle plate, roche surélevée
 * selon `altitudeM` (relief), eau abaissée et assombrie selon `depthM` (profondeur) — réutilise TEL
 * QUEL le modèle de tuile `worldTerrain.ts` (mêmes champs que la Plateforme 2D isométrique/Mapmonde,
 * voir commentaire de `Tile` dans ce fichier), donc aucune divergence de décor possible entre les 3
 * vues. `onClick` matérialise le déplacement à la souris (clic sur une case pour s'y rendre). */
/** Génère (une seule fois, mise en cache) une texture procédurale 64×64 répétable par type de
 * terrain — sans dépendance externe ni téléchargement d'image (100% gratuit/hors-ligne) : un
 * remplissage de base + un semis de « mouchetures » (brins d'herbe, grains de sable, cailloux du
 * chemin, craquelures de roche, reflets d'eau) dessiné au Canvas 2D puis converti en
 * `THREE.CanvasTexture`. Mise en cache PAR TYPE de terrain (pas par tuile) : les dizaines de dalles
 * identiques affichées à l'écran partagent la MÊME instance de texture — aucun coût de génération
 * ni de mémoire supplémentaire par tuile, donc aucune régression de fluidité des déplacements. Un
 * PRNG déterministe (mulberry32) garantit un motif stable d'un rechargement de page à l'autre (pas
 * de scintillement). Répond à la demande de décor « le plus réaliste possible » (sol en herbe/sable/
 * terre/roche texturé plutôt qu'un aplat de couleur uni). */
const TERRAIN_TEXTURE_CACHE: Partial<Record<Tile['terrain'], THREE.Texture>> = {};
const TERRAIN_TEXTURE_PALETTE: Record<Tile['terrain'], { base: string; specks: string[]; speckCount: number; seed: number }> = {
  grass: { base: '#3f7d32', specks: ['#4f9640', '#356b2a', '#5aa84a', '#2e5c22'], speckCount: 150, seed: 1 },
  sand:  { base: '#d9c27e', specks: ['#c9ae66', '#e6d493', '#b89a55'], speckCount: 130, seed: 2 },
  path:  { base: '#8a6b45', specks: ['#75582f', '#9c7e57', '#6a4f2b', '#5f4526'], speckCount: 110, seed: 3 },
  rock:  { base: '#8b8f96', specks: ['#787c83', '#9a9ea5', '#6c6f75', '#5f6268'], speckCount: 90, seed: 4 },
  water: { base: '#2f6fb0', specks: ['#3f83c8', '#265d94', '#4f93d6'], speckCount: 70, seed: 5 },
};
function getTerrainTexture(terrain: Tile['terrain']): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cached = TERRAIN_TEXTURE_CACHE[terrain];
  if (cached) return cached;
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pal = TERRAIN_TEXTURE_PALETTE[terrain];
  let seed = pal.seed;
  // PRNG mulberry32 — déterministe, sans dépendance externe.
  const rand = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < pal.speckCount; i++) {
    ctx.fillStyle = pal.specks[Math.floor(rand() * pal.specks.length)];
    const w = 1 + rand() * (terrain === 'grass' ? 2 : 3);
    const h = 1 + rand() * (terrain === 'grass' ? 3 : 2);
    ctx.fillRect(rand() * SIZE, rand() * SIZE, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  TERRAIN_TEXTURE_CACHE[terrain] = tex;
  return tex;
}
function TerrainBlock({ tile, x, z, onClick }: { tile: Tile; x: number; z: number; onClick: () => void }) {
  const color = TERRAIN_COLOR[tile.terrain];
  const texture = getTerrainTexture(tile.terrain);
  const tint = texture ? '#ffffff' : color;
  if (tile.terrain === 'water') {
    const depthNorm = Math.min(1, (tile.depthM ?? 1) / 300);
    const y = -0.62 - depthNorm * 0.3;
    return (
      <mesh position={[x, y, z]} onClick={onClick}>
        <boxGeometry args={[1, 0.24, 1]} />
        <meshStandardMaterial color={tint} map={texture} transparent opacity={0.82} />
      </mesh>
    );
  }
  if (tile.terrain === 'rock') {
    const h = Math.min(2.4, 0.5 + (tile.altitudeM ?? 300) / 2800);
    return (
      <mesh position={[x, h / 2 - 0.5, z]} onClick={onClick} castShadow receiveShadow>
        <boxGeometry args={[1, h, 1]} />
        <meshStandardMaterial color={tint} map={texture} />
      </mesh>
    );
  }
  return (
    <mesh position={[x, -0.5, z]} onClick={onClick} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={tint} map={texture} />
    </mesh>
  );
}

/** Petit décor (arbre/hutte/château/portail/…) posé sur sa dalle, proportionné de façon RÉALISTE
 * par rapport à la taille de Synk (~1,2 unité de haut, voir SYNK_GROUND_OFFSET/SynkVoxel) : un arbre
 * adulte doit rester nettement plus grand qu'un humain (silhouette à deux étages de feuillage,
 * ~2,6 unités soit environ le double de Synk — ni un arbuste, ni un séquoia démesuré), une hutte/un
 * château doivent se lire comme des bâtiments habitables (toit en pente/tourelle), etc. — correctif
 * du bug rapporté « les arbres sont trop petits ». Chaque silhouette reste ADDITIONNELLEMENT
 * multipliée par `scale` (défaut 1, voir Platform3DObjectFlags.scale), réglable par l'admin dans
 * `Administration > Barème & règles > 🧱 Objets & décor 3D` sans toucher au code — extensible via
 * `PROP_COLOR` (registre par type, même esprit que MARKER_COLOR). */
const PROP_COLOR: Record<string, string> = {
  // 'portal' : cuivre/bronze (au lieu du mauve d'origine) pour ressembler davantage à une vraie
  // porte des étoiles (demande utilisateur « change la couleur de l'anneau violet et met une
  // couleur cuivre pour qu'il soit plus ressemblant à la vraie porte des étoiles »).
  tree: '#2f6b27', castle: '#8a8577', hut: '#7a5230', portal: '#b5712b',
  bamboo: '#6fae3f', baobab: '#7a5b2e', palm: '#3f8a3a',
};
/** Multiplicateurs internes ANISOTROPES [x, y, z] appliqués aux silhouettes hutte/château (voir
 * PropBlock ci-dessous), EN PLUS du `scale` réglable par l'admin (qui reste à 1 par défaut, voir
 * DEFAULT_PLATFORM3D_OBJECT_FLAGS) — corrige le bug rapporté « les maisons, les châteaux sont trop
 * petits au regard de la taille de Synk [...] il faut que les espaces et volumes soient cohérents
 * [...] car [...] je te demanderai de coder pour permettre à Synk de rentrer dans une maison ou un
 * château ». L'axe Y (hauteur) est BEAUCOUP plus étiré que X/Z (emprise au sol) — un bâtiment
 * réaliste gagne surtout en hauteur, et limiter la croissance de l'emprise au sol évite qu'une
 * hutte/un château empiète trop sur les dalles voisines (arbre/autre bâtisse pouvant déjà s'y
 * trouver, voir worldTerrain.ts::worldTileAt) et ne les chevauche visuellement. Avec
 * HUT_SCALE=[1.3,1.8,1.3], la hutte culmine à ~2,9 unités (~2,7x Synk, ~1,1 unité, voir SynkVoxel/
 * SYNK_GROUND_OFFSET) et sa porte fait ~1,4 unité de haut ; avec CASTLE_SCALE=[1.2,2.0,1.2], le
 * donjon (désormais à deux tours jumelles, voir PropBlock::kind==='castle' ci-dessous — demande
 * utilisateur « ajoutes de vrai proportion au donjon et pas juste un simple tube fin ») culmine à
 * ~7,5 unités (~7x Synk) et ses poternes ~2 unités de haut — proportions réalistes d'une forteresse
 * fortifiée imposante SANS changer la logique de collision actuelle (1 dalle = 1 obstacle, voir
 * worldTerrain.ts::isObstacleAt), qui reste une étape ultérieure. */
const HUT_SCALE: [number, number, number] = [1.3, 1.8, 1.3];
const CASTLE_SCALE: [number, number, number] = [1.2, 2.0, 1.2];

/** Texture procédurale (bande de symboles cabalistiques) pour l'anneau INTÉRIEUR rotatif de la
 * Porte des Étoiles (voir StargatePortal ci-dessous — demande utilisateur « affublés tout autour
 * de l'anneau de signes cabalistiques [...] sur une seconde roue crantée verticale »). Générée UNE
 * SEULE FOIS en mémoire (singleton module, jamais recréée par instance de portail affichée — un
 * monde peut compter plusieurs portails simultanément visibles, voir VIEW_RADIUS) afin de ne pas
 * alourdir le budget GPU/CPU (voir le correctif de saturation GPU fait plus tôt dans le projet :
 * aucune nouvelle génération de texture par frame ni par portail). Le mapping UV d'un
 * `THREE.TorusGeometry` enroule U autour de la circonférence principale de l'anneau — une bande
 * HORIZONTALE répétant ~16 glyphes convient donc naturellement à un « bandeau de symboles » continu
 * une fois appliquée en `map`. */
let _glyphRingTextureCache: THREE.CanvasTexture | null = null;
function getGlyphRingTexture(): THREE.CanvasTexture {
  if (_glyphRingTextureCache) return _glyphRingTextureCache;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2b2416'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const GLYPHS = ['◈', '⟁', '⌬', '✦', '◬', '⟐', '✧', '⬙', '☥', '⟠', '◉', '⬔', '✶', '⟡', '◭', '⬟'];
  const count = GLYPHS.length;
  const cellW = canvas.width / count;
  ctx.fillStyle = '#eab308';
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 1.5;
  ctx.font = `bold ${Math.floor(canvas.height * 0.62)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < count; i++) {
    const cx = cellW * (i + 0.5);
    const cy = canvas.height / 2;
    ctx.strokeText(GLYPHS[i], cx, cy);
    ctx.fillText(GLYPHS[i], cx, cy);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  _glyphRingTextureCache = tex;
  return tex;
}

/** Porte des Étoiles — anneau VERTICAL (plus un simple anneau couché, voir ancien rendu
 * `rotation={[Math.PI/2,0,0]}` supprimé) avec chevrons fixes + anneau de glyphes rotatif intérieur
 * + console d'activation adjacente, selon demande utilisateur (captures de référence d'une porte
 * des étoiles verticale + pupitre/console à cristal). Remplace l'ancien rendu plat (torus + disque
 * couchés) utilisé à la fois par `PropBlock` (kind==='portal', portail décoratif posé sur une
 * dalle) ET `MarkerBlock` (isWorld, portail flottant inter-mondes) — composant PARTAGÉ pour éviter
 * de dupliquer la géométrie/l'anim. L'anneau EXTÉRIEUR (avec ses chevrons) reste FIXE ; seul
 * l'anneau de glyphes INTÉRIEUR tourne, UNIQUEMENT pendant une activation en cours (voir
 * `isActivating`/`activationStartedAt`/`activationDurationMs`, pilotés par le composant parent via
 * `requestStargateActivation`/`completeStargateActivation`) — remplace l'ancien spin continu
 * permanent (qui tournait même sans activation), supprimé pour les portails `isWorld` (voir
 * MarkerBlock::spinning plus bas) pour laisser la porte visuellement STATIQUE tant qu'elle n'est
 * pas composée, exactement comme une vraie porte des étoiles entre deux compositions. */
function StargatePortal({
  radius, color = '#b5712b', anchorY, isActivating, activationStartedAt, activationDurationMs,
  onConsoleClick, onActivationComplete,
}: {
  radius: number;
  color?: string;
  /** Hauteur du centre de l'anneau (coordonnée Y locale) — par défaut `radius + 0.1` (l'anneau
   * touche quasiment le sol, porte « plantée » devant Synk), utilisé par les DEUX variantes (posée
   * au sol via `PropBlock` et flottante inter-mondes) depuis l'agrandissement à `STARGATE_RING_RADIUS`
   * (voir worldTerrain.ts) — ce défaut met toujours le bas de l'anneau 0.1 unité au-dessus de son
   * origine locale, quel que soit `radius`. Laissé surchageable (`anchorY` explicite) pour tout
   * futur contexte qui aurait besoin d'un ancrage différent. */
  anchorY?: number;
  isActivating?: boolean;
  activationStartedAt?: number;
  activationDurationMs?: number;
  onConsoleClick: () => void;
  onActivationComplete: () => void;
}) {
  const ringY = anchorY ?? radius + 0.1;
  const glyphRingRef = useRef<THREE.Mesh>(null);
  const horizonMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const buttonMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const firedAtRef = useRef<number | null>(null);
  const texture = useMemo(() => getGlyphRingTexture(), []);
  const chevronAngles = useMemo(() => Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2), []);

  useFrame((state) => {
    if (glyphRingRef.current) {
      if (isActivating && activationStartedAt && activationDurationMs) {
        const progress = Math.min(1, (Date.now() - activationStartedAt) / activationDurationMs);
        glyphRingRef.current.rotation.z = progress * Math.PI * 2 * 3;
        if (progress >= 1 && firedAtRef.current !== activationStartedAt) {
          firedAtRef.current = activationStartedAt;
          onActivationComplete();
        }
      }
    } else {
      firedAtRef.current = null;
    }
    if (horizonMatRef.current) {
      // Cuivre/bronze sombre au repos (cohérent avec le nouvel anneau cuivre, voir `color` ci-dessus
      // et PROP_COLOR.portal) — bleu cyan lumineux pendant la composition (horizon des événements
      // d'une vraie porte des étoiles), inchangé.
      const target = isActivating ? new THREE.Color('#38bdf8') : new THREE.Color('#1c1206');
      horizonMatRef.current.emissive.lerp(target, 0.04);
    }
    if (buttonMatRef.current) {
      buttonMatRef.current.emissiveIntensity = 0.55 + Math.sin(state.clock.elapsedTime * 2.4) * 0.3;
    }
  });

  return (
    <group onClick={(e) => e.stopPropagation()}>
      {/* Anneau extérieur FIXE */}
      <mesh position={[0, ringY, 0]}>
        <torusGeometry args={[radius, radius * 0.19, 10, 28]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} metalness={0.35} roughness={0.55} />
      </mesh>
      {/* Chevrons statiques (9, comme une vraie porte des étoiles) — corps métallique sombre bien
          contrasté sur l'anneau cuivre + pointe lumineuse rouge pour rester identifiables même sous
          un éclairage ambiant faible (voir test isolé /stargate-test — les 1ers essais en simple
          `#7f1d1d` se fondaient trop dans l'anneau). */}
      {chevronAngles.map((angle, i) => (
        <group key={i}
          position={[Math.sin(angle) * radius, ringY + Math.cos(angle) * radius, radius * 0.12]}
          rotation={[0, 0, -angle]}
        >
          <mesh position={[0, 0, 0]}>
            <coneGeometry args={[radius * 0.12, radius * 0.3, 4]} />
            <meshStandardMaterial color="#292524" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, radius * 0.17, 0]}>
            <sphereGeometry args={[radius * 0.045, 8, 8]} />
            <meshStandardMaterial color="#dc2626" emissive="#ef4444" emissiveIntensity={0.7} />
          </mesh>
        </group>
      ))}
      {/* Anneau de glyphes INTÉRIEUR — tourne uniquement pendant l'activation */}
      <mesh ref={glyphRingRef} position={[0, ringY, 0]}>
        <torusGeometry args={[radius * 0.8, radius * 0.11, 8, 28]} />
        <meshStandardMaterial map={texture} color="#c9b48a" emissive="#eab308" emissiveIntensity={0.25} />
      </mesh>
      {/* Horizon des événements */}
      <mesh position={[0, ringY, 0]}>
        <circleGeometry args={[radius * 0.76, 28]} />
        <meshStandardMaterial ref={horizonMatRef} color="#120d05" emissive="#1c1206" emissiveIntensity={0.4} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      {/* Console / pupitre d'activation (DHD) — Synk doit s'en approcher et cliquer dessus */}
      <group position={[radius + 0.45, 0, radius * 0.55]} onClick={(e) => { e.stopPropagation(); onConsoleClick(); }}>
        {[-0.18, 0.18].map((lx) => [-0.12, 0.12].map((lz) => (
          <mesh key={`${lx}-${lz}`} position={[lx, 0.15, lz]}><cylinderGeometry args={[0.03, 0.03, 0.3, 6]} /><meshStandardMaterial color="#44403c" roughness={0.9} /></mesh>
        )))}
        <mesh position={[0, 0.32, 0]}><cylinderGeometry args={[0.32, 0.3, 0.08, 16]} /><meshStandardMaterial color="#57534e" roughness={0.6} metalness={0.3} /></mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.3, 0.4, 0]} rotation={[Math.PI / 2, 0, s * 0.4]}>
            <torusGeometry args={[0.16, 0.025, 6, 12, Math.PI * 0.65]} />
            <meshStandardMaterial color="#78716c" roughness={0.5} metalness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 0.39, 0]}>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshStandardMaterial ref={buttonMatRef} color="#dc2626" emissive="#ef4444" emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  );
}

function PropBlock({ kind, x, topY, z, scale = 1, onClick, stargate }: {
  kind: NonNullable<Tile['prop']>; x: number; topY: number; z: number; scale?: number; onClick: () => void;
  /** Uniquement pour `kind === 'portal'` — état d'activation de la console (voir StargatePortal/
   * requestStargateActivation dans le composant parent non-R3F). `undefined` tant que l'instance
   * n'est pas la cible courante d'une activation (l'anneau reste alors statique, pas d'anim). */
  stargate?: {
    isActivating: boolean; activationStartedAt?: number; activationDurationMs?: number;
    onConsoleClick: () => void; onActivationComplete: () => void;
  };
}) {
  const color = PROP_COLOR[kind] ?? '#2f6b27';
  if (kind === 'portal') {
    // Rayon de base STARGATE_RING_RADIUS (voir worldTerrain.ts — agrandi suite à la demande
    // utilisateur « il faut l'agrandir de 2 fois la taille de Synk »), multiplié par `scale`
    // (admin-paramétrable via DEFAULT_PLATFORM3D_OBJECT_FLAGS['prop:portal'].scale, défaut 1) —
    // `anchorY` non surchargé : utilise le défaut `radius + 0.1` de StargatePortal (ring posé au
    // ras du sol quel que soit le rayon, voir commentaire anchorY ci-dessus).
    return (
      <group position={[x, topY, z]} scale={scale}>
        <StargatePortal
          radius={STARGATE_RING_RADIUS} color={color}
          isActivating={stargate?.isActivating} activationStartedAt={stargate?.activationStartedAt}
          activationDurationMs={stargate?.activationDurationMs}
          onConsoleClick={stargate?.onConsoleClick ?? (() => {})}
          onActivationComplete={stargate?.onActivationComplete ?? (() => {})}
        />
      </group>
    );
  }
  if (kind === 'castle') {
    // Donjon : socle commun élargi + DEUX TOURS JUMELLES épaisses (chacune coiffée d'un toit
    // conique sombre + sa propre couronne de créneaux) et 2 porches d'entrée distincts — voir
    // demande utilisateur « ajoutes de vrai proportion au donjon et pas juste un simple tube fin »
    // (captures de référence d'un donjon à deux tours). Remplace l'ancienne silhouette (une seule
    // tourelle fine au centre d'un socle carré, jugée trop frêle) SANS changer le point d'ancrage/
    // l'interaction (`onClick`)/l'enveloppe `CASTLE_SCALE` ni la collision (1 dalle = 1 obstacle,
    // voir worldTerrain.ts::isObstacleAt) — purement un remplacement de géométrie/silhouette.
    const TOWER_X = 0.78;
    const towerCrenellations = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);
    const baseMerlons = [-1.02, -0.36, 0.36, 1.02].flatMap((mx) => [-0.7, 0.7].map((mz) => [mx, mz] as const));
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group scale={CASTLE_SCALE}>
          {/* Socle commun reliant les deux tours */}
          <mesh position={[0, 0.8, 0]} castShadow><boxGeometry args={[2.4, 1.6, 1.5]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
          {baseMerlons.map(([mx, mz], i) => (
            <mesh key={i} position={[mx, 1.68, mz]} castShadow><boxGeometry args={[0.26, 0.28, 0.26]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
          ))}
          {/* Deux tours jumelles, chacune avec sa couronne de créneaux + son toit conique + sa
              propre poterne — silhouette directement inspirée des références fournies. */}
          {[-TOWER_X, TOWER_X].map((tx, i) => (
            <group key={i} position={[tx, 0, 0]}>
              <mesh position={[0, 2.25, 0]} castShadow><cylinderGeometry args={[0.5, 0.54, 1.3, 12]} /><meshStandardMaterial color="#6b6f76" roughness={0.85} /></mesh>
              {towerCrenellations.map((a, k) => (
                <mesh key={k} position={[Math.sin(a) * 0.5, 2.98, Math.cos(a) * 0.5]} castShadow>
                  <boxGeometry args={[0.16, 0.22, 0.16]} />
                  <meshStandardMaterial color="#6b6f76" roughness={0.85} />
                </mesh>
              ))}
              <mesh position={[0, 3.45, 0]} castShadow><coneGeometry args={[0.64, 0.78, 12]} /><meshStandardMaterial color="#4a1420" roughness={0.65} /></mesh>
              <mesh position={[0, 0.5, 0.76]} castShadow><boxGeometry args={[0.42, 1.0, 0.08]} /><meshStandardMaterial color="#1c140d" roughness={0.95} /></mesh>
            </group>
          ))}
        </group>
      </group>
    );
  }
  if (kind === 'hut') {
    // Chaumière : socle bois/torchis + toit de chaume en pente (cône), cheminée en pierre.
    // Enveloppe interne mise à l'échelle ×HUT_SCALE (voir plus haut) : hutte culminant à ~2,9 unités
    // (~2,7x Synk) au lieu de l'ancien ~1,6 (à peine 1,5x Synk) — corrige « les maisons sont trop
    // petites ». Porte (bois sombre) ajoutée sur la façade, dimensionnée nettement plus grande que
    // Synk (~1,4 unité de haut) pour préparer une future entrée dans le bâtiment sans rien changer à
    // la collision actuelle (1 dalle = 1 obstacle, voir worldTerrain.ts::isObstacleAt).
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group scale={HUT_SCALE}>
          <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
          <mesh position={[0, 1.25, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.85, 0.7, 4]} /><meshStandardMaterial color="#3f2c1a" roughness={0.9} /></mesh>
          <mesh position={[0.32, 1.55, 0.1]}><cylinderGeometry args={[0.08, 0.09, 0.4, 6]} /><meshStandardMaterial color="#78716c" roughness={0.9} /></mesh>
          <mesh position={[0, 0.39, 0.51]} castShadow><boxGeometry args={[0.42, 0.78, 0.08]} /><meshStandardMaterial color="#2a1a0f" roughness={0.95} /></mesh>
        </group>
      </group>
    );
  }
  if (kind === 'baobab') {
    // Baobab : tronc TRÈS épais et court + petite frondaison plate en boule — silhouette iconique.
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.55, 0]} castShadow><cylinderGeometry args={[0.32, 0.42, 1.1, 8]} /><meshStandardMaterial color="#8a6a45" roughness={0.95} /></mesh>
        <mesh position={[0, 1.25, 0]} castShadow><sphereGeometry args={[0.55, 10, 8]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
      </group>
    );
  }
  if (kind === 'palm') {
    // Palmier : tronc fin et haut + bouquet de palmes rayonnantes (cônes aplatis) en couronne.
    const fronds = 6;
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 1.1, 0]} castShadow><cylinderGeometry args={[0.07, 0.11, 2.2, 7]} /><meshStandardMaterial color="#8a6a45" roughness={0.9} /></mesh>
        {Array.from({ length: fronds }).map((_, i) => {
          const a = (i / fronds) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(a) * 0.28, 2.25, Math.cos(a) * 0.28]} rotation={[Math.PI / 2.6, 0, a]} castShadow>
              <coneGeometry args={[0.16, 0.85, 4]} />
              <meshStandardMaterial color={color} roughness={0.85} />
            </mesh>
          );
        })}
      </group>
    );
  }
  if (kind === 'bamboo') {
    // Bosquet de bambou : plusieurs tiges fines et hautes, tuft de feuilles en haut de chacune.
    const stalks = [[-0.14, -0.05], [0.12, 0.08], [0, 0.15], [0.18, -0.12]];
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {stalks.map(([sx, sz], i) => (
          <group key={i} position={[sx, 0, sz]}>
            <mesh position={[0, 0.95, 0]} castShadow><cylinderGeometry args={[0.04, 0.045, 1.9, 6]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
            <mesh position={[0, 1.85, 0]} castShadow><coneGeometry args={[0.16, 0.4, 6]} /><meshStandardMaterial color="#8fce5f" roughness={0.8} /></mesh>
          </group>
        ))}
      </group>
    );
  }
  // Arbre (défaut, y compris tout futur type non listé ci-dessus) : tronc + double étage de
  // feuillage (cônes empilés, silhouette de conifère) — nettement plus grand que Synk (~2,6 unités
  // vs ~1,2 pour Synk, soit un peu plus du double, conforme à une taille réaliste d'arbre adulte).
  // `onClick` posé sur le GROUPE entier (et non chaque mesh) : le tronc/houppier couvrant la même
  // case que la dalle de terrain sous-jacente, un clic dessus doit produire EXACTEMENT le même
  // comportement (déplacement/approche) que cliquer la dalle elle-même — voir onTileClick3D.
  return (
    <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh position={[0, 0.45, 0]} castShadow><cylinderGeometry args={[0.11, 0.16, 0.9, 7]} /><meshStandardMaterial color="#5b3a1e" roughness={0.9} /></mesh>
      <mesh position={[0, 1.15, 0]} castShadow><coneGeometry args={[0.65, 1.05, 8]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
      <mesh position={[0, 1.75, 0]} castShadow><coneGeometry args={[0.42, 0.75, 8]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
    </group>
  );
}

/** Devine la couleur d'un Dragon-familier à partir de son id/libellé catalogue (ex. "dragon.green"
 * / "Dragon Vert") — TOUS les familiers du jeu sont actuellement des dragons de couleurs variées
 * (voir seedEquipmentCatalog.mjs::selle_* / FamiliarDef), donc une correspondance mot-clé simple
 * (anglais dans l'id technique, français dans le libellé affiché) couvre déjà l'intégralité du
 * catalogue sans dépendre d'un nouveau champ de données. Repli sur l'ambre du registre
 * `MARKER_COLOR.familiar` si aucun mot-clé ne correspond (futur familier non-dragon, par ex.). */
function familiarDragonColor(id: string, name: string): string {
  const s = `${id} ${name}`.toLowerCase();
  const table: [string, string][] = [
    ['green', '#22c55e'], ['vert', '#22c55e'],
    ['red', '#dc2626'], ['rouge', '#dc2626'],
    ['gold', '#eab308'], ['doré', '#eab308'], ['dore', '#eab308'], ["d'or", '#eab308'],
    ['black', '#3f3f46'], ['noir', '#3f3f46'],
    ['blue', '#2563eb'], ['bleu', '#2563eb'],
    ['white', '#e2e8f0'], ['blanc', '#e2e8f0'],
    ['silver', '#94a3b8'], ['argent', '#94a3b8'],
    ['bronze', '#a16207'],
  ];
  for (const [kw, c] of table) if (s.includes(kw)) return c;
  return MARKER_COLOR.familiar;
}

/** Dragon-familier stylisé (corps, cou+tête cornue avec des yeux, quatre pattes articulées, longue
 * queue effilée à 3 segments articulés qui se balance naturellement de gauche à droite, deux ailes
 * membraneuses, souffle de feu périodique) — bien plus reconnaissable que le gemme octaédrique
 * générique pour représenter, par exemple, le "Dragon Vert" du catalogue (voir demande utilisateur :
 * « le Dragon Vert ressemble à un anneau alors qu'il devrait ressembler à un Dragon »). Couleur
 * pilotée par `familiarDragonColor` ci-dessus. Pattes + yeux ajoutés suite à la demande utilisateur
 * « tu ajouteras des jambes de dragons et des yeux aux dragons [...] à tous les dragons » — s'applique
 * donc à TOUT familier-dragon affiché (roulement de scène 3D, boutique, inventaire), pas seulement au
 * Dragon errant. `walking` (PNJ/Dragon errant uniquement, voir lib/roamingActors.ts) anime les 4
 * pattes en démarche quadrupède (paires diagonales en phase) au lieu de rester figées — sinon
 * (survol/statique), pattes immobiles. `seed` (id/nom du dragon) déphase le cycle du souffle de feu
 * pour que plusieurs dragons visibles simultanément ne crachent pas tous en même temps.
 * `fireBreathEnabled`/`fireBreathIntervalSec` (voir RepRules.dragonFireBreathEnabled/
 * dragonFireBreathIntervalSec, paramétrables en Administration) répondent à la demande utilisateur
 * « fait en sorte qu'il crache du feu toutes les minutes ». La longue queue à 3 segments (remplace
 * l'ancien cône unique court) répond à « ajoute une longue queue de dragons qui bougent de gauche à
 * droite et de droite à gauche naturellement ». */
function DragonMarker({ color, walking = false, seed = '', fireBreathEnabled = true, fireBreathIntervalSec = 60 }: {
  color: string; walking?: boolean; seed?: string; fireBreathEnabled?: boolean; fireBreathIntervalSec?: number;
}) {
  const legFrontLeftRef = useRef<THREE.Group>(null);
  const legFrontRightRef = useRef<THREE.Group>(null);
  const legBackLeftRef = useRef<THREE.Group>(null);
  const legBackRightRef = useRef<THREE.Group>(null);
  // Queue à 3 segments articulés (base/milieu/pointe) — chaque segment est un enfant du précédent
  // (chaîne), avec un déphasage de rotation.y croissant pour un effet de vague façon fouet plutôt
  // qu'une planche rigide. Toujours actif même à l'arrêt (mouvement de vie discret), amplifié
  // pendant la marche — jamais de rotation continue (pas de "toupie"), juste un balancement borné
  // gauche/droite (rotation.y, l'axe X local pointant vers l'arrière du corps).
  const tailBaseRef = useRef<THREE.Group>(null);
  const tailMidRef = useRef<THREE.Group>(null);
  const tailTipRef = useRef<THREE.Group>(null);
  // Souffle de feu périodique — purement cosmétique (aucun impact stats/mécanique). `seedOffset`
  // (dérivé de manière déterministe de `seed` via hashString) déphase le cycle de CE dragon dans
  // [0, intervalle) pour éviter que tous les dragons visibles crachent en même temps.
  const flameRef = useRef<THREE.Group>(null);
  const seedOffset = useMemo(() => (hashString(seed || 'dragon') % 1000) / 1000, [seed]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const swing = walking ? Math.sin(t * 8) * 0.5 : 0;
    // Démarche quadrupède : pattes diagonalement opposées (avant-gauche/arrière-droite et
    // avant-droite/arrière-gauche) se déplacent en phase, chaque paire en opposition de l'autre.
    // ⚠️ Balancement sur `rotation.z` (PAS `rotation.x` comme pour NpcVoxel/SynkVoxel) : le corps
    // du dragon a pour axe "avant/arrière" local +X/-X (tête vers +X, queue vers -X — voir
    // commentaire de `isFamiliar` dans `MarkerBlock` sur la convention de rotation dédiée), alors
    // que NpcVoxel/SynkVoxel ont pour axe avant/arrière +Z/-Z. Une rotation autour de X déplace un
    // point dans le plan Y-Z (donc perpendiculairement à l'avancée réelle du dragon, un pas "de
    // travers" façon crabe) ; une rotation autour de Z déplace un point dans le plan X-Y, ce qui
    // fait bien avancer/reculer le pied le long de l'axe X — corrige la demande utilisateur « leurs
    // jambes doivent aller dans le sens de la direction qu'ils prennent ».
    if (legFrontLeftRef.current) legFrontLeftRef.current.rotation.z = swing;
    if (legBackRightRef.current) legBackRightRef.current.rotation.z = swing;
    if (legFrontRightRef.current) legFrontRightRef.current.rotation.z = -swing;
    if (legBackLeftRef.current) legBackLeftRef.current.rotation.z = -swing;
    // Balancement de queue gauche/droite en vague (3 segments déphasés), amplifié en marche.
    const tailFreq = 1.6;
    const tailAmp = walking ? 0.55 : 0.32;
    if (tailBaseRef.current) tailBaseRef.current.rotation.y = Math.sin(t * tailFreq) * tailAmp;
    if (tailMidRef.current) tailMidRef.current.rotation.y = Math.sin(t * tailFreq - 0.7) * tailAmp * 0.85;
    if (tailTipRef.current) tailTipRef.current.rotation.y = Math.sin(t * tailFreq - 1.4) * tailAmp * 0.7;
    // Souffle de feu : cycle de `fireBreathIntervalSec` secondes (défaut 60, voir RepRules),
    // déphasé par dragon (`seedOffset`), visible ~1,1s en début de cycle avec un effet
    // croissance/scintillement/décroissance plutôt qu'un simple apparaître/disparaître brutal.
    if (flameRef.current) {
      if (!fireBreathEnabled) {
        flameRef.current.visible = false;
      } else {
        const interval = Math.max(5, fireBreathIntervalSec);
        const cyclePos = (t + seedOffset * interval) % interval;
        const breathing = cyclePos < 1.1;
        flameRef.current.visible = breathing;
        if (breathing) {
          const flicker = 0.85 + Math.sin(t * 40) * 0.15;
          const fadeOut = cyclePos > 0.75 ? Math.max(0, (1.1 - cyclePos) / 0.35) : 1;
          const grow = Math.min(1, cyclePos / 0.3) * fadeOut;
          flameRef.current.scale.setScalar(flicker * grow);
        }
      }
    }
  });
  const legColor = color;
  return (
    <group>
      <mesh castShadow scale={[1, 0.6, 0.78]}>
        <sphereGeometry args={[0.24, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <group position={[0.22, 0.13, 0]} rotation={[0, 0, -0.55]}>
        <mesh castShadow><cylinderGeometry args={[0.055, 0.09, 0.26, 6]} /><meshStandardMaterial color={color} roughness={0.55} /></mesh>
        <mesh position={[0.09, 0.16, 0]} rotation={[0, 0, 0.5]} castShadow><coneGeometry args={[0.085, 0.22, 6]} /><meshStandardMaterial color={color} roughness={0.5} /></mesh>
        {[[-0.02, 0.24, 0.045], [-0.02, 0.24, -0.045]].map(([hx, hy, hz], i) => (
          <mesh key={i} position={[hx, hy, hz]} rotation={[0, 0, 0.7]}><coneGeometry args={[0.02, 0.09, 4]} /><meshStandardMaterial color="#f5e6c8" /></mesh>
        ))}
        {/* Yeux (globe blanc + pupille sombre) de part et d'autre du museau, sur la tête cornue. */}
        {[0.055, -0.055].map((ez, i) => (
          <group key={i} position={[0.16, 0.22, ez]}>
            <mesh><sphereGeometry args={[0.028, 8, 8]} /><meshStandardMaterial color="#fef3c7" emissive="#fef3c7" emissiveIntensity={0.25} /></mesh>
            <mesh position={[0.018, 0, ez > 0 ? 0.012 : -0.012]}><sphereGeometry args={[0.013, 6, 6]} /><meshStandardMaterial color="#1c1917" /></mesh>
          </group>
        ))}
        {/* Souffle de feu (voir useFrame ci-dessus) — LONGUE gerbe de flammes (4 segments
            dégradés orange→jaune pâle, ~0,66 de portée) émise depuis le museau, en direction +X
            (vers l'avant de la tête, jamais vers le corps grâce à l'offset de rotation dédié du
            dragon — voir `isFamiliar` dans MarkerBlock). Caché (visible=false) hors des courtes
            fenêtres de souffle périodiques ; la croissance/décroissance (voir useFrame,
            `flameRef.scale`) fait "jaillir" progressivement toute la gerbe d'un coup (la mise à
            l'échelle du groupe parent allonge proportionnellement tous les segments enfants) au
            lieu d'un simple apparaître/disparaître brutal. Ne bloque jamais le clic (aucun
            onClick dessus). Répond à la demande utilisateur « il faut que les dragons crachent une
            longue gerbe de feu ». */}
        <group ref={flameRef} position={[0.05, 0.26, 0]} visible={false}>
          {[
            { x: 0.09, r: 0.055, len: 0.24, color: '#f97316', emissive: '#ea580c', ei: 1.0 },
            { x: 0.25, r: 0.042, len: 0.24, color: '#fb923c', emissive: '#f97316', ei: 1.15 },
            { x: 0.41, r: 0.03, len: 0.2, color: '#fde047', emissive: '#facc15', ei: 1.3 },
            { x: 0.55, r: 0.017, len: 0.16, color: '#fef9c3', emissive: '#fde047', ei: 1.4 },
          ].map((seg, i) => (
            <mesh key={i} position={[seg.x, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[seg.r, seg.len, 8]} />
              <meshStandardMaterial color={seg.color} emissive={seg.emissive} emissiveIntensity={seg.ei} roughness={0.4} transparent opacity={0.88} />
            </mesh>
          ))}
        </group>
      </group>
      {/* Longue queue effilée (3 segments : base épaisse → milieu → pointe fine), pivot à l'arrière
          du corps — voir balancement gauche/droite dans le useFrame ci-dessus. Remplace l'ancien
          cône unique court (0,42 de long) par une chaîne totalisant ~0,8 de long pour un rendu bien
          plus "dragon" (demande utilisateur : « ajoute une longue queue de dragons »). */}
      <group ref={tailBaseRef} position={[-0.22, 0.03, 0]}>
        <mesh position={[-0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.075, 0.055, 0.3, 6]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
        <group ref={tailMidRef} position={[-0.3, -0.01, 0]}>
          <mesh position={[-0.13, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.055, 0.035, 0.26, 6]} />
            <meshStandardMaterial color={color} roughness={0.55} />
          </mesh>
          <group ref={tailTipRef} position={[-0.26, -0.01, 0]}>
            <mesh position={[-0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <coneGeometry args={[0.035, 0.2, 6]} />
              <meshStandardMaterial color={color} roughness={0.55} />
            </mesh>
          </group>
        </group>
      </group>
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 0.2, side * 0.16]} rotation={[side * 0.55, 0, 0.1]} castShadow>
          <coneGeometry args={[0.3, 0.045, 3]} />
          <meshStandardMaterial color={color} roughness={0.7} transparent opacity={0.92} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Pattes (4, courtes, griffues) sous le corps — avant vers la tête (+x), arrière vers la
          queue (-x), gauche/droite écartées sur l'axe z. */}
      {([
        { ref: legFrontLeftRef, x: 0.11, z: 0.15 },
        { ref: legFrontRightRef, x: 0.11, z: -0.15 },
        { ref: legBackLeftRef, x: -0.11, z: 0.15 },
        { ref: legBackRightRef, x: -0.11, z: -0.15 },
      ] as const).map((leg, i) => (
        <group key={i} ref={leg.ref} position={[leg.x, -0.09, leg.z]}>
          <mesh position={[0, -0.07, 0]} castShadow><cylinderGeometry args={[0.028, 0.036, 0.16, 6]} /><meshStandardMaterial color={legColor} roughness={0.6} /></mesh>
          <mesh position={[0, -0.16, 0.015]} castShadow><boxGeometry args={[0.055, 0.04, 0.09]} /><meshStandardMaterial color={legColor} roughness={0.7} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Hash de chaîne simple/déterministe (djb2) — utilisé UNIQUEMENT pour dériver, à partir de
 * l'id/nom d'un PNJ, un attribut cosmétique stable (ex. expression du visage ci-dessous) qui ne
 * varie jamais d'un rendu à l'autre pour le MÊME PNJ, mais diffère naturellement d'un PNJ à
 * l'autre. Aucun rapport avec un hash cryptographique — collisions/faible distribution acceptables
 * pour un usage purement visuel. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Devine l'apparence d'un PNJ à partir de son id/nom (ex. "npc.thrall" / "Thrall (Chef de la
 * Horde)") — reconnaissance par mots-clés (même principe que `familiarDragonColor` ci-dessus),
 * repli neutre (robe/capuche générique) pour tout futur PNJ ajouté par l'admin sans mot-clé connu.
 * Purement cosmétique (aucun impact stats/mécanique) — répond à la demande utilisateur « je veux
 * que les PNJ soit représentés avec le même système que Synk donc comme des personnages style
 * Minecraft » pour Thrall et tous les autres PNJ (Zelda, Steve, Marchand, Dragon Ancestral...).
 * `smiling` (déterministe via `hashString`, voir ci-dessus) fait qu'un PNJ donné affiche TOUJOURRS
 * la même expression (pas de scintillement facial d'une frame à l'autre) mais que la population de
 * PNJ du jeu alterne naturellement sourire/visage neutre — corrige la demande utilisateur « dessine
 * tantôt un sourire tantôt un air normal sur le visage des PNJ pour les rendre plus naturels ». */
function npcAppearance(id: string, name: string): { skin: string; outfit: string; hair: string; accent: string; hat: 'crown' | 'hood' | 'hair'; smiling: boolean } {
  const s = `${id} ${name}`.toLowerCase();
  const smiling = hashString(s) % 2 === 0;
  if (s.includes('thrall') || s.includes('horde') || s.includes('orc') || s.includes('orque'))
    return { skin: '#6a9a4a', outfit: '#3f3226', hair: '#151515', accent: '#8a6a45', hat: 'hair', smiling };
  if (s.includes('zelda') || s.includes('princesse') || s.includes('princess'))
    return { skin: '#f2c99d', outfit: '#e6d5f0', hair: '#d4b83a', accent: '#d4af37', hat: 'crown', smiling };
  if (s.includes('steve') || s.includes('mineur') || s.includes('miner'))
    return { skin: '#f2c99d', outfit: '#3b6ea5', hair: '#3b2412', accent: '#5b3a1e', hat: 'hair', smiling };
  if (s.includes('marchand') || s.includes('merchant'))
    return { skin: '#e0ab7a', outfit: '#6b4a2a', hair: '#4a3a2a', accent: '#8a6a45', hat: 'hood', smiling };
  if (s.includes('dragon'))
    return { skin: '#8a5a3a', outfit: '#7f1d1d', hair: '#3a1a1a', accent: '#d4af37', hat: 'hood', smiling };
  return { skin: '#e8c39e', outfit: '#5b6a8a', hair: '#3b2412', accent: '#7dd3fc', hat: 'hood', smiling };
}

/** PNJ en voxels (façon Minecraft), même langage visuel que `SynkVoxel` (tête box + yeux/bouche,
 * torse, bras, jambes/bottes) — remplace la précédente silhouette encapuchonnée générique par un
 * vrai petit personnage reconnaissable, cohérent avec Synk. `walking` (PNJ errant uniquement, voir
 * lib/roamingActors.ts) déclenche un cycle de marche complet (bras/jambes en contre-mouvement,
 * même formule que SynkVoxel) au lieu du léger balancement idle (tête/bras) utilisé pour tout PNJ
 * statique du catalogue — corrige la demande utilisateur « tu leur donneras une démarche naturelle
 * [...] tu articuleras les bras, les jambes, le corps de ces PNJ ». Couleurs pilotées par
 * `npcAppearance` ci-dessus. */
function NpcVoxel({ appearance, walking = false }: { appearance: ReturnType<typeof npcAppearance>; walking?: boolean }) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (walking) {
      // Cycle de marche : balancement contro-latéral bras/jambes (même cadence/amplitude que la
      // marche de Synk, voir SynkVoxel) + léger rebond du corps au rythme des pas.
      const legSwing = Math.sin(t * 8) * 0.55, armSwing = -legSwing * 0.7;
      if (leftLegRef.current) leftLegRef.current.rotation.x = legSwing;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -legSwing;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -armSwing;
      if (rightArmRef.current) rightArmRef.current.rotation.x = armSwing;
      if (headRef.current) headRef.current.rotation.y = 0;
      if (bodyRef.current) bodyRef.current.position.y = Math.abs(Math.sin(t * 8)) * 0.06;
    } else {
      // Immobile : léger balancement idle (tête/bras) pour rester vivant sans cycle de marche complet.
      const sway = Math.sin(t * 0.7) * 0.05;
      if (leftArmRef.current) leftArmRef.current.rotation.x = sway;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -sway;
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
      if (headRef.current) headRef.current.rotation.y = Math.sin(t * 0.35) * 0.15;
      if (bodyRef.current) bodyRef.current.position.y = 0;
    }
  });
  const { skin, outfit, hair, accent, hat, smiling } = appearance;
  return (
    <group ref={bodyRef}>
      {/* Tête */}
      <group ref={headRef} position={[0, 0.62, 0]}>
        <mesh castShadow><boxGeometry args={[0.38, 0.38, 0.38]} /><meshStandardMaterial color={skin} /></mesh>
        <mesh position={[-0.08, 0.03, 0.19]}><boxGeometry args={[0.06, 0.06, 0.03]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0.08, 0.03, 0.19]}><boxGeometry args={[0.06, 0.06, 0.03]} /><meshStandardMaterial color="#1e293b" /></mesh>
        {smiling ? (
          // Sourire : barre centrale + deux coins relevés (silhouette voxel courbée vers le haut).
          <group>
            <mesh position={[0, -0.105, 0.19]}><boxGeometry args={[0.13, 0.025, 0.03]} /><meshStandardMaterial color="#7f2d3a" /></mesh>
            <mesh position={[-0.075, -0.085, 0.185]}><boxGeometry args={[0.03, 0.025, 0.03]} /><meshStandardMaterial color="#7f2d3a" /></mesh>
            <mesh position={[0.075, -0.085, 0.185]}><boxGeometry args={[0.03, 0.025, 0.03]} /><meshStandardMaterial color="#7f2d3a" /></mesh>
          </group>
        ) : (
          // Air normal : simple barre horizontale plate (expression neutre, comportement d'origine).
          <mesh position={[0, -0.1, 0.19]}><boxGeometry args={[0.12, 0.03, 0.03]} /><meshStandardMaterial color="#7f2d3a" /></mesh>
        )}
        {hat === 'crown' ? (
          <mesh position={[0, 0.22, 0]} castShadow><cylinderGeometry args={[0.16, 0.19, 0.1, 8]} /><meshStandardMaterial color={accent} metalness={0.6} roughness={0.3} /></mesh>
        ) : hat === 'hood' ? (
          <mesh position={[0, 0.17, -0.02]} castShadow><coneGeometry args={[0.24, 0.28, 8]} /><meshStandardMaterial color={outfit} roughness={0.85} /></mesh>
        ) : (
          <mesh position={[0, 0.18, -0.02]} castShadow><boxGeometry args={[0.4, 0.1, 0.4]} /><meshStandardMaterial color={hair} /></mesh>
        )}
      </group>
      {/* Torse (tunique + ceinture d'accent) */}
      <mesh position={[0, 0.2, 0]} castShadow><boxGeometry args={[0.34, 0.44, 0.24]} /><meshStandardMaterial color={outfit} /></mesh>
      <mesh position={[0, -0.02, 0]} castShadow><boxGeometry args={[0.36, 0.06, 0.26]} /><meshStandardMaterial color={accent} metalness={0.3} roughness={0.6} /></mesh>
      {/* Bras */}
      <group ref={leftArmRef} position={[-0.24, 0.38, 0]}>
        <mesh position={[0, -0.18, 0]} castShadow><boxGeometry args={[0.11, 0.36, 0.11]} /><meshStandardMaterial color={outfit} /></mesh>
        <mesh position={[0, -0.38, 0]} castShadow><boxGeometry args={[0.12, 0.09, 0.12]} /><meshStandardMaterial color={skin} /></mesh>
      </group>
      <group ref={rightArmRef} position={[0.24, 0.38, 0]}>
        <mesh position={[0, -0.18, 0]} castShadow><boxGeometry args={[0.11, 0.36, 0.11]} /><meshStandardMaterial color={outfit} /></mesh>
        <mesh position={[0, -0.38, 0]} castShadow><boxGeometry args={[0.12, 0.09, 0.12]} /><meshStandardMaterial color={skin} /></mesh>
      </group>
      {/* Jambes + bottes (groupes articulés, pivot à la hanche, même principe que SynkVoxel) */}
      <group ref={leftLegRef} position={[-0.1, -0.09, 0]}>
        <mesh position={[0, -0.11, 0]} castShadow><boxGeometry args={[0.13, 0.22, 0.13]} /><meshStandardMaterial color="#334155" /></mesh>
        <mesh position={[0, -0.25, 0.01]} castShadow><boxGeometry args={[0.14, 0.1, 0.15]} /><meshStandardMaterial color="#3f2c1a" /></mesh>
      </group>
      <group ref={rightLegRef} position={[0.1, -0.09, 0]}>
        <mesh position={[0, -0.11, 0]} castShadow><boxGeometry args={[0.13, 0.22, 0.13]} /><meshStandardMaterial color="#334155" /></mesh>
        <mesh position={[0, -0.25, 0.01]} castShadow><boxGeometry args={[0.14, 0.1, 0.15]} /><meshStandardMaterial color="#3f2c1a" /></mesh>
      </group>
    </group>
  );
}

type TreasureCategory =
  | 'sword' | 'dagger' | 'axe' | 'pickaxe' | 'bow' | 'shield' | 'armor' | 'helmet' | 'boots' | 'gauntlet'
  | 'amulet' | 'potion' | 'book' | 'staff' | 'coinpurse' | 'mushroom' | 'apple' | 'egg' | 'airship' | 'chest';

/** Devine la catégorie visuelle d'un trésor à partir de son id/libellé catalogue (ex.
 * "treasure.champignon_lueur" / "🍄 Champignon Luminescent") — le catalogue complet des trésors
 * (voir migrateNpcsTreasoresWorldsToFirebase.mjs) est une progression d'objets classiques de
 * Donjons & Dragons (épées, boucliers, armures, potions/fioles, grimoires, arcs/carquois, bottes,
 * heaumes, gantelets, amulettes, haches, pioche, bourse de rubis, œuf de dragon, nourriture
 * enchantée) : chaque catégorie a SA propre forme réaliste ci-dessous (voir `TreasureIcon`),
 * remplaçant le coffre générique unique pour TOUS les trésors (demande utilisateur : « le
 * champignon Luminescent doit ressembler à un vrai champignon [...] et pas à un vulgaire coffre »).
 * Repli `'chest'` (rendu identique à l'ancien coffre) pour tout futur trésor sans mot-clé connu. */
function treasureCategory(id: string, name: string): TreasureCategory {
  const s = `${id} ${name}`.toLowerCase();
  if (s.includes('pomme')) return 'apple';
  if (s.includes('champignon')) return 'mushroom';
  if (s.includes('oeuf') || s.includes('œuf') || s.includes('egg')) return 'egg';
  if (s.includes('aeronef') || s.includes('aéronef') || s.includes('airship')) return 'airship';
  if (s.includes('sceptre') || s.includes('scepter')) return 'staff';
  if (s.includes('dague') || s.includes('dagger')) return 'dagger';
  if (s.includes('hache') || s.includes('axe')) return 'axe';
  if (s.includes('pioche') || s.includes('pickaxe')) return 'pickaxe';
  if (s.includes('epee') || s.includes('épée') || s.includes('sword') || s.includes('thunderfury')) return 'sword';
  if (s.includes('arc') || s.includes('carquois') || s.includes('bow') || s.includes('quiver')) return 'bow';
  if (s.includes('bouclier') || s.includes('shield')) return 'shield';
  if (s.includes('heaume') || s.includes('casque') || s.includes('helm')) return 'helmet';
  if (s.includes('bottes') || s.includes('boots')) return 'boots';
  if (s.includes('gantelet') || s.includes('gauntlet')) return 'gauntlet';
  if (s.includes('armure') || s.includes('armor')) return 'armor';
  if (s.includes('amulette') || s.includes('amulet')) return 'amulet';
  if (s.includes('fiole') || s.includes('potion') || s.includes('vial') || s.includes('essence')) return 'potion';
  if (s.includes('grimoire') || s.includes('parchemin') || s.includes('book') || s.includes('scroll')) return 'book';
  if (s.includes('bourse') || s.includes('rubis') || s.includes('purse') || s.includes('coin')) return 'coinpurse';
  return 'chest';
}

/** Rendu 3D réaliste et texturé (matériaux différenciés bois/cuir/métal/verre/organique) d'un
 * trésor selon sa catégorie (voir `treasureCategory`) — corrige la demande utilisateur de ne plus
 * avoir "un vulgaire coffre" pour absolument tout le catalogue de trésors. Formes volontairement
 * compactes (échelle cohérente avec les autres marqueurs flottants) mais immédiatement
 * reconnaissables. `'chest'` reproduit EXACTEMENT l'ancien rendu (zéro régression pour les trésors
 * non couverts par un mot-clé). */
function TreasureIcon({ category }: { category: TreasureCategory }) {
  switch (category) {
    case 'sword':
      return (
        <group rotation={[0, 0, Math.PI / 2.3]}>
          <mesh position={[0, -0.24, 0]} castShadow><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#8a6a45" metalness={0.5} roughness={0.4} /></mesh>
          <mesh position={[0, -0.16, 0]} castShadow><cylinderGeometry args={[0.022, 0.022, 0.16, 8]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
          <mesh position={[0, -0.07, 0]} castShadow><boxGeometry args={[0.22, 0.025, 0.03]} /><meshStandardMaterial color="#c7ccd1" metalness={0.75} roughness={0.25} /></mesh>
          <mesh position={[0, 0.16, 0]} castShadow><boxGeometry args={[0.06, 0.46, 0.014]} /><meshStandardMaterial color="#c7ccd1" metalness={0.85} roughness={0.2} /></mesh>
          <mesh position={[0, 0.43, 0]} castShadow><coneGeometry args={[0.03, 0.09, 4]} /><meshStandardMaterial color="#c7ccd1" metalness={0.85} roughness={0.2} /></mesh>
        </group>
      );
    case 'dagger':
      return (
        <group rotation={[0, 0, Math.PI / 2.3]}>
          <mesh position={[0, -0.14, 0]} castShadow><cylinderGeometry args={[0.02, 0.02, 0.14, 8]} /><meshStandardMaterial color="#6b4423" roughness={0.8} /></mesh>
          <mesh position={[0, -0.04, 0]} castShadow><boxGeometry args={[0.14, 0.02, 0.025]} /><meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[0, 0.12, 0]} castShadow><boxGeometry args={[0.04, 0.3, 0.012]} /><meshStandardMaterial color="#9aa0a6" metalness={0.75} roughness={0.3} /></mesh>
          <mesh position={[0, 0.28, 0]} castShadow><coneGeometry args={[0.02, 0.06, 4]} /><meshStandardMaterial color="#9aa0a6" metalness={0.75} roughness={0.3} /></mesh>
        </group>
      );
    case 'axe':
      return (
        <group rotation={[0, 0, Math.PI / 2.3]}>
          <mesh position={[0, -0.05, 0]} castShadow><cylinderGeometry args={[0.024, 0.024, 0.5, 8]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
          <mesh position={[0.09, 0.22, 0]} rotation={[0, 0, -0.3]} castShadow><boxGeometry args={[0.2, 0.22, 0.03]} /><meshStandardMaterial color="#9aa0a6" metalness={0.65} roughness={0.3} /></mesh>
        </group>
      );
    case 'pickaxe':
      return (
        <group rotation={[0, 0, Math.PI / 2.3]}>
          <mesh position={[0, -0.05, 0]} castShadow><cylinderGeometry args={[0.022, 0.022, 0.46, 8]} /><meshStandardMaterial color="#6b4423" roughness={0.8} /></mesh>
          <mesh position={[0, 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><coneGeometry args={[0.045, 0.34, 4]} /><meshStandardMaterial color="#7c8590" metalness={0.7} roughness={0.3} /></mesh>
        </group>
      );
    case 'bow':
      return (
        <group>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.24, 0.017, 6, 12, Math.PI]} /><meshStandardMaterial color="#6b4423" roughness={0.75} /></mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.48, 0.008, 0.008]} /><meshStandardMaterial color="#e5decf" /></mesh>
          <group position={[0.16, 0.1, 0.02]} rotation={[0.2, 0, -0.3]}>
            <mesh castShadow><cylinderGeometry args={[0.06, 0.07, 0.26, 8]} /><meshStandardMaterial color="#6b4423" /></mesh>
            <mesh position={[0.015, 0.16, 0]}><boxGeometry args={[0.012, 0.18, 0.012]} /><meshStandardMaterial color="#c9a876" /></mesh>
          </group>
        </group>
      );
    case 'shield':
      return (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh castShadow><cylinderGeometry args={[0.19, 0.19, 0.035, 16]} /><meshStandardMaterial color="#7a5230" roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.001]}><torusGeometry args={[0.185, 0.016, 6, 16]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[0, 0, 0.02]} castShadow><sphereGeometry args={[0.055, 10, 8]} /><meshStandardMaterial color="#d4af37" metalness={0.65} roughness={0.3} /></mesh>
        </group>
      );
    case 'armor':
      return (
        <group>
          <mesh castShadow><boxGeometry args={[0.3, 0.4, 0.22]} /><meshStandardMaterial color="#9aa0a6" metalness={0.55} roughness={0.35} /></mesh>
          <mesh position={[0, 0.22, 0]} castShadow><boxGeometry args={[0.34, 0.1, 0.26]} /><meshStandardMaterial color="#7c8590" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[0, -0.02, 0]}><boxGeometry args={[0.32, 0.05, 0.24]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.35} /></mesh>
        </group>
      );
    case 'helmet':
      return (
        <group>
          <mesh castShadow><sphereGeometry args={[0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color="#9aa0a6" metalness={0.7} roughness={0.35} /></mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}><torusGeometry args={[0.195, 0.022, 8, 16]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[0, -0.08, 0.18]} castShadow><boxGeometry args={[0.05, 0.11, 0.04]} /><meshStandardMaterial color="#9aa0a6" metalness={0.7} roughness={0.3} /></mesh>
        </group>
      );
    case 'boots':
      return (
        <group>
          <mesh position={[-0.1, 0, 0]} castShadow><boxGeometry args={[0.15, 0.28, 0.17]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
          <mesh position={[0.1, 0, 0]} castShadow><boxGeometry args={[0.15, 0.28, 0.17]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
          <mesh position={[-0.1, -0.15, 0.03]}><boxGeometry args={[0.16, 0.06, 0.2]} /><meshStandardMaterial color="#3f2c1a" /></mesh>
          <mesh position={[0.1, -0.15, 0.03]}><boxGeometry args={[0.16, 0.06, 0.2]} /><meshStandardMaterial color="#3f2c1a" /></mesh>
        </group>
      );
    case 'gauntlet':
      return (
        <group>
          <mesh castShadow><cylinderGeometry args={[0.09, 0.1, 0.2, 8]} /><meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.35} /></mesh>
          {[0, 1, 2, 3].map(i => (
            <mesh key={i} position={[-0.06 + i * 0.04, -0.15, 0.06]} castShadow><boxGeometry args={[0.032, 0.14, 0.032]} /><meshStandardMaterial color="#7c8590" metalness={0.6} roughness={0.35} /></mesh>
          ))}
        </group>
      );
    case 'amulet':
      return (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.1, 0.016, 6, 16]} /><meshStandardMaterial color="#c9a876" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[0, -0.14, 0]}><octahedronGeometry args={[0.09, 0]} /><meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.6} metalness={0.3} roughness={0.2} /></mesh>
        </group>
      );
    case 'potion':
      return (
        <group>
          <mesh position={[0, -0.06, 0]} castShadow><sphereGeometry args={[0.14, 12, 10]} /><meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.25} transparent opacity={0.75} roughness={0.15} /></mesh>
          <mesh position={[0, 0.1, 0]} castShadow><cylinderGeometry args={[0.045, 0.06, 0.16, 8]} /><meshStandardMaterial color="#cfe8db" transparent opacity={0.55} roughness={0.1} /></mesh>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.05, 0.05, 0.05, 8]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
        </group>
      );
    case 'book':
      return (
        <group rotation={[0.15, 0.3, 0]}>
          <mesh castShadow><boxGeometry args={[0.34, 0.05, 0.26]} /><meshStandardMaterial color="#6b2c2c" roughness={0.7} /></mesh>
          <mesh position={[0, 0.028, 0]}><boxGeometry args={[0.3, 0.008, 0.22]} /><meshStandardMaterial color="#e8d9ad" roughness={0.85} /></mesh>
          <mesh position={[-0.16, 0, 0]}><boxGeometry args={[0.02, 0.052, 0.26]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.35} /></mesh>
        </group>
      );
    case 'staff':
      return (
        <group>
          <mesh position={[0, -0.1, 0]} castShadow><cylinderGeometry args={[0.024, 0.03, 0.5, 8]} /><meshStandardMaterial color="#5b3a1e" roughness={0.75} /></mesh>
          <mesh position={[0, 0.2, 0]} castShadow><octahedronGeometry args={[0.075, 0]} /><meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.55} metalness={0.3} roughness={0.2} /></mesh>
        </group>
      );
    case 'coinpurse':
      return (
        <group>
          <mesh castShadow><sphereGeometry args={[0.16, 12, 10]} /><meshStandardMaterial color="#8a5a2a" roughness={0.85} /></mesh>
          <mesh position={[0, 0.15, 0]} castShadow><cylinderGeometry args={[0.025, 0.05, 0.1, 8]} /><meshStandardMaterial color="#6b4423" roughness={0.8} /></mesh>
          <mesh position={[0, 0.19, 0]}><torusGeometry args={[0.05, 0.014, 6, 12]} /><meshStandardMaterial color="#c9a876" roughness={0.7} /></mesh>
          <mesh position={[0.06, -0.02, 0.1]}><cylinderGeometry args={[0.035, 0.035, 0.01, 12]} /><meshStandardMaterial color="#d4af37" metalness={0.7} roughness={0.25} /></mesh>
        </group>
      );
    case 'mushroom':
      return (
        <group>
          <mesh position={[0, -0.1, 0]} castShadow><cylinderGeometry args={[0.045, 0.055, 0.2, 8]} /><meshStandardMaterial color="#e8d9ad" roughness={0.8} /></mesh>
          <mesh position={[0, 0.04, 0]} castShadow><sphereGeometry args={[0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.5} roughness={0.4} /></mesh>
          {[[0.06, 0.09, 0.06], [-0.07, 0.1, -0.02], [0.01, 0.11, -0.08]].map(([px, py, pz], i) => (
            <mesh key={i} position={[px, py, pz]}><sphereGeometry args={[0.018, 6, 6]} /><meshStandardMaterial color="#e9d5ff" emissive="#e9d5ff" emissiveIntensity={0.8} /></mesh>
          ))}
        </group>
      );
    case 'apple':
      return (
        <group>
          <mesh castShadow><sphereGeometry args={[0.15, 14, 12]} /><meshStandardMaterial color="#eab308" metalness={0.3} roughness={0.25} emissive="#eab308" emissiveIntensity={0.2} /></mesh>
          <mesh position={[0, 0.16, 0]} rotation={[0.3, 0, 0]}><cylinderGeometry args={[0.012, 0.012, 0.08, 6]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
          <mesh position={[0.05, 0.15, 0]} rotation={[0, 0, 0.6]}><coneGeometry args={[0.03, 0.06, 6]} /><meshStandardMaterial color="#22c55e" roughness={0.7} /></mesh>
        </group>
      );
    case 'egg':
      return (
        <group>
          <mesh castShadow scale={[1, 1.25, 1]}><sphereGeometry args={[0.16, 14, 12]} /><meshStandardMaterial color="#166534" roughness={0.5} /></mesh>
          {[[0.05, 0.05, 0.1], [-0.06, -0.02, 0.09], [0.01, -0.1, 0.11]].map(([px, py, pz], i) => (
            <mesh key={i} position={[px, py, pz]} rotation={[0, 0, i]}><circleGeometry args={[0.03, 6]} /><meshStandardMaterial color="#4ade80" emissive="#4ade80" emissiveIntensity={0.3} side={THREE.DoubleSide} /></mesh>
          ))}
        </group>
      );
    case 'airship':
      return (
        <group>
          <mesh castShadow scale={[1, 0.55, 0.55]}><sphereGeometry args={[0.22, 12, 10]} /><meshStandardMaterial color="#dbeafe" roughness={0.6} transparent opacity={0.85} /></mesh>
          <mesh position={[0, -0.18, 0]} castShadow><boxGeometry args={[0.22, 0.08, 0.12]} /><meshStandardMaterial color="#6b4423" roughness={0.75} /></mesh>
          {[-0.12, 0.12].map((sx) => (
            <mesh key={sx} position={[sx, -0.11, 0]}><cylinderGeometry args={[0.006, 0.006, 0.14, 4]} /><meshStandardMaterial color="#e5decf" /></mesh>
          ))}
        </group>
      );
    case 'chest':
    default:
      return (
        <>
          <mesh position={[0, -0.05, 0]} castShadow><boxGeometry args={[0.42, 0.28, 0.3]} /><meshStandardMaterial color="#6b4423" roughness={0.75} /></mesh>
          <mesh position={[0, 0.12, 0]} rotation={[-0.18, 0, 0]} castShadow><boxGeometry args={[0.42, 0.16, 0.3]} /><meshStandardMaterial color="#5a3a1e" roughness={0.75} /></mesh>
          <mesh position={[0, 0.02, 0.155]}><boxGeometry args={[0.1, 0.28, 0.03]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.35} /></mesh>
          <mesh position={[0, 0.16, 0.15]}><boxGeometry args={[0.06, 0.06, 0.05]} /><meshStandardMaterial color="#d4af37" metalness={0.7} roughness={0.3} /></mesh>
        </>
      );
  }
}

/** Marqueur (PNJ, familier, trésor, monde/portail, Zorghon, captif, POI, quête) matérialisé par un
 * petit socle coloré + une forme flottante animée — registre `MARKER_COLOR` extensible : ajouter un
 * nouveau `kind` n'importe où dans gameState.ts::MapMarkerKind sera automatiquement représenté ici
 * (couleur de repli `#94a3b8` si absent du registre). `onClick` ouvre la même interaction (PNJ,
 * trésor, quête, monde, hutte du catalogue) que le clic sur un marqueur en Plateforme 2D
 * isométrique — voir Platform3DWidget::onMarkerClick3D. Rendus spécifiques réalistes (demande
 * utilisateur, cf. « une énigme pourrait ressembler à un parchemin qui flotte », « une grotte doit
 * ressembler à une vraie entrée de grotte », « le Dragon Vert doit ressembler à un dragon »,
 * « l'hôtel ressemble encore à un losange blanc ») : `kind==='quest'` → parchemin roulé flottant ;
 * `kind==='poi' && poiType==='cave'` → arche rocheuse + cristaux, fixe au sol ; `kind==='poi' &&
 * poiType` ∈ {hut, tavern, stable, village_ally, village_enemy} → petite bâtisse (chaumière/taverne/
 * étable/village), fixe au sol, même silhouette que le décor `PropBlock` kind==='hut' pour rester
 * cohérent visuellement ; `kind==='familiar'` → `DragonMarker` coloré selon le catalogue, agrandi
 * (`scale`, voir Platform3DObjectFlags['marker:familiar']) pour rester nettement plus grand que
 * Synk ; `kind==='npc'` → `NpcVoxel` (voxel façon Minecraft, voir `npcAppearance`), également mis à
 * l'échelle via `Platform3DObjectFlags['marker:npc']` ; `kind==='treasure'` → forme dédiée à sa
 * catégorie (épée, bouclier, potion, champignon, pomme, œuf de dragon...), voir `TreasureIcon` ;
 * `kind==='world'` → portail circulaire lumineux (type porte des étoiles) ;
 * `kind==='zorghon'` → silhouette sombre cornue menaçante ; `kind==='captive'` → silhouette liée.
 * Tout kind non couvert ci-dessus conserve EXACTEMENT le rendu octaédrique précédent — zéro
 * régression. */
/** Dalle de tombe qui se soulève/pivote UNE SEULE FOIS au montage (voir isTomb dans MarkerBlock
 * ci-dessous) — animation LOCALE simplifiée (voir commentaire isTomb) : ne cherche pas à se
 * synchroniser avec l'instant réel d'apparition d'un mort-vivant (lib/roamingActors.ts), juste un
 * effet visuel suggérant qu'« une dalle bouge et se soulève à côté de sa pierre tombale ». Le délai
 * de départ est dérivé de `markerId` (hash simple) pour que les 20 tombes ne s'ouvrent pas toutes
 * en même temps au chargement de la scène. */
function TombSlab({ markerId }: { markerId?: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const startRef = useRef<number | null>(null);
  const delay = useMemo(() => {
    let h = 0;
    for (const c of (markerId ?? 'tomb')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return (h % 4000) / 1000; // 0-4s de décalage avant que la dalle ne commence à se soulever
  }, [markerId]);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    if (startRef.current === null) startRef.current = state.clock.elapsedTime + delay;
    const elapsed = state.clock.elapsedTime - startRef.current;
    const progress = Math.max(0, Math.min(1, elapsed / 2)); // s'ouvre sur ~2s puis reste en l'état
    const eased = 1 - Math.pow(1 - progress, 3);
    m.rotation.x = -eased * 0.75;
    m.position.y = 0.03 + eased * 0.1;
    m.position.z = 0.32 + eased * 0.18;
  });
  return (
    <mesh ref={ref} position={[0, 0.03, 0.32]} castShadow>
      <boxGeometry args={[0.48, 0.06, 0.48]} />
      <meshStandardMaterial color="#4a443a" roughness={1} />
    </mesh>
  );
}
function MarkerBlock({ kind, poiType, name, markerId, x, z, scale = 1, facing, moving, onClick, fireBreathEnabled, fireBreathIntervalSec, wildlifeAudio, owlHootEnabled, werewolfHowlEnabled, stargate }: {
  kind: string; poiType?: MapPoiType; name?: string; markerId?: string; x: number; z: number; scale?: number;
  /** Renseignés UNIQUEMENT pour le PNJ/Dragon errant (voir lib/roamingActors.ts) — orientent le
   * personnage dans sa direction de marche et déclenchent sa démarche animée (voir NpcVoxel/
   * DragonMarker) ; `undefined` pour tout autre marqueur (comportement idle inchangé). */
  facing?: SynkDirection; moving?: boolean;
  onClick: () => void;
  /** Souffle de feu périodique (familiers-dragons uniquement, voir DragonMarker) — voir
   * RepRules.dragonFireBreathEnabled/dragonFireBreathIntervalSec. */
  fireBreathEnabled?: boolean; fireBreathIntervalSec?: number;
  /** Faune sauvage errante (hibou/loup-garou, voir isWildlife ci-dessous) — voir le commentaire de
   * ces mêmes props sur Scene() ci-dessus. */
  wildlifeAudio?: Record<AudioSourceKey, AudioSourceSetting>;
  owlHootEnabled?: boolean; werewolfHowlEnabled?: boolean;
  /** Uniquement pour `kind === 'world'` — voir PropBlock::stargate (même forme). */
  stargate?: {
    isActivating: boolean; activationStartedAt?: number; activationDurationMs?: number;
    onConsoleClick: () => void; onActivationComplete: () => void;
  };
}) {
  // Ref générique : anime (flottaison + légère rotation) le contenu de TOUTES les branches "en
  // lévitation" (quête, trésor, monde, zorghon, captif, gemme par défaut) — les branches "fixes au
  // sol" (grotte, bâtisses) ne l'utilisent jamais et ne sont donc jamais animées. PNJ/familier
  // (personnages vivants, voir NpcVoxel/DragonMarker) en sont exclus depuis la correction du bug
  // « toupie » ci-dessous — un personnage debout/marchant ne doit jamais tourner sur lui-même en
  // continu comme un objet magique en lévitation (demande utilisateur : « fait en sorte que ces
  // deux PNJ arrêtent de tourner sur eux-mêmes comme une toupie »).
  const bobRef = useRef<THREE.Group>(null);
  const isCave = kind === 'poi' && poiType === 'cave';
  const isBuilding = kind === 'poi' && !!poiType && (['hut', 'tavern', 'stable', 'village_ally', 'village_enemy'] as MapPoiType[]).includes(poiType);
  // Cimetière/crypte/tombe (voir MapPoiType, demande utilisateur « 2 cimetières [...] une
  // vingtaine de cryptes [...] et de tombes ») — rendues FIXES au sol comme `isBuilding` (pas de
  // flottaison/bob), chacune avec sa propre silhouette dédiée (voir branches de rendu plus bas).
  const isCemetery = kind === 'poi' && poiType === 'cemetery';
  const isCrypt = kind === 'poi' && poiType === 'crypt';
  const isTomb = kind === 'poi' && poiType === 'tomb';
  const isQuest = kind === 'quest';
  const isFamiliar = kind === 'familiar';
  const isNpc = kind === 'npc';
  /** Faune sauvage errante (hibou/loup-garou, voir lib/roamingActors.ts::WildlifeActorState) —
   * corrige le bug remonté par l'utilisateur : « le loup garou et le hibou me suivent quand je me
   * déplace [...] fait en sorte qu'ils soient positionnés aléatoirement sur le widget de la
   * mapmonde ». Rendue exactement comme un PNJ/familier "vivant" (même interpolation de position/
   * démarche animée), sans anneau de sélection ni pédagogie de catalogue. */
  const isWildlife = kind === 'wildlife';
  // Sous-espèce de faune (owl/werewolf/boar), déduite du préfixe stable de `markerId` (voir
  // lib/roamingActors.ts::ensureWildlifeSpawns) — calculée ICI (et non plus seulement au moment du
  // rendu ci-dessous) car le calage au sol (voir `groundAnchorUnscaled` plus bas) dépend désormais
  // de la géométrie PROPRE à chaque sous-espèce, chacune ayant un point le plus bas différent.
  const wildlifeKind: 'owl' | 'werewolf' | 'boar' | 'zombie' | 'ghoul' | 'skeleton' = !isWildlife ? 'boar'
    : (markerId ?? '').startsWith('owl-') ? 'owl'
    : (markerId ?? '').startsWith('werewolf-') ? 'werewolf'
    : (markerId ?? '').startsWith('zombie-') ? 'zombie'
    : (markerId ?? '').startsWith('ghoul-') ? 'ghoul'
    : (markerId ?? '').startsWith('skeleton-') ? 'skeleton'
    : 'boar';
  const isTreasure = kind === 'treasure';
  // Objet déposé par un joueur (glisser-déposer depuis la besace — voir MapMarkerKind==='drop'/
  // lib/worldDrops.ts) : réutilise EXACTEMENT le même rendu que `isTreasure` ci-dessous (même
  // registre `treasureCategory`/`TreasureIcon` déduit du nom/id, voir demande utilisateur
  // « matérialiseras l'objet déposé [...] par le type d'objet et sa forme 3D ») — aucune nouvelle
  // géométrie à maintenir, un objet déposé ressemble donc à un trésor de la même catégorie.
  const isDrop = kind === 'drop';
  const isWorld = kind === 'world';
  const isZorghon = kind === 'zorghon';
  const isCaptive = kind === 'captive';
  const floating = !isCave && !isBuilding && !isCemetery && !isCrypt && !isTomb;
  const spinning = floating && !isNpc && !isFamiliar && !isWildlife && !isWorld;
  const bobAmplitude = isQuest ? 0.25 : 0.15;
  // Interpolation de position (PNJ/Dragon errant, PNJ "en approche", fantômes persistés — voir
  // facing/moving ci-dessus, tous UNIQUEMENT renseignés pour ces entités "vivantes") : sans cela,
  // une nouvelle position mapmonde reçue à chaque tick (lib/roamingActors.ts, cadence `getRoamStepMs()`)
  // est appliquée INSTANTANÉMENT via le prop `position` du groupe racine — un « saut »/
  // « téléportation » net, perceptible comme un clignotement erratique dès que plusieurs entités
  // vivantes se trouvent simultanément dans le champ de vue (bug remonté par l'utilisateur : « une
  // multitude de PNJ apparaissent en se déplaçant aléatoirement [...] en clignotant »).
  // Ne s'applique JAMAIS aux marqueurs catalogue statiques (facing/moving toujours `undefined` pour
  // eux) : ceux-ci gardent un positionnement direct inchangé, zéro régression sur leur affichage.
  const posGroupRef = useRef<THREE.Group>(null);
  const posInitedRef = useRef(false);
  // 🔧 Interpolation LINÉAIRE bornée dans le temps (remplace l'ancien lissage exponentiel à facteur
  // fixe 0.12/frame) : dès qu'une NOUVELLE position cible (x,z) est reçue, la position affichée
  // glisse depuis son point de départ jusqu'à cette cible sur EXACTEMENT `getRoamStepMs()`
  // millisecondes — la cadence réelle des ticks (voir configureRoaming). L'ancien lissage
  // exponentiel convergeait en ~1s, bien AVANT l'arrivée de la cible suivante (4s à l'époque),
  // laissant l'acteur visuellement immobile pendant le reste du tick alors que ses jambes
  // continuaient d'être animées (prop `moving`, vrai pendant tout un maintien de marche) — exactement
  // le bug remonté par l'utilisateur : « ils bougent frénétiquement leurs jambes en avançant puis
  // avancent un peu [...] ça donne l'impression qu'ils piétinent ». En faisant durer l'interpolation
  // EXACTEMENT aussi longtemps que l'intervalle entre deux ticks, le glissement reste continu d'un
  // tick à l'autre tant que l'acteur marche réellement, sans le moindre temps mort.
  const fromRef = useRef({ x, z });
  const targetRef = useRef({ x, z });
  const tickStartRef = useRef(0);
  const isLiveActor = (isNpc || isFamiliar || isWildlife) && (facing !== undefined || moving !== undefined);
  useFrame(() => {
    const g = posGroupRef.current;
    if (!g || !isLiveActor) return;
    if (!posInitedRef.current) {
      g.position.set(x, g.position.y, z);
      fromRef.current = { x, z };
      targetRef.current = { x, z };
      tickStartRef.current = performance.now();
      posInitedRef.current = true;
      return;
    }
    if (x !== targetRef.current.x || z !== targetRef.current.z) {
      // Nouvelle cible reçue (tick lib/roamingActors.ts) : mémorise le point de départ (position
      // ACTUELLEMENT affichée — utile si l'acteur vient d'être gelé par proximité, voir
      // RepRules.roamProximityFreezeEnabled, auquel cas la cible n'a pas bougé et rien ne change) et
      // redémarre le chronomètre local de cette interpolation.
      fromRef.current = { x: g.position.x, z: g.position.z };
      targetRef.current = { x, z };
      tickStartRef.current = performance.now();
    }
    const stepMs = getRoamStepMs();
    const progress = stepMs > 0 ? Math.min(1, (performance.now() - tickStartRef.current) / stepMs) : 1;
    g.position.x = fromRef.current.x + (x - fromRef.current.x) * progress;
    g.position.z = fromRef.current.z + (z - fromRef.current.z) * progress;
  });
  // Relevage anti-enterrement/anti-lévitation (PNJ/familier/faune errante — TOUS les personnages
  // VIVANTS posés au sol) : le point le plus bas de chaque modèle (en unités NON mises à l'échelle)
  // s'enfonce/flotte selon sa PROPRE géométrie. Bug remonté par l'utilisateur (« les jambes du PNJ
  // sont enterrées dans le sol, contrairement à Synk ») : à `scale=1` (PNJ, défaut), l'ancienne
  // formule `groundAnchorUnscaled * (scale - 1)` s'annulait à ZÉRO — le seul relevage restant était
  // le petit flottement (« bob ») partagé avec les objets EN LÉVITATION (`bobAmplitude≈0.15`), très
  // insuffisant pour compenser un enfoncement de jambes de `0.39` (un PNJ vivant posé au sol n'a
  // donc jamais été correctement calé, seuls les familiers agrandis `scale=2.4` recevaient un
  // relevage partiel). Un personnage VIVANT (PNJ/familier/faune) qui MARCHE/se tient sur le sol ne
  // doit par ailleurs jamais léviter/flotter/rebondir comme un parchemin de quête ou un trésor
  // magique — on lui applique donc un calage FIXE (aucune oscillation sinusoïdale), exactement comme
  // Synk (`SYNK_GROUND_OFFSET`, jamais animé en Y hors de son propre rebond de marche interne) :
  //   groundLift = groundAnchorUnscaled * scale
  // Cela replace TOUJOURS le bas des pattes exactement au niveau du sol (`y≈0`), quelle que soit
  // l'échelle admin (« 🧱 Objets & décor 3D »), sans jamais les faire flotter au-dessus.
  // ⚠️ DOUBLE RÉGRESSION CORRIGÉE SUR LA FAUNE ERRANTE (`isWildlife`, `Owl3D`/`Werewolf3D`/
  // `Boar3D`, voir Platform3DAmbientScene.tsx) : un premier correctif l'avait à tort exclue de tout
  // calage fixe, la laissant retomber dans la branche `bobAmplitude`+sinus des objets EN LÉVITATION
  // — ce qui produisait à la fois (1) un flottement PERMANENT d'au moins `0.09` (le minimum de
  // `bobAmplitude(0.15) - 0.06`, jamais nul) au-dessus du sol, ET (2) un rebond sinusoïdal visible
  // « comme un objet de quête », alors que loup-garou/sanglier/marcassin sont des créatures vivantes
  // qui doivent rester fixes au sol comme un PNJ/familier (bug remonté par l'utilisateur : « les
  // sangliers et marcassins rebondissent sur place [...] ils doivent être considérés comme des
  // familiers, des PNJ »). Un correctif ENCORE PLUS ANTÉRIEUR avait, lui, appliqué à tort la
  // constante `0.39` (calibrée pour `NpcVoxel`) à la faune, la faisant flotter à ~0.39 unité
  // au-dessus du sol (bug alors remonté : « le loup-garou est bien trop élevé »). La faune reçoit
  // donc désormais elle aussi un calage FIXE (comme PNJ/familier, sans plus jamais léviter/
  // rebondir), mais avec une constante `groundAnchorUnscaled` calibrée PAR SOUS-ESPÈCE (`owl`/
  // `werewolf`/`boar`, voir `wildlifeKind` plus haut) à partir de SA PROPRE géométrie plutôt que de
  // réutiliser celle de `NpcVoxel` :
  // - `owl` → `0` : le hibou gère sa PROPRE élévation en interne (`bodyRef.position.y = 0.7`,
  //   posé sur son perchoir en bois dont le pied est DÉJÀ à `y=0`) — un calage supplémentaire le
  //   ferait léviter au-dessus de son propre perchoir, qui suivrait alors le bob comme s'il
  //   s'agissait d'un objet magique.
  // - `werewolf` → `0.06` : ses 4 pattes (voir `Werewolf3D`) descendent, au repos, jusqu'à
  //   `y≈-0.040` (avant) et `y≈-0.058` (arrière, le point le plus bas) — `0.06` replace la patte la
  //   plus profonde tout juste au niveau du sol (les pattes avant, plus courtes, restent alors à
  //   peine 0,02 unité au-dessus, un écart minime et non perceptible, largement préférable au
  //   flottement de 0,09 à 0,21 précédent).
  // - `boar` (sanglier ET marcassins, même composant `BoarUnit` juste mis à l'échelle) → `0` : ses
  //   4 pattes touchent DÉJÀ exactement `y=0` au repos par construction géométrique (`0,16 - 0,08 -
  //   0,08 = 0`), aucun calage supplémentaire n'est nécessaire.
  // Les marqueurs EN LÉVITATION (quête/trésor/monde/zorghon/captif/gemme de repli) conservent eux
  // aussi EXACTEMENT leur ancien comportement (`bobAmplitude` + oscillation), `groundAnchorUnscaled`
  // valant `0` pour eux — zéro régression.
  const isLivingCharacter = isNpc || isFamiliar || isWildlife;
  const groundAnchorUnscaled = isFamiliar ? 0.27 : isNpc ? 0.39
    : isWildlife ? (wildlifeKind === 'werewolf' ? 0.06 : wildlifeKind === 'ghoul' ? 0.05 : 0) : 0;
  useFrame((state) => {
    const obj = bobRef.current;
    if (!obj || !floating) return;
    if (isLivingCharacter) {
      obj.position.y = groundAnchorUnscaled * scale;
    } else if (isWorld) {
      // Porte des étoiles flottante : désormais une porte VERTICALE STATIQUE (voir StargatePortal)
      // — plus de flottaison/spin continu (ancien comportement, bug visuel pour une « porte » qui
      // doit rester immobile hors activation, voir demande utilisateur « transforme [...] en porte
      // des étoiles verticales [...] le 1er anneau restera [immobile] »). Hauteur fixe : seul
      // l'anneau de glyphes intérieur tourne, et uniquement pendant l'activation (logique interne à
      // StargatePortal, piloté par `stargate.isActivating`).
      obj.position.y = 0;
    } else {
      obj.position.y = bobAmplitude + Math.sin(state.clock.elapsedTime * 2 + x * 3 + z * 3) * 0.06;
    }
    if (spinning) obj.rotation.y += isQuest ? 0.006 : 0.01;
  });
  // Orientation du PNJ/Dragon errant selon sa direction de marche courante (voir FACING_ANGLE,
  // même mapping que SynkVoxel) — appliquée une fois par changement de direction (pas d'animation
  // de rotation continue), remplace l'ancien spin permanent pour ces deux kinds.
  const facingAngle = facing ? (FACING_ANGLE[facing] ?? 0) : 0;
  const color = MARKER_COLOR[kind] ?? '#94a3b8';
  if (isBuilding) {
    // Bâtisse (Auberge/Taverne/Étable/Village) — même silhouette de chaumière que le décor
    // `PropBlock` kind==='hut' (toit de chaume conique + cheminée), fixe au sol comme un vrai
    // bâtiment. Palette légèrement adaptée pour distinguer les sous-types (village ennemi = teintes
    // grisâtres/délabrées, taverne = tonneau, étable = clôture basse).
    const isEnemyVillage = poiType === 'village_enemy';
    const wallColor = isEnemyVillage ? '#57534e' : poiType === 'tavern' ? '#8a6a45' : poiType === 'stable' ? '#7c6a4a' : '#a8825a';
    const roofColor = isEnemyVillage ? '#3f3a3a' : '#3f2c1a';
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={wallColor} roughness={0.85} /></mesh>
        <mesh position={[0, 1.25, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.85, 0.7, 4]} /><meshStandardMaterial color={roofColor} roughness={0.9} /></mesh>
        <mesh position={[0.32, 1.55, 0.1]}><cylinderGeometry args={[0.08, 0.09, 0.4, 6]} /><meshStandardMaterial color="#78716c" roughness={0.9} /></mesh>
        {poiType === 'tavern' && (
          <mesh position={[0.78, 0.28, 0]} castShadow><cylinderGeometry args={[0.18, 0.18, 0.4, 8]} /><meshStandardMaterial color="#8a5a2a" roughness={0.8} /></mesh>
        )}
        {poiType === 'stable' && (
          <mesh position={[-0.78, 0.35, 0]} castShadow><boxGeometry args={[0.5, 0.06, 0.9]} /><meshStandardMaterial color="#6b4a2a" roughness={0.9} /></mesh>
        )}
      </group>
    );
  }
  if (isCave) {
    // Entrée de grotte (Nether-Cristal) : arche rocheuse + bouche sombre + cristaux lumineux violets
    // en saillie — remplace le gemme octaédrique générique pour un décor immédiatement identifiable.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.68, 0.8, 1, 8, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#5b5750" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.42, 0.05]}>
          <cylinderGeometry args={[0.42, 0.5, 0.85, 8, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#0b0810" roughness={1} side={THREE.DoubleSide} />
        </mesh>
        {[[-0.55, 0.55, -0.1], [0.5, 0.75, 0.15], [-0.2, 1.05, -0.2]].map(([cx, cy, cz], i) => (
          <mesh key={i} position={[cx, cy, cz]} rotation={[0.3 * i, 0.5 * i, 0]} castShadow>
            <coneGeometry args={[0.09, 0.32, 5]} />
            <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.7} roughness={0.3} />
          </mesh>
        ))}
      </group>
    );
  }
  if (isCemetery) {
    // Cimetière (voir demande utilisateur « ajoutes et places 2 cimetières en 3D ») — simple repère
    // visuel/narratif (comme un village) : enclos bas en pierre + quelques pierres tombales en
    // formation, SANS porte de souterrain (contrairement à `isCrypt` ci-dessous).
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {/* Muret d'enceinte bas (4 côtés) */}
        {[[0, 0.18, 0.9, [1.9, 0.36, 0.14]], [0, 0.18, -0.9, [1.9, 0.36, 0.14]], [0.9, 0.18, 0, [0.14, 0.36, 1.9]], [-0.9, 0.18, 0, [0.14, 0.36, 1.9]]].map(([px, py, pz, size], i) => (
          <mesh key={i} position={[px as number, py as number, pz as number]} castShadow>
            <boxGeometry args={size as unknown as [number, number, number]} />
            <meshStandardMaterial color="#6b6358" roughness={0.95} />
          </mesh>
        ))}
        {/* Pierres tombales agrandies (~1.35x, voir demande utilisateur « agrandisses un peu plus
            les tombes et pierre tombales dans le cimetière ») + croix au-dessus de chacune (voir
            demande utilisateur « ajoutes une croix au dessus de la pierre tombale »). */}
        {[[-0.4, -0.3], [0.25, -0.1], [-0.1, 0.45], [0.5, 0.4]].map(([cx, cz], i) => (
          <group key={i} position={[cx, 0, cz]}>
            <mesh position={[0, 0.27, 0]} castShadow><boxGeometry args={[0.3, 0.54, 0.09]} /><meshStandardMaterial color="#8d887c" roughness={0.9} /></mesh>
            <mesh position={[0, 0.44, 0.07]} castShadow><boxGeometry args={[0.4, 0.09, 0.04]} /><meshStandardMaterial color="#8d887c" roughness={0.9} /></mesh>
            <mesh position={[0, 0.66, 0]} castShadow><boxGeometry args={[0.05, 0.24, 0.05]} /><meshStandardMaterial color="#b9b4a7" roughness={0.85} /></mesh>
            <mesh position={[0, 0.72, 0]} castShadow><boxGeometry args={[0.18, 0.05, 0.05]} /><meshStandardMaterial color="#b9b4a7" roughness={0.85} /></mesh>
          </group>
        ))}
      </group>
    );
  }
  if (isCrypt) {
    // Crypte (voir demande utilisateur « Tu placeras à l'ouverture de la cryptes, une porte qui
    // amenera Synk à des passages secrets dans des tunnels/souterrains ») — mausolée en pierre avec
    // une arche sombre (la "porte") : cliquer ouvre PoiInteractionModal::CryptBody, dont le bouton
    // « Entrer dans la crypte » déclenche `cryptMode` (voir plus bas dans ce fichier) qui monte
    // `CryptTunnelScene` à la place de `Scene` dans le même `<Canvas>`.
    // Agrandie ~1.3x (voir demande utilisateur « agrandisses la crypte qui me semble trop petite »)
    // + croix ajoutée au sommet du fronton (voir demande utilisateur « ajoutes une croix pour
    // rendre plus crédible la crypte »), en plus du crâne décoratif déjà présent (conservé).
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.72, 0]} castShadow><boxGeometry args={[1.43, 1.43, 1.3]} /><meshStandardMaterial color="#58544c" roughness={0.9} /></mesh>
        <mesh position={[0, 1.59, 0]} castShadow><boxGeometry args={[1.69, 0.29, 1.56]} /><meshStandardMaterial color="#3f3b35" roughness={0.9} /></mesh>
        {/* Arche sombre (porte d'entrée du souterrain) */}
        <mesh position={[0, 0.55, 0.66]}>
          <cylinderGeometry args={[0.42, 0.42, 0.94, 10, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#0a0908" roughness={1} side={THREE.DoubleSide} />
        </mesh>
        {/* Colonnes latérales */}
        {[-0.65, 0.65].map((cx, i) => (
          <mesh key={i} position={[cx, 0.72, 0.65]} castShadow><cylinderGeometry args={[0.13, 0.16, 1.43, 8]} /><meshStandardMaterial color="#6b655a" roughness={0.9} /></mesh>
        ))}
        {/* Crâne gravé au fronton (purement décoratif) */}
        <mesh position={[0, 1.43, 0.73]}><sphereGeometry args={[0.17, 8, 8]} /><meshStandardMaterial color="#d6d3cb" roughness={0.8} /></mesh>
        {/* Croix sommitale */}
        <mesh position={[0, 1.95, 0]} castShadow><boxGeometry args={[0.08, 0.42, 0.08]} /><meshStandardMaterial color="#3f3b35" roughness={0.85} /></mesh>
        <mesh position={[0, 2.08, 0]} castShadow><boxGeometry args={[0.3, 0.08, 0.08]} /><meshStandardMaterial color="#3f3b35" roughness={0.85} /></mesh>
      </group>
    );
  }
  if (isTomb) {
    // Tombe isolée (voir demande utilisateur « et de tombes [...] dispersées dans le jeu [...] Tu
    // feras sortir des monstres [...] des tombes en simulant une dalle en 3D qui bouge et se
    // soulève à côté de sa pierre tombale ») — pierre tombale + dalle au sol qui se soulève/pivote
    // UNE SEULE FOIS au montage (animation locale simplifiée, voir TombSlab ci-dessous), suggérant
    // l'émergence du mort-vivant ancré sur cette tombe (voir lib/roamingActors.ts::
    // ensureWildlifeSpawns, seedé sur DEFAULT_TOMB_POIS). Pierre tombale agrandie ~1.35x et croix
    // ajoutée au sommet, même traitement que les pierres tombales du cimetière (voir isCemetery
    // ci-dessus), pour une cohérence visuelle entre tombes isolées et tombes groupées.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.22, 0.25]} castShadow><boxGeometry args={[0.14, 0.43, 0.05]} /><meshStandardMaterial color="#8d887c" roughness={0.9} /></mesh>
        <mesh position={[0, 0.41, -0.1]} castShadow><cylinderGeometry args={[0.32, 0.35, 0.68, 8, 1, false, 0, Math.PI]} /><meshStandardMaterial color="#9c968a" roughness={0.9} side={THREE.DoubleSide} /></mesh>
        <mesh position={[0, 0.78, -0.1]} castShadow><boxGeometry args={[0.06, 0.26, 0.06]} /><meshStandardMaterial color="#9c968a" roughness={0.85} /></mesh>
        <mesh position={[0, 0.85, -0.1]} castShadow><boxGeometry args={[0.21, 0.06, 0.06]} /><meshStandardMaterial color="#9c968a" roughness={0.85} /></mesh>
        <TombSlab markerId={markerId} />
        <mesh position={[0, 0.02, -0.1]}><cylinderGeometry args={[0.32, 0.36, 0.05, 10]} /><meshStandardMaterial color="#3f3a30" roughness={1} /></mesh>
      </group>
    );
  }
  if (isQuest) {
    // Parchemin roulé flottant (quêtes classiques/PNJ/énigmes) : cylindre papier + liseré + un ruban
    // — remplace le gemme octaédrique générique par une forme reconnaissable de rouleau de quête.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow><cylinderGeometry args={[0.13, 0.13, 0.34, 12]} /><meshStandardMaterial color="#e8d9ad" roughness={0.85} /></mesh>
          <mesh position={[0, 0.17, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12]} /><meshStandardMaterial color="#8a6a45" roughness={0.7} /></mesh>
          <mesh position={[0, -0.17, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12]} /><meshStandardMaterial color="#8a6a45" roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.135]}><boxGeometry args={[0.03, 0.4, 0.01]} /><meshStandardMaterial color={color} /></mesh>
        </group>
      </group>
    );
  }
  if (isFamiliar) {
    // Dragon-familier (tout le catalogue de familiers du jeu est composé de dragons de couleurs
    // variées) — voir `DragonMarker`/`familiarDragonColor` ci-dessus. Corrige la demande utilisateur
    // « le Dragon Vert ressemble à un anneau alors qu'il devrait ressembler à un Dragon ». `scale`
    // (voir Platform3DObjectFlags['marker:familiar'], défaut 2.4) n'agrandit QUE le dragon, jamais
    // le socle — un familier doit rester nettement plus grand que Synk (chevauchable). `walking`
    // déclenche l'articulation des pattes (voir DragonMarker) au lieu de rester figé.
    // ⚠️ Offset de rotation DÉDIÉ (`facingAngle - Math.PI/2`, au lieu de `facingAngle` seul comme
    // pour Synk/NpcVoxel juste en dessous) : `FACING_ANGLE` suppose un modèle dont le "visage" (0°)
    // regarde +Z au repos (convention Synk/PNJ, voir yeux z>0 dans NpcVoxel/SynkVoxel), alors que
    // `DragonMarker` est construit tête vers +X (voir son groupe cou/tête `position={[0.22,...]}`)
    // et queue vers -X. Sans cet offset de -90°, le corps du dragon restait tourné à 90° de sa
    // direction de marche réelle — il semblait "glisser" de côté (crabe) au lieu d'avancer tête la
    // première, et les pattes (qui articulent l'axe local X = avant/arrière du modèle) donnaient
    // l'impression de piétiner dans la mauvaise direction pour la même raison (demande utilisateur
    // « leur corps [doit] se déplacer dans le sens de la direction qu'ils prennent et non pas
    // glisser [...] leurs jambes doivent aller dans le sens de la direction »). Dérivation complète
    // en commentaire de code (voir historique) : si le monde attend un vecteur "face" égal à
    // (sin θ, 0, cos θ) pour θ=FACING_ANGLE[direction] (convention +Z), et que le modèle a pour
    // "face" locale +X, appliquer une rotation Y de φ=θ-π/2 au lieu de θ aligne exactement les deux.
    const dragonColor = familiarDragonColor(markerId ?? '', name ?? '');
    const dragonRotationY = facingAngle - Math.PI / 2;
    return (
      <group ref={posGroupRef} position={isLiveActor ? undefined : [x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef} scale={scale} rotation={[0, dragonRotationY, 0]}><DragonMarker color={dragonColor} walking={!!moving} seed={markerId ?? name ?? ''} fireBreathEnabled={fireBreathEnabled} fireBreathIntervalSec={fireBreathIntervalSec} /></group>
      </group>
    );
  }
  if (isNpc) {
    // PNJ en voxels façon Minecraft (voir NpcVoxel/npcAppearance ci-dessus) — remplace la précédente
    // silhouette encapuchonnée générique. `scale` (voir Platform3DObjectFlags['marker:npc'], défaut
    // 1 depuis la correction « PNJ de la taille de Synk ») n'agrandit QUE le PNJ, jamais le socle.
    // `rotation`/`walking` : voir isFamiliar ci-dessus.
    const appearance = npcAppearance(markerId ?? '', name ?? '');
    return (
      <group ref={posGroupRef} position={isLiveActor ? undefined : [x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef} scale={scale} rotation={[0, facingAngle, 0]}><NpcVoxel appearance={appearance} walking={!!moving} /></group>
      </group>
    );
  }
  if (isWildlife) {
    // Hibou/loup-garou/sanglier/mort-vivant errant — voir isWildlife/wildlifeKind plus haut.
    // `markerId` est directement l'id d'errance (voir lib/roamingActors.ts::ensureWildlifeSpawns,
    // préfixe stable `owl-`/`werewolf-`/`boar-`/`zombie-`/`ghoul-`/`skeleton-`), pas besoin d'une
    // identité catalogue distincte pour choisir le bon modèle 3D. `Owl3D`/`Werewolf3D`/`Boar3D`/
    // `Zombie3D`/`Ghoul3D`/`Skeleton3D` (voir Platform3DAmbientScene.tsx) n'ont plus de position
    // interne fixe depuis leur conversion en entités mapmonde : ce groupe (position/orientation
    // gérées comme tout PNJ/familier errant ci-dessus) est désormais leur SEULE source de placement.
    return (
      <group ref={posGroupRef} position={isLiveActor ? undefined : [x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef} scale={scale} rotation={[0, facingAngle, 0]}>
          {wildlifeKind === 'owl'
            ? <Owl3D adminAudio={wildlifeAudio ?? DEFAULT_AUDIO_SETTINGS} soundEnabled={owlHootEnabled !== false} seedKey={markerId} moving={!!moving} />
            : wildlifeKind === 'werewolf'
            ? <Werewolf3D adminAudio={wildlifeAudio ?? DEFAULT_AUDIO_SETTINGS} soundEnabled={werewolfHowlEnabled !== false} seedKey={markerId} moving={!!moving} />
            : wildlifeKind === 'zombie'
            ? <Zombie3D seedKey={markerId} moving={!!moving} />
            : wildlifeKind === 'ghoul'
            ? <Ghoul3D seedKey={markerId} moving={!!moving} />
            : wildlifeKind === 'skeleton'
            ? <Skeleton3D seedKey={markerId} moving={!!moving} />
            : <Boar3D adminAudio={wildlifeAudio ?? DEFAULT_AUDIO_SETTINGS} seedKey={markerId} moving={!!moving} />}
        </group>
      </group>
    );
  }
  if (isTreasure || isDrop) {
    // Trésor OU objet déposé par un joueur (voir isDrop ci-dessus) : forme réaliste dédiée à sa
    // catégorie (épée/bouclier/armure/potion/grimoire/bottes/champignon/pomme/œuf de dragon/etc.,
    // voir `treasureCategory`/`TreasureIcon` ci-dessus) au lieu du coffre générique unique pour
    // absolument tout le catalogue.
    const category = treasureCategory(markerId ?? '', name ?? '');
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef}><TreasureIcon category={category} /></group>
      </group>
    );
  }
  if (isWorld) {
    // Porte des étoiles verticale (voir StargatePortal plus haut) — portail flottant et isolé (pas
    // posé sur une dalle), désormais STATIQUE hors activation (voir isWorld dans le useFrame
    // ci-dessus, qui n'applique plus ni flottaison ni spin continu).
    return (
      <group position={[x, 0, z]}>
        <group ref={bobRef}>
          <StargatePortal
            radius={STARGATE_RING_RADIUS} color="#b5712b"
            isActivating={stargate?.isActivating} activationStartedAt={stargate?.activationStartedAt}
            activationDurationMs={stargate?.activationDurationMs}
            onConsoleClick={stargate?.onConsoleClick ?? (() => {})}
            onActivationComplete={stargate?.onActivationComplete ?? (() => {})}
          />
        </group>
      </group>
    );
  }
  if (isZorghon) {
    // Silhouette sombre et cornue, menaçante — boss narratif unique (voir ZorghonEncounterState).
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef}>
          <mesh castShadow><cylinderGeometry args={[0.16, 0.24, 0.5, 8]} /><meshStandardMaterial color="#1f1b24" roughness={0.7} /></mesh>
          <mesh position={[0, 0.32, 0]} castShadow><sphereGeometry args={[0.16, 10, 8]} /><meshStandardMaterial color="#2e2436" roughness={0.6} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.08, 0.44, 0]} rotation={[0, 0, s * 0.3]} castShadow><coneGeometry args={[0.035, 0.18, 4]} /><meshStandardMaterial color="#7f1d1d" /></mesh>
          ))}
          <mesh position={[0, 0.32, 0.15]}><sphereGeometry args={[0.03, 6, 6]} /><meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} /></mesh>
        </group>
      </group>
    );
  }
  if (isCaptive) {
    // Silhouette liée (captif·ve à délivrer) — corps assis + tête + lien de corde autour du torse.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <group ref={bobRef}>
          <mesh position={[0, -0.1, 0]} castShadow><cylinderGeometry args={[0.15, 0.18, 0.3, 8]} /><meshStandardMaterial color="#94a3b8" roughness={0.8} /></mesh>
          <mesh position={[0, 0.14, 0]} castShadow><sphereGeometry args={[0.13, 10, 8]} /><meshStandardMaterial color="#e8c39e" /></mesh>
          <mesh position={[0, 0.02, 0]}><torusGeometry args={[0.17, 0.02, 6, 12]} /><meshStandardMaterial color="#7c6a4a" /></mesh>
        </group>
      </group>
    );
  }
  return (
    <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <group ref={bobRef}>
        <mesh>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

/** Synk en voxels (façon Minecraft), version détaillée : tête (yeux, nez, bouche, oreilles,
 * cheveux/casque), torse (armure), 2 bras articulés (mains), 2 jambes articulées (chausses/bottes)
 * qui se balancent naturellement en marche/course (contre-mouvement bras/jambes opposés, même
 * principe que SynkSkin.tsx::PART_ANIM), et l'équipement RÉELLEMENT porté par le joueur (voir
 * EquipmentWidget.tsx/EquipSlot) rendu en 3D sur le modèle : épée/arc dans le dos, flèches en
 * carquois, bouclier, casque/bonnet, amulette, ceinture, chausses, bottes, gants. Teinte selon le
 * stade (`STAGE_COLOR_3D`). S'enfonce partiellement et flotte (`swimming`) sur une dalle d'eau (avec
 * un battement de nage bras/jambes dédié), et effectue un petit saut arqué (`jumpTrigger`,
 * incrémenté à chaque franchissement de montagne barre Espace maintenue) — en cohérence visuelle
 * avec la mécanique Oxygène/Fatigue déjà pilotée par GameCanvas2D.tsx (celui-ci reste l'unique
 * moteur de décroissance/récupération — ce composant n'est qu'une vue supplémentaire, aucune
 * nouvelle mécanique n'est introduite ici, zéro risque de double-décompte). */
export function SynkVoxel({ stage, walking, running, swimming, jumpTrigger, facing, equipment, equipmentRenderEnabled, standY, fullySubmerged, eyeBlinkEnabled, eyeBlinkIntervalSec, recentering, onRecenterComplete }: {
  stage: number; walking: boolean; running: boolean; swimming: boolean; jumpTrigger: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean;
  standY?: number; fullySubmerged?: boolean; eyeBlinkEnabled?: boolean; eyeBlinkIntervalSec?: number;
  /** Boussole & recentrage — voir RepRules.platform3dCompassIdleRecenterSec et le composant parent
   * (bouton « Nord » / minuterie d'inactivité). Quand `recentering` est vrai, la rotation Y du
   * modèle est interpolée en douceur vers le Nord au lieu de suivre instantanément `facing` (voir
   * useFrame ci-dessous) ; `onRecenterComplete` est appelé une seule fois la cible atteinte, pour
   * que le composant parent fixe `facing='up'` (cohérent avec l'angle visuel final) et coupe
   * `recentering`. Optionnels : `undefined`/`false` reproduit exactement le comportement historique
   * (rotation instantanée liée à `facing`), utilisé tel quel par `UnderwaterScene` sans changement. */
  recentering?: boolean; onRecenterComplete?: () => void;
}) {
  const bobRef = useRef<THREE.Group>(null);
  const jumpRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const jumpStartRef = useRef<number | null>(null);
  // ─── Clignement des yeux (voir RepRules.synkEyeBlinkEnabled/synkEyeBlinkIntervalSec, réglable
  // dans Administration > Barème & règles > "🧝 Paramétrage de Synk") — anime en douceur l'échelle
  // verticale des deux groupes "œil" (boîte + bille blanche/pupille) pour simuler une paupière qui
  // se ferme puis se rouvre, à un intervalle MOYEN paramétrable, volontairement randomisé (+/-30%)
  // à chaque cycle pour éviter un clignotement mécanique/parfaitement périodique. Purement visuel,
  // aucun état de jeu/mécanique associé (zéro risque de régression sur combat/stats/usure). */
  const leftEyeRef = useRef<THREE.Group>(null);
  const rightEyeRef = useRef<THREE.Group>(null);
  const blinkStateRef = useRef({ nextBlinkAt: 0, blinking: false, blinkStart: 0 });
  const groundRef = useRef<THREE.Group>(null);
  const groundYRef = useRef((standY ?? 0) + SYNK_GROUND_OFFSET);
  // ─── Rotation Y du modèle — voir `recentering`/`onRecenterComplete` ci-dessus. `rotYRef` porte
  // l'angle COURANT réellement appliqué (piloté à 100% par useFrame ci-dessous désormais, plus par
  // la prop JSX `rotation` — évite tout conflit entre une ré-application déclarative instantanée de
  // `facing` et une interpolation impérative en cours) ; `recenterDoneRef` évite d'appeler
  // `onRecenterComplete` à répétition tant que le parent n'a pas repassé `recentering` à `false`.
  const rotYRef = useRef(FACING_ANGLE[facing] ?? 0);
  const recenterDoneRef = useRef(false);
  useEffect(() => { if (jumpTrigger > 0) jumpStartRef.current = Date.now(); }, [jumpTrigger]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const cadence = running ? 14 : 8;
    // Suivi lissé du relief : Synk s'élève/descend en douceur vers la hauteur de la dalle courante
    // (`standY`, voir tileStandTopY) + le décalage sol constant, ou s'immerge (mi-torse en nage,
    // davantage si totalement plongé dans le monde sous-marin) — corrige le bug « jambes/pieds
    // invisibles » ET permet de tenir debout/marcher sur un bloc de montagne escaladé.
    if (groundRef.current) {
      const base = standY ?? 0;
      const target = fullySubmerged ? base - 1.3 : swimming ? base - 0.45 : base + SYNK_GROUND_OFFSET;
      groundYRef.current += (target - groundYRef.current) * 0.16;
      groundRef.current.position.y = groundYRef.current;
    }
    // ─── Rotation Y — voir `recentering`/`onRecenterComplete` ci-dessus. Comportement historique
    // inchangé (rotation instantanée = FACING_ANGLE[facing]) tant que `recentering` n'est pas actif ;
    // sinon interpolation en douceur vers le Nord (FACING_ANGLE.up) par le plus court chemin
    // angulaire (évite tout survol > 180°), puis notification unique au parent à l'arrivée.
    {
      const targetAngle = recentering ? FACING_ANGLE.up : (FACING_ANGLE[facing] ?? 0);
      if (recentering) {
        let diff = (targetAngle - rotYRef.current + Math.PI) % (Math.PI * 2) - Math.PI;
        if (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.01) {
          rotYRef.current = targetAngle;
          if (!recenterDoneRef.current) { recenterDoneRef.current = true; onRecenterComplete?.(); }
        } else {
          rotYRef.current += diff * Math.min(1, delta * 5);
        }
      } else {
        recenterDoneRef.current = false;
        rotYRef.current = targetAngle;
      }
      if (groundRef.current) groundRef.current.rotation.y = rotYRef.current;
    }
    if (bobRef.current) {
      if (walking && !swimming) bobRef.current.position.y = Math.abs(Math.sin(t * cadence)) * (running ? 0.11 : 0.08);
      else if (swimming) bobRef.current.position.y = Math.sin(t * 3) * 0.05;
      else bobRef.current.position.y = 0;
    }
    // Balancement contro-latéral bras/jambes — marche/course sur la terre, battement de nage sur l'eau.
    let legSwing = 0, armSwing = 0;
    if (swimming) { legSwing = Math.sin(t * 4) * 0.4; armSwing = Math.sin(t * 4) * -0.35; }
    else if (walking) { legSwing = Math.sin(t * cadence) * (running ? 0.85 : 0.55); armSwing = -legSwing * 0.7; }
    if (leftLegRef.current) leftLegRef.current.rotation.x = legSwing;
    if (rightLegRef.current) rightLegRef.current.rotation.x = -legSwing;
    if (leftArmRef.current) leftArmRef.current.rotation.x = -armSwing;
    if (rightArmRef.current) rightArmRef.current.rotation.x = armSwing;
    // Saut arqué (franchissement de montagne, voir RepRules.platform3dJumpEnabled) — arc simple
    // borné dans le temps (380ms), déclenché par l'incrément de `jumpTrigger`, jamais en boucle.
    if (jumpRef.current) {
      const start = jumpStartRef.current;
      if (start != null) {
        const elapsed = Date.now() - start, dur = 380;
        if (elapsed < dur) jumpRef.current.position.y = Math.sin((elapsed / dur) * Math.PI) * 0.42;
        else { jumpRef.current.position.y = 0; jumpStartRef.current = null; }
      } else jumpRef.current.position.y = 0;
    }
    // ─── Clignement des yeux ───────────────────────────────────────────────────────────────────
    if (!eyeBlinkEnabled) {
      if (leftEyeRef.current) leftEyeRef.current.scale.y = 1;
      if (rightEyeRef.current) rightEyeRef.current.scale.y = 1;
    } else {
      const now = t;
      const st = blinkStateRef.current;
      const avgInterval = Math.max(0.5, eyeBlinkIntervalSec ?? 4);
      if (st.nextBlinkAt === 0) st.nextBlinkAt = now + avgInterval * (0.7 + Math.random() * 0.6);
      if (!st.blinking && now >= st.nextBlinkAt) { st.blinking = true; st.blinkStart = now; }
      let scaleY = 1;
      if (st.blinking) {
        const elapsed = now - st.blinkStart;
        const dur = 0.22; // durée totale d'un clignement (fermeture + réouverture), en secondes
        if (elapsed >= dur) {
          st.blinking = false;
          st.nextBlinkAt = now + avgInterval * (0.7 + Math.random() * 0.6);
        } else {
          const half = dur / 2;
          scaleY = elapsed < half ? 1 - (elapsed / half) : (elapsed - half) / half;
        }
      }
      scaleY = Math.max(0.05, Math.min(1, scaleY));
      if (leftEyeRef.current) leftEyeRef.current.scale.y = scaleY;
      if (rightEyeRef.current) rightEyeRef.current.scale.y = scaleY;
    }
  });

  const color = STAGE_COLOR_3D[STAGE_NAMES[stage] || 'egg'] ?? '#22823a';
  const eq = equipmentRenderEnabled ? equipment : {};
  const weapon = eq.weapon, offhand = eq.offhand, arrows = eq.arrows, head = eq.head;
  const amulet = eq.amulet, legsEq = eq.legs, feetEq = eq.feet, belt = eq.belt, handsEq = eq.hands;
  const rarityColor = (it?: EquippedItem) => RARITY_COLOR_3D[it?.rarity ?? 'common'] ?? '#9ca3af';
  const skin = '#f2c99d', hairColor = '#3b2412', pantsDefault = '#334155', bootDefault = '#5b3a1e';

  return (
    // Rotation Y désormais 100% impérative (voir rotYRef/useFrame ci-dessus) : NE PAS ré-ajouter de
    // prop `rotation` déclarative ici, elle écraserait l'interpolation de recentrage à chaque rendu.
    <group ref={groundRef}>
      <group ref={jumpRef}>
      <group ref={bobRef}>
        {/* ─── Tête : visage (yeux/nez/bouche/oreilles) + cheveux OU casque si équipé ─── */}
        <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[0.42, 0.42, 0.42]} /><meshStandardMaterial color={skin} /></mesh>
        <group ref={leftEyeRef} position={[-0.09, 0.65, 0.2]}>
          <mesh><boxGeometry args={[0.07, 0.07, 0.03]} /><meshStandardMaterial color="#1e293b" /></mesh>
          <mesh position={[0, 0, 0.022]}><sphereGeometry args={[0.02, 8, 8]} /><meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={0.3} /></mesh>
        </group>
        <group ref={rightEyeRef} position={[0.09, 0.65, 0.2]}>
          <mesh><boxGeometry args={[0.07, 0.07, 0.03]} /><meshStandardMaterial color="#1e293b" /></mesh>
          <mesh position={[0, 0, 0.022]}><sphereGeometry args={[0.02, 8, 8]} /><meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={0.3} /></mesh>
        </group>
        <mesh position={[0, 0.6, 0.22]}><boxGeometry args={[0.07, 0.06, 0.05]} /><meshStandardMaterial color={skin} /></mesh>
        <mesh position={[0, 0.52, 0.2]}><boxGeometry args={[0.14, 0.035, 0.04]} /><meshStandardMaterial color="#7f2d3a" /></mesh>
        <mesh position={[-0.23, 0.6, 0]} castShadow><boxGeometry args={[0.06, 0.13, 0.13]} /><meshStandardMaterial color={skin} /></mesh>
        <mesh position={[0.23, 0.6, 0]} castShadow><boxGeometry args={[0.06, 0.13, 0.13]} /><meshStandardMaterial color={skin} /></mesh>
        {head ? (
          // Casque : dôme métallique + cerclage/nasal — la couleur de rareté ne teinte plus que le
          // cerclage (accent), le dôme reste acier neutre pour un rendu casque réaliste (corrige le
          // rendu précédent en simple « couvercle » plat pouvant apparaître comme un losange).
          <group position={[0, 0.82, -0.01]}>
            <mesh castShadow>
              <sphereGeometry args={[0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#9aa0a6" metalness={0.7} roughness={0.35} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
              <torusGeometry args={[0.235, 0.028, 8, 16]} />
              <meshStandardMaterial color={rarityColor(head)} metalness={0.6} roughness={0.3} emissive={rarityColor(head)} emissiveIntensity={0.15} />
            </mesh>
            <mesh position={[0, -0.05, 0.22]} castShadow>
              <boxGeometry args={[0.06, 0.14, 0.05]} />
              <meshStandardMaterial color="#9aa0a6" metalness={0.7} roughness={0.3} />
            </mesh>
          </group>
        ) : (
          <mesh position={[0, 0.8, -0.03]} castShadow><boxGeometry args={[0.44, 0.12, 0.44]} /><meshStandardMaterial color={hairColor} /></mesh>
        )}
        {/* ─── Torse (armure si équipée) + amulette + ceinture ─── */}
        <mesh position={[0, 0.2, 0]} castShadow><boxGeometry args={[0.36, 0.46, 0.26]} /><meshStandardMaterial color={color} /></mesh>
        {eq.body && (
          <mesh position={[0, 0.2, 0]} castShadow>
            <boxGeometry args={[0.4, 0.48, 0.29]} />
            <meshStandardMaterial color={rarityColor(eq.body)} metalness={0.55} roughness={0.35} transparent opacity={0.85} />
          </mesh>
        )}
        {amulet && (
          // Amulette : chaînette (anneau) + gemme facettée pendante — remplace la simple sphère
          // uniformément teintée (rendu « bille » peu réaliste).
          <group position={[0, 0.42, 0.14]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.045, 0.011, 6, 12]} />
              <meshStandardMaterial color="#c9a876" metalness={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.06, 0]}>
              <octahedronGeometry args={[0.04, 0]} />
              <meshStandardMaterial color={rarityColor(amulet)} emissive={rarityColor(amulet)} emissiveIntensity={0.6} metalness={0.3} roughness={0.2} />
            </mesh>
          </group>
        )}
        {belt && (
          <mesh position={[0, -0.04, 0]} castShadow><boxGeometry args={[0.38, 0.07, 0.29]} /><meshStandardMaterial color={rarityColor(belt)} metalness={0.4} /></mesh>
        )}
        {/* ─── Équipement dorsal : épée OU arc+carquois, bouclier ─── */}
        {weapon && !weapon.requiresArrow && (
          // Épée : pommeau + poignée (cuir) + garde (avec gemme d'accent rareté) + lame acier + pointe
          // — remplace la précédente lame unique (fin bloc) entièrement teintée par la rareté, qui
          // pouvait se lire comme une forme abstraite plutôt qu'une épée reconnaissable.
          <group position={[-0.06, 0.28, -0.17]} rotation={[0.15, 0, 0.55]}>
            <mesh position={[0, -0.28, 0]} castShadow><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#8a6a45" metalness={0.5} roughness={0.4} /></mesh>
            <mesh position={[0, -0.2, 0]} castShadow><cylinderGeometry args={[0.022, 0.022, 0.16, 8]} /><meshStandardMaterial color="#5b3a1e" roughness={0.8} /></mesh>
            <mesh position={[0, -0.11, 0]} castShadow><boxGeometry args={[0.2, 0.025, 0.03]} /><meshStandardMaterial color="#c7ccd1" metalness={0.75} roughness={0.25} /></mesh>
            <mesh position={[0, -0.11, 0.02]}><sphereGeometry args={[0.022, 8, 8]} /><meshStandardMaterial color={rarityColor(weapon)} emissive={rarityColor(weapon)} emissiveIntensity={0.6} /></mesh>
            <mesh position={[0, 0.1, 0]} castShadow><boxGeometry args={[0.05, 0.42, 0.013]} /><meshStandardMaterial color="#c7ccd1" metalness={0.85} roughness={0.2} /></mesh>
            <mesh position={[0, 0.35, 0]} castShadow><coneGeometry args={[0.027, 0.08, 4]} /><meshStandardMaterial color="#c7ccd1" metalness={0.85} roughness={0.2} /></mesh>
          </group>
        )}
        {weapon && weapon.requiresArrow && (
          // Arc : arc bois (teinte neutre, non tintée par la rareté) + corde tendue + gemme d'accent
          // sertie sur le riser central — corrige le rendu précédent en simple demi-tore uniformément
          // teinté par la rareté (pouvait apparaître comme un « donut » violet/or selon la rareté).
          <group position={[-0.06, 0.28, -0.17]} rotation={[0, 0, 0.55]}>
            <mesh castShadow>
              <torusGeometry args={[0.28, 0.018, 6, 12, Math.PI]} /><meshStandardMaterial color="#6b4423" roughness={0.75} />
            </mesh>
            <mesh><boxGeometry args={[0.56, 0.01, 0.008]} /><meshStandardMaterial color="#e5decf" /></mesh>
            <mesh position={[0, 0.28, 0]}><sphereGeometry args={[0.03, 8, 8]} /><meshStandardMaterial color={rarityColor(weapon)} emissive={rarityColor(weapon)} emissiveIntensity={0.6} /></mesh>
          </group>
        )}
        {arrows && (arrows.qty ?? 0) > 0 && (
          <group position={[0.1, 0.32, -0.18]} rotation={[0.2, 0, -0.1]}>
            <mesh castShadow><cylinderGeometry args={[0.07, 0.08, 0.32, 8]} /><meshStandardMaterial color="#6b4423" /></mesh>
            <mesh position={[0.02, 0.2, 0]}><boxGeometry args={[0.015, 0.22, 0.015]} /><meshStandardMaterial color="#c9a876" /></mesh>
            <mesh position={[-0.02, 0.19, 0.02]}><boxGeometry args={[0.015, 0.2, 0.015]} /><meshStandardMaterial color="#c9a876" /></mesh>
          </group>
        )}
        {offhand && (
          // Bouclier : disque bois/cuir + bordure métallique (accent rareté) + umbo central bombé —
          // remplace le précédent bloc plat rectangulaire pouvant se lire comme une forme abstraite.
          <group position={[0.14, 0.2, -0.17]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.15, 0.15, 0.03, 16]} /><meshStandardMaterial color="#7a5230" roughness={0.7} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.001]}>
              <torusGeometry args={[0.148, 0.014, 6, 16]} /><meshStandardMaterial color={rarityColor(offhand)} metalness={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0, 0.018]} castShadow>
              <sphereGeometry args={[0.045, 10, 8]} /><meshStandardMaterial color={rarityColor(offhand)} metalness={0.65} roughness={0.3} emissive={rarityColor(offhand)} emissiveIntensity={0.2} />
            </mesh>
          </group>
        )}
        {/* ─── Bras (pivot épaule) + mains ─── */}
        <group ref={leftArmRef} position={[-0.26, 0.4, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow><boxGeometry args={[0.12, 0.4, 0.12]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0, -0.42, 0]} castShadow><boxGeometry args={[0.13, 0.1, 0.13]} /><meshStandardMaterial color={handsEq ? rarityColor(handsEq) : skin} /></mesh>
        </group>
        <group ref={rightArmRef} position={[0.26, 0.4, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow><boxGeometry args={[0.12, 0.4, 0.12]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0, -0.42, 0]} castShadow><boxGeometry args={[0.13, 0.1, 0.13]} /><meshStandardMaterial color={handsEq ? rarityColor(handsEq) : skin} /></mesh>
        </group>
        {/* ─── Jambes (pivot hanche) : chausses + bottes, cachées en nage (immergées) ─── */}
        {!swimming && (
          <>
            <group ref={leftLegRef} position={[-0.11, -0.03, 0]}>
              <mesh position={[0, -0.15, 0]} castShadow><boxGeometry args={[0.14, 0.24, 0.14]} /><meshStandardMaterial color={legsEq ? rarityColor(legsEq) : pantsDefault} /></mesh>
              <mesh position={[0, -0.32, 0.02]} castShadow><boxGeometry args={[0.15, 0.12, 0.16]} /><meshStandardMaterial color={feetEq ? rarityColor(feetEq) : bootDefault} /></mesh>
            </group>
            <group ref={rightLegRef} position={[0.11, -0.03, 0]}>
              <mesh position={[0, -0.15, 0]} castShadow><boxGeometry args={[0.14, 0.24, 0.14]} /><meshStandardMaterial color={legsEq ? rarityColor(legsEq) : pantsDefault} /></mesh>
              <mesh position={[0, -0.32, 0.02]} castShadow><boxGeometry args={[0.15, 0.12, 0.16]} /><meshStandardMaterial color={feetEq ? rarityColor(feetEq) : bootDefault} /></mesh>
            </group>
          </>
        )}
      </group>
      </group>
    </group>
  );
}

interface SceneMarker {
  id: string; kind: string; x: number; z: number; marker: MapMarker;
  /** Renseignés UNIQUEMENT pour le PNJ/Dragon errant (voir lib/roamingActors.ts) — pilotent son
   * orientation et sa démarche animée dans MarkerBlock (voir facing/moving ci-dessous) ; `undefined`
   * pour tout marqueur catalogue statique (npc/familiar fixes, trésors, quêtes...), qui gardent leur
   * rendu idle inchangé — zéro régression sur l'affichage des entités non-errantes. */
  facing?: SynkDirection; moving?: boolean;
  /** Renseigné UNIQUEMENT pour un PNJ de rencontre PERSISTÉ (voir
   * lib/roamingActors.ts::ExtraRoamingActor.questId) — rend ce marqueur cliquable (voir
   * onExtraQuestClick) pour rouvrir un rappel de l'énigme, sans changer son apparence (reste rendu
   * en `kind:'npc'` via `marker`, jamais en `kind:'quest'`). */
  questId?: string;
  /** Texte de la quête elle-même (QuestDef.label/i18nKey — voir
   * lib/roamingActors.ts::ExtraRoamingActor.questLabel/questI18nKey), à ne PAS confondre avec
   * `marker.name`/`marker.i18nKey` qui restent le nom de l'ARCHÉTYPE PNJ (ex. "Faucheur
   * d'Automne") — corrige le bug remonté par l'utilisateur : le pop-up de rappel affichait le nom
   * du PNJ au lieu de la question posée. */
  questLabel?: string;
  questI18nKey?: string;
}

/** Réglages de la caméra d'orbite (voir <OrbitControls> dans Scene()) — repoussés (demande
 * utilisateur : « augmente encore le zoom [...] permet à Synk de lever la tête encore plus haut à
 * la verticale [...] pour voir le toit des grands édifices [...] et le ciel/les étoiles au-dessus
 * de sa tête ») bien au-delà des anciennes bornes (`minDistance=3, maxDistance=11,
 * maxPolarAngle=1.35`, ce dernier limitant la vue à ~77° depuis le zénith, donc jamais assez haute
 * pour dépasser l'horizontale) :
 * - `CAMERA_MIN_DISTANCE=1.3` (zoom avant plus proche) et `CAMERA_MAX_DISTANCE=20` (zoom arrière
 *   plus large) pour voir aussi bien de très près qu'un grand château dans son ensemble de loin
 *   (vérifié : à distance max, les tours et toits du château entier tiennent dans le cadre).
 * - Pivot de caméra (`CAMERA_TARGET`) relevé de `y=0.3` (bassin de Synk) à `y=0.85` (env. hauteur
 *   des yeux/de la tête de Synk, voir SynkVoxel/SYNK_GROUND_OFFSET) : « lever la tête » pour
 *   regarder le ciel part naturellement de la tête, pas des pieds.
 * - `CAMERA_MAX_POLAR_ANGLE=2.4` (≈137°, contre 1.35≈77° avant) est un PLAFOND ABSOLU — la limite
 *   RÉELLEMENT appliquée à chaque frame est recalculée dynamiquement par
 *   `OrbitCameraLookUpLimiter` ci-dessous en fonction de la distance de zoom courante, pour ne
 *   jamais laisser la caméra passer sous le sol (voir ce composant pour le détail du calcul) : plus
 *   on est zoomé PRÈS de Synk, plus on peut lever la tête loin au-delà de l'horizontale (jusqu'à
 *   ~128° à distance minimale) ; plus on est zoomé loin, plus l'inclinaison max se rapproche de
 *   l'horizontale (~92-95° à distance maximale) — combiné au champ de vision de la caméra (45°),
 *   cela suffit à voir le ciel/les étoiles et le sommet des grands édifices à toute distance de
 *   zoom, sans jamais faire passer la caméra sous les dalles de terrain. */
const CAMERA_TARGET: [number, number, number] = [0, 0.85, 0];
const CAMERA_MIN_DISTANCE = 1.3;
const CAMERA_MAX_DISTANCE = 20;
const CAMERA_MAX_POLAR_ANGLE = 2.4;
const CAMERA_GROUND_CLAMP_Y = 0.05;

/** Voir le commentaire des constantes `CAMERA_*` ci-dessus. Empêche la caméra d'orbite de passer
 * sous le sol (dalles de terrain `TerrainBlock`, boîtes 1×1×1 de y=-1 à y=0) quand l'utilisateur
 * incline la vue au-delà de l'horizontale (regarder vers le haut) : la formule sphérique standard
 * d'OrbitControls (`camera.y = target.y + distance·cos(angle)`) place mécaniquement la caméra SOUS
 * le sol dès que l'angle dépasse un certain seuil qui DÉPEND de la distance de zoom courante — plus
 * la distance est grande, plus tôt (en termes d'angle) ce seuil est franchi. Ce composant recalcule
 * donc, à CHAQUE frame, l'angle polaire maximal qui garde `camera.y >= CAMERA_GROUND_CLAMP_Y` pour
 * la distance courante (`acos((minY − target.y) / distance)`), et l'applique directement à
 * `controls.maxPolarAngle` — comme le clamp interne d'OrbitControls (three.js) réapplique cette
 * borne à chaque `update()`, la caméra ne peut alors JAMAIS transpercer le sol, quelle que soit la
 * combinaison zoom/inclinaison choisie par le joueur, sans aucun à-coup ni téléportation (contrairement
 * à un clamp brut de la position Y a posteriori, qui ferait s'effondrer la caméra visuellement tout
 * près du pivot à angle extrême). Monté APRÈS `<OrbitControls ref={controlsRef}>` dans l'arbre JSX
 * (même frame, sans dépendance d'ordre stricte : la borne s'applique dès la frame suivante). */
function OrbitCameraLookUpLimiter({
  controlsRef, target, minY = CAMERA_GROUND_CLAMP_Y, absoluteMax = CAMERA_MAX_POLAR_ANGLE,
}: {
  controlsRef: React.RefObject<{ maxPolarAngle: number } | null> | { current: any };
  target: [number, number, number]; minY?: number; absoluteMax?: number;
}) {
  useFrame(({ camera }) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const dx = camera.position.x - target[0];
    const dy = camera.position.y - target[1];
    const dz = camera.position.z - target[2];
    const distance = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const ratio = Math.max(-1, Math.min(1, (minY - target[1]) / distance));
    controls.maxPolarAngle = Math.min(absoluteMax, Math.acos(ratio));
  });
  return null;
}

/** Contenu 3D de la scène (terrain + Synk + entités) — composant séparé pour pouvoir utiliser
 * `useFrame`/les hooks R3F, qui exigent d'être montés SOUS `<Canvas>`. Le clic sur une tuile route
 * vers la même interaction qu'en Plateforme 2D isométrique selon son décor (portail décoratif →
 * pop-up "Monde", hutte décorative → pop-up de repos, sinon déplacement/approche classique) — voir
 * onPortalTileClick3D/onHutTileClick3D/onTileClick dans le composant parent. */
function Scene({
  centerCol, centerRow, poiPoints, sceneMarkers, stage, walking, running, swimming, jumpTrigger, facing,
  equipment, equipmentRenderEnabled, standY, onTileClick, onPortalTileClick, onHutTileClick, onMarkerClick,
  onExtraQuestClick,
  eyeBlinkEnabled, eyeBlinkIntervalSec, objectFlags, fireBreathEnabled, fireBreathIntervalSec,
  wildlifeAudio, owlHootEnabled, werewolfHowlEnabled, orbitControlsRef, recentering, onRecenterComplete,
  stargateActivation, onRequestStargateActivation, onCompleteStargateActivation,
}: {
  centerCol: number; centerRow: number;
  poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[];
  sceneMarkers: SceneMarker[];
  stage: number; walking: boolean; running: boolean; swimming: boolean; jumpTrigger: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean; standY: number;
  onTileClick: (wc: number, wr: number) => void;
  onPortalTileClick: (wc: number, wr: number) => void;
  onHutTileClick: (wc: number, wr: number) => void;
  onMarkerClick: (m: MapMarker) => void;
  /** Voir SceneMarker.questId — rouvre un rappel de l'énigme pour un fantôme de rencontre "quête"
   * (marqueur synthétique `kind:'quest'` construit ici à partir de `questId`, distinct de `marker`
   * qui reste `kind:'npc'` pour l'apparence). `questLabel`/`questI18nKey` (voir
   * SceneMarker.questLabel/questI18nKey) portent le texte de la quête elle-même — utilisés en
   * priorité sur `m.name`/`m.i18nKey` (nom de l'archétype PNJ) pour le titre du pop-up rouvert. */
  onExtraQuestClick: (m: MapMarker, questId: string, questLabel?: string, questI18nKey?: string) => void;
  eyeBlinkEnabled?: boolean; eyeBlinkIntervalSec?: number;
  /** Registre admin-paramétrable des tailles de décor (Administration > 🧱 Objets & décor 3D) — voir
   * Platform3DObjectFlags.scale ; `undefined` retombe sur DEFAULT_PLATFORM3D_OBJECT_FLAGS (scale 1). */
  objectFlags?: Record<Platform3DObjectKind, Platform3DObjectFlags>;
  /** Souffle de feu périodique des dragons-familiers (voir RepRules.dragonFireBreathEnabled/
   * dragonFireBreathIntervalSec, DragonMarker plus bas) — purement cosmétique. */
  fireBreathEnabled?: boolean; fireBreathIntervalSec?: number;
  /** Faune sauvage errante (hibou/loup-garou, voir MarkerBlock::isWildlife plus bas) — réglages
   * audio admin (voir lib/audio.ts::useAdminAudioSettings, appelé UNE FOIS dans le composant parent
   * non-R3F Platform3DWidget plutôt que dans chaque instance de MarkerBlock, pour éviter autant
   * d'abonnements redondants qu'il y a de marqueurs affichés) et flags de thème jour/nuit (voir
   * WorldThemeDef.elements.owlHootEnabled/werewolfHowlEnabled) qui gate UNIQUEMENT le cycle sonore
   * périodique (hululement/hurlement) — n'affecte JAMAIS la présence/le déplacement de la créature
   * elle-même (celle-ci est désormais une vraie entité mapmonde, visible quel que soit le thème). */
  wildlifeAudio?: Record<AudioSourceKey, AudioSourceSetting>;
  owlHootEnabled?: boolean; werewolfHowlEnabled?: boolean;
  /** Boussole & recentrage (voir composant parent non-R3F et SynkVoxel ci-dessus) — `orbitControlsRef`
   * est désormais créé et possédé par le composant PARENT (comme `cameraRef`/`CameraBridge`) afin que
   * le bouton « Nord » et la minuterie d'inactivité (tous deux hors `<Canvas>`) puissent appeler
   * `orbitControlsRef.current.setAzimuthalAngle(0)` — remplace l'ancien `useRef` local, sans changer
   * le fonctionnement interne d'OrbitCameraLookUpLimiter (toujours alimenté par la même ref). */
  orbitControlsRef: React.MutableRefObject<any>;
  recentering?: boolean; onRecenterComplete?: () => void;
  /** Porte des Étoiles — état d'activation EN COURS (au plus une seule à la fois dans tout le jeu,
   * voir requestStargateActivation/completeStargateActivation dans le composant parent non-R3F) et
   * les deux callbacks qui pilotent la console (voir StargatePortal/PropBlock::stargate/
   * MarkerBlock::stargate ci-dessus). `stargateActivation` vaut `null` tant qu'aucune console n'a
   * été cliquée avec succès (XP + objet requis validés) — chaque portail compare alors sa PROPRE clé
   * (`tile-{wc}-{wr}` ou `world-{markerId}`) à `stargateActivation.key` pour savoir s'il doit animer
   * son anneau de glyphes. */
  stargateActivation?: { key: string; startedAt: number; durationMs: number } | null;
  onRequestStargateActivation: (key: string, onComplete: () => void) => void;
  onCompleteStargateActivation: (key: string) => void;
}) {
  const tiles = useMemo(() => {
    const out: { tile: Tile; wc: number; wr: number; x: number; z: number }[] = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        // Coordonnées BRUTES (non bornées) : près d'un bord du mapmonde (0/100), `centerCol+dx`
        // ou `centerRow+dz` peut sortir de la plage — on ignore alors cette case au lieu de la
        // ramener (clamp) sur la dernière dalle valide, ce qui dupliquait sinon la même dalle/le
        // même décor (ex. un arbre) à plusieurs positions écran distinctes tout en le faisant
        // "glisser" au fil des déplacements de Synk près du bord (corrige le bug rapporté "les
        // arbres se mettent à se déplacer avec Synk" observé en bordure de carte).
        const rawWc = centerCol + dx, rawWr = centerRow + dz;
        if (rawWc < 0 || rawWc > WORLD_SIZE || rawWr < 0 || rawWr > WORLD_SIZE) continue;
        const wc = clamp100(rawWc), wr = clamp100(rawWr);
        out.push({ tile: worldTileAt(wc, wr, poiPoints), wc, wr, x: dx, z: dz });
      }
    }
    return out;
  }, [centerCol, centerRow, poiPoints]);

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 10, 4]} intensity={0.9} castShadow />
      {tiles.map(({ tile, wc, wr, x, z }) => {
        const onClick = tile.prop === 'portal' ? () => {} // 🌀 clic direct sur l'anneau désactivé — seule la console d'activation (voir StargatePortal) déclenche désormais le voyage
          : tile.prop === 'hut' ? () => onHutTileClick(wc, wr)
          : () => onTileClick(wc, wr);
        const portalKey = `tile-${wc}-${wr}`;
        const portalStargate = tile.prop === 'portal' ? {
          isActivating: stargateActivation?.key === portalKey,
          activationStartedAt: stargateActivation?.key === portalKey ? stargateActivation.startedAt : undefined,
          activationDurationMs: stargateActivation?.key === portalKey ? stargateActivation.durationMs : undefined,
          onConsoleClick: () => onRequestStargateActivation(portalKey, () => onPortalTileClick(wc, wr)),
          onActivationComplete: () => onCompleteStargateActivation(portalKey),
        } : undefined;
        return (
          <group key={`${wc}-${wr}`}>
            <TerrainBlock tile={tile} x={x} z={z} onClick={onClick} />
            {tile.prop && (
              <PropBlock
                kind={tile.prop} x={x} z={z}
                topY={tile.terrain === 'rock' ? Math.min(1.9, (tile.altitudeM ?? 300) / 2800) : 0}
                scale={(objectFlags ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS)[platform3dPropKind(tile.prop)]?.scale ?? 1}
                onClick={onClick}
                stargate={portalStargate}
              />

            )}
          </group>
        );
      })}
      {sceneMarkers.map(m => {
        const markerScaleKind: Platform3DObjectKind | null = m.kind === 'npc' ? 'marker:npc' : m.kind === 'familiar' ? 'marker:familiar' : null;
        const markerScale = markerScaleKind ? ((objectFlags ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS)[markerScaleKind]?.scale ?? 1) : 1;
        // Le PNJ "en approche" (voir lib/npcApproach.ts) OU un PNJ de rencontre PERSISTÉ (voir
        // lib/roamingActors.ts::ExtraRoamingActor, id préfixé `encounter.extra.`) est un marqueur
        // SYNTHÉTIQUE, absent du catalogue (`getAllMapMarkers`) — un clic dessus ne doit donc
        // jamais router vers onMarkerClick (qui suppose un vrai MapMarker catalogue), l'interaction
        // pour le premier se fait déjà dans le pop-up NpcEncounterPopup lui-même. Le second
        // (fantôme persisté) reste non-interactif SAUF si `questId` est renseigné (rencontre de
        // type "quête" acceptée) : dans ce cas, route vers onExtraQuestClick (rappel de l'énigme,
        // voir demande utilisateur) au lieu de rester muet.
        const isEncounterMarker = m.id === 'encounter.npc.live' || m.id.startsWith('encounter.extra.');
        const handleClick = m.questId
          ? () => onExtraQuestClick(m.marker, m.questId!, m.questLabel, m.questI18nKey)
          : isEncounterMarker ? () => {} : () => onMarkerClick(m.marker);
        // 🌀 Porte des étoiles (m.kind==='world') : le clic direct sur l'anneau ne déclenche plus
        // rien (voir StargatePortal) — seule sa console gère désormais l'activation, via la même
        // clé `world-{markerId}` que celle lue par `stargateActivation` ci-dessous.
        const worldPortalKey = `world-${m.marker.id}`;
        const worldStargate = m.kind === 'world' ? {
          isActivating: stargateActivation?.key === worldPortalKey,
          activationStartedAt: stargateActivation?.key === worldPortalKey ? stargateActivation.startedAt : undefined,
          activationDurationMs: stargateActivation?.key === worldPortalKey ? stargateActivation.durationMs : undefined,
          onConsoleClick: () => onRequestStargateActivation(worldPortalKey, () => onMarkerClick(m.marker)),
          onActivationComplete: () => onCompleteStargateActivation(worldPortalKey),
        } : undefined;
        return <MarkerBlock key={m.id} kind={m.kind} poiType={m.marker.poiType} name={m.marker.name} markerId={m.marker.id} x={m.x} z={m.z} scale={markerScale} facing={m.facing} moving={m.moving} onClick={m.kind === 'world' ? () => {} : handleClick} fireBreathEnabled={fireBreathEnabled} fireBreathIntervalSec={fireBreathIntervalSec} wildlifeAudio={wildlifeAudio} owlHootEnabled={owlHootEnabled} werewolfHowlEnabled={werewolfHowlEnabled} stargate={worldStargate} />;
      })}
      <SynkVoxel
        stage={stage} walking={walking} running={running} swimming={swimming} jumpTrigger={jumpTrigger}
        facing={facing} equipment={equipment} equipmentRenderEnabled={equipmentRenderEnabled} standY={standY}
        eyeBlinkEnabled={eyeBlinkEnabled} eyeBlinkIntervalSec={eyeBlinkIntervalSec}
        recentering={recentering} onRecenterComplete={onRecenterComplete}
      />
      <OrbitControls
        ref={orbitControlsRef}
        enablePan={false} enableDamping dampingFactor={0.12}
        minDistance={CAMERA_MIN_DISTANCE} maxDistance={CAMERA_MAX_DISTANCE}
        minPolarAngle={0.25} maxPolarAngle={CAMERA_MAX_POLAR_ANGLE}
        target={CAMERA_TARGET}
      />
      <OrbitCameraLookUpLimiter controlsRef={orbitControlsRef} target={CAMERA_TARGET} />
    </>
  );
}

/** Noms de créatures marines inspirées de Donjons & Dragons (voir demande utilisateur), affichés
 * dans la légende du monde sous-marin (voir overlay dans le composant parent) — registre purement
 * cosmétique, extensible librement sans toucher au reste du code. */
const SEA_MONSTER_NAMES = [
  'Anguille-Spectre des Abysses', 'Kraken Juvénile', 'Léviathan de Corail Noir',
  'Murène Runique', 'Requin-Dague d\'Obsidienne', 'Poulpe Ombrageux des Profondeurs',
];

/** Petit poisson décoratif nageant en orbite lissée autour du point de plongée — purement
 * cosmétique (voir RepRules.platform3dUnderwaterFishCount). */
function Fish({ seed }: { seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const radius = 1.3 + (seed % 5) * 0.55;
  const speed = 0.55 + (seed % 3) * 0.22;
  const yBase = -0.5 - (seed % 4) * 0.35;
  const color = ['#38bdf8', '#fbbf24', '#f472b6', '#34d399', '#a78bfa'][seed % 5];
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime * speed + seed * 7;
    ref.current.position.set(Math.cos(t) * radius, yBase + Math.sin(t * 2) * 0.15, Math.sin(t) * radius);
    ref.current.rotation.y = -t + Math.PI / 2;
  });
  return (
    <group ref={ref}>
      <mesh castShadow><coneGeometry args={[0.09, 0.28, 6]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0, 0, 0.16]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.07, 0.12, 4]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

/** Créature marine (voir SEA_MONSTER_NAMES) nageant plus lentement, plus large, plus profondément
 * que les poissons — silhouette générique (corps + museau + yeux luminescents), purement cosmétique
 * (voir RepRules.platform3dUnderwaterMonsterCount). */
function SeaMonster({ seed }: { seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const radius = 2.8 + (seed % 3) * 0.7;
  const speed = 0.16 + (seed % 2) * 0.07;
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime * speed + seed * 4;
    ref.current.position.set(Math.cos(t) * radius, -1.35 - (seed % 2) * 0.35, Math.sin(t) * radius);
    ref.current.rotation.y = -t + Math.PI / 2;
  });
  return (
    <group ref={ref}>
      <mesh castShadow><boxGeometry args={[0.5, 0.35, 0.9]} /><meshStandardMaterial color="#4c1d95" emissive="#4c1d95" emissiveIntensity={0.15} /></mesh>
      <mesh position={[0, 0, 0.55]}><coneGeometry args={[0.22, 0.4, 6]} /><meshStandardMaterial color="#4c1d95" /></mesh>
      <mesh position={[-0.14, 0.05, 0.62]}><sphereGeometry args={[0.05, 8, 8]} /><meshStandardMaterial color="#f87171" emissive="#f87171" emissiveIntensity={0.8} /></mesh>
      <mesh position={[0.14, 0.05, 0.62]}><sphereGeometry args={[0.05, 8, 8]} /><meshStandardMaterial color="#f87171" emissive="#f87171" emissiveIntensity={0.8} /></mesh>
    </group>
  );
}

/** Monde sous-marin (plongée totale, voir RepRules.platform3dUnderwaterWorldEnabled) — scène
 * décorative/exploratoire séparée de `Scene` (fond sableux, eau sombre brumeuse, poissons et
 * créatures marines générés procéduralement), affichée EN REMPLACEMENT de `Scene` dans le même
 * `<Canvas>` tant que `underwaterMode` est actif côté composant parent. NE MODIFIE AUCUNE mécanique
 * d'oxygène/fatigue existante (celles-ci restent intégralement pilotées par GameCanvas2D.tsx) :
 * purement une nouvelle couche visuelle/d'exploration, sans risque de régression. Synk peut
 * désormais s'y déplacer (voir `pos`, alimenté par moveUnderwater dans le composant parent — corrige
 * le bug rapporté "je ne peux pas me déplacer sous l'eau") ; la caméra recentre sa cible sur lui à
 * mesure qu'il nage, bornée à un petit rayon d'exploration (RepRules.platform3dUnderwaterMoveRadius)
 * pour rester dans le champ des poissons/créatures/fond sableux généré. */
function UnderwaterScene({ stage, facing, equipment, equipmentRenderEnabled, fishCount, monsterCount, pos, walking, running, eyeBlinkEnabled, eyeBlinkIntervalSec }: {
  stage: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean;
  fishCount: number; monsterCount: number;
  pos: { x: number; y: number }; walking: boolean; running: boolean;
  eyeBlinkEnabled?: boolean; eyeBlinkIntervalSec?: number;
}) {
  const fishSeeds = useMemo(() => Array.from({ length: Math.max(0, fishCount) }, (_, i) => i), [fishCount]);
  const monsterSeeds = useMemo(() => Array.from({ length: Math.max(0, monsterCount) }, (_, i) => i), [monsterCount]);
  return (
    <>
      <color attach="background" args={['#082f49']} />
      <fog attach="fog" args={['#082f49', 3, 13]} />
      <ambientLight intensity={0.55} color="#7dd3fc" />
      <directionalLight position={[3, 6, 2]} intensity={0.4} color="#38bdf8" />
      <mesh position={[0, -2.4, 0]} receiveShadow>
        <boxGeometry args={[24, 0.4, 24]} />
        <meshStandardMaterial color="#78716c" />
      </mesh>
      {fishSeeds.map(s => <Fish key={`fish-${s}`} seed={s} />)}
      {monsterSeeds.map(s => <SeaMonster key={`mon-${s}`} seed={s} />)}
      <group position={[pos.x, 0, pos.y]}>
        <SynkVoxel
          stage={stage} walking={walking} running={running} swimming={true}
          jumpTrigger={0} facing={facing} equipment={equipment} equipmentRenderEnabled={equipmentRenderEnabled}
          standY={0} fullySubmerged eyeBlinkEnabled={eyeBlinkEnabled} eyeBlinkIntervalSec={eyeBlinkIntervalSec}
        />
      </group>
      <OrbitControls enablePan={false} enableDamping dampingFactor={0.12} minDistance={2} maxDistance={9} target={[pos.x, -1, pos.y]} />
    </>
  );
}

const TOWER_SCENE_INNER_RADIUS = 2.0;
const TOWER_SCENE_OUTER_RADIUS = 6.4;

/**
 * Sommet de tour/donjon (voir demande utilisateur « se retrouvera alors en haut d'une tour en 3D
 * [...] à regarder le paysage en 3D de haut autour de lui [...] la colonne centrale du donjon où se
 * trouvera la porte pour ressortir ») — mini-monde exploratoire indépendant, sur le même modèle que
 * `UnderwaterScene` ci-dessus : remplace entièrement `<CryptTunnelScene>` dans le `<Canvas>` tant
 * que `towerTopActive` est vrai (voir Platform3DWidget, § cryptRoomType). Synk y réapparaît "comme
 * dans le monde réel" (SynkVoxel debout normal, `standY=0`, ni nage ni accroupi) et peut faire le
 * tour de la colonne centrale (anneau navigable, voir Platform3DWidget::moveTowerTop) ; la SEULE
 * sortie est de cliquer sur la porte montée sur la colonne (réutilise `<CryptDoor>`, câblée sur le
 * MÊME `onToggleDoor` que la porte en haut de l'escalier — fermer cette porte "depuis l'autre côté"
 * ramène simplement `cryptDoorOpened` à `false`, donc à l'escalier, sans aucun nouvel état requis).
 * La vue aérienne miniature ci-dessous (silhouettes de PNJ/familiers/huttes au loin, tout en bas)
 * réutilise directement les offsets (x,z) déjà calculés par `sceneMarkers` dans le composant parent
 * (PAS de remontage d'un second `<Scene>` complet, qui dupliquerait `<OrbitControls>` et entrerait
 * en conflit avec celui de cette scène) — donne la "perspective de hauteur" demandée sans dupliquer
 * la moindre logique de jeu.
 */
/** Hauteur (sous la tourelle) et échelle d'affichage de la vraie vue aérienne détaillée (voir
 * TowerTopScene ci-dessous — demande utilisateur « voir le plateau de jeu avec les dalles, les
 * détails, les PNJ, l'eau, les huttes »). `AERIAL_Y=-14` reste nettement au-dessous de la colonne
 * centrale (cylindre de 10 unités de haut centré en y=-3, donc son extrémité basse est en y=-8) pour
 * éviter tout chevauchement visuel (la grille est projetée en y=-AERIAL_Y=-14) ; `AERIAL_SCALE=0.42`
 * réduit la grille réelle (15×15 dalles, voir
 * VIEW_RADIUS) à un diamètre d'environ 6,3 unités, cohérent avec le rayon de la plateforme du donjon
 * (TOWER_SCENE_OUTER_RADIUS=6.4) pour qu'elle se lise comme "le même monde vu de haut". */
const AERIAL_Y = 14;
const AERIAL_SCALE = 0.42;
/** Gestionnaire de clic neutre pour les dalles/props/marqueurs de la vue aérienne miniature :
 * purement décorative (on regarde le monde d'en haut, on n'y interagit pas depuis la tourelle). */
const AERIAL_NOOP = () => {};

function TowerCameraInit({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    camera.position.set(target[0], target[1] + 4.4, target[2] + 3.4);
    camera.lookAt(target[0], target[1], target[2]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function TowerTopScene({
  stage, facing, equipment, equipmentRenderEnabled, pos, walking, running, eyeBlinkEnabled, eyeBlinkIntervalSec,
  onToggleDoor, torchFlickerEnabled, markers,
  centerCol, centerRow, poiPoints, objectFlags, fireBreathEnabled, fireBreathIntervalSec,
  wildlifeAudio, owlHootEnabled, werewolfHowlEnabled,
}: {
  stage: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean;
  pos: { x: number; y: number }; walking: boolean; running: boolean;
  eyeBlinkEnabled?: boolean; eyeBlinkIntervalSec?: number;
  onToggleDoor: () => void; torchFlickerEnabled: boolean;
  markers: SceneMarker[];
  /** Props supplémentaires (mêmes que Scene(), voir plus bas) permettant à la vue aérienne de
   * recalculer et de rendre la VRAIE grille de dalles/décor (TerrainBlock/PropBlock) plutôt que des
   * silhouettes de cubes colorés — voir demande utilisateur « voir le plateau de jeu avec les
   * dalles, les détails [...] comme on le voit ici ». Purement en LECTURE (aucun onClick actif, voir
   * AERIAL_NOOP) : aucune interaction/duplication de `<Scene>`/`<OrbitControls>`. */
  centerCol: number; centerRow: number;
  poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[];
  objectFlags?: Record<Platform3DObjectKind, Platform3DObjectFlags>;
  fireBreathEnabled?: boolean; fireBreathIntervalSec?: number;
  wildlifeAudio?: Record<AudioSourceKey, AudioSourceSetting>;
  owlHootEnabled?: boolean; werewolfHowlEnabled?: boolean;
}) {
  const merlons = useMemo(() => Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    const r = TOWER_SCENE_OUTER_RADIUS + 0.55;
    return { angle, x: Math.sin(angle) * r, z: Math.cos(angle) * r };
  }), []);
  // Vraie grille de dalles (identique à Scene(), voir sa doc) — reconstruite ici plutôt que
  // remontée en `<Scene>` pour ne jamais dupliquer `<OrbitControls>`/le Canvas (voir doc du
  // composant ci-dessus).
  const tiles = useMemo(() => {
    const out: { tile: Tile; x: number; z: number }[] = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const rawWc = centerCol + dx, rawWr = centerRow + dz;
        if (rawWc < 0 || rawWc > WORLD_SIZE || rawWr < 0 || rawWr > WORLD_SIZE) continue;
        const wc = clamp100(rawWc), wr = clamp100(rawWr);
        out.push({ tile: worldTileAt(wc, wr, poiPoints), x: dx, z: dz });
      }
    }
    return out;
  }, [centerCol, centerRow, poiPoints]);
  const colRadius = TOWER_SCENE_INNER_RADIUS - 0.3;
  return (
    <>
      <color attach="background" args={['#bfe3ff']} />
      <fog attach="fog" args={['#bfe3ff', 14, 40]} />
      <ambientLight intensity={0.85} color="#fff7e6" />
      <directionalLight position={[6, 10, 4]} intensity={0.9} color="#fff1cc" />
      {/* Plateforme crénelée en haut de la tour. */}
      <mesh position={[0, -0.25, 0]} receiveShadow>
        <cylinderGeometry args={[TOWER_SCENE_OUTER_RADIUS + 0.5, TOWER_SCENE_OUTER_RADIUS + 0.7, 0.5, 24]} />
        <meshStandardMaterial color="#8a8070" />
      </mesh>
      {merlons.map((m, i) => (
        <mesh key={`merlon-${i}`} position={[m.x, 0.3, m.z]} rotation={[0, m.angle, 0]} castShadow>
          <boxGeometry args={[0.55, 0.7, 0.35]} />
          <meshStandardMaterial color="#6b6456" />
        </mesh>
      ))}
      {/* Colonne centrale (infranchissable, voir moveTowerTop) avec la porte de retour. */}
      <mesh position={[0, -3, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[colRadius, colRadius + 0.2, 10, 20]} />
        <meshStandardMaterial color="#5b5346" />
      </mesh>
      <group position={[0, 1.05, -colRadius]} rotation={[0, Math.PI, 0]}>
        <CryptDoor onClick={onToggleDoor} />
        <Torch side={-1} flicker={torchFlickerEnabled} />
        <Torch side={1} flicker={torchFlickerEnabled} />
      </group>
      {/* VRAIE vue aérienne détaillée (voir doc ci-dessus) — la grille de dalles/décor/PNJ réelle,
          juste réduite et projetée en contrebas, plutôt que des silhouettes de cubes colorés —
          donne la perspective de hauteur SANS dupliquer la scène principale (`<Scene>`) ni son
          `<OrbitControls>`. Fond vert sous la grille pour masquer les bords non couverts par
          VIEW_RADIUS (coins du cercle de la plateforme du donjon). */}
      <mesh position={[0, -AERIAL_Y - 0.4, 0]} receiveShadow>
        <cylinderGeometry args={[TOWER_SCENE_OUTER_RADIUS + 0.4, TOWER_SCENE_OUTER_RADIUS + 1, 1, 32]} />
        <meshStandardMaterial color="#4d7c4f" />
      </mesh>
      <group position={[0, -AERIAL_Y, 0]} scale={[AERIAL_SCALE, AERIAL_SCALE, AERIAL_SCALE]}>
        {tiles.map(({ tile, x, z }) => (
          <group key={`aerial-${x}-${z}`}>
            <TerrainBlock tile={tile} x={x} z={z} onClick={AERIAL_NOOP} />
            {tile.prop && (
              <PropBlock
                kind={tile.prop} x={x} z={z}
                topY={tile.terrain === 'rock' ? Math.min(1.9, (tile.altitudeM ?? 300) / 2800) : 0}
                scale={(objectFlags ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS)[platform3dPropKind(tile.prop)]?.scale ?? 1}
                onClick={AERIAL_NOOP}
              />
            )}
          </group>
        ))}
        {markers.map(m => {
          const markerScaleKind: Platform3DObjectKind | null = m.kind === 'npc' ? 'marker:npc' : m.kind === 'familiar' ? 'marker:familiar' : null;
          const markerScale = markerScaleKind ? ((objectFlags ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS)[markerScaleKind]?.scale ?? 1) : 1;
          return (
            <MarkerBlock
              key={`aerial-${m.id}`} kind={m.kind} poiType={m.marker.poiType} name={m.marker.name}
              markerId={m.marker.id} x={m.x} z={m.z} scale={markerScale} facing={m.facing} moving={m.moving}
              onClick={AERIAL_NOOP} fireBreathEnabled={fireBreathEnabled} fireBreathIntervalSec={fireBreathIntervalSec}
              wildlifeAudio={wildlifeAudio} owlHootEnabled={owlHootEnabled} werewolfHowlEnabled={werewolfHowlEnabled}
            />
          );
        })}
      </group>
      <group position={[pos.x, 0, pos.y]}>
        <SynkVoxel
          stage={stage} walking={walking} running={running} swimming={false}
          jumpTrigger={0} facing={facing} equipment={equipment} equipmentRenderEnabled={equipmentRenderEnabled}
          standY={0} eyeBlinkEnabled={eyeBlinkEnabled} eyeBlinkIntervalSec={eyeBlinkIntervalSec}
        />
      </group>
      {/* Caméra suiveuse "mode traveling" (voir demande utilisateur) : le `target` suit Synk tandis
          que la caméra reste positionnée AU-DESSUS de lui. L'AZIMUT (rotation horizontale à la
          souris) est désormais VERROUILLÉ (`minAzimuthAngle===maxAzimuthAngle`, voir demande
          utilisateur « met en place une caméra qui suit Synk et se positionne au dessus de lui et
          fait en sorte que les touches de direction reste les mêmes [...] quand j'utilise la vue
          [...] à la souris [...] les directions au clavier [...] ne sont plus les mêmes ») — c'est
          la rotation HORIZONTALE (tourner autour de Synk) qui changeait l'apparence écran de
          "avant"/"gauche"/"droite" sans jamais changer la direction réellement envoyée par les
          touches, d'où la désynchronisation. L'inclinaison VERTICALE (`minPolarAngle`/
          `maxPolarAngle` par défaut, non bornés ici) reste en revanche 100% libre : « permettre à
          Synk de baisser comme lever un peu le regard » (demande utilisateur antérieure) n'est
          PAS affectée, puisqu'incliner la vue de haut en bas ne fait tourner ni ne retourne jamais
          l'écran (contrairement à l'azimut). `TowerCameraInit` fixe la pose de départ en surplomb
          (azimut 0, cohérent avec le verrouillage ci-dessus) UNE SEULE FOIS à l'entrée. */}
      <OrbitControls
        enablePan={false} enableDamping dampingFactor={0.12} minDistance={2.5} maxDistance={12}
        target={[pos.x, 1, pos.y]} minAzimuthAngle={0} maxAzimuthAngle={0}
      />
      <TowerCameraInit target={[pos.x, 1, pos.y]} />
    </>
  );
}

/**
 * Fenêtre flottante et déplaçable "Plateforme 3D" — rendu 3D façon Minecraft (voxels/blocs) de
 * Synk et de tout son univers (PNJ, familiers, monstres, Zorghon/PocaPoka/El Pipo, huttes, eau,
 * montagnes, trésors), Phase 3 de la Roadmap ("Moteur de jeu"). Bâti en Three.js/React Three Fiber
 * (widget React natif, sans moteur/pipeline d'export séparé — voir ROADMAP.md § Phase 3) : lit et
 * écrit exactement la même position `players/{addr}/mapPos` que GameCanvas2D.tsx (Plateforme 2D
 * isométrique) et WorldMapWidget.tsx (Mapmonde), via les mêmes fonctions `worldTileAt`/
 * `getAllMapMarkers`, garantissant une synchronisation parfaite entre les 3 vues sans aucune
 * divergence possible. Ne duplique AUCUNE mécanique de jeu (oxygène/fatigue/évanouissement restent
 * intégralement pilotés par GameCanvas2D.tsx, toujours monté dans game/page.tsx) : purement une vue
 * + un canal de déplacement supplémentaire, donc zéro risque de régression sur les mécaniques
 * existantes.
 */
export function Platform3DWidget({ stage, playerXp = 0, encounterNpc, enabled = true }: { stage: number; playerXp?: number; encounterNpc?: EncounterMarkerInfo; enabled?: boolean }) {
  const { t } = useI18n();
  const { address } = useEffectiveAccount();
  const { z, bringToFront } = useWindowZIndex();
  const {
    collapsed, pos, onPointerDown, onPointerMove, onPointerUp, onToggleClick, toggleCollapsed,
    containerRef, menuPos, onContextMenu, closeContextMenu, resetPosition,
  } = useDraggableWidget({
    posKey: POS_KEY, collapsedKey: COLLAPSED_KEY,
    defaultPos: () => ({ x: window.innerWidth - CANVAS_W - 40, y: 120 }),
    onExpand: bringToFront,
  });

  const [rules, setRules] = useState<RepRules | null>(null);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);
  // ─── Optimisation GPU/CPU (suite, voir docs/ARCHITECTURE.md § Optimisation GPU/CPU) — un
  // utilisateur a signalé que le GPU intégré restait saturé à ~90-98% MÊME onglet/fenêtre non
  // regardée activement (le `<Canvas>` continue par défaut d'appeler `requestAnimationFrame` en
  // continu tant qu'il est monté, même si le navigateur limite déjà fortement la cadence d'un
  // onglet masqué). On stoppe désormais EXPLICITEMENT le rendu (`frameloop="never"`, voir plus bas)
  // dès que l'onglet passe en arrière-plan (`document.visibilityState !== 'visible'` — minimisé,
  // changement d'onglet, mise en veille de l'écran), sans jamais démonter le `<Canvas>` : aucune
  // perte d'état de la scène, reprise immédiate et sans à-coup dès le retour au premier plan.
  const [documentVisible, setDocumentVisible] = useState(true);
  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    onVisibilityChange();
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
  // Cycle jour/nuit + thème d'ambiance effectif (voir Platform3DAmbientScene.tsx et
  // lib/useWorldTheme.ts — même hook que WeatherPanel.tsx/WorldMapWidget.tsx, une seule résolution
  // fait autorité pour éviter toute incohérence entre widgets).
  const worldAmbience = useWorldThemeAmbience();
  // Pousse la config Administration (vitesse/pauses/gel de proximité des PNJ/familiers errants,
  // voir RepRules.roamStepMs et suivants, RepRulesPanel.tsx section « 🚶 Déplacement des PNJ/
  // Familiers errants ») vers le registre partagé lib/roamingActors.ts — sans effet tant que
  // `rules` n'est pas encore chargé (conserve alors les valeurs par défaut). GameCanvas2D.tsx et
  // WorldMapWidget.tsx font le même appel : idempotent (dernier appelant gagne, valeurs identiques
  // puisque toutes issues du même RepRules), aucun conflit possible entre widgets.
  useEffect(() => {
    if (!rules) return;
    configureRoaming({
      stepMs: rules.roamStepMs, pauseMinSec: rules.roamPauseMinSec, pauseMaxSec: rules.roamPauseMaxSec,
      proximityFreezeEnabled: rules.roamProximityFreezeEnabled, proximityFreezeTiles: rules.roamProximityFreezeTiles,
      proximityFreezeResumeSec: rules.roamProximityFreezeResumeSec,
      obstacleAvoidanceEnabled: rules.roamObstacleAvoidanceEnabled,
      actorCollisionAvoidanceEnabled: rules.roamActorCollisionEnabled,
    });
  }, [rules]);
  // Pousse le nombre de Portes des étoiles (RepRules.stargateCount, défaut 20) vers le registre
  // partagé lib/worldTerrain.ts — voir configureStargates() pour le détail de l'algorithme.
  // GameCanvas2D.tsx et WorldMapWidget.tsx font le même appel : idempotent (dernier appelant
  // gagne, valeurs identiques puisque toutes issues du même RepRules), aucun conflit possible.
  useEffect(() => {
    if (!rules) return;
    configureStargates({ count: rules.stargateCount });
  }, [rules]);
  // Idem pour la faune errante (hiboux/loups-garous) — voir le même appel, avec les mêmes
  // commentaires détaillés, dans GameCanvas2D.tsx/WorldMapWidget.tsx.
  useEffect(() => {
    if (!rules) return;
    ensureWildlifeSpawns(rules.wildlifeEnabled !== false, rules.wildlifeOwlCount ?? 13, rules.wildlifeWerewolfCount ?? 12, rules.wildlifeSpawnSeed ?? 0, rules.wildlifeBoarCount ?? 8,
      rules.undeadEnabled === false ? 0 : (rules.undeadZombieCount ?? 6), rules.undeadEnabled === false ? 0 : (rules.undeadGhoulCount ?? 5), rules.undeadEnabled === false ? 0 : (rules.undeadSkeletonCount ?? 6));
  }, [rules]);
  // Réglages audio admin (voir lib/audio.ts) — appelés UNE SEULE FOIS ici (composant NON-R3F) et
  // transmis en prop à `<Scene>` → `<MarkerBlock>` pour le hibou/loup-garou errant, plutôt que de
  // ré-abonner ce hook dans chaque instance de MarkerBlock (potentiellement des dizaines de
  // marqueurs affichés simultanément).
  const wildlifeAudio = useAdminAudioSettings();

  // Signale au registre partagé (voir lib/platform3dActive.ts) que la Plateforme 3D est la source
  // ACTIVE de déplacement clavier tant qu'elle reste dépliée/activée — corrige le bug rapporté
  // "déplacement erratique/bloqué, réparti entre Plateforme 3D et 2D isométrique" causé par les DEUX
  // écouteurs clavier indépendants qui se disputaient la position de Synk. Réinitialisé à `false` au
  // repli/désactivation/démontage pour rendre immédiatement la main au clavier de GameCanvas2D.
  useEffect(() => {
    setPlatform3DActive(!collapsed && enabled);
    return () => setPlatform3DActive(false);
  }, [collapsed, enabled]);

  const [player, setPlayer] = useState<PlayerState | null>(null);
  useEffect(() => {
    if (!address) { setPlayer(null); return; }
    return subscribePlayer(address, setPlayer);
  }, [address]);

  const [worldPos, setWorldPos] = useState<Pos>({ x: 50, y: 88 });
  const worldPosRef = useRef(worldPos);
  useEffect(() => { worldPosRef.current = worldPos; }, [worldPos]);
  useEffect(() => {
    if (!address) return;
    return subscribePlayerMapPos(address, p => {
      if (p && p.mapId === DEFAULT_MAP_ID) setWorldPos({ x: p.x, y: p.y });
    });
  }, [address]);
  // Alimente lib/npcApproach.ts avec la position COURANTE de Synk (voir GameCanvas2D.tsx, même
  // appel) — les deux widgets peuvent chacun être démonté/masqué indépendamment (repRules), donc
  // les deux rapportent la même valeur pour garantir que l'approche reste alimentée quel que soit
  // celui effectivement monté.
  useEffect(() => { reportSynkApproachTarget(worldPos.x, worldPos.y); }, [worldPos]);
  // Alimente lib/roamingActors.ts avec la position COURANTE de Synk (voir configureRoaming
  // ci-dessus) — sert UNIQUEMENT à geler les PNJ/dragons/familiers déjà à proximité (jamais à les
  // faire suivre Synk, voir avertissement dans roamingActors.ts) ; répond à la demande utilisateur
  // « quand Synk est juste à côté [...] arrête leur déplacement [...] quand Synk s'en va, remets les
  // en marche ». Même rationale multi-widgets que reportSynkApproachTarget ci-dessus.
  useEffect(() => { reportSynkPositionForFreeze(worldPos.x, worldPos.y); }, [worldPos]);

  const roamingActors = useRoamingActors();
  // Position live du PNJ actuellement "en approche" (rencontre sollicitée) — voir
  // lib/npcApproach.ts et son utilisation symétrique dans GameCanvas2D.tsx.
  const npcApproach = useNpcApproach();

  const [rawMarkers, setRawMarkers] = useState<MapMarker[]>([]);
  useEffect(() => { getAllMapMarkers(DEFAULT_MAP_ID).then(setRawMarkers).catch(() => {}); }, []);
  // Masque les trésors déjà ramassés par CE joueur et pas encore réapparus (voir
  // lib/treasureVisibility.ts, RepRules.treasureRespawnHours) — répond à la demande utilisateur
  // « disparaitre de l'endroit précis où il a été récupéré [...] réapparaitre [...] seulement
  // quelques temps plus tard (48 heures par exemple) ». `markers` (nom historique, inchangé) reste
  // dérivé afin de ne pas avoir à retoucher ses dizaines de sites d'usage plus bas.
  const hiddenTreasureIds = useHiddenTreasureIds(address, rules?.treasureRespawnHours ?? 48);
  // Objets déposés par les joueurs (glisser-déposer besace → Plateforme 3D/2D — voir
  // lib/worldDrops.ts). Même abonnement temps réel PARTAGÉ que GameCanvas2D.tsx/WorldMapWidget.tsx.
  const worldDrops = useWorldDrops();
  const dropMarkers = useMemo(() => worldDrops.map(worldDropToMarker), [worldDrops]);
  const markers = useMemo(
    () => [...rawMarkers.filter(m => m.kind !== 'treasure' || !hiddenTreasureIds.has(RKEY(m.id))), ...dropMarkers],
    [rawMarkers, hiddenTreasureIds, dropMarkers],
  );
  // Attribue au PNJ errant/Dragon errant une entrée catalogue réelle — idempotent et PARTAGÉ avec
  // GameCanvas2D.tsx (voir lib/roamingActors.ts::ensureRoamingIdentities) : garantit que le PNJ/
  // Dragon visible ici est strictement le même que celui visible sur la Plateforme 2D isométrique.
  useEffect(() => { ensureRoamingIdentities(markers); }, [markers]);
  const poiPoints = useMemo(
    () => markers.filter(m => m.kind === 'poi').map(m => ({ x: m.x, y: m.y, poiType: m.poiType, radius: m.radius })),
    [markers],
  );
  // Alimente lib/roamingActors.ts en catalogue de POI (voir reportWorldPois) afin que
  // isTileBlockedForRoaming() y résolve EXACTEMENT le même terrain/props/obstacles que ce widget
  // pour Synk lui-même — voir le même appel, avec les mêmes commentaires détaillés, dans
  // GameCanvas2D.tsx.
  useEffect(() => { reportWorldPois(poiPoints); }, [poiPoints]);
  // Portes de monde du catalogue (kind:'world') — utilisées par onPortalTileClick3D pour attribuer
  // un monde déterministe aux portails décoratifs (🌀), exactement comme GameCanvas2D.tsx::worldMarkers.
  const worldMarkers = useMemo(() => markers.filter(m => m.kind === 'world'), [markers]);

  // Équipement de Synk (voir gameState.ts::EquipSlot/EquippedItem) — rendu cosmétique EN DIRECT
  // sur le personnage 3D (arme/arc+flèches/bouclier/amulette/ceinture/armure/pantalon/bottes/gants),
  // voir SynkVoxel plus bas. Purement visuel : ne duplique aucune logique de combat/usure (celle-ci
  // reste intégralement pilotée par BackpackWidget.tsx/EquipmentWidget.tsx).
  const [equipment, setEquipment] = useState<Partial<Record<EquipSlot, EquippedItem>>>({});
  useEffect(() => {
    if (!address) { setEquipment({}); return; }
    return subscribeEquipment(address, setEquipment);
  }, [address]);

  // Marqueur cliqué (PNJ/familier/trésor/quête/monde/hutte) — ouvre le même pop-up d'interaction
  // que GameCanvas2D.tsx (voir PoiInteractionModal.tsx), pour garantir des mécaniques identiques
  // entre les 3 vues (2D isométrique/3D/mapmonde), sans aucune duplication de logique de jeu.
  const [interactionMarker, setInteractionMarker] = useState<MapMarker | null>(null);
  // Répercute l'ouverture/fermeture du pop-up de rencontre vers lib/roamingActors.ts — même
  // rationale et mêmes commentaires détaillés que dans GameCanvas2D.tsx.
  useEffect(() => {
    setInteractingActorId(interactionMarker?.id ?? null);
    return () => setInteractingActorId(null);
  }, [interactionMarker]);
  const [hutResting, setHutResting] = useState(false);
  const [hutFeedback, setHutFeedback] = useState<string | null>(null);

  // ─── Souterrain de crypte (voir CryptTunnelScene.tsx) — `cryptMode` contient l'id de la crypte
  // actuellement explorée (`null` = aucun souterrain actif, vue normale). `cryptProgress` est le
  // nombre de "dalles" parcourues depuis l'entrée, piloté par les boutons dédiés « ▲ Avancer »/
  // « ▼ Reculer » (voir plus bas, overlay HORS `<Canvas>`) — AUCUNE réutilisation du dpad/clavier
  // existant (trop risqué pour la navigation déjà en place, voir useHoldMovement ci-dessous).
  const [cryptMode, setCryptMode] = useState<string | null>(null);
  // Signale au registre partagé (voir lib/undergroundActive.ts) tant que Synk est sous terre
  // (couloir, salle d'arrivée ou tour de donjon) — consommé par NpcEncounterPopup.tsx pour
  // suspendre tout tirage de rencontre PNJ (combat/quête/troc/discussion) et fermer immédiatement
  // toute rencontre déjà affichée, tant qu'aucun PNJ n'est rencontrable sous terre. Réinitialisé à
  // `false` au démontage (repli du widget) pour ne jamais laisser les rencontres suspendues pour le
  // reste de la session si le joueur replie la Plateforme 3D en pleine exploration souterraine.
  useEffect(() => {
    setUndergroundActive(cryptMode !== null);
    return () => setUndergroundActive(false);
  }, [cryptMode]);
  const [cryptProgress, setCryptProgress] = useState(0);
  // 🆕 Quart(s) de tour sur soi-même dans le couloir/escalier (0 à 3, voir CryptTunnelScene.tsx::
  // CryptCamera turnOffset et demande utilisateur « 2 boutons [...] permettant de faire [...] 1/4
  // de tour à gauche ou à droite afin de pouvoir faire tourner Synk sur soi-même ») — N'AFFECTE QUE
  // le regard de la caméra, jamais `cryptProgress` (la position le long du chemin). Remis à 0 à
  // chaque nouvelle entrée en crypte (voir onRequestEnterCrypt) et masqué une fois `cryptDoorOpened`
  // (la salle d'arrivée a déjà sa propre vue libre via `<OrbitControls>`).
  const [cryptTurn, setCryptTurn] = useState<0 | 1 | 2 | 3>(0);
  // true une fois la porte au sommet de l'escalier franchie (voir CryptTunnelScene.tsx, § Escalier
  // + porte) — bascule l'overlay HUD et le rendu 3D vers la salle d'arrivée (tour/chambre/
  // parchemin), réinitialisé à chaque nouvelle entrée en crypte (voir onRequestEnterCrypt).
  const [cryptDoorOpened, setCryptDoorOpened] = useState(false);
  // 🆕 Type de salle d'arrivée (voir CryptTunnelScene.tsx::cryptDestinationRoomFor, déterministe
  // par crypte) — calculé ICI, côté parent, afin de pouvoir SUBSTITUER entièrement `<CryptTunnelScene>`
  // par `<TowerTopScene>` dans le `<Canvas>` (voir plus bas) dès que la salle d'arrivée est une tour
  // ET que la porte a été franchie (voir demande utilisateur « se retrouvera alors en haut d'une
  // tour [...] à regarder le paysage [...] de haut autour de lui [...] la caméra bougera avec lui
  // en mode traveling »). S'applique à TOUTE crypte dont le tirage déterministe donne 'tower' (pas
  // une crypte unique câblée en dur) — répond à la demande « tu feras cela pour tous les châteaux/
  // tourelles/donjons du jeu » dans le cadre de l'architecture crypte→tour déjà en place.
  const cryptRoomType = useMemo(() => (cryptMode ? cryptDestinationRoomFor(cryptMode) : null), [cryptMode]);
  const towerTopActive = cryptMode !== null && cryptDoorOpened && cryptRoomType === 'tower';
  // 🆕 true une fois la porte franchie vers une salle chambre/parchemin (voir doc de `towerTopActive`
  // ci-dessus, même rationale) — active le déplacement libre au clavier/dpad (voir `moveRoom`/
  // `roomPos` plus bas) exactement comme `towerTopActive` le fait pour la tour.
  const roomTopActive = cryptMode !== null && cryptDoorOpened && (cryptRoomType === 'bedroom' || cryptRoomType === 'parchment');
  const cryptTunnelLength = Math.max(4, Math.round(rules?.cryptTunnelLength ?? 40));
  // 🆕 Direction (8 valeurs) de Synk juste AVANT l'entrée en crypte (capturée dans
  // `onRequestEnterCrypt`) — c'est la direction vers laquelle il marchait pour atteindre la porte de
  // la crypte (face à elle). Utilisée par `exitCrypt` pour le retourner à l'opposé exact (voir
  // `OPPOSITE_DIRECTION`) lors de la sortie complète du souterrain, répondant à la demande
  // utilisateur « il faut que Synk soit face à la sortie [...] à l'inverse de la porte [...] pour
  // [...] donner réellement l'impression qu'il sort de la crypte ».
  const preCryptFacingRef = useRef<SynkDirection>('down');
  // 🔒 Bug corrigé (rapporté par l'utilisateur à plusieurs reprises, captures d'écran à l'appui :
  // caméra "zoomée" sur le toit/la croix de la crypte, puis écran envahi de vert/noir même après
  // deux correctifs successifs sur le CALCUL de la position) : la vraie cause n'était ni l'angle ni
  // le rayon de la pose caméra, mais une COURSE (race condition) — `exitCrypt` fixait
  // `cameraRef.current.position`/`.lookAt(...)` de façon SYNCHRONE dans le même tick que
  // `setCryptMode(null)`, hors `<CryptTunnelScene>` (toujours monté à cet instant précis, React
  // n'ayant pas encore commité le démontage) pilote la caméra CHAQUE frame via son propre
  // `useFrame` (voir `CryptCamera` dans CryptTunnelScene.tsx, actif tant que `!doorOpened` — or on
  // sort toujours par la porte d'ENTRÉE avec `doorOpened===false`) : au moins une frame
  // supplémentaire pouvait s'écouler avant le démontage réel, cette frame écrasant purement et
  // simplement notre position/rotation manuelle avec celle, non pertinente, du couloir (près de
  // l'entrée). Correctif (1/2) : ne plus toucher la caméra DANS `exitCrypt` lui-même — mémoriser
  // ici l'angle visé (`pendingExitCameraRef`) et incrémenter `exitCamRequestId` (voir plus bas),
  // consommés par `<CryptExitCameraGuard>` (monté DANS le `<Canvas>`, uniquement une fois revenu à
  // la branche "monde extérieur", donc forcément après le démontage de `<CryptTunnelScene>`/l'arrêt
  // de son `useFrame` — élimine la course par construction).
  // 🔒 Second bug corrigé (Playwright : capture identique à un sapin décoratif vu de très près même
  // après correction de la course ci-dessus) : UN SEUL côté "sûr" (ex. toujours au sud) ne l'est en
  // réalité QUE pour certaines cryptes selon leur décor environnant tiré aléatoirement par tuile
  // (voir `worldTerrain.ts::worldTileAt`) — et une simple vérification de la tuile exacte à distance
  // `radius` (tentée puis abandonnée) s'est révélée insuffisante : un arbre déborde visuellement de
  // sa tuile d'ancrage. Correctif (2/2), robuste quel que soit le décor : `<CryptExitCameraGuard>`
  // utilise un VRAI raycast Three.js contre la scène déjà montée pour reculer la caméra tant qu'un
  // objet s'interpose entre elle et Synk, au lieu de deviner une distance sûre par le calcul.
  const pendingExitCameraRef = useRef<{ angle: number; radius: number } | null>(null);
  const [exitCamRequestId, setExitCamRequestId] = useState(0);
  // Parchemin déjà ramassé par CE joueur (voir lib/gameState.ts::getTakenParchmentIds/
  // subscribeTakenParchmentIds, stockage PAR JOUEUR — voir commentaire détaillé dans gameState.ts).
  const [takenParchmentIds, setTakenParchmentIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!address) { setTakenParchmentIds(new Set()); return; }
    return subscribeTakenParchmentIds(address, setTakenParchmentIds);
  }, [address]);
  // Pop-up de lecture du parchemin (voir ParchmentPopup.tsx) — `null` = fermé, sinon id de la
  // crypte dont le parchemin est en cours de lecture.
  const [parchmentPopupCryptId, setParchmentPopupCryptId] = useState<string | null>(null);

  // 🆕 Familier "Dragon Vert" caché dans la table de chevet de l'UNIQUE chambre HIDDEN_DRAGON_CRYPT_ID
  // (voir CryptTunnelScene.tsx et gameState.ts::claimHiddenDragonFamiliar — demande utilisateur
  // « ajoutes une surprise dans la table de chevet d'une chambre [...] ne donne aucune indication »).
  // Même principe que `takenParchmentIds`/`parchmentPopupCryptId` ci-dessus, mais stockage PAR
  // JOUEUR directement sous `familiars/` (une seule crypte concernée, pas besoin d'un Set).
  const [hiddenDragonTaken, setHiddenDragonTaken] = useState(false);
  useEffect(() => {
    if (!address) { setHiddenDragonTaken(false); return; }
    return subscribeHiddenDragonFamiliarTaken(address, setHiddenDragonTaken);
  }, [address]);
  const [hiddenFamiliarPopupOpen, setHiddenFamiliarPopupOpen] = useState(false);

  const [kingdomMarker, setKingdomMarker] = useState<MapMarker | null>(null);
  useEffect(() => {
    if (!address) { setKingdomMarker(null); return; }
    const refresh = () => getKingdomQuestMarker(address).then(setKingdomMarker).catch(() => {});
    refresh();
    return subscribeSolvedQuestIds(address, refresh);
  }, [address]);

  const [zorghonEncounter, setZorghonEncounter] = useState<ZorghonEncounterState | null>(null);
  useEffect(() => {
    if (!address) { setZorghonEncounter(null); return; }
    const refresh = () => getZorghonEncounter(address).then(s => { if (s) setZorghonEncounter(s); }).catch(() => {});
    refresh();
    const unsubProgress = subscribeSolvedQuestIds(address, refresh);
    const unsubLive = subscribeZorghonEncounter(address, s => { if (s) setZorghonEncounter(s); });
    return () => { unsubProgress(); unsubLive(); };
  }, [address]);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  useEffect(() => {
    if (!address) { setInventory([]); return; }
    return subscribeInventory(address, setInventory);
  }, [address]);

  // ─── Porte des Étoiles — console d'activation (voir StargatePortal plus haut) ───
  // Au plus UNE activation en cours dans tout le jeu (XP + objet validés, animation de composition
  // en cours) — `key` identifie SANS ambiguïté le portail concerné (`tile-{wc}-{wr}` pour un
  // portail décoratif posé sur une dalle, `world-{markerId}` pour un portail flottant inter-mondes,
  // voir Scene() ci-dessus) afin que les AUTRES portes des étoiles simultanément visibles à l'écran
  // restent visuellement statiques pendant qu'une seule d'entre elles anime son anneau de glyphes.
  const [stargateActivation, setStargateActivation] = useState<{ key: string; startedAt: number; durationMs: number } | null>(null);
  const stargateCompletionRef = useRef<(() => void) | null>(null);
  // 🆕 Popup modal (plus de bandeau auto-masqué, voir demande utilisateur « affiche le popup de
  // cette manière et comme tous les autres [...] » — même structure que PoiInteractionModal.tsx) :
  // reste affiché jusqu'à fermeture explicite (croix/bouton Fermer/clic extérieur), voir rendu JSX.
  const [stargateFeedback, setStargateFeedback] = useState<string | null>(null);
  const requestStargateActivation = useCallback((key: string, onComplete: () => void) => {
    // Re-entrance : une activation est déjà en cours (sur ce portail ou un autre) — ignore le
    // nouveau clic plutôt que de l'empiler/écraser l'animation déjà lancée.
    if (stargateActivation) return;
    const r = rules;
    const xpRequired = r?.stargateXpRequired ?? 50;
    if ((playerXp ?? 0) < xpRequired) {
      setStargateFeedback(t('stargate.feedback.xpMissing', { xp: xpRequired }));
      return;
    }
    if (r?.stargateRequiresItem !== false) {
      const requiredItemId = r?.stargateRequiredItemId || 'stargate_crystal';
      const owned = inventory.some(i => i.itemId === requiredItemId && (i.qty ?? 0) > 0);
      if (!owned) {
        const itemLabel = DEFAULT_SHOP.find(i => i.itemId === requiredItemId)?.name ?? requiredItemId;
        setStargateFeedback(t('stargate.feedback.itemMissing', { item: itemLabel }));
        return;
      }
    }
    const durationMs = Math.max(1, r?.stargateActivationDurationSec ?? 12) * 1000;
    stargateCompletionRef.current = onComplete;
    setStargateActivation({ key, startedAt: Date.now(), durationMs });
  }, [stargateActivation, rules, playerXp, inventory, t]);
  const completeStargateActivation = useCallback((key: string) => {
    setStargateActivation(prev => {
      if (!prev || prev.key !== key) return prev;
      const cb = stargateCompletionRef.current;
      stargateCompletionRef.current = null;
      if (cb) setTimeout(cb, 0);
      return null;
    });
  }, []);
  // Horloge locale (0,5 Hz) UNIQUEMENT pour rafraîchir le compte à rebours affiché pendant une
  // activation (voir overlay `stargate.activating` plus bas) — ne tourne pas en dehors d'une
  // activation en cours, donc aucun coût de rendu superflu le reste du temps.
  const [stargateNow, setStargateNow] = useState(Date.now());
  useEffect(() => {
    if (!stargateActivation) return;
    const id = setInterval(() => setStargateNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [stargateActivation]);

  const hasVehicle = useMemo(() => inventory.some(i => i.category === 'vehicle' && i.qty > 0), [inventory]);
  const [islandBlockedMsg, setIslandBlockedMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!islandBlockedMsg) return;
    const id = setTimeout(() => setIslandBlockedMsg(null), 3500);
    return () => clearTimeout(id);
  }, [islandBlockedMsg]);

  const centerCol = Math.round(clamp100(worldPos.x));
  const centerRow = Math.round(clamp100(worldPos.y));

  // Marqueurs (catalogue + Quête du Royaume + Zorghon/prisonniers + PNJ/Dragon errants) dans le
  // rayon 3D affiché, convertis en coordonnées relatives (x,z) centrées sur Synk — même filtre de
  // fenêtre que GameCanvas2D.tsx::visibleMarkers, juste un rayon circulaire plutôt qu'un rectangle
  // COLSxROWS. Le PNJ/Dragon errant (voir lib/roamingActors.ts, registre partagé avec
  // GameCanvas2D.tsx) est matérialisé ici comme un marqueur synthétique dont x/y suivent sa
  // position mapmonde COURANTE (pas sa position catalogue statique, qui n'a pas de sens pour une
  // entité mobile) — reprend l'identité (nom/icône) de sa véritable fiche catalogue afin que
  // MarkerBlock choisisse le bon rendu 3D (npcAppearance/familiarDragonColor) exactement comme
  // pour n'importe quel PNJ/familier fixe.
  const sceneMarkers = useMemo<SceneMarker[]>(() => {
    const zorghonMarkers: MapMarker[] = (!zorghonEncounter || zorghonEncounter.rescued) ? [] : [
      { id: 'zorghon.boss', kind: 'zorghon', name: 'Zorghon', icon: '👹', x: zorghonEncounter.zorghonX, y: zorghonEncounter.zorghonY },
      { id: 'zorghon.captives', kind: 'captive', name: 'Captifs', icon: '🧝‍♀️', x: zorghonEncounter.captiveX, y: zorghonEncounter.captiveY },
    ];
    const roamingMarkers: MapMarker[] = [];
    if (roamingActors.npcMarkerId) {
      const base = markers.find(mk => mk.kind === 'npc' && mk.id === roamingActors.npcMarkerId);
      if (base) roamingMarkers.push({ ...base, x: roamingActors.npc.x, y: roamingActors.npc.y });
    }
    if (roamingActors.dragonMarkerId) {
      const base = markers.find(mk => mk.kind === 'familiar' && mk.id === roamingActors.dragonMarkerId);
      if (base) roamingMarkers.push({ ...base, x: roamingActors.dragon.x, y: roamingActors.dragon.y });
    }
    // TOUS les familiers/dragons généralistes du catalogue (voir lib/roamingActors.ts::familiars,
    // « TOUS les familiers/dragons du catalogue errent désormais ») — même principe que
    // roamingMarkers ci-dessus (position mapmonde COURANTE, identité reprise du catalogue via
    // `markers.find`), mais pour un nombre variable d'entrées au lieu d'une seule. Corrige la
    // demande utilisateur « fais en sorte que les Dragons et les familiers se déplacent aussi et au
    // même titre que les PNJ ».
    const generalFamiliarMarkers: MapMarker[] = [];
    const generalFamiliarFacing = new Map<string, { facing: SynkDirection; moving: boolean }>();
    for (const [id, f] of Object.entries(roamingActors.familiars)) {
      const base = markers.find(mk => mk.kind === 'familiar' && mk.id === id);
      if (!base) continue;
      generalFamiliarMarkers.push({ ...base, x: f.x, y: f.y });
      generalFamiliarFacing.set(id, { facing: f.facing, moving: f.moving });
    }
    // PNJ "en approche" (rencontre sollicitée, voir lib/npcApproach.ts) — matérialisé ici comme un
    // marqueur synthétique `kind: 'npc'` (jamais issu du catalogue, `markerId` dédié
    // 'encounter.npc.live' pour une apparence déterministe stable via npcAppearance()) qui marche
    // progressivement vers Synk, EXACTEMENT comme le PNJ errant ci-dessus, au lieu de rester absent
    // de la Plateforme 3D (bug initial : ce widget ne recevait même pas `encounterNpc`).
    const encounterMarkers: MapMarker[] = (encounterNpc && npcApproach.active) ? [{
      id: 'encounter.npc.live', kind: 'npc',
      name: localizeName(t, `npc.archetype.${encounterNpc.baseKey}`, encounterNpc.baseKey),
      icon: '❗', x: npcApproach.x, y: npcApproach.y,
    }] : [];
    // PNJ de rencontre PERSISTÉS (voir lib/roamingActors.ts::ExtraRoamingActor) — continuent
    // d'errer sur toute la mapmonde après la fermeture de leur pop-up de rencontre au lieu de
    // disparaître (voir demande utilisateur). Non-interactifs (pas d'identité catalogue), même
    // principe visuel que roamingMarkers/encounterMarkers ci-dessus (facing/moving repris tels
    // quels via `extraById`, voir plus bas).
    const extraMarkers: MapMarker[] = roamingActors.extras.map((e) => ({
      id: e.id, kind: e.kind, name: e.name, i18nKey: e.i18nKey, icon: e.icon, x: e.x, y: e.y,
    }));
    const extraById = new Map(roamingActors.extras.map((e) => [e.id, e]));
    // Faune sauvage errante (hiboux/loups-garous, voir lib/roamingActors.ts::WildlifeActorState/
    // ensureWildlifeSpawns) — synthétiques (aucune identité catalogue), même principe visuel que
    // generalFamiliarMarkers ci-dessus (position mapmonde COURANTE + facing/moving repris tels
    // quels). Corrige le bug remonté par l'utilisateur : « le loup garou et le hibou me suivent
    // quand je me déplace [...] fait en sorte qu'ils soient positionnés aléatoirement [...] et se
    // déplacent aussi dans la Plateforme 3D ».
    const wildlifeMarkers: MapMarker[] = Object.entries(roamingActors.wildlife).map(([id, w]) => ({
      id, kind: 'wildlife',
      name: w.kind === 'owl' ? t('canvas2d.owlLabel') : w.kind === 'werewolf' ? t('canvas2d.werewolfLabel') : t('canvas2d.boarLabel'),
      icon: w.kind === 'owl' ? '🦉' : w.kind === 'werewolf' ? '🐺' : '🐗', x: w.x, y: w.y,
    }));
    const wildlifeFacing = new Map<string, { facing: SynkDirection; moving: boolean }>();
    for (const [id, w] of Object.entries(roamingActors.wildlife)) wildlifeFacing.set(id, { facing: w.facing, moving: w.moving });
    // Exclut du catalogue statique les entrées dont l'identité vient d'être réutilisée ci-dessus
    // (roamingMarkers) : sans ce filtre, un PNJ/Dragon dont la fiche catalogue se trouve ELLE-MÊME
    // dans le rayon 3D affiché apparaîtrait EN DOUBLE (sa position catalogue fixe ET sa position
    // errante courante) avec la MÊME clé React (`m.id`) — avertissement "duplicate key" et rendu
    // indéterminé. Toujours le même comportement pour 2D/3D (le widget 2D n'affiche déjà QUE la
    // position errante pour ces deux identités, jamais leur fiche catalogue statique séparément).
    const baseMarkers = (roamingActors.npcMarkerId || roamingActors.dragonMarkerId || generalFamiliarMarkers.length)
      ? markers.filter(mk => mk.id !== roamingActors.npcMarkerId && mk.id !== roamingActors.dragonMarkerId && !roamingActors.familiars[mk.id])
      : markers;
    const all = kingdomMarker
      ? [...baseMarkers, kingdomMarker, ...zorghonMarkers, ...roamingMarkers, ...generalFamiliarMarkers, ...encounterMarkers, ...extraMarkers, ...wildlifeMarkers]
      : [...baseMarkers, ...zorghonMarkers, ...roamingMarkers, ...generalFamiliarMarkers, ...encounterMarkers, ...extraMarkers, ...wildlifeMarkers];
    const out: SceneMarker[] = [];
    for (const m of all) {
      const dx = Math.round(m.x) - centerCol, dz = Math.round(m.y) - centerRow;
      if (Math.abs(dx) > VIEW_RADIUS || Math.abs(dz) > VIEW_RADIUS) continue;
      // Facing/moving : PNJ/Dragon errant (voir lib/roamingActors.ts) OU PNJ "en approche" (voir
      // lib/npcApproach.ts) OU PNJ de rencontre persisté (voir extraById ci-dessus) — oriente le
      // personnage 3D dans sa direction de marche courante et déclenche sa démarche animée (bras/
      // jambes articulés, voir NpcVoxel/DragonMarker) au lieu de l'ancienne rotation continue
      // générique ("toupie") appliquée par défaut à tout marqueur flottant. `undefined` pour tout
      // marqueur catalogue statique — comportement idle inchangé.
      const extra = extraById.get(m.id);
      const generalFamiliar = generalFamiliarFacing.get(m.id);
      const wildlife = wildlifeFacing.get(m.id);
      const facing = m.id === roamingActors.npcMarkerId ? roamingActors.npcFacing
        : m.id === roamingActors.dragonMarkerId ? roamingActors.dragonFacing
        : m.id === 'encounter.npc.live' ? npcApproach.facing
        : generalFamiliar ? generalFamiliar.facing
        : wildlife ? wildlife.facing
        : extra ? extra.facing : undefined;
      const moving = m.id === roamingActors.npcMarkerId ? roamingActors.npcMoving
        : m.id === roamingActors.dragonMarkerId ? roamingActors.dragonMoving
        : m.id === 'encounter.npc.live' ? npcApproach.moving
        : generalFamiliar ? generalFamiliar.moving
        : wildlife ? wildlife.moving
        : extra ? extra.moving : undefined;
      out.push({ id: m.id, kind: m.kind, x: dx, z: dz, marker: m, facing, moving, questId: extra?.questId, questLabel: extra?.questLabel, questI18nKey: extra?.questI18nKey });
    }
    return out;
  }, [markers, kingdomMarker, zorghonEncounter, centerCol, centerRow, roamingActors, encounterNpc, npcApproach, t]);

  const currentTile = useMemo(() => worldTileAt(centerCol, centerRow, poiPoints), [centerCol, centerRow, poiPoints]);
  const swimming = currentTile.terrain === 'water';
  // Hauteur de la dalle sur laquelle Synk se tient debout (voir tileStandTopY) — permet à Synk de
  // suivre visuellement le relief (montagne escaladée) et corrige le bug « jambes/pieds invisibles ».
  const standY = useMemo(() => tileStandTopY(currentTile), [currentTile]);

  // ─── Monde sous-marin (plongée totale) — voir RepRules.platform3dUnderwaterWorldEnabled/
  // UnderwaterScene. Menu contextuel (clic droit) proposé uniquement quand Synk est sur une dalle
  // d'eau ; "Nager" ferme simplement le menu (comportement par défaut, mi-torse immergé déjà en
  // place), "Plonger" bascule vers le monde sous-marin décoratif (voir underwaterMode).
  const [underwaterMode, setUnderwaterMode] = useState(false);
  const [waterMenuPos, setWaterMenuPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { if (!swimming && underwaterMode) setUnderwaterMode(false); }, [swimming, underwaterMode]);

  // Proxy évanouissement (oxygène/fatigue) : GameCanvas2D.tsx reste l'UNIQUE moteur de décroissance
  // et d'évanouissement (toujours monté dans game/page.tsx) — ce widget ne fait que lire l'état
  // `player` courant pour bloquer, lui aussi, tout déplacement tant que Synk est sous le seuil
  // d'évanouissement (oxygène ou fatigue), afin de ne jamais permettre de contourner la mécanique
  // via ce canal de déplacement supplémentaire (zéro régression).
  const isFainting = !!player && rules != null && (
    (player.oxygen ?? 100) <= (rules.oxygenFaintThresholdPct ?? 20)
    || (player.fatigue ?? 100) <= (rules.fatigueFaintThresholdPct ?? 10)
  );

  const [facing, setFacing] = useState<SynkDirection>('down');
  const [isWalking, setIsWalking] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [jumpTrigger, setJumpTrigger] = useState(0);
  const walkStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Boussole & recentrage Nord (voir RepRules.platform3dCompassIdleRecenterSec, FACING_ANGLE/
  // COMPASS_NEEDLE_DEG plus haut, SynkVoxel::recentering/onRecenterComplete) — répond à la demande
  // utilisateur « place [...] une boussole translucide [...] Ajoute un bouton qui permettra [...] de
  // faire revenir l'orientation/direction de Synk [...] vers le Nord [...] De même si Synk reste
  // sans activité [...] pendant 6 secondes [...] réoriente Synk automatiquement [...] en faisant
  // glisser doucement la caméra ». `orbitControlsRef` est créé ICI (comme `cameraRef`/`CameraBridge`
  // plus bas) car le bouton et la minuterie vivent HORS `<Canvas>`, dans ce composant — passé en
  // prop à `<Scene>` qui l'attache à `<OrbitControls>` (remplace son ancien `useRef` local).
  //
  // 🔒 Ce recentrage EXPLICITE et PONCTUEL (un seul appel à `setAzimuthalAngle(0)` par déclenchement,
  // laissé au damping natif d'OrbitControls pour l'interpolation douce — voir dispatchMove ci-dessous
  // pour le commentaire historique complet) NE réintroduit PAS la boucle de rétroaction caméra↔
  // déplacement qui a motivé le verrou « la caméra [...] reste 100% libre [...] sans plus jamais être
  // repositionnée automatiquement par le code » : ce verrou visait la résolution CONTINUE de la
  // direction de marche à partir de l'angle de caméra (`rotateInputByCameraYaw`), qui reste
  // strictement inchangée (dx/dy en repère MONDE FIXE) et n'est influencée ni par ce recentrage ni
  // par l'orbite manuelle de la caméra.
  const orbitControlsRef = useRef<any>(null);
  const [recentering, setRecentering] = useState(false);
  const lastMoveAtRef = useRef(Date.now());
  const idleRecenteredRef = useRef(false);
  const triggerRecenter = useCallback(() => {
    orbitControlsRef.current?.setAzimuthalAngle?.(0);
    lastMoveAtRef.current = Date.now();
    setRecentering(true);
  }, []);
  // Appelé par SynkVoxel une fois l'interpolation de rotation terminée — fixe `facing` à 'up' pour
  // que l'état déclaratif reste cohérent avec l'angle visuel final (voir SynkVoxel::useFrame :
  // aucun « saut » possible puisque la cible EST déjà FACING_ANGLE.up).
  const handleRecenterComplete = useCallback(() => {
    setFacing('up');
    setRecentering(false);
  }, []);
  // Minuterie d'inactivité : déclenche le recentrage automatique après
  // `platform3dCompassIdleRecenterSec` secondes (défaut 6) sans déplacement RÉEL de Synk (voir
  // `lastMoveAtRef`, remis à jour dans `move()` ci-dessous) — ne se déclenche qu'une fois par
  // période d'inactivité (`idleRecenteredRef`), désarmée dès que Synk bouge à nouveau. Inactive tant
  // que le widget est réduit/désactivé ou en mode sous-marin (compas propre à la vue de surface).
  useEffect(() => {
    if (collapsed || !enabled || underwaterMode) return;
    const id = setInterval(() => {
      const idleSec = Math.max(1, rules?.platform3dCompassIdleRecenterSec ?? 6);
      if (!idleRecenteredRef.current && Date.now() - lastMoveAtRef.current >= idleSec * 1000) {
        idleRecenteredRef.current = true;
        triggerRecenter();
      }
    }, 500);
    return () => clearInterval(id);
  }, [collapsed, enabled, underwaterMode, rules?.platform3dCompassIdleRecenterSec, triggerRecenter]);

  // ─── Dégâts de chute/escalade (voir RepRules.platform3dFallDamageMinCubes/platform3dFallDeathCubes)
  // `fallDamagePopup` = pop-up temporaire (dégâts mineurs, auto-masqué). `fallDeath` = compte à
  // rebours de la « chute mortelle » (bloque le déplacement comme un évanouissement, voir isFainting
  // ci-dessus), suivi d'une réanimation à pleine Vie (voir finishFallDeath plus bas) — mécanique
  // propre à ce widget UNIQUEMENT (n'interfère jamais avec fainting/fatigueFainting de GameCanvas2D).
  const [fallDamagePopup, setFallDamagePopup] = useState<{ hp: number; xp: number } | null>(null);
  const [fallDeath, setFallDeath] = useState<{ remaining: number } | null>(null);
  const fallDeathRef = useRef(false);
  useEffect(() => {
    if (!fallDamagePopup) return;
    const id = setTimeout(() => setFallDamagePopup(null), 3500);
    return () => clearTimeout(id);
  }, [fallDamagePopup]);

  const finishFallDeath = useCallback(async () => {
    try {
      if (address) await applyEffect(address, { hp: 999999 }).catch(() => {}); // clampé à hpMax (voir applyEffect)
    } finally {
      fallDeathRef.current = false;
      setFallDeath(null);
    }
  }, [address]);
  const finishFallDeathRef = useRef(finishFallDeath);
  useEffect(() => { finishFallDeathRef.current = finishFallDeath; }, [finishFallDeath]);
  useEffect(() => {
    if (!fallDeath) return;
    const id = setInterval(() => {
      setFallDeath(prev => {
        if (!prev) return null;
        if (prev.remaining <= 1) { finishFallDeathRef.current(); return null; }
        return { remaining: prev.remaining - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [!!fallDeath]);

  // Touche Espace maintenue (voir RepRules.platform3dJumpEnabled) — permet de "sauter" pour
  // franchir une dalle de montagne/roche : sans Espace maintenu, avancer vers une telle dalle est
  // bloqué (comme un obstacle) ; avec Espace maintenu, l'avancée est autorisée et déclenche l'arc
  // de saut cosmétique de SynkVoxel (voir jumpTrigger, incrémenté dans move() plus bas). Renommé
  // `jumpHeldRef` (au lieu de `spaceDownRef`) car il reflète maintenant DEUX sources equivalentes :
  // la touche clavier Espace ET le nouveau bouton "Sauter" du pavé directionnel virtuel ci-dessous
  // (corrige le bug rapporté "je n'arrive pas à monter sur un cube au pavé directionnel virtuel" —
  // il n'existait auparavant AUCUN équivalent tactile à la touche Espace, rendant l'escalade
  // impossible sans clavier physique).
  const jumpHeldRef = useRef(false);
  useEffect(() => {
    if (collapsed || !enabled) return;
    const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      jumpHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => { if (isSpace(e)) jumpHeldRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      jumpHeldRef.current = false;
    };
  }, [collapsed, enabled]);

  const moveTo = useCallback((nx: number, ny: number) => {
    if (!address) return;
    const x = clamp100(nx), y = clamp100(ny);
    if ((rules?.islandVehicleRequired ?? true) && !hasVehicle) {
      const dest = worldTileAt(Math.round(x), Math.round(y), poiPoints);
      if (dest.isIsland) { setIslandBlockedMsg(t('canvas2d.islandVehicleRequired')); return; }
    }
    setWorldPos({ x, y });
    worldPosRef.current = { x, y };
    setPlayerMapPos(address, DEFAULT_MAP_ID, x, y).catch(() => {});
  }, [address, rules?.islandVehicleRequired, hasVehicle, poiPoints, t]);

  // ─── Déclenche les dégâts de chute/escalade selon le dénivelé en cubes franchi (voir
  // tileClimbCubes/RepRules.platform3dFallDamageMinCubes/platform3dFallDeathCubes). N'est appelé
  // QUE lors d'une montée (dénivelé positif, avec Espace maintenu) — descendre reste toujours libre
  // et sans dégât, conformément à la demande utilisateur.
  const triggerClimbDamage = useCallback((diffCubes: number) => {
    if (!address || !rules) return;
    const deathCubes = rules.platform3dFallDeathCubes ?? 10;
    const minCubes = rules.platform3dFallDamageMinCubes ?? 4;
    if (diffCubes > deathCubes) {
      if (fallDeathRef.current) return; // pas deux morts par chute en même temps
      fallDeathRef.current = true;
      const xpLoss = Math.max(0, Math.round(rules.platform3dFallDeathXp ?? 300));
      const durationSec = Math.max(1, Math.round(rules.platform3dFallDeathReviveSec ?? 51));
      applyEffect(address, { xpBonus: -xpLoss, hp: -999999 }).catch(() => {});
      setFallDeath({ remaining: durationSec });
    } else if (diffCubes > minCubes) {
      const hpLoss = Math.max(0, Math.round(rules.platform3dFallDamageHp ?? 20));
      const xpLoss = Math.max(0, Math.round(rules.platform3dFallDamageXp ?? 50));
      applyEffect(address, { xpBonus: -xpLoss, hp: -hpLoss }).catch(() => {});
      setFallDamagePopup({ hp: hpLoss, xp: xpLoss });
    }
  }, [address, rules]);

  const move = useCallback((dx: number, dy: number) => {
    if (isFainting || fallDeath) return; // Synk évanoui (noyade/épuisement) ou en chute mortelle : déplacement bloqué
    // Boussole/recentrage (voir ci-dessus) : tout déplacement RÉEL réarme la minuterie d'inactivité
    // et interrompt immédiatement un recentrage éventuellement en cours (SynkVoxel reprend alors la
    // rotation instantanée normale liée à `facing`, voir son useFrame).
    lastMoveAtRef.current = Date.now();
    idleRecenteredRef.current = false;
    setRecentering(false);
    const dir = directionFromDelta(dx, dy);
    if (dir) {
      setFacing(dir);
      setIsWalking(true);
      if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current);
      walkStopTimerRef.current = setTimeout(() => { setIsWalking(false); setIsRunning(false); }, WALK_STOP_DELAY_MS);
    }
    const cur = worldPosRef.current;
    const nx = cur.x + dx * STEP_PCT, ny = cur.y + dy * STEP_PCT;
    const destWc = Math.round(clamp100(nx)), destWr = Math.round(clamp100(ny));
    const destTile = worldTileAt(destWc, destWr, poiPoints);
    // Collision POI "obstacle" (village/taverne/étable/hutte...) — identique à GameCanvas2D.tsx :
    // ne bloque QUE ce déplacement incrémental, jamais moveTo (clic d'approche/téléportation).
    if ((rules?.poiObstacleCollisionEnabled ?? true) && isObstacleAt(destWc, destWr, poiPoints, destTile)) return;
    // 🆕 Corrige le bug rapporté « je peux traverser ce PNJ et lui aussi peut me traverser » : Synk
    // LUI-MÊME ne pouvait jusqu'ici jamais être bloqué par un PNJ/familier (voir
    // lib/roamingActors.ts::isWorldPosBlockedByLivingActor, nouveau point d'appel partagé avec
    // GameCanvas2D.tsx) — symétrique avec l'évitement déjà en place entre acteurs errants.
    if (isWorldPosBlockedByLivingActor(nx, ny, markers, roamingActors)) return;
    // 🆕 Porte des étoiles flottante (`kind:'world'`) + sa console adjacente désormais bloquantes
    // (demande utilisateur « fait en sorte que je ne puisse pas passer a travers la porte des
    // étoiles ou de la console/pupitre ») — voir lib/roamingActors.ts::isWorldPosBlockedByStaticMarker,
    // même point d'appel partagé avec GameCanvas2D.tsx pour une collision identique en 3D/2D.
    if (isWorldPosBlockedByStaticMarker(nx, ny, markers)) return;
    // Registre admin-paramétrable des comportements par objet/décor (voir platform3dTileFlags) —
    // un arbre (ou toute autre entrée marquée `obstacle`) bloque désormais le déplacement, comme
    // n'importe quel obstacle existant (corrige le bug "je traverse les arbres").
    const destFlags = platform3dTileFlags(destTile, rules?.platform3dObjectFlags);
    if (destFlags.obstacle) return;
    // Anti "coupe de coin" en diagonale (voir demande "certains arbres" traversés) : en déplacement
    // diagonal (dx ET dy non nuls), la case de destination peut être libre alors que Synk coupe
    // visuellement à travers l'ANGLE d'un arbre planté sur l'une des deux cases orthogonales
    // adjacentes (celle "à côté" en x, celle "à côté" en y) — un jeu de cases/voxels façon Minecraft
    // interdit classiquement cette coupe de coin. On bloque donc aussi la diagonale si l'une de ces
    // deux cases orthogonales est elle-même un obstacle (arbre/hutte/château/POI), tout en laissant
    // un déplacement cardinal (dx=0 ou dy=0) totalement inchangé (aucune régression).
    if (dx !== 0 && dy !== 0) {
      const sideAWc = Math.round(clamp100(cur.x + dx * STEP_PCT)), sideAWr = Math.round(clamp100(cur.y));
      const sideBWc = Math.round(clamp100(cur.x)), sideBWr = Math.round(clamp100(cur.y + dy * STEP_PCT));
      const sideATile = worldTileAt(sideAWc, sideAWr, poiPoints);
      const sideBTile = worldTileAt(sideBWc, sideBWr, poiPoints);
      const poiBlocked = (rules?.poiObstacleCollisionEnabled ?? true) && (isObstacleAt(sideAWc, sideAWr, poiPoints, sideATile) || isObstacleAt(sideBWc, sideBWr, poiPoints, sideBTile));
      const propBlocked = platform3dTileFlags(sideATile, rules?.platform3dObjectFlags).obstacle || platform3dTileFlags(sideBTile, rules?.platform3dObjectFlags).obstacle;
      if (poiBlocked || propBlocked) return;
    }
    // Franchissement d'un dénivelé (montagne/roche) à l'aide du saut (Espace maintenu) — voir
    // RepRules.platform3dJumpEnabled/platform3dObjectFlags['terrain:rock'].climbable : sans Espace
    // maintenu (ou si la dalle n'est pas marquée escaladable), un dénivelé positif reste bloqué ;
    // DESCENDRE (dénivelé nul ou négatif) reste TOUJOURS libre, comme redescendre naturellement sur
    // la terre ferme. Le dénivelé franchi est ensuite converti en « cubes » (voir tileClimbCubes)
    // pour appliquer d'éventuels dégâts de chute/escalade (voir triggerClimbDamage).
    const curTileNow = worldTileAt(Math.round(clamp100(cur.x)), Math.round(clamp100(cur.y)), poiPoints);
    const cubeHeightM = rules?.platform3dCubeHeightM ?? 400;
    const destCubes = tileClimbCubes(destTile, cubeHeightM);
    // La génération procédurale du terrain (voir worldTerrain.ts::worldTileAt) tire le TYPE de
    // chaque dalle (roche ou non) case par case, indépendamment de ses voisines : une dalle de
    // prairie peut donc jouxter une dalle de roche déjà TRÈS élevée (proche du cœur d'une chaîne de
    // montagne), sans dénivelé "intermédiaire" progressif. Sans ce garde-fou, ce tout premier pas
    // depuis la terre ferme vers LE premier cube de la montagne pouvait être compté comme un
    // dénivelé énorme (parfois mortel) alors qu'il s'agit exactement du geste décrit par l'
    // utilisateur ("sauter sur le cube de montagne") — corrige le bug rapporté "impossible de
    // monter sur un seul bloc de montagne" (faux dégâts de chute/mort bloquant tout mouvement
    // pendant `platform3dFallDeathReviveSec`). Les dégâts de chute/franchissement ne s'appliquent
    // donc qu'en enchaînant plusieurs cubes en étant DÉJÀ sur la roche (roche → roche) ; le premier
    // pas prairie/sable/sentier → roche ne coûte jamais de PV/XP (juste le saut habituel).
    const curCubes = curTileNow.terrain === 'rock' ? tileClimbCubes(curTileNow, cubeHeightM) : 0;
    const risingOntoRock = destTile.terrain === 'rock' && destCubes > curCubes + 0.001;
    if (risingOntoRock) {
      if (!(rules?.platform3dJumpEnabled ?? true) || !destFlags.climbable) return;
      if (!jumpHeldRef.current) return;
      setJumpTrigger(v => v + 1);
      if (curTileNow.terrain === 'rock') triggerClimbDamage(destCubes - curCubes);
    }
    moveTo(nx, ny);
  }, [moveTo, isFainting, fallDeath, rules, poiPoints, triggerClimbDamage, markers, roamingActors]);

  // ─── Nage/déplacement en plongée totale (voir UnderwaterScene) ─────────────────────────────────
  // Corrige le bug rapporté "je ne peux pas me déplacer sous l'eau" : le monde sous-marin
  // (`underwaterMode`) était jusqu'ici purement décoratif (Synk fixe au centre, aucune réaction aux
  // touches directionnelles/pavé). Ajoute une progression bornée dans ce petit monde exploratoire
  // (voir RepRules.platform3dUnderwaterMoveRadius/platform3dUnderwaterMoveEnabled, paramétrables en
  // Administration) — indépendante de `worldPos`/l'oxygène/la fatigue (qui restent intégralement
  // pilotés par GameCanvas2D.tsx, AUCUNE nouvelle mécanique de jeu introduite ici, uniquement un
  // déplacement visuel dans cette vue décorative).
  const underwaterPosRef = useRef({ x: 0, y: 0 });
  const [underwaterPos, setUnderwaterPos] = useState({ x: 0, y: 0 });
  const underwaterMoveEnabled = rules?.platform3dUnderwaterMoveEnabled ?? true;
  const underwaterMoveRadius = Math.max(1, rules?.platform3dUnderwaterMoveRadius ?? 6);
  const moveUnderwater = useCallback((dx: number, dy: number) => {
    if (isFainting || fallDeath) return;
    const dir = directionFromDelta(dx, dy);
    if (dir) {
      setFacing(dir);
      setIsWalking(true);
      if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current);
      walkStopTimerRef.current = setTimeout(() => { setIsWalking(false); setIsRunning(false); }, WALK_STOP_DELAY_MS);
    }
    const cur = underwaterPosRef.current;
    const nx = Math.max(-underwaterMoveRadius, Math.min(underwaterMoveRadius, cur.x + dx * 0.6));
    const ny = Math.max(-underwaterMoveRadius, Math.min(underwaterMoveRadius, cur.y + dy * 0.6));
    underwaterPosRef.current = { x: nx, y: ny };
    setUnderwaterPos({ x: nx, y: ny });
  }, [isFainting, fallDeath, underwaterMoveRadius]);

  // ─── Déplacement en haut de la tour du donjon (voir TowerTopScene, demande utilisateur « il
  // pourra faire le tour du donjon [...] faire le tour de la tourelle [...] sachant qu'au milieu se
  // trouvera la colonne ») ──────────────────────────────────────────────────────────────────────
  // Même principe que `moveUnderwater` (petit monde exploratoire borné, indépendant de `worldPos`),
  // mais la zone navigable est un ANNEAU (pas un disque) : Synk ne peut jamais entrer dans la
  // colonne centrale (rayon intérieur, cf. demande « il ne pourra pas tomber du Donjon [...] la
  // seule sortie sera de cliquer [...] sur la porte de la colonne centrale ») ni sortir du rempart
  // extérieur du créneau (rayon extérieur, « agrandi l'espace autour pour permettre à Synk de se
  // déplacer tout autour »).
  const TOWER_INNER_RADIUS = 2.0;
  const TOWER_OUTER_RADIUS = 6.4;
  const towerPosRef = useRef({ x: 0, y: TOWER_INNER_RADIUS + 1.4 });
  const [towerPos, setTowerPos] = useState({ x: 0, y: TOWER_INNER_RADIUS + 1.4 });
  const moveTowerTop = useCallback((dx: number, dy: number) => {
    if (isFainting || fallDeath) return;
    const dir = directionFromDelta(dx, dy);
    if (dir) {
      setFacing(dir);
      setIsWalking(true);
      if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current);
      walkStopTimerRef.current = setTimeout(() => { setIsWalking(false); setIsRunning(false); }, WALK_STOP_DELAY_MS);
    }
    const cur = towerPosRef.current;
    let nx = cur.x + dx * 0.6;
    let ny = cur.y + dy * 0.6;
    const dist = Math.hypot(nx, ny) || 1;
    if (dist < TOWER_INNER_RADIUS) {
      // Repousse Synk tangentiellement au lieu de le bloquer net — glisse le long de la colonne
      // plutôt que de "coller" contre elle (confort de déplacement, cf. contournement d'obstacles).
      nx = (nx / dist) * TOWER_INNER_RADIUS;
      ny = (ny / dist) * TOWER_INNER_RADIUS;
    } else if (dist > TOWER_OUTER_RADIUS) {
      nx = (nx / dist) * TOWER_OUTER_RADIUS;
      ny = (ny / dist) * TOWER_OUTER_RADIUS;
    }
    towerPosRef.current = { x: nx, y: ny };
    setTowerPos({ x: nx, y: ny });
  }, [isFainting, fallDeath]);
  // Réinitialise la position en haut de la tour à chaque nouvelle arrivée (sinon Synk réapparaîtrait
  // à l'endroit où il avait quitté la tour la fois précédente, incohérent avec "il réapparaît comme
  // dans le monde réel" à l'entrée de CHAQUE visite).
  useEffect(() => {
    if (towerTopActive) {
      towerPosRef.current = { x: 0, y: TOWER_INNER_RADIUS + 1.4 };
      setTowerPos({ x: 0, y: TOWER_INNER_RADIUS + 1.4 });
    }
  }, [towerTopActive]);

  // ─── Déplacement libre dans les salles d'arrivée chambre/parchemin (voir CryptTunnelScene.tsx::
  // BedroomRoom/ParchmentRoom, demande utilisateur « permet a Synk de se déplacer à l'aide des
  // touches directionnelles du clavier tout comme quand il est dans le vrai jeu ou sur la tourelle
  // du donjon afin de lui permettre de découvrir la pièce et rechercher par exemple des objets ») ─
  // Même principe que `moveTowerTop` ci-dessus (mini-monde exploratoire borné, indépendant de
  // `worldPos`), mais la zone navigable est un RECTANGLE (le sol carré `[4,4]` des deux salles,
  // identique dans les deux, voir CryptTunnelScene.tsx) plutôt qu'un anneau. `ROOM_MAX_Z` est
  // volontairement UN PEU en-deçà de la porte de retour (z=2.3, voir `ROOM_DOOR_LOCAL` ci-dessous)
  // pour que Synk s'arrête juste devant elle plutôt que de la traverser.
  const ROOM_HALF_X = 1.85;
  const ROOM_MIN_Z = -1.85;
  const ROOM_MAX_Z = 2.05;
  /** Position locale (x, z) de la porte de retour dans la salle (voir CryptTunnelScene.tsx, groupe
   * `<group position={[0, 1.05, TILE_SIZE * 1.15]}>` — `TILE_SIZE=2` ⇒ z=2.3) et rayon de proximité
   * exigé pour pouvoir l'actionner (voir demande utilisateur « il faudra bien sûr pour cela qu'il
   * soit à proximité de la porte de sortie ») — nouvellement nécessaire car Synk peut désormais
   * s'éloigner de cette porte (déplacement libre), contrairement à l'ancienne position fixe. */
  const ROOM_DOOR_LOCAL = { x: 0, z: 2.3 };
  const ROOM_DOOR_PROXIMITY = 1.3;
  const roomPosRef = useRef({ x: 0, y: 1.3, standY: 0 });
  const [roomPos, setRoomPos] = useState({ x: 0, y: 1.3, standY: 0 });
  /** Meubles de la salle d'arrivée courante (voir `cryptRoomType`) — `[]` pour `'tower'` (géré par
   * `TowerTopScene`, aucun meuble). */
  const roomObstacles: RoomObstacle[] = useMemo(() => {
    if (cryptRoomType === 'bedroom') return BEDROOM_OBSTACLES;
    if (cryptRoomType === 'parchment') return PARCHMENT_OBSTACLES;
    return [];
  }, [cryptRoomType]);
  const moveRoom = useCallback((dx: number, dy: number) => {
    if (isFainting || fallDeath) return;
    const dir = directionFromDelta(dx, dy);
    if (dir) {
      setFacing(dir);
      setIsWalking(true);
      if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current);
      walkStopTimerRef.current = setTimeout(() => { setIsWalking(false); setIsRunning(false); }, WALK_STOP_DELAY_MS);
    }
    const cur = roomPosRef.current;
    const nx = Math.max(-ROOM_HALF_X, Math.min(ROOM_HALF_X, cur.x + dx * 0.5));
    const ny = Math.max(ROOM_MIN_Z, Math.min(ROOM_MAX_Z, cur.y + dy * 0.5));
    // ─── Meubles-obstacles + escalade (voir demande utilisateur « il ne faut [...] pas que je passe
    // au travers des objets dans la pièce comme le lit ou la table de chevet ou la table [...] je
    // peux grimper sur la table, le lit ou la table de chevet (mais pas l'armoire) [...] à l'aide de
    // la touche ESPACE et flêche haut [...] comme dans le jeu réel en dehors du souterrain ») — EXACTE-
    // MENT la même mécanique que l'escalade d'un rocher en extérieur (`jumpHeldRef`/`destFlags.
    // climbable`, voir `move()` plus bas) : sans Espace maintenu, avancer vers un meuble est bloqué
    // net ; avec Espace maintenu ET le meuble `climbable`, l'avancée est autorisée (déclenche le même
    // arc de saut cosmétique, voir `jumpTrigger`) et Synk se tient ensuite à la hauteur `topY` du
    // meuble (`roomPos.standY`, voir `SynkVoxel.standY`) tant qu'il reste sur son empreinte. Un meuble
    // NON grimpable (armoire, chaises) bloque TOUJOURS, quel que soit Espace — comme un mur.
    const wasOn = roomObstacles.find(o => isInsideRoomObstacle(cur.x, cur.y, o));
    const target = roomObstacles.find(o => isInsideRoomObstacle(nx, ny, o));
    if (target && target !== wasOn) {
      if (!target.climbable) return; // meuble non grimpable (armoire/chaise) : bloqué net
      if (!jumpHeldRef.current) return; // grimpable, mais Espace non maintenu : bloqué
      setJumpTrigger(v => v + 1); // même arc cosmétique que l'escalade d'un rocher en extérieur
    }
    const standY = target ? target.topY : 0;
    roomPosRef.current = { x: nx, y: ny, standY };
    setRoomPos({ x: nx, y: ny, standY });
  }, [isFainting, fallDeath, roomObstacles]);
  // Réinitialise la position dans la salle à chaque nouvelle arrivée (même rationale que l'effet
  // équivalent pour `towerPos` ci-dessus) — Synk réapparaît toujours juste devant la porte, comme
  // avec l'ancienne position fixe `[0,0,1.3]`.
  useEffect(() => {
    if (roomTopActive) {
      roomPosRef.current = { x: 0, y: 1.3, standY: 0 };
      setRoomPos({ x: 0, y: 1.3, standY: 0 });
    }
  }, [roomTopActive]);

  // Aiguille le clavier/pavé directionnel/souris vers la nage sous-marine ou le déplacement normal,
  // selon la vue active — un SEUL point d'entrée partagé par useHoldMovement pour ne dupliquer
  // aucune logique d'appui prolongé/course (voir useHoldMovement.ts).
  //
  // IMPORTANT (historique) : ce déplacement a longtemps tenté d'être « relatif à la caméra »
  // (« Haut » = s'éloigner de la caméra, quel que soit son orbite), via une rotation de l'entrée
  // brute par l'angle azimutal courant de la caméra (`rotateInputByCameraYaw`/`cameraYawRef`,
  // alimentés par la caméra suiveuse « chase cam »). Cinq tentatives successives de correctif ont
  // toutes fini par réintroduire une boucle de rétroaction entre l'angle de la caméra et la
  // direction résolue (la caméra suiveuse recalant son angle EN FONCTION de la direction de marche,
  // qui elle-même dépendait de l'angle de la caméra), provoquant des allers-retours ou une dérive en
  // spirale sur des appuis répétés/brefs — signalé à plusieurs reprises par l'utilisateur. Le
  // déplacement est désormais VOLONTAIREMENT en repère MONDE FIXE (Haut = nord/dy:-1, Bas =
  // sud/dy:+1, Gauche = ouest/dx:-1, Droite = est/dx:+1), strictement identique et indépendant de
  // l'orientation de la caméra — exactement comme la Plateforme 2D isométrique (GameCanvas2D.tsx),
  // ce qui élimine structurellement toute possibilité de boucle de rétroaction caméra↔déplacement.
  // La caméra (OrbitControls, voir Scene ci-dessus) reste 100% libre à orbiter/zoomer à la souris,
  // sans plus jamais être repositionnée automatiquement par le code ni jamais influencer la
  // direction résolue.
  const dispatchMove = useCallback((dx: number, dy: number) => {
    if (towerTopActive) { moveTowerTop(dx, dy); return; }
    if (roomTopActive) { moveRoom(dx, dy); return; }
    if (underwaterMode && underwaterMoveEnabled) { moveUnderwater(dx, dy); return; }
    move(dx, dy);
  }, [towerTopActive, moveTowerTop, roomTopActive, moveRoom, underwaterMode, underwaterMoveEnabled, moveUnderwater, move]);

  const hold = useHoldMovement(dispatchMove, {
    walkStepMs: rules?.movementWalkStepMs ?? 220,
    runStepMs: rules?.movementRunStepMs ?? 110,
    runHoldThresholdMs: rules?.movementRunHoldThresholdMs ?? 1500,
    onRunChange: setIsRunning,
  });
  const releaseMovement = useCallback(() => {
    hold.release();
  }, [hold]);
  useEffect(() => () => { if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current); }, []);

  // ─── Distinction glissé-souris (orbite caméra) / simple clic (déplacement/interaction) ─────────
  // Corrige le bug rapporté « les rotations à la souris... un coup déplace Synk » : OrbitControls
  // et les gestionnaires `onClick` de `@react-three/fiber` posés sur chaque tuile/marqueur (voir
  // TerrainBlock/PropBlock/MarkerBlock dans Scene ci-dessus) observent tous les DEUX les mêmes
  // événements pointeur bruts sur le même `<canvas>` — un glissé-souris pour orbiter la caméra se
  // termine par un `pointerup` qui, si le curseur est resté au-dessus d'une tuile/d'un marqueur
  // (cas fréquent : on orbite SANS déplacer beaucoup le curseur en X/Y écran), peut être interprété
  // par R3F comme un simple clic sur cette tuile et déclencher `moveTo`/l'interaction — en plus de
  // faire orbiter la caméra. Un seuil de distance (en pixels écran, entre `pointerdown` et l'instant
  // présent) permet de distinguer les deux : si le pointeur a parcouru plus de quelques pixels
  // depuis l'appui initial, on considère qu'il s'agissait d'un glissé (orbite), et les gestionnaires
  // de clic ci-dessous ignorent volontairement le `onClick` de R3F qui suit.
  const dragStateRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const DRAG_THRESHOLD_PX = 6;
  const onCanvasPointerDownForDrag = useCallback((e: React.PointerEvent) => {
    dragStateRef.current = { x: e.clientX, y: e.clientY, dragged: false };
  }, []);
  const onCanvasPointerMoveForDrag = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || s.dragged) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_THRESHOLD_PX) s.dragged = true;
  }, []);

  // ─── Clic sur un marqueur (PNJ, familier, trésor, quête, monde, hutte) — même logique que
  // GameCanvas2D.tsx::onMarkerClick, pour garantir une interaction strictement identique entre les
  // 3 vues (2D isométrique/3D/mapmonde) et éviter toute duplication/divergence de mécanique.
  const onMarkerClick3D = useCallback((m: MapMarker) => {
    if (dragStateRef.current?.dragged) return; // voir « Distinction glissé-souris / clic » ci-dessus
    const interactable = m.kind === 'npc' || m.kind === 'familiar' || m.kind === 'treasure' || m.kind === 'drop'
      || m.kind === 'quest' || m.kind === 'world' || (m.kind === 'poi' && (m.poiType === 'hut' || m.poiType === 'crypt'));
    if (!interactable) return;
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(Math.round(m.x) - Math.round(cur.x)), Math.abs(Math.round(m.y) - Math.round(cur.y)));
    // 🔒 Téléportation par clic DÉSACTIVÉE (voir demande utilisateur « je ne dois pas pouvoir
    // déplacer ou téléporter Synk [...] avec un clic gauche de la souris [...] ça serait trop
    // facile ») — l'interaction reste disponible UNIQUEMENT si Synk est déjà adjacent (approche au
    // pavé directionnel/clavier requise), sinon le clic ne fait plus rien (ancien `else
    // moveTo(m.x, m.y)` retiré).
    if (dist <= 1) setInteractionMarker(m);
  }, []);

  // ─── Clic sur un PNJ de rencontre PERSISTÉ ayant accordé une quête (voir SceneMarker.questId /
  // lib/roamingActors.ts::ExtraRoamingActor.questId) — même logique que
  // GameCanvas2D.tsx::onExtraQuestClick : ouvre un marqueur `kind:'quest'` synthétique (id =
  // questId) pour rouvrir EXACTEMENT le même pop-up de rappel d'énigme que partout ailleurs
  // (PoiInteractionModal::QuestBody), sans dupliquer sa logique. Corrige la demande utilisateur :
  // « rends possible le fait de cliquer une nouvelle fois sur le PNJ même en ayant accepté la
  // quête [...] tu répondras [...] qu'il doit répondre à l'énigme ».
  const onExtraQuestClick3D = useCallback((m: MapMarker, questId: string, questLabel?: string, questI18nKey?: string) => {
    if (dragStateRef.current?.dragged) return;
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(Math.round(m.x) - Math.round(cur.x)), Math.abs(Math.round(m.y) - Math.round(cur.y)));
    // Titre du pop-up = texte de la quête elle-même (questLabel/questI18nKey), pas le nom de
    // l'archétype PNJ (m.name/m.i18nKey) — corrige le bug remonté par l'utilisateur (le rappel
    // affichait "Faucheur d'Automne" au lieu de la question posée). Repli sur m.name/m.i18nKey
    // uniquement si l'un ou l'autre manque (ancien fantôme persisté avant ce correctif).
    const questMarker: MapMarker = {
      id: questId, kind: 'quest', name: questLabel ?? m.name, i18nKey: questI18nKey ?? m.i18nKey, icon: '📜', x: m.x, y: m.y,
    };
    // 🔒 Téléportation par clic DÉSACTIVÉE (voir onMarkerClick3D ci-dessus) : interaction disponible
    // uniquement si déjà adjacent.
    if (dist <= 1) setInteractionMarker(questMarker);
  }, []);

  // ─── Clic sur une tuile portant un portail décoratif (🌀) — même logique que
  // GameCanvas2D.tsx::onPortalTileClick (attribution déterministe à un monde du catalogue).
  const onPortalTileClick3D = useCallback((wc: number, wr: number) => {
    if (dragStateRef.current?.dragged) return; // voir « Distinction glissé-souris / clic » ci-dessus
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    // 🔒 Téléportation par clic DÉSACTIVÉE (voir onMarkerClick3D ci-dessus).
    if (dist <= 1 && worldMarkers.length) {
      const idx = Math.floor(hashRand(wc, wr, 5) * worldMarkers.length);
      setInteractionMarker(worldMarkers[Math.min(worldMarkers.length - 1, idx)]);
    }
  }, [worldMarkers]);

  // ─── Clic sur une tuile portant une hutte décorative (🛖) — même logique que
  // GameCanvas2D.tsx::onHutTileClick (pop-up de repos, cooldown partagé HutRestModal).
  const onHutTileClick3D = useCallback((wc: number, wr: number) => {
    if (dragStateRef.current?.dragged) return; // voir « Distinction glissé-souris / clic » ci-dessus
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    // 🔒 Téléportation par clic DÉSACTIVÉE (voir onMarkerClick3D ci-dessus).
    if (dist <= 1) {
      setInteractionMarker({
        id: `hut-${wc}-${wr}`, kind: 'poi', poiType: 'hut',
        name: t(PROP_I18N_KEY.hut), icon: PROP_ICON.hut, x: wc, y: wr,
      });
    }
  }, [t]);

  // 🔒 Clic sur une tuile ordinaire : NE déplace/téléporte plus Synk (voir demande utilisateur,
  // § Téléportation par clic) — conservé comme no-op (plutôt que retiré de Scene) pour ne pas
  // modifier la signature de `TerrainBlock`/`PropBlock`/`Scene` plus que nécessaire.
  const onTileClick = useCallback((_wc: number, _wr: number) => {
    if (dragStateRef.current?.dragged) return;
  }, []);

  // Déplacement au clavier (flèches + WASD, y compris en diagonale) via useHoldMovement (voir
  // useHoldMovement.ts) — corrige le bug "Synk avance de 2 cases par appui" (répétition native OS
  // ignorée via `e.repeat`) et ajoute la course au maintien prolongé (movementRunHoldThresholdMs).
  const keysDownRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Gate `cryptMode` : tant que Synk explore un souterrain de crypte, les flèches/WASD sont
    // interceptées par l'effet dédié ci-dessous (voir `cryptKeyboard`) pour faire progresser
    // `cryptProgress` — SANS JAMAIS faire bouger le VRAI Synk "au-dessus", dans le monde normal.
    // Bug corrigé : ce garde-fou manquait auparavant, si bien qu'appuyer sur Haut/Bas dans le
    // souterrain faisait AUSSI avancer Synk dehors (parfois jusque sur une dalle d'eau), ce qui
    // déclenchait à tort le popup "Profondeur" (`EnvStatusPopupLayer`/`depthAltitudeUi` dans
    // GameCanvas2D.tsx/WorldMapWidget.tsx, qui lit la position RÉELLE de Synk, indépendamment de
    // ce widget) — voir aussi le nettoyage de `keysDownRef`/`releaseMovement` ci-dessous à l'entrée
    // en crypte, pour ne laisser aucune touche "fantôme" active au moment du changement de mode.
    if (collapsed || !enabled || (cryptMode && !towerTopActive && !roomTopActive)) return;
    const UP = new Set(['ArrowUp', 'w', 'W', 'z', 'Z']);
    const DOWN = new Set(['ArrowDown', 's', 'S']);
    const LEFT = new Set(['ArrowLeft', 'a', 'A', 'q', 'Q']);
    const RIGHT = new Set(['ArrowRight', 'd', 'D']);
    const ALL = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);
    const composite = () => {
      const keys = keysDownRef.current;
      const dy = [...UP].some(k => keys.has(k)) ? -1 : [...DOWN].some(k => keys.has(k)) ? 1 : 0;
      const dx = [...LEFT].some(k => keys.has(k)) ? -1 : [...RIGHT].some(k => keys.has(k)) ? 1 : 0;
      return { dx, dy };
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!ALL.has(e.key)) return;
      e.preventDefault();
      if (e.repeat) return;
      const wasIdle = keysDownRef.current.size === 0;
      keysDownRef.current.add(e.key);
      const { dx, dy } = composite();
      if (dx === 0 && dy === 0) return;
      if (wasIdle) hold.press(dx, dy); else hold.update(dx, dy);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!ALL.has(e.key)) return;
      keysDownRef.current.delete(e.key);
      const { dx, dy } = composite();
      if (dx === 0 && dy === 0) releaseMovement(); else hold.update(dx, dy);
    };
    // Relâche tout maintien clavier en cours si la fenêtre perd le focus (ex. Alt+Tab, changement
    // d'onglet) : sans cela, si le `keyup` correspondant n'est jamais livré à la page (cas classique
    // du focus perdu pendant qu'une touche reste physiquement enfoncée), `keysDownRef` gardait
    // indéfiniment cette touche "fantôme", faisant dériver toute pression future en une direction
    // composite inattendue (contribue au bug rapporté "déplacement erratique qui bloque Synk").
    const onBlur = () => { keysDownRef.current.clear(); releaseMovement(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      keysDownRef.current.clear();
      releaseMovement();
    };
  }, [collapsed, enabled, cryptMode, towerTopActive, roomTopActive, hold, releaseMovement]);

  // ─── Déplacement au clavier DANS le souterrain de crypte (flèches Haut/Bas uniquement, voir
  // demande utilisateur « l'on puisse utiliser le pavé directionnel flèches haut ou bas du clavier
  // pour avancer ou reculer ») — effet ENTIÈREMENT SÉPARÉ de celui ci-dessus (qui reste désactivé
  // tant que `cryptMode` est actif, voir le garde-fou ajouté plus haut) pour garantir une isolation
  // stricte entre les deux mondes : les touches ne modifient JAMAIS `worldPosRef`/`hold` (le "vrai"
  // Synk extérieur) pendant l'exploration du souterrain, seulement `cryptProgress`. Le répétiteur
  // natif du clavier (OS) est volontairement laissé actif (pas de filtre `e.repeat`) pour un effet
  // "maintenir pour avancer" simple, sans dupliquer `useHoldMovement` pour ce cas particulier.
  useEffect(() => {
    // 🆕 Désormais également coupé une fois `roomTopActive` (salle chambre/parchemin) : le
    // déplacement y est géré par l'effet clavier général ci-dessus (voir `dispatchMove`/`moveRoom`,
    // demande utilisateur « permet a Synk de se déplacer à l'aide des touches directionnelles du
    // clavier [...] afin de lui permettre de découvrir la pièce ») — les anciennes branches
    // `cryptDoorOpened` ci-dessous (Haut ignoré, Bas referme la porte) ne s'appliquaient QUE tant
    // que Synk n'avait aucun déplacement libre dans la salle ; sortir se fait maintenant en marchant
    // jusqu'à la porte et en cliquant dessus (voir `onLeaveRoom`/`onExitCrypt`).
    if (!cryptMode || towerTopActive || roomTopActive) return;
    // 🆕 Bascule de direction si Synk a fait 2 quarts de tour (demi-tour, voir § Quart de tour) :
    // presser « Avancer »/Haut doit alors le faire marcher vers la SORTIE (en avant, dans le sens où
    // il regarde désormais) plutôt que de continuer vers le fond du souterrain en marche arrière
    // (voir demande utilisateur « faire le retour [...] en avançant tout droit et non [...] en
    // marche arrière »).
    const advanceDir = cryptTurn === 2 ? -1 : 1;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const maxProgress = cryptTunnelLength + CRYPT_STAIR_STEPS;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (cryptDoorOpened) return; // plus de progression possible une fois la porte franchie
        setCryptProgress((p) => Math.max(0, Math.min(maxProgress, p + advanceDir)));
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (cryptDoorOpened) { setCryptDoorOpened(false); return; } // referme la porte (repart)
        setCryptProgress((p) => Math.max(0, Math.min(maxProgress, p - advanceDir)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cryptMode, towerTopActive, roomTopActive, cryptTunnelLength, cryptDoorOpened, cryptTurn]);

  // ─── Redimensionnement à la souris (coin bas-droit, voir onResizePointerMove) + plein écran natif
  // du navigateur (voir RepRules.platform3dResizableEnabled) — le conteneur 3D `fullscreenRef` (et
  // non tout le widget) passe en plein écran pour agrandir la scène jusqu'aux capacités maximales
  // de l'écran ; <Canvas> de React Three Fiber se redimensionne automatiquement (ResizeObserver
  // interne) dès que son conteneur CSS change de taille, sans code de redimensionnement manuel.
  const [size, setSize] = useState<Size>({ w: CANVAS_W, h: CANVAS_H });
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    const saved = readScoped(SIZE_KEY, address);
    if (saved) { try { setSize(JSON.parse(saved)); } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStart.current.x, dy = e.clientY - resizeStart.current.y;
    setSize({
      w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dx)),
      h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dy)),
    });
  };
  const onResizePointerUp = () => {
    if (!resizing) return;
    setResizing(false);
    localStorage.setItem(scopedKey(SIZE_KEY, address), JSON.stringify(size));
  };

  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === fullscreenRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (!fullscreenRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else fullscreenRef.current.requestFullscreen?.().catch(() => {});
  }, []);

  // ─── Glisser-déposer d'un objet de la besace vers le sol 3D (voir demande utilisateur "déposer
  // via un drag and drop [...] dans la vue [...] 3D du widget de la plateforme 3D") : la caméra
  // R3F courante est lue via `cameraRef` (voir CameraBridge ci-dessus, monté dans <Canvas>) pour
  // convertir la position souris en rayon 3D, intersecté avec le plan du sol (y=0, sommet des
  // dalles — voir TerrainBlock : boxGeometry hauteur 1 centrée en y=-0.5). Le point d'intersection
  // est exprimé DIRECTEMENT dans le repère de la Scene, où Synk est toujours à l'origine (0,0,0)
  // et chaque dalle affiche un décalage `dx=wc-centerCol`/`dz=wr-centerRow` (voir `Scene`'s `tiles`
  // useMemo) — donc arrondir (point.x, point.z) donne (dx, dz) sans transformation supplémentaire.
  const cameraRef = useRef<THREE.Camera | null>(null);
  const groundPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const raycasterRef = useRef(new THREE.Raycaster());
  const [dropFeedback3D, setDropFeedback3D] = useState<string | null>(null);
  const onPlatform3DDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId || !address) return;
    const item = inventory.find(i => i.itemId === itemId);
    if (!item) return;
    const camera = cameraRef.current;
    const container = fullscreenRef.current;
    if (!camera || !container) return;
    const rect = container.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hit = new THREE.Vector3();
    if (!raycasterRef.current.ray.intersectPlane(groundPlaneRef.current, hit)) return;
    const dx = Math.round(hit.x), dz = Math.round(hit.z);
    if (Math.abs(dx) > VIEW_RADIUS || Math.abs(dz) > VIEW_RADIUS) return; // hors du terrain rendu
    const rawWc = centerCol + dx, rawWr = centerRow + dz;
    if (rawWc < 0 || rawWc > WORLD_SIZE || rawWr < 0 || rawWr > WORLD_SIZE) return;
    dropInventoryItemAt(address, item, clamp100(rawWc), clamp100(rawWr), 1).then((ok) => {
      if (ok) {
        setDropFeedback3D(t('game.inventory.worldDropSuccess', { name: localizeName(t, `item.${item.itemId}`, item.name) }));
        setTimeout(() => setDropFeedback3D(null), 3000);
      }
    }).catch(() => {});
  }, [address, inventory, centerCol, centerRow, t]);

  // ─── Sortie COMPLÈTE du souterrain de crypte (voir demande utilisateur « Enlève et désactive le
  // bouton Sortir [...] Synk pourra sortir en cliquant avec le bouton gauche de la souris sur la
  // porte de la crypte [...] il faudra bien sûr pour cela qu'il soit à proximité de la porte de
  // sortie ») — remplace l'ancien bouton HUD « 🚪 Sortir » (retiré, voir plus bas) : la SEULE façon
  // de quitter entièrement un souterrain (tour/chambre/parchemin) est désormais de revenir jusqu'à
  // la porte d'entrée (`CryptTunnelScene.tsx::onExitCrypt`, nouvelle porte posée à `poses[0]`) et de
  // cliquer dessus, EXACTEMENT comme pour les autres portes du jeu. `ENTRANCE_EXIT_MAX_PROGRESS`
  // borne la proximité exigée (même rationale que `ROOM_DOOR_PROXIMITY` ci-dessus) : cliquer ne fait
  // rien tant que Synk n'est pas revenu tout près de l'entrée (`cryptProgress` proche de 0).
  const ENTRANCE_EXIT_MAX_PROGRESS = 1;
  const exitCrypt = useCallback(() => {
    if (cryptProgress > ENTRANCE_EXIT_MAX_PROGRESS) return;
    // 🆕 Retourne Synk à l'opposé EXACT de la direction qu'il regardait en entrant (face à la porte,
    // voir `preCryptFacingRef`) — donne l'impression qu'il sort véritablement de la crypte plutôt que
    // de s'apprêter à y rentrer à nouveau (demande utilisateur « il faut que Synk soit face à la
    // sortie [...] à l'inverse de la porte »). Même principe que le retournement automatique
    // appliqué à la sortie d'une salle/du donjon (voir `onLeaveRoom`/`onToggleDoor` de `TowerTopScene`
    // plus bas, `setCryptTurn(2)`), mais ici sur `facing` (monde extérieur en 3e personne) plutôt que
    // sur `cryptTurn` (vue 1re personne du souterrain).
    const exitFacing = OPPOSITE_DIRECTION[preCryptFacingRef.current] ?? 'down';
    // Caméra : NE PLUS la positionner ici de façon SYNCHRONE (voir doc de `pendingExitCameraRef`/
    // `CryptExitCameraGuard` ci-dessous, § course avec `CryptCamera` ET § décor non garanti dégagé)
    // — on mémorise simplement l'angle visé, appliqué par `<CryptExitCameraGuard>` (monté DANS le
    // `<Canvas>`, aux côtés de `<Scene>`/`<CameraBridge>`) une fois `<CryptTunnelScene>` réellement
    // démonté.
    const exitAngle = FACING_ANGLE[exitFacing] ?? 0;
    pendingExitCameraRef.current = { angle: exitAngle, radius: CRYPT_EXIT_CAMERA_RADIUS };
    setExitCamRequestId((v) => v + 1);
    setFacing(exitFacing);
    setCryptMode(null);
    setCryptDoorOpened(false);
  }, [cryptProgress]);

  if (!enabled || !address || !pos) return null;

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
          title={t('game.platform3d.widgetTitle')}
          data-synk-pos={`${worldPos.x},${worldPos.y}`}
          data-widget-collapsed="1"
          data-roaming-npc={`${roamingActors.npcMarkerId ?? ''},${roamingActors.npc.x},${roamingActors.npc.y}`}
          data-roaming-dragon={`${roamingActors.dragonMarkerId ?? ''},${roamingActors.dragon.x},${roamingActors.dragon.y}`}
          data-roaming-familiars={JSON.stringify(roamingActors.familiars)}
          data-roaming-wildlife={JSON.stringify(roamingActors.wildlife)}
        >🧊</button>
        <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      </>
    );
  }

  const dpadBtn = 'flex items-center justify-center rounded bg-lime-900/80 hover:bg-lime-700 active:bg-lime-600 border border-lime-600 text-lime-100 text-sm shadow select-none';
  const resizableEnabled = rules?.platform3dResizableEnabled ?? true;
  const underwaterEnabled = rules?.platform3dUnderwaterWorldEnabled ?? true;

  // Capture le pointeur dès l'appui sur un bouton du pavé directionnel virtuel : sans cela, un
  // léger tremblement de souris sur ce petit bouton (~28px) peut déclencher un `pointerleave`
  // natif prématuré qui relâche la touche AVANT le seuil de course (movementRunHoldThresholdMs),
  // empêchant Synk de jamais se mettre à courir au pavé (corrige ce bug signalé par l'utilisateur).
  // Une fois le pointeur capturé, seuls `pointerup`/`pointercancel` sur CE bouton y mettent fin.
  const onDpadDown = (e: React.PointerEvent<HTMLButtonElement>, dx: number, dy: number) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    hold.press(dx, dy);
  };
  const jumpEnabled = rules?.platform3dJumpEnabled ?? true;
  // Bouton "Sauter" tactile (voir jumpHeldRef ci-dessus) : équivalent virtuel de la touche Espace,
  // combinable avec le pavé directionnel virtuel (maintenir ce bouton PUIS presser une direction du
  // pavé, comme au clavier Espace+flèche) — corrige l'absence totale d'équivalent tactile à Espace.
  const onJumpDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    jumpHeldRef.current = true;
  };
  const onJumpUp = () => { jumpHeldRef.current = false; };

  return (
    <div
      ref={containerRef}
      className="fixed z-40 bg-slate-950 border-2 border-lime-500 rounded-xl shadow-2xl select-none"
      style={{ left: pos.x, top: pos.y, width: size.w, zIndex: z }}
      onPointerDownCapture={(e) => handleWidgetPointerDownCapture(e, bringToFront)}
      onContextMenu={onContextMenu}
      data-synk-pos={`${worldPos.x},${worldPos.y}`}
      data-synk-running={isRunning ? '1' : '0'}
      data-roaming-npc={`${roamingActors.npcMarkerId ?? ''},${roamingActors.npc.x},${roamingActors.npc.y}`}
      data-roaming-dragon={`${roamingActors.dragonMarkerId ?? ''},${roamingActors.dragon.x},${roamingActors.dragon.y}`}
      data-roaming-familiars={JSON.stringify(roamingActors.familiars)}
      data-roaming-wildlife={JSON.stringify(roamingActors.wildlife)}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-lime-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">🧊 {t('game.platform3d.widgetTitle')}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {resizableEnabled && (
            <button
              className="text-xs opacity-70 hover:opacity-100"
              onClick={toggleFullscreen}
              title={t(isFullscreen ? 'game.platform3d.exitFullscreen' : 'game.platform3d.fullscreen')}
            >{isFullscreen ? '🗗' : '⛶'}</button>
          )}
          <button className="text-xs opacity-70 hover:opacity-100" data-widget-close onClick={toggleCollapsed}>✕</button>
        </div>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div
        ref={fullscreenRef} className="relative bg-slate-950"
        style={{ width: isFullscreen ? '100vw' : size.w, height: isFullscreen ? '100vh' : size.h }}
        onPointerDown={onCanvasPointerDownForDrag} onPointerMove={onCanvasPointerMoveForDrag}
        onDragOver={(e) => { if (!underwaterMode) e.preventDefault(); }}
        onDrop={(e) => { if (!underwaterMode) onPlatform3DDrop(e); }}
        onContextMenu={(e) => {
          // Menu "nager/plonger" (voir RepRules.platform3dUnderwaterWorldEnabled) proposé
          // UNIQUEMENT quand Synk est déjà sur une dalle d'eau et pas encore en pleine plongée ;
          // sinon on laisse l'événement remonter au conteneur du widget (menu de repositionnement
          // existant, WidgetContextMenu — zéro régression en dehors de l'eau).
          if (swimming && !underwaterMode && underwaterEnabled) {
            e.preventDefault();
            e.stopPropagation();
            setWaterMenuPos({ x: e.clientX, y: e.clientY });
          }
        }}
      >
        <Canvas
          shadows={rules?.platform3dShadowsEnabled ?? true}
          camera={{ position: [0, 3.2, 5.6], fov: 45 }}
          dpr={[1, 2]}
          // Stoppe totalement le rendu quand l'onglet n'est pas visible (voir `documentVisible`
          // ci-dessus) — AUCUN effet quand l'onglet est au premier plan (`'always'`, comportement
          // strictement identique à avant), donc zéro régression de fluidité pendant le jeu actif.
          frameloop={documentVisible ? 'always' : 'never'}
          gl={{
            // Corrige une saturation GPU signalée par un utilisateur (Task Manager : GPU intégré
            // Intel UHD à ~97-100% pendant que le GPU dédié NVIDIA restait à ~8%, ventilateurs
            // s'emballant anormalement) : sans indice explicite, Chromium/Windows peut router le
            // contexte WebGL vers le GPU basse consommation par défaut, qui sature bien plus vite
            // que le GPU dédié sur la même charge de rendu 3D. `high-performance` demande le GPU
            // le plus véloce disponible (paramétrable, voir platform3dHighPerformanceGpuEnabled
            // dans le menu Administration — repli sur 'default' si désactivé). `stencil: false`
            // évite l'allocation inutile d'un tampon de stencil que la scène n'utilise nulle part
            // (aucun clippingPlanes/stencilFunc ailleurs dans le code) : micro-optimisation
            // mémoire/bande passante à coût nul, sans aucun impact visuel. On NE désactive PAS
            // `alpha` : `SkyBackdrop` (Platform3DAmbientScene.tsx) met `scene.background = null` de
            // nuit pour laisser transparaître le fond `bg-slate-950` du conteneur DOM — le
            // désactiver changerait la couleur de fond nocturne (noir pur au lieu du bleu-noir
            // `slate-950`), une régression visuelle subtile à éviter.
            powerPreference: (rules?.platform3dHighPerformanceGpuEnabled ?? true) ? 'high-performance' : 'default',
            stencil: false,
            // Anticrénelage désactivable en dépannage GPU limité (voir platform3dAntialiasEnabled,
            // défaut true = comportement identique à avant ce réglage).
            antialias: rules?.platform3dAntialiasEnabled ?? true,
          }}
        >
          {towerTopActive ? (
            <TowerTopScene
              stage={stage} facing={facing} equipment={equipment}
              equipmentRenderEnabled={rules?.platform3dEquipmentRenderEnabled ?? true}
              pos={towerPos} walking={isWalking} running={isRunning}
              eyeBlinkEnabled={rules?.synkEyeBlinkEnabled ?? true}
              eyeBlinkIntervalSec={rules?.synkEyeBlinkIntervalSec ?? 4}
              onToggleDoor={() => {
                // 🆕 Ce `onToggleDoor` (passé à `TowerTopScene`) n'est appelé QUE lorsque la porte
                // de la tour est déjà ouverte (`towerTopActive` implique `cryptDoorOpened===true`,
                // voir sa définition) : c'est TOUJOURS une sortie de la tour vers l'escalier, jamais
                // une entrée. `setCryptTurn(2)` retourne Synk/la caméra du couloir vers l'ENTRÉE
                // (demi-tour, même mécanique que le bouton manuel ↺/↻) au lieu de rester face à la
                // porte qu'il vient de franchir — demande utilisateur « il faudrait que Synk soit
                // orienté vers la direction de la sortie [...] face à l'escalier et non [...] face à
                // la porte qu'il vient d'ouvrir ».
                setCryptDoorOpened(false);
                setCryptTurn(2);
              }}
              torchFlickerEnabled={rules?.cryptTorchFlickerEnabled ?? true}
              markers={sceneMarkers}
              centerCol={centerCol} centerRow={centerRow} poiPoints={poiPoints}
              objectFlags={rules?.platform3dObjectFlags}
              fireBreathEnabled={rules?.dragonFireBreathEnabled ?? true}
              fireBreathIntervalSec={rules?.dragonFireBreathIntervalSec ?? 60}
              wildlifeAudio={wildlifeAudio}
              owlHootEnabled={worldAmbience.theme?.elements?.owlHootEnabled}
              werewolfHowlEnabled={worldAmbience.theme?.elements?.werewolfHowlEnabled}
            />
          ) : cryptMode ? (
            <CryptTunnelScene
              cryptId={cryptMode} progress={cryptProgress} tunnelLength={cryptTunnelLength}
              torchFlickerEnabled={rules?.cryptTorchFlickerEnabled ?? true}
              batCount={rules?.cryptBatCount ?? 5}
              doorOpened={cryptDoorOpened}
              onToggleDoor={() => setCryptDoorOpened((v) => !v)}
              parchmentTaken={takenParchmentIds.has(cryptMode)}
              onParchmentClick={() => setParchmentPopupCryptId(cryptMode)}
              turnOffset={cryptTurn}
              synkSlot={cryptDoorOpened && cryptRoomType !== 'tower' ? (
                <SynkVoxel
                  stage={stage} walking={isWalking} running={isRunning} swimming={false} jumpTrigger={jumpTrigger}
                  facing={facing} equipment={equipment} equipmentRenderEnabled={rules?.platform3dEquipmentRenderEnabled ?? true}
                  standY={roomPos.standY} eyeBlinkEnabled={rules?.synkEyeBlinkEnabled ?? true} eyeBlinkIntervalSec={rules?.synkEyeBlinkIntervalSec ?? 4}
                />
              ) : null}
              roomSynkPos={{ x: roomPos.x, z: roomPos.y }}
              onLeaveRoom={() => {
                // 🆕 Proximité exigée (voir doc de `ROOM_DOOR_PROXIMITY` ci-dessus) avant de pouvoir
                // refermer la porte de la salle et repartir dans l'escalier. `setCryptTurn(2)` :
                // même correctif que `TowerTopScene::onToggleDoor` ci-dessus, Synk/la caméra du
                // couloir se retournent automatiquement vers l'ENTRÉE au lieu de rester face à la
                // porte de la salle qu'il vient de franchir.
                const d = Math.hypot(roomPos.x - ROOM_DOOR_LOCAL.x, roomPos.y - ROOM_DOOR_LOCAL.z);
                if (d <= ROOM_DOOR_PROXIMITY) { setCryptDoorOpened(false); setCryptTurn(2); }
              }}
              onExitCrypt={exitCrypt}
              onHiddenDragonClick={
                cryptMode === HIDDEN_DRAGON_CRYPT_ID && !hiddenDragonTaken
                  ? () => setHiddenFamiliarPopupOpen(true)
                  : undefined
              }
            />
          ) : underwaterMode ? (
            <UnderwaterScene
              stage={stage} facing={facing} equipment={equipment}
              equipmentRenderEnabled={rules?.platform3dEquipmentRenderEnabled ?? true}
              fishCount={rules?.platform3dUnderwaterFishCount ?? 10}
              monsterCount={rules?.platform3dUnderwaterMonsterCount ?? 2}
              pos={underwaterPos} walking={isWalking} running={isRunning}
              eyeBlinkEnabled={rules?.synkEyeBlinkEnabled ?? true}
              eyeBlinkIntervalSec={rules?.synkEyeBlinkIntervalSec ?? 4}
            />
          ) : (
            <>
              <CameraBridge cameraRef={cameraRef} />
              <CryptExitCameraGuard requestId={exitCamRequestId} pendingRef={pendingExitCameraRef} />
              <Platform3DAmbientScene isNight={worldAmbience.isNight} theme={worldAmbience.theme} moonPhase={worldAmbience.moonPhase} />
              <Scene
                centerCol={centerCol} centerRow={centerRow} poiPoints={poiPoints} sceneMarkers={sceneMarkers}
                stage={stage} walking={isWalking} running={isRunning} swimming={swimming} jumpTrigger={jumpTrigger}
                facing={facing} equipment={equipment} equipmentRenderEnabled={rules?.platform3dEquipmentRenderEnabled ?? true}
                standY={standY}
                onTileClick={onTileClick} onPortalTileClick={onPortalTileClick3D} onHutTileClick={onHutTileClick3D}
                onMarkerClick={onMarkerClick3D}
                onExtraQuestClick={onExtraQuestClick3D}
                eyeBlinkEnabled={rules?.synkEyeBlinkEnabled ?? true}
                eyeBlinkIntervalSec={rules?.synkEyeBlinkIntervalSec ?? 4}
                objectFlags={rules?.platform3dObjectFlags}
                fireBreathEnabled={rules?.dragonFireBreathEnabled ?? true}
                fireBreathIntervalSec={rules?.dragonFireBreathIntervalSec ?? 60}
                wildlifeAudio={wildlifeAudio}
                owlHootEnabled={worldAmbience.theme?.elements?.owlHootEnabled}
                werewolfHowlEnabled={worldAmbience.theme?.elements?.werewolfHowlEnabled}
                orbitControlsRef={orbitControlsRef} recentering={recentering} onRecenterComplete={handleRecenterComplete}
                stargateActivation={stargateActivation}
                onRequestStargateActivation={requestStargateActivation}
                onCompleteStargateActivation={completeStargateActivation}
              />
            </>
          )}
        </Canvas>
        {dropFeedback3D && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none z-20">
            <span className="bg-slate-900/90 border border-amber-500 text-amber-200 text-[11px] rounded-full px-3 py-1 shadow-xl">
              {dropFeedback3D}
            </span>
          </div>
        )}
        {underwaterMode && (
          <>
            <div className="absolute top-1.5 left-1.5 right-1.5 bg-sky-950/80 rounded px-2 py-1 text-[10px] text-sky-200 pointer-events-none">
              🤿 {t('game.platform3d.underwater.title')}
              <span className="block text-[9px] text-sky-300/80 mt-0.5">{SEA_MONSTER_NAMES.join(' · ')}</span>
            </div>
            <button
              className="absolute top-1.5 right-1.5 mt-6 bg-sky-700 hover:bg-sky-600 text-white text-[11px] rounded px-2 py-1 shadow z-10"
              onClick={() => setUnderwaterMode(false)}
            >⬆️ {t('game.platform3d.underwater.surface')}</button>
          </>
        )}
        {waterMenuPos && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setWaterMenuPos(null)} onContextMenu={(e) => { e.preventDefault(); setWaterMenuPos(null); }} />
            <div
              className="fixed z-[91] bg-slate-900 border border-sky-500 rounded-lg shadow-xl py-1 text-sm"
              style={{ left: waterMenuPos.x, top: waterMenuPos.y }}
            >
              <button className="block w-full text-left px-3 py-1.5 hover:bg-sky-800/60 text-sky-100" onClick={() => setWaterMenuPos(null)}>
                🏊 {t('game.platform3d.underwater.swim')}
              </button>
              <button className="block w-full text-left px-3 py-1.5 hover:bg-sky-800/60 text-sky-100" onClick={() => { underwaterPosRef.current = { x: 0, y: 0 }; setUnderwaterPos({ x: 0, y: 0 }); setUnderwaterMode(true); setWaterMenuPos(null); }}>
                🤿 {t('game.platform3d.underwater.dive')}
              </button>
            </div>
          </>
        )}
        {!underwaterMode && !cryptMode && (
        <div className="absolute top-1.5 left-1.5 bg-slate-900/70 rounded px-2 py-1 text-[10px] text-lime-200 pointer-events-none">
          {swimming ? '🏊 ' + t('game.platform3d.swimming') : isRunning ? '🏃 ' + t('game.platform3d.running') : '🚶 ' + t('game.platform3d.walking')}
          {player && <span className="ml-2">💨 {Math.round(player.oxygen ?? 100)}% · 🔋 {Math.round(player.fatigue ?? 100)}%</span>}
        </div>
        )}
        {/* ─── Boussole N/E/S/O translucide + bouton de recentrage vers le Nord (voir demande
            utilisateur et RepRules.platform3dCompassIdleRecenterSec) — rose des vents FIXE (le Nord
            reste toujours en haut, elle NE tourne PAS avec l'orbite de la caméra : seule l'aiguille
            pivote, selon `COMPASS_NEEDLE_DEG[facing]`), placée dans le coin libre en haut à droite de
            la vue 3D. Masquée en mode sous-marin (le monde immergé a son propre repère/caméra bornée
            à un petit rayon d'exploration, voir UnderwaterScene — un cap Nord/Sud n'y a pas de sens)
            et en souterrain de crypte (couloir rectiligne à sens unique, voir overlay crypt ci-dessus
            qui affiche déjà la progression — un cap N/E/S/O n'y a pas plus de sens). */}
        {!underwaterMode && !cryptMode && (
          <div className="absolute top-1.5 right-1.5 z-10 flex flex-col items-center gap-1">
            {/* `backdrop-blur-sm` volontairement RETIRÉ (voir signalement GPU + investigation du
                commit d'origine, § Suite 2 de docs/ARCHITECTURE.md) : un flou de fond (`backdrop-
                filter`) posé en permanence au-dessus d'un `<canvas>` WebGL qui rend en continu force
                le compositeur à ré-échantillonner ce flou à chaque frame (60x/s), un coût de
                compositing bien documenté et particulièrement pénalisant sur les GPU intégrés —
                remplacé par un fond opaque légèrement plus sombre (`/80` au lieu de `/60`) pour
                conserver la lisibilité et l'esprit « translucide » sans aucun recalcul de flou.
                Purement cosmétique : aucun impact gameplay/fluidité, uniquement un allègement. */}
            <div
              className="relative w-14 h-14 rounded-full bg-slate-900/80 border border-lime-400/60 pointer-events-none"
              title={t('game.platform3d.compass.title')}
            >
              <span className="absolute inset-x-0 top-0.5 text-center text-[9px] font-bold text-lime-200">{t('game.platform3d.compass.n')}</span>
              <span className="absolute inset-x-0 bottom-0.5 text-center text-[9px] font-bold text-lime-200/70">{t('game.platform3d.compass.s')}</span>
              <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-lime-200/70">{t('game.platform3d.compass.w')}</span>
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-lime-200/70">{t('game.platform3d.compass.e')}</span>
              <div
                className="absolute left-1/2 top-1/2 w-1 h-5 -ml-0.5 -mt-5 origin-bottom rounded-full bg-gradient-to-t from-rose-600/40 to-rose-400"
                style={{ transform: `rotate(${COMPASS_NEEDLE_DEG[facing]}deg)`, transformOrigin: '50% 100%' }}
              />
            </div>
            <button
              className="pointer-events-auto text-[10px] leading-none bg-slate-900/70 hover:bg-slate-800 border border-lime-500/60 text-lime-200 rounded px-2 py-1 shadow"
              onClick={triggerRecenter}
              title={t('game.platform3d.compass.resetTitle')}
            >🧭 {t('game.platform3d.compass.resetButton')}</button>
          </div>
        )}
        {islandBlockedMsg && (
          <div className="absolute top-8 left-1.5 right-1.5 bg-amber-900/90 text-amber-100 text-[11px] rounded px-2 py-1 text-center">
            {islandBlockedMsg}
          </div>
        )}
        {fallDamagePopup && (
          <div className="absolute top-8 left-1.5 right-1.5 bg-rose-900/90 text-rose-100 text-[11px] rounded px-2 py-1 text-center">
            🩹 {t('game.platform3d.fallDamage', { hp: fallDamagePopup.hp, xp: fallDamagePopup.xp })}
          </div>
        )}
        {fallDeath && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[95] p-3 text-center">
            <div>
              <p className="text-2xl mb-1">💀</p>
              <h3 className="text-base font-bold text-rose-300 mb-1">{t('game.platform3d.fallDeath.title')}</h3>
              <p className="text-[11px] text-slate-300 mb-2">{t('game.platform3d.fallDeath.description', { xp: rules?.platform3dFallDeathXp ?? 300 })}</p>
              <p className="text-3xl font-mono text-rose-300">{fallDeath.remaining}s</p>
            </div>
          </div>
        )}
        {(!cryptMode || towerTopActive || roomTopActive) && (
        <div className="absolute bottom-2 left-2 grid grid-cols-3 grid-rows-3 gap-0.5 w-[84px] h-[84px] z-10" title={t('canvas2d.dpadTitle')}>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, -1, -1)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadUpLeft')}>↖</button>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, 0, -1)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadUp')}>▲</button>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, 1, -1)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadUpRight')}>↗</button>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, -1, 0)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadLeft')}>◀</button>
          {jumpEnabled ? (
            <button
              tabIndex={-1}
              className={dpadBtn + ' bg-amber-800/80 hover:bg-amber-600 border-amber-500'}
              style={{ touchAction: 'none' }}
              onPointerDown={onJumpDown} onPointerUp={onJumpUp} onPointerLeave={onJumpUp} onPointerCancel={onJumpUp}
              title={t('game.platform3d.jumpButton')}
            >⤴️</button>
          ) : <div />}
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, 1, 0)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadRight')}>▶</button>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, -1, 1)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadDownLeft')}>↙</button>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, 0, 1)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadDown')}>▼</button>
          <button tabIndex={-1} className={dpadBtn} style={{ touchAction: 'none' }} onPointerDown={(e) => onDpadDown(e, 1, 1)} onPointerUp={releaseMovement} onPointerLeave={releaseMovement} onPointerCancel={releaseMovement} title={t('canvas2d.dpadDownRight')}>↘</button>
        </div>
        )}
        {/* ─── Overlay souterrain de crypte (voir CryptTunnelScene.tsx) — remplace totalement le
            dpad (masqué ci-dessus) tant que `cryptMode` est actif : « ▲ Avancer »/« ▼ Reculer » (ou
            les flèches Haut/Bas du clavier, voir l'effet dédié plus haut) font progresser/reculer
            `cryptProgress` dans le couloir PUIS l'escalier (voir `cryptTunnelLength`/
            `CRYPT_STAIR_STEPS` pour les bornes de chaque phase), jusqu'à la porte — une fois la
            porte franchie (`cryptDoorOpened`), « ▲ Avancer » est désactivé (plus de couloir à
            parcourir) et « ▼ Reculer » referme la porte au lieu de reculer. La sortie COMPLÈTE du
            souterrain se fait désormais en cliquant sur la porte d'entrée (voir `exitCrypt`) plutôt
            que via un bouton HUD (retiré, voir § Suppression du bouton « Sortir ») : elle restaure
            TOUJOURS une pose de caméra par défaut calculée selon la direction de sortie (voir
            `cryptExitCameraPosFor`) et retourne
            Synk à l'opposé de la direction qu'il regardait en entrant (voir `preCryptFacingRef`). */}
        {cryptMode && (() => {
          const inStairs = cryptProgress > cryptTunnelLength;
          const maxProgress = cryptTunnelLength + CRYPT_STAIR_STEPS;
          const atDoor = cryptProgress >= maxProgress;
          // 🆕 Bascule de direction si demi-tour (voir § Quart de tour / effet clavier ci-dessus) —
          // garde les libellés et l'état désactivé des boutons cohérents avec le sens RÉEL de
          // progression une fois que Synk regarde vers la sortie plutôt que vers le fond.
          const advanceDir = cryptTurn === 2 ? -1 : 1;
          return (
          <>
            <div className="absolute top-1.5 left-1.5 right-1.5 bg-stone-950/85 rounded px-2 py-1 text-[10px] text-stone-300 pointer-events-none">
              {cryptDoorOpened ? (
                <>🏰 {t('game.platform3d.crypt.roomTitle')}</>
              ) : inStairs ? (
                <>🪜 {t('game.platform3d.crypt.stairsTitle')}
                  <span className="block text-[9px] text-stone-400/80 mt-0.5">
                    {Math.min(cryptProgress - cryptTunnelLength, CRYPT_STAIR_STEPS)} / {CRYPT_STAIR_STEPS}
                  </span>
                </>
              ) : (
                <>🕯️ {t('game.platform3d.crypt.title')}
                  <span className="block text-[9px] text-stone-400/80 mt-0.5">
                    {Math.min(cryptProgress, cryptTunnelLength)} / {cryptTunnelLength}
                  </span>
                </>
              )}
              {atDoor && !cryptDoorOpened && (
                <span className="block text-[9px] text-amber-300 mt-0.5">🚪 {t('game.platform3d.crypt.doorHint')}</span>
              )}
            </div>
            {/* 🆕 Quart de tour à gauche/droite (voir demande utilisateur « 2 boutons [...] sous
                la forme d'un pavé directionnel permettant de faire à chaque clique souris 1/4 de
                tour à gauche ou à droite ») — masqué une fois la porte franchie (la salle
                d'arrivée a déjà une vue libre à la souris via `<OrbitControls>`). */}
            {!cryptDoorOpened && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
                <button
                  tabIndex={-1} className={dpadBtn + ' bg-stone-800/90'}
                  onClick={() => setCryptTurn((v) => ((v + 3) % 4) as 0 | 1 | 2 | 3)}
                  title={t('game.platform3d.crypt.turnLeft')}
                >↺</button>
                <button
                  tabIndex={-1} className={dpadBtn + ' bg-stone-800/90'}
                  onClick={() => setCryptTurn((v) => ((v + 1) % 4) as 0 | 1 | 2 | 3)}
                  title={t('game.platform3d.crypt.turnRight')}
                >↻</button>
              </div>
            )}
            {/* 🆕 Boutons « ▲ Avancer »/« ▼ Reculer » — UNIQUEMENT tant que la porte d'arrivée n'est
                pas franchie (`!cryptDoorOpened`, couloir + escalier) : une fois dans la salle
                (tour/chambre/parchemin), Synk se déplace librement au dpad/clavier (voir
                `dispatchMove` § towerTopActive/roomTopActive) — le bouton « 🚪 Sortir » a été
                RETIRÉ (voir demande utilisateur « Enlève et désactive le bouton Sortir [...] Synk
                pourra sortir en cliquant [...] sur la porte de la crypte [...] à proximité ») : la
                sortie complète se fait désormais UNIQUEMENT en revenant jusqu'à la porte d'entrée du
                souterrain et en cliquant dessus (voir `CryptTunnelScene.tsx::onExitCrypt`/
                `exitCrypt` ci-dessus), à l'identique des autres portes du jeu. */}
            {!cryptDoorOpened && (
            <div className="absolute bottom-2 left-2 flex flex-col gap-1 z-10">
              <button
                tabIndex={-1} className={dpadBtn + ' w-[84px] bg-stone-800/90 disabled:opacity-40'}
                disabled={advanceDir === 1 ? atDoor : cryptProgress <= 0}
                onClick={() => setCryptProgress((p) => Math.max(0, Math.min(maxProgress, p + advanceDir)))}
                title={t('game.platform3d.crypt.advance')}
              >▲ {t('game.platform3d.crypt.advance')}</button>
              <button
                tabIndex={-1} className={dpadBtn + ' w-[84px] bg-stone-800/90 disabled:opacity-40'}
                disabled={advanceDir === 1 ? cryptProgress <= 0 : atDoor}
                onClick={() => setCryptProgress((p) => Math.max(0, Math.min(maxProgress, p - advanceDir)))}
                title={t('game.platform3d.crypt.retreat')}
              >▼ {t('game.platform3d.crypt.retreat')}</button>
            </div>
            )}
          </>
          );
        })()}
        {!cryptMode && (
        <p className="absolute bottom-2 right-2 text-[9px] text-slate-500 max-w-[180px] text-right pointer-events-none">
          {t('game.platform3d.hint')}
        </p>)}
        {!isFullscreen && resizableEnabled && (
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-lime-400/70 flex items-center justify-center text-[10px] z-20"
            onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp}
          >⤡</div>
        )}
      </div>
      <PoiInteractionModal
        marker={interactionMarker}
        address={address}
        playerXp={playerXp}
        playerWallet={player?.wallet ?? 0}
        rules={rules}
        onClose={() => setInteractionMarker(null)}
        onRequestHutRest={() => setHutResting(true)}
        onRequestEnterCrypt={(cryptId) => {
          // 🆕 Capture la direction de Synk à cet instant (voir `preCryptFacingRef`) — c'est la
          // direction « face à la porte » à inverser lors de la sortie complète (`exitCrypt`).
          preCryptFacingRef.current = facing;
          playAmbientSound('doorCreak', wildlifeAudio);
          setCryptMode(cryptId); setCryptProgress(0); setCryptDoorOpened(false); setCryptTurn(0); setInteractionMarker(null);
        }}
      />
      {parchmentPopupCryptId && (
        <ParchmentPopup
          cryptId={parchmentPopupCryptId}
          address={address}
          onClose={() => setParchmentPopupCryptId(null)}
        />
      )}
      {hiddenFamiliarPopupOpen && (
        <HiddenFamiliarPopup
          address={address}
          onClose={() => setHiddenFamiliarPopupOpen(false)}
        />
      )}
      {rules && (
        <HutRestModal
          active={hutResting}
          rules={rules}
          onDone={(result) => {
            setHutResting(false);
            setHutFeedback(result === 'ok' ? t('hutRest.done.ok', { hp: rules.hutRestHp }) : t('hutRest.done.cooldown'));
            setTimeout(() => setHutFeedback(null), 4000);
          }}
        />
      )}
      {hutFeedback && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center z-[101] pointer-events-none">
          <span className="bg-slate-900 border border-amber-500 text-amber-200 text-sm rounded-full px-4 py-2 shadow-xl">
            {hutFeedback}
          </span>
        </div>
      )}
      {stargateFeedback && typeof document !== 'undefined' && createPortal(
        // 🆕 Popup centré (même structure que PoiInteractionModal.tsx — fond slate-900, bordure
        // cyan, titre+icône, croix de fermeture, bouton "Fermer" pleine largeur) remplaçant l'ancien
        // bandeau bas en forme de pilule (demande utilisateur « affiche le popup de cette manière et
        // comme tous les autres [...] et non pas un message comme cela »).
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[101] p-4" onClick={() => setStargateFeedback(null)}>
          <div className="bg-slate-900 border-2 border-cyan-500 rounded-xl p-5 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-cyan-300">🌀 {t('stargate.feedback.title')}</h3>
              <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setStargateFeedback(null)}>✕</button>
            </div>
            <p className="text-xs text-amber-400">{stargateFeedback}</p>
            <button className="btn-secondary text-xs w-full mt-4" onClick={() => setStargateFeedback(null)}>{t('common.close')}</button>
          </div>
        </div>,
        document.body,
      )}
      {stargateActivation && (
        <div className="fixed inset-x-0 top-20 flex justify-center z-[101] pointer-events-none">
          <span className="bg-slate-900 border border-violet-500 text-violet-200 text-sm rounded-full px-4 py-2 shadow-xl">
            {t('stargate.activating', { sec: Math.max(0, Math.ceil((stargateActivation.startedAt + stargateActivation.durationMs - stargateNow) / 1000)) })}
          </span>
        </div>
      )}
    </div>
  );
}
