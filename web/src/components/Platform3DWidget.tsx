'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  subscribePlayer, subscribeInventory, getKingdomQuestMarker, subscribeSolvedQuestIds,
  getZorghonEncounter, subscribeZorghonEncounter, subscribeEquipment, applyEffect,
  DEFAULT_PLATFORM3D_OBJECT_FLAGS,
  type MapMarker, type MapPoiType, type RepRules, type PlayerState, type InventoryItem,
  type ZorghonEncounterState, type SynkDirection, type EquipSlot, type EquippedItem,
  type Platform3DObjectKind, type Platform3DObjectFlags,
} from '@/lib/gameState';
import {
  worldTileAt, clamp100, WORLD_SIZE, TERRAIN_COLOR, PROP_ICON, PROP_I18N_KEY, hashRand,
  isObstacleAt, type Tile,
} from '@/lib/worldTerrain';
import { STAGE_NAMES } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex, handleWidgetPointerDownCapture } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { useHoldMovement } from '@/lib/useHoldMovement';
import { setPlatform3DActive } from '@/lib/platform3dActive';
import { WidgetContextMenu } from './WidgetContextMenu';
import { PoiInteractionModal } from './PoiInteractionModal';
import { HutRestModal } from './HutRestModal';
import { useEffectiveAccount } from '@/lib/effectiveAccount';

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
 * GameCanvas2D.tsx/SynkSkin.tsx (voir SynkDirection). */
