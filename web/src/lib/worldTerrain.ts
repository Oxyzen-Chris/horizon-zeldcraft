import type { MapPoiType } from './gameState';

// ───────────────────────────── Terrain procédural partagé ─────────────────────────────────────
// Extrait de GameCanvas2D.tsx pour être réutilisé tel quel par WorldMapWidget.tsx (affichage d'un
// calque de terrain en arrière-plan de la mapmonde) : LA MÊME fonction déterministe doit rester
// l'unique source de vérité du décor (eau/montagne/sable/sentier/prairie) pour que les deux widgets
// restent parfaitement cohérents entre eux (aucune divergence possible entre deux implémentations).

export const WORLD_SIZE = 100;
export const POI_BIAS_RADIUS = 9; // rayon (en unités mapmonde) par défaut dans lequel un POI influence le terrain local

// Rayon d'influence spécifique par type de POI — permet de simuler de GRANDES étendues cohérentes
// (chaînes de montagnes, mers, océans, îles) sans changer WORLD_SIZE ni les positions existantes
// (voir note dans le commentaire de worldTileAt ci-dessous). Les types non listés gardent
// POI_BIAS_RADIUS (comportement historique inchangé — aucune régression sur lac/ruisseau/forêt/
// sentier/village/etc).
const POI_RADIUS_BY_TYPE: Partial<Record<MapPoiType, number>> = {
  mountain: 15, cave: 12,      // chaîne de montagnes plus étendue (jusqu'à 6000 m au cœur)
  sea: 42, ocean: 48,          // grandes étendues d'eau salée en bordure de carte
  pond: 7, lake: 12,           // étangs (petits, 6x6) / lacs (plus grands, 8x8-10x10)
  island: 20,                  // île + sa plage littorale
};
function radiusForType(t: MapPoiType | null | undefined): number {
  if (!t) return POI_BIAS_RADIUS;
  return POI_RADIUS_BY_TYPE[t] ?? POI_BIAS_RADIUS;
}

/** Types de POI catalogue considérés comme des OBSTACLES SOLIDES (voir RepRules.poiObstacleCollisionEnabled,
 * GameCanvas2D.tsx/Platform3DWidget.tsx::move()) : bâtiments habités qu'il n'est pas cohérent de
 * traverser à pied. Volontairement RESTREINT aux structures bâties — 'mountain'/'cave' en sont
 * EXCLUS (elles restent franchissables, voir le saut de la Plateforme 3D), tout comme 'path',
 * 'bridge', les POI d'eau ('stream'/'lake'/'sea'/'ocean'/'pond'/'waterfall') et 'forest'/'beach'/
 * 'island' (déjà régis par leurs propres mécaniques de traversée/nage/accès-Engin) : ajouter un
 * nouveau type ici l'active immédiatement comme obstacle, sans toucher au reste du moteur. */
export const OBSTACLE_POI_TYPES: MapPoiType[] = ['village_ally', 'village_enemy', 'tavern', 'stable', 'hut'];

/** Une cellule est un obstacle bloquant le déplacement INCRÉMENTAL (clavier/pavé directionnel/
 * souris maintenue — PAS le clic d'approche/téléportation `moveTo`, voir commentaire RepRules) si :
 * (a) un POI catalogue de type `OBSTACLE_POI_TYPES` est positionné exactement sur cette case, ou
 * (b) le décor généré aléatoirement par `worldTileAt` y a placé une hutte/un château décoratif
 * (`tile.prop === 'hut' | 'castle'`). Ne dépend d'AUCUN autre champ de `Tile` : appelable avec la
 * tuile déjà calculée par `worldTileAt`, sans recalcul. */
export function isObstacleAt(
  wc: number, wr: number,
  poiPoints: { x: number; y: number; poiType?: MapPoiType }[],
  tile: Pick<Tile, 'prop'>,
): boolean {
  if (tile.prop === 'hut' || tile.prop === 'castle') return true;
  return poiPoints.some(p => p.poiType && OBSTACLE_POI_TYPES.includes(p.poiType) && Math.round(p.x) === wc && Math.round(p.y) === wr);
}

export const ALTITUDE_MAX_M = 6000;   // plus haut sommet possible (paramétrable via RepRules côté jeu)
export const WATER_DEPTH_MAX_M = 6000; // fosse océanique la plus profonde possible

export type Terrain = 'grass' | 'water' | 'rock' | 'sand' | 'path';
export type PropKind = 'tree' | 'castle' | 'hut' | 'portal' | 'bamboo' | 'baobab' | 'palm' | null;
export type WaterKind = 'stream' | 'pond' | 'lake' | 'sea' | 'ocean';

