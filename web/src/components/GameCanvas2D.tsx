'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  getAllMapMarkers, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID, getRepRules,
  type MapMarker, type MapPoiType, type RepRules,
} from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { SynkSkin } from './SynkSkin';
import { PoiInteractionModal } from './PoiInteractionModal';
import { HutRestModal } from './HutRestModal';
import { NPC_SKINS } from '@/lib/contract';
import type { EncounterMarkerInfo } from './NpcEncounterPopup';

const POS_KEY = 'zc.iso2dWidgetPos';
const SIZE_KEY = 'zc.iso2dWidgetSize';
const COLLAPSED_KEY = 'zc.iso2dWidgetCollapsed';
interface Pos { x: number; y: number }
interface Size { w: number; h: number }

const MIN_W = 380, MIN_H = 300, MAX_W = 900, MAX_H = 680;
const COLS = 10, ROWS = 8;
const TILE_W = 56, TILE_H = 28;
// Le viewport isométrique est une fenêtre COLSxROWS glissant sur l'espace complet de la mapmonde
// (0-100 en x/y, même échelle en % que WorldMapWidget.tsx) — un pas de flèche/pavé directionnel
// déplace Synk de STEP_PCT sur cette échelle, ce qui garde les deux widgets parfaitement cohérents
// (même source de vérité : players/{addr}/mapPos, voir gameState.ts::setPlayerMapPos).
const WORLD_SIZE = 100;
const STEP_PCT = 1; // Synk avance d'une case (= 1 unité mapmonde) à chaque pression/clic — voir move()
const MARGIN = 1; // marge (en cellules) avant que la caméra ne recadre le décor
const POI_BIAS_RADIUS = 9; // rayon (en unités mapmonde) dans lequel un POI influence le terrain local

type Terrain = 'grass' | 'water' | 'rock' | 'sand' | 'path';
type PropKind = 'tree' | 'castle' | 'hut' | 'portal' | null;

const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: '#4d8a3f', water: '#3b7fb0', rock: '#8a8577', sand: '#d8c07a', path: '#a9865a',
};
const PROP_ICON: Record<Exclude<PropKind, null>, string> = {
  tree: '🌲', castle: '🏰', hut: '🛖', portal: '🌀',
};
const TERRAIN_I18N_KEY: Record<Terrain, string> = {
  grass: 'canvas2d.terrainGrass', water: 'canvas2d.terrainWater', rock: 'canvas2d.terrainRock',
  sand: 'canvas2d.terrainSand', path: 'canvas2d.terrainPath',
};
const PROP_I18N_KEY: Record<Exclude<PropKind, null>, string> = {
  tree: 'canvas2d.propTree', castle: 'canvas2d.propCastle', hut: 'canvas2d.propHut', portal: 'canvas2d.propPortal',
};

interface Tile { terrain: Terrain; prop: PropKind }
interface Actor { id: string; col: number; row: number; icon: string; label: string }

/** Petit PRNG déterministe (hash entier) — deux appels avec les mêmes (wc, wr, salt) renvoient
 * toujours la même valeur 0..1. Sert à générer un terrain STABLE par coordonnée absolue de la
 * mapmonde (wc, wr en %), pour que le décor défile de façon cohérente quand la caméra panote
 * (et non ré-aléatoire à chaque déplacement) — voir buildViewportGrid() ci-dessous. */
