'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  subscribePlayer, subscribeInventory, getKingdomQuestMarker, subscribeSolvedQuestIds,
  getZorghonEncounter, subscribeZorghonEncounter, subscribeEquipment,
  type MapMarker, type MapPoiType, type RepRules, type PlayerState, type InventoryItem,
  type ZorghonEncounterState, type SynkDirection, type EquipSlot, type EquippedItem,
} from '@/lib/gameState';
import {
  worldTileAt, clamp100, WORLD_SIZE, TERRAIN_COLOR, PROP_ICON, PROP_I18N_KEY, hashRand,
  isObstacleAt, type Tile,
} from '@/lib/worldTerrain';
import { STAGE_NAMES } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { useHoldMovement } from '@/lib/useHoldMovement';
import { WidgetContextMenu } from './WidgetContextMenu';
import { PoiInteractionModal } from './PoiInteractionModal';
import { HutRestModal } from './HutRestModal';

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

/** Bloc de terrain voxel (façon Minecraft) : prairie/sable/sentier en dalle plate, roche surélevée
 * selon `altitudeM` (relief), eau abaissée et assombrie selon `depthM` (profondeur) — réutilise TEL
 * QUEL le modèle de tuile `worldTerrain.ts` (mêmes champs que la Plateforme 2D isométrique/Mapmonde,
 * voir commentaire de `Tile` dans ce fichier), donc aucune divergence de décor possible entre les 3
 * vues. `onClick` matérialise le déplacement à la souris (clic sur une case pour s'y rendre). */