export const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: '#4d8a3f', water: '#3b7fb0', rock: '#8a8577', sand: '#d8c07a', path: '#a9865a',
};
export const PROP_ICON: Record<Exclude<PropKind, null>, string> = {
  tree: '🌲', castle: '🏰', hut: '🛖', portal: '🌀', bamboo: '🎋', baobab: '🌳', palm: '🌴',
};
export const TERRAIN_I18N_KEY: Record<Terrain, string> = {
  grass: 'canvas2d.terrainGrass', water: 'canvas2d.terrainWater', rock: 'canvas2d.terrainRock',
  sand: 'canvas2d.terrainSand', path: 'canvas2d.terrainPath',
};
export const PROP_I18N_KEY: Record<Exclude<PropKind, null>, string> = {
  tree: 'canvas2d.propTree', castle: 'canvas2d.propCastle', hut: 'canvas2d.propHut', portal: 'canvas2d.propPortal',
  bamboo: 'canvas2d.propBamboo', baobab: 'canvas2d.propBaobab', palm: 'canvas2d.propPalm',
};

/**
 * `altitudeM` (dalles 'rock' uniquement) et `depthM`/`waterKind` (dalles 'water' uniquement) sont
 * OPTIONNELS : tout code existant qui ne déstructure que `{ terrain, prop }` continue de fonctionner
 * à l'identique (aucune régression). `isIsland` marque une dalle de terre appartenant au rayon d'un
 * POI de type 'island' — sert de base à la mécanique de « gate d'accès aux mondes » via engin (voir
 * GameCanvas2D.tsx) pour exiger un Engin (besace) avant de fouler une île. Champs prévus pour être
 * directement réutilisables tels quels par le futur widget "Plateforme 3D" (altitude = relief,
 * depthM = profondeur immergée) sans avoir à retoucher le modèle de données à ce moment-là.
 */
export interface Tile {
  terrain: Terrain;
  prop: PropKind;
  altitudeM?: number;
  depthM?: number;
  waterKind?: WaterKind;
  isIsland?: boolean;
}

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

/** Plafond d'altitude/profondeur STABLE propre à un POI donné (dérivé de sa position, pas de son
 * id, pour rester déterministe même si l'id change) — ainsi certains sommets/certaines fosses sont
 * naturellement plus hauts/profonds que d'autres (chaîne de montagnes irrégulière, mers moins
 * profondes que les océans, etc) plutôt qu'un plafond uniforme partout. */
function poiCap(px: number, py: number, salt: number, min: number, max: number): number {
  const r = hashRand(Math.round(px * 8), Math.round(py * 8), salt);
  return min + r * (max - min);
}

/** Terrain déterministe d'une cellule absolue (wc, wr) de la mapmonde, biaisé par le POI-décor le
 * PLUS « central » (au sens de sa distance rapportée à SON PROPRE rayon d'influence — voir
 * POI_RADIUS_BY_TYPE) — ainsi un lac/une montagne/un sentier de la mapmonde apparaît bien À SA VRAIE
 * POSITION dans la vue isométrique (cohérence carte ↔ plateforme demandée), et pas de façon uniforme
 * sur toute la fenêtre affichée. Pour tous les types historiques (rayon par défaut identique,
 * POI_BIAS_RADIUS), ce classement par ratio est STRICTEMENT ÉQUIVALENT à l'ancien classement par
 * distance brute (aucune régression) ; seuls les nouveaux types à grand rayon (mer/océan/île/
 * montagne étendue) en tirent un rayon d'influence différent. Un petit pourcentage AMBIANT (hors
 * tout biais de POI) garantit que des dalles d'eau ET DE MONTAGNE (rock) apparaissent naturellement
 * sur toute la mapmonde, même dans les zones où l'admin n'a placé aucun POI "lac"/"montagne"/
 * "grotte" — voir mécanique Oxygène (GameCanvas2D). */
