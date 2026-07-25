'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  getMapPoiDefs, setPlayerMapPos, subscribePlayerMapPos, DEFAULT_MAP_ID,
  type MapPoiDef, type MapPoiType,
} from '@/lib/gameState';
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
// Le viewport isométrique est une fenêtre COLSxROWS glissant sur l'espace complet de la mapmonde
// (0-100 en x/y, même échelle en % que WorldMapWidget.tsx) — un pas de flèche/pavé directionnel
// déplace Synk de STEP_PCT sur cette échelle, ce qui garde les deux widgets parfaitement cohérents
// (même source de vérité : players/{addr}/mapPos, voir gameState.ts::setPlayerMapPos).
const WORLD_SIZE = 100;
const STEP_PCT = 3;
const MARGIN = 1; // marge (en cellules) avant que la caméra ne recadre le décor

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

/** Terrain déterministe d'une cellule absolue (wc, wr) de la mapmonde, biaisé par le type de POI
 * le plus proche de la position réelle de Synk (voir raccord carte↔vue isométrique plus bas). */
function worldTileAt(wc: number, wr: number, bias: MapPoiType | null): Tile {
  const waterBias = bias === 'lake' || bias === 'stream' || bias === 'waterfall';
  const sandBias = bias === 'beach';
  const rockBias = bias === 'mountain' || bias === 'cave';
  const forestBias = bias === 'forest';
  const buildingBias = bias === 'village_ally' || bias === 'village_enemy' || bias === 'tavern' || bias === 'stable' || bias === 'hut';

  let terrain: Terrain = 'grass';
  const r0 = hashRand(wc, wr, 1);
  if (waterBias && r0 < 0.32) terrain = 'water';
  else if (sandBias && r0 < 0.35) terrain = 'sand';
  else if (rockBias && r0 < 0.35) terrain = 'rock';
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
function buildViewportGrid(originCol: number, originRow: number, bias: MapPoiType | null): Tile[][] {
  const grid: Tile[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < COLS; c++) row.push(worldTileAt(originCol + c, originRow + r, bias));
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
  const [poisState, setPoisState] = useState<MapPoiDef[]>([]);

  // Position réelle de Synk sur la mapmonde (0-100%, source de vérité partagée avec
  // WorldMapWidget.tsx) et coin de la caméra isométrique (en cellules, 0-100 chacun).
  const [worldPos, setWorldPos] = useState<Pos>({ x: 50, y: 88 });
  const [origin, setOrigin] = useState({ col: 45, row: 84 });
  const worldPosRef = useRef(worldPos);
  useEffect(() => { worldPosRef.current = worldPos; }, [worldPos]);

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

  // Liste des POI de la mapmonde (une fois) — sert à déterminer le biais de terrain (voir plus bas).
  useEffect(() => { getMapPoiDefs(DEFAULT_MAP_ID).then(setPoisState).catch(() => {}); }, []);

  // Écoute temps réel de la position de Synk — synchronise instantanément avec WorldMapWidget.tsx,
  // quel que soit le widget à l'origine du déplacement (clic carte, flèches, pavé virtuel).
  useEffect(() => {
    if (!address) return;
    return subscribePlayerMapPos(address, p => {
      if (p && p.mapId === DEFAULT_MAP_ID) setWorldPos({ x: p.x, y: p.y });
    });
  }, [address]);

  // Raccord avec la mapmonde : détermine le POI le plus proche de la position réelle de Synk pour
  // orienter le décor procédural de la vue isométrique (voir worldTileAt()).
  useEffect(() => {
    if (!poisState.length) return;
    let nearest: MapPoiDef | null = null;
    let bestD = Infinity;
    for (const poi of poisState) {
      const d = Math.hypot(poi.x - worldPos.x, poi.y - worldPos.y);
      if (d < bestD) { bestD = d; nearest = poi; }
    }
    if (nearest) { setBias(nearest.type); setBiasLabel(nearest.name); }
  }, [poisState, worldPos]);

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

  const grid = useMemo(() => buildViewportGrid(origin.col, origin.row, bias), [origin, bias]);

  const worldCol = Math.round(clamp100(worldPos.x));
  const worldRow = Math.round(clamp100(worldPos.y));
  const playerCell = {
    col: Math.max(0, Math.min(COLS - 1, worldCol - origin.col)),
    row: Math.max(0, Math.min(ROWS - 1, worldRow - origin.row)),
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
                  onClick={() => moveTo(origin.col + c, origin.row + r)}
                  title={`${tile.terrain} (${origin.col + c},${origin.row + r})`}
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
    </div>
  );
}

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}
