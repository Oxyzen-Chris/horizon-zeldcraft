'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { getPlayerMapPos, getMapPoiDefs, DEFAULT_MAP_ID, type MapPoiDef, type MapPoiType } from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { SynkSkin } from './SynkSkin';

const POS_KEY = 'zc.iso2dWidgetPos';
const SIZE_KEY = 'zc.iso2dWidgetSize';
const COLLAPSED_KEY = 'zc.iso2dWidgetCollapsed';
interface Pos { x: number; y: number }
interface Size { w: number; h: number }

const MIN_W = 380, MIN_H = 300, MAX_W = 900, MAX_H = 680;
const COLS = 10, ROWS = 8;
const TILE_W = 56, TILE_H = 28;

type Terrain = 'grass' | 'water' | 'rock' | 'sand';
type PropKind = 'tree' | 'castle' | 'hut' | 'portal' | null;

const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: '#4d8a3f', water: '#3b7fb0', rock: '#8a8577', sand: '#d8c07a',
};
const PROP_ICON: Record<Exclude<PropKind, null>, string> = {
  tree: '🌲', castle: '🏰', hut: '🛖', portal: '🌀',
};

interface Tile { terrain: Terrain; prop: PropKind }
interface Actor { id: string; col: number; row: number; icon: string; label: string }

/** Grille procédurale biaisée par le type de POI le plus proche de la position réelle de Synk sur
 * la mapmonde (voir WorldMapWidget.tsx) — c'est le point de raccord entre la carte et la vue
 * isométrique : une forêt fait apparaître plus d'arbres, un lac/une plage plus d'eau/de sable, une
 * grotte/montagne plus de rochers, un village/une taverne/une hutte/une étable fait apparaître une
 * bâtisse. Sans POI proche, terrain de plaine par défaut avec quelques arbres épars. */
function generateGrid(bias: MapPoiType | null): Tile[][] {
  const grid: Tile[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ terrain: 'grass' as Terrain, prop: null as PropKind })));
  const rnd = () => Math.random();

  const waterBias = bias === 'lake' || bias === 'stream' || bias === 'waterfall';
  const sandBias = bias === 'beach';
  const rockBias = bias === 'mountain' || bias === 'cave';
  const forestBias = bias === 'forest';
  const buildingBias = bias === 'village_ally' || bias === 'village_enemy' || bias === 'tavern' || bias === 'stable' || bias === 'hut';

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let terrain: Terrain = 'grass';
      if (waterBias && rnd() < 0.32) terrain = 'water';
      else if (sandBias && rnd() < 0.35) terrain = 'sand';
      else if (rockBias && rnd() < 0.35) terrain = 'rock';
      else if (rnd() < 0.04) terrain = 'water'; // petit point d'eau ambiant même hors biais
      grid[r][c].terrain = terrain;
    }
  }
  // Arbres épars (plus denses si biais forêt)
  const treeChance = forestBias ? 0.28 : 0.08;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].terrain === 'grass' && rnd() < treeChance) grid[r][c].prop = 'tree';
    }
  }
  // Bâtisse si biais village/taverne/étable/hutte
  if (buildingBias) {
    const c = 2 + Math.floor(rnd() * (COLS - 4));
    const r = 2 + Math.floor(rnd() * (ROWS - 4));
    grid[r][c].terrain = 'grass';
    grid[r][c].prop = bias === 'village_ally' || bias === 'village_enemy' ? 'castle' : 'hut';
  }
  // Un portail temporel toujours présent quelque part (voyage à travers les mondes)
  const pc = COLS - 2, pr = 1;
  grid[pr][pc].terrain = 'grass';
  grid[pr][pc].prop = 'portal';

  return grid;
}

const projX = (col: number, row: number) => (col - row) * (TILE_W / 2);
const projY = (col: number, row: number) => (col + row) * (TILE_H / 2);