const FACING_ANGLE: Record<SynkDirection, number> = {
  down: 0, 'down-left': Math.PI / 4, left: Math.PI / 2, 'up-left': (3 * Math.PI) / 4,
  up: Math.PI, 'up-right': -(3 * Math.PI) / 4, right: -Math.PI / 2, 'down-right': -Math.PI / 4,
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

/** Convertit une direction d'entrée (clavier/pavé directionnel, ex. « Haut » = dx=0,dy=-1) — pensée
 * comme relative à l'ÉCRAN (« s'éloigner de la caméra ») — en une direction MONDE (grille fixe
 * col/row), en tenant compte de l'angle horizontal actuel de la caméra (`yaw`, voir
 * OrbitControls::getAzimuthalAngle dans Scene ci-dessous). Corrige le bug persistant « Espace+Haut
 * ne fait pas grimper la montagne qui semble pourtant en face » : la caméra pouvant être orbitée
 * librement à la souris, "Haut" pointait auparavant TOUJOURS vers le nord du monde (dy=-1) quel que
 * soit l'angle de vue, ce qui ne correspondait plus forcément à la case visuellement en face de
 * Synk une fois la caméra tournée. Avec cette rotation, "Haut" désigne désormais TOUJOURS la case
 * qui s'éloigne de la caméra à l'écran (donc "en face" de Synk du point de vue du joueur), et
 * "Droite"/"Gauche" suivent la même logique — la sortie est ensuite alignée (arrondie) sur la plus
 * proche des 8 directions de la grille (cardinales + diagonales), pour rester un pas de case entier
 * valide. Paramétrable (voir RepRules.platform3dCameraRelativeMovement) pour revenir à l'ancien
 * comportement (direction monde fixe) en un clic en cas de souci.
 */
function rotateInputByCameraYaw(dx: number, dy: number, yaw: number): { dx: number; dy: number } {
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  // Angle de l'entrée BRUTE dans le repère écran (0 = "Haut" = s'éloigner de la caméra), au sens
  // trigonométrique compatible avec l'angle azimutal de OrbitControls (voir Scene::onCameraYaw).
  const inputAngle = Math.atan2(dx, -dy);
  const worldAngle = inputAngle + yaw;
  const step = Math.PI / 4;
  const snapped = Math.round(worldAngle / step) * step;
  return { dx: Math.round(Math.sin(snapped)), dy: Math.round(-Math.cos(snapped)) };
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
  tree: '#2f6b27', castle: '#8a8577', hut: '#7a5230', portal: '#7c3aed',
  bamboo: '#6fae3f', baobab: '#7a5b2e', palm: '#3f8a3a',
};
function PropBlock({ kind, x, topY, z, scale = 1, onClick }: { kind: NonNullable<Tile['prop']>; x: number; topY: number; z: number; scale?: number; onClick: () => void }) {
  const color = PROP_COLOR[kind] ?? '#2f6b27';
  if (kind === 'portal') {
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.62, 0.12, 10, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.6, 24]} />
          <meshStandardMaterial color="#1e1035" emissive="#4c1d95" emissiveIntensity={0.35} transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }
  if (kind === 'castle') {
    // Donjon : socle de pierre + créneaux + tourelle centrale coiffée d'un toit conique — silhouette
    // clairement plus imposante qu'une simple hutte (bâtiment fortifié).
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[1.5, 1.8, 1.5]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
        {[[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]].map(([mx, mz], i) => (
          <mesh key={i} position={[mx, 1.9, mz]} castShadow><boxGeometry args={[0.28, 0.3, 0.28]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
        ))}
        <mesh position={[0, 2.2, 0]} castShadow><cylinderGeometry args={[0.5, 0.55, 0.9, 10]} /><meshStandardMaterial color="#6b6f76" roughness={0.85} /></mesh>
        <mesh position={[0, 2.95, 0]} castShadow><coneGeometry args={[0.62, 0.7, 10]} /><meshStandardMaterial color="#5b2b3a" roughness={0.7} /></mesh>
      </group>
    );
  }
  if (kind === 'hut') {
    // Chaumière : socle bois/torchis + toit de chaume en pente (cône), cheminée en pierre.
    return (
      <group position={[x, topY, z]} scale={scale} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
        <mesh position={[0, 1.25, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.85, 0.7, 4]} /><meshStandardMaterial color="#3f2c1a" roughness={0.9} /></mesh>
        <mesh position={[0.32, 1.55, 0.1]}><cylinderGeometry args={[0.08, 0.09, 0.4, 6]} /><meshStandardMaterial color="#78716c" roughness={0.9} /></mesh>
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

/** Dragon-familier stylisé (corps, cou+tête cornue, queue effilée, deux ailes membraneuses) — bien
 * plus reconnaissable que le gemme octaédrique générique pour représenter, par exemple, le "Dragon
 * Vert" du catalogue (voir demande utilisateur : « le Dragon Vert ressemble à un anneau alors qu'il
 * devrait ressembler à un Dragon »). Couleur pilotée par `familiarDragonColor` ci-dessus. */
function DragonMarker({ color }: { color: string }) {
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
      </group>
      <mesh position={[-0.3, 0.02, 0]} rotation={[0, 0, 0.3]} castShadow>
        <coneGeometry args={[0.075, 0.42, 6]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 0.2, side * 0.16]} rotation={[side * 0.55, 0, 0.1]} castShadow>
          <coneGeometry args={[0.3, 0.045, 3]} />
          <meshStandardMaterial color={color} roughness={0.7} transparent opacity={0.92} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
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
 * cohérent visuellement ; `kind==='familiar'` → `DragonMarker` coloré selon le catalogue ;
 * `kind==='npc'` → petite silhouette de PNJ encapuchonné ; `kind==='treasure'` → coffre au trésor
 * cerclé d'or ; `kind==='world'` → portail circulaire lumineux (type porte des étoiles) ;
 * `kind==='zorghon'` → silhouette sombre cornue menaçante ; `kind==='captive'` → silhouette liée.
 * Tout kind non couvert ci-dessus conserve EXACTEMENT le rendu octaédrique précédent — zéro
 * régression. */
function MarkerBlock({ kind, poiType, name, markerId, x, z, onClick }: {
  kind: string; poiType?: MapPoiType; name?: string; markerId?: string; x: number; z: number; onClick: () => void;
}) {
  // Ref générique : anime (flottaison + légère rotation) le contenu de TOUTES les branches "en
  // lévitation" (quête, familier, PNJ, trésor, monde, zorghon, captif, gemme par défaut) — les
  // branches "fixes au sol" (grotte, bâtisses) ne l'utilisent jamais et ne sont donc jamais animées.
  const bobRef = useRef<THREE.Group>(null);
  const isCave = kind === 'poi' && poiType === 'cave';
  const isBuilding = kind === 'poi' && !!poiType && (['hut', 'tavern', 'stable', 'village_ally', 'village_enemy'] as MapPoiType[]).includes(poiType);
  const isQuest = kind === 'quest';
  const isFamiliar = kind === 'familiar';
  const isNpc = kind === 'npc';
  const isTreasure = kind === 'treasure';
  const isWorld = kind === 'world';
  const isZorghon = kind === 'zorghon';
  const isCaptive = kind === 'captive';
  const floating = !isCave && !isBuilding;
  const bobAmplitude = isQuest ? 0.25 : 0.15;
  useFrame((state) => {
    const obj = bobRef.current;
    if (!obj || !floating) return;
    obj.position.y = bobAmplitude + Math.sin(state.clock.elapsedTime * 2 + x * 3 + z * 3) * 0.06;
    obj.rotation.y += isQuest ? 0.006 : 0.01;
  });
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
  if (isQuest) {
    // Parchemin roulé flottant (quêtes classiques/PNJ/énigmes) : cylindre papier + liseré + un ruban
    // — remplace le gemme octaédrique générique par une forme reconnaissable de rouleau de quête.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
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
    // « le Dragon Vert ressemble à un anneau alors qu'il devrait ressembler à un Dragon ».
    const dragonColor = familiarDragonColor(markerId ?? '', name ?? '');
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
        <group ref={bobRef}><DragonMarker color={dragonColor} /></group>
      </group>
    );
  }
  if (isNpc) {
    // Silhouette de PNJ encapuchonné (robe conique + tête + capuche + bâton + petit orbe lumineux)
    // — bien plus reconnaissable comme "personnage" que le gemme octaédrique générique.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
        <group ref={bobRef} position={[0, -0.15, 0]}>
          <mesh castShadow><coneGeometry args={[0.22, 0.5, 8]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
          <mesh position={[0, 0.32, 0]} castShadow><sphereGeometry args={[0.14, 10, 8]} /><meshStandardMaterial color="#e8c39e" /></mesh>
          <mesh position={[0, 0.4, 0]} rotation={[0.15, 0, 0]} castShadow><coneGeometry args={[0.16, 0.22, 8]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
          <mesh position={[0.2, 0.05, 0]} rotation={[0, 0, 0.3]}><cylinderGeometry args={[0.02, 0.02, 0.55, 6]} /><meshStandardMaterial color="#6b4a2a" /></mesh>
          <mesh position={[0.29, 0.32, 0]}><octahedronGeometry args={[0.06, 0]} /><meshStandardMaterial color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={0.6} /></mesh>
        </group>
      </group>
    );
  }
  if (isTreasure) {
    // Coffre au trésor (caisse bois + couvercle légèrement entrouvert + cerclages/serrure dorés) —
    // remplace le gemme générique par une forme immédiatement reconnaissable comme un trésor.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
        <group ref={bobRef}>
          <mesh position={[0, -0.05, 0]} castShadow><boxGeometry args={[0.42, 0.28, 0.3]} /><meshStandardMaterial color="#6b4423" roughness={0.75} /></mesh>
          <mesh position={[0, 0.12, 0]} rotation={[-0.18, 0, 0]} castShadow><boxGeometry args={[0.42, 0.16, 0.3]} /><meshStandardMaterial color="#5a3a1e" roughness={0.75} /></mesh>
          <mesh position={[0, 0.02, 0.155]}><boxGeometry args={[0.1, 0.28, 0.03]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.35} /></mesh>
          <mesh position={[0, 0.16, 0.15]}><boxGeometry args={[0.06, 0.06, 0.05]} /><meshStandardMaterial color="#d4af37" metalness={0.7} roughness={0.3} /></mesh>
        </group>
      </group>
    );
  }
  if (isWorld) {
    // Portail circulaire lumineux (type "porte des étoiles"/trou de ver, cf. inspiration Stargate
    // demandée) — même esprit que le portail décoratif `PropBlock` kind==='portal', mais flottant et
    // isolé (pas posé sur une dalle) pour représenter l'accès à un monde entier.
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
        <group ref={bobRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.28, 0.06, 10, 20]} />
            <meshStandardMaterial color="#8b5cf6" emissive="#8b5cf6" emissiveIntensity={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.24, 20]} />
            <meshStandardMaterial color="#1e1035" emissive="#4c1d95" emissiveIntensity={0.4} transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
    );
  }
  if (isZorghon) {
    // Silhouette sombre et cornue, menaçante — boss narratif unique (voir ZorghonEncounterState).
    return (
      <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#1c1917" /></mesh>
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
        <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
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
      <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
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
function SynkVoxel({ stage, walking, running, swimming, jumpTrigger, facing, equipment, equipmentRenderEnabled, standY, fullySubmerged, eyeBlinkEnabled, eyeBlinkIntervalSec }: {
  stage: number; walking: boolean; running: boolean; swimming: boolean; jumpTrigger: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean;
  standY?: number; fullySubmerged?: boolean; eyeBlinkEnabled?: boolean; eyeBlinkIntervalSec?: number;
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
  useEffect(() => { if (jumpTrigger > 0) jumpStartRef.current = Date.now(); }, [jumpTrigger]);

  useFrame((state) => {
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
  const angle = FACING_ANGLE[facing] ?? 0;
  const eq = equipmentRenderEnabled ? equipment : {};
  const weapon = eq.weapon, offhand = eq.offhand, arrows = eq.arrows, head = eq.head;
  const amulet = eq.amulet, legsEq = eq.legs, feetEq = eq.feet, belt = eq.belt, handsEq = eq.hands;
  const rarityColor = (it?: EquippedItem) => RARITY_COLOR_3D[it?.rarity ?? 'common'] ?? '#9ca3af';
  const skin = '#f2c99d', hairColor = '#3b2412', pantsDefault = '#334155', bootDefault = '#5b3a1e';

  return (
    <group ref={groundRef} rotation={[0, angle, 0]}>
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

interface SceneMarker { id: string; kind: string; x: number; z: number; marker: MapMarker }

/** Contenu 3D de la scène (terrain + Synk + entités) — composant séparé pour pouvoir utiliser
 * `useFrame`/les hooks R3F, qui exigent d'être montés SOUS `<Canvas>`. Le clic sur une tuile route
 * vers la même interaction qu'en Plateforme 2D isométrique selon son décor (portail décoratif →
 * pop-up "Monde", hutte décorative → pop-up de repos, sinon déplacement/approche classique) — voir
 * onPortalTileClick3D/onHutTileClick3D/onTileClick dans le composant parent. */
function Scene({
  centerCol, centerRow, poiPoints, sceneMarkers, stage, walking, running, swimming, jumpTrigger, facing,
  equipment, equipmentRenderEnabled, standY, onTileClick, onPortalTileClick, onHutTileClick, onMarkerClick,
  onCameraYaw, chaseCameraEnabled, eyeBlinkEnabled, eyeBlinkIntervalSec, objectFlags,
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
  onCameraYaw: (yaw: number) => void;
  chaseCameraEnabled: boolean;
  eyeBlinkEnabled?: boolean; eyeBlinkIntervalSec?: number;
  /** Registre admin-paramétrable des tailles de décor (Administration > 🧱 Objets & décor 3D) — voir
   * Platform3DObjectFlags.scale ; `undefined` retombe sur DEFAULT_PLATFORM3D_OBJECT_FLAGS (scale 1). */
  objectFlags?: Record<Platform3DObjectKind, Platform3DObjectFlags>;
}) {
  // Ref vers l'instance OrbitControls (three.js), pour lire son angle azimutal (yaw) courant à
  // chaque frame et le remonter au composant parent (voir rotateInputByCameraYaw) — un ref simple
  // ET un callback (pas de state React) pour éviter tout re-rendu inutile à 60 fps.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  // ─── Caméra suiveuse ("chase cam", voir RepRules.platform3dChaseCameraEnabled) ─────────────────
  // Dès que Synk marche, ramène en douceur l'angle azimutal de la caméra derrière lui (vu de dos,
  // dans son sens de déplacement), même si le joueur a manuellement réorbité la vue — corrige la
  // demande "l'observateur et la caméra reviendront à leur point d'origine pour ne pas perturber
  // l'expérience". Le modèle de Synk (voir SynkVoxel) a son visage tourné vers +Z au repos (angle=0,
  // voir FACING_ANGLE) ; une fois pivoté de `FACING_ANGLE[facing]` autour de Y, son vecteur "visage"
  // pointe vers (sin(angle), 0, cos(angle)) — la caméra, pour rester DERRIÈRE lui (voir son dos),
  // doit donc s'orbiter au même angle + π (le côté opposé). Seul le THETA (azimut) est ajusté : la
  // distance/l'inclinaison choisies par le joueur (zoom/tilt) restent intactes, aucune régression
  // sur l'orbite libre au repos (l'ajustement ne s'applique que pendant que `walking` est vrai).
  //
  // IMPORTANT : `<OrbitControls enableDamping>` (voir @react-three/drei) appelle DÉJÀ
  // `controls.update()` automatiquement à CHAQUE frame (son propre `useFrame`, priorité -1). Une
  // première version de ce correctif repositionnait la caméra elle-même PUIS appelait `update()`
  // une seconde fois manuellement — deux mises à jour concurrentes de la même caméra dans la même
  // frame, qui entraient en conflit avec l'amortissement interne (`_sphericalDelta`, notamment tout
  // reliquat d'un glissé souris récent) et provoquaient des rotations erratiques/« frénétiques »
  // tout en empêchant Synk d'avancer (bug rapporté). Une deuxième version n'injectait qu'une petite
  // impulsion dans `_sphericalDelta.theta` (le mécanisme interne d'un glissé de souris) MAIS
  // continuait de remonter l'angle RÉEL (encore en cours de rotation) via `onCameraYaw` — or cet
  // angle alimente `cameraYawRef` utilisé par `rotateInputByCameraYaw` au moment d'échantillonner
  // une NOUVELLE entrée clavier (voir dispatchMove/lastRawDirRef) : pendant que la chase-cam tournait
  // encore la caméra vers sa cible, tout nouvel échantillonnage (ex. relâcher puis ré-appuyer une
  // touche, ou après avoir réorbité à la souris juste avant de marcher) lisait un angle DIFFÉRENT à
  // chaque frame, produisant une direction "monde" tantôt correcte tantôt fausse/bloquée — Synk
  // marchait sur place (`isWalking`/`facing` mis à jour mais `moveTo` jamais atteint) et la course
  // ne pouvait jamais progresser puisque la position ne changeait pas (bug rapporté "il fait du
  // surplace" / "ne peut plus courir"). Correctif définitif : PENDANT que la chase-cam est engagée
  // (Synk marche), `onCameraYaw` ne remonte plus l'angle réel (encore en transition) mais la CIBLE
  // analytique de la chase-cam (`FACING_ANGLE[facing] + π`, une valeur stable et immédiate, pas
  // besoin d'attendre la convergence visuelle) — la caméra continue de tourner en douceur à l'écran
  // (cosmétique, via `_sphericalDelta`), mais la résolution de direction n'observe plus JAMAIS cette
  // transition, éliminant toute boucle de rétroaction. Au repos (Synk immobile), `onCameraYaw`
  // reprend l'angle RÉEL de la caméra (orbite libre à la souris toujours prise en compte normalement,
  // aucune régression).
  useFrame(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const chasing = chaseCameraEnabled && walking;
    if (chasing) {
      const targetTheta = (FACING_ANGLE[facing] ?? 0) + Math.PI;
      onCameraYaw(targetTheta);
      const current = controls.getAzimuthalAngle();
      let delta = targetTheta - current;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      // Repositionne directement la caméra (API publique `camera.position`/`controls.target`,
      // AUCUNE dépendance à un champ interne de three-stdlib) en faisant tourner le vecteur
      // caméra→cible autour de l'axe Y d'un petit pas vers `targetTheta` à chaque frame, ce qui
      // ramène en douceur la caméra derrière Synk pendant qu'il marche. Remplace l'ancienne
      // tentative d'écriture dans `controls._sphericalDelta` (champ interne à la fermeture du
      // constructeur dans la version de three-stdlib installée, absent de l'objet public — l'écrit
      // levait une exception à CHAQUE frame de marche, détectée via Playwright, et de toute façon
      // ne faisait STRICTEMENT rien d'autre qu'échouer silencieusement avant même cette exception :
      // la caméra ne "rattrapait" donc plus jamais Synk après une réorientation manuelle à la
      // souris, ce qui, combiné au fait que `onCameraYaw` continue de figer la nouvelle direction de
      // marche sur l'angle de la caméra resté immobile, faisait apparaître Synk de face/profil au
      // lieu de dos — perçu par le joueur comme "la tête tournée à l'inverse" ou un déplacement
      // erratique dès qu'il réorientait la vue à la souris avant de marcher).
      if (Math.abs(delta) > 0.001) {
        const step = delta * 0.08;
        const camera = controls.object;
        const target = controls.target;
        const offX = camera.position.x - target.x;
        const offZ = camera.position.z - target.z;
        const cosA = Math.cos(step), sinA = Math.sin(step);
        camera.position.x = target.x + (offX * cosA + offZ * sinA);
        camera.position.z = target.z + (offZ * cosA - offX * sinA);
        controls.update();
      }
    } else {
      onCameraYaw(controls.getAzimuthalAngle());
    }
  });


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
        const onClick = tile.prop === 'portal' ? () => onPortalTileClick(wc, wr)
          : tile.prop === 'hut' ? () => onHutTileClick(wc, wr)
          : () => onTileClick(wc, wr);
        return (
          <group key={`${wc}-${wr}`}>
            <TerrainBlock tile={tile} x={x} z={z} onClick={onClick} />
            {tile.prop && (
              <PropBlock
                kind={tile.prop} x={x} z={z}
                topY={tile.terrain === 'rock' ? Math.min(1.9, (tile.altitudeM ?? 300) / 2800) : 0}
                scale={(objectFlags ?? DEFAULT_PLATFORM3D_OBJECT_FLAGS)[platform3dPropKind(tile.prop)]?.scale ?? 1}
                onClick={onClick}
              />
            )}
          </group>
        );
      })}
      {sceneMarkers.map(m => <MarkerBlock key={m.id} kind={m.kind} poiType={m.marker.poiType} name={m.marker.name} markerId={m.marker.id} x={m.x} z={m.z} onClick={() => onMarkerClick(m.marker)} />)}
      <SynkVoxel
        stage={stage} walking={walking} running={running} swimming={swimming} jumpTrigger={jumpTrigger}
        facing={facing} equipment={equipment} equipmentRenderEnabled={equipmentRenderEnabled} standY={standY}
        eyeBlinkEnabled={eyeBlinkEnabled} eyeBlinkIntervalSec={eyeBlinkIntervalSec}
      />
      <OrbitControls
        ref={controlsRef}
        enablePan={false} enableDamping dampingFactor={0.12}
        minDistance={3} maxDistance={11} minPolarAngle={0.25} maxPolarAngle={1.35}
        target={[0, 0.3, 0]}
      />
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
export function Platform3DWidget({ stage, playerXp = 0, enabled = true }: { stage: number; playerXp?: number; enabled?: boolean }) {
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

  const [markers, setMarkers] = useState<MapMarker[]>([]);
  useEffect(() => { getAllMapMarkers(DEFAULT_MAP_ID).then(setMarkers).catch(() => {}); }, []);
  const poiPoints = useMemo(
    () => markers.filter(m => m.kind === 'poi').map(m => ({ x: m.x, y: m.y, poiType: m.poiType, radius: m.radius })),
    [markers],
  );
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
  const [hutResting, setHutResting] = useState(false);
  const [hutFeedback, setHutFeedback] = useState<string | null>(null);

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
  const hasVehicle = useMemo(() => inventory.some(i => i.category === 'vehicle' && i.qty > 0), [inventory]);
  const [islandBlockedMsg, setIslandBlockedMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!islandBlockedMsg) return;
    const id = setTimeout(() => setIslandBlockedMsg(null), 3500);
    return () => clearTimeout(id);
  }, [islandBlockedMsg]);

  const centerCol = Math.round(clamp100(worldPos.x));
  const centerRow = Math.round(clamp100(worldPos.y));

  // Marqueurs (catalogue + Quête du Royaume + Zorghon/prisonniers) dans le rayon 3D affiché,
  // convertis en coordonnées relatives (x,z) centrées sur Synk — même filtre de fenêtre que
  // GameCanvas2D.tsx::visibleMarkers, juste un rayon circulaire plutôt qu'un rectangle COLSxROWS.
  const sceneMarkers = useMemo<SceneMarker[]>(() => {
    const zorghonMarkers: MapMarker[] = (!zorghonEncounter || zorghonEncounter.rescued) ? [] : [
      { id: 'zorghon.boss', kind: 'zorghon', name: 'Zorghon', icon: '👹', x: zorghonEncounter.zorghonX, y: zorghonEncounter.zorghonY },
      { id: 'zorghon.captives', kind: 'captive', name: 'Captifs', icon: '🧝‍♀️', x: zorghonEncounter.captiveX, y: zorghonEncounter.captiveY },
    ];
    const all = kingdomMarker ? [...markers, kingdomMarker, ...zorghonMarkers] : [...markers, ...zorghonMarkers];
    const out: SceneMarker[] = [];
    for (const m of all) {
      const dx = Math.round(m.x) - centerCol, dz = Math.round(m.y) - centerRow;
      if (Math.abs(dx) <= VIEW_RADIUS && Math.abs(dz) <= VIEW_RADIUS) out.push({ id: m.id, kind: m.kind, x: dx, z: dz, marker: m });
    }
    return out;
  }, [markers, kingdomMarker, zorghonEncounter, centerCol, centerRow]);

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
  }, [moveTo, isFainting, fallDeath, rules, poiPoints, triggerClimbDamage]);

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

  // Aiguille le clavier/pavé directionnel/souris vers la nage sous-marine ou le déplacement normal,
  // selon la vue active — un SEUL point d'entrée partagé par useHoldMovement pour ne dupliquer
  // aucune logique d'appui prolongé/course (voir useHoldMovement.ts). En exploration normale,
  // convertit d'abord l'entrée écran (Haut/Bas/Gauche/Droite) en direction MONDE selon l'angle
  // actuel de la caméra (voir rotateInputByCameraYaw/cameraYawRef) — corrige "Espace+Haut ne fait
  // pas grimper la montagne en face" quand la caméra a été orbitée à la souris.
  const cameraYawRef = useRef(0);
  const onCameraYaw = useCallback((yaw: number) => { cameraYawRef.current = yaw; }, []);
  const cameraRelativeMovement = rules?.platform3dCameraRelativeMovement ?? true;
  // Mémorise la dernière entrée BRUTE (écran) et sa direction MONDE déjà calculée pour ce maintien
  // en cours — corrige le déplacement erratique (diagonales/allers-retours parasites) observé en
  // maintenant une touche : `OrbitControls.enableDamping` fait dériver légèrement l'angle de la
  // caméra pendant quelques frames après toute rotation à la souris (inertie), et recalculer la
  // rotation à CHAQUE pas du maintien (via `useHoldMovement`, cadence walkStepMs/runStepMs)
  // ré-échantillonnait cet angle en léger mouvement, faisant parfois basculer la direction arrondie
  // vers une case voisine en plein maintien. On ne ré-échantillonne désormais l'angle caméra que
  // lorsque l'entrée BRUTE change réellement (nouvelle touche/diagonale), pas à chaque tick d'un
  // maintien inchangé, ce qui fige la direction pour toute la durée d'un appui continu.
  const lastRawDirRef = useRef<{ dx: number; dy: number } | null>(null);
  const lastRotatedDirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dispatchMove = useCallback((dx: number, dy: number) => {
    if (underwaterMode && underwaterMoveEnabled) { moveUnderwater(dx, dy); return; }
    if (cameraRelativeMovement) {
      const last = lastRawDirRef.current;
      let rotated: { dx: number; dy: number };
      if (last && last.dx === dx && last.dy === dy) {
        rotated = lastRotatedDirRef.current;
      } else {
        rotated = rotateInputByCameraYaw(dx, dy, cameraYawRef.current);
        lastRawDirRef.current = { dx, dy };
        lastRotatedDirRef.current = rotated;
      }
      move(rotated.dx, rotated.dy);
    } else {
      move(dx, dy);
    }
  }, [underwaterMode, underwaterMoveEnabled, moveUnderwater, move, cameraRelativeMovement]);

  const hold = useHoldMovement(dispatchMove, {
    walkStepMs: rules?.movementWalkStepMs ?? 220,
    runStepMs: rules?.movementRunStepMs ?? 110,
    runHoldThresholdMs: rules?.movementRunHoldThresholdMs ?? 1500,
    onRunChange: setIsRunning,
  });
  // Relâchement d'un maintien de direction (clavier ou pavé virtuel) : on efface le cache de
  // direction monde figée (voir lastRawDirRef ci-dessus) pour forcer un nouvel échantillonnage de
  // l'angle caméra au PROCHAIN appui — sinon un appui identique (ex. de nouveau "Haut") après avoir
  // orbité la caméra à la souris sans bouger entre-temps réutiliserait à tort l'ancienne direction
  // monde mise en cache.
  const releaseMovement = useCallback(() => {
    lastRawDirRef.current = null;
    hold.release();
  }, [hold]);
  useEffect(() => () => { if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current); }, []);

  // ─── Clic sur un marqueur (PNJ, familier, trésor, quête, monde, hutte) — même logique que
  // GameCanvas2D.tsx::onMarkerClick, pour garantir une interaction strictement identique entre les
  // 3 vues (2D isométrique/3D/mapmonde) et éviter toute duplication/divergence de mécanique.
  const onMarkerClick3D = useCallback((m: MapMarker) => {
    const interactable = m.kind === 'npc' || m.kind === 'familiar' || m.kind === 'treasure'
      || m.kind === 'quest' || m.kind === 'world' || (m.kind === 'poi' && m.poiType === 'hut');
    if (!interactable) return;
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(Math.round(m.x) - Math.round(cur.x)), Math.abs(Math.round(m.y) - Math.round(cur.y)));
    if (dist <= 1) setInteractionMarker(m);
    else moveTo(m.x, m.y);
  }, [moveTo]);

  // ─── Clic sur une tuile portant un portail décoratif (🌀) — même logique que
  // GameCanvas2D.tsx::onPortalTileClick (attribution déterministe à un monde du catalogue).
  const onPortalTileClick3D = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    if (dist <= 1 && worldMarkers.length) {
      const idx = Math.floor(hashRand(wc, wr, 5) * worldMarkers.length);
      setInteractionMarker(worldMarkers[Math.min(worldMarkers.length - 1, idx)]);
    } else {
      moveTo(wc, wr);
    }
  }, [moveTo, worldMarkers]);

  // ─── Clic sur une tuile portant une hutte décorative (🛖) — même logique que
  // GameCanvas2D.tsx::onHutTileClick (pop-up de repos, cooldown partagé HutRestModal).
  const onHutTileClick3D = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    if (dist <= 1) {
      setInteractionMarker({
        id: `hut-${wc}-${wr}`, kind: 'poi', poiType: 'hut',
        name: t(PROP_I18N_KEY.hut), icon: PROP_ICON.hut, x: wc, y: wr,
      });
    } else {
      moveTo(wc, wr);
    }
  }, [moveTo, t]);

  const onTileClick = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dx = wc - Math.round(cur.x), dy = wr - Math.round(cur.y);
    const dir = directionFromDelta(dx, dy);
    if (dir) setFacing(dir);
    moveTo(wc, wr);
  }, [moveTo]);

  // Déplacement au clavier (flèches + WASD, y compris en diagonale) via useHoldMovement (voir
  // useHoldMovement.ts) — corrige le bug "Synk avance de 2 cases par appui" (répétition native OS
  // ignorée via `e.repeat`) et ajoute la course au maintien prolongé (movementRunHoldThresholdMs).
  const keysDownRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (collapsed || !enabled) return;
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
  }, [collapsed, enabled, hold, releaseMovement]);

  // ─── Redimensionnement à la souris (coin bas-droit, voir onResizePointerMove) + plein écran natif
  // du navigateur (voir RepRules.platform3dResizableEnabled) — le conteneur 3D `fullscreenRef` (et
  // non tout le widget) passe en plein écran pour agrandir la scène jusqu'aux capacités maximales
  // de l'écran ; <Canvas> de React Three Fiber se redimensionne automatiquement (ResizeObserver
  // interne) dès que son conteneur CSS change de taille, sans code de redimensionnement manuel.
  const [size, setSize] = useState<Size>({ w: CANVAS_W, h: CANVAS_H });
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
    const dx = e.clientX - resizeStart.current.x, dy = e.clientY - resizeStart.current.y;
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
        <Canvas shadows camera={{ position: [0, 3.2, 5.6], fov: 45 }}>
          {underwaterMode ? (
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
            <Scene
              centerCol={centerCol} centerRow={centerRow} poiPoints={poiPoints} sceneMarkers={sceneMarkers}
              stage={stage} walking={isWalking} running={isRunning} swimming={swimming} jumpTrigger={jumpTrigger}
              facing={facing} equipment={equipment} equipmentRenderEnabled={rules?.platform3dEquipmentRenderEnabled ?? true}
              standY={standY}
              onTileClick={onTileClick} onPortalTileClick={onPortalTileClick3D} onHutTileClick={onHutTileClick3D}
              onMarkerClick={onMarkerClick3D} onCameraYaw={onCameraYaw}
              chaseCameraEnabled={rules?.platform3dChaseCameraEnabled ?? true}
              eyeBlinkEnabled={rules?.synkEyeBlinkEnabled ?? true}
              eyeBlinkIntervalSec={rules?.synkEyeBlinkIntervalSec ?? 4}
              objectFlags={rules?.platform3dObjectFlags}
            />
          )}
        </Canvas>
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
        {!underwaterMode && (
        <div className="absolute top-1.5 left-1.5 bg-slate-900/70 rounded px-2 py-1 text-[10px] text-lime-200 pointer-events-none">
          {swimming ? '🏊 ' + t('game.platform3d.swimming') : isRunning ? '🏃 ' + t('game.platform3d.running') : '🚶 ' + t('game.platform3d.walking')}
          {player && <span className="ml-2">💨 {Math.round(player.oxygen ?? 100)}% · 🔋 {Math.round(player.fatigue ?? 100)}%</span>}
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
        <p className="absolute bottom-2 right-2 text-[9px] text-slate-500 max-w-[180px] text-right pointer-events-none">
          {t('game.platform3d.hint')}
        </p>
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
        rules={rules}
        onClose={() => setInteractionMarker(null)}
        onRequestHutRest={() => setHutResting(true)}
      />
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
    </div>
  );
}
