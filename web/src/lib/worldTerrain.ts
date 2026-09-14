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

/** Taille (en tuiles) de la grille grossière servant à semer les GRANDS clusters d'eau/rocher
 * "ambiants" (sans aucun POI admin à proximité) — voir `ambientClusterAt` ci-dessous. */
const AMBIENT_CLUSTER_CELL = 20;

interface AmbientCluster { falloff: number; radius: number }

/** Cherche, autour de (wc, wr), le plus proche cluster d'eau OU de rocher "ambiant" (aucun POI admin
 * à proximité) parmi ceux semés sur une grille grossière de cellules `AMBIENT_CLUSTER_CELL` tuiles :
 * chaque cellule grossière a ~16% de chance d'accueillir un blob (centre jitté à l'intérieur de la
 * cellule, rayon 5 à 20 tuiles soit un DIAMÈTRE de 10 à 40 tuiles). `salt` distingue le calque eau
 * (500) du calque rocher (600) pour qu'ils ne se superposent pas systématiquement. Un léger bruit
 * est ajouté à la distance testée pour éviter un contour parfaitement circulaire (littoral/relief
 * plus organique). Remplace l'ancien tirage indépendant tuile par tuile (`hashRand(wc,wr,salt) <
 * seuil` partout sur la carte), qui ne produisait que des points d'eau/rocher isolés d'1-2 cases —
 * corrige la demande utilisateur « les montagnes/lacs/étangs [...] doivent être plus grand [...]
 * un groupe de 10x10 [...] ou 40x40 pour les plus grands » : recherche dans la cellule courante +
 * les 8 voisines (un blob peut déborder de sa cellule d'origine). Reste 100% déterministe (mêmes
 * (wc, wr) → même résultat) et n'affecte JAMAIS une tuile déjà biaisée par un vrai POI admin (voir
 * appel conditionnel dans `worldTileAt` ci-dessous, uniquement dans la branche "sans biais"). */
function ambientClusterAt(wc: number, wr: number, salt: number): AmbientCluster | null {
  const cellSize = AMBIENT_CLUSTER_CELL;
  const originCx = Math.floor(wc / cellSize);
  const originCy = Math.floor(wr / cellSize);
  let best: AmbientCluster | null = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = originCx + dx, cy = originCy + dy;
      if (hashRand(cx, cy, salt) > 0.16) continue; // cellule grossière sans blob de ce type
      const jx = hashRand(cx, cy, salt + 1000);
      const jy = hashRand(cx, cy, salt + 2000);
      const centerX = cx * cellSize + jx * cellSize;
      const centerY = cy * cellSize + jy * cellSize;
      const sizeRoll = hashRand(cx, cy, salt + 3000);
      const radius = 5 + sizeRoll * 15; // rayon 5-20 tuiles → diamètre 10-40 tuiles
      const noise = (hashRand(wc, wr, salt + 4000) - 0.5) * 3; // bord légèrement irrégulier
      const d = Math.hypot(centerX - wc, centerY - wr) + noise;
      if (d > radius) continue;
      const ratio = Math.max(0, d / radius);
      const falloff = 1 - ratio;
      if (!best || falloff > best.falloff) best = { falloff, radius };
    }
  }
  return best;
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
  // Clusters d'eau/rocher "ambiants" (aucun POI admin à proximité, voir ambientClusterAt) — calculés
  // AVANT le if/else ci-dessous pour être réutilisés tels quels dans le calcul d'altitude/profondeur
  // plus bas (falloff/rayon), sans re-tirage. Uniquement consultés dans la branche "sans biais" :
  // ne peuvent JAMAIS remplacer un terrain déjà décidé par un vrai POI admin (lac/montagne/plage/…).
  const ambientWaterCluster = !bias ? ambientClusterAt(wc, wr, 500) : null;
  const ambientRockCluster = (!bias && !ambientWaterCluster) ? ambientClusterAt(wc, wr, 600) : null;
  if (islandBias) {
    // Cœur d'île en prairie, cerné d'un anneau de plage littorale (jamais d'eau/rocher DANS le
    // rayon d'une île — la mer/l'océan environnante prend le relais dès qu'on en sort, via le POI
    // 'sea'/'ocean' que l'admin place autour, voir mécanisme de compétition par ratio ci-dessus).
    terrain = bestFalloff < 0.22 ? 'sand' : 'grass';
  } else if (waterBias && r0 < 0.32) terrain = 'water';
  else if (sandBias && r0 < 0.35) terrain = 'sand';
  else if (rockBias && r0 < 0.35) terrain = 'rock';
  else if (pathBias && r0 < 0.5) terrain = 'path';
  else if (ambientWaterCluster) terrain = 'water'; // grand plan d'eau naturel (mare/étang/lac), 10 à 40 tuiles de diamètre
  else if (ambientRockCluster) terrain = 'rock';   // grand relief naturel (colline/petite chaîne rocheuse), 10 à 40 tuiles de diamètre

  // ─── Altitude (dalles 'rock') — chaîne de montagnes irrégulière culminant jusqu'à
  // ALTITUDE_MAX_M au cœur d'un biais 'mountain'/'cave' ; sans biais mais dans un grand cluster
  // ambiant (voir ambientClusterAt), relief modéré dont le pic croît avec la taille du cluster (un
  // grand massif culmine plus haut qu'une simple butte) ; repli résiduel sinon (cas marginal,
  // ne devrait plus se produire en pratique puisque tout 'rock' passe par l'une des deux branches).
  let altitudeM: number | undefined;
  if (terrain === 'rock') {
    if (rockBias && winner) {
      const peakCap = poiCap(winner.x, winner.y, 31, 1800, ALTITUDE_MAX_M);
      const jitter = (hashRand(wc, wr, 32) - 0.5) * 300;
      altitudeM = Math.max(150, Math.round(peakCap * bestFalloff + jitter));
    } else if (ambientRockCluster) {
      const peakCap = Math.min(2500, 300 + ambientRockCluster.radius * 90);
      const jitter = (hashRand(wc, wr, 32) - 0.5) * 200;
      altitudeM = Math.max(100, Math.round(peakCap * ambientRockCluster.falloff + jitter));
    } else {
      altitudeM = Math.round(250 + hashRand(wc, wr, 32) * 500); // repli résiduel (colline isolée)
    }
  }

  // ─── Profondeur (dalles 'water') — mers/océans profonds au centre de leur POI, lacs/étangs
  // modérés ; sans biais mais dans un grand cluster ambiant (voir ambientClusterAt), mare/étang/lac
  // naturel dont la profondeur croît avec la taille du cluster ; repli résiduel sinon (cas marginal).
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
    } else if (ambientWaterCluster) {
      // Un cluster ≥12 tuiles de rayon (≥24 de diamètre) se lit comme un petit lac naturel, un plus
      // petit comme une simple mare/étang — seuil purement cosmétique (icône/libellé), la mécanique
      // de nage/oxygène ne dépend que de `terrain === 'water'`/`depthM`, jamais de `waterKind`.
      waterKind = ambientWaterCluster.radius >= 12 ? 'lake' : 'pond';
      const capMax = Math.min(10, 1 + ambientWaterCluster.radius * 0.45);
      const jitter = (hashRand(wc, wr, 34) - 0.5) * 0.15 * capMax;
      depthM = Math.max(0.3, Math.round((capMax * ambientWaterCluster.falloff + jitter) * 10) / 10);
    } else {
      waterKind = 'stream';
      depthM = Math.round((0.5 + hashRand(wc, wr, 34) * 1.5) * 10) / 10; // repli résiduel (flaque isolée)
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