/**
 * Plateforme de jeu 2D en vue isométrique — fenêtre widget permanente, redimensionnable (glisser
 * le coin ⤡). Conçue comme le SOCLE ÉVOLUTIF de gestion des déplacements/rencontres/décor de Synk,
 * des PNJ, dragons, etc., à l'image des univers Zelda/Minecraft/WoW demandés.
 *
 * IMPORTANT (choix d'architecture) : un vrai moteur Godot/Unity ne peut pas être « embarqué » tel
 * quel dans une session de développement assistée sur ce dépôt Next.js/Vercel (pas de pipeline
 * d'assets/export WebGL/WASM disponible ici). Ce composant fournit donc une implémentation
 * pragmatique et 100% fonctionnelle en React/CSS (grille isométrique, terrain procédural,
 * déplacement au clic, PNJ/dragon qui évoluent) exposant le même contrat de données (entités
 * positionnées sur une grille, terrain dérivé des POI de la mapmonde) qu'un futur export Godot/
 * Unity WebGL pourrait consommer sans tout réécrire — voir `generateGrid()`/`Actor` ci-dessus.
 * Le raccord avec les déplacements sur la mapmonde (voir WorldMapWidget.tsx) se fait via le POI le
 * plus proche de la position réelle de Synk (`getPlayerMapPos`/`getMapPoiDefs`).
 */
export function GameCanvas2D({ stage }: { stage: number }) {
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

  const [bias, setBias] = useState<MapPoiType | null>(null);
  const [biasLabel, setBiasLabel] = useState<string>('');
  const grid = useMemo(() => generateGrid(bias), [bias]);

  const [playerCell, setPlayerCell] = useState({ col: 1, row: ROWS - 2 });
  const [npc, setNpc] = useState<Actor>({ id: 'npc', col: 4, row: 3, icon: '🧙', label: t('canvas2d.npcLabel') });
  const [dragon, setDragon] = useState<Actor>({ id: 'dragon', col: 7, row: 5, icon: '🐉', label: t('canvas2d.dragonLabel') });

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const savedPos = localStorage.getItem(POS_KEY);
    if (savedPos) { try { setPos(JSON.parse(savedPos)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: window.innerWidth - 520, y: 90 });
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (savedSize) { try { setSize(JSON.parse(savedSize)); } catch { /* ignore */ } }
  }, []);

  // Raccord avec la mapmonde : détermine le POI le plus proche de la position réelle de Synk pour
  // orienter le décor procédural de la vue isométrique (voir generateGrid()).
  useEffect(() => {
    if (!address) return;
    (async () => {
      const [mapPos, pois] = await Promise.all([getPlayerMapPos(address), getMapPoiDefs(DEFAULT_MAP_ID)]);
      if (!mapPos || !pois.length) return;
      let nearest: MapPoiDef | null = null;
      let bestD = Infinity;
      for (const poi of pois) {
        const d = Math.hypot(poi.x - mapPos.x, poi.y - mapPos.y);
        if (d < bestD) { bestD = d; nearest = poi; }
      }
      if (nearest) { setBias(nearest.type); setBiasLabel(nearest.name); }
    })().catch(() => {});
  }, [address]);

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
        ℹ️ {biasLabel ? t('canvas2d.biasHint', { poi: biasLabel }) : t('canvas2d.hint')}
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
                  onClick={() => setPlayerCell({ col: c, row: r })}
                  title={`${tile.terrain} (${c},${r})`}
                />
                {tile.prop && (
                  <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-lg pointer-events-none select-none" style={{ zIndex: zIdx + 1 }}>
                    {PROP_ICON[tile.prop]}
                  </span>
                )}
              </div>
            );
          }))}

          {/* PNJ errant */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-[1500ms] pointer-events-none"
            style={{ left: projX(npc.col, npc.row), top: projY(npc.col, npc.row) - 22, zIndex: npc.col + npc.row + 2 }} title={npc.label}>
            <span className="text-lg">{npc.icon}</span>
          </div>
          {/* Dragon errant */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-[1500ms] pointer-events-none"
            style={{ left: projX(dragon.col, dragon.row), top: projY(dragon.col, dragon.row) - 22, zIndex: dragon.col + dragon.row + 2 }} title={dragon.label}>
            <span className="text-xl">{dragon.icon}</span>
          </div>
          {/* Synk (joueur) */}
          <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-500 pointer-events-none"
            style={{ left: projX(playerCell.col, playerCell.row), top: projY(playerCell.col, playerCell.row) - 26, zIndex: playerCell.col + playerCell.row + 3 }}>
            <SynkSkin stage={stage} size={26} />
          </div>
        </div>
      </div>

      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-emerald-400/70 flex items-center justify-center text-[10px]"
        onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp}
      >⤡</div>
    </div>
  );
}

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}
