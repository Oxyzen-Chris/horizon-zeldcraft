'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  subscribePlayer, subscribeInventory, getKingdomQuestMarker, subscribeSolvedQuestIds,
  getZorghonEncounter, subscribeZorghonEncounter,
  type MapMarker, type MapPoiType, type RepRules, type PlayerState, type InventoryItem,
  type ZorghonEncounterState, type SynkDirection,
} from '@/lib/gameState';
import { worldTileAt, clamp100, WORLD_SIZE, TERRAIN_COLOR, PROP_ICON, type Tile } from '@/lib/worldTerrain';
import { STAGE_NAMES } from '@/lib/contract';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { useDraggableWidget } from '@/lib/useDraggableWidget';
import { WidgetContextMenu } from './WidgetContextMenu';

const POS_KEY = 'zc.platform3dWidgetPos';
const COLLAPSED_KEY = 'zc.platform3dWidgetCollapsed';

// Rayon (en cellules mapmonde, même échelle 0-100% que WorldMapWidget.tsx/GameCanvas2D.tsx) de
// terrain 3D effectivement rendu autour de Synk — volontairement plus petit que le COLSxROWS de la
// Plateforme 2D isométrique (fenêtre bien plus grande) car chaque cellule ici coûte un mesh 3D
// (perf), largement suffisant pour une exploration immersive centrée sur Synk.
const VIEW_RADIUS = 7;
const STEP_PCT = 1; // même pas qu'en 2D — voir GameCanvas2D.tsx::STEP_PCT (cohérence des 3 vues)
const CANVAS_W = 460, CANVAS_H = 360;
const WALK_STOP_DELAY_MS = 220; // identique à GameCanvas2D.tsx (voir sa constante du même nom)

interface Pos { x: number; y: number }

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
 * (couleur de repli `#94a3b8` si absent du registre). */
function MarkerBlock({ kind, x, z }: { kind: string; x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.y = 0.15 + Math.sin(state.clock.elapsedTime * 2 + x * 3 + z * 3) * 0.06;
    ref.current.rotation.y += 0.01;
  });
  const color = MARKER_COLOR[kind] ?? '#94a3b8';
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, -0.42, 0]}><boxGeometry args={[0.5, 0.16, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh ref={ref}>
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

/** Synk en voxels (façon Minecraft : tête/torse/bras/jambes empilés) — même 8 directions et même
 * animation de marche (bobbing) que la Plateforme 2D isométrique/SynkSkin.tsx, teinte selon le
 * stade (`STAGE_COLOR_3D`). S'enfonce partiellement et flotte (`swimming`) sur une dalle d'eau, en
 * cohérence visuelle avec la mécanique Oxygène déjà pilotée par GameCanvas2D.tsx (celui-ci reste
 * l'unique moteur de décroissance/récupération — ce composant n'est qu'une vue supplémentaire,
 * aucune nouvelle mécanique n'est introduite ici, zéro risque de double-décompte). */
function SynkVoxel({ stage, walking, swimming, facing }: {
  stage: number; walking: boolean; swimming: boolean; facing: SynkDirection;
}) {
  const bobRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!bobRef.current) return;
    if (walking && !swimming) bobRef.current.position.y = Math.abs(Math.sin(state.clock.elapsedTime * 8)) * 0.08;
    else if (swimming) bobRef.current.position.y = Math.sin(state.clock.elapsedTime * 3) * 0.05;
    else bobRef.current.position.y = 0;
  });
  const color = STAGE_COLOR_3D[STAGE_NAMES[stage] || 'egg'] ?? '#22823a';
  const angle = FACING_ANGLE[facing] ?? 0;
  return (
    <group position={[0, swimming ? -0.45 : 0, 0]} rotation={[0, angle, 0]}>
      <group ref={bobRef}>
        <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[0.42, 0.42, 0.42]} /><meshStandardMaterial color="#f2c99d" /></mesh>
        <mesh position={[0, 0.62, 0.19]}><boxGeometry args={[0.28, 0.1, 0.06]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0, 0.2, 0]} castShadow><boxGeometry args={[0.36, 0.46, 0.26]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[-0.26, 0.2, 0]} castShadow><boxGeometry args={[0.12, 0.4, 0.12]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[0.26, 0.2, 0]} castShadow><boxGeometry args={[0.12, 0.4, 0.12]} /><meshStandardMaterial color={color} /></mesh>
        {!swimming && (
          <>
            <mesh position={[-0.11, -0.24, 0]} castShadow><boxGeometry args={[0.14, 0.36, 0.14]} /><meshStandardMaterial color="#5b3a1e" /></mesh>
            <mesh position={[0.11, -0.24, 0]} castShadow><boxGeometry args={[0.14, 0.36, 0.14]} /><meshStandardMaterial color="#5b3a1e" /></mesh>
          </>
        )}
      </group>
    </group>
  );
}

interface SceneMarker { id: string; kind: string; x: number; z: number }

/** Contenu 3D de la scène (terrain + Synk + entités) — composant séparé pour pouvoir utiliser
 * `useFrame`/les hooks R3F, qui exigent d'être montés SOUS `<Canvas>`. */
