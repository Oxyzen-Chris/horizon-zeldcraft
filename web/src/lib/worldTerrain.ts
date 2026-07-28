import type { MapPoiType } from './gameState';

// ───────────────────────────── Terrain procédural partagé ─────────────────────────────────────
// Extrait de GameCanvas2D.tsx pour être réutilisé tel quel par WorldMapWidget.tsx (affichage d'un
// calque de terrain en arrière-plan de la mapmonde) : LA MÊME fonction déterministe doit rester
// l'unique source de vérité du décor (eau/montagne/sable/sentier/prairie) pour que les deux widgets
// restent parfaitement cohérents entre eux (aucune divergence possible entre deux implémentations).

export const WORLD_SIZE = 100;
export const POI_BIAS_RADIUS = 9; // rayon (en unités mapmonde) dans lequel un POI influence le terrain local

export type Terrain = 'grass' | 'water' | 'rock' | 'sand' | 'path';
export type PropKind = 'tree' | 'castle' | 'hut' | 'portal' | null;

export const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: '#4d8a3f', water: '#3b7fb0', rock: '#8a8577', sand: '#d8c07a', path: '#a9865a',
};
export const PROP_ICON: Record<Exclude<PropKind, null>, string> = {
  tree: '🌲', castle: '🏰', hut: '🛖', portal: '🌀',
};
export const TERRAIN_I18N_KEY: Record<Terrain, string> = {
  grass: 'canvas2d.terrainGrass', water: 'canvas2d.terrainWater', rock: 'canvas2d.terrainRock',
  sand: 'canvas2d.terrainSand', path: 'canvas2d.terrainPath',
};
export const PROP_I18N_KEY: Record<Exclude<PropKind, null>, string> = {
  tree: 'canvas2d.propTree', castle: 'canvas2d.propCastle', hut: 'canvas2d.propHut', portal: 'canvas2d.propPortal',
};

export interface Tile { terrain: Terrain; prop: PropKind }

/** Petit PRNG déterministe (hash entier) — deux appels avec les mêmes (wc, wr, salt) renvoient
 * toujours la même valeur 0..1. Sert à générer un terrain STABLE par coordonnée absolue de la
 * mapmonde (wc, wr en %), pour que le décor défile de façon cohérente quand la caméra panote
 * (et non ré-aléatoire à chaque déplacement) — voir buildViewportGrid() dans GameCanvas2D.tsx. */
export function hashRand(wc: number, wr: number, salt: number): number {
  let h = (wc * 374761393 + wr * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** Terrain déterministe d'une cellule absolue (wc, wr) de la mapmonde, biaisé par le POI-décor le
 * PLUS PROCHE dans un rayon de POI_BIAS_RADIUS unités (et non plus par un biais global unique) —
 * ainsi un lac/une montagne/un sentier de la mapmonde apparaît bien À SA VRAIE POSITION dans la
 * vue isométrique (cohérence carte ↔ plateforme demandée), et pas de façon uniforme sur toute la
 * fenêtre affichée. Un petit pourcentage AMBIANT (hors tout biais de POI) garantit que des dalles
 * d'eau ET DE MONTAGNE (rock) apparaissent naturellement sur toute la mapmonde, même dans les zones
 * où l'admin n'a placé aucun POI "lac"/"montagne"/"grotte" — voir mécanique Oxygène (GameCanvas2D). */
export function worldTileAt(wc: number, wr: number, poiPoints: { x: number; y: number; poiType?: MapPoiType }[]): Tile {
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
  else if (r0 < 0.07) terrain = 'rock';  // petit affleurement montagneux/rocheux ambiant même hors biais

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

export const clamp100 = (v: number) => Math.max(0, Math.min(WORLD_SIZE, v));