function TerrainBlock({ tile, x, z, onClick }: { tile: Tile; x: number; z: number; onClick: () => void }) {
  const color = TERRAIN_COLOR[tile.terrain];
  if (tile.terrain === 'water') {
    const depthNorm = Math.min(1, (tile.depthM ?? 1) / 300);
    const y = -0.62 - depthNorm * 0.3;
    return (
      <mesh position={[x, y, z]} onClick={onClick}>
        <boxGeometry args={[1, 0.24, 1]} />
        <meshStandardMaterial color={color} transparent opacity={0.82} />
      </mesh>
    );
  }
  if (tile.terrain === 'rock') {
    const h = Math.min(2.4, 0.5 + (tile.altitudeM ?? 300) / 2800);
    return (
      <mesh position={[x, h / 2 - 0.5, z]} onClick={onClick} castShadow receiveShadow>
        <boxGeometry args={[1, h, 1]} />
        <meshStandardMaterial color={color} />
      </mesh>
    );
  }
  return (
    <mesh position={[x, -0.5, z]} onClick={onClick} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Petit décor (arbre/hutte/château/portail/…) posé sur sa dalle — représentation voxel minimale,
 * extensible via `PROP_SHAPE` ci-dessous (registre par type, même esprit que MARKER_COLOR). */
const PROP_COLOR: Record<string, string> = {
  tree: '#2f6b27', castle: '#8a8577', hut: '#7a5230', portal: '#7c3aed',
  bamboo: '#6fae3f', baobab: '#7a5b2e', palm: '#3f8a3a',
};
function PropBlock({ kind, x, topY, z }: { kind: NonNullable<Tile['prop']>; x: number; topY: number; z: number }) {
  const color = PROP_COLOR[kind] ?? '#2f6b27';
  if (kind === 'portal') {
    return (
      <mesh position={[x, topY + 0.5, z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.08, 8, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
    );
  }
  if (kind === 'castle' || kind === 'hut') {
    return (
      <mesh position={[x, topY + 0.3, z]} castShadow>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color={color} />
      </mesh>
    );
  }
  // Arbres/bambou/baobab/palmier : tronc + houppier, silhouette générique déclinable par couleur.
  return (
    <group position={[x, topY, z]}>
      <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.06, 0.08, 0.4, 6]} /><meshStandardMaterial color="#5b3a1e" /></mesh>
      <mesh position={[0, 0.5, 0]} castShadow><coneGeometry args={[0.32, 0.55, 7]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

/** Marqueur (PNJ, familier, trésor, monde/portail, Zorghon, captif, POI, quête) matérialisé par un
 * petit socle coloré + une forme flottante animée — registre `MARKER_COLOR` extensible : ajouter un
 * nouveau `kind` n'importe où dans gameState.ts::MapMarkerKind sera automatiquement représenté ici
 * (couleur de repli `#94a3b8` si absent du registre). `onClick` ouvre la même interaction (PNJ,
 * trésor, quête, monde, hutte du catalogue) que le clic sur un marqueur en Plateforme 2D
 * isométrique — voir Platform3DWidget::onMarkerClick3D. */
function MarkerBlock({ kind, x, z, onClick }: { kind: string; x: number; z: number; onClick: () => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.y = 0.15 + Math.sin(state.clock.elapsedTime * 2 + x * 3 + z * 3) * 0.06;
    ref.current.rotation.y += 0.01;
  });
  const color = MARKER_COLOR[kind] ?? '#94a3b8';
  return (
    <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh ref={ref}>
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
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
function SynkVoxel({ stage, walking, running, swimming, jumpTrigger, facing, equipment, equipmentRenderEnabled }: {
  stage: number; walking: boolean; running: boolean; swimming: boolean; jumpTrigger: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean;
}) {
  const bobRef = useRef<THREE.Group>(null);
  const jumpRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const jumpStartRef = useRef<number | null>(null);
  useEffect(() => { if (jumpTrigger > 0) jumpStartRef.current = Date.now(); }, [jumpTrigger]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cadence = running ? 14 : 8;
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
  });

  const color = STAGE_COLOR_3D[STAGE_NAMES[stage] || 'egg'] ?? '#22823a';
  const angle = FACING_ANGLE[facing] ?? 0;
  const eq = equipmentRenderEnabled ? equipment : {};
  const weapon = eq.weapon, offhand = eq.offhand, arrows = eq.arrows, head = eq.head;
  const amulet = eq.amulet, legsEq = eq.legs, feetEq = eq.feet, belt = eq.belt, handsEq = eq.hands;
  const rarityColor = (it?: EquippedItem) => RARITY_COLOR_3D[it?.rarity ?? 'common'] ?? '#9ca3af';
  const skin = '#f2c99d', hairColor = '#3b2412', pantsDefault = '#334155', bootDefault = '#5b3a1e';

  return (
    <group position={[0, swimming ? -0.45 : 0, 0]} rotation={[0, angle, 0]}>
      <group ref={jumpRef}>
      <group ref={bobRef}>
        {/* ─── Tête : visage (yeux/nez/bouche/oreilles) + cheveux OU casque si équipé ─── */}
        <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[0.42, 0.42, 0.42]} /><meshStandardMaterial color={skin} /></mesh>
        <mesh position={[-0.09, 0.65, 0.2]}><boxGeometry args={[0.07, 0.07, 0.03]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0.09, 0.65, 0.2]}><boxGeometry args={[0.07, 0.07, 0.03]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0, 0.6, 0.22]}><boxGeometry args={[0.07, 0.06, 0.05]} /><meshStandardMaterial color={skin} /></mesh>
        <mesh position={[0, 0.52, 0.2]}><boxGeometry args={[0.14, 0.035, 0.04]} /><meshStandardMaterial color="#7f2d3a" /></mesh>
        <mesh position={[-0.23, 0.6, 0]} castShadow><boxGeometry args={[0.06, 0.13, 0.13]} /><meshStandardMaterial color={skin} /></mesh>
        <mesh position={[0.23, 0.6, 0]} castShadow><boxGeometry args={[0.06, 0.13, 0.13]} /><meshStandardMaterial color={skin} /></mesh>
        {head ? (
          <mesh position={[0, 0.82, -0.01]} castShadow>
            <boxGeometry args={[0.46, 0.16, 0.46]} />
            <meshStandardMaterial color={rarityColor(head)} metalness={0.5} roughness={0.4} />
          </mesh>
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
          <mesh position={[0, 0.42, 0.14]}><sphereGeometry args={[0.05, 10, 10]} /><meshStandardMaterial color={rarityColor(amulet)} emissive={rarityColor(amulet)} emissiveIntensity={0.5} /></mesh>
        )}
        {belt && (
          <mesh position={[0, -0.04, 0]} castShadow><boxGeometry args={[0.38, 0.07, 0.29]} /><meshStandardMaterial color={rarityColor(belt)} metalness={0.4} /></mesh>
        )}
        {/* ─── Équipement dorsal : épée OU arc+carquois, bouclier ─── */}
        {weapon && !weapon.requiresArrow && (
          <mesh position={[-0.06, 0.28, -0.17]} rotation={[0.15, 0, 0.55]} castShadow>
            <boxGeometry args={[0.07, 0.62, 0.03]} /><meshStandardMaterial color={rarityColor(weapon)} metalness={0.6} roughness={0.3} />
          </mesh>
        )}
        {weapon && weapon.requiresArrow && (
          <mesh position={[-0.06, 0.28, -0.17]} rotation={[0, 0, 0.55]} castShadow>
            <torusGeometry args={[0.28, 0.02, 6, 12, Math.PI]} /><meshStandardMaterial color={rarityColor(weapon)} />
          </mesh>
        )}
        {arrows && (arrows.qty ?? 0) > 0 && (
          <group position={[0.1, 0.32, -0.18]} rotation={[0.2, 0, -0.1]}>
            <mesh castShadow><cylinderGeometry args={[0.07, 0.08, 0.32, 8]} /><meshStandardMaterial color="#6b4423" /></mesh>
            <mesh position={[0.02, 0.2, 0]}><boxGeometry args={[0.015, 0.22, 0.015]} /><meshStandardMaterial color="#c9a876" /></mesh>
            <mesh position={[-0.02, 0.19, 0.02]}><boxGeometry args={[0.015, 0.2, 0.015]} /><meshStandardMaterial color="#c9a876" /></mesh>
          </group>
        )}
        {offhand && (
          <mesh position={[0.14, 0.2, -0.17]} rotation={[0, 0, 0]} castShadow>
            <boxGeometry args={[0.22, 0.3, 0.04]} /><meshStandardMaterial color={rarityColor(offhand)} metalness={0.5} roughness={0.4} />
          </mesh>
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
  equipment, equipmentRenderEnabled, onTileClick, onPortalTileClick, onHutTileClick, onMarkerClick,
}: {
  centerCol: number; centerRow: number;
  poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[];
  sceneMarkers: SceneMarker[];
  stage: number; walking: boolean; running: boolean; swimming: boolean; jumpTrigger: number; facing: SynkDirection;
  equipment: Partial<Record<EquipSlot, EquippedItem>>; equipmentRenderEnabled: boolean;
  onTileClick: (wc: number, wr: number) => void;
  onPortalTileClick: (wc: number, wr: number) => void;
  onHutTileClick: (wc: number, wr: number) => void;
  onMarkerClick: (m: MapMarker) => void;
}) {
  const tiles = useMemo(() => {
    const out: { tile: Tile; wc: number; wr: number; x: number; z: number }[] = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const wc = clamp100(centerCol + dx), wr = clamp100(centerRow + dz);
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
            {tile.prop && <PropBlock kind={tile.prop} x={x} z={z} topY={tile.terrain === 'rock' ? Math.min(1.9, (tile.altitudeM ?? 300) / 2800) : 0} />}
          </group>
        );
      })}
      {sceneMarkers.map(m => <MarkerBlock key={m.id} kind={m.kind} x={m.x} z={m.z} onClick={() => onMarkerClick(m.marker)} />)}
      <SynkVoxel
        stage={stage} walking={walking} running={running} swimming={swimming} jumpTrigger={jumpTrigger}
        facing={facing} equipment={equipment} equipmentRenderEnabled={equipmentRenderEnabled}
      />
      <OrbitControls
        enablePan={false} enableDamping dampingFactor={0.12}
        minDistance={3} maxDistance={11} minPolarAngle={0.25} maxPolarAngle={1.35}
        target={[0, 0.3, 0]}
      />
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
  const { address } = useAccount();
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

  // Touche Espace maintenue (voir RepRules.platform3dJumpEnabled) — permet de "sauter" pour
  // franchir une dalle de montagne/roche : sans Espace maintenu, avancer vers une telle dalle est
  // bloqué (comme un obstacle) ; avec Espace maintenu, l'avancée est autorisée et déclenche l'arc
  // de saut cosmétique de SynkVoxel (voir jumpTrigger, incrémenté dans move() plus bas).
  const spaceDownRef = useRef(false);
  useEffect(() => {
    if (collapsed || !enabled) return;
    const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      spaceDownRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => { if (isSpace(e)) spaceDownRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      spaceDownRef.current = false;
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

  const move = useCallback((dx: number, dy: number) => {
    if (isFainting) return; // Synk évanoui (noyade ou épuisement) : déplacement bloqué, comme en 2D
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
    // Franchissement d'une dalle de montagne/roche à l'aide du saut (Espace) — voir
    // RepRules.platform3dJumpEnabled : sans Espace maintenu, la dalle est bloquée comme un
    // obstacle ; avec Espace maintenu, l'avancée est autorisée et déclenche l'arc de saut cosmétique.
    if (destTile.terrain === 'rock' && (rules?.platform3dJumpEnabled ?? true)) {
      if (!spaceDownRef.current) return;
      setJumpTrigger(v => v + 1);
    }
    moveTo(nx, ny);
  }, [moveTo, isFainting, rules?.poiObstacleCollisionEnabled, rules?.platform3dJumpEnabled, poiPoints]);

  const hold = useHoldMovement(move, {
    walkStepMs: rules?.movementWalkStepMs ?? 220,
    runStepMs: rules?.movementRunStepMs ?? 110,
    runHoldThresholdMs: rules?.movementRunHoldThresholdMs ?? 1500,
    onRunChange: setIsRunning,
  });
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
      if (dx === 0 && dy === 0) hold.release(); else hold.update(dx, dy);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      keysDownRef.current.clear();
      hold.release();
    };
  }, [collapsed, enabled, hold]);

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
          onPointerDownCapture={bringToFront}
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

  return (
    <div
      ref={containerRef}
      className="fixed z-40 bg-slate-950 border-2 border-lime-500 rounded-xl shadow-2xl select-none"
      style={{ left: pos.x, top: pos.y, width: size.w, zIndex: z }}
      onPointerDownCapture={bringToFront}
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
          <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
        </div>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div ref={fullscreenRef} className="relative bg-slate-950" style={{ width: isFullscreen ? '100vw' : size.w, height: isFullscreen ? '100vh' : size.h }}>
        <Canvas shadows camera={{ position: [0, 3.2, 5.6], fov: 45 }}>
          <Scene
            centerCol={centerCol} centerRow={centerRow} poiPoints={poiPoints} sceneMarkers={sceneMarkers}
            stage={stage} walking={isWalking} running={isRunning} swimming={swimming} jumpTrigger={jumpTrigger}
            facing={facing} equipment={equipment} equipmentRenderEnabled={rules?.platform3dEquipmentRenderEnabled ?? true}
            onTileClick={onTileClick} onPortalTileClick={onPortalTileClick3D} onHutTileClick={onHutTileClick3D}
            onMarkerClick={onMarkerClick3D}
          />
        </Canvas>
        <div className="absolute top-1.5 left-1.5 bg-slate-900/70 rounded px-2 py-1 text-[10px] text-lime-200 pointer-events-none">
          {swimming ? '🏊 ' + t('game.platform3d.swimming') : isRunning ? '🏃 ' + t('game.platform3d.running') : '🚶 ' + t('game.platform3d.walking')}
          {player && <span className="ml-2">💨 {Math.round(player.oxygen ?? 100)}% · 🔋 {Math.round(player.fatigue ?? 100)}%</span>}
        </div>
        {islandBlockedMsg && (
          <div className="absolute top-8 left-1.5 right-1.5 bg-amber-900/90 text-amber-100 text-[11px] rounded px-2 py-1 text-center">
            {islandBlockedMsg}
          </div>
        )}
        <div className="absolute bottom-2 left-2 grid grid-cols-3 grid-rows-3 gap-0.5 w-[84px] h-[84px] z-10" title={t('canvas2d.dpadTitle')}>
          <button className={dpadBtn} onPointerDown={() => hold.press(-1, -1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadUpLeft')}>↖</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(0, -1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadUp')}>▲</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(1, -1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadUpRight')}>↗</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(-1, 0)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadLeft')}>◀</button>
          <div />
          <button className={dpadBtn} onPointerDown={() => hold.press(1, 0)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadRight')}>▶</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(-1, 1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadDownLeft')}>↙</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(0, 1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadDown')}>▼</button>
          <button className={dpadBtn} onPointerDown={() => hold.press(1, 1)} onPointerUp={hold.release} onPointerLeave={hold.release} onPointerCancel={hold.release} title={t('canvas2d.dpadDownRight')}>↘</button>
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