function Scene({ centerCol, centerRow, poiPoints, sceneMarkers, stage, walking, swimming, facing, onTileClick }: {
  centerCol: number; centerRow: number;
  poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[];
  sceneMarkers: SceneMarker[];
  stage: number; walking: boolean; swimming: boolean; facing: SynkDirection;
  onTileClick: (wc: number, wr: number) => void;
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
      {tiles.map(({ tile, wc, wr, x, z }) => (
        <group key={`${wc}-${wr}`}>
          <TerrainBlock tile={tile} x={x} z={z} onClick={() => onTileClick(wc, wr)} />
          {tile.prop && <PropBlock kind={tile.prop} x={x} z={z} topY={tile.terrain === 'rock' ? Math.min(1.9, (tile.altitudeM ?? 300) / 2800) : 0} />}
        </group>
      ))}
      {sceneMarkers.map(m => <MarkerBlock key={m.id} kind={m.kind} x={m.x} z={m.z} />)}
      <SynkVoxel stage={stage} walking={walking} swimming={swimming} facing={facing} />
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
export function Platform3DWidget({ stage, enabled = true }: { stage: number; enabled?: boolean }) {
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
      if (Math.abs(dx) <= VIEW_RADIUS && Math.abs(dz) <= VIEW_RADIUS) out.push({ id: m.id, kind: m.kind, x: dx, z: dz });
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
  const walkStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      walkStopTimerRef.current = setTimeout(() => setIsWalking(false), WALK_STOP_DELAY_MS);
    }
    const cur = worldPosRef.current;
    moveTo(cur.x + dx * STEP_PCT, cur.y + dy * STEP_PCT);
  }, [moveTo, isFainting]);
  useEffect(() => () => { if (walkStopTimerRef.current) clearTimeout(walkStopTimerRef.current); }, []);

  const onTileClick = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dx = wc - Math.round(cur.x), dy = wr - Math.round(cur.y);
    const dir = directionFromDelta(dx, dy);
    if (dir) setFacing(dir);
    moveTo(wc, wr);
  }, [moveTo]);

  // Déplacement au clavier (flèches + WASD, y compris en diagonale) — actif seulement widget
  // déplié, ignoré si le focus est dans un champ de saisie, même logique que GameCanvas2D.tsx.
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
      keysDownRef.current.add(e.key);
      const { dx, dy } = composite();
      if (dx !== 0 || dy !== 0) move(dx, dy);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (ALL.has(e.key)) keysDownRef.current.delete(e.key); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      keysDownRef.current.clear();
    };
  }, [collapsed, enabled, move]);

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

  return (
    <div
      ref={containerRef}
      className="fixed z-40 bg-slate-950 border-2 border-lime-500 rounded-xl shadow-2xl select-none"
      style={{ left: pos.x, top: pos.y, width: CANVAS_W, zIndex: z }}
      onPointerDownCapture={bringToFront}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-lime-900/30 rounded-t-xl cursor-move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold truncate">🧊 {t('game.platform3d.widgetTitle')}</span>
        <button className="text-xs opacity-70 hover:opacity-100 shrink-0 ml-2" onClick={toggleCollapsed}>✕</button>
      </div>
      <WidgetContextMenu pos={menuPos} onClose={closeContextMenu} onRecenter={resetPosition} />
      <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
        <Canvas shadows camera={{ position: [0, 3.2, 5.6], fov: 45 }}>
          <Scene
            centerCol={centerCol} centerRow={centerRow} poiPoints={poiPoints} sceneMarkers={sceneMarkers}
            stage={stage} walking={isWalking} swimming={swimming} facing={facing} onTileClick={onTileClick}
          />
        </Canvas>
        <div className="absolute top-1.5 left-1.5 bg-slate-900/70 rounded px-2 py-1 text-[10px] text-lime-200 pointer-events-none">
          {swimming ? '🏊 ' + t('game.platform3d.swimming') : '🚶 ' + t('game.platform3d.walking')}
          {player && <span className="ml-2">💨 {Math.round(player.oxygen ?? 100)}% · 🔋 {Math.round(player.fatigue ?? 100)}%</span>}
        </div>
        {islandBlockedMsg && (
          <div className="absolute top-8 left-1.5 right-1.5 bg-amber-900/90 text-amber-100 text-[11px] rounded px-2 py-1 text-center">
            {islandBlockedMsg}
          </div>
        )}
        <div className="absolute bottom-2 left-2 grid grid-cols-3 grid-rows-3 gap-0.5 w-[84px] h-[84px] z-10" title={t('canvas2d.dpadTitle')}>
          <button className={dpadBtn} onClick={() => move(-1, -1)} title={t('canvas2d.dpadUpLeft')}>↖</button>
          <button className={dpadBtn} onClick={() => move(0, -1)} title={t('canvas2d.dpadUp')}>▲</button>
          <button className={dpadBtn} onClick={() => move(1, -1)} title={t('canvas2d.dpadUpRight')}>↗</button>
          <button className={dpadBtn} onClick={() => move(-1, 0)} title={t('canvas2d.dpadLeft')}>◀</button>
          <div />
          <button className={dpadBtn} onClick={() => move(1, 0)} title={t('canvas2d.dpadRight')}>▶</button>
          <button className={dpadBtn} onClick={() => move(-1, 1)} title={t('canvas2d.dpadDownLeft')}>↙</button>
          <button className={dpadBtn} onClick={() => move(0, 1)} title={t('canvas2d.dpadDown')}>▼</button>
          <button className={dpadBtn} onClick={() => move(1, 1)} title={t('canvas2d.dpadDownRight')}>↘</button>
        </div>
        <p className="absolute bottom-2 right-2 text-[9px] text-slate-500 max-w-[180px] text-right pointer-events-none">
          {t('game.platform3d.hint')}
        </p>
      </div>
    </div>
  );
}