export function worldTileAt(wc: number, wr: number, poiPoints: { x: number; y: number; poiType?: MapPoiType; radius?: number }[]): Tile {
  let bias: MapPoiType | null = null;
  let bestRatio = 1;      // distance / rayon du meilleur candidat retenu (1 = hors influence)
  let bestFalloff = 0;    // 1 - bestRatio, mémorisé pour l'altitude/la profondeur/la plage littorale
  let winner: { x: number; y: number } | null = null;
  for (const p of poiPoints) {
    if (!p.poiType) continue;
    const radius = p.radius ?? radiusForType(p.poiType);
    const d = Math.hypot(p.x - wc, p.y - wr);
    if (d > radius) continue;
    const ratio = d / radius;
    if (ratio < bestRatio) { bestRatio = ratio; bestFalloff = 1 - ratio; bias = p.poiType; winner = { x: p.x, y: p.y }; }
  }

  const waterBias = bias === 'lake' || bias === 'stream' || bias === 'waterfall' || bias === 'pond' || bias === 'sea' || bias === 'ocean';
  const sandBias = bias === 'beach';
  const rockBias = bias === 'mountain' || bias === 'cave';
  const forestBias = bias === 'forest';
  const pathBias = bias === 'path' || bias === 'bridge';
  const buildingBias = bias === 'village_ally' || bias === 'village_enemy' || bias === 'tavern' || bias === 'stable' || bias === 'hut';
  const islandBias = bias === 'island';

  let terrain: Terrain = 'grass';
  const r0 = hashRand(wc, wr, 1);
  if (islandBias) {
    // Cœur d'île en prairie, cerné d'un anneau de plage littorale (jamais d'eau/rocher DANS le
    // rayon d'une île — la mer/l'océan environnante prend le relais dès qu'on en sort, via le POI
    // 'sea'/'ocean' que l'admin place autour, voir mécanisme de compétition par ratio ci-dessus).
    terrain = bestFalloff < 0.22 ? 'sand' : 'grass';
  } else if (waterBias && r0 < 0.32) terrain = 'water';
  else if (sandBias && r0 < 0.35) terrain = 'sand';
  else if (rockBias && r0 < 0.35) terrain = 'rock';
  else if (pathBias && r0 < 0.5) terrain = 'path';
  else if (r0 < 0.04) terrain = 'water'; // petit point d'eau ambiant même hors biais
  else if (r0 < 0.07) terrain = 'rock';  // petit affleurement montagneux/rocheux ambiant même hors biais

  // ─── Altitude (dalles 'rock') — chaîne de montagnes irrégulière culminant jusqu'à
  // ALTITUDE_MAX_M au cœur d'un biais 'mountain'/'cave' ; sans biais, simple colline/relief
  // rocheux ambiant de faible altitude (jamais de neige, voir seuil dans GameCanvas2D).
  let altitudeM: number | undefined;
  if (terrain === 'rock') {
    if (rockBias && winner) {
      const peakCap = poiCap(winner.x, winner.y, 31, 1800, ALTITUDE_MAX_M);
      const jitter = (hashRand(wc, wr, 32) - 0.5) * 300;
      altitudeM = Math.max(150, Math.round(peakCap * bestFalloff + jitter));
    } else {
      altitudeM = Math.round(250 + hashRand(wc, wr, 32) * 500); // colline ambiante 250-750 m
    }
  }

  // ─── Profondeur (dalles 'water') — mers/océans profonds au centre de leur POI, lacs/étangs
  // modérés, ruisseaux/chutes toujours peu profonds ; sans biais, petite flaque ambiante.
  let depthM: number | undefined;
  let waterKind: WaterKind | undefined;
  if (terrain === 'water') {
    const kindByBias: Partial<Record<MapPoiType, WaterKind>> = {
      sea: 'sea', ocean: 'ocean', lake: 'lake', pond: 'pond', stream: 'stream', waterfall: 'stream',
    };
    if (waterBias && winner && bias) {
      waterKind = kindByBias[bias] ?? 'stream';
      const maxDepthByKind: Record<WaterKind, number> = { stream: 3, pond: 6, lake: 45, sea: 260, ocean: WATER_DEPTH_MAX_M };
      const capMax = maxDepthByKind[waterKind];
      const cap = poiCap(winner.x, winner.y, 33, capMax * 0.35, capMax);
      const jitter = (hashRand(wc, wr, 34) - 0.5) * 0.12 * capMax;
      depthM = Math.max(0.3, Math.round((cap * bestFalloff + jitter) * 10) / 10);
    } else {
      waterKind = 'stream';
      depthM = Math.round((0.5 + hashRand(wc, wr, 34) * 1.5) * 10) / 10; // flaque ambiante 0.5-2 m
    }
  }

  let prop: PropKind = null;
  const treeChance = forestBias ? 0.28 : islandBias ? 0.22 : 0.08;
  if (terrain === 'grass' && hashRand(wc, wr, 2) < treeChance) {
    if (islandBias) {
      const pr = hashRand(wc, wr, 24);
      prop = pr < 0.34 ? 'bamboo' : pr < 0.67 ? 'baobab' : 'palm';
    } else prop = 'tree';
  }
  // Bâtisse éparse (rare) si biais village/taverne/étable/hutte
  if (buildingBias && terrain === 'grass' && !prop && hashRand(wc, wr, 3) < 0.05) {
    prop = (bias === 'village_ally' || bias === 'village_enemy') ? 'castle' : 'hut';
  }
  // Portail temporel rare et stable, dispersé sur toute la mapmonde
  if (!prop && hashRand(wc, wr, 4) < 0.01) prop = 'portal';

  return { terrain, prop, altitudeM, depthM, waterKind, isIsland: islandBias || undefined };
}

export const clamp100 = (v: number) => Math.max(0, Math.min(WORLD_SIZE, v));