function hashRand(wc: number, wr: number, salt: number): number {
  let h = (wc * 374761393 + wr * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** Terrain déterministe d'une cellule absolue (wc, wr) de la mapmonde, biaisé par le POI-décor le
 * PLUS PROCHE dans un rayon de POI_BIAS_RADIUS unités (et non plus par un biais global unique) —
 * ainsi un lac/une montagne/un sentier de la mapmonde apparaît bien À SA VRAIE POSITION dans la
 * vue isométrique (cohérence carte ↔ plateforme demandée), et pas de façon uniforme sur toute la
 * fenêtre affichée. */
function worldTileAt(wc: number, wr: number, poiPoints: { x: number; y: number; poiType?: MapPoiType }[]): Tile {
  let bias: MapPoiType | null = null;
  let bestD = POI_BIAS_RADIUS;
  for (const p of poiPoints) {
    if (!p.poiType) continue;
    const d = Math.hypot(p.x - wc, p.y - wr);
    if (d <= bestD) { bestD = d; bias = p.poiType; }
  }

  const waterBias = bias === 'lake' || bias === 'stream' || bias === 'waterfall';
  const sandBias = bias === 'beach';
  const rockBias = bias === 'mountain' || bias === 'cave';
  const forestBias = bias === 'forest';
  const pathBias = bias === 'path' || bias === 'bridge';
  const buildingBias = bias === 'village_ally' || bias === 'village_enemy' || bias === 'tavern' || bias === 'stable' || bias === 'hut';

  let terrain: Terrain = 'grass';
  const r0 = hashRand(wc, wr, 1);
  if (waterBias && r0 < 0.32) terrain = 'water';
  else if (sandBias && r0 < 0.35) terrain = 'sand';
  else if (rockBias && r0 < 0.35) terrain = 'rock';
  else if (pathBias && r0 < 0.5) terrain = 'path';
  else if (r0 < 0.04) terrain = 'water'; // petit point d'eau ambiant même hors biais

  let prop: PropKind = null;
  const treeChance = forestBias ? 0.28 : 0.08;
  if (terrain === 'grass' && hashRand(wc, wr, 2) < treeChance) prop = 'tree';
  // Bâtisse éparse (rare) si biais village/taverne/étable/hutte
  if (buildingBias && terrain === 'grass' && !prop && hashRand(wc, wr, 3) < 0.05) {
    prop = (bias === 'village_ally' || bias === 'village_enemy') ? 'castle' : 'hut';
  }
  // Portail temporel rare et stable, dispersé sur toute la mapmonde
  if (!prop && hashRand(wc, wr, 4) < 0.01) prop = 'portal';

  return { terrain, prop };
}

/** Construit la grille COLSxROWS visible à partir du coin (originCol, originRow) de la caméra. */
function buildViewportGrid(originCol: number, originRow: number, poiPoints: { x: number; y: number; poiType?: MapPoiType }[]): Tile[][] {
  const grid: Tile[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < COLS; c++) row.push(worldTileAt(originCol + c, originRow + r, poiPoints));
    grid.push(row);
  }
  return grid;
}

const projX = (col: number, row: number) => (col - row) * (TILE_W / 2);
const projY = (col: number, row: number) => (col + row) * (TILE_H / 2);
const clamp100 = (v: number) => Math.max(0, Math.min(WORLD_SIZE, v));

/**
 * Plateforme de jeu 2D en vue isométrique — fenêtre widget permanente, redimensionnable (glisser
 * le coin ⤡). Conçue comme le SOCLE ÉVOLUTIF de gestion des déplacements/rencontres/décor de Synk,
 * des PNJ, dragons, etc., à l'image des univers Zelda/Minecraft/WoW demandés.
 *
 * IMPORTANT (choix d'architecture) : un vrai moteur Godot/Unity ne peut pas être « embarqué » tel
 * quel dans une session de développement assistée sur ce dépôt Next.js/Vercel (pas de pipeline
 * d'assets/export WebGL/WASM disponible ici). Ce composant fournit donc une implémentation
 * pragmatique et 100% fonctionnelle en React/CSS (grille isométrique, terrain procédural
 * DÉTERMINISTE par coordonnée mapmonde, déplacement clavier/pavé virtuel/clic, PNJ/dragon qui
 * évoluent) exposant le même contrat de données (entités positionnées sur une grille, terrain
 * dérivé des POI de la mapmonde) qu'un futur export Godot/Unity WebGL pourrait consommer sans tout
 * réécrire — voir `worldTileAt()`/`Actor` ci-dessus.
 *
 * Synchronisation avec la mapmonde (voir WorldMapWidget.tsx) : la position de Synk est désormais
 * partagée en TEMPS RÉEL entre les deux widgets via `players/{addr}/mapPos` (0-100% en x/y, même
 * échelle dans les deux vues — voir `subscribePlayerMapPos`/`setPlayerMapPos` dans gameState.ts).
 * Déplacer Synk ici (flèches clavier ↑↓←→, pavé directionnel virtuel, ou clic sur une tuile) met
 * à jour cette position partagée, immédiatement répercutée sur le widget Mapmonde — et
 * réciproquement un déplacement sur la Mapmonde recentre instantanément la caméra isométrique ici.
 * Quand Synk approche du bord de la fenêtre COLSxROWS affichée, la caméra recadre (pan) le décor
 * dans la direction du déplacement pour continuer à explorer tout l'espace de la mapmonde.
 */
export function GameCanvas2D({ stage, playerXp = 0, encounterNpc }: { stage: number; playerXp?: number; encounterNpc?: EncounterMarkerInfo }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { z, bringToFront } = useWindowZIndex();

  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size>({ w: 480, h: 380 });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });

  // Règles admin (voir gameState.ts::RepRules) — récupérées une fois pour les interactions POI
  // (repos en hutte notamment : hutRestHp/hutRestCooldownHours/hutRestDurationSec).
  const [rules, setRules] = useState<RepRules | null>(null);
  useEffect(() => { getRepRules().then(setRules).catch(() => {}); }, []);

  // Marqueur cliqué (PNJ/familier/trésor/quête/monde/hutte) alors que Synk est sur sa case ou une
  // case adjacente — voir handleMarkerClick() plus bas. `hutResting` bascule sur la fenêtre plein
  // écran de repos (voir HutRestModal.tsx) une fois le pop-up d'interaction refermé.
  const [interactionMarker, setInteractionMarker] = useState<MapMarker | null>(null);
  const [hutResting, setHutResting] = useState(false);
  const [hutFeedback, setHutFeedback] = useState<string | null>(null);

  const [biasLabel, setBiasLabel] = useState<string>('');
  // Tous les marqueurs de la mapmonde (décor/terrain, mondes, PNJ, trésors, familiers, quêtes PNJ —
  // voir gameState.ts::getAllMapMarkers), positionnés IDENTIQUEMENT à WorldMapWidget.tsx (même
  // fonction, même repli déterministe) afin que les deux vues soient toujours cohérentes.
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const poiPoints = useMemo(
    () => markers.filter(m => m.kind === 'poi').map(m => ({ x: m.x, y: m.y, poiType: m.poiType })),
    [markers],
  );

  // Position réelle de Synk sur la mapmonde (0-100%, source de vérité partagée avec
  // WorldMapWidget.tsx) et coin de la caméra isométrique (en cellules, 0-100 chacun).
  const [worldPos, setWorldPos] = useState<Pos>({ x: 50, y: 88 });
  const [origin, setOrigin] = useState({ col: 45, row: 84 });
  const worldPosRef = useRef(worldPos);
  useEffect(() => { worldPosRef.current = worldPos; }, [worldPos]);

  const [npc, setNpc] = useState<Actor>({ id: 'npc', col: 4, row: 3, icon: '🧙', label: t('canvas2d.npcLabel') });
  const [dragon, setDragon] = useState<Actor>({ id: 'dragon', col: 7, row: 5, icon: '🐉', label: t('canvas2d.dragonLabel') });

  // Identité catalogue (PNJ/familier-dragon réel) attribuée une fois au PNJ/Dragon errant, pour que
  // leur clic ouvre le VRAI pop-up d'interaction (discussion/quête ou apprivoisement) au lieu de ne
  // rien faire — voir onActorClick() plus bas. Choisie aléatoirement dès que le catalogue est chargé
  // puis figée (ne change plus tant que le widget reste monté).
  const [roamingNpcId, setRoamingNpcId] = useState<string | null>(null);
  const [roamingDragonId, setRoamingDragonId] = useState<string | null>(null);

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const savedPos = localStorage.getItem(POS_KEY);
    if (savedPos) { try { setPos(JSON.parse(savedPos)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 520, y: 90 });
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (savedSize) { try { setSize(JSON.parse(savedSize)); } catch { /* ignore */ } }
  }, []);

  // Tous les marqueurs de la mapmonde (une fois) — décor pour le biais de terrain local (voir
  // worldTileAt) ET affichage direct dans la fenêtre de la caméra (voir rendu plus bas).
  useEffect(() => { getAllMapMarkers(DEFAULT_MAP_ID).then(setMarkers).catch(() => {}); }, []);

  // Attribue au PNJ errant et au Dragon errant une véritable entrée du catalogue (dès que les
  // marqueurs sont chargés), pour que cliquer sur eux ouvre le vrai pop-up (discussion/quête pour le
  // PNJ, apprivoisement pour le dragon) — voir onActorClick(). Le dragon préfère un familier de type
  // "dragon.*" (voir DragonSkin.tsx::dragonKindFromId) s'il en existe un dans le catalogue.
  useEffect(() => {
    if (!roamingNpcId) {
      const pool = markers.filter(m => m.kind === 'npc');
      if (pool.length) setRoamingNpcId(pool[Math.floor(Math.random() * pool.length)].id);
    }
    if (!roamingDragonId) {
      const familiars = markers.filter(m => m.kind === 'familiar');
      const dragons = familiars.filter(m => /^dragon\./i.test(m.id));
      const pool = dragons.length ? dragons : familiars;
      if (pool.length) setRoamingDragonId(pool[Math.floor(Math.random() * pool.length)].id);
    }
  }, [markers, roamingNpcId, roamingDragonId]);

  const roamingNpcMarker = useMemo(
    () => markers.find(m => m.kind === 'npc' && m.id === roamingNpcId) ?? null,
    [markers, roamingNpcId],
  );
  const roamingDragonMarker = useMemo(
    () => markers.find(m => m.kind === 'familiar' && m.id === roamingDragonId) ?? null,
    [markers, roamingDragonId],
  );
  const worldMarkers = useMemo(() => markers.filter(m => m.kind === 'world'), [markers]);

  // Écoute temps réel de la position de Synk — synchronise instantanément avec WorldMapWidget.tsx,
  // quel que soit le widget à l'origine du déplacement (clic carte, flèches, pavé virtuel).
  useEffect(() => {
    if (!address) return;
    return subscribePlayerMapPos(address, p => {
      if (p && p.mapId === DEFAULT_MAP_ID) setWorldPos({ x: p.x, y: p.y });
    });
  }, [address]);

  // Raccord avec la mapmonde : détermine le POI-décor le plus proche de la position réelle de Synk
  // (juste pour l'indication textuelle affichée sous le titre — le terrain lui-même est désormais
  // biaisé LOCALEMENT par POI, voir worldTileAt()).
  useEffect(() => {
    if (!poiPoints.length) return;
    let nearest: { name: string } | null = null;
    let bestD = Infinity;
    for (const poi of markers) {
      if (poi.kind !== 'poi') continue;
      const d = Math.hypot(poi.x - worldPos.x, poi.y - worldPos.y);
      if (d < bestD) { bestD = d; nearest = poi; }
    }
    if (nearest) setBiasLabel(nearest.name);
  }, [markers, poiPoints.length, worldPos]);

  // Caméra qui suit Synk : recadre (pan) le décor dès qu'il approche du bord de la fenêtre
  // affichée, pour continuer à progresser dans l'espace total de la mapmonde (0-100%).
  useEffect(() => {
    const wc = Math.round(clamp100(worldPos.x));
    const wr = Math.round(clamp100(worldPos.y));
    setOrigin(prev => {
      let { col, row } = prev;
      if (wc - col < MARGIN) col = wc - MARGIN;
      else if (wc - col > COLS - 1 - MARGIN) col = wc - (COLS - 1 - MARGIN);
      if (wr - row < MARGIN) row = wr - MARGIN;
      else if (wr - row > ROWS - 1 - MARGIN) row = wr - (ROWS - 1 - MARGIN);
      col = Math.max(0, Math.min(WORLD_SIZE - COLS, col));
      row = Math.max(0, Math.min(WORLD_SIZE - ROWS, row));
      return (col === prev.col && row === prev.row) ? prev : { col, row };
    });
  }, [worldPos]);

  const grid = useMemo(() => buildViewportGrid(origin.col, origin.row, poiPoints), [origin, poiPoints]);

  // Marqueurs visibles dans la fenêtre de caméra actuelle (COLSxROWS), convertis en cellule locale —
  // c'est ce qui « repositionne tous les POI de la mapmonde sur la plateforme 2D isométrique ».
  const visibleMarkers = useMemo(() => {
    const out: (MapMarker & { col: number; row: number })[] = [];
    for (const m of markers) {
      const wc = Math.round(m.x), wr = Math.round(m.y);
      const col = wc - origin.col, row = wr - origin.row;
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) out.push({ ...m, col, row });
    }
    return out;
  }, [markers, origin]);

  const worldCol = Math.round(clamp100(worldPos.x));
  const worldRow = Math.round(clamp100(worldPos.y));
  const playerCell = {
    col: Math.max(0, Math.min(COLS - 1, worldCol - origin.col)),
    row: Math.max(0, Math.min(ROWS - 1, worldRow - origin.row)),
  };
  // Cellule adjacente à Synk où matérialiser le PNJ "en approche" (voir encounterNpc) — juste au
  // nord de Synk, ou au sud si Synk est déjà collé au bord haut de la fenêtre de caméra.
  const encounterCell = {
    col: playerCell.col,
    row: playerCell.row > 0 ? playerCell.row - 1 : Math.min(ROWS - 1, playerCell.row + 1),
  };

  // ─── Déplacement de Synk (flèches clavier, pavé directionnel virtuel, clic sur une tuile) ───
  // Écrit directement dans `players/{addr}/mapPos` (même donnée que WorldMapWidget.tsx) : la
  // caméra isométrique ET la carte se mettent à jour en temps réel via subscribePlayerMapPos.
  const moveTo = useCallback((nx: number, ny: number) => {
    if (!address) return;
    const x = clamp100(nx), y = clamp100(ny);
    setWorldPos({ x, y });
    worldPosRef.current = { x, y };
    setPlayerMapPos(address, DEFAULT_MAP_ID, x, y).catch(() => {});
  }, [address]);

  const move = useCallback((dx: number, dy: number) => {
    const cur = worldPosRef.current;
    moveTo(cur.x + dx * STEP_PCT, cur.y + dy * STEP_PCT);
  }, [moveTo]);

  // ─── Clic sur un marqueur (PNJ, familier/dragon, trésor, quête, monde, hutte) ───
  // Si Synk est déjà sur sa case ou une case adjacente (distance ≤ 1 cellule) : ouvre le pop-up
  // d'interaction adéquat (voir PoiInteractionModal.tsx). Sinon, déplace Synk vers ce marqueur
  // (comme un clic sur la tuile sous-jacente) — un second clic une fois arrivé ouvrira le pop-up.
  // Les POI purement décoratifs (montagne, lac, sentier...) ne déclenchent aucun pop-up : leur
  // découverte fortuite (petit bonus d'XP) est déjà gérée par WorldMapWidget.tsx::runDiscoveryScan.
  const onMarkerClick = useCallback((m: MapMarker) => {
    const interactable = m.kind === 'npc' || m.kind === 'familiar' || m.kind === 'treasure'
      || m.kind === 'quest' || m.kind === 'world' || (m.kind === 'poi' && m.poiType === 'hut');
    if (!interactable) return;
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(Math.round(m.x) - Math.round(cur.x)), Math.abs(Math.round(m.y) - Math.round(cur.y)));
    if (dist <= 1) setInteractionMarker(m);
    else moveTo(m.x, m.y);
  }, [moveTo]);

  // ─── Clic sur le PNJ errant ou le Dragon errant (icônes qui se déplacent seules dans la grille) ───
  // Contrairement aux marqueurs catalogue ci-dessus, ces acteurs n'existent qu'en coordonnées LOCALES
  // (col/row dans la fenêtre de caméra) : l'adjacence se calcule donc contre `playerCell` (lui aussi
  // local), et « se rapprocher » convertit leur position locale en coordonnées mapmonde absolues
  // (origin + col/row) pour réutiliser moveTo(). `marker` est la véritable entrée catalogue (PNJ ou
  // familier-dragon) attribuée plus haut : sans elle (catalogue vide), le clic ne fait rien.
  const onActorClick = useCallback((actor: Actor, marker: MapMarker | null) => {
    if (!marker) return;
    const dist = Math.max(Math.abs(actor.col - playerCell.col), Math.abs(actor.row - playerCell.row));
    if (dist <= 1) setInteractionMarker(marker);
    else moveTo(origin.col + actor.col, origin.row + actor.row);
  }, [moveTo, origin, playerCell]);

  // ─── Clic sur une tuile portant un portail décoratif (🌀 généré aléatoirement par worldTileAt) ───
  // Chaque portail décoratif est associé de façon déterministe (même case ⇒ toujours le même monde)
  // à l'un des vrais mondes du catalogue, afin d'ouvrir le même pop-up « Monde » que les portes de
  // monde officielles (visibleMarkers ci-dessus) plutôt que de rester muet. S'il n'y a Adjacence
  // (≤ 1 case), on rapproche Synk comme pour une tuile normale.
  const onPortalTileClick = useCallback((wc: number, wr: number) => {
    const cur = worldPosRef.current;
    const dist = Math.max(Math.abs(wc - Math.round(cur.x)), Math.abs(wr - Math.round(cur.y)));
    if (dist <= 1 && worldMarkers.length) {
      const idx = Math.floor(hashRand(wc, wr, 5) * worldMarkers.length);
      setInteractionMarker(worldMarkers[Math.min(worldMarkers.length - 1, idx)]);
    } else {
      moveTo(wc, wr);
    }
  }, [moveTo, worldMarkers]);

  // ─── Clic sur une tuile portant une hutte décorative (🛖 générée aléatoirement par worldTileAt,
  // biais village/taverne/étable/hutte) ─── Aucune MapPoiDef "hutte" n'est semée par défaut dans le
  // catalogue (elles ne sont créées que si l'admin en ajoute via la rubrique Carte) : la hutte que
  // le joueur voit et clique le plus souvent sur la Plateforme 2D isométrique est donc CETTE tuile
  // décorative, qui — comme le portail ci-dessus — ne déclenchait jusqu'ici aucun pop-up. On
  // synthétise un marqueur "poi/hut" pour ouvrir le même pop-up de repos que HutBody (voir
  // PoiInteractionModal.tsx), avec son message de cooldown déjà géré (getHutRestRemainingMs).
  const onHutTileClick = useCallback((wc: number, wr: number) => {
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

  // Déplacement au clavier (flèches directionnelles) — actif seulement widget déplié, et ignoré
  // si le focus est dans un champ de saisie (chat, admin, etc.) pour ne pas interférer.
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case 'ArrowUp': e.preventDefault(); move(0, -1); break;
        case 'ArrowDown': e.preventDefault(); move(0, 1); break;
        case 'ArrowLeft': e.preventDefault(); move(-1, 0); break;
        case 'ArrowRight': e.preventDefault(); move(1, 0); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, move]);

  // PNJ et dragon errent doucement dans la grille pour donner l'impression d'un monde vivant.
  useEffect(() => {
    const iv = setInterval(() => {
      setNpc(p => ({ ...p, col: clampCoord(p.col + (Math.random() < 0.5 ? -1 : 1), COLS), row: clampCoord(p.row + (Math.random() < 0.5 ? -1 : 1), ROWS) }));
      setDragon(p => ({ ...p, col: clampCoord(p.col + (Math.random() < 0.5 ? -1 : 1), COLS), row: clampCoord(p.row + (Math.random() < 0.5 ? -1 : 1), ROWS) }));
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  };
  const onHeaderPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };
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
  const toggleCollapsed = () => {
    setCollapsed(prev => { localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1'); return !prev; });
  };

  if (!pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-emerald-950 border-2 border-emerald-600 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y, zIndex: z }}
        onPointerDownCapture={bringToFront}
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('canvas2d.title')}
      >🧩</button>
    );
  }

  const originX = size.w / 2, originY = 46;
  const dpadBtn = 'flex items-center justify-center rounded bg-emerald-900/80 hover:bg-emerald-700 active:bg-emerald-600 border border-emerald-600 text-emerald-100 text-sm shadow select-none';

  return (
    <div
      className="fixed z-40 bg-slate-950 border-2 border-emerald-600 rounded-xl shadow-2xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }}
      onPointerDownCapture={bringToFront}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-emerald-900/40 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
      >
        <span className="text-sm font-semibold text-emerald-100">🧩 {t('canvas2d.title')}</span>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={toggleCollapsed}>✕</button>
      </div>
      <p className="px-3 pt-1 text-[10px] text-emerald-400/80 shrink-0" title={t('canvas2d.engineNote')}>
        ℹ️ {biasLabel ? t('canvas2d.biasHint', { poi: biasLabel }) : t('canvas2d.hint')} · {t('canvas2d.moveHint')}
      </p>

      <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-sky-950 to-slate-900 rounded-b-xl">
        <div className="absolute inset-0" style={{ transform: `translate(${originX}px, ${originY}px)` }}>
          {grid.flatMap((rowTiles, r) => rowTiles.map((tile, c) => {
            const x = projX(c, r), y = projY(c, r);
            const zIdx = c + r;
            return (
              <div key={`t-${r}-${c}`} className="absolute" style={{ left: x - TILE_W / 2, top: y - TILE_H / 2, zIndex: zIdx }}>
                <div
                  className="cursor-pointer hover:brightness-125"
                  style={{
                    width: TILE_W, height: TILE_H, background: TERRAIN_COLOR[tile.terrain],
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    border: '1px solid rgba(0,0,0,0.15)',
                  }}
                  onClick={() => {
                    if (tile.prop === 'portal') onPortalTileClick(origin.col + c, origin.row + r);
                    else if (tile.prop === 'hut') onHutTileClick(origin.col + c, origin.row + r);
                    else moveTo(origin.col + c, origin.row + r);
                  }}
                  title={tile.prop ? `${PROP_ICON[tile.prop]} ${t(PROP_I18N_KEY[tile.prop])}` : t(TERRAIN_I18N_KEY[tile.terrain])}
                />
                {tile.prop && (
                  <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-lg pointer-events-none select-none" style={{ zIndex: zIdx + 1 }}>
                    {PROP_ICON[tile.prop]}
                  </span>
                )}
              </div>
            );
          }))}

          {/* POI/mondes/PNJ/trésors/familiers/quêtes de la mapmonde, repositionnés à leur vraie
              position dans la fenêtre de caméra (voir gameState.ts::getAllMapMarkers) — survol =
              info-bulle avec le nom du POI. */}
          {visibleMarkers.map(m => {
            const x = projX(m.col, m.row), y = projY(m.col, m.row);
            const zIdx = m.col + m.row + 1;
            const interactable = m.kind === 'npc' || m.kind === 'familiar' || m.kind === 'treasure'
              || m.kind === 'quest' || m.kind === 'world' || (m.kind === 'poi' && m.poiType === 'hut');
            return (
              <div
                key={`m-${m.kind}-${m.id}`}
                className={`absolute -translate-x-1/2 pointer-events-auto select-none ${interactable ? 'cursor-pointer' : 'cursor-help'}`}
                style={{ left: x, top: y - 18, zIndex: zIdx }}
                title={`${m.icon} ${localizeName(t, m.i18nKey, m.name)}`}
                onClick={() => onMarkerClick(m)}
              >
                <span className="text-base drop-shadow" style={{ filter: 'drop-shadow(0 0 2px #000)' }}>{m.icon}</span>
              </div>
            );
          })}

          {/* PNJ errant — cliquable dès qu'un PNJ du catalogue lui a été attribué (voir roamingNpcId) */}
          <div
            className={`absolute -translate-x-1/2 flex flex-col items-center transition-all duration-[1500ms] pointer-events-auto ${roamingNpcMarker ? 'cursor-pointer' : 'cursor-help'}`}
            style={{ left: projX(npc.col, npc.row), top: projY(npc.col, npc.row) - 22, zIndex: npc.col + npc.row + 2 }}
            title={roamingNpcMarker ? `${npc.icon} ${localizeName(t, roamingNpcMarker.i18nKey, roamingNpcMarker.name)}` : npc.label}
            onClick={() => onActorClick(npc, roamingNpcMarker)}
          >
            <span className="text-lg">{npc.icon}</span>
          </div>
          {/* Dragon errant — cliquable dès qu'un familier-dragon du catalogue lui a été attribué */}
          <div
            className={`absolute -translate-x-1/2 flex flex-col items-center transition-all duration-[1500ms] pointer-events-auto ${roamingDragonMarker ? 'cursor-pointer' : 'cursor-help'}`}
            style={{ left: projX(dragon.col, dragon.row), top: projY(dragon.col, dragon.row) - 22, zIndex: dragon.col + dragon.row + 2 }}
            title={roamingDragonMarker ? `${dragon.icon} ${localizeName(t, roamingDragonMarker.i18nKey, roamingDragonMarker.name)}` : dragon.label}
            onClick={() => onActorClick(dragon, roamingDragonMarker)}
          >
            <span className="text-xl">{dragon.icon}</span>
          </div>
          {/* PNJ "en approche" — matérialise la rencontre (pop-up NpcEncounterPopup ouvert) juste à
              côté de Synk, tant que le pop-up reste affiché (voir encounterNpc/onEncounterChange).
              Purement informatif (pointer-events-none) : l'interaction se fait dans le pop-up lui-même. */}
          {encounterNpc && (
            <div
              className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none animate-bounce"
              style={{ left: projX(encounterCell.col, encounterCell.row), top: projY(encounterCell.col, encounterCell.row) - 22, zIndex: encounterCell.col + encounterCell.row + 2 }}
              title={`${NPC_SKINS[encounterNpc.skin]} ${localizeName(t, `npc.archetype.${encounterNpc.baseKey}`, encounterNpc.baseKey)} · ${localizeName(t, `npc.offer.${encounterNpc.offer}`, encounterNpc.offer)}`}
            >
              <span className="text-[10px] leading-none">❗</span>
              <span className="text-xl drop-shadow" style={{ filter: 'drop-shadow(0 0 2px #000)' }}>{NPC_SKINS[encounterNpc.skin]}</span>
            </div>
          )}
          {/* Synk (joueur) */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-500 pointer-events-auto cursor-help"
            style={{ left: projX(playerCell.col, playerCell.row), top: projY(playerCell.col, playerCell.row) - 26, zIndex: playerCell.col + playerCell.row + 3 }}
            title={t('canvas2d.synkLabel')}>
            <SynkSkin stage={stage} size={26} />
          </div>
        </div>

        {/* Pavé directionnel virtuel — mêmes déplacements que les flèches clavier */}
        <div className="absolute bottom-2 left-2 grid grid-cols-3 grid-rows-3 gap-0.5 w-[84px] h-[84px] z-10" title={t('canvas2d.dpadTitle')}>
          <div />
          <button className={dpadBtn} onClick={() => move(0, -1)} title={t('canvas2d.dpadUp')}>▲</button>
          <div />
          <button className={dpadBtn} onClick={() => move(-1, 0)} title={t('canvas2d.dpadLeft')}>◀</button>
          <div className="flex items-center justify-center text-emerald-500/50 text-[10px]">🕹️</div>
          <button className={dpadBtn} onClick={() => move(1, 0)} title={t('canvas2d.dpadRight')}>▶</button>
          <div />
          <button className={dpadBtn} onClick={() => move(0, 1)} title={t('canvas2d.dpadDown')}>▼</button>
          <div />
        </div>
      </div>

      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-emerald-400/70 flex items-center justify-center text-[10px]"
        onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp}
      >⤡</div>

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

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}
